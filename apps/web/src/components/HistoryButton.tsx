'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { formatVersionLabel } from '@/lib/format'
import { clearVersion, selectVersion, useVersionSelection } from '@/lib/version-selection'
import { HistoryPanel } from './HistoryPanel'
import styles from './app-shell.module.css'

/** The nav's bottom edge when nothing says otherwise, as app-shell.module.css declares it. */
const DEFAULT_NAV_BOTTOM = '68px'

/**
 * The nav's History control, and the owner of whether its panel is open.
 *
 * A disclosure, not a menu: the panel is a list the user reads and picks from, so
 * aria-expanded plus aria-controls describes it and no menu semantics are invented.
 *
 * The panel is rendered into document.body, not here. This button sits inside the nav,
 * and the nav's backdrop-filter makes it the containing block for position:fixed
 * descendants and a backdrop root: a fixed panel left inside it would be placed in the
 * 68px bar, and its blur would sample the nav instead of the page. A portal keeps the
 * React tree (state, props, context) while moving the DOM out. The open/Escape/outside-
 * click logic stays here, with the panel ref standing in for "inside": DOM `contains`
 * works across a portal, which React's synthetic events do not rely on.
 */
export function HistoryButton({
  documentId,
  type,
}: {
  documentId: string
  /** From the nav's document list; unknown if the document is not in it yet. */
  type?: 'doc' | 'board'
}) {
  const [open, setOpen] = useState(false)
  // The row the user picked. Shared, not local: the page reads it to show the preview.
  const picked = useVersionSelection(documentId)
  const [navBottom, setNavBottom] = useState(DEFAULT_NAV_BOTTOM)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)

  /**
   * --nav-bottom lives on the shell (68px, 52px once the nav condenses), and the panel
   * is no longer inside the shell, so it does not cascade here. Read it from the shell's
   * computed style instead of repeating the two numbers: the shell stays the one place
   * that knows them. null when the button is not inside a shell.
   */
  function readNavBottom(): string | null {
    const shell = button.current?.closest('[data-nav-condensed]')
    if (!shell) return null
    return getComputedStyle(shell).getPropertyValue('--nav-bottom').trim() || null
  }

  function toggle() {
    // Read before opening, so the panel's first frame is already where the nav is: read
    // afterwards it would start at 68 and slide to 52 when opened on a scrolled page.
    if (!open) setNavBottom(readNavBottom() ?? DEFAULT_NAV_BOTTOM)
    setOpen((was) => !was)
  }

  // Closing the panel ends the preview it controls, however it was closed (the button,
  // Escape, a click elsewhere), and so does this button going away.
  useEffect(() => {
    if (!open) clearVersion(documentId)
  }, [open, documentId])
  useEffect(() => () => clearVersion(documentId), [documentId])

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
      // The preview is what the panel is driving: someone reading it has not left the panel.
      if (target instanceof Element && target.closest('[data-version-preview]')) return
      setOpen(false)
    }

    // The nav condenses on scroll by flipping this attribute on the shell, which changes
    // --nav-bottom; follow it so the panel stays 16px under the bar.
    const shell = button.current?.closest('[data-nav-condensed]')
    const observer = new MutationObserver(() => setNavBottom(readNavBottom() ?? DEFAULT_NAV_BOTTOM))
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ['data-nav-condensed'] })

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
      observer.disconnect()
    }
  }, [open])

  function close() {
    setOpen(false)
    button.current?.focus()
  }

  return (
    <div className={styles.historyWrap}>
      <button
        type="button"
        ref={button}
        className={`${styles.history} ${open ? styles.historyOpen : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-controls="history-panel"
        data-testid="history"
      >
        History
      </button>

      {/* `open` only becomes true in an event handler, so this never runs during a
          server render, where there is no document to portal into. */}
      {open &&
        createPortal(
          <HistoryPanel
            key={documentId}
            ref={panel}
            style={{ '--nav-bottom': navBottom } as CSSProperties}
            documentId={documentId}
            type={type}
            onClose={close}
            onPreview={(version) => selectVersion(documentId, version.id, formatVersionLabel(version))}
            onLive={() => clearVersion(documentId)}
            selectedVersionId={picked?.versionId ?? null}
          />,
          document.body,
        )}
    </div>
  )
}
