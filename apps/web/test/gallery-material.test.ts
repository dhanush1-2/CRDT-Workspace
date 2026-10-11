import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declarations, SRC } from './css-walk.js'

/**
 * Stylesheets that have moved to Gallery, relative to src. Each screen's task appends its
 * files; the cleanup task replaces the list with every stylesheet in src.
 */
const MIGRATED: string[] = ['components/canvas-background.module.css']

const RADII = new Set(['var(--r)', '50%', '0', 'inherit'])
/** The canvas blobs keep their organic shape: paint, not UI. */
const RADIUS_EXCEPTIONS = new Set(['components/canvas-background.module.css .blob'])
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

describe('Gallery material in migrated stylesheets', () => {
  it.each(MIGRATED)('%s: no blur, no glass token, 2px corners, no shadow but the float and rings', (path) => {
    const problems: string[] = []
    for (const d of declarations(readFileSync(join(SRC, path), 'utf8'))) {
      const where = `${d.selector} { ${d.prop}: ${d.value} }`
      const inKeyframes = d.context.some((prelude) => prelude.startsWith('@keyframes'))
      if (d.prop.endsWith('backdrop-filter')) problems.push(`blur: ${where}`)
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
    expect(problems).toEqual([])
  })
})
