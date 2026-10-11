import type { DocStatus } from '@/lib/doc-session'

/**
 * The nav status pill per connection state (spec, "Status"): green when connected, the
 * accent while syncing (the dot pulses; see app-shell.module.css), amber when offline.
 * Kept apart from SyncStatus so it can be tested without React.
 */
export const STATUS_DISPLAY: Record<DocStatus, { label: string; dot: string }> = {
  connected: { label: 'Synced', dot: 'var(--ok)' },
  connecting: { label: 'Syncing', dot: 'var(--sync)' },
  disconnected: { label: 'Offline', dot: 'var(--warn)' },
  fatal: { label: 'Offline', dot: 'var(--warn)' },
}
