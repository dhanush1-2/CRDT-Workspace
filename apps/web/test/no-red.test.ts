import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { declarations, rel, sourceFiles } from './css-walk.js'

type Rgb = [number, number, number]

/** CSS named colours that read as red. Case-insensitive in a stylesheet. */
const NAMED_REDS = [
  'red', 'crimson', 'tomato', 'firebrick', 'darkred', 'indianred', 'orangered',
  'maroon', 'brown', 'lightcoral', 'salmon', 'darksalmon', 'lightsalmon', 'coral',
]
/**
 * The names a TS or TSX string is not held to. `brown`, `coral` and `salmon` are also plain
 * words in UI copy ("Coral Cloud", "salmon pink"), where they are not colours; a stylesheet
 * value is still held to the full list.
 */
const COPY_WORDS = new Set(['brown', 'coral', 'salmon'])
const STRING_NAMED_REDS = NAMED_REDS.filter((name) => !COPY_WORDS.has(name))

const FUNCTIONS = 'rgba?|hsla?|hwb|oklab|oklch|lab|lch'

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

/** Saturated, mid-lightness and within 15 degrees of pure red. The one rule for hex, rgb, hsl... */
function redHsl(hue: number, saturation: number, lightness: number): boolean {
  const h = ((hue % 360) + 360) % 360
  return saturation >= 0.35 && lightness >= 0.15 && lightness <= 0.85 && (h <= 15 || h >= 345)
}

function redRgb(rgb: Rgb): boolean {
  const [hue, saturation, lightness] = toHsl(rgb)
  return redHsl(hue, saturation, lightness)
}

/** Real chroma at a hue of 0-40 or 345-360 (oklch's red sits near 29). */
function redOk(chroma: number, hue: number): boolean {
  const h = ((hue % 360) + 360) % 360
  return chroma >= 0.08 && (h <= 40 || h >= 345)
}

/** A function's arguments, split on spaces, commas and the alpha slash; the alpha is dropped. */
function args(text: string): string[] {
  const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'))
  return inner.split('/')[0]!.split(/[\s,]+/).filter(Boolean)
}

/** A number, or a percentage mapped so that 100% is `full`; null if it is neither. */
function num(token: string | undefined, full: number): number | null {
  if (token === undefined) return null
  if (token === 'none') return 0
  const match = token.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i)
  if (!match) return null
  const value = Number(match[1])
  return match[2] ? (value / 100) * full : value
}

/** A hue as degrees, with deg, grad, rad and turn units; a bare number is degrees. */
function hueOf(token: string | undefined): number | null {
  if (token === undefined) return null
  if (token === 'none') return 0
  const match = token.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i)
  if (!match) return null
  const value = Number(match[1])
  switch (match[2]?.toLowerCase()) {
    case 'grad': return value * 0.9
    case 'rad': return (value * 180) / Math.PI
    case 'turn': return value * 360
    default: return value
  }
}

/** hsl and hwb's saturation, lightness, whiteness, blackness: 0-100, with or without the %. */
function percent(token: string | undefined): number | null {
  const value = num(token?.replace(/%$/, ''), 1)
  return value === null ? null : value / 100
}

const clamp = (value: number) => Math.min(255, Math.max(0, value))
const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.abs(c) ** (1 / 2.4) * Math.sign(c) - 0.055)

/** CIE Lab (D50, as CSS defines it) to 0-255 sRGB, clamped. */
function labToRgb(l: number, a: number, b: number): Rgb {
  const fy = (l + 16) / 116
  const [fx, fz] = [fy + a / 500, fy - b / 200]
  const inverse = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27))
  const x = 0.3457 / 0.3585 * inverse(fx)
  const y = l > 8 ? fy ** 3 : l / (24389 / 27)
  const z = (1 - 0.3457 - 0.3585) / 0.3585 * inverse(fz)
  return [
    3.1338561 * x - 1.6168667 * y - 0.4906146 * z,
    -0.9787684 * x + 1.9161415 * y + 0.033454 * z,
    0.0719453 * x - 0.2289914 * y + 1.4052427 * z,
  ].map((c) => clamp(gamma(c) * 255)) as Rgb
}

/**
 * Whether a colour literal reads as red. Hex (3, 4, 6 or 8 digits), rgb, hsl and hwb go
 * through one rule: a saturated mid-lightness colour within 15 degrees of pure red, using
 * the hsl hue directly. oklch and oklab: real chroma at a hue of 0-40 or 345-360 (oklch's
 * red sits near 29). lab and lch are converted to sRGB first. Percentages and hue units are
 * read. Oranges (#c9661a, 26 degrees), ambers, pinks (#c2417f, 331 degrees) and the pale
 * highlight swatches fall outside it. Named colours are matched by `redName`.
 */
function isReddish(colour: string): boolean {
  const text = colour.trim().toLowerCase()
  const hex = text.match(/^#([0-9a-f]{3,8})$/)
  if (hex && [3, 4, 6, 8].includes(hex[1]!.length)) {
    const digits = hex[1]!.length <= 4 ? [...hex[1]!].map((d) => d + d).join('') : hex[1]!
    return redRgb([0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16)) as Rgb)
  }
  if (NAMED_REDS.includes(text)) return true
  const name = text.match(new RegExp(`^(${FUNCTIONS})\\(`))?.[1]
  if (!name) return false
  const a = args(text)
  if (name.startsWith('rgb')) {
    const [r, g, b] = [num(a[0], 255), num(a[1], 255), num(a[2], 255)]
    return r === null || g === null || b === null ? false : redRgb([clamp(r), clamp(g), clamp(b)])
  }
  if (name.startsWith('hsl')) {
    const [h, s, l] = [hueOf(a[0]), percent(a[1]), percent(a[2])]
    return h === null || s === null || l === null ? false : redHsl(h, s, l)
  }
  if (name === 'hwb') {
    const [h, white, black] = [hueOf(a[0]), percent(a[1]), percent(a[2])]
    if (h === null || white === null || black === null || white + black >= 1) return false
    const hue = ((h % 360) + 360) % 360
    const channel = (n: number) => {
      const k = (n + hue / 30) % 12
      return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    }
    const mix = (c: number) => clamp((c * (1 - white - black) + white) * 255)
    return redRgb([mix(channel(0)), mix(channel(8)), mix(channel(4))])
  }
  if (name === 'oklch') {
    const [chroma, hue] = [num(a[1], 0.4), hueOf(a[2])]
    return chroma === null || hue === null ? false : redOk(chroma, hue)
  }
  if (name === 'oklab') {
    const [x, y] = [num(a[1], 0.4), num(a[2], 0.4)]
    return x === null || y === null ? false : redOk(Math.hypot(x, y), (Math.atan2(y, x) * 180) / Math.PI)
  }
  if (name === 'lab') {
    const [l, x, y] = [num(a[0], 100), num(a[1], 125), num(a[2], 125)]
    return l === null || x === null || y === null ? false : redRgb(labToRgb(l, x, y))
  }
  // lch
  const [l, chroma, hue] = [num(a[0], 100), num(a[1], 150), hueOf(a[2])]
  if (l === null || chroma === null || hue === null) return false
  const radians = (hue * Math.PI) / 180
  return redRgb(labToRgb(l, chroma * Math.cos(radians), chroma * Math.sin(radians)))
}

/**
 * Every colour literal in a source file: hex of 3, 4, 6 or 8 digits, the colour functions,
 * and named reds. Names are read only where they are a value: a declaration's value in a
 * stylesheet, a quoted string elsewhere (so the word in a comment or an identifier is not one).
 */
function colours(path: string, text: string): string[] {
  const numeric = [
    ...text.matchAll(new RegExp(`#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\\b|(?:${FUNCTIONS})\\([^)]*\\)`, 'gi')),
  ].map((m) => m[0].toLowerCase())
  const named: string[] = []
  if (path.endsWith('.css')) {
    for (const d of declarations(text)) {
      const value = d.value.replace(/url\([^)]*\)|var\([^)]*\)/gi, '')
      for (const word of value.split(/[\s,()/]+/)) {
        if (NAMED_REDS.includes(word.toLowerCase())) named.push(word.toLowerCase())
      }
    }
  } else {
    for (const string of text.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
      // A string that names a thing (`id: 'red'`) is an identifier, not a colour.
      if (/\b(id|name|key|label|type|variant|testid)\s*[:=]\s*$/i.test(text.slice(0, string.index))) continue
      for (const word of string[2]!.split(/[\s,()/;:]+/)) {
        if (STRING_NAMED_REDS.includes(word.toLowerCase())) named.push(word.toLowerCase())
      }
    }
  }
  return [...numeric, ...named]
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
    const reds = [
      '#c4372b', '#e11d48', '#e2453c', '#f00', '#f00f', '#c4372b80', '#E11D48FF',
      'rgba(196, 55, 43, 0.06)', 'rgb(196 55 43 / 0.5)', 'rgb(80% 20% 20%)', 'rgb(100%, 0%, 0%)',
      'hsl(5, 70%, 45%)', 'hsl(5 70% 45%)', 'hsla(355, 70%, 45%, 0.4)', 'hsl(0.99turn 70% 45%)', 'hsl(0 70 45)',
      'hwb(0 10% 10%)', 'hwb(355deg 5% 20%)',
      'oklch(0.62 0.13 25)', 'oklch(62% 40% 25)', 'oklch(0.6 0.2 0.05turn)', 'oklab(0.62 0.12 0.06)', 'oklab(62% 30% 15%)',
      'lab(54 81 70)', 'lab(50% 60 30)', 'lch(54 106 40)', 'lch(50% 70% 35deg)',
      'red', 'crimson', 'tomato', 'firebrick', 'darkred', 'indianred', 'orangered',
    ]
    for (const red of reds) expect(isReddish(red), red).toBe(true)
    const others = [
      '#c9661a', '#c2417f', '#e9a21f', '#ffd6e8', '#6d3fd6', '#4f46e5', '#1c1c1c', '#fff', '#ffff', '#e9a21fff',
      '#c2417f80', 'rgb(201, 102, 26)', 'rgb(20% 20% 80%)', 'rgb(var(--x) 0 0)',
      'hsl(26, 77%, 44%)', 'hsl(331 50% 50%)', 'hsl(5, 10%, 45%)', 'hsl(5, 70%, 95%)', 'hsl(290 60% 50%)',
      'hwb(26 10% 10%)', 'hwb(0 50% 50%)', 'hwb(250 10% 10%)',
      'oklch(0.72 0.15 65)', 'oklch(0.5 0.17 290)', 'oklch(0.93 0.004 25)', 'oklch(70% 40% 70)', 'oklab(0.7 0.02 0.14)',
      'lab(70 20 80)', 'lab(50% 0 -60)', 'lch(70 90 75)', 'lch(48 55 357)',
      'orange', 'gold', 'navy', 'rebeccapurple', 'transparent',
    ]
    for (const other of others) expect(isReddish(other), other).toBe(false)
  })

  it('colours() finds every syntax, and names only where they are values', () => {
    const css = '.a { color: #f00f; background: hsl(5 70% 45%); border-color: Crimson; fill: var(--red) }'
    expect(colours('x.css', css)).toEqual(['#f00f', 'hsl(5 70% 45%)', 'crimson'])
    expect(colours('x.css', '/* red */ .red { color: #c4372b80 }')).toEqual(['#c4372b80'])
    expect(colours('x.ts', "const c = 'tomato'; // red\nconst red = 1; const l = { label: 'Red tint', border: '1px solid red' }")).toEqual(['tomato', 'red'])
    expect(colours('x.ts', "const swatch = { id: 'red', value: 'red' }")).toEqual(['red'])
    expect(colours('x.ts', 'const c = "#e11d48ff"')).toEqual(['#e11d48ff'])
    // A capitalised name is a red too: CSS reads names case-insensitively.
    expect(colours('x.ts', "const a = 'Red'; const b = 'CRIMSON'; const c = '1px solid Tomato'")).toEqual(['red', 'crimson', 'tomato'])
    // Words that are also ordinary copy are not flagged in a string...
    expect(colours('x.ts', "const a = 'Coral Cloud Resorts'; const b = 'brown fox'; const c = 'salmon'")).toEqual([])
    // ...but the rest still are, and a stylesheet value is held to the full list.
    expect(colours('x.ts', "const a = 'Firebrick'; const b = 'darkred'; const c = 'orangered'; const d = 'indianred'")).toEqual(['firebrick', 'darkred', 'orangered', 'indianred'])
    expect(colours('x.css', '.a { color: brown; border-color: coral; fill: Salmon }')).toEqual(['brown', 'coral', 'salmon'])
  })

  it('no red literal appears in src outside the three allowed uses', () => {
    const found = new Set<string>()
    const stray: string[] = []
    for (const file of sourceFiles(['.css', '.ts', '.tsx', '.svg'])) {
      for (const colour of colours(file, readFileSync(file, 'utf8'))) {
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
