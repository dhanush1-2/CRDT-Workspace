import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import {
  addMember,
  cleanup,
  createDocument,
  documentPath,
  seedWorkspace,
  sessionCookieFor,
  signIn,
} from './fixtures.js'

const LABEL = 'e2e-board'

test.afterAll(async () => {
  await cleanup(LABEL)
})

/** Opens a fresh board with `columns` empty columns; returns the page and the column ids. */
async function openBoard(page: Page, label: string, columns: number) {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)
  await page.goto(documentPath(document))
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')

  for (let i = 1; i <= columns; i++) {
    await page.getByTestId('add-column').click()
    await expect(page.locator('[data-testid^="column-"]')).toHaveCount(i)
  }
  const testIds = await page
    .locator('[data-testid^="column-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!))
  return testIds.map((testId) => testId.replace('column-', ''))
}

/** Adds a card to the column and returns its id once it has rendered. */
async function addCard(page: Page, columnId: string) {
  const column = page.getByTestId(`column-${columnId}`)
  const before = await column.locator('[data-testid^="card-"]').count()
  await page.getByTestId(`add-card-${columnId}`).click()
  await expect(column.locator('[data-testid^="card-"]')).toHaveCount(before + 1)
  const testId = await column
    .locator('[data-testid^="card-"]')
    .nth(before)
    .getAttribute('data-testid')
  return testId!.replace('card-', '')
}

/** Card ids in a column, top to bottom as rendered. */
async function cardOrder(page: Page, columnId: string) {
  const testIds = await page
    .getByTestId(`column-${columnId}`)
    .locator('[data-testid^="card-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!))
  return testIds.map((testId) => testId.replace('card-', ''))
}

/**
 * Drags `source` onto `target` with real pointer input. Chromium turns the mouse
 * gesture into genuine dragstart/dragover/drop events sharing one DataTransfer,
 * so the component's own application/x-card payload travels end to end.
 */
async function drag(source: Locator, target: Locator) {
  await source.dragTo(target)
}

test('a card dragged onto another column moves there', async ({ page }) => {
  const label = `${LABEL}-move`
  const [first, second] = await openBoard(page, label, 2)
  const cardId = await addCard(page, first!)
  const card = page.getByTestId(`card-${cardId}`)
  await expect(card).toHaveAttribute('data-column', first!)

  await drag(card, page.getByTestId(`column-${second}`))

  // data-column is rendered from the Yjs doc, so it only changes if the move was
  // actually written there. A card that merely looked moved would keep the old id.
  await expect(card).toHaveAttribute('data-column', second!)
  await expect(page.getByTestId(`column-${second}`).getByTestId(`card-${cardId}`)).toHaveCount(1)
  await expect(page.getByTestId(`column-${first}`).locator('[data-testid^="card-"]')).toHaveCount(0)

  await cleanup(label)
})

test('a card dropped onto a sibling reorders within its column', async ({ page }) => {
  const label = `${LABEL}-reorder`
  const [column] = await openBoard(page, label, 1)
  const top = await addCard(page, column!)
  const bottom = await addCard(page, column!)
  expect(await cardOrder(page, column!)).toEqual([top, bottom])

  // Dropping on a card passes its id as beforeCardId, a different path from
  // dropping on the column body: the dragged card lands ahead of the target.
  await drag(page.getByTestId(`card-${bottom}`), page.getByTestId(`card-${top}`))

  await expect.poll(() => cardOrder(page, column!)).toEqual([bottom, top])
  // Still one column: a reorder must not change the card's column.
  await expect(page.getByTestId(`card-${bottom}`)).toHaveAttribute('data-column', column!)

  await cleanup(label)
})

test('a card is not left dimmed after a completed drop', async ({ page }) => {
  const label = `${LABEL}-stuck`
  const [first, second] = await openBoard(page, label, 2)
  const cardId = await addCard(page, first!)
  const card = page.getByTestId(`card-${cardId}`)

  await drag(card, page.getByTestId(`column-${second}`))
  await expect(card).toHaveAttribute('data-column', second!)

  // The dragging class sets opacity 0.4. Its name is hashed by CSS Modules, so
  // matching it would pin a build detail; the computed opacity is what the user
  // sees. Polled, because the card remounts under its new column and its entry
  // animation can still be running for a moment.
  await expect
    .poll(() => card.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('1')

  await cleanup(label)
})

test('the column count chip reflects the number of cards', async ({ page }) => {
  const label = `${LABEL}-count`
  const [column] = await openBoard(page, label, 1)
  const count = page.getByTestId(`column-${column}`).locator('[data-testid^="col-title-"] + span')

  await expect(count).toHaveText('0')
  await addCard(page, column!)
  await addCard(page, column!)
  await expect(count).toHaveText('2')

  await cleanup(label)
})

test('a remote peer on a card gets the ring and a named chip', async ({ browser }) => {
  const label = `${LABEL}-peer`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'board')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  await contextA.addCookies([await sessionCookieFor(owner.id)])
  await contextB.addCookies([await sessionCookieFor(editor.id)])
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  // ?nobc=1 forces both tabs to sync through the server rather than BroadcastChannel.
  for (const page of [pageA, pageB]) {
    await page.goto(`${documentPath(document)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  }

  await pageA.getByTestId('add-column').click()
  await expect(pageB.locator('[data-testid^="column-"]')).toHaveCount(1)
  const columnId = (
    await pageB.locator('[data-testid^="column-"]').first().getAttribute('data-testid')
  )!.replace('column-', '')
  const cardId = await addCard(pageA, columnId)
  await expect(pageB.getByTestId(`card-${cardId}`)).toHaveCount(1)

  await pageA.getByTestId(`card-${cardId}`).hover()

  // The chip carries the peer's name as text, so presence is never colour alone.
  const chip = pageB.getByTestId(`card-presence-${cardId}`)
  await expect(chip).toBeVisible()
  await expect(chip).toContainText('Owner')

  // The ring is a box-shadow; its class name is hashed by CSS Modules, so read
  // the computed value. The card also transitions box-shadow, hence the poll.
  await expect
    .poll(() =>
      pageB.getByTestId(`card-${cardId}`).evaluate((el) => getComputedStyle(el).boxShadow),
    )
    .toContain('rgb(14, 165, 233)')

  // The viewer's own page must not ring the card it is hovering: only remote peers do.
  expect(
    await pageA.getByTestId(`card-${cardId}`).evaluate((el) => getComputedStyle(el).boxShadow),
  ).not.toContain('rgb(14, 165, 233)')

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})

test('the column under the pointer shows the accent outline while a card is dragged', async ({
  page,
}) => {
  const label = `${LABEL}-dragover`
  const [from, to] = await openBoard(page, label, 2)
  await addCard(page, from!)
  const card = page.getByTestId(`column-${from}`).locator('[data-testid^="card-"]').first()
  const target = page.getByTestId(`column-${to}`)

  const shadow = () => target.evaluate((el) => getComputedStyle(el).boxShadow)
  // The accent as the browser serialises it in a computed box-shadow.
  const ACCENT_INSET = 'oklch(0.42 0.11 285) 0px 0px 0px 2px inset'

  // Resting: no outline. Without this the assertion below could pass on a column
  // that always had one.
  expect(await shadow()).not.toContain(ACCENT_INSET)

  // Held mid-drag. dragTo() completes atomically and never exposes this state,
  // which is why nothing in this suite covered it: the design owner reported the
  // outline as missing and it was only ever untriggered.
  const source = (await card.boundingBox())!
  const box = (await target.boundingBox())!
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 15 })
  await page.mouse.move(box.x + box.width / 2, box.y + 45, { steps: 5 })

  expect(await shadow()).toContain(ACCENT_INSET)

  await page.mouse.up()

  // And it goes again, so the outline tracks the drag rather than latching on.
  await expect.poll(shadow).not.toContain(ACCENT_INSET)

  await cleanup(label)
})

test('a column is renamed in place, and the new name reaches a second browser', async ({
  page,
  browser,
}) => {
  const label = `${LABEL}-rename-col`
  const [columnId] = await openBoard(page, label, 1)
  const title = page.getByTestId(`col-title-${columnId}`)
  await expect(title).toHaveValue('New column')

  await title.click()
  await title.fill('Backlog')
  await title.press('Enter')
  await expect(title).toHaveValue('Backlog')
  await expect(title).not.toBeFocused()

  // Live through the CRDT: a second browser on the same board sees it without reloading.
  const url = page.url()
  const context = await browser.newContext()
  await context.addCookies(await page.context().cookies())
  const other = await context.newPage()
  await other.goto(`${url}?nobc=1`)
  await expect(other.getByTestId(`col-title-${columnId}`)).toHaveValue('Backlog')
  await page.getByTestId(`col-title-${columnId}`).fill('Done')
  await page.getByTestId(`col-title-${columnId}`).press('Enter')
  await expect(other.getByTestId(`col-title-${columnId}`)).toHaveValue('Done')
  await context.close()

  await cleanup(label)
})

test('Escape puts the column title back, and does not poison the next edit', async ({ page }) => {
  const label = `${LABEL}-rename-escape`
  const [columnId] = await openBoard(page, label, 1)
  const title = page.getByTestId(`col-title-${columnId}`)

  await title.fill('Something')
  await title.press('Escape')
  await expect(title).toHaveValue('New column')

  // A leaked Escape would revert this save as well. A whitespace name could not tell the
  // two apart, since the empty-name guard reverts it either way.
  await title.fill('Real')
  await title.press('Enter')
  await expect(title).toHaveValue('Real')
  await page.getByTestId('add-column').focus()
  await expect(title).toHaveValue('Real')

  await cleanup(label)
})

test('an empty column name puts the title back', async ({ page }) => {
  const label = `${LABEL}-rename-empty`
  const [columnId] = await openBoard(page, label, 1)
  const title = page.getByTestId(`col-title-${columnId}`)

  await title.fill('   ')
  await title.press('Enter')
  await expect(title).toHaveValue('New column')

  await cleanup(label)
})

/** A second browser, signed in as the same owner, on the same board. */
async function openPeer(page: Page, browser: Browser) {
  const context = await browser.newContext()
  await context.addCookies(await page.context().cookies())
  const other = await context.newPage()
  await other.goto(`${page.url().split('?')[0]}?nobc=1`)
  await expect(other.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  return { other, context }
}

test("focusing a column title and leaving it unchanged does not revert a peer's rename", async ({
  page,
  browser,
}) => {
  const label = `${LABEL}-rename-noop`
  const [columnId] = await openBoard(page, label, 1)
  const { other, context } = await openPeer(page, browser)
  await expect(other.getByTestId(`col-title-${columnId}`)).toHaveValue('New column')

  const title = page.getByTestId(`col-title-${columnId}`)
  await title.click()
  await expect(title).toBeFocused()

  const peerTitle = other.getByTestId(`col-title-${columnId}`)
  await peerTitle.fill('Peer name')
  await peerTitle.press('Enter')
  // The focused field is left alone while it is being edited; the delete button's label
  // carries the shared title, so it shows when the peer's rename has arrived.
  await expect(page.getByTestId(`col-delete-${columnId}`)).toHaveAttribute(
    'aria-label',
    'Delete column Peer name',
  )
  await expect(title).toHaveValue('New column')

  await title.press('Tab') // leave without typing anything
  await expect(title).toHaveValue('Peer name')
  await expect(peerTitle).toHaveValue('Peer name')

  await context.close()
  await cleanup(label)
})

test("typing over a peer's rename wins, by intent", async ({ page, browser }) => {
  const label = `${LABEL}-rename-lww`
  const [columnId] = await openBoard(page, label, 1)
  const { other, context } = await openPeer(page, browser)

  const title = page.getByTestId(`col-title-${columnId}`)
  await title.click()
  const peerTitle = other.getByTestId(`col-title-${columnId}`)
  await peerTitle.fill('Peer name')
  await peerTitle.press('Enter')
  await expect(page.getByTestId(`col-delete-${columnId}`)).toHaveAttribute(
    'aria-label',
    'Delete column Peer name',
  )

  await title.fill('Mine')
  await title.press('Enter')
  await expect(title).toHaveValue('Mine')
  await expect(peerTitle).toHaveValue('Mine')

  await context.close()
  await cleanup(label)
})

test('an empty column deletes straight away', async ({ page }) => {
  const label = `${LABEL}-delete-empty`
  const [first, second] = await openBoard(page, label, 2)
  await page.getByTestId(`col-delete-${first}`).click()
  await expect(page.getByTestId(`column-${first}`)).toHaveCount(0)
  await expect(page.getByTestId(`column-${second}`)).toHaveCount(1)
  await expect(page.getByTestId(`col-confirm-${first}`)).toHaveCount(0)

  await cleanup(label)
})

test('deleting a column with cards asks first, naming the count, and Cancel keeps it', async ({
  page,
}) => {
  const label = `${LABEL}-delete-cards`
  const [columnId] = await openBoard(page, label, 1)
  await addCard(page, columnId!)
  await addCard(page, columnId!)
  await addCard(page, columnId!)

  await page.getByTestId(`col-delete-${columnId}`).click()
  const confirm = page.getByTestId(`col-confirm-${columnId}`)
  await expect(confirm).toContainText('3 cards')
  await page.getByTestId(`col-confirm-cancel-${columnId}`).click()
  await expect(confirm).toHaveCount(0)
  await expect(page.getByTestId(`column-${columnId}`).locator('[data-testid^="card-"]')).toHaveCount(3)

  await page.getByTestId(`col-delete-${columnId}`).click()
  await page.getByTestId(`col-confirm-delete-${columnId}`).click()
  await expect(page.getByTestId(`column-${columnId}`)).toHaveCount(0)

  await cleanup(label)
})

test('one card is "1 card", not "1 cards"', async ({ page }) => {
  const label = `${LABEL}-delete-one`
  const [columnId] = await openBoard(page, label, 1)
  await addCard(page, columnId!)
  await page.getByTestId(`col-delete-${columnId}`).click()
  await expect(page.getByTestId(`col-confirm-${columnId}`)).toContainText('1 card')
  await expect(page.getByTestId(`col-confirm-${columnId}`)).not.toContainText('1 cards')

  await cleanup(label)
})

test('a viewer sees the column title as text, with no rename or delete', async ({ browser }) => {
  const label = `${LABEL}-col-viewer`
  const { owner, workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'board')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  await contextA.addCookies([await sessionCookieFor(owner.id)])
  await contextB.addCookies([await sessionCookieFor(viewer.id)])
  const ownerPage = await contextA.newPage()
  const viewerPage = await contextB.newPage()
  for (const page of [ownerPage, viewerPage]) {
    await page.goto(`${documentPath(document)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  }

  await ownerPage.getByTestId('add-column').click()
  await expect(viewerPage.locator('[data-testid^="column-"]')).toHaveCount(1)
  const columnId = (
    await viewerPage.locator('[data-testid^="column-"]').first().getAttribute('data-testid')
  )!.replace('column-', '')

  await expect(viewerPage.getByTestId(`col-title-${columnId}`)).toBeVisible()
  await expect(viewerPage.getByTestId(`col-title-${columnId}`)).toHaveText('New column')
  await expect(viewerPage.locator(`input[data-testid="col-title-${columnId}"]`)).toHaveCount(0)
  await expect(viewerPage.getByTestId(`col-delete-${columnId}`)).toHaveCount(0)

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})

test('after Cancel, or Escape, in the delete prompt focus returns to the delete button', async ({
  page,
}) => {
  const label = `${LABEL}-focus-cancel`
  const [columnId] = await openBoard(page, label, 1)
  await addCard(page, columnId!)
  const del = page.getByTestId(`col-delete-${columnId}`)

  await del.click()
  await expect(page.getByTestId(`col-confirm-cancel-${columnId}`)).toBeFocused()
  await page.getByTestId(`col-confirm-cancel-${columnId}`).click()
  await expect(page.getByTestId(`col-confirm-${columnId}`)).toHaveCount(0)
  await expect(del).toBeFocused()

  await del.click()
  await expect(page.getByTestId(`col-confirm-${columnId}`)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId(`col-confirm-${columnId}`)).toHaveCount(0)
  await expect(del).toBeFocused()
  await expect(page.getByTestId(`column-${columnId}`)).toHaveCount(1)

  await cleanup(label)
})

test('after a column is deleted, focus moves to the next column, else the previous, else Add a list', async ({
  page,
}) => {
  const label = `${LABEL}-focus-delete`
  const [first, second, third] = await openBoard(page, label, 3)
  const deleteOf = (id: string) => page.getByTestId(`col-delete-${id}`)

  // Middle column, with a card so the prompt is involved: focus goes to the next one.
  await addCard(page, second!)
  await deleteOf(second!).click()
  await page.getByTestId(`col-confirm-delete-${second}`).click()
  await expect(page.getByTestId(`column-${second}`)).toHaveCount(0)
  await expect(deleteOf(third!)).toBeFocused()

  // Last column: there is no next, so the previous one.
  await deleteOf(third!).click()
  await expect(page.getByTestId(`column-${third}`)).toHaveCount(0)
  await expect(deleteOf(first!)).toBeFocused()

  // Only column left: the Add a list button.
  await deleteOf(first!).click()
  await expect(page.getByTestId(`column-${first}`)).toHaveCount(0)
  await expect(page.getByTestId('add-column')).toBeFocused()

  await cleanup(label)
})
