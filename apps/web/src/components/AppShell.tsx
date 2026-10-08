'use client'

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Role } from '@crdt/shared/types'
import { useDocState } from '@/lib/doc-state'
import type { SessionUser } from '@/lib/current-user'
import type { WorkspaceMemberView } from '@/lib/members'
import { CommandPalette } from './CommandPalette'
import { NavPresence } from './NavPresence'
import { NavTabs } from './NavTabs'
import { ShareContext } from './share-context'
import { ShareSheet } from './ShareSheet'
import { SyncStatus } from './SyncStatus'
import { UserMenu } from './UserMenu'
import { Button } from './ui/Button'
import styles from './app-shell.module.css'
import ui from './ui/ui.module.css'

export type NavDocument = { id: string; title: string; type: 'doc' | 'board' }

/**
 * The nav's last natural width, kept outside the component so it survives a client
 * navigation -- the same trick, and the same reason, as lastMetrics in NavTabs.
 *
 * `interpolate-size` already animates the width in Chrome and Edge, but only for
 * changes within one page: across a navigation the bar is a new node with no previous
 * width to interpolate from, so it simply appears at its new size. Starting the new
 * bar at the remembered width and transitioning to its natural one fixes that, and
 * fixes it in Safari and Firefox too, where `interpolate-size` does nothing at all.
 *
 * Only written from a layout effect, so it is always null during SSR and every render
 * agrees.
 */
let lastNavWidth: number | null = null

// A client component: every prop below crosses the server/client boundary, so each
// must be serialisable. Plain strings, booleans and arrays of them: no Date, no
// functions, no Prisma rows.
export function AppShell({
  user,
  workspace,
  documents,
  workspaces,
  members = [],
  canManage = false,
  role,
  children,
}: {
  user: SessionUser
  /** Omitted on the dashboard, where there is no workspace in context. */
  workspace?: { id: string; name: string }
  documents?: NavDocument[]
  /** Every workspace, for the palette on the dashboard where there is no current one. */
  workspaces?: { id: string; name: string }[]
  /** The workspace's members, for the share sheet. */
  members?: WorkspaceMemberView[]
  /** Whether the viewer may invite people and change roles (workspace owners). */
  canManage?: boolean
  /** The viewer's role here. Omitted on the dashboard, which has no single role. */
  role?: Role
  children: ReactNode
}) {
  // Which overlay is open, if any. One slot rather than a boolean per overlay, so
  // opening one can never leave another open behind it.
  const [overlay, setOverlay] = useState<'share' | 'palette' | null>(null)
  // Stable identity: this goes into a context, and a new function every render
  // would re-render every consumer every render.
  const openShare = useCallback(() => setOverlay('share'), [])
  const openPalette = useCallback(() => setOverlay('palette'), [])
  const closeOverlay = useCallback(() => setOverlay(null), [])
  // Passed to the palette as its focus fallback. A ref rather than a data-testid
  // lookup, so production focus behaviour does not depend on a test hook.
  const searchButton = useRef<HTMLButtonElement>(null)
  const nav = useRef<HTMLElement>(null)
  const animatingWidth = useRef(false)

  // Subscribed for the re-render, not for the values. The nav's width changes when
  // the green dot appears, when the status label switches between "Synced" and
  // "3 here", and when presence avatars arrive -- none of which changes a prop of
  // this component, so without this the effect below would never see them. The
  // store's equality gate means this only fires on real changes.
  useDocState()

  // Animate the bar between widths. CSS does this on its own within a page; this is
  // for the two cases it cannot cover -- across a navigation, and in browsers without
  // `interpolate-size`.
  useLayoutEffect(() => {
    const bar = nav.current
    if (!bar) return
    // Never measure while a transition is running. Clearing the inline width to
    // measure would snap the bar straight to its destination, and `scrollWidth`
    // reports the inline width rather than the natural one whenever the box is wider
    // than its contents, which is exactly the case while shrinking. Anything that
    // changed meanwhile is picked up when the transition ends.
    if (animatingWidth.current) return

    const to = bar.scrollWidth
    const from = lastNavWidth
    lastNavWidth = to

    // Nothing to animate from on a hard load, and nothing to animate at all when the
    // width did not really change.
    if (from === null || Math.abs(from - to) < 1) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    animatingWidth.current = true
    // Pin the start width with no transition, let it paint, and only then change to
    // the target. The usual set-then-force-a-reflow trick is not enough here: the bar
    // is a brand-new node on a navigation to or from the dashboard, and a property's
    // first resolved value on a freshly inserted element is its initial value, not
    // something to transition from -- measured, the transition was swallowed and the
    // width simply jumped. A real frame in between gives the browser a painted
    // "before".
    bar.style.transition = 'none'
    bar.style.width = `${from}px`
    const frame = requestAnimationFrame(() => {
      bar.style.transition = 'width var(--dur) var(--ease)'
      bar.style.width = `${to}px`
    })

    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      cancelAnimationFrame(frame)
      animatingWidth.current = false
      bar.style.width = ''
      bar.style.transition = ''
      // The contents may have changed again while this ran. Skip a detached node:
      // its scrollWidth is 0, and remembering 0 would make the next bar grow from
      // nothing -- the very thing this exists to prevent.
      if (bar.isConnected) lastNavWidth = bar.scrollWidth
    }

    bar.addEventListener('transitionend', done, { once: true })
    // A transitionend that never arrives -- interrupted, or a value the browser
    // decided not to animate -- would otherwise leave the bar pinned at an inline
    // width forever. `done` is idempotent, so whichever fires first wins.
    setTimeout(done, 1000)
    // Deliberately no cleanup and no dependency array: this runs after every render,
    // and returning a cleanup would tear the listener down before the transition it
    // belongs to had finished.
  })

  // Meta on a Mac, Control elsewhere (the e2e suite also runs on Linux CI).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setOverlay('palette')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <ShareContext.Provider value={workspace ? openShare : noop}>
      <div className={styles.shell}>
        <div className={styles.navWrap}>
          <nav ref={nav} className={styles.nav} aria-label="Primary">
            <Link href="/" aria-label="All workspaces">
              <span className={styles.logo} />
            </Link>

            {workspace && (
              <>
                <Link
                  className={styles.workspaceName}
                  href={`/workspaces/${workspace.id}`}
                  title={workspace.name}
                  data-testid="workspace-link"
                >
                  {workspace.name}
                </Link>
                <span className={styles.divider} />
              </>
            )}

            {workspace && documents ? (
              <NavTabs workspaceId={workspace.id} documents={documents} />
            ) : (
              /* No workspace in context, so there are no tabs. The bar is now sized to
                 its contents, so an unlabelled slot here would be a visible hole. */
              <div className={styles.tabsSlot}>
                <span className={styles.navContext} data-testid="nav-context">
                  Workspaces
                </span>
              </div>
            )}

            {role === 'viewer' && (
              <span className={`${ui.chip} ${styles.viewOnly}`} data-testid="view-only">
                View only
              </span>
            )}

            <button
              type="button"
              ref={searchButton}
              className={styles.search}
              onClick={openPalette}
              aria-label="Search"
              aria-keyshortcuts="Meta+K Control+K"
              data-testid="search"
            >
              <span className={styles.searchLabel}>Search</span>
              <span className={styles.kbd}>⌘K</span>
            </button>

            <SyncStatus />
            <NavPresence />

            {workspace && (
              <Button variant="accent" onClick={openShare} data-testid="share">
                Share
              </Button>
            )}

            <UserMenu user={user} />
          </nav>
        </div>

        <main className={styles.content}>{children}</main>

        {/*
          Outside the nav on purpose: the nav has a backdrop-filter, which makes it
          the containing block for any position:fixed descendant. Rendered inside
          it, the overlay would be confined to the nav's 56px bar instead of
          covering the viewport.
        */}
        {overlay === 'palette' && (
          <CommandPalette
            workspace={workspace}
            documents={documents}
            workspaces={workspaces}
            onClose={closeOverlay}
            onOpenShare={workspace ? openShare : undefined}
            fallbackFocus={searchButton}
          />
        )}

        {workspace && overlay === 'share' && (
          <ShareSheet
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            members={members}
            canManage={canManage}
            onClose={closeOverlay}
          />
        )}
      </div>
    </ShareContext.Provider>
  )
}

function noop() {}
