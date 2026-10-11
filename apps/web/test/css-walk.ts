import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** apps/web/src, absolute. */
export const SRC = fileURLToPath(new URL('../src', import.meta.url))

/** Every file under `dir` (default src) whose name ends with one of `extensions`. */
export function sourceFiles(extensions: readonly string[], dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(extensions, path)
    return extensions.some((extension) => path.endsWith(extension)) ? [path] : []
  })
}

/** A path relative to src with forward slashes, as the guards' allowlists write it. */
export function rel(path: string): string {
  return relative(SRC, path).split('\\').join('/')
}

export interface Declaration {
  prop: string
  value: string
  /** The prelude of the block the declaration sits in: a selector, or `from` in keyframes. */
  selector: string
  /** Every enclosing prelude, outermost first; the last is `selector`. */
  context: string[]
}

/**
 * The declarations of a stylesheet, comments stripped. A brace walk, which is enough for
 * this repo's CSS: no string or url() in it holds a brace or a semicolon.
 */
export function declarations(css: string): Declaration[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Declaration[] = []
  const stack: string[] = []
  let buffer = ''
  const flush = () => {
    const declaration = buffer.trim()
    buffer = ''
    const colon = declaration.indexOf(':')
    if (colon <= 0 || stack.length === 0) return
    out.push({
      prop: declaration.slice(0, colon).trim().toLowerCase(),
      value: declaration.slice(colon + 1).trim(),
      selector: stack[stack.length - 1]!,
      context: [...stack],
    })
  }
  for (const char of text) {
    if (char === '{') {
      stack.push(buffer.trim())
      buffer = ''
    } else if (char === '}') {
      flush()
      stack.pop()
    } else if (char === ';') {
      flush()
    } else {
      buffer += char
    }
  }
  return out
}
