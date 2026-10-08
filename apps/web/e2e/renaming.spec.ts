import { test, expect, type Page } from '@playwright/test'
import { prisma } from '@crdt/db'
import { addMember, cleanup, createDocument, documentPath, seedWorkspace, sessionCookieFor, signIn } from './fixtures.js'

const LABEL = 'e2e-rename'
test.afterAll(async () => {
  await cleanup(LABEL)
})

async function open(page: Page, label: string, type: 'doc' | 'board') {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, type)
  await signIn(page, owner.id)
  await page.goto(documentPath(document))
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  return { owner, workspace, document }
}

test('a document is renamed from its own title, and the nav tab follows', async ({ page }) => {
  const { document } = await open(page, `${LABEL}-doc`, 'doc')
  const title = page.getByTestId('document-title')
  await expect(title).toHaveValue('e2e doc')

  await title.fill('Quarterly plan')
  await title.press('Enter')
  await expect(page.getByTestId(`tab-${document.id}`)).toContainText('Quarterly plan')
  await page.reload()
  await expect(page.getByTestId('document-title')).toHaveValue('Quarterly plan')
})

test('a board is renamed from inside the board', async ({ page }) => {
  const { document } = await open(page, `${LABEL}-board`, 'board')
  const title = page.getByTestId('document-title')
  await expect(title).toBeVisible()
  await title.fill('Sprint board')
  await title.press('Enter')
  await expect(page.getByTestId(`tab-${document.id}`)).toContainText('Sprint board')
})

test('Escape and an empty title put the name back and save nothing', async ({ page }) => {
  await open(page, `${LABEL}-revert`, 'doc')
  const title = page.getByTestId('document-title')
  await title.fill('Not this')
  await title.press('Escape')
  await expect(title).toHaveValue('e2e doc')
  await title.fill('  ')
  await title.press('Enter')
  await expect(title).toHaveValue('e2e doc')
  await page.reload()
  await expect(page.getByTestId('document-title')).toHaveValue('e2e doc')
})

test('focusing the title and leaving it without typing saves nothing', async ({ page }) => {
  await open(page, `${LABEL}-untouched`, 'doc')
  const patches: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/api/documents/')) patches.push(request.url())
  })
  const title = page.getByTestId('document-title')
  await title.focus()
  await title.press('Tab')
  await expect(title).not.toBeFocused()
  // Give a wrongly-sent request time to appear before asserting it did not.
  await page.waitForTimeout(500)
  expect(patches).toEqual([])
  await expect(title).toHaveValue('e2e doc')
})

// The case the plain focus-and-leave test above cannot reach: the saved title changes
// while the field is focused (a peer's rename arriving through a refresh). The field
// must keep what is on screen while it is in use, and leaving it untouched must not
// write that stale text back over the newer title.
test('a title changed elsewhere while the field is focused is not overwritten on leaving', async ({ page }) => {
  const { document } = await open(page, `${LABEL}-stale`, 'doc')
  const patches: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/api/documents/')) patches.push(request.url())
  })
  const title = page.getByTestId('document-title')
  await title.focus()

  // A rename that did not come from this field, then a refresh of the server components.
  await prisma.document.update({ where: { id: document.id }, data: { title: 'Renamed by a peer' } })
  await page.evaluate(() => (window as unknown as { next: { router: { refresh(): void } } }).next.router.refresh())
  await expect(page.getByTestId(`tab-${document.id}`)).toContainText('Renamed by a peer')

  // Still focused, so the field has not been replaced under the cursor.
  await expect(title).toBeFocused()
  await expect(title).toHaveValue('e2e doc')

  // Leaving it untouched takes the new title and sends nothing.
  await title.press('Tab')
  await expect(title).toHaveValue('Renamed by a peer')
  await page.waitForTimeout(500)
  expect(patches).toEqual([])
  const row = await prisma.document.findUniqueOrThrow({ where: { id: document.id } })
  expect(row.title).toBe('Renamed by a peer')
})

test('a document is renamed from its tile on the workspace overview', async ({ page }) => {
  const { owner, workspace } = await seedWorkspace(`${LABEL}-tile`)
  const document = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)

  await page.getByTestId(`rename-${document.id}`).click()
  const field = page.getByTestId(`tile-title-${document.id}`)
  await expect(field).toBeFocused()
  await field.fill('Roadmap')
  await field.press('Enter')
  await expect(page.getByTestId(`document-${document.id}`)).toContainText('Roadmap')
  await expect(page.getByTestId(`tab-${document.id}`)).toContainText('Roadmap')
})

test('a viewer sees the title as text and no rename control', async ({ browser }) => {
  const label = `${LABEL}-viewer`
  const { workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')
  const context = await browser.newContext()
  await context.addCookies([await sessionCookieFor(viewer.id)])
  const page = await context.newPage()

  await page.goto(documentPath(document))
  await expect(page.getByTestId('document-heading')).toHaveText('e2e doc')
  await expect(page.getByTestId('document-title')).toHaveCount(0)
  await page.goto(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId(`rename-${document.id}`)).toHaveCount(0)
  await context.close()
})
