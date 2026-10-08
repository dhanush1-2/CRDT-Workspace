'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './app-shell.module.css'

/**
 * The nav's History control.
 *
 * The panel the design specifies lists every saved version of a document with its
 * author and lets you preview or restore one. None of that exists yet: updates carry
 * a Yjs client number rather than a user, and there is no snapshot list, content or
 * restore route. Those are the history backend's work.
 *
 * The button ships anyway, because the alternative to a control that explains itself
 * is a nav that quietly lacks a feature the design has. It must never imply the
 * feature works.
 *
 * A disclosure, not a menu: the panel is prose, so aria-expanded plus aria-controls
 * describes it exactly and no menu/menuitem semantics are invented for it.
 */
export function HistoryButton() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Without this, Escape drops focus to the document body and the next Tab
      // restarts from the top of the page.
      button.current?.focus()
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      // The button's own click toggles; closing here as well would reopen it.
      if (button.current?.contains(target) || panel.current?.contains(target)) return
      setOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div className={styles.historyWrap}>
      <button
        type="button"
        ref={button}
        className={`${styles.history} ${open ? styles.historyOpen : ''}`}
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls="history-panel"
        data-testid="history"
      >
        History
      </button>

      {open && (
        <div
          id="history-panel"
          ref={panel}
          className={styles.historyPanel}
          role="group"
          aria-label="History"
          data-testid="history-panel"
        >
          <p className={styles.historyTitle}>History</p>
          <p className={styles.historyBody}>
            Version history is not available yet. When it arrives, this panel will list
            every saved version of this document with who changed it, and let you preview
            or restore one.
          </p>
        </div>
      )}
    </div>
  )
}
