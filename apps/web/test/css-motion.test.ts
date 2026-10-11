import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declarations, rel, SRC, sourceFiles } from './css-walk.js'

const KEYWORDS = new Set([
  'none', 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards',
  'backwards', 'both', 'running', 'paused', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
  'linear', 'step-start', 'step-end', 'initial', 'inherit', 'unset',
])

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const keyframesIn = (css: string) =>
  new Set([...stripComments(css).matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!))

const GLOBALS = readFileSync(join(SRC, 'app/globals.css'), 'utf8')
const SHARED = keyframesIn(GLOBALS)

/** The keyframes names in an animation value, and whether each is wrapped in global(). */
function animationNames(value: string): { name: string; global: boolean }[] {
  const plain = value.replace(/\b(var|cubic-bezier|steps)\([^)]*\)/g, ' ')
  const out: { name: string; global: boolean }[] = []
  for (const m of plain.matchAll(/global\(\s*([\w-]+)\s*\)|(?<![\w.-])(-?[a-zA-Z_][\w-]*)/g)) {
    if (m[1]) out.push({ name: m[1], global: true })
    else if (m[2] && !KEYWORDS.has(m[2].toLowerCase())) out.push({ name: m[2], global: false })
  }
  return out
}

describe('CSS motion', () => {
  it('globals.css holds the shared keyframes', () => {
    expect([...SHARED].sort()).toEqual(['g-fade', 'g-in', 'g-paint', 'g-pop', 'g-pulse', 'g-sheet', 'g-side', 'g-up'])
  })

  it('a module reaches a shared keyframes through global(), and a local name only if it defines it', () => {
    // A bare name in a CSS module is hashed per file (app-shell_g-pop__x), and no keyframes
    // carry that name: the animation silently does not run. global(name) keeps it bare.
    const problems: string[] = []
    let checked = 0
    for (const file of sourceFiles(['.module.css'])) {
      const css = readFileSync(file, 'utf8')
      const local = keyframesIn(css)
      for (const d of declarations(css)) {
        if (d.prop !== 'animation' && d.prop !== 'animation-name') continue
        for (const { name, global } of animationNames(d.value)) {
          checked += 1
          if (global ? !SHARED.has(name) : !local.has(name)) {
            problems.push(`${rel(file)} ${d.selector}: ${d.prop}: ${d.value}`)
          }
        }
      }
    }
    // A floor, so a broken walk cannot pass by finding nothing.
    expect(checked).toBeGreaterThan(15)
    expect(problems).toEqual([])
  })

  it('globals.css does not use global(), which only a CSS module understands', () => {
    expect(stripComments(GLOBALS)).not.toMatch(/global\(/)
  })

  it('every transition and animation sits inside prefers-reduced-motion: no-preference', () => {
    const problems: string[] = []
    for (const file of sourceFiles(['.css'])) {
      for (const d of declarations(readFileSync(file, 'utf8'))) {
        if (!['transition', 'transition-property', 'animation', 'animation-name'].includes(d.prop)) continue
        if (d.value === 'none') continue
        const guarded = d.context.some((prelude) => /prefers-reduced-motion:\s*no-preference/.test(prelude))
        if (!guarded) problems.push(`${rel(file)} ${d.selector}: ${d.prop}: ${d.value}`)
      }
    }
    expect(problems).toEqual([])
  })
})
