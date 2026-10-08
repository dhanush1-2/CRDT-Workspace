import { test, expect, type Page } from '@playwright/test'
import {
  addMember,
  cleanup,
  createDocument,
  documentPath,
  seedWorkspace,
  sessionCookieFor,
  signIn,
} from './fixtures.js'

const LABEL = 'e2e-toolbar'

test.afterAll(async () => {
  await cleanup(LABEL)
})

/** Signs in as the workspace owner and opens a fresh document, ready to type in. */
async function openDocument(page: Page, label: string) {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(documentPath(document))
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  await expect(page.locator('.editor .ProseMirror')).toHaveAttribute('contenteditable', 'true')
  return { owner, workspace, document }
}

const prose = (page: Page) => page.locator('.editor .ProseMirror')

/**
 * Waits until nothing in the toolbar is mid-flight: the ribbon's own entrance and its
 * `top` transition (it follows the nav as the nav condenses, and clicking into the
 * editor scrolls the page enough to condense it), a menu's pop-in, a hover fade.
 * `toBeVisible()` is true from the first frame of an animation, so a box read straight
 * after it can land anywhere along the motion. Call this before reading geometry.
 *
 * Checked over two consecutive frames, because a transition does not exist until the
 * style recalculation that follows the change that starts it. Infinite animations are
 * skipped; they would never finish.
 */
async function settled(page: Page) {
  await page.getByTestId('tb-root').evaluate(async (root) => {
    const running = () =>
      root
        .getAnimations({ subtree: true })
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    for (let quiet = 0; quiet < 2; ) {
      const pending = running()
      if (pending.length === 0) quiet++
      else {
        quiet = 0
        await Promise.allSettled(pending.map((a) => a.finished))
      }
      await frame()
    }
  })
}

test('the toolbar sits above the document sheet, not inside it', async ({ page }) => {
  await openDocument(page, `${LABEL}-above`)

  const toolbar = (await page.getByTestId('tb-root').boundingBox())!
  const sheet = (await page.getByTestId('document-page').boundingBox())!
  // Bottom edge of the ribbon clears the top edge of the sheet: two panels, stacked.
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(sheet.y)

  // And it is not a descendant of the sheet, which would put it inside the glass page.
  const nested = await page
    .getByTestId('tb-root')
    .evaluate((el) => el.closest('[data-testid="document-page"]') !== null)
  expect(nested).toBe(false)
})

test('the toolbar follows the nav up to 64px from the top while the page scrolls', async ({ page }) => {
  // A short window, so a nearly empty document is still taller than the viewport.
  await page.setViewportSize({ width: 1280, height: 320 })
  await openDocument(page, `${LABEL}-sticky`)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)

  // Polled: the nav condenses on scroll and the toolbar's `top` animates over 0.4s.
  await expect
    .poll(async () => (await page.getByTestId('tb-root').boundingBox())!.y)
    .toBeCloseTo(64, 0)
})

test('an editor gets Home, Insert and View, with Home open', async ({ page }) => {
  await openDocument(page, `${LABEL}-tabs`)

  await expect(page.getByRole('tab')).toHaveText(['Home', 'Insert', 'View'])
  await expect(page.getByTestId('tb-tab-home')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('tb-tab-insert')).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByTestId('tb-row-home')).toBeVisible()
  // An editor has no "View only" chip.
  await expect(page.getByTestId('tb-viewonly')).toHaveCount(0)
})

test('clicking a tab shows that tab’s row and only that row', async ({ page }) => {
  await openDocument(page, `${LABEL}-rows`)

  await page.getByTestId('tb-tab-insert').click()
  await expect(page.getByTestId('tb-tab-insert')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('tb-row-insert')).toBeVisible()
  await expect(page.getByTestId('tb-row-home')).toHaveCount(0)

  await page.getByTestId('tb-tab-view').click()
  await expect(page.getByTestId('tb-tab-view')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('tb-row-view')).toBeVisible()
  await expect(page.getByTestId('tb-row-insert')).toHaveCount(0)

  await page.getByTestId('tb-tab-home').click()
  await expect(page.getByTestId('tb-row-home')).toBeVisible()
})

test('switching tabs keeps the editor’s selection', async ({ page }) => {
  await openDocument(page, `${LABEL}-selection`)

  await prose(page).click()
  await page.keyboard.type('keep this selected')
  await page.keyboard.press('ControlOrMeta+a')
  const selected = () => page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(await selected()).toBe('keep this selected')

  // A real mouse click: mousedown is where the browser moves focus. Without
  // preventDefault there, the editor blurs and every toolbar command applies to nothing.
  await page.getByTestId('tb-tab-insert').click()

  await expect(page.getByTestId('tb-row-insert')).toBeVisible()
  expect(await selected()).toBe('keep this selected')
  expect(
    await page.evaluate(() => document.activeElement?.closest('.ProseMirror') !== null),
  ).toBe(true)
})

test('the word count follows the document, across paragraphs, and survives a reload', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-words`)
  const count = page.getByTestId('tb-wordcount')

  await expect(count).toHaveText('0 words')

  await prose(page).click()
  await page.keyboard.type('one two three')
  // Debounced, so poll rather than read once.
  await expect.poll(() => count.textContent()).toBe('3 words')

  // A second paragraph: "four" and "three" must not fuse into one token.
  await page.keyboard.press('Enter')
  await page.keyboard.type('four')
  await expect.poll(() => count.textContent()).toBe('4 words')

  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await expect.poll(() => count.textContent()).toBe('0 words')

  await page.keyboard.type('just one')
  await expect.poll(() => count.textContent()).toBe('2 words')

  // The count is of the document, not of what was typed this session.
  await page.waitForTimeout(500)
  await page.reload()
  await expect(prose(page)).toContainText('just one')
  await expect.poll(() => count.textContent()).toBe('2 words')
})

test('a viewer gets the View tab and a View only chip, and nothing else', async ({ page }) => {
  const label = `${LABEL}-viewer`
  const { workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, viewer.id)
  await page.goto(documentPath(document))
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')

  await expect(page.getByRole('tab')).toHaveText(['View'])
  await expect(page.getByTestId('tb-tab-view')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('tb-viewonly')).toHaveText('View only')
  // Absent, not disabled.
  await expect(page.getByTestId('tb-tab-home')).toHaveCount(0)
  await expect(page.getByTestId('tb-tab-insert')).toHaveCount(0)
  await expect(page.getByTestId('tb-row-view')).toBeVisible()
  await expect(prose(page)).toHaveAttribute('contenteditable', 'false')
})

test('a board has no toolbar at all', async ({ page }) => {
  const label = `${LABEL}-board`
  const { owner, workspace } = await seedWorkspace(label)
  const board = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)
  await page.goto(documentPath(board))
  await expect(page.getByTestId('add-column')).toBeVisible()

  await expect(page.getByTestId('tb-root')).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(0)
})

test('the tabs are reachable and operable from the keyboard', async ({ page }) => {
  await openDocument(page, `${LABEL}-keys`)

  // Reachable from the page by keyboard, as one Tab stop that lands on the open tab. Walk
  // back from the editor until a tab holds focus. Bounded, and no count asserted: how
  // many controls sit in between is not what this is about.
  await prose(page).click()
  const tabFocused = () =>
    page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab')
  for (let presses = 0; presses < 40 && !(await tabFocused()); presses += 1) {
    await page.keyboard.press('Shift+Tab')
  }
  await expect(page.getByTestId('tb-tab-home')).toBeFocused()
  // The roving tabindex is what makes the strip one stop: only the open tab is in the
  // Tab order, the other two are reached by arrow.
  await expect(page.getByTestId('tb-tab-insert')).toHaveAttribute('tabindex', '-1')
  await expect(page.getByTestId('tb-tab-view')).toHaveAttribute('tabindex', '-1')
  await expect(page.getByTestId('tb-tab-home')).toHaveAttribute('tabindex', '0')

  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('tb-tab-insert')).toBeFocused()
  await expect(page.getByTestId('tb-tab-insert')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('tb-row-insert')).toBeVisible()

  await page.keyboard.press('End')
  await expect(page.getByTestId('tb-tab-view')).toBeFocused()
  await expect(page.getByTestId('tb-row-view')).toBeVisible()

  // Wraps, as a tablist does.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('tb-tab-home')).toBeFocused()
  await expect(page.getByTestId('tb-row-home')).toBeVisible()

  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('tb-tab-view')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.getByTestId('tb-tab-home')).toBeFocused()
})

// ---------------------------------------------------------------------------
// Home tab: the direct controls (handoff 12.2)
// ---------------------------------------------------------------------------

const tb = (page: Page, id: string) => page.getByTestId(`tb-${id}`)

/** Types a line into the editor and selects all of it, as a person would. */
async function typeAndSelect(page: Page, text: string) {
  await prose(page).click()
  await page.keyboard.type(text)
  await page.keyboard.press('ControlOrMeta+a')
}

const MARKS = [
  { id: 'bold', tag: 'strong' },
  { id: 'italic', tag: 'em' },
  { id: 'underline', tag: 'u' },
  { id: 'strike', tag: 's' },
] as const

for (const { id, tag } of MARKS) {
  test(`${id}: wraps the selection in <${tag}>, and a second click unwraps it`, async ({
    page,
  }) => {
    await openDocument(page, `${LABEL}-mark-${id}`)
    await typeAndSelect(page, 'some words')

    await tb(page, id).click()
    await expect(prose(page).locator(tag)).toHaveText('some words')

    await tb(page, id).click()
    await expect(prose(page).locator(tag)).toHaveCount(0)
    await expect(prose(page)).toContainText('some words')
  })

  test(`${id}: the button follows the caret, pressed inside it and not outside`, async ({
    page,
  }) => {
    await openDocument(page, `${LABEL}-pressed-${id}`)
    await prose(page).click()
    await page.keyboard.type('plain marked')
    // Select just "marked" and apply the mark to it.
    for (let i = 0; i < 'marked'.length; i += 1) await page.keyboard.press('Shift+ArrowLeft')
    await tb(page, id).click()
    await expect(prose(page).locator(tag)).toHaveText('marked')

    // Caret at the end, inside the marked run.
    await page.keyboard.press('End')
    await expect(tb(page, id)).toHaveAttribute('aria-pressed', 'true')

    // Caret inside "plain". Arrow keys, not Home: on macOS Home scrolls the page and
    // leaves the caret where it is. The other three marks stay unpressed throughout, so
    // a button that lit for the wrong mark would show up here.
    for (let i = 0; i < 9; i += 1) await page.keyboard.press('ArrowLeft')
    await expect(tb(page, id)).toHaveAttribute('aria-pressed', 'false')
    for (const other of MARKS.filter((entry) => entry.id !== id)) {
      await expect(tb(page, other.id)).toHaveAttribute('aria-pressed', 'false')
    }
  })
}

test('a toolbar click does not take focus or the selection from the editor', async ({ page }) => {
  await openDocument(page, `${LABEL}-keep`)
  await typeAndSelect(page, 'keep me')
  const state = () =>
    page.evaluate(() => ({
      selected: window.getSelection()?.toString() ?? '',
      inEditor: document.activeElement?.closest('.ProseMirror') !== null,
    }))

  // Press and hold. Focus moves on mousedown, so this is where the bug lives: by the time
  // click fires it has already happened, and a check made after the click cannot tell a
  // button that kept focus from one that took it and handed it back.
  const box = (await tb(page, 'bold').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  expect(await state()).toEqual({ selected: 'keep me', inEditor: true })
  await page.mouse.up()

  await expect(prose(page).locator('strong')).toHaveText('keep me')
  expect(await state()).toEqual({ selected: 'keep me', inEditor: true })
})

test('hovering an active toggle keeps its accent fill', async ({ page }) => {
  await openDocument(page, `${LABEL}-hover`)
  await typeAndSelect(page, 'hover')
  await tb(page, 'bold').click()
  await expect(tb(page, 'bold')).toHaveAttribute('aria-pressed', 'true')

  // The pointer is on the button now, having just pressed it. An unpressed button turns
  // white on hover; a pressed one must keep --accent-soft, or the press would be invisible.
  const fill = (id: string) =>
    tb(page, id).evaluate((el) => getComputedStyle(el).backgroundColor)
  // The token as the browser resolves it, so the test does not copy its value.
  const accentSoft = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--accent-soft)'
    document.body.append(probe)
    const resolved = getComputedStyle(probe).backgroundColor
    probe.remove()
    return resolved
  })
  expect(accentSoft).not.toBe('rgba(0, 0, 0, 0)')
  // Polled: the fill transitions in over a quarter of a second.
  await expect.poll(() => fill('bold')).toBe(accentSoft)
  await page.waitForTimeout(400)
  expect(await fill('bold')).toBe(accentSoft)

  await tb(page, 'italic').hover()
  await expect.poll(() => fill('italic')).toBe('rgba(255, 255, 255, 0.9)')
})

test('bulleted and numbered lists wrap the line, and toggle off again', async ({ page }) => {
  await openDocument(page, `${LABEL}-lists`)
  await prose(page).click()
  await page.keyboard.type('one')

  await tb(page, 'bullet').click()
  await expect(prose(page).locator('ul > li')).toHaveText('one')
  await expect(tb(page, 'bullet')).toHaveAttribute('aria-pressed', 'true')
  await expect(tb(page, 'ordered')).toHaveAttribute('aria-pressed', 'false')

  await tb(page, 'bullet').click()
  await expect(prose(page).locator('ul')).toHaveCount(0)
  await expect(tb(page, 'bullet')).toHaveAttribute('aria-pressed', 'false')

  await tb(page, 'ordered').click()
  await expect(prose(page).locator('ol > li')).toHaveText('one')
  await expect(tb(page, 'ordered')).toHaveAttribute('aria-pressed', 'true')
  await expect(tb(page, 'bullet')).toHaveAttribute('aria-pressed', 'false')
})

test('each alignment sets the paragraph and marks itself, and only itself, active', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-align`)
  await prose(page).click()
  await page.keyboard.type('aligned')
  const ids = ['left', 'center', 'right', 'justify'] as const

  // An untouched paragraph is left-aligned, and the bar says so.
  await expect(tb(page, 'align-left')).toHaveAttribute('aria-pressed', 'true')

  for (const id of [...ids].reverse()) {
    await tb(page, `align-${id}`).click()
    await expect(prose(page).locator('p').first()).toHaveCSS('text-align', id)
    for (const other of ids) {
      await expect(tb(page, `align-${other}`)).toHaveAttribute(
        'aria-pressed',
        other === id ? 'true' : 'false',
      )
    }
  }
})

test('clear formatting removes the marks and returns the block to a paragraph', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-clear`)
  await prose(page).click()
  // "# " is the editor's own input rule for a heading.
  await page.keyboard.type('# Loud title')
  await expect(prose(page).locator('h1')).toHaveText('Loud title')
  await page.keyboard.press('ControlOrMeta+a')
  await tb(page, 'bold').click()
  await tb(page, 'italic').click()
  await tb(page, 'align-center').click()
  await expect(prose(page).locator('h1 strong em')).toHaveText('Loud title')

  await tb(page, 'clear').click()

  await expect(prose(page).locator('h1')).toHaveCount(0)
  await expect(prose(page).locator('strong, em')).toHaveCount(0)
  // A trailing empty paragraph follows a heading or list, so match the one with the text.
  const paragraph = prose(page).locator('p', { hasText: 'Loud title' })
  await expect(paragraph).toHaveCount(1)
  await expect(paragraph).not.toHaveCSS('text-align', 'center')
})

test('clear formatting also lifts a line out of a list', async ({ page }) => {
  await openDocument(page, `${LABEL}-clear-list`)
  await prose(page).click()
  await page.keyboard.type('item')
  await tb(page, 'bullet').click()
  await expect(prose(page).locator('ul')).toHaveCount(1)

  await tb(page, 'clear').click()

  await expect(prose(page).locator('ul')).toHaveCount(0)
  await expect(prose(page).locator('p', { hasText: 'item' })).toHaveCount(1)
})

test('undo and redo walk the collaborative history', async ({ page }) => {
  await openDocument(page, `${LABEL}-history`)
  await prose(page).click()
  await page.keyboard.type('history')
  // The undo manager merges changes made within 500ms into one step. Wait, so typing and
  // formatting are two steps and the test can tell them apart.
  await page.waitForTimeout(700)
  await page.keyboard.press('ControlOrMeta+a')
  await tb(page, 'bold').click()
  await expect(prose(page).locator('strong')).toHaveText('history')

  await tb(page, 'undo').click()
  await expect(prose(page).locator('strong')).toHaveCount(0)
  await expect(prose(page)).toContainText('history')

  await tb(page, 'redo').click()
  await expect(prose(page).locator('strong')).toHaveText('history')

  // Undo again, and once more: the second step is the typing itself.
  await tb(page, 'undo').click()
  await tb(page, 'undo').click()
  await expect(prose(page)).not.toContainText('history')

  await tb(page, 'redo').click()
  await expect(prose(page)).toContainText('history')
  await expect(prose(page).locator('strong')).toHaveCount(0)
})

test('formatting made in one browser appears in the other', async ({ browser }) => {
  const label = `${LABEL}-sync`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  async function openAs(userId: string): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext()
    await context.addCookies([await sessionCookieFor(userId)])
    const page = await context.newPage()
    // ?nobc=1 forces this tab to sync through the server rather than BroadcastChannel,
    // so what B sees has been through the CRDT and the wire, not a local shortcut.
    await page.goto(`${documentPath(document)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
    return { page, close: () => context.close() }
  }

  const a = await openAs(owner.id)
  const b = await openAs(editor.id)

  await typeAndSelect(a.page, 'shared styling')
  await tb(a.page, 'bold').click()
  await tb(a.page, 'italic').click()
  await tb(a.page, 'underline').click()
  await tb(a.page, 'strike').click()
  await tb(a.page, 'align-center').click()

  const text = prose(b.page)
  await expect(text.locator('strong')).toHaveText('shared styling')
  await expect(text.locator('em')).toHaveText('shared styling')
  await expect(text.locator('u')).toHaveText('shared styling')
  await expect(text.locator('s')).toHaveText('shared styling')
  await expect(text.locator('p').first()).toHaveCSS('text-align', 'center')

  // And a block change travels as well as a mark: a list made in B arrives in A.
  await b.page.locator('.editor .ProseMirror p').first().click()
  await tb(b.page, 'bullet').click()
  await expect(prose(a.page).locator('ul > li')).toContainText('shared styling')

  // B's own bar reflects what arrived, not only what B did: the caret sits in A's bold.
  await expect(tb(b.page, 'bold')).toHaveAttribute('aria-pressed', 'true')

  await a.close()
  await b.close()
})

test('a viewer gets none of the Home controls', async ({ page }) => {
  const label = `${LABEL}-viewer-home`
  const { workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, viewer.id)
  await page.goto(documentPath(document))
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')

  await expect(page.getByTestId('tb-row-view')).toBeVisible()
  await expect(page.locator('[data-testid^="tb-bold"], [data-testid^="tb-undo"]')).toHaveCount(0)
})

test('the tool row is one Tab stop, and the arrow keys move within it', async ({ page }) => {
  await openDocument(page, `${LABEL}-roving`)
  await prose(page).click()

  const inRow = () =>
    page.evaluate(
      () => document.activeElement?.closest('[data-testid="tb-row-home"]') !== null,
    )
  const tabFocused = () =>
    page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab')

  // Walk back from the editor to the tab strip and count the presses that land in the row.
  let stopsInRow = 0
  for (let presses = 0; presses < 40 && !(await tabFocused()); presses += 1) {
    await page.keyboard.press('Shift+Tab')
    if (await inRow()) stopsInRow += 1
  }
  await expect(page.getByTestId('tb-tab-home')).toBeFocused()
  expect(stopsInRow).toBe(1)

  // Back into the row with Tab: it lands on the one stop, the first tool.
  await page.keyboard.press('Tab')
  await expect(tb(page, 'undo')).toBeFocused()
  // Every other tool is out of the Tab order, and exactly one is in it.
  await expect(page.locator('[data-testid="tb-row-home"] [data-roving][tabindex="0"]')).toHaveCount(1)
  await expect(tb(page, 'redo')).toHaveAttribute('tabindex', '-1')
  await expect(tb(page, 'clear')).toHaveAttribute('tabindex', '-1')

  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'redo')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(tb(page, 'undo')).toBeFocused()
  // Wraps, as the tab strip does.
  await page.keyboard.press('ArrowLeft')
  await expect(tb(page, 'clear')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'undo')).toBeFocused()
  await page.keyboard.press('End')
  await expect(tb(page, 'clear')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(tb(page, 'undo')).toBeFocused()

  // The stop follows focus: leave from Clear and come back to Clear.
  await page.keyboard.press('End')
  await page.keyboard.press('Tab')
  // The title is an editable field now (rename), so it is a stop between the toolbar and
  // the text; before renaming, Tab went straight from the row into the editor.
  await expect(page.getByTestId('document-title')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(prose(page)).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByTestId('document-title')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(tb(page, 'clear')).toBeFocused()
  await expect(tb(page, 'undo')).toHaveAttribute('tabindex', '-1')

  // And Enter on a focused tool presses it: the keyboard path works, not only the mouse.
  await page.keyboard.press('ArrowLeft')
  await expect(tb(page, 'align-justify')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(tb(page, 'align-justify')).toHaveAttribute('aria-pressed', 'true')
})

// ---------------------------------------------------------------------------
// The dropdowns: Style, text colour and highlight (handoff 12.5)
// ---------------------------------------------------------------------------

/** A colour as the browser computes it, so a test compares like with like (hex or var()). */
const resolved = (page: Page, value: string) =>
  page.evaluate((input) => {
    const probe = document.createElement('div')
    probe.style.color = input
    document.body.append(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    return out
  }, value)

const STYLES = ['title', 'heading', 'subheading', 'normal', 'quote', 'code'] as const

/** Opens a menu with the mouse, the way a person does: focus stays in the editor. */
async function openMenu(page: Page, id: 'style' | 'color' | 'highlight') {
  await tb(page, id).click()
  await expect(tb(page, `${id}-menu`)).toBeVisible()
  await settled(page)
}

/** The one thing a toolbar press must not change: where focus and the selection are. */
const editorState = (page: Page) =>
  page.evaluate(() => ({
    selected: (window.getSelection()?.toString() ?? '').trim(),
    inEditor: document.activeElement?.closest('.ProseMirror') !== null,
  }))

test('the Style trigger names the current block and follows the caret', async ({ page }) => {
  await openDocument(page, `${LABEL}-style-name`)
  await prose(page).click()
  const current = tb(page, 'style-current')

  await expect(current).toHaveText('Normal text')
  // "# " is the editor's own input rule for a heading.
  await page.keyboard.type('# one')
  await expect(current).toHaveText('Title')
  await page.keyboard.press('Enter')
  await page.keyboard.type('two')
  await expect(current).toHaveText('Normal text')
  await page.keyboard.press('ArrowUp')
  await expect(current).toHaveText('Title')

  // A level the menu has no row for is named honestly, and no row claims to be selected.
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('#### deep')
  await expect(current).toHaveText('Heading 4')
  await openMenu(page, 'style')
  for (const id of STYLES) await expect(tb(page, `style-${id}`)).toHaveAttribute('aria-selected', 'false')
})

test('each Style option sets that block type, and moves cleanly between them', async ({ page }) => {
  await openDocument(page, `${LABEL}-style-set`)
  await prose(page).click()
  await page.keyboard.type('line')

  const choose = async (id: (typeof STYLES)[number]) => {
    await openMenu(page, 'style')
    await tb(page, `style-${id}`).click()
    await expect(tb(page, 'style-menu')).toHaveCount(0)
  }

  await choose('title')
  await expect(prose(page).locator('h1')).toHaveText('line')
  await choose('heading')
  await expect(prose(page).locator('h2')).toHaveText('line')
  await expect(prose(page).locator('h1')).toHaveCount(0)
  await choose('subheading')
  await expect(prose(page).locator('h3')).toHaveText('line')
  await choose('normal')
  await expect(prose(page).locator('h1, h2, h3')).toHaveCount(0)
  await expect(prose(page).locator('p', { hasText: 'line' })).toHaveCount(1)

  await choose('quote')
  await expect(prose(page).locator('blockquote p')).toHaveText('line')
  // Quote again must not nest a second quote inside the first.
  await choose('quote')
  await expect(prose(page).locator('blockquote')).toHaveCount(1)
  await expect(prose(page).locator('blockquote blockquote')).toHaveCount(0)

  // Moving off a quote leaves it, rather than putting a heading or code inside it.
  await choose('code')
  await expect(prose(page).locator('pre code')).toHaveText('line')
  await expect(prose(page).locator('blockquote')).toHaveCount(0)
  await choose('quote')
  await expect(prose(page).locator('blockquote p')).toHaveText('line')
  await expect(prose(page).locator('pre')).toHaveCount(0)
  await choose('title')
  await expect(prose(page).locator('h1')).toHaveText('line')
  await expect(prose(page).locator('blockquote')).toHaveCount(0)

  // And the trigger agrees with what the document now holds.
  await expect(tb(page, 'style-current')).toHaveText('Title')
  await openMenu(page, 'style')
  await expect(tb(page, 'style-title')).toHaveAttribute('aria-selected', 'true')
  await expect(tb(page, 'style-normal')).toHaveAttribute('aria-selected', 'false')
})

test('each Style row previews in its own style and shows its shortcut', async ({ page }) => {
  await openDocument(page, `${LABEL}-style-look`)
  await prose(page).click()
  await openMenu(page, 'style')

  const look = (id: string) =>
    tb(page, `style-${id}-preview`).evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        size: style.fontSize,
        weight: style.fontWeight,
        family: style.fontFamily,
        rule: style.borderLeftWidth,
      }
    })
  expect(await look('title')).toMatchObject({ size: '22px', weight: '600' })
  expect(await look('heading')).toMatchObject({ size: '17px', weight: '600' })
  expect(await look('subheading')).toMatchObject({ size: '15px', weight: '600' })
  expect(await look('normal')).toMatchObject({ size: '14.5px', weight: '400' })
  expect(await look('quote')).toMatchObject({ size: '14.5px', rule: '2px' })
  const code = await look('code')
  expect(code.size).toBe('13px')
  expect(code.family).toMatch(/monospace|Menlo|Mono/)
  // Only Quote carries the violet rule.
  expect((await look('normal')).rule).toBe('0px')

  const shortcuts = { title: '⌘⌥1', heading: '⌘⌥2', subheading: '⌘⌥3', normal: '⌘⌥0', quote: '', code: '' }
  for (const [id, shortcut] of Object.entries(shortcuts)) {
    await expect(tb(page, `style-${id}-shortcut`)).toHaveText(shortcut)
  }

  // The shell's measurements: a 240px panel, rows at least 38px (the 22px Title grows past
  // it, the rest sit on it), 40px below the trigger, and a 150x32 trigger.
  const menu = (await tb(page, 'style-menu').boundingBox())!
  const trigger = (await tb(page, 'style').boundingBox())!
  expect(menu.width).toBeCloseTo(240, 0)
  expect(menu.y - trigger.y).toBeCloseTo(40, 0)
  expect(trigger.width).toBeCloseTo(150, 0)
  expect(trigger.height).toBeCloseTo(32, 0)
  for (const id of STYLES) {
    const height = (await tb(page, `style-${id}`).boundingBox())!.height
    expect(height).toBeGreaterThanOrEqual(37.5)
    if (id !== 'title') expect(height).toBeCloseTo(38, 0)
  }
})

const TEXT_SWATCHES = [
  ['default', '#1c1d1b'],
  ['grey', '#6c6f6a'],
  ['violet', 'var(--accent)'],
  ['red', '#c4372b'],
  ['orange', '#c9661a'],
  ['green', '#2f8a4f'],
  ['blue', '#2f6fd0'],
  ['pink', '#c2417f'],
] as const

const HIGHLIGHT_SWATCHES = [
  ['none', null],
  ['yellow', '#fde68a'],
  ['green', '#c9f0d3'],
  ['blue', '#d3e4ff'],
  ['pink', '#ffd6e8'],
  ['violet', '#e4d8fb'],
  ['orange', '#ffe0c2'],
  ['grey', '#e6e6ea'],
] as const

test('the colour menus lay out as the design says, with every swatch its own colour', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-swatches`)
  await prose(page).click()

  for (const [menu, swatches, title] of [
    ['color', TEXT_SWATCHES, 'Text color'],
    ['highlight', HIGHLIGHT_SWATCHES, 'Highlight'],
  ] as const) {
    await openMenu(page, menu)
    await expect(tb(page, `${menu}-menu`)).toContainText(title)
    expect((await tb(page, `${menu}-menu`).boundingBox())!.width).toBeCloseTo(170, 0)

    const boxes = []
    for (const [id, value] of swatches) {
      const swatch = tb(page, `${menu}-${id}`)
      boxes.push((await swatch.boundingBox())!)
      if (value) {
        await expect(swatch).toHaveCSS('background-color', await resolved(page, value))
      } else {
        // "None": white with a red diagonal, drawn as a gradient.
        await expect(swatch).toHaveCSS('background-image', /linear-gradient/)
      }
    }
    // 28px circles, four to a row with 8px between, then a second row 36px down.
    for (const box of boxes) expect([box.width, box.height]).toEqual([28, 28])
    expect(boxes[1]!.x - boxes[0]!.x).toBeCloseTo(36, 0)
    expect(boxes[3]!.y).toBeCloseTo(boxes[0]!.y, 0)
    expect(boxes[4]!.y - boxes[0]!.y).toBeCloseTo(36, 0)
    expect(boxes[4]!.x).toBeCloseTo(boxes[0]!.x, 0)
    await page.keyboard.press('Escape')
  }
})

test('the colour menu colours the selection and marks the swatch that matches it', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-colour`)
  await typeAndSelect(page, 'paint me')

  // Nothing coloured yet: Default is the one selected.
  await openMenu(page, 'color')
  await expect(tb(page, 'color-default')).toHaveAttribute('aria-selected', 'true')
  await tb(page, 'color-red').click()
  await expect(prose(page).locator('span[style^="color"]')).toHaveText('paint me')
  await expect(prose(page).locator('span[style^="color"]')).toHaveCSS(
    'color',
    await resolved(page, '#c4372b'),
  )

  // The swatch that matches is marked, and only that one, with a ring in its own colour.
  await openMenu(page, 'color')
  await expect(tb(page, 'color-red')).toHaveAttribute('aria-selected', 'true')
  await expect(tb(page, 'color-default')).toHaveAttribute('aria-selected', 'false')
  await expect(tb(page, 'color-blue')).toHaveAttribute('aria-selected', 'false')
  await expect(tb(page, 'color-red')).toHaveCSS('box-shadow', /0px 0px 0px 4px/)
  await expect(tb(page, 'color-blue')).not.toHaveCSS('box-shadow', /0px 0px 0px 4px/)

  // Violet follows the accent token rather than a copy of it.
  await tb(page, 'color-violet').click()
  await expect(prose(page).locator('span[style^="color"]')).toHaveCSS(
    'color',
    await resolved(page, 'var(--accent)'),
  )

  // Default takes the colour off; it does not paint the run a second "default".
  await openMenu(page, 'color')
  await tb(page, 'color-default').click()
  await expect(prose(page).locator('span[style^="color"]')).toHaveCount(0)
  await expect(prose(page)).toContainText('paint me')

  // The caret reads the colour back: inside coloured text the swatch is marked, outside not.
  await tb(page, 'color').click()
  await tb(page, 'color-green').click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type(' plain')
  await openMenu(page, 'color')
  await expect(tb(page, 'color-default')).toHaveAttribute('aria-selected', 'true')
})

test('the highlight menu highlights the selection, and None removes it', async ({ page }) => {
  await openDocument(page, `${LABEL}-highlight`)
  await typeAndSelect(page, 'mark me')

  await openMenu(page, 'highlight')
  await expect(tb(page, 'highlight-none')).toHaveAttribute('aria-selected', 'true')
  await tb(page, 'highlight-blue').click()
  await expect(prose(page).locator('mark')).toHaveText('mark me')
  await expect(prose(page).locator('mark')).toHaveCSS('background-color', await resolved(page, '#d3e4ff'))

  await openMenu(page, 'highlight')
  await expect(tb(page, 'highlight-blue')).toHaveAttribute('aria-selected', 'true')
  await expect(tb(page, 'highlight-none')).toHaveAttribute('aria-selected', 'false')
  await expect(tb(page, 'highlight-yellow')).toHaveAttribute('aria-selected', 'false')

  // A second colour replaces the first rather than stacking marks.
  await tb(page, 'highlight-pink').click()
  await expect(prose(page).locator('mark')).toHaveCount(1)
  await expect(prose(page).locator('mark')).toHaveCSS('background-color', await resolved(page, '#ffd6e8'))

  await openMenu(page, 'highlight')
  await tb(page, 'highlight-none').click()
  await expect(prose(page).locator('mark')).toHaveCount(0)
  await expect(prose(page)).toContainText('mark me')
})

test('the A and the marker show a bar in the last colour used, and keep it across tabs', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-bars`)
  await typeAndSelect(page, 'bars')
  const bar = (id: 'color' | 'highlight') =>
    tb(page, `${id}-bar`).evaluate((el) => {
      const style = getComputedStyle(el)
      return el instanceof SVGElement ? style.stroke : style.backgroundColor
    })

  // The design's starting colours: the text colour and yellow.
  expect(await bar('color')).toBe(await resolved(page, '#1c1d1b'))
  expect(await bar('highlight')).toBe(await resolved(page, '#fde68a'))

  await openMenu(page, 'color')
  await tb(page, 'color-blue').click()
  await openMenu(page, 'highlight')
  await tb(page, 'highlight-green').click()
  expect(await bar('color')).toBe(await resolved(page, '#2f6fd0'))
  expect(await bar('highlight')).toBe(await resolved(page, '#c9f0d3'))

  // None removes a highlight; it is not a colour, so the bar keeps the last real one.
  await openMenu(page, 'highlight')
  await tb(page, 'highlight-none').click()
  expect(await bar('highlight')).toBe(await resolved(page, '#c9f0d3'))

  // The Home row remounts when the tab changes; the bars must not reset with it.
  await tb(page, 'tab-insert').click()
  await tb(page, 'tab-home').click()
  expect(await bar('color')).toBe(await resolved(page, '#2f6fd0'))
  expect(await bar('highlight')).toBe(await resolved(page, '#c9f0d3'))
})

test('a menu closes on Esc, on a click outside the toolbar, and on choosing an item', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-close`)
  await typeAndSelect(page, 'close')

  for (const id of ['style', 'color', 'highlight'] as const) {
    const menu = tb(page, `${id}-menu`)

    // Esc, with focus still in the editor after a mouse open.
    await openMenu(page, id)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // A click outside the toolbar.
    await openMenu(page, id)
    await prose(page).click()
    await expect(menu).toHaveCount(0)

    // Choosing an item.
    await page.keyboard.press('ControlOrMeta+a')
    await openMenu(page, id)
    await tb(page, id === 'style' ? 'style-normal' : `${id}-${id === 'color' ? 'red' : 'yellow'}`).click()
    await expect(menu).toHaveCount(0)

    // The trigger toggles it too.
    await openMenu(page, id)
    await tb(page, id).click()
    await expect(menu).toHaveCount(0)
  }

  // The design says "outside the toolbar": a press elsewhere on the toolbar is not a close.
  await openMenu(page, 'style')
  await page.getByTestId('tb-wordcount').click()
  await expect(tb(page, 'style-menu')).toBeVisible()
})

test('opening one menu closes any other', async ({ page }) => {
  await openDocument(page, `${LABEL}-exclusive`)
  await prose(page).click()

  await openMenu(page, 'style')
  await openMenu(page, 'color')
  await expect(tb(page, 'style-menu')).toHaveCount(0)
  await expect(tb(page, 'color-menu')).toBeVisible()

  await openMenu(page, 'highlight')
  await expect(tb(page, 'color-menu')).toHaveCount(0)
  await expect(tb(page, 'highlight-menu')).toBeVisible()

  await openMenu(page, 'style')
  await expect(tb(page, 'highlight-menu')).toHaveCount(0)
  // nav-menu is the nav's tab dropdown trigger, not a toolbar menu.
  await expect(page.locator('[data-testid$="-menu"]:not([data-testid="nav-menu"])')).toHaveCount(1)
  await expect(tb(page, 'style')).toHaveAttribute('aria-expanded', 'true')
  await expect(tb(page, 'color')).toHaveAttribute('aria-expanded', 'false')
})

test('the Style menu works from the keyboard, and Esc returns focus to the trigger', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-style-keys`)
  await prose(page).click()
  await page.keyboard.type('abc')

  await tb(page, 'style').focus()
  await page.keyboard.press('Enter')
  await expect(tb(page, 'style-menu')).toBeVisible()
  // Opens on the current value, with focus inside it.
  await expect(tb(page, 'style-normal')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(tb(page, 'style-quote')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(tb(page, 'style-subheading')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(tb(page, 'style-menu')).toHaveCount(0)
  await expect(tb(page, 'style')).toBeFocused()

  // Down on the trigger opens it; Home and Enter choose the first row.
  await page.keyboard.press('ArrowDown')
  await expect(tb(page, 'style-normal')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(tb(page, 'style-title')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('h1')).toHaveText('abc')
  await expect(tb(page, 'style-menu')).toHaveCount(0)
  // The keyboard user stays on the trigger, which now names the new style.
  await expect(tb(page, 'style')).toBeFocused()
  await expect(tb(page, 'style-current')).toHaveText('Title')

  // Tab out of an open menu closes it.
  await page.keyboard.press('Enter')
  await expect(tb(page, 'style-menu')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(tb(page, 'style-menu')).toHaveCount(0)
})

test('the swatch grid moves by arrow keys and chooses with Enter', async ({ page }) => {
  await openDocument(page, `${LABEL}-grid-keys`)
  await typeAndSelect(page, 'grid')

  await tb(page, 'color').focus()
  await page.keyboard.press('Enter')
  await expect(tb(page, 'color-default')).toBeFocused()
  // The row's own arrow handling must not take these: Right moves within the grid, not on
  // to the highlight button beside the trigger.
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'color-grey')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(tb(page, 'color-green')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(tb(page, 'color-orange')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(tb(page, 'color-default')).toBeFocused()
  await page.keyboard.press('End')
  await expect(tb(page, 'color-pink')).toBeFocused()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'color-red')).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(prose(page).locator('span[style^="color"]')).toHaveCSS(
    'color',
    await resolved(page, '#c4372b'),
  )
  await expect(tb(page, 'color-menu')).toHaveCount(0)
  await expect(tb(page, 'color')).toBeFocused()

  // Reopened, it starts on the swatch that is current.
  await page.keyboard.press('Enter')
  await expect(tb(page, 'color-red')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(tb(page, 'color')).toBeFocused()
})

test('the selection and focus survive opening and using each menu', async ({ page }) => {
  await openDocument(page, `${LABEL}-menu-selection`)
  await typeAndSelect(page, 'keep me')
  expect(await editorState(page)).toEqual({ selected: 'keep me', inEditor: true })

  /**
   * Press, check, release. Focus moves on mousedown, so a check made after the click
   * cannot tell a control that kept focus from one that took it and handed it back.
   */
  async function hold(id: string) {
    const box = (await tb(page, id).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    expect(await editorState(page), `${id} on mousedown`).toEqual({
      selected: 'keep me',
      inEditor: true,
    })
    await page.mouse.up()
  }

  // The trigger, then the item: both are presses that must leave the editor alone, and
  // the second is the one that goes wrong silently, applying its colour to nothing.
  await hold('color')
  await expect(tb(page, 'color-menu')).toBeVisible()
  await hold('color-red')
  await expect(tb(page, 'color-menu')).toHaveCount(0)
  await expect(prose(page).locator('span[style^="color"]')).toHaveText('keep me')
  expect(await editorState(page)).toEqual({ selected: 'keep me', inEditor: true })

  await hold('highlight')
  await hold('highlight-yellow')
  await expect(prose(page).locator('mark')).toHaveText('keep me')
  expect(await editorState(page)).toEqual({ selected: 'keep me', inEditor: true })

  await hold('style')
  await hold('style-title')
  await expect(prose(page).locator('h1')).toHaveText('keep me')
  // Still the same selection, still coloured and highlighted: three commands, one range.
  await expect(prose(page).locator('h1 span[style^="color"] mark, h1 mark span[style^="color"]')).toHaveText('keep me')
  expect(await editorState(page)).toEqual({ selected: 'keep me', inEditor: true })
})

test('a menu’s items are not stops of the tool row', async ({ page }) => {
  await openDocument(page, `${LABEL}-menu-roving`)
  await prose(page).click()
  const stops = page.locator('[data-testid="tb-row-home"] [data-roving]')
  const before = await stops.count()
  // The three triggers joined the row; their items must not.
  expect(before).toBeGreaterThan(14)

  for (const id of ['style', 'color', 'highlight'] as const) {
    await openMenu(page, id)
    await expect(stops).toHaveCount(before)
    await expect(page.locator('[data-testid="tb-row-home"] [data-roving][tabindex="0"]')).toHaveCount(1)
    await expect(page.locator(`[data-testid="tb-${id}-menu"] [data-roving]`)).toHaveCount(0)
    await expect(page.locator(`[data-testid="tb-${id}-menu"] [data-menu-item]`).first()).toHaveAttribute(
      'tabindex',
      '-1',
    )
    await page.keyboard.press('Escape')
  }

  // And the triggers are stops, in the design's order, between the neighbours they sit by.
  await tb(page, 'redo').focus()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'style')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'bold')).toBeFocused()
  await tb(page, 'strike').focus()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'color')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'highlight')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'bullet')).toBeFocused()
})

test('modified arrows are left to the browser, in the tool row and on the tab strip', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-modified-keys`)

  // Dispatched rather than pressed: Alt+Left is the browser's Back, which a real press
  // would act on. What matters is whether the page called preventDefault on it.
  const prevented = (init: KeyboardEventInit) =>
    page.evaluate((keyInit) => {
      const event = new KeyboardEvent('keydown', { ...keyInit, bubbles: true, cancelable: true })
      document.activeElement?.dispatchEvent(event)
      return event.defaultPrevented
    }, init)

  await tb(page, 'bold').focus()
  expect(await prevented({ key: 'ArrowLeft', altKey: true })).toBe(false)
  expect(await prevented({ key: 'Home', ctrlKey: true })).toBe(false)
  expect(await prevented({ key: 'ArrowRight', metaKey: true })).toBe(false)
  expect(await prevented({ key: 'ArrowRight', shiftKey: true })).toBe(false)
  await expect(tb(page, 'bold')).toBeFocused()
  // The control: the same keys unmodified are handled, so the probe reaches the handler.
  expect(await prevented({ key: 'ArrowRight' })).toBe(true)
  await expect(tb(page, 'italic')).toBeFocused()

  await page.getByTestId('tb-tab-home').focus()
  expect(await prevented({ key: 'ArrowLeft', altKey: true })).toBe(false)
  expect(await prevented({ key: 'ArrowRight', ctrlKey: true })).toBe(false)
  await expect(page.getByTestId('tb-tab-home')).toBeFocused()
  await expect(page.getByTestId('tb-tab-home')).toHaveAttribute('aria-selected', 'true')
  expect(await prevented({ key: 'ArrowRight' })).toBe(true)
  await expect(page.getByTestId('tb-tab-insert')).toBeFocused()
})

test('colour and highlight made in one browser appear in the other', async ({ browser }) => {
  const label = `${LABEL}-colour-sync`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  async function openAs(userId: string) {
    const context = await browser.newContext()
    await context.addCookies([await sessionCookieFor(userId)])
    const page = await context.newPage()
    // ?nobc=1: sync through the server, so B sees what went through the CRDT and the wire.
    await page.goto(`${documentPath(document)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
    return { page, close: () => context.close() }
  }

  const a = await openAs(owner.id)
  const b = await openAs(editor.id)

  await typeAndSelect(a.page, 'shared paint')
  await openMenu(a.page, 'color')
  await tb(a.page, 'color-red').click()
  await openMenu(a.page, 'highlight')
  await tb(a.page, 'highlight-yellow').click()
  await openMenu(a.page, 'style')
  await tb(a.page, 'style-heading').click()

  const text = prose(b.page)
  await expect(text.locator('h2')).toHaveText('shared paint')
  await expect(text.locator('span[style^="color"]')).toHaveCSS('color', await resolved(b.page, '#c4372b'))
  await expect(text.locator('mark')).toHaveCSS('background-color', await resolved(b.page, '#fde68a'))

  // B's own menus read what arrived: with the caret in A's red, Red is the marked swatch.
  await text.locator('h2').click()
  await expect(tb(b.page, 'style-current')).toHaveText('Heading')
  await openMenu(b.page, 'color')
  await expect(tb(b.page, 'color-red')).toHaveAttribute('aria-selected', 'true')

  await a.close()
  await b.close()
})

test('a menu blurs the page behind it: no ancestor of its panel is a backdrop root', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-backdrop`)
  await prose(page).click()

  for (const id of ['style', 'color', 'highlight'] as const) {
    await openMenu(page, id)
    const found = await tb(page, `${id}-menu`).evaluate((menu) => {
      const filter = (el: Element, pseudo?: string) => {
        const style = getComputedStyle(el, pseudo)
        return style.backdropFilter !== 'none' ? style.backdropFilter : 'none'
      }
      const ancestors: string[] = []
      for (let el = menu.parentElement; el; el = el.parentElement) {
        if (filter(el) !== 'none') ancestors.push(el.className || el.tagName)
      }
      const panel = menu.closest('[data-testid="tb-root"]')!.firstElementChild!
      return { own: filter(menu), ancestors, panelGlass: filter(panel, '::before') }
    })
    // A backdrop-filter on an ancestor makes it the root the menu's blur samples from, and
    // the menu hangs below that ancestor's edge, over the document: it would blur nothing.
    expect(found.ancestors, `${id} menu`).toEqual([])
    expect(found.own, `${id} menu`).not.toBe('none')
    // The toolbar's own glass is still there, on its own layer.
    expect(found.panelGlass).not.toBe('none')
    await page.keyboard.press('Escape')
  }
})

// ---------------------------------------------------------------------------
// Insert tab (handoff 12.3 and 12.6)
// ---------------------------------------------------------------------------

async function openInsert(page: Page) {
  await page.getByTestId('tb-tab-insert').click()
  await expect(page.getByTestId('tb-row-insert')).toBeVisible()
  await settled(page)
}

/** Opens the Link popover with the mouse, the way a person does: focus moves to its field. */
async function openLink(page: Page) {
  await tb(page, 'insert-link').click()
  await expect(tb(page, 'insert-link-menu')).toBeVisible()
  await expect(tb(page, 'insert-link-input')).toBeFocused()
  await settled(page)
}

/** What the editor believes is selected, whether or not it has focus. */
const pmSelection = (page: Page) =>
  prose(page).evaluate((el) => {
    const editor = (el as unknown as { editor: import('@tiptap/core').Editor }).editor
    const { from, to } = editor.state.selection
    return { from, to, text: editor.state.doc.textBetween(from, to, ' ') }
  })

/** Moves the editor's selection without giving it focus: a change made behind the popover. */
const disturbSelection = (page: Page, position: number) =>
  prose(page).evaluate((el, pos) => {
    const editor = (el as unknown as { editor: import('@tiptap/core').Editor }).editor
    editor.commands.setTextSelection(pos)
  }, position)

test('the Insert tab has its six tools, each a labelled button', async ({ page }) => {
  await openDocument(page, `${LABEL}-insert-tools`)
  await openInsert(page)

  const row = page.getByTestId('tb-row-insert')
  await expect(row.locator('button')).toHaveText(['Link', 'Table', 'Divider', 'Code block', 'Quote', 'Date'])
  for (const id of ['link', 'table', 'divider', 'code', 'quote', 'date']) {
    await expect(tb(page, `insert-${id}`)).toBeVisible()
  }
  // The labelled variant: padding 0 11 0 9, with the icon beside the text.
  const link = tb(page, 'insert-link')
  await expect(link).toHaveCSS('padding-left', '9px')
  await expect(link).toHaveCSS('padding-right', '11px')
  await expect(link.locator('svg')).toBeVisible()
})

test('Link opens its popover with the field focused, and Enter links the selection', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-apply`)
  await typeAndSelect(page, 'link me')
  await openInsert(page)

  await openLink(page)
  await expect(tb(page, 'insert-link-input')).toHaveAttribute('placeholder', 'Paste a link')
  await expect(tb(page, 'insert-link')).toHaveAttribute('aria-expanded', 'true')
  // 330px wide, padding 6, 34px controls.
  const box = (await tb(page, 'insert-link-menu').boundingBox())!
  expect(box.width).toBeCloseTo(330, 0)
  expect((await tb(page, 'insert-link-input').boundingBox())!.height).toBeCloseTo(34, 0)

  await page.keyboard.type('https://example.com/docs')
  await page.keyboard.press('Enter')

  await expect(prose(page).locator('a')).toHaveAttribute('href', 'https://example.com/docs')
  await expect(prose(page).locator('a')).toHaveText('link me')
  await expect(tb(page, 'insert-link-menu')).toHaveCount(0)
  // Focus and the selection are the editor's again (Tiptap hands focus back on the next
  // frame, so this is polled).
  await expect.poll(() => editorState(page)).toEqual({ selected: 'link me', inEditor: true })
  await expect(tb(page, 'insert-link')).toHaveAttribute('aria-pressed', 'true')
})

test('Add links the selection too, and an address with no scheme gets https://', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-scheme`)
  await typeAndSelect(page, 'bare address')
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('example.com/path')
  await tb(page, 'insert-link-apply').click()
  await expect(prose(page).locator('a')).toHaveAttribute('href', 'https://example.com/path')
  await expect(prose(page).locator('a')).toHaveText('bare address')

  // A scheme that is already there is left alone.
  await page.keyboard.press('ControlOrMeta+a')
  await openLink(page)
  await page.keyboard.type('http://plain.example')
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveAttribute('href', 'http://plain.example')
})

test('the selection is restored before the link is applied, not read from the page', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-restore`)
  await typeAndSelect(page, 'link me')
  await openInsert(page)
  await openLink(page)

  // Focus is in the field, so the editor has lost the page selection. Something moves the
  // editor's selection to a bare caret while the popover is open. A link applied to the
  // selection as it is then would land on a collapsed cursor, and nothing would happen.
  await disturbSelection(page, 2)
  expect((await pmSelection(page)).text).toBe('')

  await page.keyboard.type('example.com')
  await page.keyboard.press('Enter')
  // The words that were selected when the popover opened, whole.
  await expect(prose(page).locator('a')).toHaveText('link me')
  await expect(prose(page).locator('a')).toHaveAttribute('href', 'https://example.com')
})

test('the selection is mapped through a peer’s edit made while the popover is open', async ({
  browser,
}) => {
  const label = `${LABEL}-link-peer`
  const { owner, workspace } = await seedWorkspace(label)
  const peer = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  async function openAs(userId: string) {
    const context = await browser.newContext()
    await context.addCookies([await sessionCookieFor(userId)])
    const page = await context.newPage()
    await page.goto(`${documentPath(document)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
    return { page, close: () => context.close() }
  }

  const a = await openAs(owner.id)
  const b = await openAs(peer.id)

  // The words are selected with the keyboard from the middle of the line, so the peer's
  // text lands before the selection, not at its edge or inside it.
  await prose(a.page).click()
  await a.page.keyboard.type('intro target words')
  for (let i = 0; i < 'target words'.length; i += 1) await a.page.keyboard.press('Shift+ArrowLeft')
  // The editor reads the page's selection on the browser's selectionchange, so it is polled.
  await expect.poll(async () => (await pmSelection(a.page)).text).toBe('target words')
  // (B's view draws A's caret label inside the text, hence the pattern.)
  await expect(prose(b.page)).toContainText(/intro .*target words/)
  await openInsert(a.page)
  await openLink(a.page)

  // B writes in front of A's selection while A's popover is open.
  await prose(b.page).click()
  // Start of the line: Cmd+Left on macOS, Home elsewhere.
  await b.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
  await b.page.keyboard.type('PREFIX ')
  // (A's view draws B's caret label between them, so the two are asserted apart.)
  await expect(prose(a.page)).toContainText(/^PREFIX /)

  await a.page.keyboard.type('example.com')
  await a.page.keyboard.press('Enter')
  // Still the words A selected, not the span that now sits at the old offsets.
  await expect(prose(a.page).locator('a')).toHaveText('target words')
  await expect(prose(b.page).locator('a')).toHaveText('target words')

  await a.close()
  await b.close()
})

test('Esc closes the popover and gives the editor its selection back', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-esc`)
  await typeAndSelect(page, 'keep this selected')
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('half typed')

  await page.keyboard.press('Escape')
  await expect(tb(page, 'insert-link-menu')).toHaveCount(0)
  // Nothing was applied, and the selection and focus are the editor's. Tiptap gives focus
  // back on the next frame, so this is polled rather than read once.
  await expect(prose(page).locator('a')).toHaveCount(0)
  await expect
    .poll(() => editorState(page))
    .toEqual({ selected: 'keep this selected', inEditor: true })

  // Even if the selection moved while the popover was open.
  await openLink(page)
  await disturbSelection(page, 1)
  await page.keyboard.press('Escape')
  await expect.poll(() => pmSelection(page)).toMatchObject({ text: 'keep this selected' })
  await expect
    .poll(() => editorState(page))
    .toEqual({ selected: 'keep this selected', inEditor: true })
})

test('Remove strips the link, whole, and the field shows the link being edited', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-remove`)
  await typeAndSelect(page, 'remove me')
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('example.com')
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveCount(1)

  // A caret in the middle of the link, not a selection of it.
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await openLink(page)
  await expect(tb(page, 'insert-link-input')).toHaveValue('https://example.com')
  await tb(page, 'insert-link-remove').click()

  await expect(tb(page, 'insert-link-menu')).toHaveCount(0)
  await expect(prose(page).locator('a')).toHaveCount(0)
  await expect(prose(page)).toContainText('remove me')
})

test('Remove has nothing to do outside a link, and says so', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-remove-none`)
  await typeAndSelect(page, 'plain text')
  await openInsert(page)
  await openLink(page)

  await expect(tb(page, 'insert-link-remove')).toHaveAttribute('aria-disabled', 'true')
  // aria-disabled, not disabled: still a control in the popover's Tab order.
  await expect(tb(page, 'insert-link-remove')).not.toHaveAttribute('disabled', /.*/)
  // force: Playwright treats aria-disabled as not actionable, and a person can click it.
  await tb(page, 'insert-link-remove').click({ force: true })
  await expect(tb(page, 'insert-link-menu')).toBeVisible()
  await expect(prose(page)).toHaveText('plain text')
})

test('an address the link validation refuses keeps the popover open and flags the field', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-refused`)
  await typeAndSelect(page, 'not linked')
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('foo://bar')
  await page.keyboard.press('Enter')

  await expect(tb(page, 'insert-link-input')).toHaveAttribute('aria-invalid', 'true')
  await expect(tb(page, 'insert-link-menu')).toBeVisible()
  await expect(tb(page, 'insert-link-input')).toBeFocused()
  await expect(prose(page).locator('a')).toHaveCount(0)

  // Correcting it clears the flag, and the same selection is still the one linked.
  await tb(page, 'insert-link-input').fill('example.com')
  await expect(tb(page, 'insert-link-input')).not.toHaveAttribute('aria-invalid', 'true')
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveText('not linked')
})

test('pressing Link again closes the popover, and the editor has its selection', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-toggle`)
  await typeAndSelect(page, 'toggle me')
  await openInsert(page)
  await openLink(page)
  await disturbSelection(page, 1)

  await tb(page, 'insert-link').click()
  await expect(tb(page, 'insert-link-menu')).toHaveCount(0)
  await expect
    .poll(() => editorState(page))
    .toEqual({ selected: 'toggle me', inEditor: true })
})

test('clicking a link places the caret in it instead of opening it', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-click`)
  await typeAndSelect(page, 'click me')
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('example.com')
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveCount(1)

  // By default a click on a link in an editable document opens it in a new tab, which would
  // make an existing link impossible to reach with the mouse, and so to edit or remove.
  const opened: string[] = []
  page.context().on('page', (popup) => opened.push(popup.url()))
  await prose(page).locator('a').click()
  await page.waitForTimeout(500)
  expect(opened).toEqual([])
  await expect(tb(page, 'insert-link')).toHaveAttribute('aria-pressed', 'true')
})

/** Answers requests to example.com locally, so a followed link needs no network. */
async function stubExample(page: Page) {
  await page.context().route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' }),
  )
}

test('an editor follows a link with Cmd/Ctrl-click, and a plain click only edits', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-follow`)
  await stubExample(page)
  await typeAndSelect(page, 'follow me')
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('example.com/target')
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveCount(1)

  // With openOnClick off an editor has no other way to open a link.
  const popup = page.waitForEvent('popup')
  await prose(page).locator('a').click({ modifiers: ['ControlOrMeta'] })
  const opened = await popup
  await expect.poll(() => opened.url()).toBe('https://example.com/target')
  // The opener is not handed to the page it opened.
  expect(await opened.evaluate(() => window.opener)).toBeNull()
  await opened.close()
  // And the click that followed it did not take the caret out of the document.
  await expect(prose(page)).toBeFocused()
})

test('a viewer clicking a link still opens it', async ({ browser }) => {
  const label = `${LABEL}-link-viewer`
  const { owner, workspace } = await seedWorkspace(label)
  const viewerUser = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')

  const ownerContext = await browser.newContext()
  await ownerContext.addCookies([await sessionCookieFor(owner.id)])
  const author = await ownerContext.newPage()
  await author.goto(`${documentPath(document)}?nobc=1`)
  await expect(author.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  await expect(prose(author)).toHaveAttribute('contenteditable', 'true')
  await typeAndSelect(author, 'viewer link')
  await openInsert(author)
  await openLink(author)
  await author.keyboard.type('example.com/viewer')
  await author.keyboard.press('Enter')

  const viewerContext = await browser.newContext()
  await viewerContext.addCookies([await sessionCookieFor(viewerUser.id)])
  await viewerContext.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' }),
  )
  const viewer = await viewerContext.newPage()
  await viewer.goto(`${documentPath(document)}?nobc=1`)
  await expect(prose(viewer)).toHaveAttribute('contenteditable', 'false')
  const link = prose(viewer).locator('a')
  await expect(link).toHaveText('viewer link')

  // A plain click, nothing held: a viewer's document is not editable, so Tiptap's handler
  // steps aside and the anchor's own target=_blank does the work.
  const popup = viewer.waitForEvent('popup')
  await link.click()
  const opened = await popup
  await expect.poll(() => opened.url()).toBe('https://example.com/viewer')

  await viewerContext.close()
  await ownerContext.close()
})

/** End of the line: Cmd+Right on macOS, End elsewhere (End there scrolls). */
const LINE_END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'

test('text a peer deleted while the popover was open is not linked, or replaced by the address', async ({
  browser,
}) => {
  const label = `${LABEL}-link-gone`
  const { owner, workspace } = await seedWorkspace(label)
  const peer = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  async function openAs(userId: string) {
    const context = await browser.newContext()
    await context.addCookies([await sessionCookieFor(userId)])
    const page = await context.newPage()
    await page.goto(`${documentPath(document)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
    return { page, close: () => context.close() }
  }

  const a = await openAs(owner.id)
  const b = await openAs(peer.id)

  // Two paragraphs, so both kinds of loss can be made: the words, then the whole block.
  await prose(a.page).click()
  await a.page.keyboard.type('keep intro target words')
  await a.page.keyboard.press('Enter')
  await a.page.keyboard.type('second block')
  await expect(prose(b.page)).toContainText('second block')
  await prose(a.page).locator('p').first().click()
  await a.page.keyboard.press(LINE_END)
  for (let i = 0; i < 'target words'.length; i += 1) await a.page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => (await pmSelection(a.page)).text).toBe('target words')
  await openInsert(a.page)
  await openLink(a.page)

  // B deletes the words A selected; the paragraph survives.
  await prose(b.page).locator('p').first().click()
  await b.page.keyboard.press(LINE_END)
  await expect.poll(async () => (await pmSelection(b.page)).from).toBe('keep intro target words'.length + 1)
  for (let i = 0; i < 'target words'.length; i += 1) await b.page.keyboard.press('Backspace')
  await expect(prose(a.page).locator('p').first()).not.toContainText('target')

  await a.page.keyboard.type('example.com')
  await a.page.keyboard.press('Enter')
  // Nothing was linked, nothing was typed in their place, and the popover says why.
  await expect(tb(a.page, 'insert-link-gone')).toBeVisible()
  await expect(tb(a.page, 'insert-link-menu')).toBeVisible()
  await expect(prose(a.page).locator('a')).toHaveCount(0)
  await expect(prose(a.page)).not.toContainText('https://example.com')
  await expect(prose(b.page).locator('a')).toHaveCount(0)
  // Typing a new address clears the note; Esc leaves without touching the document.
  await tb(a.page, 'insert-link-input').fill('example.org')
  await expect(tb(a.page, 'insert-link-gone')).toHaveCount(0)
  await a.page.keyboard.press('Escape')
  await expect(tb(a.page, 'insert-link-menu')).toHaveCount(0)

  // Now the whole block: select a word in the second paragraph, and B deletes the block.
  await prose(a.page).locator('p').nth(1).click()
  await a.page.keyboard.press(LINE_END)
  for (let i = 0; i < 'block'.length; i += 1) await a.page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => (await pmSelection(a.page)).text).toBe('block')
  await openLink(a.page)

  await prose(b.page).locator('p').nth(1).click()
  await b.page.keyboard.press(LINE_END)
  // End of the second paragraph: the first now holds "keep intro " (11), three tokens for
  // the block boundaries and the opening of the second, then its 12 characters.
  await expect.poll(async () => (await pmSelection(b.page)).from).toBe(11 + 3 + 12)
  for (let i = 0; i < 'second block'.length; i += 1) await b.page.keyboard.press('Backspace')
  // The empty paragraph itself, merged away.
  await b.page.keyboard.press('Backspace')
  await expect(prose(a.page).locator('p')).toHaveCount(1)

  const before = await prose(a.page).locator('p').first().textContent()
  await a.page.keyboard.type('example.com')
  await a.page.keyboard.press('Enter')
  await expect(tb(a.page, 'insert-link-gone')).toBeVisible()
  await expect(prose(a.page).locator('a')).toHaveCount(0)
  // The stale offsets pointed into the surviving paragraph; it is untouched.
  expect(await prose(a.page).locator('p').first().textContent()).toBe(before)

  await a.close()
  await b.close()
})

test('a caret on no text takes the address as the link’s text', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-caret`)
  await prose(page).click()
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('example.com')
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveText('https://example.com')
  await expect(prose(page).locator('a')).toHaveAttribute('href', 'https://example.com')
})

test('the Link popover works from the keyboard and closes on Tab out', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-keys`)
  await typeAndSelect(page, 'by keyboard')
  await openInsert(page)

  await tb(page, 'insert-link').focus()
  await page.keyboard.press('Enter')
  await expect(tb(page, 'insert-link-input')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(tb(page, 'insert-link-apply')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(tb(page, 'insert-link-remove')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(tb(page, 'insert-link-menu')).toHaveCount(0)

  // The field's own keys stay the field's: Home and the arrows do not leave it.
  await tb(page, 'insert-link').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.type('abc')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'insert-link-input')).toBeFocused()
})

test('the Link popover’s controls are not stops of the tool row', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-roving`)
  await prose(page).click()
  await openInsert(page)
  const stops = page.locator('[data-testid="tb-row-insert"] [data-roving]')
  await expect(stops).toHaveCount(6)

  await openLink(page)
  await expect(stops).toHaveCount(6)
  await expect(page.locator('[data-testid="tb-row-insert"] [data-roving][tabindex="0"]')).toHaveCount(1)
  await expect(tb(page, 'insert-link-menu').locator('[data-roving]')).toHaveCount(0)

  // Arrows in the field are the field's: the row does not take them.
  await page.keyboard.type('x')
  await page.keyboard.press('ArrowLeft')
  await expect(tb(page, 'insert-link-input')).toBeFocused()
})

test('the Link popover blurs the page behind it: no ancestor is a backdrop root', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-backdrop`)
  await prose(page).click()
  await openInsert(page)
  await openLink(page)
  const found = await tb(page, 'insert-link-menu').evaluate((menu) => {
    const filter = (el: Element) => getComputedStyle(el).backdropFilter
    const ancestors: string[] = []
    for (let el = menu.parentElement; el; el = el.parentElement) {
      if (filter(el) !== 'none') ancestors.push(el.className || el.tagName)
    }
    return { own: filter(menu), ancestors }
  })
  expect(found.ancestors).toEqual([])
  expect(found.own).not.toBe('none')
})

test('Divider, Code block and Quote insert or toggle', async ({ page }) => {
  await openDocument(page, `${LABEL}-blocks`)
  await prose(page).click()
  await page.keyboard.type('first line')
  await openInsert(page)

  // Divider: a horizontal rule.
  await tb(page, 'insert-divider').click()
  await expect(prose(page).locator('hr')).toHaveCount(1)

  // Code block: toggles, and the button follows the caret.
  await page.keyboard.type('const x = 1')
  await tb(page, 'insert-code').click()
  await expect(prose(page).locator('pre code')).toHaveText('const x = 1')
  await expect(tb(page, 'insert-code')).toHaveAttribute('aria-pressed', 'true')
  await tb(page, 'insert-code').click()
  await expect(prose(page).locator('pre')).toHaveCount(0)
  await expect(tb(page, 'insert-code')).toHaveAttribute('aria-pressed', 'false')
  await expect(prose(page)).toContainText('const x = 1')

  // Quote: toggles the same way.
  await tb(page, 'insert-quote').click()
  await expect(prose(page).locator('blockquote')).toContainText('const x = 1')
  await expect(tb(page, 'insert-quote')).toHaveAttribute('aria-pressed', 'true')
  await tb(page, 'insert-quote').click()
  await expect(prose(page).locator('blockquote')).toHaveCount(0)
  await expect(tb(page, 'insert-quote')).toHaveAttribute('aria-pressed', 'false')
  // The editor never lost focus across any of it.
  expect((await editorState(page)).inEditor).toBe(true)
})

test('Date inserts today’s date as text, in the design’s format', async ({ page }) => {
  // The clock is fixed before the page loads, so the expectation does not restate the code.
  await page.clock.setFixedTime(new Date(2026, 9, 3, 12, 0, 0))
  await openDocument(page, `${LABEL}-date`)
  await prose(page).click()
  await page.keyboard.type('Due ')
  await openInsert(page)
  await tb(page, 'insert-date').click()
  await expect(prose(page).locator('p')).toHaveText('Due Oct 3, 2026')
  // Text, not a node or a mark: nothing wraps it.
  await expect(prose(page).locator('p > *')).toHaveCount(0)
})

test('Table inserts a 3x3 with an empty paragraph after it, caret in the first cell', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-table`)
  await prose(page).click()
  await openInsert(page)
  await tb(page, 'insert-table').click()

  const table = prose(page).locator('table')
  await expect(table).toHaveCount(1)
  await expect(table.locator('tr')).toHaveCount(3)
  await expect(table.locator('tr').first().locator('td')).toHaveCount(3)
  await expect(table.locator('td')).toHaveCount(9)
  await expect(table.locator('th')).toHaveCount(0)
  // An empty paragraph follows it: the document's last node is not the table.
  const after = await prose(page).evaluate((el) => {
    const last = el.lastElementChild
    const previous = last?.previousElementSibling
    // Tiptap wraps a table in a div, so the table is that div's child.
    return {
      tag: last?.tagName,
      text: last?.textContent,
      previousHoldsTable: previous?.querySelector(':scope > table') !== null,
    }
  })
  expect(after).toEqual({ tag: 'P', text: '', previousHoldsTable: true })

  // The caret is in the first cell, so typing fills it.
  await page.keyboard.type('A1')
  await expect(table.locator('td').first()).toHaveText('A1')
  // Undo takes the table and its paragraph away together.
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(prose(page).locator('table')).toHaveCount(0)
})

test('Table puts an empty paragraph after itself even where text already follows', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-table-middle`)
  await prose(page).click()
  // An empty line above a line of text: the table replaces the first, and the text
  // that follows must not butt up against it. At the end of a document Tiptap adds a
  // trailing paragraph of its own, which is why the end-of-document test cannot tell.
  await page.keyboard.press('Enter')
  await page.keyboard.type('text below')
  await page.keyboard.press('ArrowUp')
  await openInsert(page)
  await tb(page, 'insert-table').click()

  const shape = await prose(page).evaluate((el) =>
    Array.from(el.children)
      .filter((child) => child.tagName === 'P' || child.querySelector(':scope > table'))
      .map((child) => (child.tagName === 'P' ? `p:${child.textContent}` : 'table')),
  )
  expect(shape).toEqual(['table', 'p:', 'p:text below'])
})

test('a table made in one browser, and what is typed in it, appears in the other', async ({
  browser,
}) => {
  const label = `${LABEL}-table-sync`
  const { owner, workspace } = await seedWorkspace(label)
  const peer = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  async function openAs(userId: string) {
    const context = await browser.newContext()
    await context.addCookies([await sessionCookieFor(userId)])
    const page = await context.newPage()
    // ?nobc=1: through the server and the wire, not a BroadcastChannel shortcut.
    await page.goto(`${documentPath(document)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
    return { page, close: () => context.close() }
  }

  const a = await openAs(owner.id)
  const b = await openAs(peer.id)

  await prose(a.page).click()
  await openInsert(a.page)
  await tb(a.page, 'insert-table').click()
  await a.page.keyboard.type('from A')

  const remote = prose(b.page).locator('table')
  await expect(remote).toHaveCount(1)
  await expect(remote.locator('tr')).toHaveCount(3)
  await expect(remote.locator('td')).toHaveCount(9)
  // toContainText: B's view draws A's caret label (the user's name) inside the cell.
  await expect(remote.locator('td').first()).toContainText('from A')
  await expect(prose(b.page).locator('div:has(> table) + p')).toHaveCount(1)

  // And B's edit inside a cell travels back.
  await remote.locator('td').nth(4).click()
  await b.page.keyboard.type('from B')
  await expect(prose(a.page).locator('table td').nth(4)).toContainText('from B')

  // The node survives a reload from the server, not just the live stream.
  await a.page.waitForTimeout(500)
  await a.page.reload()
  await expect(prose(a.page).locator('table td')).toHaveCount(9)
  await expect(prose(a.page).locator('table td').nth(4)).toContainText('from B')

  await a.close()
  await b.close()
})

test('a viewer gets no Insert tab, so none of the Insert tools', async ({ page }) => {
  const label = `${LABEL}-viewer-insert`
  const { workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, viewer.id)
  await page.goto(documentPath(document))
  await expect(page.getByTestId('tb-tab-view')).toBeVisible()
  await expect(page.getByTestId('tb-tab-insert')).toHaveCount(0)
  await expect(page.locator('[data-testid^="tb-insert-"]')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// View tab: zoom and page width (handoff 12.4)
// ---------------------------------------------------------------------------

async function openView(page: Page) {
  await tb(page, 'tab-view').click()
  await expect(tb(page, 'row-view')).toBeVisible()
  await settled(page)
}

const zoomValue = (page: Page) => tb(page, 'view-zoom-value')
const sheet = (page: Page) => page.getByTestId('document-page')
/**
 * The element `zoom` is on: a wrapper around the title and the editor, not the sheet (so
 * the padding stays) and not `.editor` alone (so the title scales with the body).
 */
const editorBox = (page: Page) => page.getByTestId('document-zoom')

/** The number CSS is zooming the editor by, as the browser computed it (1.1 for 110%). */
const appliedZoom = (page: Page) =>
  editorBox(page).evaluate((el) => Number.parseFloat(getComputedStyle(el).zoom))

/** Presses a zoom button until the readout shows `target`. Only for targets on the 10% grid. */
async function zoomTo(page: Page, target: number) {
  await openView(page)
  await zoomValue(page).click()
  const steps = (target - 100) / 10
  for (let i = 0; i < Math.abs(steps); i += 1) {
    await tb(page, steps > 0 ? 'view-zoom-in' : 'view-zoom-out').click()
  }
  await expect(zoomValue(page)).toHaveText(`${target}%`)
}

test('zoom starts at 100%, steps by 10% either way, and the value resets it', async ({ page }) => {
  await openDocument(page, `${LABEL}-zoom-steps`)
  await prose(page).click()
  await page.keyboard.type('zoom me')
  await openView(page)

  await expect(zoomValue(page)).toHaveText('100%')
  expect(await appliedZoom(page)).toBe(1)
  // A line of text is the proof that it is the document that scales, and not only a number
  // in the readout: its box grows and shrinks with the percentage.
  const lineHeight = async () => (await prose(page).locator('p').boundingBox())!.height

  const base = await lineHeight()
  await tb(page, 'view-zoom-in').click()
  await expect(zoomValue(page)).toHaveText('110%')
  expect(await appliedZoom(page)).toBeCloseTo(1.1, 5)
  expect(await lineHeight()).toBeGreaterThan(base * 1.05)

  await tb(page, 'view-zoom-in').click()
  await expect(zoomValue(page)).toHaveText('120%')
  await tb(page, 'view-zoom-out').click()
  await tb(page, 'view-zoom-out').click()
  await tb(page, 'view-zoom-out').click()
  await expect(zoomValue(page)).toHaveText('90%')
  expect(await appliedZoom(page)).toBeCloseTo(0.9, 5)
  expect(await lineHeight()).toBeLessThan(base * 0.95)

  // Clicking the value is the reset, from anywhere.
  await zoomValue(page).click()
  await expect(zoomValue(page)).toHaveText('100%')
  expect(await appliedZoom(page)).toBe(1)
  expect(await lineHeight()).toBeCloseTo(base, 0)
})

test('the document title scales with the body under zoom', async ({ page }) => {
  await openDocument(page, `${LABEL}-zoom-title`)
  await prose(page).click()
  await page.keyboard.type('body text')
  await openView(page)

  const title = page.getByTestId('document-heading')
  // What is painted, not what is computed: font-size is the unzoomed 32px at every zoom,
  // so the box's height is what shows whether the title shrank. It is a single line.
  const titleHeight = async () => (await title.boundingBox())!.height
  const bodyHeight = async () => (await prose(page).locator('p').boundingBox())!.height

  const titleAt100 = await titleHeight()
  const bodyAt100 = await bodyHeight()
  await expect(title).toHaveCSS('font-size', '32px')

  await tb(page, 'view-zoom-out').click()
  await tb(page, 'view-zoom-out').click()
  await tb(page, 'view-zoom-out').click()
  await expect(zoomValue(page)).toHaveText('70%')
  expect(await titleHeight()).toBeCloseTo(titleAt100 * 0.7, 0)
  // And in step with the text under it: the title keeps its size relative to the body.
  expect((await titleHeight()) / (await bodyHeight())).toBeCloseTo(titleAt100 / bodyAt100, 1)

  await zoomValue(page).click()
  for (let i = 0; i < 5; i += 1) await tb(page, 'view-zoom-in').click()
  await expect(zoomValue(page)).toHaveText('150%')
  expect(await titleHeight()).toBeCloseTo(titleAt100 * 1.5, 0)
  expect((await titleHeight()) / (await bodyHeight())).toBeCloseTo(titleAt100 / bodyAt100, 1)
})

test('zoom stops at 70% and at 150%, and the button that cannot go further says so', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-zoom-clamp`)
  await openView(page)

  // Down: three presses are 70%. Playwright will not click an aria-disabled button, so
  // the presses past the limit are forced, as a keyboard's Enter on it would be.
  for (let i = 0; i < 3; i += 1) await tb(page, 'view-zoom-out').click()
  await expect(zoomValue(page)).toHaveText('70%')
  for (let i = 0; i < 3; i += 1) await tb(page, 'view-zoom-out').click({ force: true })
  await expect(zoomValue(page)).toHaveText('70%')
  expect(await appliedZoom(page)).toBeCloseTo(0.7, 5)
  await expect(tb(page, 'view-zoom-out')).toHaveAttribute('aria-disabled', 'true')
  await expect(tb(page, 'view-zoom-in')).toHaveAttribute('aria-disabled', 'false')

  // Up: all the way through 100% and on to the other end, then past it.
  for (let i = 0; i < 8; i += 1) await tb(page, 'view-zoom-in').click()
  await expect(zoomValue(page)).toHaveText('150%')
  for (let i = 0; i < 3; i += 1) await tb(page, 'view-zoom-in').click({ force: true })
  await expect(zoomValue(page)).toHaveText('150%')
  expect(await appliedZoom(page)).toBeCloseTo(1.5, 5)
  await expect(tb(page, 'view-zoom-in')).toHaveAttribute('aria-disabled', 'true')
  await expect(tb(page, 'view-zoom-out')).toHaveAttribute('aria-disabled', 'false')

  // And back one step: a limit is not a trap.
  await tb(page, 'view-zoom-out').click()
  await expect(zoomValue(page)).toHaveText('140%')
})

test('Narrow and Wide set the sheet to 780px and 1040px', async ({ page }) => {
  // Wide enough that the viewport, not the sheet's max-width, is never what limits it.
  await page.setViewportSize({ width: 1500, height: 800 })
  await openDocument(page, `${LABEL}-width`)
  await openView(page)

  const width = async () => (await sheet(page).boundingBox())!.width
  await expect(tb(page, 'view-width-narrow')).toHaveAttribute('aria-pressed', 'true')
  await expect(tb(page, 'view-width-wide')).toHaveAttribute('aria-pressed', 'false')
  await expect(sheet(page)).toHaveCSS('max-width', '780px')
  expect(await width()).toBe(780)

  await tb(page, 'view-width-wide').click()
  await expect(tb(page, 'view-width-wide')).toHaveAttribute('aria-pressed', 'true')
  await expect(tb(page, 'view-width-narrow')).toHaveAttribute('aria-pressed', 'false')
  // toHaveCSS retries, so it waits out the .55s transition rather than racing it.
  await expect(sheet(page)).toHaveCSS('max-width', '1040px')
  await expect.poll(width).toBe(1040)

  await tb(page, 'view-width-narrow').click()
  await expect(sheet(page)).toHaveCSS('max-width', '780px')
  await expect.poll(width).toBe(780)
})

/**
 * Clicks the control from inside the page and samples the sheet's width on every frame
 * for a second, so the answer is what the browser painted, not what a test happened to
 * catch between two round trips.
 */
async function widthsWhileClicking(page: Page, testId: string) {
  return page.evaluate(async (id) => {
    const el = document.querySelector('[data-testid="document-page"]')!
    const widths: number[] = []
    const start = performance.now()
    ;(document.querySelector(`[data-testid="${id}"]`) as HTMLElement).click()
    await new Promise<void>((resolve) => {
      const frame = () => {
        widths.push(el.getBoundingClientRect().width)
        if (performance.now() - start < 1000) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
    return widths
  }, testId)
}

test('the width change animates over .55s rather than jumping', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 800 })
  await openDocument(page, `${LABEL}-width-anim`)
  await openView(page)

  const widths = await widthsWhileClicking(page, 'tb-view-width-wide')
  const between = widths.filter((w) => w > 781 && w < 1039)
  // Several painted frames part-way: a jump would have none.
  expect(between.length).toBeGreaterThanOrEqual(3)
  // And it is a widening throughout, ending on the target.
  expect(widths[0]).toBeLessThan(1040)
  expect(widths.at(-1)).toBe(1040)
  for (let i = 1; i < widths.length; i += 1) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]! - 0.01)

  // The browser's own record of it: a max-width transition of the specified length.
  await tb(page, 'view-width-narrow').click()
  const transition = await sheet(page).evaluate((el) =>
    el
      .getAnimations()
      .filter((a): a is CSSTransition => a instanceof CSSTransition)
      .map((a) => ({ property: a.transitionProperty, duration: a.effect?.getTiming().duration })),
  )
  expect(transition).toEqual([{ property: 'max-width', duration: 550 }])
})

test('with reduced motion the width change is immediate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1500, height: 800 })
  await openDocument(page, `${LABEL}-width-reduced`)
  await openView(page)

  const widths = await widthsWhileClicking(page, 'tb-view-width-wide')
  expect(widths.filter((w) => w > 781 && w < 1039)).toEqual([])
  expect(widths.at(-1)).toBe(1040)
  expect(await sheet(page).evaluate((el) => el.getAnimations().length)).toBe(0)
})

test('a viewer gets the View tab, and zoom and page width work in it', async ({ page }) => {
  const label = `${LABEL}-view-viewer`
  const { workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, viewer.id)
  await page.setViewportSize({ width: 1500, height: 800 })
  await page.goto(documentPath(document))
  await expect(prose(page)).toHaveAttribute('contenteditable', 'false')

  // View is the only tab, and it is open: the viewer lands on it, not on an empty row.
  await expect(page.getByRole('tab')).toHaveText(['View'])
  await expect(tb(page, 'row-view')).toBeVisible()
  await expect(zoomValue(page)).toHaveText('100%')

  await tb(page, 'view-zoom-in').click()
  await tb(page, 'view-zoom-in').click()
  await expect(zoomValue(page)).toHaveText('120%')
  expect(await appliedZoom(page)).toBeCloseTo(1.2, 5)
  await zoomValue(page).click()
  await expect(zoomValue(page)).toHaveText('100%')

  await tb(page, 'view-width-wide').click()
  await expect(sheet(page)).toHaveCSS('max-width', '1040px')
  await expect.poll(async () => (await sheet(page).boundingBox())!.width).toBe(1040)
  await tb(page, 'view-width-narrow').click()
  await expect.poll(async () => (await sheet(page).boundingBox())!.width).toBe(780)
})

test('the View row is one Tab stop, and every control in it is reached by the arrows', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-view-roving`)
  await openView(page)

  const row = tb(page, 'row-view')
  // Zoom out, the value, zoom in, Narrow, Wide: five controls, one of them the stop.
  await expect(row.locator('[data-roving]')).toHaveCount(5)
  await expect(row.locator('[data-roving][tabindex="0"]')).toHaveCount(1)

  await tb(page, 'view-zoom-out').focus()
  const order = ['view-zoom-value', 'view-zoom-in', 'view-width-narrow', 'view-width-wide']
  for (const id of order) {
    await page.keyboard.press('ArrowRight')
    await expect(tb(page, id)).toBeFocused()
  }
  // The keyboard reaches the page-width choice, and Enter makes it.
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Enter')
  await expect(tb(page, 'view-width-narrow')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  await expect(tb(page, 'view-width-wide')).toHaveAttribute('aria-pressed', 'true')
})

test('using the View tab does not take the caret out of the document', async ({ page }) => {
  await openDocument(page, `${LABEL}-view-focus`)
  await prose(page).click()
  await page.keyboard.type('keep going')
  await openView(page)

  await tb(page, 'view-zoom-in').click()
  await tb(page, 'view-width-wide').click()
  await expect(prose(page)).toBeFocused()
  // And typing carries on where it was, at the new zoom.
  await page.keyboard.type(' typing')
  await expect(prose(page)).toContainText('keep going typing')
})

test('a peer’s caret and name label stay on their character at 70%, 100% and 150%', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const label = `${LABEL}-zoom-caret`
  const { owner, workspace } = await seedWorkspace(label)
  const peer = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  async function openAs(userId: string) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
    await context.addCookies([await sessionCookieFor(userId)])
    const page = await context.newPage()
    await page.goto(`${documentPath(document)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
    return { page, close: () => context.close() }
  }

  const a = await openAs(owner.id)
  const b = await openAs(peer.id)
  const text = 'The quick brown fox jumps over the lazy dog and keeps running far away'
  await prose(a.page).click()
  await a.page.keyboard.type(text)
  await expect(prose(b.page)).toContainText('running far away')

  // The caret before the "b" of "brown": the document position is 1 (the paragraph's
  // opening) + 10 characters.
  const BROWN = 1 + text.indexOf('brown')

  /** Where A would click to put the caret just before "brown", in A's own layout. */
  const brownPoint = (page: Page) =>
    page.evaluate(() => {
      const node = document.querySelector('.editor .ProseMirror p')!.firstChild as Text
      const at = node.data.indexOf('brown')
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + 1)
      const box = range.getBoundingClientRect()
      return { x: box.left + 1, y: box.top + box.height / 2 }
    })

  // What B draws, against what B's own layout says is there.
  const measure = (page: Page, head: number) =>
    page.evaluate((position) => {
      const view = (document.querySelector('.editor .ProseMirror') as any).editor.view
      const caret = document.querySelector('.collaboration-carets__caret')!.getBoundingClientRect()
      const name = document.querySelector('.collaboration-carets__label')!.getBoundingClientRect()
      const wanted = view.coordsAtPos(position)
      // The "b" of "brown", wherever the caret widget has split the text node.
      const walker = document.createTreeWalker(
        document.querySelector('.editor .ProseMirror p')!,
        NodeFilter.SHOW_TEXT,
      )
      let char: DOMRect | null = null
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const at = node.data.indexOf('brown')
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + 1)
        char = range.getBoundingClientRect()
      }
      return {
        caretLeft: caret.left,
        caretTop: caret.top,
        caretHeight: caret.height,
        wantedLeft: wanted.left,
        wantedTop: wanted.top,
        charLeft: char!.left,
        charTop: char!.top,
        charHeight: char!.height,
        labelLeft: name.left,
        labelBottom: name.bottom,
      }
    }, head)

  // Each side at each zoom, and the two zooms different, which is the case where one
  // browser's click and the other's drawing could most easily disagree.
  const cases = [
    { viewer: 100, clicker: 100 },
    { viewer: 70, clicker: 70 },
    { viewer: 150, clicker: 150 },
    { viewer: 150, clicker: 70 },
    { viewer: 70, clicker: 150 },
  ]
  for (const { viewer, clicker } of cases) {
    await zoomTo(b.page, viewer)
    await zoomTo(a.page, clicker)
    // A's click lands on the character it was aimed at, in A's zoomed layout.
    const point = await brownPoint(a.page)
    await a.page.mouse.click(point.x, point.y)
    await expect
      .poll(() =>
        a.page.evaluate(
          () => (document.querySelector('.editor .ProseMirror') as any).editor.state.selection.head,
        ),
      )
      .toBe(BROWN)
    await expect(b.page.locator('.collaboration-carets__caret')).toHaveCount(1)
    await expect
      .poll(async () => {
        const m = await measure(b.page, BROWN)
        return Math.abs(m.caretLeft - m.wantedLeft)
      })
      .toBeLessThan(0.5)

    const m = await measure(b.page, BROWN)
    const scale = viewer / 100
    // The bar is on ProseMirror's own answer for that position, at that zoom.
    expect(Math.abs(m.caretLeft - m.wantedLeft)).toBeLessThan(0.5)
    expect(Math.abs(m.caretTop - m.wantedTop)).toBeLessThan(0.5)
    // And on the character: the bar's box is the 1px border either side of it, scaled.
    expect(Math.abs(m.caretLeft - m.charLeft)).toBeLessThan(2)
    expect(Math.abs(m.caretTop - m.charTop)).toBeLessThan(1)
    // It is as tall as the line, so it was scaled with the text and not left at 100%.
    expect(Math.abs(m.caretHeight - m.charHeight)).toBeLessThan(1)
    expect(m.charHeight).toBeGreaterThan(21 * scale - 1.5)
    expect(m.charHeight).toBeLessThan(21 * scale + 1.5)
    // The name pill hangs off the bar's left edge and rides on its top.
    expect(Math.abs(m.labelLeft - m.caretLeft)).toBeLessThan(1)
    expect(Math.abs(m.labelBottom - m.caretTop)).toBeLessThan(3)
  }

  await a.close()
  await b.close()
})

// ---------------------------------------------------------------------------
// Element styles (handoff 12.7's table)
// ---------------------------------------------------------------------------

/** One of every element the toolbar can produce, with a colour and a highlight among them. */
const EVERY_ELEMENT = `
<h1>Top</h1>
<h2>Heading</h2>
<h3>Subheading</h3>
<p>Body with a <a href="https://example.com">link <span style="color: #c4372b">red in a link</span></a>, <span style="color: #2f8a4f">green</span> and <mark data-color="#fde68a" style="background-color: #fde68a; color: inherit">marked</mark>.</p>
<ul><li><p>bullet one</p></li><li><p>bullet two</p></li></ul>
<ol><li><p>number one</p></li><li><p>number two</p></li></ol>
<blockquote><p>quoted <span style="color: #c4372b">red in a quote</span></p></blockquote>
<pre><code>code line</code></pre>
<hr>
<table><tbody><tr><td><p>a1</p></td><td><p><span style="color: #2f6fd0">blue in a cell</span></p></td></tr><tr><td><p>b1</p></td><td><p>b2</p></td></tr></tbody></table>
<p>last</p>
`

async function loadEveryElement(page: Page) {
  await openDocument(page, `${LABEL}-elements-${Math.random().toString(36).slice(2, 8)}`)
  await page.evaluate((html) => {
    const editor = (document.querySelector('.editor .ProseMirror') as unknown as {
      editor: import('@tiptap/core').Editor
    }).editor
    editor.commands.setContent(html)
  }, EVERY_ELEMENT)
  await expect(prose(page).locator('table')).toHaveCount(1)
}

/**
 * The computed value of each property on the first element matching `selector`, inside the
 * editor. Colours are not compared as text: `resolve` runs a literal through the browser,
 * so `rgba(40,40,60,.14)` and `rgba(40, 40, 60, 0.14)` are the same answer.
 */
async function computed(page: Page, selector: string, props: string[]) {
  return page.evaluate(
    ([sel, names]) => {
      const el = document.querySelector(`.editor .ProseMirror ${sel}`)!
      const cs = getComputedStyle(el)
      return Object.fromEntries(
        (names as string[]).map((n) => [n, cs.getPropertyValue(n)]),
      ) as Record<string, string>
    },
    [selector, props] as const,
  )
}

/** What the browser makes of a colour value, `var()` included, so values can be compared. */
function resolveColour(page: Page, value: string) {
  return page.evaluate((v) => {
    const probe = document.createElement('div')
    probe.style.color = v
    document.body.append(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    return out
  }, value)
}

test('headings, paragraphs, quote, code, lists and rule carry 12.7’s values', async ({ page }) => {
  await loadEveryElement(page)
  const text = await resolveColour(page, 'var(--text)')
  const muted = await resolveColour(page, 'var(--text-muted)')

  // size / weight / line-height / letter-spacing / margins, from the table.
  expect(await computed(page, 'h1', ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'margin-top', 'margin-bottom', 'color'])).toEqual({
    'font-size': '32px', 'font-weight': '600', 'line-height': '38.4px', 'letter-spacing': '-0.8px', 'margin-top': '0px', 'margin-bottom': '20px', color: text,
  })
  expect(await computed(page, 'h2', ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'margin-top', 'margin-bottom', 'color'])).toEqual({
    'font-size': '21px', 'font-weight': '600', 'line-height': '27.3px', 'letter-spacing': '-0.42px', 'margin-top': '30px', 'margin-bottom': '10px', color: text,
  })
  // h3 is 18px, level with the body: §12.7's 17px was 17px against a 17px body, and the body
  // has since moved to 18px (see the handoff's deviation table).
  expect(await computed(page, 'h3', ['font-size', 'font-weight', 'line-height', 'margin-top', 'margin-bottom', 'color'])).toEqual({
    'font-size': '18px', 'font-weight': '600', 'line-height': '24.3px', 'margin-top': '22px', 'margin-bottom': '8px', color: text,
  })

  // The body is 18px, which is a later decision than 12.7's 17 and must not be "corrected".
  expect(await computed(page, 'p', ['font-size', 'line-height', 'margin-bottom'])).toEqual({
    'font-size': '18px', 'line-height': '29.7px', 'margin-bottom': '14px',
  })

  const quote = await computed(page, 'blockquote', ['margin-top', 'margin-bottom', 'padding-top', 'padding-bottom', 'padding-left', 'border-left-width', 'border-left-color', 'color'])
  expect(quote).toEqual({
    'margin-top': '18px', 'margin-bottom': '18px', 'padding-top': '2px', 'padding-bottom': '2px', 'padding-left': '18px', 'border-left-width': '3px',
    'border-left-color': await resolveColour(page, 'oklch(0.42 0.11 285 / .35)'), color: muted,
  })
  // The quote's text is a paragraph; the paragraph rule must not repaint it or pad its end.
  expect(await computed(page, 'blockquote p', ['color', 'margin-bottom'])).toEqual({ color: muted, 'margin-bottom': '0px' })

  expect(await computed(page, 'pre', ['margin-bottom', 'padding-top', 'padding-left', 'border-top-left-radius', 'background-color', 'font-size', 'line-height', 'white-space', 'font-family'])).toEqual({
    'margin-bottom': '14px', 'padding-top': '14px', 'padding-left': '16px', 'border-top-left-radius': '14px',
    'background-color': await resolveColour(page, 'rgba(40,40,60,.05)'), 'font-size': '14px', 'line-height': '21.7px', 'white-space': 'pre-wrap',
    'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  })
  // The code inside it takes the block's size and font stack, not the browser's `monospace`.
  expect(await computed(page, 'pre code', ['font-size', 'font-family'])).toEqual({
    'font-size': '14px', 'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  })

  for (const list of ['ul', 'ol']) {
    expect(await computed(page, list, ['margin-bottom', 'padding-left'])).toEqual({ 'margin-bottom': '14px', 'padding-left': '24px' })
  }
  expect(await computed(page, 'li', ['margin-bottom'])).toEqual({ 'margin-bottom': '4px' })
  // An item's text is a paragraph; its own 14px margin must not make the list loose.
  expect(await computed(page, 'li p', ['margin-bottom'])).toEqual({ 'margin-bottom': '0px' })

  const hr = await computed(page, 'hr', ['border-top-width', 'height', 'background-color', 'margin-top', 'margin-bottom'])
  expect(hr).toEqual({
    'border-top-width': '0px', height: '1px', 'background-color': await resolveColour(page, 'rgba(40,40,60,.14)'), 'margin-top': '28px', 'margin-bottom': '28px',
  })
})

test('a table and its cells carry 12.7’s values, and the text in a cell is the table’s 15px', async ({ page }) => {
  await loadEveryElement(page)
  const table = await computed(page, 'table', ['border-collapse', 'border-top-width', 'border-top-color', 'border-top-left-radius', 'overflow', 'font-size', 'margin-bottom'])
  expect(table).toEqual({
    'border-collapse': 'separate', 'border-top-width': '1px', 'border-top-color': await resolveColour(page, 'rgba(40,40,60,.14)'),
    'border-top-left-radius': '12px', overflow: 'hidden', 'font-size': '15px', 'margin-bottom': '16px',
  })
  // Full width of the page's text column.
  const widths = await page.evaluate(() => ({
    table: document.querySelector('.editor .ProseMirror table')!.getBoundingClientRect().width,
    column: document.querySelector('.editor .ProseMirror')!.getBoundingClientRect().width,
  }))
  expect(Math.abs(widths.table - widths.column)).toBeLessThan(1)

  const cell = await computed(page, 'td', ['border-right-width', 'border-bottom-width', 'border-right-color', 'border-bottom-color', 'padding-top', 'padding-left', 'min-width', 'vertical-align'])
  const hairline = await resolveColour(page, 'rgba(40,40,60,.1)')
  expect(cell).toEqual({
    'border-right-width': '1px', 'border-bottom-width': '1px', 'border-right-color': hairline, 'border-bottom-color': hairline,
    'padding-top': '8px', 'padding-left': '12px', 'min-width': '60px', 'vertical-align': 'top',
  })
  // A cell's text is a paragraph and would be 18px with a 14px tail; it is the table's size.
  expect(await computed(page, 'td p', ['font-size', 'margin-bottom'])).toEqual({ 'font-size': '15px', 'margin-bottom': '0px' })
})

test('a link is accent and underlined, and colour and highlight marks keep their own colours', async ({ page }) => {
  await loadEveryElement(page)
  const accent = await resolveColour(page, 'var(--accent)')

  expect(await computed(page, 'p a', ['color', 'text-decoration-line', 'text-underline-offset'])).toEqual({
    color: accent, 'text-decoration-line': 'underline', 'text-underline-offset': '2px',
  })

  // A colour set on text is an inline style on a span, and it has to beat every rule above:
  // in a paragraph, inside a link, inside a quote (which sets its own colour), in a cell.
  const red = await resolveColour(page, '#c4372b')
  for (const sel of ['p a span', 'blockquote span']) {
    expect(await computed(page, sel, ['color'])).toEqual({ color: red })
  }
  expect(await computed(page, 'p > span', ['color'])).toEqual({ color: await resolveColour(page, '#2f8a4f') })
  expect(await computed(page, 'td span', ['color'])).toEqual({ color: await resolveColour(page, '#2f6fd0') })

  // The highlight keeps its fill and the text in it keeps the paragraph's colour.
  expect(await computed(page, 'mark', ['background-color'])).toEqual({ 'background-color': await resolveColour(page, '#fde68a') })
})

test('the sheet keeps 28px above it, and its text is 18px', async ({ page }) => {
  await loadEveryElement(page)
  await expect(sheet(page)).toHaveCSS('margin-top', '28px')
  await expect(sheet(page)).toHaveCSS('margin-bottom', '64px')
  await expect(prose(page).locator('p').first()).toHaveCSS('font-size', '18px')
})

test('pasting text styled with a font family and size writes neither into the document', async ({ page }) => {
  await openDocument(page, `${LABEL}-paste-type`)
  await prose(page).click()

  // A real paste event carrying text/html, which is what Word, Google Docs and a web page
  // put on the clipboard. The second paragraph is the control: colour is a feature and
  // must come through, so a pass here means the paste was parsed, not dropped.
  await prose(page).evaluate((el) => {
    const data = new DataTransfer()
    data.setData(
      'text/html',
      '<p><span style="font-family:Arial;font-size:11pt">typed</span></p>' +
        '<p><span style="color:rgb(196, 55, 43)">coloured</span></p>',
    )
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })

  await expect(prose(page)).toContainText('typed')
  await expect(prose(page)).toContainText('coloured')
  const html = await prose(page).innerHTML()
  expect(html).not.toMatch(/font-family/i)
  expect(html).not.toMatch(/font-size/i)
  expect(html).not.toMatch(/Arial|11pt/)
  // The control: the colour survived the same paste.
  expect(html).toMatch(/color:\s*rgb\(196,\s*55,\s*43\)/)
})

test('the tools are a labelled toolbar inside the tabpanel, and only the open tab controls a panel', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-roles`)

  for (const [tab, name] of [['home', 'Home tools'], ['insert', 'Insert tools'], ['view', 'View tools']] as const) {
    await page.getByTestId(`tb-tab-${tab}`).click()
    const panel = page.getByRole('tabpanel')
    await expect(panel).toHaveCount(1)
    // The role the keyboard model belongs to, announced by name, and holding every tool.
    const toolbar = panel.getByRole('toolbar', { name })
    await expect(toolbar).toHaveCount(1)
    expect(await toolbar.locator('[data-roving]').count()).toBeGreaterThan(0)
    expect(
      await panel.evaluate((el) => el.querySelectorAll('[data-roving]').length),
    ).toBe(await toolbar.locator('[data-roving]').count())

    // aria-controls names a panel that exists, and only on the selected tab.
    const controls = await page.getByRole('tab').evaluateAll((tabs) =>
      tabs.map((el) => ({
        selected: el.getAttribute('aria-selected') === 'true',
        controls: el.getAttribute('aria-controls'),
      })),
    )
    for (const entry of controls) {
      if (entry.selected) {
        expect(entry.controls).not.toBeNull()
        expect(await page.locator(`[id="${entry.controls}"]`).count()).toBe(1)
      } else {
        expect(entry.controls).toBeNull()
      }
    }
  }
})

test('Table is unavailable with the caret in a table, and does not nest one', async ({ page }) => {
  await openDocument(page, `${LABEL}-table-nest`)
  await prose(page).click()
  await openInsert(page)
  const table = tb(page, 'insert-table')
  await expect(table).toHaveAttribute('aria-disabled', 'false')
  await table.click()
  await expect(prose(page).locator('table')).toHaveCount(1)

  // The caret is in the first cell. The button says so, and stays in the row.
  await expect(table).toHaveAttribute('aria-disabled', 'true')
  // force: Playwright treats aria-disabled as not enabled and would wait forever. The click
  // must really be delivered, so what follows proves it inserted nothing.
  await table.click({ force: true })
  await expect(prose(page).locator('table')).toHaveCount(1)
  await expect(prose(page).locator('table table')).toHaveCount(0)
  await expect(prose(page).locator('td')).toHaveCount(9)

  // Out of the table, in the paragraph after it, it is available again.
  await prose(page).locator(':scope > p').last().click()
  await expect(table).toHaveAttribute('aria-disabled', 'false')
  await table.click()
  await expect(prose(page).locator('table')).toHaveCount(2)
})
