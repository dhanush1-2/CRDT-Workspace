'use client'

import type { DocStatus } from '@/lib/doc-session'
import { useDocState } from '@/lib/doc-state'
import styles from './app-shell.module.css'

const DISPLAY: Record<DocStatus, { label: string; dot: string }> = {
  connected: { label: 'Synced', dot: 'var(--ok)' },
  connecting: { label: 'Syncing', dot: 'var(--sync)' },
  disconnected: { label: 'Offline', dot: 'var(--danger)' },
  fatal: { label: 'Offline', dot: 'var(--danger)' },
}

// Reads the document the page below has published. Renders nothing where there is
// no document (dashboard, workspace page), so the nav has no empty pill there.
export function SyncStatus({ documentId }: { documentId: string | null }) {
  const state = useDocState()
  if (documentId === null) return null
  // The store may still describe the document you just left; until this one has
  // published, it is connecting.
  const current = state.documentId === documentId
  const status = current ? state.status : 'connecting'
  const peers = current ? state.peers : []

  const { label, dot } = DISPLAY[status]
  // `peers` excludes this tab's own client, so the count is peers plus you — what
  // "3 here" means to the person reading it. Alone, a count of one says nothing, so
  // that state keeps the connection label instead.
  const text = status === 'connected' && peers.length > 0 ? `${peers.length + 1} here` : label

  return (
    <span className={styles.status} data-testid="status" data-status={status}>
      <span className={styles.statusDot} style={{ background: dot }} aria-hidden="true" />
      <span className={styles.statusLabel}>{text}</span>
    </span>
  )
}
