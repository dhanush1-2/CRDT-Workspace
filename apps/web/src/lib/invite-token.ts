import { createHash, randomBytes } from 'node:crypto'

// Pure: no database, no Next. Relative imports only (e2e/fixtures.ts reaches this file
// through invitations.ts, and Playwright does not resolve the '@/' alias).

/** How long an invite link works: 14 days from when it was made, or last re-issued. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000

// 32 random bytes are exactly 43 base64url characters; Node's base64url has no padding.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

/**
 * A new invite token and the hash that is stored for it. The token goes to the owner
 * once, inside the link, and is never stored: the database holds only the hash, so a
 * copy of the database opens no invitation.
 */
export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInviteToken(token) }
}

/**
 * SHA-256, lowercase hex. Unsalted on purpose: the token is 256 random bits, so there is
 * nothing to precompute, and a salt would make lookup by hash impossible.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Rejects anything newInviteToken could not have made, before it reaches the database. */
export function isWellFormedInviteToken(token: string): boolean {
  return TOKEN_SHAPE.test(token)
}

/** An invite link's path. The share sheet makes it absolute on the browser's own origin. */
export function inviteLink(token: string): string {
  return `/invite/${token}`
}

/** How invitations store and compare emails: trimmed and lowercased, as sign-in stores them. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}
