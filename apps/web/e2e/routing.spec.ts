import { test, expect } from '@playwright/test'
import { cleanup, createDocument, documentPath, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-routing'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('the old flat document URL forwards to the canonical one', async ({ page }) => {
  const label = `${LABEL}-legacy`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(`/documents/${document.id}`)
  await expect(page).toHaveURL(documentPath(document))
  await expect(page.getByTestId(`tab-${document.id}`)).toHaveAttribute('data-active', 'true')

  await cleanup(label)
})

test('a document id under the wrong workspace is not found', async ({ page }) => {
  const mine = `${LABEL}-mine`
  const theirs = `${LABEL}-theirs`
  const { owner, workspace } = await seedWorkspace(mine)
  const other = await seedWorkspace(theirs)
  const strayDocument = await createDocument(other.workspace.id, 'doc')
  await signIn(page, owner.id)

  // A real document id, a workspace the signed-in user really owns, and no
  // relationship between them. Without the pairing check this renders someone
  // else's document under this workspace's nav and tab strip.
  const response = await page.goto(`/workspaces/${workspace.id}/documents/${strayDocument.id}`)
  expect(response?.status()).toBe(404)

  await cleanup(mine)
  await cleanup(theirs)
})

test('a signed-out visit to a canonical document URL carries that URL to sign-in', async ({
  page,
}) => {
  const label = `${LABEL}-signedout`
  const { workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')

  await page.goto(documentPath(document))
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(documentPath(document))}`)

  await cleanup(label)
})

test('the active tab is marked in the server HTML, not by hydration', async ({ page }) => {
  const label = `${LABEL}-ssr`
  const { owner, workspace } = await seedWorkspace(label)
  const open = await createDocument(workspace.id, 'doc')
  const other = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)

  // The raw response, never hydrated. usePathname() has to resolve during the
  // server render for this to hold; if it does not, the tab's active attributes
  // appear only after JS runs, React logs an attribute mismatch, and aria-current
  // is missing for anyone reading the page before hydration.
  const response = await page.request.get(documentPath(open))
  const html = await response.text()

  const openTag = new RegExp(`<a[^>]*data-testid="tab-${open.id}"[^>]*>`).exec(html)?.[0] ?? ''
  expect(openTag).not.toBe('')
  expect(openTag).toContain('aria-current="page"')
  expect(openTag).toContain('data-active="true"')

  // The other half: attributes rendered on every tab would pass the above.
  const otherTag = new RegExp(`<a[^>]*data-testid="tab-${other.id}"[^>]*>`).exec(html)?.[0] ?? ''
  expect(otherTag).not.toBe('')
  expect(otherTag).not.toContain('aria-current')
  expect(otherTag).toContain('data-active="false"')

  await cleanup(label)
})
