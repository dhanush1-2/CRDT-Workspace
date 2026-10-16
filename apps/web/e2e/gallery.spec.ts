import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  addMember,
  cleanup,
  createDocument,
  documentPath,
  seedWorkspace,
  settleAnimations,
  signIn,
} from './fixtures.js'

/**
 * The Gallery redesign, screen by screen (docs/superpowers/specs/2026-10-10-gallery-redesign-design.md).
 * Each block reads computed styles on representative elements, so a stylesheet that loses a
 * rule, or a glass value that survives, fails here rather than only on screen.
 */
const LABEL = 'e2e-gallery'

test.afterAll(async () => {
  await cleanup(LABEL)
})

// Gallery's literals as the browser computes them.
const WHITE = 'rgb(255, 255, 255)'
const PAPER_SOFT = 'rgb(251, 251, 249)'
const HAIRLINE = 'rgb(228, 228, 224)'
const RULE = 'rgb(28, 29, 27)'
const INK = 'rgb(22, 22, 22)'
const FLOAT = 'rgba(0, 0, 0, 0.25) 0px 24px 48px -28px'

/** What a colour literal or a var() resolves to, so values are compared as the browser writes them. */
function resolveColour(page: Page, value: string): Promise<string> {
  return page.evaluate((input) => {
    const probe = document.createElement('div')
    probe.style.color = input
    document.body.append(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    return out
  }, value)
}

/** The material of one element: everything Gallery changed about a surface. */
function material(locator: Locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      background: style.backgroundColor,
      backdrop: style.backdropFilter,
      shadow: style.boxShadow,
      radius: style.borderTopLeftRadius,
      borderColor: style.borderTopColor,
      borderWidth: style.borderTopWidth,
    }
  })
}

test.describe('foundation', () => {
  test('Schibsted Grotesk is loaded through next/font and is the page font, at a 15px base', async ({
    page,
  }) => {
    await page.goto('/login')
    const font = await page.evaluate(async () => {
      await document.fonts.ready
      const style = getComputedStyle(document.body)
      return {
        family: style.fontFamily,
        size: style.fontSize,
        loaded: [...document.fonts].some(
          // next/font also emits a metric-matched local Arial face named "… Fallback"; it
          // loads even when the real download failed, so it must not count.
          (face) =>
            /Schibsted/i.test(face.family) &&
            !/Fallback/i.test(face.family) &&
            face.status === 'loaded',
        ),
      }
    })
    expect(font.family).toMatch(/Schibsted/i)
    expect(font.loaded).toBe(true)
    expect(font.size).toBe('15px')
  })

  test('the accent is violet: the sign-in button and the nav logo are filled with it', async ({
    page,
  }) => {
    const label = `${LABEL}-accent`
    const { owner } = await seedWorkspace(label)
    await page.goto('/login')
    const accent = await resolveColour(page, 'var(--accent)')
    expect(accent).toBe(await resolveColour(page, 'oklch(0.5 0.17 290)'))
    await expect(page.getByTestId('signin-github')).toHaveCSS('background-color', accent)

    await signIn(page, owner.id)
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'All workspaces' }).locator('span')).toHaveCSS(
      'background-color',
      accent,
    )
    await cleanup(label)
  })
})

test.describe('canvas, splatter and colour', () => {
  test('the canvas is near-white, its five blobs almost colourless, and the splatter at 0.38', async ({
    page,
  }) => {
    await page.goto('/login')
    await expect(page.locator('[class*="canvas-background_canvas"]')).toHaveCSS(
      'background-color',
      'rgb(246, 246, 244)',
    )
    const blobs = [
      'oklch(0.93 0.004 90)',
      'oklch(0.94 0.004 250)',
      'oklch(0.92 0.003 60)',
      'oklch(0.95 0.003 200)',
      'oklch(0.93 0.004 120)',
    ]
    for (const [index, colour] of blobs.entries()) {
      await expect(page.locator(`[class*="canvas-background_b${index + 1}"]`)).toHaveCSS(
        'background-color',
        await resolveColour(page, colour),
      )
    }
    await expect(page.getByTestId('paint-splatter')).toHaveCSS('opacity', '0.38')
  })

  test('Sign out is plain text, not red', async ({ page }) => {
    const label = `${LABEL}-signout`
    const { owner } = await seedWorkspace(label)
    await signIn(page, owner.id)
    await page.goto('/')
    await page.getByLabel('Account').click()
    await expect(page.getByTestId('sign-out')).toHaveCSS('color', await resolveColour(page, 'var(--text)'))
    await cleanup(label)
  })
})

test.describe('motion', () => {
  /** Records the name of every CSS animation that runs in the first 3s of each page load. */
  async function recordAnimations(page: Page) {
    await page.addInitScript(() => {
      const seen = new Set<string>()
      ;(window as unknown as { __animations: Set<string> }).__animations = seen
      const start = performance.now()
      const sample = () => {
        for (const animation of document.getAnimations()) {
          if (animation instanceof CSSAnimation) seen.add(animation.animationName)
        }
        if (performance.now() - start < 3000) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  }
  const recorded = (page: Page) =>
    page.evaluate(() => [...(window as unknown as { __animations: Set<string> }).__animations])

  test('the shared entrance animations actually run from CSS modules', async ({ page }) => {
    const label = `${LABEL}-motion`
    const { owner } = await seedWorkspace(label)
    await signIn(page, owner.id)
    await recordAnimations(page)
    await page.goto('/')
    // The nav pops in, the dashboard rises, and the canvas blobs drift.
    await expect
      .poll(() => recorded(page))
      .toEqual(expect.arrayContaining(['g-pop', 'g-in', 'g-paint']))
    await cleanup(label)
  })

  test.describe('with prefers-reduced-motion: reduce', () => {
    test.use({ reducedMotion: 'reduce' })

    test('none of them runs', async ({ page }) => {
      const label = `${LABEL}-motion-reduced`
      const { owner } = await seedWorkspace(label)
      await signIn(page, owner.id)
      await recordAnimations(page)
      await page.goto('/')
      await expect(page.getByTestId('nav-bar')).toBeVisible()
      await page.waitForTimeout(1000)
      expect((await recorded(page)).filter((name) => name.startsWith('g-'))).toEqual([])
      await cleanup(label)
    })
  })
})

test.describe('nav', () => {
  test('the bar is solid white with the spec’s edge, square corners, no blur and no shadow', async ({
    page,
  }) => {
    const label = `${LABEL}-navbar`
    const { owner } = await seedWorkspace(label)
    await signIn(page, owner.id)
    await page.goto('/')
    await settleAnimations(page)
    expect(await material(page.getByTestId('nav-bar'))).toEqual({
      background: WHITE,
      backdrop: 'none',
      shadow: 'none',
      radius: '2px',
      borderColor: 'rgba(40, 40, 60, 0.1)',
      borderWidth: '1px',
    })
    const search = await material(page.getByTestId('search'))
    expect(search).toMatchObject({ radius: '2px', shadow: 'none', backdrop: 'none' })
    // The logo stays round, and casts nothing.
    expect(await material(page.getByRole('link', { name: 'All workspaces' }).locator('span'))).toMatchObject({
      radius: '50%',
      shadow: 'none',
    })
    await cleanup(label)
  })

  test('the open tab has violet 600 text over a 2px violet underline; the others are grey 500', async ({
    page,
  }) => {
    const label = `${LABEL}-tabs`
    const { owner, workspace } = await seedWorkspace(label)
    const document = await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.goto(documentPath(document))
    await settleAnimations(page)

    const active = page.getByTestId(`tab-${document.id}`)
    await expect(active).toHaveCSS('color', await resolveColour(page, 'var(--accent-text)'))
    await expect(active).toHaveCSS('font-weight', '600')
    await expect(page.getByTestId('tab-overview')).toHaveCSS('color', 'rgb(95, 98, 93)')
    await expect(page.getByTestId('tab-overview')).toHaveCSS('font-weight', '500')

    const underline = page.locator('[class*="indicator"]')
    const look = await underline.evaluate((el) => {
      const style = getComputedStyle(el)
      const strip = el.parentElement!.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      return {
        height: style.height,
        background: style.backgroundColor,
        radius: style.borderTopLeftRadius,
        backdrop: style.backdropFilter,
        shadow: style.boxShadow,
        bottomGap: Math.abs(strip.bottom - box.bottom),
      }
    })
    expect(look).toMatchObject({
      height: '2px',
      background: await resolveColour(page, 'var(--accent)'),
      radius: '0px',
      backdrop: 'none',
      shadow: 'none',
    })
    expect(look.bottomGap).toBeLessThan(0.5)
    await cleanup(label)
  })

  test('the underline slides: its transform and width move from one tab to the next', async ({ page }) => {
    const label = `${LABEL}-slide`
    const { owner, workspace } = await seedWorkspace(label)
    const first = await createDocument(workspace.id, 'doc')
    const second = await createDocument(workspace.id, 'board')
    await signIn(page, owner.id)
    await page.goto(documentPath(first))
    await settleAnimations(page)

    const underline = page.locator('[class*="indicator"]')
    const read = () => underline.evaluate((el) => getComputedStyle(el).transform)
    const before = await read()
    await expect(underline).toHaveCSS('transition-duration', '0.55s, 0.55s, 0.3s')

    await page.getByTestId(`tab-${second.id}`).click()
    await expect(page.getByTestId(`tab-${second.id}`)).toHaveAttribute('data-active', 'true')
    await expect.poll(read).not.toBe(before)
    await cleanup(label)
  })

  test('the underline is re-measured when the fonts are ready, though nothing resized', async ({ page }) => {
    const label = `${LABEL}-fontsready`
    const { owner, workspace } = await seedWorkspace(label)
    const document = await createDocument(workspace.id, 'doc')
    // document.fonts.ready becomes a promise this test resolves, so "the fonts arrive" is a
    // moment it chooses rather than a race with the network.
    await page.addInitScript(() => {
      let release!: () => void
      const gate = new Promise<FontFaceSet>((resolve) => {
        release = () => resolve(window.document.fonts)
      })
      Object.defineProperty(window.document.fonts, 'ready', { configurable: true, get: () => gate })
      ;(window as unknown as { __releaseFonts: () => void }).__releaseFonts = release
    })
    await signIn(page, owner.id)
    await page.goto(documentPath(document))
    await settleAnimations(page)

    const active = page.getByTestId(`tab-${document.id}`)
    const underline = page.locator('[class*="indicator"]')
    const gap = async () => {
      const [tab, line] = await Promise.all([active.boundingBox(), underline.boundingBox()])
      return { width: Math.abs(tab!.width - line!.width), left: Math.abs(tab!.x - line!.x) }
    }
    expect((await gap()).width).toBeLessThan(1)
    expect((await gap()).left).toBeLessThan(1)

    // Pin the strip's own size, then widen two tabs inside it, the way a web font arriving
    // does: the strip's box does not change, so its ResizeObserver stays silent.
    await underline.evaluate((line) => {
      const strip = line.parentElement!
      strip.style.width = `${strip.getBoundingClientRect().width}px`
      strip.style.flex = 'none'
    })
    await page.addStyleTag({
      content: `[data-testid="tab-overview"] { padding-left: 30px !important; padding-right: 30px !important; }
        [data-testid="tab-${document.id}"] { padding-left: 40px !important; padding-right: 40px !important; }`,
    })
    await expect.poll(async () => (await active.boundingBox())!.width).toBeGreaterThan(80)
    // Several frames on: the underline is still where the narrow tab was.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    await settleAnimations(page)
    const stale = await gap()
    expect(stale.width).toBeGreaterThan(20)
    expect(stale.left).toBeGreaterThan(20)

    // The fonts arrive: the underline is measured again and lands on the tab.
    await page.evaluate(() => (window as unknown as { __releaseFonts: () => void }).__releaseFonts())
    await expect.poll(async () => (await gap()).width, { timeout: 5000 }).toBeLessThan(1)
    await expect.poll(async () => (await gap()).left, { timeout: 5000 }).toBeLessThan(1)
    await cleanup(label)
  })

  test('the nav tweens its width when it is built anew, from the dashboard into a workspace', async ({
    page,
  }) => {
    const label = `${LABEL}-fresh`
    const { owner, workspace } = await seedWorkspace(label)
    await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto('/')
    await settleAnimations(page)
    const width = () => page.getByTestId('nav-bar').evaluate((el) => (el as HTMLElement).offsetWidth)
    const before = await width()

    // offsetWidth, not the bounding box: the new nav also pops in (g-pop scales it), and a
    // scaled box would show "intermediate" widths with no tween at all.
    const sampling = page.evaluate(async () => {
      const out: number[] = []
      const start = performance.now()
      while (performance.now() - start < 1500) {
        const nav = document.querySelector<HTMLElement>('[data-testid="nav-bar"]')
        if (nav) out.push(nav.offsetWidth)
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      return out
    })
    await page.getByTestId(`workspace-${workspace.id}`).click()
    const widths = await sampling
    await expect(page.getByTestId('tab-overview')).toBeVisible()
    await settleAnimations(page)
    const after = await width()

    expect(after).toBeGreaterThan(before + 40)
    expect(widths.filter((w) => w > before + 2 && w < after - 2).length).toBeGreaterThan(2)
    await cleanup(label)
  })

  test.describe('with prefers-reduced-motion: reduce', () => {
    test.use({ reducedMotion: 'reduce' })

    test('the bar never sets a width transition and the underline has a 0s transition', async ({ page }) => {
      const label = `${LABEL}-navreduced`
      const { owner, workspace } = await seedWorkspace(label)
      const document = await createDocument(workspace.id, 'doc')
      await signIn(page, owner.id)
      await page.setViewportSize({ width: 1600, height: 900 })
      await page.goto(`/workspaces/${workspace.id}`)
      await expect(page.getByTestId('tab-overview')).toHaveAttribute('data-active', 'true')
      await expect(page.locator('[class*="indicator"]')).toHaveCSS('transition-duration', '0s')

      // The inline transition, not the inline width: while a document is still connecting the
      // bar is held at its old width (an inline width with `transition: none`), whether or not
      // the user prefers reduced motion. A tween is the one thing that sets an inline width
      // transition, so that is what must never appear.
      const inline = page.evaluate(async () => {
        const out: string[] = []
        const start = performance.now()
        while (performance.now() - start < 1200) {
          out.push((document.querySelector('[data-testid="nav-bar"]') as HTMLElement).style.transition)
          await new Promise((resolve) => requestAnimationFrame(resolve))
        }
        return out
      })
      await page.getByTestId(`tab-${document.id}`).click()
      // No tween ever sets an inline width transition.
      expect((await inline).some((value) => value.includes('width'))).toBe(false)
      await cleanup(label)
    })
  })

  test('the tab strip fades at its right edge only while more tabs are off to the right', async ({
    page,
  }) => {
    const label = `${LABEL}-fade`
    const { owner, workspace } = await seedWorkspace(label)
    await page.setViewportSize({ width: 1280, height: 720 })
    const documents = []
    for (let i = 0; i < 9; i++) documents.push(await createDocument(workspace.id, 'doc'))
    await signIn(page, owner.id)
    await page.goto(documentPath(documents[0]!))
    const strip = page.locator('[class*="strip"]')
    await expect.poll(() => strip.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(40)

    const mask = () => strip.evaluate((el) => getComputedStyle(el).maskImage)
    await expect.poll(mask).toContain('linear-gradient')
    await strip.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
    await expect.poll(mask).toBe('none')
    await cleanup(label)
  })

  test('a syncing status dot pulses in the accent, and stops once connected', async ({ page }) => {
    const label = `${LABEL}-pulse`
    const { owner, workspace } = await seedWorkspace(label)
    const document = await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    // Hold the token so the document stays connecting long enough to look at.
    await page.route(`**/api/documents/${document.id}/token`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000))
      await route.continue()
    })
    await page.goto(documentPath(document))
    const status = page.getByTestId('status')
    await expect(status).toHaveAttribute('data-status', 'connecting')
    const dot = status.locator('[class*="statusDot"]')
    await expect(dot).toHaveCSS('animation-name', 'g-pulse')
    await expect(dot).toHaveCSS('background-color', await resolveColour(page, 'var(--accent)'))
    expect(await dot.evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0)

    await expect(status).toHaveAttribute('data-status', 'connected', { timeout: 15_000 })
    await expect(dot).toHaveCSS('animation-name', 'none')
    await cleanup(label)
  })

  test('the narrow-screen tab menu and the account menu are white floating panels', async ({ page }) => {
    const label = `${LABEL}-navmenus`
    const { owner, workspace } = await seedWorkspace(label)
    const document = await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.setViewportSize({ width: 700, height: 800 })
    await page.goto(documentPath(document))
    await page.getByTestId('nav-menu').click()
    const floating = {
      background: WHITE,
      backdrop: 'none',
      shadow: FLOAT,
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    }
    await settleAnimations(page)
    expect(await material(page.locator('#nav-menu-list'))).toEqual(floating)
    await page.keyboard.press('Escape')

    await page.getByLabel('Account').click()
    await settleAnimations(page)
    expect(await material(page.getByTestId('account-menu'))).toEqual(floating)
    await cleanup(label)
  })
})

test.describe('board', () => {
  /** A board with one column and one card; returns their locators. */
  async function boardWithACard(page: Page, label: string) {
    const { owner, workspace } = await seedWorkspace(label)
    const board = await createDocument(workspace.id, 'board')
    await signIn(page, owner.id)
    await page.goto(documentPath(board))
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await page.getByTestId('add-column').click()
    const column = page.locator('[data-testid^="column-"]').first()
    await expect(column).toBeVisible()
    const columnId = (await column.getAttribute('data-testid'))!.replace('column-', '')
    await page.getByTestId(`add-card-${columnId}`).click()
    const card = column.locator('article[data-testid^="card-"]').first()
    await expect(card).toBeVisible()
    // The new card lands under the pointer (it took the "+ Add a card" button's place),
    // so park the pointer elsewhere: the resting styles are what the first test reads.
    await page.mouse.move(0, 0)
    await settleAnimations(page)
    return { column, card, addCard: page.getByTestId(`add-card-${columnId}`) }
  }

  test('columns are the softer white with a hairline; cards are white with a hairline ring', async ({
    page,
  }) => {
    const label = `${LABEL}-board`
    const { column, card, addCard } = await boardWithACard(page, label)
    expect(await material(column)).toEqual({
      background: PAPER_SOFT,
      backdrop: 'none',
      shadow: 'none',
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    })
    expect(await material(card)).toMatchObject({
      background: WHITE,
      backdrop: 'none',
      shadow: `${HAIRLINE} 0px 0px 0px 1px`,
      radius: '2px',
    })
    expect(await material(addCard)).toMatchObject({ background: WHITE, radius: '2px', borderColor: HAIRLINE })
    const addList = page.getByTestId('add-column')
    await expect(addList).toHaveCSS('border-top-style', 'dashed')
    expect(await material(addList)).toMatchObject({ background: WHITE, radius: '2px', backdrop: 'none', shadow: 'none' })
    await cleanup(label)
  })

  test('a hovered card does not lift; its edge turns dark', async ({ page }) => {
    const label = `${LABEL}-cardhover`
    const { card } = await boardWithACard(page, label)
    await card.hover()
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(`${RULE} 0px 0px 0px 1px`)
    await settleAnimations(page)
    await expect(card).toHaveCSS('transform', 'none')
    await cleanup(label)
  })
})

test.describe('document', () => {
  async function openDoc(page: Page, label: string) {
    const { owner, workspace } = await seedWorkspace(label)
    const document = await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.goto(documentPath(document))
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await settleAnimations(page)
  }

  test('the page is one white sheet with the floating shadow, and the toolbar is a white bar at its top', async ({
    page,
  }) => {
    const label = `${LABEL}-doc`
    await openDoc(page, label)
    expect(await material(page.getByTestId('document-page'))).toEqual({
      background: WHITE,
      backdrop: 'none',
      shadow: FLOAT,
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    })
    expect(await material(page.getByTestId('tb-panel'))).toEqual({
      background: WHITE,
      backdrop: 'none',
      shadow: 'none',
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    })
    const root = page.getByTestId('tb-root')
    await expect(root).toHaveCSS('position', 'sticky')
    await expect(root).toHaveCSS('top', '80px')
    await expect(root).toHaveCSS('padding-top', '10px')
    await cleanup(label)
  })

  test('the open toolbar tab is a white chip in the accent; the others are plain grey', async ({ page }) => {
    const label = `${LABEL}-tbtabs`
    await openDoc(page, label)
    expect(await material(page.getByTestId('tb-tab-home'))).toMatchObject({
      background: WHITE,
      radius: '2px',
      shadow: `${HAIRLINE} 0px 0px 0px 1px`,
    })
    await expect(page.getByTestId('tb-tab-home')).toHaveCSS('color', await resolveColour(page, 'var(--accent)'))
    await expect(page.getByTestId('tb-tab-home')).toHaveCSS('font-weight', '600')
    await expect(page.getByTestId('tb-tab-insert')).toHaveCSS('color', 'rgb(95, 98, 93)')
    await expect(page.getByTestId('tb-tab-insert')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await cleanup(label)
  })

  test('the toolbar takes the floating shadow only while it is stuck', async ({ page }) => {
    const label = `${LABEL}-stuck`
    await page.setViewportSize({ width: 1280, height: 420 })
    await openDoc(page, label)
    const root = page.getByTestId('tb-root')
    const shadow = () => page.getByTestId('tb-panel').evaluate((el) => getComputedStyle(el).boxShadow)
    await expect(root).toHaveAttribute('data-stuck', 'false')
    expect(await shadow()).toBe('none')

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(root).toHaveAttribute('data-stuck', 'true')
    await expect.poll(shadow).toBe(FLOAT)

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(root).toHaveAttribute('data-stuck', 'false')
    await expect.poll(shadow).toBe('none')
    await cleanup(label)
  })

  test('the toolbar re-reads stuck once the nav has condensed and its sticky top has moved', async ({ page }) => {
    const label = `${LABEL}-stuck-condense`
    await page.setViewportSize({ width: 1280, height: 420 })
    await openDoc(page, label)
    const root = page.getByTestId('tb-root')
    // What the position says: the bar is stuck while it sits more than the border below the
    // sheet's top.
    const stuckByPosition = () =>
      root.evaluate((el) => {
        const sheet = el.parentElement!
        return String(el.getBoundingClientRect().top - sheet.getBoundingClientRect().top > 2)
      })

    // A scroll that condenses the nav (past 24px) but leaves the sheet's top (96px at rest)
    // between the bar's two sticky tops, 64px and 80px: the read on the scroll sees the old
    // 80px and says stuck; once the top has moved to 64px the bar rides on the sheet again.
    await page.evaluate(() => window.scrollTo(0, 30))
    await expect(root).toHaveCSS('top', '64px')
    await settleAnimations(page)
    expect(await stuckByPosition()).toBe('false')
    await expect(root).toHaveAttribute('data-stuck', 'false')
    await cleanup(label)
  })

  test('the Style field stays white under the pointer', async ({ page }) => {
    const label = `${LABEL}-field-hover`
    await openDoc(page, label)
    const field = page.getByTestId('tb-style')
    await expect(field).toHaveCSS('background-color', WHITE)
    await field.hover()
    await settleAnimations(page)
    await expect(field).toHaveCSS('background-color', WHITE)
    // A plain tool beside it does take the wash, so the hover really is on.
    const bold = page.getByTestId('tb-bold')
    await bold.hover()
    await settleAnimations(page)
    await expect(bold).toHaveCSS('background-color', await resolveColour(page, 'var(--wash)'))
    await cleanup(label)
  })
})

test.describe('workspace overview', () => {
  async function openOverview(page: Page, label: string) {
    const { owner, workspace } = await seedWorkspace(label)
    const document = await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.goto(`/workspaces/${workspace.id}`)
    await settleAnimations(page)
    return { workspace, document }
  }

  test('the workspace name is a 52px title; Documents and People are small capitals under a dark rule', async ({
    page,
  }) => {
    const label = `${LABEL}-overview-type`
    await openOverview(page, label)
    const title = page.getByRole('heading', { level: 1 })
    await expect(title).toHaveCSS('font-size', '52px')
    await expect(title).toHaveCSS('font-weight', '600')
    await expect(title).toHaveCSS('letter-spacing', '-2.08px')
    await expect(title).toHaveCSS('line-height', '53.04px')
    for (const name of ['Documents', 'People']) {
      const heading = page.getByRole('heading', { level: 2, name })
      await expect(heading).toHaveCSS('font-size', '12px')
      await expect(heading).toHaveCSS('font-weight', '600')
      await expect(heading).toHaveCSS('text-transform', 'uppercase')
      await expect(heading).toHaveCSS('letter-spacing', '1.2px')
      await expect(heading).toHaveCSS('padding-top', '10px')
      await expect(heading).toHaveCSS('border-top', `1px solid ${RULE}`)
    }
    await cleanup(label)
  })

  test('the meta pill, the tiles and the People card are white with a hairline; the create tile is dashed', async ({
    page,
  }) => {
    const label = `${LABEL}-overview-material`
    const { document } = await openOverview(page, label)
    const flat = {
      background: WHITE,
      backdrop: 'none',
      shadow: 'none',
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    }
    expect(await material(page.getByText(/1 document · 1 person/))).toEqual(flat)
    expect(await material(page.getByTestId(`document-${document.id}`))).toEqual(flat)
    expect(await material(page.locator('[class*="people"]').first())).toEqual(flat)
    const kind = page.getByTestId('document-kind')
    await expect(kind).toHaveCSS('background-color', await resolveColour(page, 'var(--accent-tint)'))
    await expect(kind).toHaveCSS('border-top-left-radius', '2px')
    const create = page.locator('[class*="tileCreate"]')
    await expect(create).toHaveCSS('border-top-style', 'dashed')
    expect(await material(create)).toMatchObject({ background: WHITE, radius: '2px', shadow: 'none', backdrop: 'none' })
    await cleanup(label)
  })

  test('a hovered tile does not lift; its edge turns dark', async ({ page }) => {
    const label = `${LABEL}-overview-hover`
    const { document } = await openOverview(page, label)
    const tile = page.getByTestId(`document-${document.id}`)
    await tile.hover()
    await expect.poll(() => tile.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(RULE)
    await settleAnimations(page)
    await expect(tile).toHaveCSS('transform', 'none')
    await expect(tile).toHaveCSS('box-shadow', 'none')
    await cleanup(label)
  })

  test('the tile keeps its dark edge while the pointer is on its rename pencil', async ({ page }) => {
    const label = `${LABEL}-overview-pencil`
    const { document } = await openOverview(page, label)
    const tile = page.getByTestId(`document-${document.id}`)
    // The pencil sits over the tile but is a sibling of it, so the tile's own :hover is off.
    await page.getByTestId(`rename-${document.id}`).hover()
    await expect.poll(() => tile.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(RULE)
    await cleanup(label)
  })

  test('the rename field is set like the tile title it replaces: 18px, weight 600, same family', async ({
    page,
  }) => {
    const label = `${LABEL}-overview-rename`
    const { document } = await openOverview(page, label)
    const tile = page.getByTestId(`document-${document.id}`)
    const title = tile.locator('[class*="docTitle"]')
    const read = (locator: Locator) =>
      locator.evaluate((el) => {
        const style = getComputedStyle(el)
        return { size: style.fontSize, weight: style.fontWeight, family: style.fontFamily }
      })
    const text = await read(title)
    expect(text).toMatchObject({ size: '18px', weight: '600' })
    const tileHeight = async () => (await tile.boundingBox())!.height
    const heightBefore = await tileHeight()
    // The title is replaced by the field, so read its line box before the swap.
    const lineHeight = await title.evaluate((el) => getComputedStyle(el).lineHeight)
    await page.getByTestId(`rename-${document.id}`).click()
    const field = page.getByTestId(`tile-title-${document.id}`)
    await expect(field).toBeFocused()
    expect(await read(field)).toEqual(text)
    // Same type, so the same line box: entering rename does not make the tile jump.
    await expect(field).toHaveCSS('line-height', lineHeight)
    expect(await tileHeight()).toBe(heightBefore)
    await cleanup(label)
  })
})

test.describe('dashboard', () => {
  test('"Workspaces" is a 52px title, tiles are white with a hairline, and the initial is a square', async ({
    page,
  }) => {
    const label = `${LABEL}-dashboard`
    const { owner, workspace } = await seedWorkspace(label)
    await signIn(page, owner.id)
    await page.goto('/')
    await settleAnimations(page)
    const title = page.getByRole('heading', { level: 1, name: 'Workspaces' })
    await expect(title).toHaveCSS('font-size', '52px')
    await expect(title).toHaveCSS('font-weight', '600')
    await expect(title).toHaveCSS('letter-spacing', '-2.08px')
    await expect(title).toHaveCSS('line-height', '53.04px')

    const tile = page.getByTestId(`workspace-${workspace.id}`)
    expect(await material(tile)).toEqual({
      background: WHITE,
      backdrop: 'none',
      shadow: 'none',
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    })
    expect(await material(tile.locator('span').first())).toMatchObject({
      background: await resolveColour(page, 'var(--accent)'),
      radius: '2px',
      shadow: 'none',
    })
    await expect(page.locator('[class*="tileCreate"]')).toHaveCSS('border-top-style', 'dashed')

    await tile.hover()
    await expect.poll(() => tile.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(RULE)
    await settleAnimations(page)
    await expect(tile).toHaveCSS('transform', 'none')
    await expect(tile).toHaveCSS('box-shadow', 'none')
    await cleanup(label)
  })
})

test.describe('sign-in, invite and privacy', () => {
  const card = {
    background: PAPER_SOFT,
    backdrop: 'none',
    shadow: FLOAT,
    radius: '2px',
    borderColor: HAIRLINE,
    borderWidth: '1px',
  }

  test('the sign-in card is the softer white with a hairline and the floating shadow', async ({ page }) => {
    await page.goto('/login')
    await settleAnimations(page)
    expect(await material(page.getByTestId('auth-card'))).toEqual(card)
    expect(await material(page.getByTestId('auth-mark'))).toMatchObject({
      background: await resolveColour(page, 'var(--accent)'),
      radius: '2px',
      shadow: 'none',
    })
    expect(await material(page.getByTestId('signin-github'))).toMatchObject({ radius: '2px', shadow: 'none' })
    expect(await material(page.getByTestId('signin-google'))).toMatchObject({
      background: WHITE,
      radius: '2px',
      borderColor: HAIRLINE,
    })
  })

  test('the sign-in buttons do not lift on hover', async ({ page }) => {
    await page.goto('/login')
    await settleAnimations(page)
    for (const id of ['signin-github', 'signin-google']) {
      const button = page.getByTestId(id)
      const before = await button.evaluate((el) => getComputedStyle(el).backgroundColor)
      await button.hover()
      await settleAnimations(page)
      await expect(button).toHaveCSS('transform', 'none')
      await expect(button).toHaveCSS('box-shadow', 'none')
      // The GitHub button stays its accent on hover; Google stays white.
      await expect(button).toHaveCSS('background-color', before)
    }
  })

  test('the invite page and the privacy page wear the same card', async ({ page }) => {
    await page.goto('/invite/not-a-real-token')
    await expect(page.getByTestId('invite-invalid')).toBeVisible()
    await settleAnimations(page)
    expect(await material(page.getByTestId('auth-card'))).toEqual(card)

    await page.goto('/privacy')
    await settleAnimations(page)
    expect(await material(page.getByTestId('privacy-card'))).toEqual(card)
  })
})

test.describe('share sheet, palette and toasts', () => {
  const floating = {
    background: WHITE,
    backdrop: 'none',
    shadow: FLOAT,
    radius: '2px',
    borderColor: HAIRLINE,
    borderWidth: '1px',
  }

  test('the share sheet is a white floating sheet over an unblurred veil, and a toast is flat and dark', async ({
    page,
  }) => {
    const label = `${LABEL}-share`
    const { owner, workspace } = await seedWorkspace(label)
    const member = await addMember(workspace.id, label, 'viewer')
    await signIn(page, owner.id)
    await page.goto(`/workspaces/${workspace.id}`)
    await page.getByTestId('share').click()
    await settleAnimations(page)
    expect(await material(page.getByTestId('sheet'))).toEqual(floating)
    const veil = page.getByTestId('sheet-overlay')
    await expect(veil).toHaveCSS('backdrop-filter', 'none')
    await expect(veil).toHaveCSS('background-color', 'rgba(30, 40, 35, 0.16)')
    const email = page.getByTestId('member-email')
    const invite = email.locator('xpath=ancestor::form[1]')
    // The sheet opens with the email field focused, which draws the focus ring; this reads
    // the resting row, so take the focus off first (the focus state has its own test).
    await email.evaluate((el) => (el as HTMLInputElement).blur())
    await expect(invite).toHaveCSS('box-shadow', 'none')
    expect(await material(invite)).toMatchObject({ background: WHITE, radius: '2px', borderColor: HAIRLINE, shadow: 'none' })

    // A role change raises a toast.
    await page.getByTestId(`role-for-${member.id}`).selectOption('editor')
    const toast = page.getByTestId('toast').first()
    await expect(toast).toBeVisible()
    await settleAnimations(page)
    expect(await material(toast)).toMatchObject({ background: INK, backdrop: 'none', shadow: 'none', radius: '2px' })
    await expect(toast.locator('span').first()).toHaveCSS(
      'background-color',
      await resolveColour(page, 'oklch(0.64 0.17 290)'),
    )
    await cleanup(label)
  })

  test('the ⌘K palette is a white floating sheet and its chosen row is the accent', async ({ page }) => {
    const label = `${LABEL}-palette`
    const { owner, workspace } = await seedWorkspace(label)
    await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.goto(`/workspaces/${workspace.id}`)
    await page.getByTestId('search').click()
    const results = page.getByRole('listbox', { name: 'Results' })
    await expect(results).toBeVisible()
    await settleAnimations(page)
    expect(await material(page.getByTestId('palette'))).toEqual(floating)
    const chosen = results.getByRole('option', { selected: true })
    await expect(chosen).toHaveCSS('background-color', await resolveColour(page, 'var(--accent)'))
    await expect(chosen).toHaveCSS('border-top-left-radius', '2px')
    await cleanup(label)
  })

  test('the invite row shows focus: an accent edge and a 4px ring while its input has it', async ({
    page,
  }) => {
    const label = `${LABEL}-invite-focus`
    const { owner, workspace } = await seedWorkspace(label)
    await signIn(page, owner.id)
    await page.goto(`/workspaces/${workspace.id}`)
    await page.getByTestId('share').click()
    await settleAnimations(page)
    const input = page.getByTestId('member-email')
    const invite = input.locator('xpath=ancestor::form[1]')
    const accent = await resolveColour(page, 'var(--accent)')
    const ring = await resolveColour(page, 'var(--accent-ring)')

    // Unfocused, the row is the hairline it always was. (The sheet may focus its first
    // control on open; take the focus off the input so both states are read.)
    await input.evaluate((el) => (el as HTMLInputElement).blur())
    await expect(input).not.toBeFocused()
    await expect(invite).toHaveCSS('border-top-color', HAIRLINE)
    await expect(invite).toHaveCSS('box-shadow', 'none')

    await input.focus()
    await expect(input).toBeFocused()
    await expect(invite).toHaveCSS('border-top-color', accent)
    await expect(invite).toHaveCSS('box-shadow', `${ring} 0px 0px 0px 4px`)
    // The input itself still draws no outline of its own: the row is the indicator.
    await expect(input).toHaveCSS('outline-style', 'none')
    await cleanup(label)
  })

  test('the ⌘K palette input shows focus: an accent rule under it and an inset ring', async ({ page }) => {
    const label = `${LABEL}-palette-focus`
    const { owner, workspace } = await seedWorkspace(label)
    await signIn(page, owner.id)
    await page.goto(`/workspaces/${workspace.id}`)
    await page.getByTestId('search').click()
    await expect(page.getByRole('listbox', { name: 'Results' })).toBeVisible()
    await settleAnimations(page)
    const input = page.getByTestId('palette-input')
    const accent = await resolveColour(page, 'var(--accent)')
    const ring = await resolveColour(page, 'var(--accent-ring)')
    const rule = await resolveColour(page, 'rgba(40, 40, 60, 0.12)')

    // The palette opens focused, so the indicator is on screen at once.
    await expect(input).toBeFocused()
    await expect(input).toHaveCSS('border-bottom-color', accent)
    await expect(input).toHaveCSS('box-shadow', `${ring} 0px 0px 0px 3px inset`)

    // And it is the focus that draws it: with the input blurred it is the plain rule again.
    await input.evaluate((el) => (el as HTMLInputElement).blur())
    await expect(input).not.toBeFocused()
    await expect(input).toHaveCSS('border-bottom-color', rule)
    await expect(input).toHaveCSS('box-shadow', 'none')
    await cleanup(label)
  })
})
