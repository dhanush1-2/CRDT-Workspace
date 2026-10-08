'use client'

import { useDocState } from '@/lib/doc-state'
import styles from './app-shell.module.css'

/**
 * Everyone in the open document, you first. Rendered on every document page from the
 * first render, because whether you are on a document is known from the route; it does
 * not wait for the connection. Peers come from the doc-state store, and only for the
 * document on screen: while a newly opened one connects, the store may still describe
 * the previous one, whose people are not here.
 */
export function NavPresence({
  self,
  documentId,
}: {
  self: { name: string; color: string } | null
  documentId: string | null
}) {
  const state = useDocState()
  if (!self || !documentId) return null
  const peers = state.documentId === documentId ? state.peers : []

  return (
    <div className={styles.presence} role="group" aria-label="People here" data-testid="presence">
      <span
        className={styles.avatar}
        style={{ background: self.color }}
        title={`${self.name} (you)`}
        role="img"
        aria-label={`${self.name} (you)`}
        data-testid="presence-self"
      >
        {self.name.slice(0, 1).toUpperCase()}
      </span>
      {peers.map((peer) => (
        <span
          key={peer.clientId}
          className={styles.avatar}
          style={{ background: peer.color }}
          title={peer.name}
          role="img"
          aria-label={peer.name}
          // Keyed on clientId, not name: two people can share a display name.
          data-testid={`presence-${peer.clientId}`}
        >
          {peer.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  )
}
