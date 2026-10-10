import { clearVersionStateCache } from './history-client.js'

/**
 * Ends the session and forgets what this browser fetched for it. False only when the
 * request never reached the server (offline, connection refused): fetch rejects then,
 * and the caller lets the person try again. The next person to sign in on this browser
 * must not be served a document state this one fetched: that cache is keyed by
 * document and version only.
 */
export async function signOut(): Promise<boolean> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
  } catch {
    return false
  }
  clearVersionStateCache()
  return true
}
