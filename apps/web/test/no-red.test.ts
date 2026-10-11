import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { declarations, rel, sourceFiles } from './css-walk.js'

type Rgb = [number, number, number]

/** A hex or rgb()/rgba() literal as 0-255 channels; null for anything else. */
function toRgb(colour: string): Rgb | null {
  const hex = colour.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join('') : hex[1]!
    return [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16)) as Rgb
  }
  const rgb = colour.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

/** Hue in degrees; saturation and lightness 0-1. */
function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const lightness = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, lightness]
  const saturation = d / (1 - Math.abs(2 * lightness - 1))
  let hue = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  hue *= 60
  if (hue < 0) hue += 360
  return [hue, saturation, lightness]
}

/**
 * Whether a colour literal reads as red: for hex and rgb, a saturated mid-lightness colour
 * within 15 degrees of pure red; for oklch, real chroma at a hue of 0-40 or 345-360 (oklch's
 * red sits near 29). Oranges (#c9661a, 26 degrees), ambers, pinks (#c2417f, 331 degrees) and
 * the pale highlight swatches fall outside it.
 */
function isReddish(colour: string): boolean {
  const oklch = colour.match(/^oklch\(\s*[\d.]+%?\s+([\d.]+)\s+([\d.]+)/i)
  if (oklch) {
    const chroma = Number(oklch[1])
    const hue = Number(oklch[2])
    return chroma >= 0.08 && (hue <= 40 || hue >= 345)
  }
  const rgb = toRgb(colour)
  if (!rgb) return false
  const [hue, saturation, lightness] = toHsl(rgb)
  return saturation >= 0.35 && lightness >= 0.15 && lightness <= 0.85 && (hue <= 15 || hue >= 345)
}

/** Every colour literal in a source file. */
function colours(text: string): string[] {
  return [...text.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)|oklch\([^)]*\)/gi)].map((m) =>
    m[0].toLowerCase(),
  )
}

/**
 * The only red literals allowed in src (spec, "Colour": no red anywhere except #c4372b for
 * error and delete text). The last two are the editor's content colours, not chrome; see the
 * plan's decision 16. A person's colour is no longer red: lib/color.ts uses indigo (question 3).
 */
const ALLOWED_RED = new Set([
  'app/globals.css #c4372b', // --danger itself
  'components/editor-palettes.ts #c4372b', // the editor's "Red" text colour: document content
  'components/editor-toolbar.module.css #c4372b', // the stroke across the "None" highlight swatch
])

/** The only rules that may use var(--danger), and only for `color`: error text and delete. */
const DANGER_RULES = new Set([
  'components/ui/ui.module.css .danger',
  'components/ui/ui.module.css .error',
  'components/history-panel.module.css .error',
  'components/editor-toolbar.module.css .linkNote',
  'components/board.module.css .columnDelete:hover',
  'components/board.module.css .columnConfirmDelete',
])

describe('no red', () => {
  it('the red test knows red from its neighbours', () => {
    for (const red of ['#c4372b', '#e11d48', '#e2453c', 'rgba(196, 55, 43, 0.06)', 'oklch(0.62 0.13 25)']) {
      expect(isReddish(red), red).toBe(true)
    }
    for (const other of ['#c9661a', '#c2417f', '#e9a21f', '#ffd6e8', '#6d3fd6', '#4f46e5', '#1c1c1c', 'oklch(0.72 0.15 65)', 'oklch(0.5 0.17 290)']) {
      expect(isReddish(other), other).toBe(false)
    }
  })

  it('no red literal appears in src outside the three allowed uses', () => {
    const found = new Set<string>()
    const stray: string[] = []
    for (const file of sourceFiles(['.css', '.ts', '.tsx', '.svg'])) {
      for (const colour of colours(readFileSync(file, 'utf8'))) {
        if (!isReddish(colour)) continue
        const where = `${rel(file)} ${colour}`
        if (ALLOWED_RED.has(where)) found.add(where)
        else stray.push(where)
      }
    }
    expect(stray).toEqual([])
    // And the allowlist is not stale: each entry is still there to be allowed.
    expect([...found].sort()).toEqual([...ALLOWED_RED].sort())
  })

  it('var(--danger) colours only error text and the delete action', () => {
    const found = new Set<string>()
    for (const file of sourceFiles(['.css'])) {
      for (const declaration of declarations(readFileSync(file, 'utf8'))) {
        if (!declaration.value.includes('var(--danger)')) continue
        const where = `${rel(file)} ${declaration.selector}`
        expect(declaration.prop, where).toBe('color')
        expect(DANGER_RULES.has(where), `${where} uses --danger`).toBe(true)
        found.add(where)
      }
    }
    expect([...found].sort()).toEqual([...DANGER_RULES].sort())
    for (const file of sourceFiles(['.ts', '.tsx'])) {
      expect(readFileSync(file, 'utf8'), rel(file)).not.toContain('var(--danger)')
    }
  })
})
