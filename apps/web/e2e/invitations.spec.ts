import { test, expect, type Browser, type Page } from '@playwright/test'
import { prisma } from '@crdt/db'
import { revokeInvitation } from '../src/lib/invitations.js'
import {
  addMember,
  cleanup,
  createDocument,
  documentPath,
  invite,
  seedWorkspace,
  sessionCookieFor,
  signIn,
} from './fixtures.js'

const LABEL = 'e2e-invite'
const INVALID = 'This invite link is no longer valid. Ask the person who shared it for a new one.'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('a signed-out visitor sees who invited them to what, and signs in back to the invite', async ({
  page,
}) => {
  const label = `${LABEL}-signedout`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const email = `${label}-new@e2e.test`
  const { link } = await invite({
    workspaceId: workspace.id,
    invitedById: owner.id,
    email,
    role: 'viewer',
    documentId: document.id,
  })

  const response = await page.goto(link)
  // A real header, not only the meta tag: the meta comes after the stylesheet and script
  // tags in the HTML, whose requests would already have carried the token in Referer.
  expect(response?.headers()['referrer-policy']).toBe('no-referrer')
  await expect(page.getByTestId('invite-summary')).toHaveText(
    `Owner invited you to view e2e doc in ${label}. Sign in as ${email} to open it.`,
  )
  for (const provider of ['github', 'google']) {
    await expect(page.getByTestId(`signin-${provider}`)).toHaveAttribute(
      'href',
      `/api/auth/oauth/${provider}?next=${encodeURIComponent(link)}`,
    )
  }
  // The metadata is the second layer.
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')

  await cleanup(label)
})

test('long names wrap inside the card instead of overflowing it', async ({ page }) => {
  // One unbroken word each, in the workspace name, the document title, the inviter's name
  // and (through the label) the invited email: the page must wrap them.
  const label = `${LABEL}-wrap-${'w'.repeat(120)}`
  const { owner, workspace } = await seedWorkspace(label)
  await prisma.user.update({ where: { id: owner.id }, data: { name: 'N'.repeat(120) } })
  const document = await prisma.document.create({
    data: { workspaceId: workspace.id, type: 'doc', title: 'T'.repeat(120) },
  })
  const email = `${label}-new@e2e.test`
  const { link } = await invite({
    workspaceId: workspace.id,
    invitedById: owner.id,
    email,
    role: 'editor',
    documentId: document.id,
  })

  const fitsInCard = (testId: string) =>
    page.evaluate((id) => {
      const lede = document.querySelector(`[data-testid="${id}"]`)!
      const card = lede.closest('main > div')!
      return {
        page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        card: card.scrollWidth <= card.clientWidth,
        lede: lede.scrollWidth <= lede.clientWidth,
      }
    }, testId)

  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(link)
  await expect(page.getByTestId('invite-summary')).toContainText('T'.repeat(120))
  expect(await fitsInCard('invite-summary')).toEqual({ page: true, card: true, lede: true })

  // The mismatch text holds two emails, one of them this long.
  const other = await seedWorkspace(`${label}-other`)
  await signIn(page, other.owner.id)
  await page.goto(link)
  await expect(page.getByTestId('invite-mismatch')).toContainText(email)
  expect(await fitsInCard('invite-mismatch')).toEqual({ page: true, card: true, lede: true })

  await cleanup(`${label}-other`)
  await cleanup(label)
})

test('the invited person lands in the document with the role they were invited with', async ({
  page,
}) => {
  const label = `${LABEL}-accept`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const email = `${label}-new@e2e.test`
  const { id, link } = await invite({
    workspaceId: workspace.id,
    invitedById: owner.id,
    email,
    role: 'viewer',
    documentId: document.id,
  })
  // Their first sign-in creates this row. The OAuth return trip through the link is
  // covered by oauth-routes.integration.test.ts; here the session already exists.
  const invitee = await prisma.user.create({ data: { email, name: 'Newcomer' } })
  await signIn(page, invitee.id)

  await page.goto(link)
  await expect(page).toHaveURL(documentPath(document))
  await expect(page.getByTestId('view-only')).toBeVisible()
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: invitee.id } },
  })
  expect(membership?.role).toBe('viewer')
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).acceptedAt).not.toBeNull()

  // Opening the used link again still takes them there.
  await page.goto(link)
  await expect(page).toHaveURL(documentPath(document))

  await cleanup(label)
})

test('someone signed in under another email is told who it is for, and can sign out', async ({
  page,
}) => {
  const label = `${LABEL}-mismatch`
  const { owner, workspace } = await seedWorkspace(label)
  const email = `${label}-new@e2e.test`
  const { id, link } = await invite({ workspaceId: workspace.id, invitedById: owner.id, email, role: 'editor' })
  const other = await seedWorkspace(`${label}-other`)
  await signIn(page, other.owner.id)

  await page.goto(link)
  await expect(page.getByTestId('invite-mismatch')).toHaveText(
    `This invite is for ${email}. You're signed in as ${other.owner.email}.`,
  )
  // Nothing was accepted for the wrong person.
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).acceptedAt).toBeNull()

  await page.getByTestId('invite-sign-out').click()
  // Signed out, on the same page, which now offers sign-in for the invited email.
  await expect(page.getByTestId('invite-summary')).toContainText(`Sign in as ${email}`)
  await expect(page).toHaveURL(link)
  expect((await page.context().cookies()).some((c) => c.name === 'crdt_session')).toBe(false)
  const stray = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: other.owner.id } },
  })
  expect(stray).toBeNull()

  await cleanup(label)
  await cleanup(`${label}-other`)
})

test('expired, revoked, used and unknown links all read the same, and name nothing', async ({ page }) => {
  const label = `${LABEL}-invalid`
  const { owner, workspace } = await seedWorkspace(label)
  // A name nothing else on the page says, so finding it there means the page leaked it.
  const inviterName = 'Zed Quillfeather'
  await prisma.user.update({ where: { id: owner.id }, data: { name: inviterName } })
  const base = { workspaceId: workspace.id, invitedById: owner.id, role: 'editor' as const }
  const emails = ['expired', 'revoked', 'used'].map((word) => `${label}-${word}@e2e.test`)
  const expired = await invite({ ...base, email: emails[0] })
  await prisma.invitation.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  })
  const revoked = await invite({ ...base, email: emails[1] })
  await revokeInvitation(workspace.id, revoked.id)
  const used = await invite({ ...base, email: emails[2] })
  await prisma.invitation.update({ where: { id: used.id }, data: { acceptedAt: new Date() } })

  for (const path of [expired.link, revoked.link, used.link, `/invite/${'A'.repeat(43)}`, '/invite/nonsense']) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    await expect(page.getByTestId('invite-invalid'), path).toHaveText(INVALID)
    // Nothing about the workspace, the inviter or the invited email, for a link that does
    // not work. (Every email here contains the label, so the first check covers them too;
    // the explicit ones keep this true if the labels ever change.)
    const body = page.locator('body')
    await expect(body, path).not.toContainText(label)
    await expect(body, path).not.toContainText(inviterName)
    for (const email of emails) await expect(body, path).not.toContainText(email)
    await expect(page.getByTestId('signin-github'), path).toHaveCount(0)
  }

  await cleanup(label)
})

test('a member invited again lands there and keeps their role', async ({ page }) => {
  const label = `${LABEL}-member`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const editor = await addMember(workspace.id, label, 'editor')
  const { id, link } = await invite({
    workspaceId: workspace.id,
    invitedById: owner.id,
    email: editor.email,
    role: 'viewer',
    documentId: document.id,
  })
  await signIn(page, editor.id)

  await page.goto(link)
  await expect(page).toHaveURL(documentPath(document))
  // Still an editor: no View only pill, and the row says so.
  await expect(page.getByTestId('view-only')).toHaveCount(0)
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: editor.id } },
  })
  expect(membership?.role).toBe('editor')
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).acceptedAt).not.toBeNull()

  await cleanup(label)
})

/**
 * On `path`, already signed in as an owner: opens the share sheet and invites `email`
 * with `role`. Returns the absolute link the sheet shows.
 */
async function inviteFromSheet(
  page: Page,
  path: string,
  email: string,
  role: 'viewer' | 'editor' | 'owner',
) {
  await page.goto(path)
  await page.getByTestId('share').click()
  const sheet = page.getByTestId('sheet')
  await sheet.getByTestId('member-email').fill(email)
  await sheet.getByTestId('member-role').selectOption(role)
  await sheet.getByTestId('add-member').click()
  const field = sheet.getByTestId('invite-link')
  await expect(field).toHaveValue(/\/invite\/[A-Za-z0-9_-]{43}$/)
  return field.inputValue()
}

/** A signed-out browser of its own, for opening a link as a stranger would. */
async function visitSignedOut(browser: Browser, url: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(url)
  return { context, page }
}

test('an owner invites someone new from a document, copies the link, and it opens that document', async ({
  page,
  browser,
}) => {
  const label = `${LABEL}-sheet`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const email = `${label}-new@e2e.test`
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await signIn(page, owner.id)

  // Typed in capitals: it is stored, listed and matched lowercased.
  const url = await inviteFromSheet(page, documentPath(document), email.toUpperCase(), 'viewer')
  const sheet = page.getByTestId('sheet')
  expect(new URL(url).origin).toBe('http://localhost:3000')
  await expect(page.getByTestId('toast').filter({ hasText: `Invite link created for ${email}` })).toBeVisible()
  await expect(sheet.getByTestId('member-error')).toHaveCount(0)

  await sheet.getByTestId('invite-link-copy').click()
  await expect(page.getByTestId('toast').filter({ hasText: 'Link copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url)

  // The invitation remembers the document the sheet was opened from.
  const row = await prisma.invitation.findUniqueOrThrow({
    where: { workspaceId_email: { workspaceId: workspace.id, email } },
  })
  expect(row.documentId).toBe(document.id)
  await expect(sheet.getByTestId(`invited-${row.id}`)).toContainText(email)
  await expect(sheet.getByTestId(`invited-${row.id}`)).toContainText('Can view')

  // The person it was for opens it in a browser of their own.
  const invitee = await prisma.user.create({ data: { email, name: 'Newcomer' } })
  const context = await browser.newContext()
  await context.addCookies([await sessionCookieFor(invitee.id)])
  const theirs = await context.newPage()
  await theirs.goto(url)
  await expect(theirs).toHaveURL(documentPath(document))
  await expect(theirs.getByTestId('view-only')).toBeVisible()
  await context.close()

  await cleanup(label)
})

test('inviting the same email again kills the old link', async ({ page, browser }) => {
  const label = `${LABEL}-reinvite`
  const { owner, workspace } = await seedWorkspace(label)
  const email = `${label}-new@e2e.test`
  await signIn(page, owner.id)

  const first = await inviteFromSheet(page, `/workspaces/${workspace.id}`, email, 'viewer')
  const sheet = page.getByTestId('sheet')
  await sheet.getByTestId('member-email').fill(email)
  await sheet.getByTestId('member-role').selectOption('editor')
  await sheet.getByTestId('add-member').click()
  await expect(sheet.getByTestId('invite-link')).not.toHaveValue(first)
  const second = await sheet.getByTestId('invite-link').inputValue()
  await expect(
    page.getByTestId('toast').filter({ hasText: `New invite link for ${email}. The old link no longer works.` }),
  ).toBeVisible()
  // One invitation, replaced in place, now Can edit.
  expect(await prisma.invitation.count({ where: { workspaceId: workspace.id, email } })).toBe(1)
  const row = await prisma.invitation.findUniqueOrThrow({
    where: { workspaceId_email: { workspaceId: workspace.id, email } },
  })
  await expect(sheet.getByTestId(`invited-${row.id}`)).toContainText('Can edit')

  const old = await visitSignedOut(browser, first)
  await expect(old.page.getByTestId('invite-invalid')).toHaveText(INVALID)
  await old.page.goto(second)
  await expect(old.page.getByTestId('invite-summary')).toContainText('invited you to edit')
  await old.context.close()

  await cleanup(label)
})

test('Copy link in the Invited list makes a new link and retires the old one', async ({ page, browser }) => {
  const label = `${LABEL}-recopy`
  const { owner, workspace } = await seedWorkspace(label)
  const email = `${label}-new@e2e.test`
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await signIn(page, owner.id)

  const first = await inviteFromSheet(page, `/workspaces/${workspace.id}`, email, 'editor')
  const sheet = page.getByTestId('sheet')
  const row = await prisma.invitation.findUniqueOrThrow({
    where: { workspaceId_email: { workspaceId: workspace.id, email } },
  })
  // Said before anyone clicks, not only after.
  await expect(sheet.getByTestId('invited-list')).toContainText('earlier links for them stop working')

  await sheet.getByTestId(`invited-copy-${row.id}`).click()
  await expect(sheet.getByTestId('invite-link')).not.toHaveValue(first)
  const second = await sheet.getByTestId('invite-link').inputValue()
  await expect(
    page.getByTestId('toast').filter({ hasText: `New link copied for ${email}. The old link no longer works.` }),
  ).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(second)

  const visitor = await visitSignedOut(browser, first)
  await expect(visitor.page.getByTestId('invite-invalid')).toHaveText(INVALID)
  await visitor.page.goto(second)
  await expect(visitor.page.getByTestId('invite-summary')).toBeVisible()
  await visitor.context.close()

  await cleanup(label)
})

test('revoking an invite removes it and kills its link', async ({ page, browser }) => {
  const label = `${LABEL}-revoke`
  const { owner, workspace } = await seedWorkspace(label)
  const email = `${label}-new@e2e.test`
  await signIn(page, owner.id)

  const url = await inviteFromSheet(page, `/workspaces/${workspace.id}`, email, 'viewer')
  const sheet = page.getByTestId('sheet')
  const row = await prisma.invitation.findUniqueOrThrow({
    where: { workspaceId_email: { workspaceId: workspace.id, email } },
  })

  await sheet.getByTestId(`invited-revoke-${row.id}`).click()
  await expect(page.getByTestId('toast').filter({ hasText: `Invite for ${email} revoked` })).toBeVisible()
  await expect(sheet.getByTestId(`invited-${row.id}`)).toHaveCount(0)
  // The link on screen was that invitation's, so it goes too.
  await expect(sheet.getByTestId('invite-link-panel')).toHaveCount(0)
  expect(await prisma.invitation.findUnique({ where: { id: row.id } })).toBeNull()

  const visitor = await visitSignedOut(browser, url)
  await expect(visitor.page.getByTestId('invite-invalid')).toHaveText(INVALID)
  await visitor.context.close()

  await cleanup(label)
})

test('non-owners see no invite controls or pending invites, and the API refuses them', async ({ page }) => {
  const label = `${LABEL}-nonowner`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const viewer = await addMember(workspace.id, label, 'viewer')
  const pendingEmail = `${label}-pending@e2e.test`
  const pending = await invite({ workspaceId: workspace.id, invitedById: owner.id, email: pendingEmail, role: 'editor' })

  const asked: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/invitations')) asked.push(request.url())
  })

  // Positive control: an owner's sheet does ask, and does list it. Without this, a sheet
  // that never fetched would pass every check below.
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)
  await page.getByTestId('share').click()
  await expect(page.getByTestId('invited-list')).toContainText(pendingEmail)
  expect(asked.length).toBeGreaterThan(0)

  for (const member of [editor, viewer]) {
    await page.context().clearCookies()
    await signIn(page, member.id)
    asked.length = 0
    await page.goto(`/workspaces/${workspace.id}`)
    await page.getByTestId('share').click()
    await expect(page.getByTestId('sheet')).toBeVisible()
    await page.waitForLoadState('networkidle')

    await expect(page.getByTestId('member-email')).toHaveCount(0)
    await expect(page.getByTestId('invited-list')).toHaveCount(0)
    await expect(page.getByTestId('sheet')).not.toContainText(pendingEmail)
    expect(asked, member.email).toEqual([])

    // And the API refuses them directly.
    const api = `/api/workspaces/${workspace.id}`
    expect((await page.request.get(`${api}/invitations`)).status(), member.email).toBe(403)
    expect(
      (await page.request.post(`${api}/members`, { data: { email: `${label}-sneaky@e2e.test`, role: 'owner' } })).status(),
      member.email,
    ).toBe(403)
    expect((await page.request.post(`${api}/invitations/${pending.id}/link`)).status(), member.email).toBe(403)
    expect((await page.request.delete(`${api}/invitations/${pending.id}`)).status(), member.email).toBe(403)
  }
  expect(await prisma.invitation.count({ where: { workspaceId: workspace.id } })).toBe(1)

  await cleanup(label)
})
