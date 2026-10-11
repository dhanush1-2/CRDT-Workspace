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

    test('the bar and the underline change size without animating', async ({ page }) => {
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
