import { test, expect, type Page } from '@playwright/test'
import * as Y from 'yjs'
import { addCard, addColumn } from '@crdt/shared/board'
import { prisma } from '@crdt/db'
import {
  addMember,
  cleanup,
  createDocument,
  documentPath,
  seedWorkspace,
  sessionCookieFor,
  signIn,
} from './fixtures.js'

// One label per test, all swept after each one so a failure cannot leave rows in the
// shared database. No label is a prefix of another: cleanup matches users by
// `${label}-` and workspaces by exact name.
const labels: string[] = []
function labelFor(name: string): string {
  const label = `e2e-history-${name}`
  labels.push(label)
  return label
}

test.afterEach(async () => {
  for (const label of labels.splice(0)) await cleanup(label)
})

const STATE_REQUEST = /\/api\/documents\/[^/]+\/history\/\d+$/
const LIST_REQUEST = /\/api\/documents\/[^/]+\/history\?/

/** Successive updates to one paragraph: the first creates it with `texts[0]`, the rest append. */
function paragraphUpdates(texts: string[]): Uint8Array[] {
  const doc = new Y.Doc()
  const updates: Uint8Array[] = []
  doc.on('update', (update: Uint8Array) => updates.push(update))
  const paragraph = new Y.XmlElement('paragraph')
  const text = new Y.XmlText()
  doc.transact(() => {
    doc.getXmlFragment('default').insert(0, [paragraph])
    paragraph.insert(0, [text])
    text.insert(0, texts[0]!)
  })
  for (const more of texts.slice(1)) text.insert(text.length, more)
  return updates
}

type Seed = { userId: string | null; update: Uint8Array; minutesAgo: number }

/**
 * Inserted straight through Prisma, in order, so ids rise with the list. The null
 * author cannot be made through the app (a version with no author is one written before
 * authorship existed, or by an account since deleted).
 */
async function seedVersions(documentId: string, seeds: Seed[]) {
  for (const seed of seeds) {
    await prisma.documentUpdate.create({
      data: {
        documentId,
        update: Buffer.from(seed.update),
        clientId: 'e2e',
        userId: seed.userId,
        createdAt: new Date(Date.now() - seed.minutesAgo * 60_000),
      },
    })
  }
}

async function author(label: string, name: string) {
  return prisma.user.create({ data: { email: `${label}-${name.toLowerCase()}@e2e.test`, name } })
}

/** Three versions, an hour apart, so none groups with another: Grace, nobody, Heidi. */
async function seedThree(label: string) {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const grace = await author(label, 'Grace')
  const heidi = await author(label, 'Heidi')
  const [created, ...rest] = paragraphUpdates(['Hello', ' world', '!!'])
  await seedVersions(document.id, [
    { userId: grace.id, update: created!, minutesAgo: 180 },
    { userId: null, update: rest[0]!, minutesAgo: 120 },
    { userId: heidi.id, update: rest[1]!, minutesAgo: 60 },
  ])
  return { owner, workspace, document }
}

async function openPanel(page: Page) {
  await page.getByTestId('history').click()
  const panel = page.getByTestId('history-panel')
  await expect(panel).toBeVisible()
  return panel
}

test('the panel opens from the History button and is headed "History"', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('open'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)

  await expect(panel.getByRole('heading', { name: 'History' })).toBeVisible()
  await expect(page.getByTestId('history')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#history-panel')).toBeVisible()
})

test('it lists one row per version, newest first, each with an author and a time', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('list'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const rows = panel.getByTestId('history-row')

  await expect(rows).toHaveCount(3)
  // Newest first: Heidi wrote last, Grace first.
  await expect(rows.nth(0)).toContainText('Heidi')
  await expect(rows.nth(1)).toContainText('Unknown')
  await expect(rows.nth(2)).toContainText('Grace')
  // "Grace · Sep 30, 16:40": a short date and a 24-hour time.
  for (let i = 0; i < 3; i++) {
    await expect(rows.nth(i)).toContainText(/ · [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}/)
  }
})

test('a version by a deleted or pre-authorship author reads "Unknown", not blank', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('unknown'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const row = panel.getByTestId('history-row').nth(1)

  await expect(row.getByTestId('history-row-author')).toHaveText('Unknown')
})

test('a row carries a derived description, not a raw id', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('describe'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const descriptions = panel.getByTestId('history-row-description')

  // The first version has nothing before it; the others are insertions at the end.
  await expect(descriptions.nth(2)).toHaveText('Created the document')
  await expect(descriptions.nth(1)).toHaveText('Added 6 characters')
  await expect(descriptions.nth(0)).toHaveText('Added 2 characters')
  for (let i = 0; i < 3; i++) await expect(descriptions.nth(i)).not.toHaveText(/^\d+$/)
})

test('clicking a row marks it pressed, one at a time, and leaves the list intact', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('select'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const rows = panel.getByTestId('history-row')
  await expect(rows).toHaveCount(3)
  await expect(panel.locator('[aria-pressed="true"]')).toHaveCount(0)

  await rows.nth(1).click()
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.locator('[aria-pressed="true"]')).toHaveCount(1)

  await rows.nth(2).click()
  await expect(rows.nth(2)).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.locator('[aria-pressed="true"]')).toHaveCount(1)
  // Selecting does not close the panel or disturb the list.
  await expect(rows).toHaveCount(3)
})

test('the close button closes the panel and returns focus to the History button', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('close'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  await panel.getByRole('button', { name: 'Close history' }).click()

  await expect(panel).toHaveCount(0)
  await expect(page.getByTestId('history')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('history')).toBeFocused()
})

test('a keyboard user lands in the panel on open, can Tab through it, and Escape comes back', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('keyboard'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const button = page.getByTestId('history')
  await button.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByTestId('history-panel')
  await expect(panel).toBeVisible()

  // The panel is portalled to the end of <body>, so without a focus move the next Tab
  // would walk the rest of the nav, the toolbar and the editor before reaching it.
  // The heading, so a screen reader announces the panel it has just entered.
  await expect(panel.getByRole('heading', { name: 'History' })).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(panel.getByRole('button', { name: 'Close history' })).toBeFocused()
  // Rows must exist before the next Tab, or it would leave a still-loading panel.
  await expect(panel.getByTestId('history-row')).toHaveCount(3)
  await page.keyboard.press('Tab')
  await expect(panel.getByTestId('history-row').first()).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(button).toBeFocused()
})

test('opening with the mouse also lands focus in the panel, with no ring on the heading', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('mousefocus'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const heading = panel.getByRole('heading', { name: 'History' })

  await expect(heading).toBeFocused()
  expect(await heading.evaluate((el) => el.matches(':focus-visible'))).toBe(false)
})

test('a document with no updates shows an empty state, not a spinner forever', async ({ page }) => {
  const label = labelFor('empty')
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)

  await expect(panel.getByTestId('history-empty')).toBeVisible()
  await expect(panel.getByTestId('history-row')).toHaveCount(0)
  await expect(panel.getByTestId('history-loading')).toHaveCount(0)
})

test('a failed fetch shows an error the user can retry from, not an empty list', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('error'))
  await signIn(page, owner.id)
  // Failing until told otherwise, not "fail the first call": React's dev-mode double
  // mount makes the first call a discarded one.
  let failing = true
  await page.route(LIST_REQUEST, (route) =>
    failing
      ? route.fulfill({ status: 500, json: { error: 'database is on fire' } })
      : route.continue(),
  )
  await page.goto(documentPath(document))

  const panel = await openPanel(page)

  await expect(panel.getByRole('alert')).toContainText('database is on fire')
  await expect(panel.getByTestId('history-empty')).toHaveCount(0)
  await expect(panel.getByTestId('history-row')).toHaveCount(0)

  failing = false
  await panel.getByRole('button', { name: 'Try again' }).click()

  await expect(panel.getByTestId('history-row')).toHaveCount(3)
  await expect(panel.getByRole('alert')).toHaveCount(0)
})

test('the panel is a tall column at the right of the page, not confined to the nav', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('geometry'))
  await signIn(page, owner.id)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  // Let the g-side entrance finish: it slides in from 28px to the right.
  await expect(panel.getByTestId('history-row')).toHaveCount(3)
  await expect.poll(async () => Math.round((await panel.boundingBox())!.x)).toBe(1280 - 16 - 330)

  const box = (await panel.boundingBox())!
  expect(Math.round(box.width)).toBe(330)
  // Fixed to the viewport (top 84, bottom 16), not to the 68px nav it was opened from.
  expect(Math.round(box.y)).toBe(84)
  expect(Math.round(box.y + box.height)).toBe(800 - 16)
  expect(box.height).toBeGreaterThan(300)

  const main = (await page.locator('main').boundingBox())!
  expect(box.x).toBeGreaterThan(main.x + main.width / 2)
  // Not a DOM descendant of the nav, whose backdrop-filter would contain and flatten it.
  await expect(page.getByTestId('nav-bar').getByTestId('history-panel')).toHaveCount(0)
})

test('the panel follows the nav up when it condenses', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('condense'))
  await signIn(page, owner.id)
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.goto(documentPath(document))
  // Tall enough to scroll, whatever the document holds.
  await page.evaluate(() => {
    document.querySelector('main')!.style.minHeight = '3000px'
  })

  const panel = await openPanel(page)
  await expect.poll(async () => Math.round((await panel.boundingBox())!.y)).toBe(84)

  await page.evaluate(() => window.scrollTo(0, 60))
  await expect(page.getByTestId('nav-bar')).toHaveAttribute('data-condensed', 'true')
  // Transitioned over 0.4s with the nav.
  await expect.poll(async () => Math.round((await panel.boundingBox())!.y)).toBe(68)

  // Opened while already condensed: lands at 68 without starting from 84.
  await panel.getByRole('button', { name: 'Close history' }).click()
  await page.getByTestId('history').click()
  await expect(page.getByTestId('history-panel')).toBeVisible()
  await expect.poll(async () => Math.round((await page.getByTestId('history-panel').boundingBox())!.y)).toBe(68)
})

test('a version is fetched once: reopening the panel or selecting a row asks for nothing new', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('cache'))
  await signIn(page, owner.id)
  const stateRequests: string[] = []
  page.on('request', (request) => {
    if (STATE_REQUEST.test(request.url())) stateRequests.push(request.url())
  })
  await page.goto(documentPath(document))

  let panel = await openPanel(page)
  const descriptions = panel.getByTestId('history-row-description')
  await expect(descriptions.nth(0)).toHaveText('Added 2 characters')
  await expect(descriptions.nth(1)).toHaveText('Added 6 characters')
  // Three versions need three states: each row's own, and the older neighbour's, which
  // is another row's own.
  expect(stateRequests).toHaveLength(3)

  await panel.getByRole('button', { name: 'Close history' }).click()
  panel = await openPanel(page)
  await expect(panel.getByTestId('history-row-description').nth(0)).toHaveText('Added 2 characters')
  await panel.getByTestId('history-row').nth(1).click()
  await panel.getByTestId('history-row').nth(2).click()
  await expect(panel.getByTestId('history-row').nth(2)).toHaveAttribute('aria-pressed', 'true')

  expect(stateRequests).toHaveLength(3)
})

test('only rows on screen are described, and the rest are when they scroll into view', async ({
  page,
}) => {
  const label = labelFor('lazy')
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const texts = Array.from({ length: 30 }, (_, i) => `${i % 10}`)
  const updates = paragraphUpdates(texts)
  // 30 versions, an hour apart, all by one author.
  await seedVersions(
    document.id,
    updates.map((update, i) => ({ userId: owner.id, update, minutesAgo: (30 - i) * 60 })),
  )
  await signIn(page, owner.id)
  await page.setViewportSize({ width: 1280, height: 800 })
  const stateRequests: string[] = []
  page.on('request', (request) => {
    if (STATE_REQUEST.test(request.url())) stateRequests.push(request.url())
  })
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const rows = panel.getByTestId('history-row')
  await expect(rows).toHaveCount(30)
  const descriptions = panel.getByTestId('history-row-description')
  await expect(descriptions.nth(0)).toHaveText('Added 1 character')

  // Never all of them up front. Only what is on screen, plus a neighbour for the last.
  await expect.poll(() => stateRequests.length).toBeGreaterThan(3)
  expect(stateRequests.length).toBeLessThan(20)
  // The oldest row is far below the fold: still waiting.
  await expect(descriptions.nth(29)).toHaveText('…')

  await rows.nth(29).scrollIntoViewIfNeeded()
  await expect(descriptions.nth(29)).toHaveText('Created the document')
})

test('a version too large to preview stays listed, described by its change count', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('toolarge'))
  const middle = await prisma.documentUpdate.findMany({
    where: { documentId: document.id },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  const tooLargeId = middle[1]!.id.toString()
  await signIn(page, owner.id)
  await page.route(`**/api/documents/${document.id}/history/${tooLargeId}`, (route) =>
    route.fulfill({ status: 413, json: { error: 'too large to preview' } }),
  )
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const rows = panel.getByTestId('history-row')
  const descriptions = panel.getByTestId('history-row-description')

  await expect(rows).toHaveCount(3)
  // The row whose own state is refused, and the newer row that needed it as "before".
  await expect(descriptions.nth(1)).toHaveText('1 change')
  await expect(descriptions.nth(0)).toHaveText('1 change')
  // The oldest never needed it.
  await expect(descriptions.nth(2)).toHaveText('Created the document')
  // The panel as a whole is fine.
  await expect(panel.getByRole('alert')).toHaveCount(0)
})

test('the oldest row of a truncated list is not called the creation of the document', async ({
  page,
}) => {
  const label = labelFor('truncated')
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  // One more version than the panel asks for (50), so the oldest has history behind it.
  const updates = paragraphUpdates(Array.from({ length: 51 }, (_, i) => `${i % 10}`))
  await seedVersions(
    document.id,
    updates.map((update, i) => ({ userId: owner.id, update, minutesAgo: (51 - i) * 60 })),
  )
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const rows = panel.getByTestId('history-row')
  await expect(rows).toHaveCount(50)

  await rows.nth(49).scrollIntoViewIfNeeded()
  // Its predecessor is not in the list, so there is nothing to compare it with.
  await expect(rows.nth(49).getByTestId('history-row-description')).toHaveText('1 change')
})

// --- Previewing a version ---------------------------------------------------------

/**
 * A board's history: version one (180 minutes ago) is one column holding "Old card";
 * version two (60 minutes ago) adds "Newer card". Returns the ids the tests look for.
 */
async function seedBoard(label: string) {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'board')
  const doc = new Y.Doc()
  const updates: Uint8Array[] = []
  doc.on('update', (update: Uint8Array) => updates.push(update))
  addColumn(doc, { id: 'col-a', title: 'Todo' })
  addCard(doc, { id: 'old', title: 'Old card', columnId: 'col-a' })
  addCard(doc, { id: 'newer', title: 'Newer card', columnId: 'col-a' })
  await seedVersions(document.id, [
    { userId: owner.id, update: updates[0]!, minutesAgo: 180 },
    { userId: owner.id, update: updates[1]!, minutesAgo: 180 },
    { userId: owner.id, update: updates[2]!, minutesAgo: 60 },
  ])
  return { owner, workspace, document }
}

const editorText = (page: Page) => page.getByTestId('version-preview').locator('.ProseMirror')

test('previewing an older version of a board shows that moment, without the newer card', async ({
  page,
}) => {
  const { owner, document } = await seedBoard(labelFor('board-preview'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))
  await expect(page.getByTestId('card-newer')).toBeVisible()

  const panel = await openPanel(page)
  await panel.getByTestId('history-row').nth(1).click()

  const preview = page.getByTestId('version-preview')
  await expect(preview).toBeVisible()
  await expect(preview.getByTestId('card-old')).toContainText('Old card')
  await expect(preview.getByTestId('card-newer')).toHaveCount(0)
  // The live board is not on screen at the same time as the preview.
  await expect(page.getByTestId('card-newer')).toHaveCount(0)
})

test('the live board is untouched underneath: closing the preview brings the newer card back', async ({
  browser,
}) => {
  const label = labelFor('board-isolation')
  const { owner, workspace, document } = await seedBoard(label)
  const peer = await addMember(workspace.id, label, 'editor')
  const before = await prisma.documentUpdate.count({ where: { documentId: document.id } })

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  try {
    await contextA.addCookies([await sessionCookieFor(owner.id)])
    await contextB.addCookies([await sessionCookieFor(peer.id)])
    const page = await contextA.newPage()
    const peerPage = await contextB.newPage()
    await page.goto(`${documentPath(document)}?nobc=1`)
    await peerPage.goto(`${documentPath(document)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(peerPage.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(page.getByTestId('card-newer')).toBeVisible()

    const panel = await openPanel(page)
    await panel.getByTestId('history-row').nth(1).click()
    await expect(page.getByTestId('version-preview').getByTestId('card-old')).toBeVisible()

    // While A previews, B adds a card to the live board. The preview is a past moment
    // and must not show it; the live document underneath must still receive it.
    await peerPage.getByTestId('add-card-col-a').click()
    await expect(peerPage.locator('article[data-testid^="card-"]')).toHaveCount(3)
    await expect(page.getByTestId('version-preview').locator('article[data-testid^="card-"]')).toHaveCount(1)

    await panel.getByRole('button', { name: 'Close history' }).click()

    await expect(page.getByTestId('version-preview')).toHaveCount(0)
    await expect(page.locator('article[data-testid^="card-"]')).toHaveCount(3)
    await expect(page.getByTestId('card-newer')).toContainText('Newer card')
    await expect(page.getByTestId('card-old')).toContainText('Old card')
    // Previewing wrote nothing: the only new row is the peer's card.
    await expect.poll(() => prisma.documentUpdate.count({ where: { documentId: document.id } })).toBe(before + 1)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test('a board preview has no add, delete, rename or drag controls', async ({ page }) => {
  const { owner, document } = await seedBoard(labelFor('board-readonly'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))
  // Contrast: the live board has them all, so their absence below means something.
  await expect(page.getByTestId('add-column')).toBeVisible()
  await expect(page.getByTestId('add-card-col-a')).toBeVisible()
  await expect(page.locator('[draggable="true"]')).not.toHaveCount(0)
  await expect(page.getByTestId('col-title-col-a')).toHaveJSProperty('tagName', 'INPUT')

  const panel = await openPanel(page)
  await panel.getByTestId('history-row').nth(1).click()
  const preview = page.getByTestId('version-preview')
  await expect(preview.getByTestId('card-old')).toBeVisible()

  await expect(page.getByTestId('add-column')).toHaveCount(0)
  await expect(page.getByTestId('add-card-col-a')).toHaveCount(0)
  await expect(page.getByTestId('col-delete-col-a')).toHaveCount(0)
  await expect(preview.getByRole('button')).toHaveCount(0)
  await expect(preview.locator('input, textarea, [contenteditable="true"]')).toHaveCount(0)
  await expect(preview.locator('[draggable="true"]')).toHaveCount(0)
  // The column's title is text, and so is the board's: no title input anywhere on the page.
  await expect(preview.getByTestId('col-title-col-a')).toHaveText('Todo')
  await expect(page.getByTestId('document-title')).toHaveCount(0)
  await expect(page.getByTestId('document-heading')).toHaveText('e2e board')
})

test('previewing an older version of a document shows that moment\'s text', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('doc-preview'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))
  await expect(page.locator('.ProseMirror')).toContainText('Hello world!!')

  const panel = await openPanel(page)
  await panel.getByTestId('history-row').nth(2).click()
  await expect(editorText(page)).toHaveText('Hello')

  await panel.getByTestId('history-row').nth(1).click()
  await expect(editorText(page)).toHaveText('Hello world')
})

test('a document preview cannot be typed into, and the live text is unchanged afterwards', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('doc-readonly'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))
  const before = await prisma.documentUpdate.count({ where: { documentId: document.id } })

  const panel = await openPanel(page)
  await panel.getByTestId('history-row').nth(2).click()
  const text = editorText(page)
  await expect(text).toHaveText('Hello')
  await expect(text).toHaveAttribute('contenteditable', 'false')

  await text.click()
  await page.keyboard.type('zzz')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await expect(text).toHaveText('Hello')

  // No editing affordance anywhere in it: no toolbar, a plain title, no inputs.
  await expect(page.getByTestId('tb-root')).toHaveCount(0)
  await expect(page.getByTestId('document-title')).toHaveCount(0)
  await expect(page.getByTestId('document-heading')).toHaveText('e2e doc')
  await expect(page.getByTestId('version-preview').locator('input, textarea, button')).toHaveCount(0)

  await panel.getByRole('button', { name: 'Close history' }).click()
  await expect(page.getByTestId('version-preview')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toHaveText('Hello world!!')
  expect(await prisma.documentUpdate.count({ where: { documentId: document.id } })).toBe(before)
})

test('a preview that cannot be fetched leaves the live document on screen with an error', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('preview-fails'))
  const rows = await prisma.documentUpdate.findMany({
    where: { documentId: document.id },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  const failingId = rows[1]!.id.toString()
  await signIn(page, owner.id)
  await page.route(`**/api/documents/${document.id}/history/${failingId}`, (route) =>
    route.fulfill({ status: 500, json: { error: 'database is on fire' } }),
  )
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  await panel.getByTestId('history-row').nth(1).click()

  await expect(page.getByTestId('preview-notice')).toContainText('Could not load that version')
  await expect(page.getByTestId('version-preview')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toHaveText('Hello world!!')
  await expect(panel.getByTestId('history-row').nth(1)).toHaveAttribute('aria-pressed', 'true')

  // Another version still previews, and the notice goes.
  await panel.getByTestId('history-row').nth(2).click()
  await expect(editorText(page)).toHaveText('Hello')
  await expect(page.getByTestId('preview-notice')).toHaveCount(0)
})

test('a version too large to preview says so, keeps the live document, and never shows a blank page', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('preview-toolarge'))
  const rows = await prisma.documentUpdate.findMany({
    where: { documentId: document.id },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  await signIn(page, owner.id)
  await page.route(`**/api/documents/${document.id}/history/${rows[1]!.id}`, (route) =>
    route.fulfill({ status: 413, json: { error: 'too large to preview' } }),
  )
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  await panel.getByTestId('history-row').nth(1).click()

  await expect(page.getByTestId('preview-notice')).toHaveText('This version is too large to preview.')
  await expect(page.getByTestId('version-preview')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toHaveText('Hello world!!')
})

test('clicking inside the preview keeps the panel open; clicking elsewhere closes both', async ({
  page,
}) => {
  const { owner, document } = await seedBoard(labelFor('outside-click'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  await panel.getByTestId('history-row').nth(1).click()
  const preview = page.getByTestId('version-preview')
  await expect(preview.getByTestId('card-old')).toBeVisible()

  await preview.getByTestId('card-old').click()
  await expect(panel).toBeVisible()
  await expect(preview).toBeVisible()

  // The strip above the nav bar: part of neither the panel nor the preview.
  await page.mouse.click(640, 3)
  await expect(panel).toHaveCount(0)
  // The preview belongs to the open panel: it goes with it.
  await expect(preview).toHaveCount(0)
  await expect(page.getByTestId('card-newer')).toBeVisible()
})

test('selecting a row keeps focus in the panel and Escape still closes it', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('focus'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const row = panel.getByTestId('history-row').nth(2)
  await row.click()
  await expect(editorText(page)).toHaveText('Hello')
  await expect(row).toBeFocused()
  // Not pulled back to the heading by the selection: that is for opening only.
  await expect(panel.getByRole('heading', { name: 'History' })).not.toBeFocused()

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(editorText(page)).toHaveCount(0)
  await expect(page.getByTestId('history')).toBeFocused()
})

test('the selected row is previewed even while the list\'s description fetches are waiting', async ({
  page,
}) => {
  const label = labelFor('priority')
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const letters = 'ABCDEFGH'.split('')
  await seedVersions(
    document.id,
    paragraphUpdates(letters).map((update, i) => ({
      userId: owner.id,
      update,
      minutesAgo: (letters.length - i) * 60,
    })),
  )
  const ids = (
    await prisma.documentUpdate.findMany({
      where: { documentId: document.id },
      orderBy: { id: 'desc' },
      select: { id: true },
    })
  ).map((row) => row.id.toString())

  await signIn(page, owner.id)
  // Every state request is held, except the one for the row about to be clicked.
  let wanted: string | null = null
  const held: string[] = []
  let letGo: () => void = () => {}
  const gate = new Promise<void>((resolve) => (letGo = resolve))
  await page.route(STATE_REQUEST, async (route) => {
    const id = route.request().url().split('/').pop()!
    if (id === wanted) return route.continue()
    held.push(id)
    await gate
    await route.continue().catch(() => {})
  })
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  await expect(panel.getByTestId('history-row')).toHaveCount(8)
  // Two background fetches are in flight and held; the rest are waiting behind them.
  await expect.poll(() => held.length).toBe(2)

  // Any row whose fetch has not been sent yet. Which two went first is up to the order
  // the rows scrolled into view, so pick from what is left rather than assuming.
  const row = ids.findIndex((id, i) => i >= 2 && !held.includes(id))
  wanted = ids[row]!
  await panel.getByTestId('history-row').nth(row).click()
  // Row r from the top is version 8 - r of 8: its first 8 - r letters.
  await expect(editorText(page)).toHaveText(letters.slice(0, letters.length - row).join(''))
  // Still just the two held background fetches: nothing else was waiting on the preview.
  expect(held).toHaveLength(2)

  letGo()
})

test('a preview fades in over 0.4s, and not at all under reduced motion', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('fade'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  // A name that matches no keyframes still reads as an animation in computed style (the
  // app-wide hashed-name bug), so ask the browser whether one is actually running. It
  // lasts 0.4s, so watch for it from inside the page rather than racing it from here.
  await page.evaluate(() => {
    const w = window as unknown as { sawFade: boolean }
    w.sawFade = false
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="version-preview"]')
      if (el && el.getAnimations().length > 0) w.sawFade = true
    }).observe(document.body, { childList: true, subtree: true })
  })
  await panel.getByTestId('history-row').nth(2).click()
  const preview = page.getByTestId('version-preview')
  await expect(preview).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as unknown as { sawFade: boolean }).sawFade)).toBe(true)
  const animation = () =>
    preview.evaluate((el) => {
      const style = getComputedStyle(el)
      return `${style.animationName} ${style.animationDuration}`
    })
  expect(await animation()).toMatch(/fade.* 0\.4s$/)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await panel.getByTestId('history-row').nth(1).click()
  await expect(editorText(page)).toHaveText('Hello world')
  expect((await animation()).startsWith('none')).toBe(true)
})

test('the preview is announced: a labelled region, and a status that names the version', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('announce'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))
  // Present and empty before anything is chosen, so a screen reader hears it change.
  await expect(page.getByTestId('preview-status')).toHaveText('')
  await expect(page.getByRole('region', { name: /Earlier version/ })).toHaveCount(0)

  const panel = await openPanel(page)
  await panel.getByTestId('history-row').nth(2).click()

  await expect(page.getByRole('region', { name: 'Earlier version of this document' })).toBeVisible()
  const announcement = page.getByTestId('preview-status')
  await expect(announcement).toHaveText(/^Showing the version from [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}, by Grace\.$/)
  await expect(announcement).toHaveAttribute('role', 'status')

  await panel.getByTestId('history-row').nth(1).click()
  await expect(announcement).toHaveText(/, by Unknown\.$/)
})

test('a board preview is labelled as a board', async ({ page }) => {
  const { owner, document } = await seedBoard(labelFor('announce-board'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))
  const panel = await openPanel(page)
  await panel.getByTestId('history-row').nth(1).click()
  await expect(page.getByRole('region', { name: 'Earlier version of this board' })).toBeVisible()
})

test('a failed preview can be retried by choosing the same row again, with no stale notice', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('retry'))
  const rows = await prisma.documentUpdate.findMany({
    where: { documentId: document.id },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  await signIn(page, owner.id)
  let failing = true
  let slow = false
  await page.route(`**/api/documents/${document.id}/history/${rows[1]!.id}`, async (route) => {
    if (failing) return route.fulfill({ status: 500, json: { error: 'database is on fire' } })
    // The retry takes a moment, so a notice left over from the failure would be visible.
    if (slow) await new Promise((resolve) => setTimeout(resolve, 1000))
    await route.continue()
  })
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const row = panel.getByTestId('history-row').nth(1)
  await row.click()
  await expect(page.getByTestId('preview-notice')).toContainText('Could not load that version')

  failing = false
  slow = true
  await row.click()

  // While the retry is in flight the old notice is gone, not left up until the answer.
  await expect(page.getByTestId('preview-notice')).toHaveCount(0)
  await expect(page.getByTestId('version-preview')).toHaveCount(0)
  await expect(editorText(page)).toHaveText('Hello world')
  await expect(page.getByTestId('preview-notice')).toHaveCount(0)
})

test('choosing the row that is already previewed changes nothing on screen', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('repick'))
  await signIn(page, owner.id)
  const stateRequests: string[] = []
  page.on('request', (request) => {
    if (STATE_REQUEST.test(request.url())) stateRequests.push(request.url())
  })
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  await panel.getByTestId('history-row').nth(2).click()
  await expect(editorText(page)).toHaveText('Hello')
  // Mark the editor's element: a rebuilt editor would not carry the mark.
  await editorText(page).evaluate((el) => el.setAttribute('data-marked', 'yes'))
  const requests = stateRequests.length

  await panel.getByTestId('history-row').nth(2).click()
  await page.waitForTimeout(500)

  await expect(editorText(page)).toHaveText('Hello')
  await expect(editorText(page)).toHaveAttribute('data-marked', 'yes')
  expect(stateRequests).toHaveLength(requests)
})

// --- The slider -------------------------------------------------------------------

const sliderOf = (panel: ReturnType<Page['getByTestId']>) => panel.getByRole('slider', { name: 'Version' })

/** `count` versions an hour apart, each appending a letter, all by the owner. */
async function seedMany(label: string, count: number) {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, count).split('')
  await seedVersions(
    document.id,
    paragraphUpdates(letters).map((update, i) => ({
      userId: owner.id,
      update,
      minutesAgo: (letters.length - i) * 60,
    })),
  )
  const ids = (
    await prisma.documentUpdate.findMany({
      where: { documentId: document.id },
      orderBy: { id: 'desc' },
      select: { id: true },
    })
  ).map((row) => row.id.toString())
  return { owner, document, letters, ids }
}

test('the slider spans every version, from Earliest at the left to Now at the right', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('slider-range'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  await expect(panel.getByTestId('history-row')).toHaveCount(3)
  const slider = sliderOf(panel)

  await expect(slider).toBeEnabled()
  await expect(slider).toHaveAttribute('type', 'range')
  // One position per version, counted from the oldest.
  await expect(slider).toHaveAttribute('min', '0')
  await expect(slider).toHaveAttribute('max', '2')
  // Nothing chosen means the live document: the far right.
  await expect(slider).toHaveValue('2')
  await expect(panel.getByText('Earliest', { exact: true })).toBeVisible()
  await expect(panel.getByText('Now', { exact: true })).toBeVisible()
  const box = (await slider.boundingBox())!
  const earliest = (await panel.getByText('Earliest', { exact: true }).boundingBox())!
  const now = (await panel.getByText('Now', { exact: true }).boundingBox())!
  expect(earliest.x).toBeLessThan(now.x)
  expect(earliest.x).toBeLessThan(box.x + box.width / 2)
  expect(now.x).toBeGreaterThan(box.x + box.width / 2)
})

test('moving the slider to the far right leaves the preview', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('slider-now'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const rows = panel.getByTestId('history-row')
  await rows.nth(2).click()
  await expect(editorText(page)).toHaveText('Hello')
  const slider = sliderOf(panel)
  // The thumb follows a click on a row: Grace's is the oldest of three.
  await expect(slider).toHaveValue('0')

  await slider.focus()
  await page.keyboard.press('End')

  await expect(page.getByTestId('version-preview')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toHaveText('Hello world!!')
  await expect(panel.locator('[aria-pressed="true"]')).toHaveCount(0)
  await expect(slider).toHaveValue('2')
  await expect(slider).toHaveAttribute('aria-valuetext', 'Now')
  // The newest row is where "Now" sits.
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true')
})

test('moving the slider left previews an older version, and the matching row highlights', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('slider-left'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const rows = panel.getByTestId('history-row')
  const slider = sliderOf(panel)
  await expect(rows).toHaveCount(3)

  await slider.fill('1')
  await expect(editorText(page)).toHaveText('Hello world')
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.locator('[aria-pressed="true"]')).toHaveCount(1)
  await expect(rows.nth(0)).not.toHaveAttribute('aria-current', 'true')

  await slider.fill('0')
  await expect(editorText(page)).toHaveText('Hello')
  await expect(rows.nth(2)).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.locator('[aria-pressed="true"]')).toHaveCount(1)
})

test('the keyboard drives the slider: focus it and ArrowLeft moves the selection one step', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('slider-keys'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const rows = panel.getByTestId('history-row')
  await expect(rows).toHaveCount(3)
  const slider = sliderOf(panel)

  // Reachable by Tab: heading, then close, then the slider, then the rows.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(slider).toBeFocused()

  await page.keyboard.press('ArrowLeft')
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(editorText(page)).toHaveText('Hello world')
  // Said aloud as a person and a time, not as "1".
  await expect(slider).toHaveAttribute('aria-valuetext', /^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}, by Unknown$/)

  await page.keyboard.press('ArrowLeft')
  await expect(rows.nth(2)).toHaveAttribute('aria-pressed', 'true')
  await expect(editorText(page)).toHaveText('Hello')
  await expect(slider).toHaveAttribute('aria-valuetext', /, by Grace$/)
  // Focus stayed on the slider throughout.
  await expect(slider).toBeFocused()

  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('version-preview')).toHaveCount(0)
  await expect(slider).toHaveAttribute('aria-valuetext', 'Now')
})

test('a document with one version renders the slider disabled, not broken', async ({ page }) => {
  const label = labelFor('slider-one')
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await seedVersions(document.id, [{ userId: owner.id, update: paragraphUpdates(['Only'])[0]!, minutesAgo: 30 }])
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  await expect(panel.getByTestId('history-row')).toHaveCount(1)
  const slider = sliderOf(panel)

  await expect(slider).toBeVisible()
  await expect(slider).toBeDisabled()
  await expect(slider).toHaveAttribute('max', '0')
  await expect(slider).toHaveValue('0')
  // The row still works on its own.
  await panel.getByTestId('history-row').click()
  await expect(editorText(page)).toHaveText('Only')
})

test('there is no slider while the list is empty or loading', async ({ page }) => {
  const label = labelFor('slider-empty')
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  await expect(panel.getByTestId('history-empty')).toBeVisible()
  await expect(sliderOf(panel)).toHaveCount(0)
})

/**
 * Every state request is held except the preview's: the list's descriptions go out two
 * at a time and sit on the gate, so the others wait behind them in the client's queue and
 * never reach the network. What reaches it beyond those two is therefore a preview fetch,
 * which skips the queue. That is what makes counting requests mean something here; with
 * the descriptions let through, every row on screen would already be cached.
 */
async function holdBackgroundFetches(page: Page) {
  const sent: string[] = []
  let letGo: () => void = () => {}
  const gate = new Promise<void>((resolve) => (letGo = resolve))
  let wanted: string | null = null
  const held: string[] = []
  await page.route(STATE_REQUEST, async (route) => {
    const id = route.request().url().split('/').pop()!
    sent.push(id)
    if (id === wanted) return route.continue()
    held.push(id)
    await gate
    await route.continue().catch(() => {})
  })
  return {
    sent,
    held,
    allow: (id: string) => (wanted = id),
    release: letGo,
  }
}

test('arrowing across several versions quickly fetches only the one it stops on', async ({ page }) => {
  const { owner, document, letters, ids } = await seedMany(labelFor('slider-debounce-keys'), 8)
  await signIn(page, owner.id)
  const requests = await holdBackgroundFetches(page)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const rows = panel.getByTestId('history-row')
  await expect(rows).toHaveCount(8)
  await expect.poll(() => requests.held.length).toBe(2)
  const background = requests.sent.length
  // Row 5 from the top is five steps left of Now. Its fetch is the only one let through.
  requests.allow(ids[5]!)

  const slider = sliderOf(panel)
  await slider.focus()
  for (let step = 1; step <= 5; step++) {
    await page.keyboard.press('ArrowLeft')
    // The highlight is not waiting for the pause: it is already on this step's row.
    await expect(rows.nth(step)).toHaveAttribute('aria-pressed', 'true', { timeout: 150 })
  }

  await expect(editorText(page)).toHaveText(letters.slice(0, letters.length - 5).join(''))
  // One preview fetch, for the version it stopped on, and none for the four it passed.
  expect(requests.sent.slice(background)).toEqual([ids[5]])
  requests.release()
})

test('dragging the thumb across several versions fetches only the one it is released on', async ({
  page,
}) => {
  const { owner, document, letters, ids } = await seedMany(labelFor('slider-debounce-drag'), 8)
  await signIn(page, owner.id)
  const requests = await holdBackgroundFetches(page)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const rows = panel.getByTestId('history-row')
  await expect(rows).toHaveCount(8)
  await expect.poll(() => requests.held.length).toBe(2)
  const background = requests.sent.length
  // The far left is the oldest version, the last row.
  requests.allow(ids[7]!)

  const slider = sliderOf(panel)
  const box = (await slider.boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width - 2, y)
  await page.mouse.down()
  await page.mouse.move(box.x + 2, y, { steps: 14 })
  // Still held down: the highlight has followed the thumb all the way, nothing is previewed yet.
  await expect(rows.nth(7)).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.up()

  await expect(editorText(page)).toHaveText(letters.slice(0, 1).join(''))
  await expect(slider).toHaveValue('0')
  expect(requests.sent.slice(background)).toEqual([ids[7]])
  requests.release()
})

test('the highlight moves over 0.35s, and not at all under reduced motion', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('slider-motion'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const row = panel.getByTestId('history-row').nth(1)
  const transition = () =>
    row.evaluate((el) => {
      const style = getComputedStyle(el)
      return `${style.transitionProperty} ${style.transitionDuration}`
    })
  expect(await transition()).toMatch(/background.* 0\.35s/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect((await transition()).endsWith('0s')).toBe(true)
})

test('the slider is drawn in the accent colour but is still a native range input', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('slider-style'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const slider = sliderOf(panel)
  await expect(slider).toBeVisible()
  expect(await slider.evaluate((el) => el.tagName + ':' + (el as HTMLInputElement).type)).toBe('INPUT:range')
  // Restyled, not the browser's default blue control.
  expect(await slider.evaluate((el) => getComputedStyle(el).appearance)).toBe('none')
  const accent = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
  expect(accent).not.toBe('')
  expect(await slider.evaluate((el) => getComputedStyle(el).accentColor)).toBe(accent)
})
