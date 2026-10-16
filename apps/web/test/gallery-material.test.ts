import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declarations, rel, SRC, sourceFiles } from './css-walk.js'

/** Every stylesheet in src: Gallery is the only material now. */
const MIGRATED: string[] = sourceFiles(['.css']).map(rel)

const RADII = new Set(['var(--r)', '50%', '0', 'inherit'])
/** The canvas blobs keep their organic shape: paint, not UI. */
const RADIUS_EXCEPTIONS = new Set(['components/canvas-background.module.css .blob'])
/** The canvas blobs are the only elements allowed `filter: blur(...)`: paint, not UI. */
const BLUR_EXCEPTIONS = new Set(['components/canvas-background.module.css .blob'])
/**
 * The reference's own short entrance animations fade in from `filter: blur(...)` to `none`.
 * That is motion, not a blurred backdrop, and the owner kept existing motion. Keyed on the
 * keyframes name (`path @keyframes name`), so a blur in any other keyframes, or in any
 * ordinary rule, still fails.
 */
const KEYFRAMES_BLUR_EXCEPTIONS = new Set([
  'app/globals.css @keyframes g-in',
  'app/globals.css @keyframes g-pop',
])
/** A ring: `[inset] 0 0 0 Npx [colour]`. Focus, selection and the board card's hairline. */
const RING = /^(inset\s+)?0(px)?\s+0(px)?\s+0(px)?\s+[\d.]+px(\s+\S.*)?$/

/** A box-shadow's layers, split on the commas that are not inside a function. */
function layers(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  out.push(current.trim())
  return out
}

/** Everything in a stylesheet that is not Gallery material, one line per finding. */
function findings(path: string, css: string): string[] {
  const problems: string[] = []
  for (const d of declarations(css)) {
    const where = `${d.selector} { ${d.prop}: ${d.value} }`
    const inKeyframes = d.context.some((prelude) => prelude.startsWith('@keyframes'))
    if (d.prop.endsWith('backdrop-filter')) problems.push(`blur: ${where}`)
    if (d.prop === 'text-shadow' && d.value !== 'none') problems.push(`text shadow: ${where}`)
    if (/^(-webkit-)?filter$/.test(d.prop)) {
      if (/drop-shadow\(/i.test(d.value)) problems.push(`drop shadow: ${where}`)
      const exemptKeyframes = d.context.some((prelude) =>
        KEYFRAMES_BLUR_EXCEPTIONS.has(`${path} ${prelude.replace(/\s+/g, ' ')}`),
      )
      if (
        /blur\(/i.test(d.value) &&
        !exemptKeyframes &&
        !BLUR_EXCEPTIONS.has(`${path} ${d.selector}`)
      ) {
        problems.push(`blur: ${where}`)
      }
    }
    if (/var\(--(glass|blur)-|var\(--accent-shadow\)|var\(--r-[a-z]/.test(d.value)) {
      problems.push(`glass token: ${where}`)
    }
    if (
      !inKeyframes &&
      /^border(-[a-z]+)*-radius$/.test(d.prop) &&
      !RADII.has(d.value) &&
      !RADIUS_EXCEPTIONS.has(`${path} ${d.selector}`)
    ) {
      problems.push(`radius: ${where}`)
    }
    if (!inKeyframes && d.prop === 'box-shadow') {
      for (const layer of layers(d.value)) {
        if (layer !== 'none' && layer !== 'var(--shadow-float)' && !RING.test(layer)) {
          problems.push(`shadow: ${where}`)
        }
      }
    }
  }
  return problems
}

describe('Gallery material in every stylesheet', () => {
  it('covers every stylesheet', () => {
    // 19 today: globals.css and 18 modules. A floor, so a broken walk cannot pass on nothing.
    expect(MIGRATED.length).toBeGreaterThanOrEqual(19)
    expect(MIGRATED).toContain('app/globals.css')
  })

  it('the text shadow, drop shadow and blur branches each catch a violation', () => {
    const other = 'components/x.module.css'
    expect(findings(other, '.a { text-shadow: 0 1px 2px #000 }')).toEqual([
      'text shadow: .a { text-shadow: 0 1px 2px #000 }',
    ])
    expect(findings(other, '.a { filter: drop-shadow(0 2px 4px #000) }')).toEqual([
      'drop shadow: .a { filter: drop-shadow(0 2px 4px #000) }',
    ])
    expect(findings(other, '.a { filter: blur(4px) }')).toEqual(['blur: .a { filter: blur(4px) }'])
    expect(findings(other, '.a { -webkit-filter: blur(4px) }')).toEqual([
      'blur: .a { -webkit-filter: blur(4px) }',
    ])
    expect(findings(other, '.a { backdrop-filter: blur(4px) }')).toEqual([
      'blur: .a { backdrop-filter: blur(4px) }',
    ])
    // The allowed cases: no text shadow, and the canvas blob's blur, which is paint.
    expect(findings(other, '.a { text-shadow: none }')).toEqual([])
    const canvas = 'components/canvas-background.module.css'
    expect(findings(canvas, '.blob { filter: blur(90px) }')).toEqual([])
    expect(findings(canvas, '.other { filter: blur(90px) }')).toEqual(['blur: .other { filter: blur(90px) }'])
    // The reference's entrance blur is exempt by keyframes name, and only there.
    const entrance = '@keyframes g-in { from { opacity: 0; filter: blur(6px) } to { filter: none } }'
    expect(findings('app/globals.css', entrance)).toEqual([])
    expect(findings('app/globals.css', entrance.replace('g-in', 'g-pop'))).toEqual([])
    expect(findings('app/globals.css', entrance.replace('g-in', 'foo'))).toEqual([
      'blur: from { filter: blur(6px) }',
    ])
    expect(findings('components/x.module.css', entrance)).toEqual(['blur: from { filter: blur(6px) }'])
    expect(findings('app/globals.css', '.a { filter: blur(4px) }')).toEqual(['blur: .a { filter: blur(4px) }'])
  })

  it.each(MIGRATED)('%s: no blur, no text or drop shadow, no glass token, 2px corners, no shadow but the float and rings', (path) => {
    expect(findings(path, readFileSync(join(SRC, path), 'utf8'))).toEqual([])
  })
})
