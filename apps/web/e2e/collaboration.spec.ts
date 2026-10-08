import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  addMember,
  cleanup,
  createDocument,
  documentPath,
  seedWorkspace,
  sessionCookieFor,
} from './fixtures.js'

const LABEL = 'e2e-collab'

test.afterAll(async () => {
  await cleanup(LABEL)
})

// Identity is read from the accessible name, not a testid: two people can share a display
// name, and the name is what a screen reader announces.
function avatar(page: Page, name: string) {
  return page.getByTestId('presence').getByRole('img', { name })
}

async function openAs(
  context: BrowserContext,
  userId: string,
  path: string,
): Promise<Page> {
  await context.addCookies([await sessionCookieFor(userId)])
  const page = await context.newPage()
  // ?nobc=1 forces this tab to sync through the server rather than BroadcastChannel.
  await page.goto(`${path}?nobc=1`)
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  return page
}

test('a card added in one browser appears in the other', async ({ browser }) => {
  const { owner, workspace } = await seedWorkspace(LABEL)
  const editor = await addMember(workspace.id, LABEL, 'editor')
  const document = await createDocument(workspace.id, 'board')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, documentPath(document))
  const pageB = await openAs(contextB, editor.id, documentPath(document))

  await pageA.getByTestId('add-column').click()
  await expect(pageB.locator('[data-testid^="column-"]')).toHaveCount(1)

  const columnId = await pageB
    .locator('[data-testid^="column-"]')
    .first()
    .getAttribute('data-testid')
  await pageA.getByTestId(`add-card-${columnId!.replace('column-', '')}`).click()

  await expect(pageB.locator('[data-testid^="card-"]')).toHaveCount(1)
  await expect(pageB.locator('[data-testid^="card-"]').first()).toContainText('New card')

  await contextA.close()
  await contextB.close()
})

test('a viewer sees edits but cannot make them', async ({ browser }) => {
  const label = `${LABEL}-viewer`
  const { owner, workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'board')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const editorPage = await openAs(contextA, owner.id, documentPath(document))
  const viewerPage = await openAs(contextB, viewer.id, documentPath(document))

  await expect(viewerPage.getByTestId('view-only')).toBeVisible()
  await expect(viewerPage.getByTestId('add-column')).toHaveCount(0)

  await editorPage.getByTestId('add-column').click()
  await expect(viewerPage.locator('[data-testid^="column-"]')).toHaveCount(1)

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})

test('both users see each other in the presence bar', async ({ browser }) => {
  const label = `${LABEL}-presence`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'board')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, documentPath(document))
  const pageB = await openAs(contextB, editor.id, documentPath(document))

  await expect(avatar(pageA, 'Eddie')).toBeVisible()
  // The group holds you and the other person, in each browser.
  await expect(pageA.getByTestId('presence').locator('[role="img"]')).toHaveCount(2)
  await expect(pageB.getByTestId('presence').locator('[role="img"]')).toHaveCount(2)
  // The count includes you. Two browsers are open, so it says two, not one.
  await expect(pageA.getByTestId('status')).toHaveText('2 here')

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})

test('the nav shows who else is here and the active tab carries a dot', async ({ browser }) => {
  const label = `${LABEL}-nav-presence`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, documentPath(document))

  // Alone: only you in the group, and no dot. A dot that always rendered would pass the
  // check below, so assert its absence first.
  await expect(pageA.getByTestId('presence-self')).toBeVisible()
  await expect(pageA.getByTestId('presence').locator('[role="img"]')).toHaveCount(1)
  await expect(pageA.getByTestId(`tab-dot-${document.id}`)).toHaveCount(0)

  const pageB = await openAs(contextB, editor.id, documentPath(document))

  // The second user's nav shows the first user, by name, inside the nav.
  const ownerAvatar = pageB.getByRole('navigation', { name: 'Primary' }).getByRole('img', { name: 'Owner' })
  await expect(ownerAvatar).toBeVisible()
  await expect(ownerAvatar).toHaveAttribute('title', 'Owner')
  await expect(ownerAvatar).toHaveAccessibleName('Owner')
  await expect(ownerAvatar).toHaveText('O')
  await expect(pageB.getByTestId(`tab-dot-${document.id}`)).toBeVisible()
  await expect(pageB.getByTestId(`tab-${document.id}`).getByTestId(`tab-dot-${document.id}`)).toHaveCount(1)

  // And the first sees the second.
  await expect(avatar(pageA, 'Eddie')).toBeVisible()
  await expect(pageA.getByTestId(`tab-dot-${document.id}`)).toBeVisible()

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})

test('the avatar and the dot go when the other person leaves', async ({ browser }) => {
  const label = `${LABEL}-nav-leave`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, documentPath(document))
  await openAs(contextB, editor.id, documentPath(document))
  await expect(avatar(pageA, 'Eddie')).toBeVisible()
  await expect(pageA.getByTestId(`tab-dot-${document.id}`)).toBeVisible()

  await contextB.close()

  await expect(avatar(pageA, 'Eddie')).toHaveCount(0)
  // Only you are left in the group.
  await expect(pageA.getByTestId('presence').locator('[role="img"]')).toHaveCount(1)
  await expect(pageA.getByTestId('presence-self')).toBeVisible()
  await expect(pageA.getByTestId(`tab-dot-${document.id}`)).toHaveCount(0)

  await contextA.close()
  await cleanup(label)
})

test('navigating away client-side clears the nav status and presence', async ({ browser }) => {
  const label = `${LABEL}-nav-away`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, documentPath(document))
  await openAs(contextB, editor.id, documentPath(document))
  await expect(avatar(pageA, 'Eddie')).toBeVisible()
  await expect(pageA.getByTestId('status')).toBeVisible()

  // A full page load resets the module-level store whatever the code does, so
  // page.goto cannot test the clear on unmount. This marker lives on the window and
  // does not survive a reload: finding it afterwards proves the move was client-side.
  await pageA.evaluate(() => {
    ;(window as unknown as { __clientNav: boolean }).__clientNav = true
  })

  await pageA.keyboard.press('Control+k')
  await expect(pageA.getByTestId('palette')).toBeVisible()
  await pageA.getByTestId('palette-input').fill('All workspaces')
  await pageA.keyboard.press('Enter')

  await expect(pageA).toHaveURL(/\/$/)
  expect(
    await pageA.evaluate(() => (window as unknown as { __clientNav?: boolean }).__clientNav),
  ).toBe(true)

  // The other person is still in the document. The pill and the avatars must go
  // because this tab left, not because anyone else did.
  await expect(pageA.getByTestId('status')).toHaveCount(0)
  await expect(pageA.getByTestId('presence')).toHaveCount(0)

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})

test('below 1100px the avatars and the status label stay available to assistive tech', async ({
  browser,
}) => {
  const label = `${LABEL}-nav-narrow`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  const contextA = await browser.newContext({ viewport: { width: 1000, height: 800 } })
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, documentPath(document))
  await openAs(contextB, editor.id, documentPath(document))

  // Found by role and name, which excludes display:none. Clipped, not removed.
  await expect(pageA.getByRole('img', { name: 'Eddie' })).toHaveCount(1)
  const avatars = await pageA.getByTestId('presence').boundingBox()
  expect(avatars!.width).toBeLessThanOrEqual(1)

  // boundingBox is null for display:none, so a box proves the label is still rendered.
  const labelBox = await pageA.getByTestId('status').getByText('2 here').boundingBox()
  expect(labelBox).not.toBeNull()
  expect(labelBox!.width).toBeLessThanOrEqual(1)

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})

test('text typed while offline merges on reconnect', async ({ browser }) => {
  const label = `${LABEL}-offline`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, documentPath(document))
  const pageB = await openAs(contextB, editor.id, documentPath(document))

  await pageA.locator('.ProseMirror').click()
  await pageA.keyboard.type('online-a ')
  await expect(pageB.locator('.ProseMirror')).toContainText('online-a')

  // setOffline cuts network traffic at the browser level immediately. The status badge
  // only reflects that transiently: y-websocket has no active close-on-offline behavior,
  // so 'disconnected' only appears for an instant when its ~30s dead-peer timer fires,
  // before it immediately retries and flips back to 'connecting'. Waiting for that value
  // is a race against Playwright's own poll interval, not a real signal — what this test
  // needs to prove is that edits made while genuinely offline merge on reconnect, which
  // doesn't depend on what the status badge shows at any instant. A short fixed wait
  // gives any already-in-flight frame time to settle before typing.
  await contextB.setOffline(true)
  await pageB.waitForTimeout(300)
  await pageB.locator('.ProseMirror').click()
  await pageB.keyboard.type('offline-b ')
  await pageA.locator('.ProseMirror').click()
  await pageA.keyboard.type('while-b-was-away ')

  await contextB.setOffline(false)

  await expect(pageA.locator('.ProseMirror')).toContainText('offline-b')
  await expect(pageB.locator('.ProseMirror')).toContainText('while-b-was-away')

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})
