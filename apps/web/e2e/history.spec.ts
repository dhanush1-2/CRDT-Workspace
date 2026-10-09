import { test, expect, type Page } from '@playwright/test'
import * as Y from 'yjs'
import { prisma } from '@crdt/db'
import { cleanup, createDocument, documentPath, seedWorkspace, signIn } from './fixtures.js'

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

test('clicking a row highlights it and nothing else', async ({ page }) => {
  const { owner, document } = await seedThree(labelFor('select'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  const rows = panel.getByTestId('history-row')
  await expect(rows).toHaveCount(3)
  await expect(panel.locator('[aria-current="true"]')).toHaveCount(0)

  await rows.nth(1).click()
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(panel.locator('[aria-current="true"]')).toHaveCount(1)

  await rows.nth(2).click()
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true')
  await expect(panel.locator('[aria-current="true"]')).toHaveCount(1)
  // Selecting changes the highlight only: the panel stays open and the list is intact.
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
  await expect(panel.getByTestId('history-row').nth(2)).toHaveAttribute('aria-current', 'true')

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
