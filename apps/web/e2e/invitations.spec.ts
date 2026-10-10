import { test, expect } from '@playwright/test'
import { prisma } from '@crdt/db'
import { revokeInvitation } from '../src/lib/invitations.js'
import {
  addMember,
  cleanup,
  createDocument,
  documentPath,
  invite,
  seedWorkspace,
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

  await page.goto(link)
  await expect(page.getByTestId('invite-summary')).toHaveText(
    `Owner invited you to view e2e doc in ${label}. Sign in as ${email} to open it.`,
  )
  for (const provider of ['github', 'google']) {
    await expect(page.getByTestId(`signin-${provider}`)).toHaveAttribute(
      'href',
      `/api/auth/oauth/${provider}?next=${encodeURIComponent(link)}`,
    )
  }
  // The token is in this page's URL. No referrer, so no Referer header ever carries it.
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

  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(link)
  const summary = page.getByTestId('invite-summary')
  await expect(summary).toContainText('T'.repeat(120))
  const fits = await page.evaluate(() => {
    const lede = document.querySelector('[data-testid="invite-summary"]')!
    const card = lede.closest('main > div')!
    return {
      page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      card: card.scrollWidth <= card.clientWidth,
      lede: lede.scrollWidth <= lede.clientWidth,
    }
  })
  expect(fits).toEqual({ page: true, card: true, lede: true })

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
  const base = { workspaceId: workspace.id, invitedById: owner.id, role: 'editor' as const }
  const expired = await invite({ ...base, email: `${label}-expired@e2e.test` })
  await prisma.invitation.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  })
  const revoked = await invite({ ...base, email: `${label}-revoked@e2e.test` })
  await revokeInvitation(workspace.id, revoked.id)
  const used = await invite({ ...base, email: `${label}-used@e2e.test` })
  await prisma.invitation.update({ where: { id: used.id }, data: { acceptedAt: new Date() } })

  for (const path of [expired.link, revoked.link, used.link, `/invite/${'A'.repeat(43)}`, '/invite/nonsense']) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    await expect(page.getByTestId('invite-invalid'), path).toHaveText(INVALID)
    // Nothing about the workspace or the inviter, for a link that does not work.
    await expect(page.locator('body'), path).not.toContainText(label)
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
