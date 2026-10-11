import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const SRC = fileURLToPath(new URL('../src', import.meta.url))

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return path.endsWith('.css') ? [path] : []
  })
}

// A missing custom property does not error: var(--gone) computes to the guaranteed-
// invalid value, so `gap`, `padding` or `background` silently fall back to their
// initial values. Typecheck, build and every unit test pass. This is the only guard.
describe('css custom properties', () => {
  it('every var(--x) used in app CSS is defined in globals.css', () => {
    const globals = readFileSync(join(SRC, 'app/globals.css'), 'utf8')
    // Comments stripped first: a name that appears only in a comment is not defined.
    const globalsCss = globals.replace(/\/\*[\s\S]*?\*\//g, '')
    const defined = new Set([...globalsCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
    expect(defined.size).toBeGreaterThan(10)
    // Defined outside globals.css, by next/font: app/layout.tsx passes this name as its
    // `variable` and puts the class on <html>. Checked against the source, so renaming
    // the variable there without renaming it here fails.
    const EXTERNAL = ['--font-schibsted']
    const layout = readFileSync(join(SRC, 'app/layout.tsx'), 'utf8')
    for (const name of EXTERNAL) expect(layout).toContain(`variable: '${name}'`)

    const files = cssFiles(SRC)
    // Floors against a silent no-op: a broken walk or a moved src directory would
    // otherwise find nothing and pass. Today: 10 files, 142 references.
    expect(files.length).toBeGreaterThan(5)

    let references = 0
    const dangling: string[] = []
    for (const file of files) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      // LIMITATION: only the bare form var(--x) is checked. A reference with a fallback,
      // var(--x, 1px), is NOT covered, because it degrades on purpose. There are none in
      // the repo today; if they appear, this test will not catch a dangling one.
      for (const match of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        references += 1
        if (!defined.has(match[1]) && !EXTERNAL.includes(match[1]!))
          dangling.push(`${match[1]} in ${relative(SRC, file)}`)
      }
    }

    expect(references).toBeGreaterThan(50)
    expect(
      dangling,
      `var() references with no definition in globals.css:\n  ${dangling.join('\n  ')}`,
    ).toEqual([])
  })
})
