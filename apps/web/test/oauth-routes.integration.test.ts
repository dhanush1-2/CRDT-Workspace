import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { prisma } from '@crdt/db'
import { GET as start } from '../src/app/api/auth/oauth/[provider]/route.js'
import { GET as callback } from '../src/app/api/auth/oauth/[provider]/callback/route.js'
import { INVITE_TTL_MS } from '../src/lib/invite-token.js'
import { createOrReplaceInvitation, resolveInvite } from '../src/lib/invitations.js'
import { flowCookie } from '../src/lib/oauth/flow.js'
import { SESSION_COOKIE, verifySession } from '../src/lib/session.js'

const SECRET = 'session-secret-long-enough-for-oauth-route-tests!!'
const APP = 'http://localhost:3000'
const RUN = Date.now().toString(36)
const email = (label: string) => `oauth-route-${label}-${RUN}@example.com`

beforeAll(() => {
  process.env.SESSION_SECRET = SECRET
  process.env.APP_URL = APP
  process.env.GITHUB_CLIENT_ID = 'gh-client'
  process.env.GITHUB_CLIENT_SECRET = 'gh-secret'
  process.env.GOOGLE_CLIENT_ID = 'gg-client'
  process.env.GOOGLE_CLIENT_SECRET = 'gg-secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `-${RUN}@example.com` } },
    select: { id: true },
  })
  const ids = users.map((user) => user.id)
  await prisma.workspace.deleteMany({ where: { ownerId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

const params = (provider: string) => ({ params: Promise.resolve({ provider }) })

async function begin(provider: string, next?: string) {
  const url = new URL(`${APP}/api/auth/oauth/${provider}`)
  if (next !== undefined) url.searchParams.set('next', next)
  const response = await start(new Request(url), params(provider))
  const location = new URL(response.headers.get('location')!)
  const setCookie = response.headers.getSetCookie().find((c) => c.startsWith('crdt_oauth='))
  return {
    response,
    location,
    /** What the browser would send back: "crdt_oauth=<value>". */
    cookie: setCookie?.split(';')[0],
    state: location.searchParams.get('state') ?? '',
  }
}

async function finish(provider: string, query: Record<string, string>, cookie?: string) {
  const url = new URL(`${APP}/api/auth/oauth/${provider}/callback`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return callback(new Request(url, { headers: cookie ? { cookie } : {} }), params(provider))
}

/** Fakes GitHub's token, /user and /user/emails endpoints. */
function stubGithub(opts: { accountId: string; email: string; verified?: boolean; token?: unknown }) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === 'https://github.com/login/oauth/access_token') {
      return Response.json(opts.token ?? { access_token: 'gh-token' })
    }
    if (url === 'https://api.github.com/user') {
      return Response.json({ id: opts.accountId, login: 'octo', name: 'Octo Cat' })
    }
    if (url === 'https://api.github.com/user/emails') {
      return Response.json([{ email: opts.email, primary: true, verified: opts.verified ?? true }])
    }
    return new Response(`unexpected request to ${url}`, { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('GET /api/auth/oauth/:provider', () => {
  it('sends the browser to GitHub with state, PKCE and the registered callback URL', async () => {
    const { response, location, cookie } = await begin('github')

    expect(response.status).toBe(302)
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe('gh-client')
    expect(location.searchParams.get('redirect_uri')).toBe(`${APP}/api/auth/oauth/github/callback`)
    expect(location.searchParams.get('response_type')).toBe('code')
    expect(location.searchParams.get('scope')).toBe('read:user user:email')
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(cookie).toMatch(/^crdt_oauth=/)
  })

  it('asks Google to let the person choose an account', async () => {
    const { location } = await begin('google')
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(location.searchParams.get('prompt')).toBe('select_account')
  })

  it('refuses an unknown provider without setting a cookie', async () => {
    const { location, cookie } = await begin('facebook', '/workspaces/abc')
    expect(location.toString()).toBe(`${APP}/login?error=provider_unavailable&next=%2Fworkspaces%2Fabc`)
    expect(cookie).toBeUndefined()
  })

  it('refuses a provider with no credentials configured', async () => {
    const saved = process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_CLIENT_SECRET
    try {
      const { location, cookie } = await begin('google')
      expect(location.toString()).toBe(`${APP}/login?error=provider_unavailable`)
      expect(cookie).toBeUndefined()
    } finally {
      process.env.GOOGLE_CLIENT_SECRET = saved
    }
  })
})

describe('GET /api/auth/oauth/:provider/callback', () => {
  it('signs a new person in, gives them a workspace, and returns them to where they were going', async () => {
    const accountId = `gh-happy-${RUN}`
    stubGithub({ accountId, email: `  ${email('happy').toUpperCase()} ` })
    const { cookie, state } = await begin('github', '/workspaces/abc')

    const response = await finish('github', { code: 'the-code', state }, cookie)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${APP}/workspaces/abc`)

    const setCookies = response.headers.getSetCookie()
    // The flow cookie is spent...
    expect(setCookies.some((c) => c.startsWith('crdt_oauth=;') && c.includes('Max-Age=0'))).toBe(true)
    // ...and a real session is issued for the user we just created.
    const session = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!
    const userId = await verifySession(session.split(';')[0]!.slice(SESSION_COOKIE.length + 1), SECRET)
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { accounts: true } })
    expect(user?.email).toBe(email('happy'))
    expect(user?.accounts[0]?.providerAccountId).toBe(accountId)
    expect(await prisma.workspace.count({ where: { ownerId: userId } })).toBe(1)
  })

  it('sends the PKCE verifier whose hash is the challenge it gave the provider', async () => {
    const fetchMock = stubGithub({ accountId: `gh-pkce-${RUN}`, email: email('pkce') })
    const { cookie, state, location } = await begin('github')

    await finish('github', { code: 'c', state }, cookie)

    const tokenCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(
      ([url]) => url === 'https://github.com/login/oauth/access_token',
    )!
    const body = new URLSearchParams(String(tokenCall[1].body))
    const verifier = body.get('code_verifier')!
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      location.searchParams.get('code_challenge'),
    )
    expect(body.get('redirect_uri')).toBe(`${APP}/api/auth/oauth/github/callback`)
  })

  it('rejects a mismatched state before making any network call', async () => {
    const fetchMock = stubGithub({ accountId: `gh-csrf-${RUN}`, email: email('csrf') })
    const { cookie } = await begin('github', '/workspaces/abc')

    const response = await finish('github', { code: 'attacker-code', state: 'x'.repeat(43) }, cookie)

    expect(response.headers.get('location')).toBe(`${APP}/login?error=state_mismatch&next=%2Fworkspaces%2Fabc`)
    expect(response.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a callback with no flow cookie at all', async () => {
    const fetchMock = stubGithub({ accountId: `gh-nocookie-${RUN}`, email: email('nocookie') })
    const response = await finish('github', { code: 'c', state: 's' })
    expect(response.headers.get('location')).toBe(`${APP}/login?error=state_mismatch`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a flow started for one provider arriving at another', async () => {
    const { cookie, state } = await begin('github')
    const response = await finish('google', { code: 'c', state }, cookie)
    expect(response.headers.get('location')).toBe(`${APP}/login?error=state_mismatch`)
  })

  it('reports a cancelled sign-in as cancelled, and any other provider error generically', async () => {
    const { cookie } = await begin('github')
    const cancelled = await finish('github', { error: 'access_denied' }, cookie)
    expect(cancelled.headers.get('location')).toBe(`${APP}/login?error=access_denied`)

    const other = await finish('github', { error: 'temporarily_unavailable' }, cookie)
    expect(other.headers.get('location')).toBe(`${APP}/login?error=provider_error`)
  })

  it("treats GitHub's HTTP-200-with-error token response as a failure", async () => {
    stubGithub({
      accountId: `gh-badcode-${RUN}`,
      email: email('badcode'),
      token: { error: 'bad_verification_code' },
    })
    const { cookie, state } = await begin('github')
    const response = await finish('github', { code: 'reused', state }, cookie)
    expect(response.headers.get('location')).toBe(`${APP}/login?error=provider_error`)
  })

  it('refuses an unverified email and creates no user', async () => {
    stubGithub({ accountId: `gh-unverified-${RUN}`, email: email('unverified'), verified: false })
    const { cookie, state } = await begin('github')

    const response = await finish('github', { code: 'c', state }, cookie)

    expect(response.headers.get('location')).toBe(`${APP}/login?error=no_verified_email`)
    expect(await prisma.user.count({ where: { email: email('unverified') } })).toBe(0)
  })

  it('reports a provider that cannot be reached as a generic failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const { cookie, state } = await begin('github')
    const response = await finish('github', { code: 'c', state }, cookie)
    expect(response.headers.get('location')).toBe(`${APP}/login?error=provider_error`)
  })

  it('re-validates next itself, even from a validly signed cookie', async () => {
    // Defense in depth: the start route already sanitizes next, but the
    // callback must not trust the cookie's copy blindly.
    stubGithub({ accountId: `gh-next-${RUN}`, email: email('next') })
    const flow = {
      provider: 'github' as const,
      state: 's'.repeat(43),
      verifier: 'v'.repeat(43),
      next: '//evil.example',
      issuedAt: Math.floor(Date.now() / 1000),
    }
    const cookie = flowCookie(flow, SECRET).split(';')[0]

    const response = await finish('github', { code: 'c', state: flow.state }, cookie)

    expect(response.headers.get('location')).toBe(`${APP}/`)
  })
})

describe('signing in accepts pending invitations', () => {
  let inviterId: string
  let workspaceId: string
  let secondWorkspaceId: string
  let lateWorkspaceId: string
  let documentId: string

  beforeAll(async () => {
    // The host's email matches the file's cleanup, which deletes the workspaces they
    // own, and the invitations go with them. The label avoids "inviter-", which other
    // files' cleanup patterns match.
    inviterId = (await prisma.user.create({ data: { email: email('host'), name: 'Host' } })).id
    const make = async (name: string) =>
      (await prisma.workspace.create({ data: { name: `${name}-${RUN}`, ownerId: inviterId } })).id
    workspaceId = await make('oauth-invite')
    secondWorkspaceId = await make('oauth-invite-second')
    lateWorkspaceId = await make('oauth-invite-late')
    documentId = (await prisma.document.create({ data: { workspaceId, type: 'doc', title: 'Invited doc' } })).id
  })

  it('a new person invited by email joins on first sign-in, returns to the invite, and it sends them to the document', async () => {
    const invited = email('guest')
    const { link } = await createOrReplaceInvitation({
      workspaceId,
      email: invited,
      role: 'viewer',
      documentId,
      invitedById: inviterId,
    })
    // GitHub reports the address in its own capitalisation.
    stubGithub({ accountId: `gh-guest-${RUN}`, email: invited.toUpperCase() })
    const { cookie, state } = await begin('github', link)

    const response = await finish('github', { code: 'c', state }, cookie)

    expect(response.headers.get('location')).toBe(`${APP}${link}`)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: invited }, select: { id: true, email: true } })
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
    })
    expect(membership?.role).toBe('viewer')
    const row = await prisma.invitation.findUniqueOrThrow({
      where: { workspaceId_email: { workspaceId, email: invited } },
    })
    expect(row.acceptedAt).not.toBeNull()
    // Back on the invite page, the used link sends its own person on to the document.
    expect(await resolveInvite(link.slice('/invite/'.length), user)).toEqual({
      kind: 'redirect',
      to: `/workspaces/${workspaceId}/documents/${documentId}`,
    })
  })

  it('accepts pending invitations without the link, skips expired ones, and never changes a role', async () => {
    const returning = email('returning')
    stubGithub({ accountId: `gh-returning-${RUN}`, email: returning })
    // A first sign-in creates the person.
    const first = await begin('github')
    await finish('github', { code: 'c', state: first.state }, first.cookie)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: returning } })
    await prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role: 'editor' } })

    // The members route only invites emails with no account; these stand for
    // invitations made before the account existed and not yet swept.
    const base = { email: returning, documentId: null, invitedById: inviterId }
    await createOrReplaceInvitation({ ...base, workspaceId, role: 'viewer' })
    await createOrReplaceInvitation({ ...base, workspaceId: secondWorkspaceId, role: 'editor' })
    await createOrReplaceInvitation({
      ...base,
      workspaceId: lateWorkspaceId,
      role: 'editor',
      now: new Date(Date.now() - INVITE_TTL_MS - 60_000),
    })

    const again = await begin('github', '/')
    const response = await finish('github', { code: 'c', state: again.state }, again.cookie)
    expect(response.headers.get('location')).toBe(`${APP}/`)
    // The sweep ran as part of a sign-in that still completed.
    expect(response.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true)

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id, workspaceId: { in: [workspaceId, secondWorkspaceId, lateWorkspaceId] } },
      select: { workspaceId: true, role: true },
    })
    expect(new Map(memberships.map((m) => [m.workspaceId, m.role]))).toEqual(
      new Map([
        [workspaceId, 'editor'],
        [secondWorkspaceId, 'editor'],
      ]),
    )
    // The viewer invitation to a workspace they already belong to was used up without
    // touching their editor role.
    const viewerInvite = await prisma.invitation.findUniqueOrThrow({
      where: { workspaceId_email: { workspaceId, email: returning } },
    })
    expect(viewerInvite.acceptedAt).not.toBeNull()
    const late = await prisma.invitation.findUniqueOrThrow({
      where: { workspaceId_email: { workspaceId: lateWorkspaceId, email: returning } },
    })
    expect(late.acceptedAt).toBeNull()
  })
})
