import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const globals = readFileSync(join(SRC, 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** A custom property's value in the first :root block, as written. */
function token(name: string): string | undefined {
  const root = globals.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? ''
  return root.match(new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]+);`))?.[1]?.trim()
}

describe('Gallery tokens (spec: "Colour", "Material", "Type")', () => {
  it('the accent is violet, with the five values the spec gives', () => {
    expect(token('--accent')).toBe('oklch(0.5 0.17 290)')
    expect(token('--accent-hover')).toBe('oklch(0.45 0.17 290)')
    expect(token('--accent-text')).toBe('oklch(0.44 0.17 290)')
    expect(token('--accent-tint')).toBe('oklch(0.95 0.027 290)')
    expect(token('--accent-ring')).toBe('oklch(0.5 0.17 290 / 0.12)')
    expect(token('--accent-soft')).toBe('oklch(0.5 0.17 290 / 0.12)')
  })

  it('the toast dot is the accent 0.14 lighter, and selected text is a pale violet', () => {
    expect(token('--toast-dot')).toBe('oklch(0.64 0.17 290)')
    expect(token('--selection')).toBe('oklch(0.9 0.027 290 / 0.6)')
    expect(globals).toMatch(/::selection\s*\{\s*background:\s*var\(--selection\);?\s*\}/)
  })

  it('surfaces, lines, the one shadow and the one corner', () => {
    expect(token('--paper')).toBe('#ffffff')
    expect(token('--paper-soft')).toBe('#fbfbf9')
    expect(token('--ink')).toBe('#161616')
    expect(token('--hairline')).toBe('#e4e4e0')
    expect(token('--rule')).toBe('#1c1d1b')
    expect(token('--wash')).toBe('rgba(40, 40, 60, 0.06)')
    expect(token('--shadow-float')).toBe('0 24px 48px -28px rgba(0, 0, 0, 0.25)')
    expect(token('--r')).toBe('2px')
  })

  it('text, status and danger keep the values the spec lists', () => {
    expect(token('--text')).toBe('#1c1d1b')
    expect(token('--text-2')).toBe('#3d403b')
    expect(token('--text-muted')).toBe('#5f625d')
    expect(token('--text-faint')).toBe('#6c6f6a')
    expect(token('--ok')).toBe('oklch(0.62 0.13 150)')
    expect(token('--warn')).toBe('oklch(0.72 0.15 65)')
    expect(token('--sync')).toBe('var(--accent)')
    expect(token('--danger')).toBe('#c4372b')
  })

  it('the font is Schibsted Grotesk through next/font, and the base is 15px', () => {
    expect(token('--font')).toBe('var(--font-schibsted), system-ui, sans-serif')
    const body = globals.match(/\nbody\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(body).toMatch(/font-family:\s*var\(--font\);/)
    expect(body).toMatch(/font-size:\s*15px;/)
  })

  it('the favicon is a violet disc around the unchanged three-dot glyph', () => {
    const icon = readFileSync(join(SRC, 'app/icon.svg'), 'utf8')
    expect(icon).toContain('<circle cx="26" cy="26" r="26" fill="#6d3fd6"/>')
    expect(icon).toContain(
      '<path d="M16 34 L26 17 L36 34 Z" fill="none" stroke="#fff" stroke-width="2.75" stroke-linejoin="round"/>',
    )
    expect(icon.match(/<circle cx="\d+" cy="\d+" r="4\.75" fill="#fff"\/>/g)).toHaveLength(3)
  })
})
