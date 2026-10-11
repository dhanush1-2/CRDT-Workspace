import { test, expect, type Locator, type Page } from '@playwright/test'
import { cleanup, seedWorkspace, signIn } from './fixtures.js'

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
          (face) => /Schibsted/i.test(face.family) && face.status === 'loaded',
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
