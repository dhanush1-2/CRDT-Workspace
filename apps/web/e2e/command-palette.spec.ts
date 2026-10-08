import { test, expect, type Page } from '@playwright/test'
import { prisma } from '@crdt/db'
import { cleanup, documentPath, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-command-palette'

test.afterAll(async () => {
  await cleanup(LABEL)
})

async function seed(page: Page, label: string) {
  const { owner, workspace } = await seedWorkspace(label)
  const alpha = await prisma.document.create({
    data: { workspaceId: workspace.id, type: 'doc', title: 'Quarterly roadmap' },
  })
  const beta = await prisma.document.create({
    data: { workspaceId: workspace.id, type: 'doc', title: 'Hiring plan' },
  })
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)
  return { workspace, alpha, beta }
}

/**
 * Presses the shortcut until the palette appears. The page is server-rendered, so a
 * key pressed before hydration reaches no listener; retrying is safe because opening
 * an already-open palette is a no-op.
 */
async function openWith(page: Page, shortcut: string) {
  await expect(async () => {
    await page.keyboard.press(shortcut)
    await expect(page.getByTestId('palette')).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 10_000 })
}

/** The click path, retried for the same hydration reason as openWith. */
async function openByClick(page: Page) {
  await expect(async () => {
    await page.getByTestId('search').click()
    await expect(page.getByTestId('palette')).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 10_000 })
}

test('Meta+K opens the palette', async ({ page }) => {
  const label = `${LABEL}-meta`
  await seed(page, label)
  await expect(page.getByTestId('palette')).toHaveCount(0)

  await openWith(page, 'Meta+k')
  await expect(page.getByTestId('palette-input')).toBeFocused()

  await cleanup(label)
})

test('Control+K opens the palette', async ({ page }) => {
  const label = `${LABEL}-control`
  await seed(page, label)
  await expect(page.getByTestId('palette')).toHaveCount(0)

  await openWith(page, 'Control+k')
  await expect(page.getByTestId('palette-input')).toBeFocused()

  await cleanup(label)
})

test('typing filters the list', async ({ page }) => {
  const label = `${LABEL}-filter`
  const { alpha, beta } = await seed(page, label)

  await openWith(page, 'Control+k')
  await expect(page.getByTestId(`palette-item-doc-${alpha.id}`)).toBeVisible()
  await expect(page.getByTestId(`palette-item-doc-${beta.id}`)).toBeVisible()

  await page.getByTestId('palette-input').fill('road')
  await expect(page.getByTestId(`palette-item-doc-${alpha.id}`)).toBeVisible()
  await expect(page.getByTestId(`palette-item-doc-${beta.id}`)).toHaveCount(0)

  await cleanup(label)
})

test('ArrowDown then Enter navigates to the selected document', async ({ page }) => {
  const label = `${LABEL}-navigate`
  const { alpha, beta } = await seed(page, label)

  await openWith(page, 'Control+k')
  // Documents come first in the list, so the first two options are the two seeded ones.
  const options = page.getByRole('option')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  const first = await options.first().getAttribute('data-testid')

  await page.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  const second = await options.nth(1).getAttribute('data-testid')
  expect(second).not.toBe(first)

  await page.keyboard.press('Enter')

  const target = [alpha, beta].find((document) => second === `palette-item-doc-${document.id}`)
  if (!target) throw new Error(`the second option was not a document: ${second}`)
  await expect(page).toHaveURL(documentPath(target))
  await expect(page.getByTestId('palette')).toHaveCount(0)

  await cleanup(label)
})

test('Escape closes the palette and returns focus to the search control', async ({ page }) => {
  const label = `${LABEL}-escape`
  await seed(page, label)

  await openByClick(page)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette')).toHaveCount(0)
  await expect(page.getByTestId('search')).toBeFocused()

  await cleanup(label)
})

test('Escape after the keyboard shortcut returns focus to the search button', async ({ page }) => {
  const label = `${LABEL}-shortcut-focus`
  await seed(page, label)

  // Opened from the keyboard, so nothing but <body> held focus beforehand.
  await openWith(page, 'Control+k')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette')).toHaveCount(0)
  await expect(page.getByTestId('search')).toBeFocused()

  await cleanup(label)
})

test('Tab and Shift+Tab never leave the palette', async ({ page }) => {
  const label = `${LABEL}-trap`
  await seed(page, label)

  await openWith(page, 'Control+k')
  const insidePalette = () =>
    page.getByTestId('palette').evaluate((el) => el.contains(document.activeElement))

  // The input is the palette's only focusable control, and it is rendered after
  // <main>, so without a trap one Tab lands in the nav behind the overlay, where
  // Share, the tabs and the user menu are still operable. Press well past one lap.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    expect(await insidePalette(), `focus left the palette after ${i + 1} Tab presses`).toBe(true)
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab')
    expect(await insidePalette(), `focus left the palette after ${i + 1} Shift+Tab presses`).toBe(true)
  }
  await expect(page.getByTestId('palette-input')).toBeFocused()

  // A click on the list's padding (not an option) drops focus to <body>. Tab from
  // there must come back into the palette, not start from the top of the page behind.
  await page.getByRole('listbox').click({ position: { x: 3, y: 3 } })
  await expect(page.getByTestId('palette')).toBeVisible()
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('palette-input')).toBeFocused()

  await cleanup(label)
})

test('on the dashboard the palette lists the user\'s workspaces by name', async ({ page }) => {
  const label = `${LABEL}-dashboard`
  const { owner, workspace } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto('/')

  await openWith(page, 'Control+k')
  // No current workspace here, so this entry is the palette's only way to one.
  const item = page.getByTestId(`palette-item-ws-${workspace.id}`)
  await expect(item).toBeVisible()
  await expect(item).toContainText(label)

  await item.click()
  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspace.id}$`))

  await cleanup(label)
})

test('with no matches the combobox is collapsed and points at nothing', async ({ page }) => {
  const label = `${LABEL}-empty`
  await seed(page, label)

  await openWith(page, 'Control+k')
  const input = page.getByRole('combobox')
  await expect(input).toHaveAttribute('aria-expanded', 'true')
  await expect(input).toHaveAttribute('aria-controls', 'palette-list')

  await input.fill('zzzzzz-no-such-thing')
  await expect(page.getByText('No matches')).toBeVisible()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  // The list is not rendered, so claiming it is expanded, or naming it as the
  // controlled element, points assistive tech at nothing.
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  await expect(input).not.toHaveAttribute('aria-controls')
  await expect(input).not.toHaveAttribute('aria-activedescendant')

  await input.fill('')
  await expect(input).toHaveAttribute('aria-expanded', 'true')
  await expect(input).toHaveAttribute('aria-controls', 'palette-list')

  await cleanup(label)
})

test('the search button opens the palette as a combobox over a listbox', async ({ page }) => {
  const label = `${LABEL}-button`
  await seed(page, label)

  await openByClick(page)

  const input = page.getByRole('combobox')
  const list = page.getByRole('listbox')
  await expect(input).toHaveAttribute('aria-expanded', 'true')
  await expect(input).toHaveAttribute('aria-controls', (await list.getAttribute('id'))!)
  const active = await input.getAttribute('aria-activedescendant')
  await expect(page.locator(`#${active}`)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCount(0)

  await cleanup(label)
})
