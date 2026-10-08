import { useSyncExternalStore } from 'react'
import type { DocStatus } from '@/lib/doc-session'

// The subset of PresenceUser the nav needs. cardId is deliberately absent: this store's
// equality gate does not compare it, so a copy here could be stale. Read cardId from
// usePresence directly.
export type DocPeer = { clientId: number; name: string; color: string }
export type DocState = { documentId: string | null; status: DocStatus; peers: DocPeer[] }

/**
 * Whether the nav may claim other people are in this document right now. Only while
 * connected: a disconnected client's awareness goes stale rather than empty. One
 * definition, used by the tab strip and the dropdown so they cannot disagree.
 */
export function hasOthersHere(state: Pick<DocState, 'status' | 'peers'>): boolean {
  return state.status === 'connected' && state.peers.length > 0
}

const EMPTY: DocState = { documentId: null, status: 'connecting', peers: [] }

let state: DocState = EMPTY
const listeners = new Set<() => void>()

// Compares exactly the fields DocPeer carries: the nav shows who is here, so a
// change to anything else must not re-render it.
function same(a: DocState, b: DocState): boolean {
  return (
    a.documentId === b.documentId &&
    a.status === b.status &&
    a.peers.length === b.peers.length &&
    a.peers.every((peer, i) => {
      const other = b.peers[i]!
      return peer.clientId === other.clientId && peer.name === other.name && peer.color === other.color
    })
  )
}

export function publishDocState(next: DocState): void {
  // The provider publishes on every awareness change, which fires on every
  // keystroke of every peer. Without this equality gate the whole nav re-renders
  // on each one.
  if (same(state, next)) return
  state = next
  for (const listener of listeners) listener()
}

export function clearDocState(documentId: string): void {
  // Guarded by id: React may unmount the old document after the new one mounts,
  // and an unguarded clear would blank the nav for the document now on screen.
  if (state.documentId !== documentId) return
  state = EMPTY
  for (const listener of listeners) listener()
}

export function getDocState(): DocState {
  return state
}

export function subscribeDocState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDocState(): DocState {
  // The server snapshot must be the constant EMPTY, not getDocState, or the server
  // render and the client's first render disagree and React logs a hydration mismatch.
  return useSyncExternalStore(subscribeDocState, getDocState, () => EMPTY)
}
