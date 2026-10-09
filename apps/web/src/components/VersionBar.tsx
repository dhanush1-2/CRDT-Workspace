'use client'

import { useRef, useState } from 'react'
import styles from './version-bar.module.css'

/**
 * The dark pill under the nav while a past version is on screen: whose version and when,
 * Restore, and Back to now.
 *
 * Restore is left out entirely, not disabled, when `canRestore` is false: a viewer has no
 * such action to be refused, and a disabled control invites the question of why.
 *
 * `data-version-preview` marks it as part of the preview, as the previewed page is: the
 * History panel closes on a press anywhere outside it, and closing it drops the
 * selection, which would take this pill away between the press and the click.
 */
export function VersionBar({
  author,
  time,
  canRestore,
  onRestore,
  onBackToNow,
}: {
  author: string
  /** As the panel writes it: "Sep 27, 14:20". */
  time: string
  canRestore: boolean
  /** Resolves when the restore has been written (or has failed and said so). */
  onRestore: () => Promise<void>
  onBackToNow: () => void
}) {
  const [restoring, setRestoring] = useState(false)
  // State alone would let a second click through before the re-render that disables it.
  const inFlight = useRef(false)

  async function restore() {
    if (inFlight.current) return
    inFlight.current = true
    setRestoring(true)
    try {
      await onRestore()
    } finally {
      inFlight.current = false
      setRestoring(false)
    }
  }

  return (
    <div className={styles.bar} data-testid="version-bar" data-version-preview="">
      <span className={styles.label} data-testid="version-bar-label">
        {author} · {time}
      </span>
      {canRestore && (
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          onClick={restore}
          aria-disabled={restoring}
          data-testid="version-restore"
        >
          Restore
        </button>
      )}
      <button
        type="button"
        className={styles.button}
        onClick={onBackToNow}
        data-testid="version-back"
      >
        Back to now
      </button>
    </div>
  )
}
