'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useDocState } from '@/lib/doc-state'
import { activeDocumentIdFrom, documentHref } from '@/lib/routes'
import type { NavDocument } from './AppShell'
import styles from './nav-tabs.module.css'

/**
 * The tab strip, for widths where a strip does not fit: one button naming where you
 * are, and a list of everywhere you can go.
 *
 * It renders alongside the strip and CSS picks one. A matchMedia read instead would
 * make the server render depend on a viewport the server cannot know, and the wrong
 * one would be visible until hydration.
 *
 * A disclosure of links, not a menu: links in a menu need menuitem semantics that
 * fight their own role, and nothing here needs arrow-key navigation that Tab does
 * not already provide.
 */
export function NavMenu({
  workspaceId,
  documents,
}: {
  workspaceId: string
  documents: NavDocument[]
}) {
  const pathname = usePathname()
  const activeDocumentId = activeDocumentIdFrom(pathname)
  const { documentId, peers } = useDocState()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const active = documents.find((document) => document.id === activeDocumentId)
  const label = active ? active.title : 'Overview'

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (button.current?.contains(target) || list.current?.contains(target)) return
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
    <div className={styles.menu}>
      <button
        type="button"
        ref={button}
        className={styles.menuTrigger}
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls="nav-menu-list"
        data-testid="nav-menu"
      >
        <span className={styles.menuLabel}>{label}</span>
        {/* The strip puts this dot on the open document's tab; here the trigger is
            the open document, so it carries it. */}
        {activeDocumentId !== undefined && activeDocumentId === documentId && peers.length > 0 && (
          <span className={styles.presenceDot} aria-hidden="true" data-testid="nav-menu-dot" />
        )}
        <span className={styles.menuCaret} aria-hidden="true" />
      </button>

      {open && (
        <ul id="nav-menu-list" ref={list} className={styles.menuList}>
          <li>
            <Link
              className={`${styles.menuItem} ${!activeDocumentId ? styles.menuItemActive : ''}`}
              href={`/workspaces/${workspaceId}`}
              aria-current={!activeDocumentId ? 'page' : undefined}
              onClick={() => setOpen(false)}
              data-testid="nav-menu-item-overview"
            >
              Overview
            </Link>
          </li>
          {documents.map((document) => {
            const isActive = document.id === activeDocumentId
            return (
              <li key={document.id}>
                <Link
                  className={`${styles.menuItem} ${isActive ? styles.menuItemActive : ''}`}
                  href={documentHref(workspaceId, document.id)}
                  aria-current={isActive ? 'page' : undefined}
                  // The nav outlives the navigation now, so the menu has to be told
                  // to close; it would otherwise stay open over the new page.
                  onClick={() => setOpen(false)}
                  data-testid={`nav-menu-item-${document.id}`}
                >
                  {document.title}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
