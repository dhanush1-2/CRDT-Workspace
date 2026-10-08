import { test, expect, type Page } from '@playwright/test'
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

const LABEL = 'e2e-glass-shell'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('the canvas background never intercepts a click', async ({ page }) => {
  await page.goto('/login')

  // Whatever sits at the centre of the viewport, it must not be the canvas.
  const tag = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    return el?.className ?? ''
  })
  expect(String(tag)).not.toContain('canvas')

  // Pinned directly, because nothing observable depends on it yet: on screens
  // whose content fills the viewport the content wrapper's z-index already wins,
  // so removing pointer-events:none changes nothing visible. It stops being
  // redundant the moment a screen is shorter than the viewport.
  const pointerEvents = await page
    .locator('[class*="canvas-background_canvas"]')
    .evaluate((el) => getComputedStyle(el).pointerEvents)
  expect(pointerEvents).toBe('none')

  // And the sign-in button is still genuinely clickable.
  await expect(page.getByTestId('signin-github')).toBeVisible()
  await page.getByTestId('signin-github').click({ trial: true })
})

test('the paint splatter canvas itself has pointer-events none', async ({ page }) => {
  await page.goto('/login')

  // Read on the splatter element, not on .canvas: pointer-events inherits, so a
  // check on the parent would still pass if this element were ever given an
  // explicit pointer-events of its own.
  const pointerEvents = await page
    .getByTestId('paint-splatter')
    .evaluate((el) => getComputedStyle(el).pointerEvents)
  expect(pointerEvents).toBe('none')
})

/**
 * A frame of the splatter canvas as a PNG data URL, plus whether it has been
 * drawn to at all (a blank canvas of the same size serialises differently).
 */
async function splatterFrame(page: Page) {
  return page.getByTestId('paint-splatter').evaluate((el) => {
    const canvas = el as HTMLCanvasElement
    const blank = document.createElement('canvas')
    blank.width = canvas.width
    blank.height = canvas.height
    const url = canvas.toDataURL()
    return { url, drawn: url !== blank.toDataURL() }
  })
}

async function waitUntilDrawn(page: Page) {
  await expect.poll(async () => (await splatterFrame(page)).drawn).toBe(true)
}

test('the tiles and the People card sit on raised glass, not the shared token', async ({
  page,
}) => {
  const label = `${LABEL}-glassfill`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  // Both this rule and ui.glass are single-class, so whichever stylesheet the
  // bundler emits last would win on equal specificity. This is the check that the
  // intended one does.
  const raised = 'rgba(255, 255, 255, 0.7)'

  await page.goto('/')
  await expect(page.getByTestId(`workspace-${workspace.id}`)).toHaveCSS(
    'background-color',
    raised,
  )

  await page.goto(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId(`document-${document.id}`)).toHaveCSS(
    'background-color',
    raised,
  )
  await expect(page.locator('[class*="people"]').first()).toHaveCSS('background-color', raised)

  // The other half: the nav, the sheets and the popovers were not asked to change,
  // so the shared light-glass token must still be .55. Raising it would satisfy every
  // assertion above and quietly thicken every glass surface in the app.
  // (Named --glass-bg until the 2026-10-03 token migration renamed it.)
  const token = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--glass-light').trim(),
  )
  expect(token).toBe('rgba(255, 255, 255, 0.55)')

  await cleanup(label)
})

test('a document shows its title and sits below the nav', async ({ page }) => {
  const label = `${LABEL}-docheading`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const heading = page.getByTestId('document-heading')
  await expect(heading).toBeVisible()
  // The owner is an editor, so the heading holds the rename field; its value is the title.
  await expect(page.getByTestId('document-title')).toHaveValue(document.title)
  await expect(heading).toHaveCSS('font-size', '32px')
  await expect(heading).toHaveCSS('font-weight', '600')

  // The gap the design owner asked for: the sheet no longer touches the nav.
  await expect(page.getByTestId('document-page')).toHaveCSS('margin-top', '28px')

  // Said as the reader experiences it, not just as a declared value: the sheet's
  // top edge is clear of the nav's bottom edge.
  const nav = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())!
  const sheet = (await page.getByTestId('document-page').boundingBox())!
  expect(sheet.y).toBeGreaterThanOrEqual(nav.y + nav.height)

  await cleanup(label)
})

test('a board shows its title above the columns', async ({ page }) => {
  const label = `${LABEL}-boardheading`
  const { owner, workspace } = await seedWorkspace(label)
  const board = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)
  await page.goto(documentPath(board))

  // The board used to hide its title (clipped to 1px) because the design had no slot
  // for one. The owner asked to rename a board from inside it, which needs the title on
  // screen, so it is now a real, visible heading with the rename field in it. Still the
  // page's only heading, and still no document sheet around the board.
  const heading = page.getByTestId('document-heading')
  await expect(heading).toHaveCount(1)
  await expect(heading).toBeVisible()
  await expect(page.getByTestId('document-title')).toHaveValue(board.title)
  // A real box, not the 1px clip it used to be.
  const box = await heading.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThan(100)
  expect(box!.height).toBeGreaterThan(10)
  await expect(page.getByTestId('document-page')).toHaveCount(0)

  await cleanup(label)
})

test('the nav is a pill sized to its contents and centred', async ({ page }) => {
  const label = `${LABEL}-navpill`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(documentPath(document))

  const nav = page.getByRole('navigation', { name: 'Primary' })
  const box = (await nav.boundingBox())!

  // Comfortably narrower than the viewport. Edge to edge would be 1568 here, which
  // is what it was before the strip stopped growing.
  expect(box.width).toBeLessThan(1200)
  // Equal space either side, within a pixel of rounding.
  expect(Math.abs(box.x - (1600 - (box.x + box.width)))).toBeLessThanOrEqual(1)

  await cleanup(label)
})

test('the dashboard nav labels the slot where tabs would be', async ({ page }) => {
  const label = `${LABEL}-navcontext`
  const { owner } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto('/')

  // With a content-sized bar an unlabelled slot is a visible hole rather than
  // slack, which is why this arrives with the pill and not later.
  await expect(page.getByTestId('nav-context')).toHaveText('Workspaces')
  await expect(page.getByTestId('tab-overview')).toHaveCount(0)

  await cleanup(label)
})

test('the board title sits below the nav, the columns follow it, and they are centred', async ({ page }) => {
  const label = `${LABEL}-boardcentre`
  const { owner, workspace } = await seedWorkspace(label)
  const board = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(documentPath(board))
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')

  await page.getByTestId('add-column').click()
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(1)

  const scroller = page.locator('[class*="scroller"]').first()
  // Was 44px below the nav. The title now fills that space: it sits 24px under the nav
  // and the columns start 20px under the title.
  await expect(scroller).toHaveCSS('padding-top', '20px')
  const nav = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())!
  const title = (await page.getByTestId('document-heading').boundingBox())!
  const firstColumn = (await page.locator('[data-testid^="column-"]').first().boundingBox())!
  expect(title.y - (nav.y + nav.height)).toBeCloseTo(24, 0)
  const gap = firstColumn.y - (title.y + title.height)
  expect(gap).toBeGreaterThanOrEqual(20)
  expect(gap).toBeLessThanOrEqual(28)

  // One column, so the row is far narrower than the window and must be centred.
  const box = (await scroller.boundingBox())!
  expect(box.width).toBeLessThan(600)
  expect(Math.abs(box.x - (1600 - (box.x + box.width)))).toBeLessThanOrEqual(1)

  await cleanup(label)
})

/**
 * Samples a measurement off the page on every frame while `act` runs.
 *
 * Re-queries the element each frame on purpose. The nav is rebuilt on every
 * navigation, so the thing being measured is a *different node* before and after --
 * which is exactly what these two tests are about: the new node has to start where
 * the old one left off rather than at nothing.
 */
async function sampleEachFrame(
  page: Page,
  mode: 'pill-in-strip' | 'nav-width',
  act: () => Promise<void>,
): Promise<number[]> {
  const sampling = page.evaluate(async (what) => {
    const out: number[] = []
    const start = performance.now()
    while (performance.now() - start < 1400) {
      if (what === 'nav-width') {
        const nav = document.querySelector('nav[aria-label="Primary"]')
        if (nav) out.push(nav.getBoundingClientRect().width)
      } else {
        // The pill's offset INSIDE the strip, not its position in the viewport.
        // The bar is centred and resizes at the same time, which moves every tab
        // sideways -- so a viewport-relative x drifts smoothly whether or not the
        // pill itself is animating, and an earlier version of this test passed with
        // the fix removed.
        const pill = document.querySelector('[class*="indicator"]')
        const strip = document.querySelector('[class*="strip"]')
        if (pill && strip) {
          out.push(pill.getBoundingClientRect().x - strip.getBoundingClientRect().x)
        }
      }
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return out
  }, mode)
  await act()
  return sampling
}

/** A tab's offset inside the strip, measured the same way the pill is. */
async function tabOffset(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).evaluate((el) => {
    const strip = el.closest('[class*="strip"]')!
    return el.getBoundingClientRect().x - strip.getBoundingClientRect().x
  })
}

test('the pill slides to the new tab across a navigation instead of appearing there', async ({
  page,
}) => {
  const label = `${LABEL}-pillslide`
  const { owner, workspace } = await seedWorkspace(label)
  const first = await createDocument(workspace.id, 'doc')
  const second = await prisma.document.create({
    data: { workspaceId: workspace.id, type: 'board', title: 'a much longer second title' },
  })
  await signIn(page, owner.id)
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(documentPath(first))
  await expect(page.getByTestId(`tab-${first.id}`)).toHaveAttribute('data-active', 'true')

  const from = await tabOffset(page, `tab-${first.id}`)
  const samples = await sampleEachFrame(page, 'pill-in-strip', async () => {
    await page.getByTestId(`tab-${second.id}`).click()
    await expect(page.getByTestId(`tab-${second.id}`)).toHaveAttribute('data-active', 'true')
  })
  const to = await tabOffset(page, `tab-${second.id}`)

  expect(Math.abs(to - from)).toBeGreaterThan(20)

  // The property the remembered position actually buys: the pill never leaves the
  // span between the two tabs. Without it the new nav's pill starts at the strip's
  // left edge with width 0, so some frame reads close to zero -- and because that
  // still *moves* towards the destination, it still satisfies the travel assertion
  // below. This is the assertion that fails. (The first samples cannot be used for
  // this: they are the old page's pill, sitting at `from` by definition.)
  expect(samples.length).toBeGreaterThan(0)
  expect(Math.min(...samples)).toBeGreaterThan(Math.min(from, to) - 10)

  // And it travels rather than jumping.
  const low = Math.min(from, to) + 2
  const high = Math.max(from, to) - 2
  expect(samples.filter((x) => x > low && x < high).length).toBeGreaterThan(2)

  await cleanup(label)
})

test('the nav animates to its new width across a navigation', async ({ page }) => {
  const label = `${LABEL}-navbreathe`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.setViewportSize({ width: 1600, height: 900 })

  // The overview has no status pill; a document does, so the bar genuinely changes
  // width between the two.
  await page.goto(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId('tab-overview')).toHaveAttribute('data-active', 'true')
  const before = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())!.width

  const samples = await sampleEachFrame(page, 'nav-width', async () => {
    await page.getByTestId(`tab-${document.id}`).click()
    await expect(page.getByTestId('status')).toBeVisible()
  })
  const after = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())!.width

  expect(after).toBeGreaterThan(before + 20)
  const between = samples.filter((w) => w > before + 2 && w < after - 2)
  expect(between.length).toBeGreaterThan(2)

  await cleanup(label)
})

test('moving between the overview and documents keeps the same nav element', async ({ page }) => {
  const label = `${LABEL}-same-nav`
  const { owner, workspace } = await seedWorkspace(label)
  const first = await createDocument(workspace.id, 'board')
  const second = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(`/workspaces/${workspace.id}`)
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav).toBeVisible()
  // A marker on the DOM node itself. A rebuilt nav is a new node without it.
  await nav.evaluate((el) => el.setAttribute('data-e2e-marker', 'kept'))

  // Overview -> document -> another document -> overview: the two hard directions
  // (different pages) and the easy one (two instances of the same page).
  for (const tab of [`tab-${first.id}`, `tab-${second.id}`, 'tab-overview']) {
    await page.getByTestId(tab).click()
    await expect(page.getByTestId(tab)).toHaveAttribute('data-active', 'true')
    await expect(nav).toHaveAttribute('data-e2e-marker', 'kept')
  }

  await cleanup(label)
})

test('no splatter is painted behind the nav', async ({ page }) => {
  await page.goto('/login')
  await waitUntilDrawn(page)

  const paint = await page.getByTestId('paint-splatter').evaluate((el) => {
    const canvas = el as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    // The canvas is its own, same-origin and never tainted, so getImageData works
    // on it directly -- no scratch copy needed. toDataURL only says "something was
    // drawn"; this has to know *where*.
    const scale = canvas.width / canvas.clientWidth
    const rows = Math.ceil(90 * scale)

    const countOpaque = (y: number, h: number) => {
      if (h <= 0) return 0
      const { data } = ctx.getImageData(0, y, canvas.width, h)
      let n = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n += 1
      return n
    }

    return {
      top: countOpaque(0, rows),
      below: countOpaque(rows, canvas.height - rows),
    }
  })

  // The exclusion zone is empty...
  expect(paint.top).toBe(0)
  // ...and the rest is not. Without this half, a canvas that failed to draw at all
  // would satisfy the assertion above.
  expect(paint.below).toBeGreaterThan(0)
})

// These two are a pair: the reduced-motion half only means something because
// the other half shows the same canvas does change when motion is allowed.
test.describe('paint splatter motion', () => {
  test.describe('with prefers-reduced-motion: reduce', () => {
    test.use({ reducedMotion: 'reduce' })

    test('the canvas is drawn once and then never changes', async ({ page }) => {
      await page.goto('/login')
      await waitUntilDrawn(page)

      const first = await splatterFrame(page)
      await page.waitForTimeout(500)
      const second = await splatterFrame(page)

      expect(second.url).toBe(first.url)
    })
  })

  test('without it, the canvas keeps changing', async ({ page }) => {
    await page.goto('/login')
    await waitUntilDrawn(page)

    const first = await splatterFrame(page)
    // Polled, not slept: a fixed 500ms could straddle two identical frames. The
    // specks shimmer every frame, so a live loop differs within a few of them.
    await expect.poll(async () => (await splatterFrame(page)).url).not.toBe(first.url)
  })
})

// The loop is throttled to about 30 fps. rAF still fires at the display rate, so
// what is counted is draws of the splatter canvas (each draw clears it once).
test('the splatter loop redraws at about 30 fps, not at the display rate', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __splatterDraws: number }
    w.__splatterDraws = 0
    const clear = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.dataset.testid === 'paint-splatter') w.__splatterDraws += 1
      return clear.apply(this, args)
    }
  })
  await page.goto('/login')
  await waitUntilDrawn(page)

  const draws = () => page.evaluate(() => (window as unknown as { __splatterDraws: number }).__splatterDraws)
  const before = await draws()
  await page.waitForTimeout(2000)
  const perSecond = ((await draws()) - before) / 2

  // Unthrottled this is the display rate: 60 at best on a 60 Hz screen, 144 on a
  // fast one. Throttled it is about 30. The floor only guards a stalled loop.
  expect(perSecond).toBeGreaterThan(10)
  expect(perSecond).toBeLessThan(36)
})

test("the viewer's View only pill is actually styled, not bare text", async ({ page }) => {
  const label = `${LABEL}-chips`
  const { workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  await signIn(page, viewer.id)

  await page.goto(`/workspaces/${workspace.id}`)

  // This pill is the one place ui.chip is guarded alone: .viewOnly sets no background
  // of its own. The document tile's type chip also carries ui.chipAccent, and both
  // set a background, so either class could vanish there and this check would pass.
  //
  // A CSS-module class that no longer exists resolves to undefined and the chip
  // renders as plain text — invisible to every assertion that only locates it.
  const background = await page
    .getByTestId('view-only')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(background).not.toBe('rgba(0, 0, 0, 0)')

  await cleanup(label)
})

test('account menu rows centre their labels vertically', async ({ page }) => {
  const label = `${LABEL}-menu`
  const { owner } = await seedWorkspace(label)
  await signIn(page, owner.id)

  await page.goto('/')
  await page.getByLabel('Account').click()

  // The two rows are different elements (a link and a button). Chromium centres
  // a button's label even at display:block but top-aligns a link's, so the rows
  // drift apart unless the row is a flex container. That passes typecheck and
  // every unit test, so measure it: each label's centre must sit on its row's.
  const offsets = await page.getByTestId('account-menu').evaluate((menu) => {
    const rows = [
      menu.querySelector('a[href="/"]'),
      menu.querySelector('button[data-testid="sign-out"]'),
    ] as HTMLElement[]
    return rows.map((row) => {
      const range = document.createRange()
      range.selectNodeContents(row)
      const text = range.getBoundingClientRect()
      const box = row.getBoundingClientRect()
      return text.top + text.height / 2 - (box.top + box.height / 2)
    })
  })

  expect(offsets).toHaveLength(2)
  for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(1)

  await cleanup(label)
})

test('the nav logo actually renders at 36px', async ({ page }) => {
  const label = `${LABEL}-logo`
  const { owner } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto('/')

  // The logo is an empty <span>. An inline non-replaced element ignores width and
  // height, so a missing display:block collapses it to nothing while every locator,
  // typecheck and unit test still passes. Measure the rendered box.
  const box = await page
    .getByRole('link', { name: 'All workspaces' })
    .locator('span')
    .evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
  expect(box.width).toBeCloseTo(36, 0)
  expect(box.height).toBeCloseTo(36, 0)

  await cleanup(label)
})

test('a very long workspace name truncates in the nav instead of scrolling the page', async ({
  page,
}) => {
  const label = `${LABEL}-longname`
  const { owner, workspace } = await seedWorkspace(label)
  await prisma.workspace.update({ where: { id: workspace.id }, data: { name: 'W'.repeat(120) } })
  await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  // Pinned, because the verdict depends on the viewport.
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/workspaces/${workspace.id}`)

  // The workspace link does not wrap, so unless it shrinks, 120 characters
  // widen the nav past the viewport and the page scrolls horizontally.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth - clientWidth).toBeLessThanOrEqual(2)

  await cleanup(label)
})

/**
 * How far the sliding indicator is from the given tab, in px (the larger of the
 * horizontal offset and the width difference). The indicator is server-rendered
 * at width 0 and sized at hydration, and it slides for 0.55s after a change, so
 * callers poll this rather than read it once.
 */
async function indicatorGap(page: Page, tabTestId: string) {
  return page.evaluate((testId) => {
    const indicator = document.querySelector('[class*="indicator"]')
    const tab = document.querySelector(`[data-testid="${testId}"]`)
    if (!indicator || !tab) return Number.POSITIVE_INFINITY
    const a = indicator.getBoundingClientRect()
    const b = tab.getBoundingClientRect()
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.width - b.width))
  }, tabTestId)
}

test('the nav shows a tab per document and marks the open one active', async ({ page }) => {
  const label = `${LABEL}-tabs`
  const { owner, workspace } = await seedWorkspace(label)
  const board = await createDocument(workspace.id, 'board')
  const doc = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(documentPath(board))

  await expect(page.getByTestId('tab-overview')).toBeVisible()
  await expect(page.getByTestId(`tab-${board.id}`)).toHaveAttribute('data-active', 'true')
  await expect(page.getByTestId(`tab-${board.id}`)).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId(`tab-${doc.id}`)).toHaveAttribute('data-active', 'false')
  await expect(page.getByTestId(`tab-${doc.id}`)).not.toHaveAttribute('aria-current')

  // The indicator is measured from the active tab at hydration, so an unsized
  // or misplaced pill means the measurement never ran: the bug this test is for.
  await expect.poll(() => indicatorGap(page, `tab-${board.id}`)).toBeLessThanOrEqual(1)

  await cleanup(label)
})

test('a viewer sees the View only pill after the tabs and an editor does not', async ({ page }) => {
  const label = `${LABEL}-view-only`
  const { workspace } = await seedWorkspace(label)
  const doc = await createDocument(workspace.id, 'doc')
  const viewer = await addMember(workspace.id, label, 'viewer')
  const editor = await addMember(workspace.id, label, 'editor')

  // Both pages compute the role, and both pass it down.
  await signIn(page, viewer.id)
  for (const path of [`/workspaces/${workspace.id}`, documentPath(doc)]) {
    await page.goto(path)
    const pill = page.getByTestId('view-only')
    await expect(pill).toBeVisible()
    await expect(pill).toHaveText('View only')
    const tabs = await page.getByTestId('tab-overview').boundingBox()
    const box = await pill.boundingBox()
    expect(box!.x).toBeGreaterThan(tabs!.x + tabs!.width)
  }

  // The other half: a pill that rendered for everyone would pass the above.
  await page.context().clearCookies()
  await signIn(page, editor.id)
  for (const path of [`/workspaces/${workspace.id}`, documentPath(doc)]) {
    await page.goto(path)
    await expect(page.getByTestId('tab-overview')).toBeVisible()
    await expect(page.getByTestId('view-only')).toHaveCount(0)
  }

  await cleanup(label)
})

test('the indicator tracks the active tab', async ({ page }) => {
  const label = `${LABEL}-slide`
  const { owner, workspace } = await seedWorkspace(label)
  const first = await createDocument(workspace.id, 'board')
  const second = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(documentPath(first))
  await expect.poll(() => indicatorGap(page, `tab-${first.id}`)).toBeLessThanOrEqual(1)

  await page.getByTestId(`tab-${second.id}`).click()
  await expect(page.getByTestId(`tab-${second.id}`)).toHaveAttribute('data-active', 'true')
  // Polled, not slept on: the slide takes 0.55s and the pill has to land on the
  // new tab's box, width included.
  await expect.poll(() => indicatorGap(page, `tab-${second.id}`)).toBeLessThanOrEqual(1)

  await cleanup(label)
})

test('a strip the user has scrolled by hand is not pulled back to the active tab', async ({
  page,
}) => {
  const label = `${LABEL}-scroll`
  const { owner, workspace } = await seedWorkspace(label)
  // Pin the viewport so the document count below means something. The strip
  // shares the nav with the workspace name, so its width depends on that label
  // too. Measured with this label at 1280x720 and "e2e doc" tabs: 9 documents
  // overflow by about 108px, which is the scroll range this test needs. Fewer
  // documents were not measured with this label, so no claim is made about
  // where the strip stops overflowing. If fonts or padding change and it stops
  // overflowing, the premise check below fails loudly rather than the test
  // passing on nothing.
  await page.setViewportSize({ width: 1280, height: 720 })
  const documents = []
  for (let i = 0; i < 9; i++) documents.push(await createDocument(workspace.id, 'doc'))
  await signIn(page, owner.id)

  // The first document, so the active tab sits at the left edge and anything
  // scrolling the strip back toward it would be visible as scrollLeft dropping.
  await page.goto(documentPath(documents[0]!))
  const strip = page.locator('[class*="strip"]')
  await expect(page.getByTestId(`tab-${documents[0]!.id}`)).toHaveAttribute('data-active', 'true')

  // Guard the premise: if the strip does not overflow there is nothing to scroll.
  await expect
    .poll(() => strip.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeGreaterThan(40)

  await strip.hover()
  await page.mouse.wheel(2000, 0)

  // Wait for scrollLeft to hold still for 500ms, which outlasts the start of a
  // smooth scroll-back, instead of sleeping a fixed time and hoping.
  await strip.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        let last = el.scrollLeft
        let since = performance.now()
        const tick = () => {
          if (el.scrollLeft !== last) {
            last = el.scrollLeft
            since = performance.now()
          } else if (performance.now() - since >= 500) {
            resolve()
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )

  const { scrollLeft, max } = await strip.evaluate((el) => ({
    scrollLeft: el.scrollLeft,
    max: el.scrollWidth - el.clientWidth,
  }))
  expect(max).toBeGreaterThan(40)
  expect(scrollLeft).toBeGreaterThanOrEqual(max - 2)

  await cleanup(label)
})

test('a 200-character single-word document title wraps inside its tile', async ({ page }) => {
  const label = `${LABEL}-longtitle`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await prisma.document.create({
    data: { workspaceId: workspace.id, type: 'doc', title: 'W'.repeat(200) },
  })
  await signIn(page, owner.id)

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/workspaces/${workspace.id}`)

  const tile = page.getByTestId(`document-${document.id}`)
  await expect(tile).toBeVisible()

  // An unbreakable word has a huge min-content width. Without overflow-wrap on the
  // text column it stretches the tile (and the grid column with it), so the text
  // runs past the tile's right edge and the page scrolls sideways.
  const { textRight, tileRight, tileScroll, tileClient, pageOverflow } = await tile.evaluate(
    (el) => {
      const text = el.querySelector('span:last-child > span:first-child')!.getBoundingClientRect()
      return {
        textRight: text.right,
        tileRight: el.getBoundingClientRect().right,
        tileScroll: el.scrollWidth,
        tileClient: el.clientWidth,
        pageOverflow:
          window.document.documentElement.scrollWidth -
          window.document.documentElement.clientWidth,
      }
    },
  )
  expect(textRight).toBeLessThanOrEqual(tileRight)
  expect(tileScroll).toBeLessThanOrEqual(tileClient)
  expect(pageOverflow).toBeLessThanOrEqual(0)

  await cleanup(label)
})

test('the nav status pill shows Synced on a document and does not exist on the dashboard', async ({
  page,
}) => {
  const label = `${LABEL}-status`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(documentPath(document))
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  // The visible text is the human label, not the raw status value.
  await expect(page.getByTestId('status')).toHaveText('Synced')

  // Nothing is published on the dashboard, so the pill renders nothing at all.
  await page.goto('/')
  await expect(page.getByTestId('search')).toBeVisible()
  await expect(page.getByTestId('status')).toHaveCount(0)

  await cleanup(label)
})

test('a document sits on the 780px glass sheet and a board does not', async ({ page }) => {
  const label = `${LABEL}-sheet`
  const { owner, workspace } = await seedWorkspace(label)
  const doc = await createDocument(workspace.id, 'doc')
  const board = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)

  // Reads max-width and radius for an element's whole ancestor chain, so the check does
  // not depend on how many wrappers sit between the sheet and the content.
  const sheetAbove = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.maxWidth === '780px') {
          return {
            radius: style.borderTopLeftRadius,
            paddingTop: style.paddingTop,
            paddingBottom: style.paddingBottom,
            width: node.getBoundingClientRect().width,
          }
        }
      }
      return null
    })

  await page.goto(documentPath(doc))
  await expect(page.locator('.editor .ProseMirror')).toBeVisible()
  const sheet = await sheetAbove('.editor')
  expect(sheet).not.toBeNull()
  expect(sheet!.radius).toBe('30px')
  expect(sheet!.paddingTop).toBe('56px')
  expect(sheet!.paddingBottom).toBe('96px')
  expect(sheet!.width).toBeLessThanOrEqual(780)

  // The temporary 24px editor padding is gone; the sheet owns the padding now.
  const editorPadding = await page
    .locator('.editor .ProseMirror')
    .evaluate((el) => getComputedStyle(el).paddingLeft)
  expect(editorPadding).toBe('0px')

  // The board is a horizontal scroller with its own gutters: no 780px ancestor.
  await page.goto(documentPath(board))
  await expect(page.getByTestId('add-column')).toBeVisible()
  expect(await sheetAbove('[data-testid="add-column"]')).toBeNull()

  await cleanup(label)
})

test('alone in a document the pill says Synced, not a count of one', async ({ page }) => {
  const label = `${LABEL}-alone`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(documentPath(document))
  // Counting yourself when there is nobody else would make this "1 here", which
  // tells the reader nothing. The design's copy for that state is "Synced".
  await expect(page.getByTestId('status')).toHaveText('Synced')

  await cleanup(label)
})

test('the nav condenses once the page is scrolled, with a dead band on the way back', async ({
  page,
}) => {
  const label = `${LABEL}-condense`
  const { owner, workspace } = await seedWorkspace(label)
  // Enough tiles for the overview to be taller than a short viewport.
  for (let i = 0; i < 8; i++) await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.setViewportSize({ width: 1280, height: 420 })
  await page.goto(`/workspaces/${workspace.id}`)

  const bar = page.getByTestId('nav-bar')
  await expect(bar).toHaveAttribute('data-condensed', 'false')

  // Guard the premise: nothing below means anything if the page cannot scroll.
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  )
  expect(scrollable).toBeGreaterThan(100)

  const tall = (await bar.boundingBox())!
  expect(Math.round(tall.height)).toBe(56)
  expect(Math.round(tall.y)).toBe(12)

  const wrapHeight = () =>
    bar.evaluate((el) => (el.parentElement as HTMLElement).offsetHeight)
  expect(await wrapHeight()).toBe(68)

  await page.evaluate(() => window.scrollTo(0, 40))
  await expect(bar).toHaveAttribute('data-condensed', 'true')
  // Polled: the height and the gap are transitioned over 0.4s.
  await expect.poll(async () => Math.round((await bar.boundingBox())!.height)).toBe(46)
  await expect.poll(async () => Math.round((await bar.boundingBox())!.y)).toBe(6)
  // The wrapper's in-flow box must not change with the bar, or the page shifts under the
  // user and the state can oscillate (see the entry test below).
  expect(await wrapHeight()).toBe(68)

  // Inside the dead band. A single 24px threshold would flip back here, and every
  // flip re-renders the whole nav; jitter around the threshold would strobe it.
  // Sampled every frame for half a second rather than read once, because the state
  // is set from a rAF after the scroll event: a single read can pass before it flips.
  // This covers leaving the condensed side into the band (scrollY 18, between 12 and
  // 24). Entering the band from above is the next test.
  const states = await page.evaluate(async () => {
    window.scrollTo(0, 18)
    const seen: string[] = []
    const bar = document.querySelector('[data-testid="nav-bar"]')!
    const start = performance.now()
    await new Promise<void>((resolve) => {
      const frame = () => {
        seen.push(bar.getAttribute('data-condensed')!)
        if (performance.now() - start < 500) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
    return seen
  })
  expect(states.length).toBeGreaterThan(10)
  expect(new Set(states)).toEqual(new Set(['true']))
  await expect(bar).toHaveAttribute('data-condensed', 'true')

  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(bar).toHaveAttribute('data-condensed', 'false')
  await expect.poll(async () => Math.round((await bar.boundingBox())!.height)).toBe(56)

  await cleanup(label)
})

test('a page loaded already scrolled starts condensed', async ({ page }) => {
  const label = `${LABEL}-condense-load`
  const { owner, workspace } = await seedWorkspace(label)
  for (let i = 0; i < 8; i++) await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.setViewportSize({ width: 1280, height: 420 })
  await page.goto(`/workspaces/${workspace.id}#people-heading`)

  // A listener alone never fires here: the browser restores or jumps the scroll
  // position without a scroll event the effect can hear.
  await expect(page.getByTestId('nav-bar')).toHaveAttribute('data-condensed', 'true')

  await cleanup(label)
})

test('entering the dead band from above never makes the nav oscillate', async ({ page }) => {
  const label = `${LABEL}-condense-entry`
  const { owner, workspace } = await seedWorkspace(label)
  for (let i = 0; i < 8; i++) await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.setViewportSize({ width: 1280, height: 420 })

  // Each rest position just past the condense threshold, reached from the top. If
  // condensing shortens the page (a sticky wrapper that changes its in-flow height),
  // scroll anchoring pulls scrollY back under the expand threshold and the bar flips
  // again, forever. So: at most one flip, and scrollY must stay where the user put it.
  for (let y = 20; y <= 32; y++) {
    await page.goto(`/workspaces/${workspace.id}`)
    await expect(page.getByTestId('nav-bar')).toHaveAttribute('data-condensed', 'false')

    const trace = await page.evaluate(async (target) => {
      window.scrollTo(0, target)
      const bar = document.querySelector('[data-testid="nav-bar"]')!
      const states: string[] = []
      const ys: number[] = []
      const start = performance.now()
      await new Promise<void>((resolve) => {
        const frame = () => {
          states.push(bar.getAttribute('data-condensed')!)
          ys.push(window.scrollY)
          if (performance.now() - start < 1500) requestAnimationFrame(frame)
          else resolve()
        }
        requestAnimationFrame(frame)
      })
      return { states, ys }
    }, y)

    const flips = trace.states.filter((s, i) => i > 0 && s !== trace.states[i - 1]).length
    expect(flips, `flips at y=${y}: ${trace.ys.join(',')}`).toBeLessThanOrEqual(1)
    expect(trace.ys.at(-1), `settled scrollY at y=${y}`).toBe(y)
  }

  await cleanup(label)
})

test('History is offered on a document, explains itself, and closes cleanly', async ({ page }) => {
  const label = `${LABEL}-history`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  // Not on the overview: the design puts History among the per-document controls.
  await page.goto(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId('history')).toHaveCount(0)

  await page.goto(documentPath(document))
  const button = page.getByTestId('history')
  await expect(button).toBeVisible()
  await expect(button).toHaveAttribute('aria-expanded', 'false')

  await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  const panel = page.getByTestId('history-panel')
  await expect(panel).toBeVisible()
  // It must not imply it works. Whatever the wording, it has to say it is not here yet.
  await expect(panel).toContainText('not available yet')

  // Clicking the button leaves it focused, so Escape would pass this check even with
  // no focus return. Clicking the panel's text moves focus to the body first.
  await panel.getByText('Version history is not available yet').click()
  await expect(button).not.toBeFocused()

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  // Escape without a focus return leaves the keyboard at the top of the document.
  await expect(button).toBeFocused()

  // A click elsewhere closes it too.
  await button.click()
  await expect(panel).toBeVisible()
  await page.getByTestId('search').click()
  await expect(panel).toHaveCount(0)
  await page.keyboard.press('Escape')

  await cleanup(label)
})

test('below 760px the tab strip becomes a dropdown', async ({ page }) => {
  const label = `${LABEL}-narrow-tabs`
  const { owner, workspace } = await seedWorkspace(label)
  const first = await createDocument(workspace.id, 'doc')
  const second = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(documentPath(first))
  await expect(page.getByTestId('tab-overview')).toBeVisible()
  await expect(page.getByTestId('nav-menu')).toBeHidden()
  // One element, not two. A duplicated testid breaks every existing tab assertion.
  await expect(page.getByTestId('tab-overview')).toHaveCount(1)

  await page.setViewportSize({ width: 700, height: 800 })
  await expect(page.getByTestId('tab-overview')).toBeHidden()
  // The workspace name hides here too (handoff 5.5).
  await expect(page.getByTestId('workspace-link')).toBeHidden()
  const trigger = page.getByTestId('nav-menu')
  await expect(trigger).toBeVisible()
  // It names where you are, which is the one thing the strip showed that a single
  // button has to keep.
  await expect(trigger).toContainText(first.title)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('nav-menu-item-overview')).toBeVisible()
  await expect(page.getByTestId(`nav-menu-item-${first.id}`)).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByTestId(`nav-menu-item-${second.id}`)).not.toHaveAttribute('aria-current')

  await page.getByTestId(`nav-menu-item-${second.id}`).click()
  await expect(page).toHaveURL(documentPath(second))
  // The nav survives the navigation now, so a menu left open would stay open over
  // the new page.
  await expect(page.getByTestId(`nav-menu-item-${second.id}`)).toHaveCount(0)
  await expect(trigger).toContainText(second.title)

  await trigger.click()
  // Clicking the trigger leaves it focused, so Escape would pass the focus check with
  // no focus return. Move focus into the list first, without closing it.
  await page.getByTestId('nav-menu-item-overview').focus()
  await expect(trigger).not.toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('nav-menu-item-overview')).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await cleanup(label)
})

test('at 760px the nav does not force the page to scroll sideways', async ({ page }) => {
  const label = `${LABEL}-760`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.setViewportSize({ width: 760, height: 800 })
  await page.goto(documentPath(document))
  await expect(page.getByTestId('nav-menu')).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  await cleanup(label)
})

test('the dropdown trigger carries the presence dot the strip would', async ({ browser }) => {
  const label = `${LABEL}-menu-dot`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  const open = async (userId: string) => {
    const context = await browser.newContext({ viewport: { width: 700, height: 800 } })
    await context.addCookies([await sessionCookieFor(userId)])
    const page = await context.newPage()
    // Sync through the server so the two browsers see each other's awareness.
    await page.goto(`${documentPath(document)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    return { context, page }
  }

  const a = await open(owner.id)
  // Alone: no dot. Asserted first, because a dot that always rendered would pass below.
  await expect(a.page.getByTestId('nav-menu')).toBeVisible()
  await expect(a.page.getByTestId('nav-menu-dot')).toHaveCount(0)

  const b = await open(editor.id)
  await expect(a.page.getByTestId('nav-menu-dot')).toBeVisible()
  await expect(b.page.getByTestId('nav-menu-dot')).toBeVisible()
  await expect(a.page.getByTestId('nav-menu').getByTestId('nav-menu-dot')).toHaveCount(1)

  // The disconnected half is a unit test (doc-state.test.ts, hasOthersHere): y-websocket
  // only reports 'disconnected' for an instant after ~30s offline, so it cannot be held
  // long enough to assert on. Both dots read that one derivation.

  await a.context.close()
  await b.context.close()
  await cleanup(label)
})

test('on a document you are in the people group, before History and the status pill', async ({ page }) => {
  const label = `${LABEL}-self`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const self = page.getByTestId('presence-self')
  await expect(self).toBeVisible()
  await expect(self).toHaveAttribute('aria-label', /\(you\)/)

  // Order along the bar: people, History, status, Share, account.
  const order = await page.getByRole('navigation', { name: 'Primary' }).evaluate((nav) =>
    ['presence', 'history', 'status', 'share', 'account-trigger'].map((id) => {
      const el = nav.querySelector(`[data-testid="${id}"]`)
      return el ? el.getBoundingClientRect().left : Number.NaN
    }),
  )
  expect(order.every((x) => !Number.isNaN(x))).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)

  await page.goto(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId('presence')).toHaveCount(0)
  await cleanup(label)
})

test('the account button does not look like a person in the document', async ({ page }) => {
  const label = `${LABEL}-account-look`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const self = page.getByTestId('presence-self')
  const account = page.getByTestId('account-trigger')
  const fill = (locator: typeof self) => locator.evaluate((el) => getComputedStyle(el).backgroundColor)
  // The people group is filled with each person's colour; the account button is not.
  expect(await fill(account)).toBe('rgb(255, 255, 255)')
  expect(await fill(self)).not.toBe('rgb(255, 255, 255)')
  await cleanup(label)
})

test('moving between two busy documents does not collapse the nav', async ({ page, browser }) => {
  const label = `${LABEL}-no-collapse`
  const peerContext = await browser.newContext()
  try {
    const { owner, workspace } = await seedWorkspace(label)
    const first = await createDocument(workspace.id, 'doc')
    const second = await createDocument(workspace.id, 'doc')
    const peer = await addMember(workspace.id, label, 'editor')

    // One other person sits in both documents (two tabs), so both read "2 here" with two avatars.
    await peerContext.addCookies([await sessionCookieFor(peer.id)])
    for (const document of [first, second]) {
      const tab = await peerContext.newPage()
      await tab.goto(`${documentPath(document)}?nobc=1`)
      await expect(tab.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    }

    await signIn(page, owner.id)
    await page.goto(`${documentPath(first)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveText('2 here')
    const bar = page.getByRole('navigation', { name: 'Primary' })
    // Let the bar finish arriving on this document: the first load animates it a little as
    // the people and the status settle, and a start measured mid-way is not a width to keep.
    let last = -1
    await expect
      .poll(async () => {
        const width = (await bar.boundingBox())!.width
        const settled = Math.abs(width - last) < 0.05
        last = width
        return settled
      }, { intervals: [300] })
      .toBe(true)
    const start = (await bar.boundingBox())!.width

    const samples = page.evaluate(async () => {
      const nav = document.querySelector('nav[aria-label="Primary"]')!
      const out: number[] = []
      const t0 = performance.now()
      while (performance.now() - t0 < 2000) {
        out.push(nav.getBoundingClientRect().width)
        await new Promise((r) => requestAnimationFrame(r))
      }
      return out
    })
    await page.getByTestId(`tab-${second.id}`).click()
    const widths = await samples
    await expect(page.getByTestId('status')).toHaveText('2 here')

    // Never narrower than where it started, by more than rounding.
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(start - 2)
  } finally {
    await peerContext.close()
    await cleanup(label)
  }
})

test('moving on again while the bar is still animating holds its width until the next document connects', async ({ page, browser }) => {
  const label = `${LABEL}-rapid-switch`
  const peerContext = await browser.newContext()
  try {
    const { owner, workspace } = await seedWorkspace(label)
    const first = await createDocument(workspace.id, 'doc')
    const second = await createDocument(workspace.id, 'doc')
    const third = await createDocument(workspace.id, 'doc')
    const peer = await addMember(workspace.id, label, 'editor')

    // One other person is in the first and third documents and nobody is in the second. So
    // the bar is wide on the first, narrow on the second, and wide again on the third.
    await peerContext.addCookies([await sessionCookieFor(peer.id)])
    for (const document of [first, third]) {
      const tab = await peerContext.newPage()
      await tab.goto(`${documentPath(document)}?nobc=1`)
      await expect(tab.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    }

    // The second and third documents take a moment to connect, so each move spends a while
    // in the connecting state.
    for (const document of [second, third]) {
      await page.route(`**/api/documents/${document.id}/token`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 900))
        await route.continue()
      })
    }

    await signIn(page, owner.id)
    await page.goto(`${documentPath(first)}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveText('2 here')
    const bar = page.getByRole('navigation', { name: 'Primary' })
    let last = -1
    await expect
      .poll(async () => {
        const width = (await bar.boundingBox())!.width
        const settled = Math.abs(width - last) < 0.05
        last = width
        return settled
      }, { intervals: [300] })
      .toBe(true)

    // Move to the second document. The moment it connects, its bar starts animating down to
    // its own narrow width; move on to the third right then, while that is running. The third
    // is still connecting, and from there the bar must stay where it is until the third
    // arrives, not run on down to the second's width and come back up.
    const { widths, clicked } = await page.evaluate(
      async ({ secondId, thirdId }) => {
        const nav = document.querySelector('nav[aria-label="Primary"]')!
        const active = (id: string) =>
          document.querySelector(`[data-testid="tab-${id}"]`)?.getAttribute('data-active') === 'true'
        const out: number[] = []
        let clickedSecond = false
        let clickedThird = false
        let thirdIsActive = false
        const t0 = performance.now()
        while (performance.now() - t0 < 6000) {
          const width = nav.getBoundingClientRect().width
          if (!clickedSecond) {
            clickedSecond = true
            ;(document.querySelector(`[data-testid="tab-${secondId}"]`) as HTMLElement).click()
          } else if (
            !clickedThird &&
            active(secondId) &&
            document.querySelector('[data-testid="status"]')?.textContent === 'Synced'
          ) {
            clickedThird = true
            ;(document.querySelector(`[data-testid="tab-${thirdId}"]`) as HTMLElement).click()
          }
          // From the frame the third document becomes the open one until it has connected.
          if (!thirdIsActive && active(thirdId)) thirdIsActive = true
          const connected =
            document.querySelector('[data-testid="status"]')?.getAttribute('data-status') === 'connected'
          if (thirdIsActive && !connected) out.push(width)
          await new Promise((r) => requestAnimationFrame(r))
        }
        return { widths: out, clicked: clickedThird }
      },
      { secondId: second.id, thirdId: third.id },
    )
    expect(clicked).toBe(true)
    await expect(page.getByTestId('status')).toHaveText('2 here')
    // Where it is when the third document opens is where it stays until that one connects.
    expect(widths.length).toBeGreaterThan(10)
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(widths[0]! - 2)
  } finally {
    await peerContext.close()
    await cleanup(label)
  }
})
