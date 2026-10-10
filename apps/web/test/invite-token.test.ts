import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import {
  INVITE_TTL_MS,
  hashInviteToken,
  inviteLink,
  isWellFormedInviteToken,
  newInviteToken,
  normalizeEmail,
} from '../src/lib/invite-token.js'

describe('invite tokens', () => {
  it('are 32 random bytes as 43 base64url characters, different every time', () => {
    const a = newInviteToken()
    const b = newInviteToken()
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32)
    expect(a.token).not.toBe(b.token)
  })

  it('are stored only as their SHA-256 hash, which is not the token', () => {
    const { token, tokenHash } = newInviteToken()
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(hashInviteToken(token)).toBe(tokenHash)
    expect(tokenHash).not.toContain(token)
  })

  it('hash differently when they differ by one character', () => {
    const { token } = newInviteToken()
    const flipped = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
    expect(hashInviteToken(flipped)).not.toBe(hashInviteToken(token))
  })

  it('pass the shape check only in the shape newInviteToken makes', () => {
    expect(isWellFormedInviteToken(newInviteToken().token)).toBe(true)
    const bad = [
      '',
      'a'.repeat(42),
      'a'.repeat(44),
      `${'a'.repeat(42)}=`,
      `${'a'.repeat(42)}+`,
      `${'a'.repeat(42)}/`,
      `${'a'.repeat(42)}.`,
      ' '.repeat(43),
      '../../etc/passwd',
    ]
    for (const token of bad) expect(isWellFormedInviteToken(token), JSON.stringify(token)).toBe(false)
  })

  it('last 14 days', () => {
    expect(INVITE_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000)
  })

  it('travel only in the invite path', () => {
    expect(inviteLink('abc')).toBe('/invite/abc')
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases, so any capitalisation finds the same invitation', () => {
    expect(normalizeEmail('  Ada@Example.COM \n')).toBe('ada@example.com')
    expect(normalizeEmail('ADA@EXAMPLE.COM')).toBe(normalizeEmail('ada@example.com'))
  })
})
