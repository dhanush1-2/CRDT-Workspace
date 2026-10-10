import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { cookies } from 'next/headers'
import { prisma } from '@crdt/db'
import { POST as postMember } from '../src/app/api/workspaces/[id]/members/route.js'
import { GET as listRoute } from '../src/app/api/workspaces/[id]/invitations/route.js'
import { DELETE as revokeRoute } from '../src/app/api/workspaces/[id]/invitations/[invitationId]/route.js'
import { POST as linkRoute } from '../src/app/api/workspaces/[id]/invitations/[invitationId]/link/route.js'
import { resolveInvite } from '../src/lib/invitations.js'
import type { InvitationLinkResult, InvitationView, MemberPostResult } from '../src/lib/members.js'
import { signSession, SESSION_COOKIE } from '../src/lib/session.js'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

const RUN = Date.now().toString(36)
const email = (label: string) => `invroute-${label}-${RUN}@example.com`
const tokenOf = (link: string) => link.slice('/invite/'.length)

let owner: { id: string }
let editor: { id: string }
let viewer: { id: string }
let stranger: { id: string }
let workspaceId: string
let strangerWorkspaceId: string
let documentId: string
let strangerDocumentId: string

beforeAll(async () => {
  process.env.SESSION_SECRET = 'session-secret-long-enough-for-invitation-routes!!'
  const make = (label: string) =>
    prisma.user.create({ data: { email: email(label), name: label }, select: { id: true } })
  owner = await make('owner')
  editor = await make('editor')
  viewer = await make('viewer')
  stranger = await make('stranger')

  workspaceId = (await prisma.workspace.create({ data: { name: `invroute-${RUN}`, ownerId: owner.id } })).id
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId, userId: owner.id, role: 'owner' },
      { workspaceId, userId: editor.id, role: 'editor' },
      { workspaceId, userId: viewer.id, role: 'viewer' },
    ],
  })
  documentId = (await prisma.document.create({ data: { workspaceId, type: 'doc', title: 'Plan' } })).id

  // The stranger owns a workspace of their own, so they pass an owner check there.
  strangerWorkspaceId = (
    await prisma.workspace.create({ data: { name: `invroute-stranger-${RUN}`, ownerId: stranger.id } })
  ).id
  await prisma.workspaceMember.create({
    data: { workspaceId: strangerWorkspaceId, userId: stranger.id, role: 'owner' },
  })
  strangerDocumentId = (
    await prisma.document.create({ data: { workspaceId: strangerWorkspaceId, type: 'doc', title: 'Theirs' } })
  ).id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: { endsWith: `-${RUN}` } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${RUN}@example.com` } } })
  await prisma.$disconnect()
})

/** Signs the next route call in as `userId`, or out when null. */
async function as(userId: string | null) {
  const token = userId === null ? null : await signSession(userId, process.env.SESSION_SECRET!)
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (token !== null && name === SESSION_COOKIE ? { value: token } : undefined),
  } as never)
}

function request(method: string, body?: unknown) {
  return new Request('http://localhost/api', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const inWorkspace = (id: string) => ({ params: Promise.resolve({ id }) })
const onInvitation = (id: string, invitationId: string) => ({ params: Promise.resolve({ id, invitationId }) })

async function inviteAsOwner(label: string, role: 'owner' | 'editor' | 'viewer' = 'viewer') {
  await as(owner.id)
  const response = await postMember(request('POST', { email: email(label), role }), inWorkspace(workspaceId))
  const body = (await response.json()) as MemberPostResult
  if (body.kind !== 'invitation') throw new Error(`expected an invitation, got ${JSON.stringify(body)}`)
  return body
}

const NON_OWNERS = () =>
  [
    ['editor', editor.id, 403],
    ['viewer', viewer.id, 403],
    ['stranger', stranger.id, 404],
    ['signed out', null, 401],
  ] as const

describe('POST /api/workspaces/[id]/members', () => {
  it('invites an email with no account: a pending invitation and its link, never cached', async () => {
    await as(owner.id)
    const response = await postMember(
      request('POST', { email: `  ${email('newcomer').toUpperCase()} `, role: 'viewer', documentId }),
      inWorkspace(workspaceId),
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as MemberPostResult
    if (body.kind !== 'invitation') throw new Error('expected an invitation')
    expect(body.link).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/)
    expect(body.invitation).toMatchObject({ email: email('newcomer'), role: 'viewer', expired: false })

    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: body.invitation.id } })
    expect(row).toMatchObject({ workspaceId, documentId, invitedById: owner.id, acceptedAt: null })
  })

  it('refuses a document from another workspace and stores nothing', async () => {
    await as(owner.id)
    const response = await postMember(
      request('POST', { email: email('crossdoc'), role: 'viewer', documentId: strangerDocumentId }),
      inWorkspace(workspaceId),
    )
    expect(response.status).toBe(400)
    expect(await prisma.invitation.count({ where: { email: email('crossdoc') } })).toBe(0)
  })

  it('refuses an address longer than 254 characters and stores nothing', async () => {
    const tooLong = `${'a'.repeat(255 - '@example.com'.length)}@example.com`
    expect(tooLong).toHaveLength(255)
    await as(owner.id)
    const response = await postMember(
      request('POST', { email: tooLong, role: 'viewer' }),
      inWorkspace(workspaceId),
    )
    expect(response.status).toBe(400)
    expect(await prisma.invitation.count({ where: { email: tooLong } })).toBe(0)
  })

  it('refuses a document that does not exist and stores nothing', async () => {
    await as(owner.id)
    const response = await postMember(
      request('POST', { email: email('nodoc'), role: 'viewer', documentId: 'no-such-document' }),
      inWorkspace(workspaceId),
    )
    expect(response.status).toBe(400)
    expect(await prisma.invitation.count({ where: { email: email('nodoc') } })).toBe(0)
  })

  it('re-inviting an existing member takes the member path and creates no invitation', async () => {
    await as(owner.id)
    const response = await postMember(
      request('POST', { email: email('editor'), role: 'editor', documentId }),
      inWorkspace(workspaceId),
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ kind: 'member', userId: editor.id, role: 'editor' })
    expect(await prisma.invitation.count({ where: { email: email('editor') } })).toBe(0)
  })

  it('adds an existing user at once, exactly as before, and stores no invitation', async () => {
    const existing = await prisma.user.create({ data: { email: email('existing'), name: 'Existing' } })
    await as(owner.id)
    const response = await postMember(
      request('POST', { email: existing.email, role: 'editor', documentId }),
      inWorkspace(workspaceId),
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ kind: 'member', userId: existing.id, role: 'editor' })
    expect(await prisma.invitation.count({ where: { email: existing.email } })).toBe(0)
  })

  it('lets only owners invite, and stores nothing for anyone else', async () => {
    for (const [who, userId, status] of NON_OWNERS()) {
      await as(userId)
      const response = await postMember(
        request('POST', { email: email('forbidden'), role: 'owner' }),
        inWorkspace(workspaceId),
      )
      expect(response.status, who).toBe(status)
    }
    expect(await prisma.invitation.count({ where: { email: email('forbidden') } })).toBe(0)
  })
})

describe('GET /api/workspaces/[id]/invitations', () => {
  it('lists pending invitations for owners, with no token or hash in sight', async () => {
    await inviteAsOwner('listed')
    await as(owner.id)
    const response = await listRoute(request('GET'), inWorkspace(workspaceId))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const { invitations } = (await response.json()) as { invitations: InvitationView[] }
    expect(invitations.map((i) => i.email)).toContain(email('listed'))
    expect(JSON.stringify(invitations)).not.toMatch(/tokenHash|\/invite\//)
  })

  it('refuses everyone but owners', async () => {
    for (const [who, userId, status] of NON_OWNERS()) {
      await as(userId)
      expect((await listRoute(request('GET'), inWorkspace(workspaceId))).status, who).toBe(status)
    }
  })
})

describe('POST /api/workspaces/[id]/invitations/[invitationId]/link', () => {
  it('gives an owner a new link and retires the old one', async () => {
    const created = await inviteAsOwner('reissue')
    await as(owner.id)
    const response = await linkRoute(request('POST'), onInvitation(workspaceId, created.invitation.id))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const fresh = (await response.json()) as InvitationLinkResult
    expect(fresh.link).not.toBe(created.link)
    expect(await resolveInvite(tokenOf(created.link), null)).toEqual({ kind: 'invalid' })
    expect((await resolveInvite(tokenOf(fresh.link), null)).kind).toBe('sign-in')
  })

  it('answers 404 for an invitation that does not exist', async () => {
    await as(owner.id)
    const response = await linkRoute(request('POST'), onInvitation(workspaceId, 'no-such-invitation'))
    expect(response.status).toBe(404)
  })

  it('refuses non-owners, and an owner of another workspace naming this invitation', async () => {
    const created = await inviteAsOwner('reissue-refused')
    for (const [who, userId, status] of NON_OWNERS()) {
      await as(userId)
      const response = await linkRoute(request('POST'), onInvitation(workspaceId, created.invitation.id))
      expect(response.status, who).toBe(status)
    }
    await as(stranger.id)
    const sideways = await linkRoute(request('POST'), onInvitation(strangerWorkspaceId, created.invitation.id))
    expect(sideways.status).toBe(404)
    // None of that touched the link.
    expect((await resolveInvite(tokenOf(created.link), null)).kind).toBe('sign-in')
  })
})

describe('DELETE /api/workspaces/[id]/invitations/[invitationId]', () => {
  it('lets an owner revoke, and the link stops working', async () => {
    const created = await inviteAsOwner('revoke')
    await as(owner.id)
    const response = await revokeRoute(request('DELETE'), onInvitation(workspaceId, created.invitation.id))
    expect(response.status).toBe(204)
    expect(await prisma.invitation.findUnique({ where: { id: created.invitation.id } })).toBeNull()
    expect(await resolveInvite(tokenOf(created.link), null)).toEqual({ kind: 'invalid' })
  })

  it('answers 404 for an invitation that does not exist', async () => {
    await as(owner.id)
    const response = await revokeRoute(request('DELETE'), onInvitation(workspaceId, 'no-such-invitation'))
    expect(response.status).toBe(404)
  })

  it('refuses non-owners, and an owner of another workspace naming this invitation', async () => {
    const created = await inviteAsOwner('revoke-refused')
    for (const [who, userId, status] of NON_OWNERS()) {
      await as(userId)
      const response = await revokeRoute(request('DELETE'), onInvitation(workspaceId, created.invitation.id))
      expect(response.status, who).toBe(status)
    }
    await as(stranger.id)
    const sideways = await revokeRoute(request('DELETE'), onInvitation(strangerWorkspaceId, created.invitation.id))
    expect(sideways.status).toBe(404)
    expect(await prisma.invitation.findUnique({ where: { id: created.invitation.id } })).not.toBeNull()
  })
})
