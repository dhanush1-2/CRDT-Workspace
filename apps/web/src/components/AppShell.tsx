'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Role } from '@crdt/shared/types'
import { colorFor } from '@/lib/color'
import { useDocState } from '@/lib/doc-state'
import { activeDocumentIdFrom } from '@/lib/routes'
import type { SessionUser } from '@/lib/current-user'
import type { WorkspaceMemberView } from '@/lib/members'
import { CommandPalette } from './CommandPalette'
import { HistoryButton } from './HistoryButton'
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

/**
 * The bar's width including its border. `scrollWidth` leaves the border out, and the bar
 * is border-box, so pinning an inline width taken from `scrollWidth` alone pins it a
 * couple of pixels narrower than the bar really is.
 */
function naturalWidth(bar: HTMLElement) {
  return bar.scrollWidth + (bar.offsetWidth - bar.clientWidth)
}

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
  // Read from the path rather than from the doc-state store: the store is populated
  // by the page after it mounts, so the button would pop into the nav a beat after
  // the rest of it.
  const activeDocumentId = activeDocumentIdFrom(usePathname())
  const onDocument = activeDocumentId !== undefined
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
  // Ends the running width animation where it stands, leaving the inline style alone.
  const stopAnimation = useRef<(() => void) | null>(null)

  // Subscribed for the re-render, not for the values. The nav's width changes when
  // the green dot appears, when the status label switches between "Synced" and
  // "3 here", and when presence avatars arrive -- none of which changes a prop of
  // this component, so without this the effect below would never see them. The
  // store's equality gate means this only fires on real changes.
  const docState = useDocState()

  // The document on screen has connected. Its people arrive a beat after that, so the bar
  // is held a little longer (below); measured the instant the status flips, it is still
  // the width of a document with nobody in it.
  const connectedHere =
    activeDocumentId !== undefined &&
    docState.documentId === activeDocumentId &&
    docState.status === 'connected'
  const [graceOverFor, setGraceOverFor] = useState<string | null>(null)
  useEffect(() => {
    if (!connectedHere) {
      setGraceOverFor(null)
      return
    }
    const timer = window.setTimeout(() => setGraceOverFor(activeDocumentId ?? null), 300)
    return () => window.clearTimeout(timer)
  }, [connectedHere, activeDocumentId])

  // A document on screen that has not finished arriving. Its status text and people are
  // placeholders that are about to be replaced, so the bar must not shrink to them.
  const settling =
    activeDocumentId !== undefined &&
    (docState.documentId !== activeDocumentId ||
      docState.status === 'connecting' ||
      (connectedHere && graceOverFor !== activeDocumentId))
  const holding = useRef(false)
  // Which document's hold has run out. Keyed by document rather than a boolean: moving on
  // from one that never connected to the next must start a fresh hold, and a flag that is
  // only reset in an effect would still read as expired during the first render there.
  const [expiredFor, setExpiredFor] = useState<string | null>(null)
  const holdExpired = expiredFor !== null && expiredFor === activeDocumentId
  useEffect(() => {
    if (!settling) {
      setExpiredFor(null)
      return
    }
    // Never hold forever: a document that cannot connect still gets a correct bar. Long
    // enough for a production connect (token fetch, then the socket handshake).
    const timer = window.setTimeout(() => setExpiredFor(activeDocumentId ?? null), 3000)
    return () => window.clearTimeout(timer)
  }, [settling, activeDocumentId])

  // Keep the remembered width equal to what is on screen. After a transition here ends,
  // CSS can keep growing the bar (interpolate-size, people arriving), and a start taken
  // from the stale value would pull the bar back before the next move. Skipped while this
  // component is driving the width itself, when the bar is deliberately not its natural size.
  useEffect(() => {
    const bar = nav.current
    if (!bar) return
    const observer = new ResizeObserver(() => {
      if (animatingWidth.current || holding.current || !bar.isConnected) return
      lastNavWidth = naturalWidth(bar)
    })
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])

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
    if (animatingWidth.current) {
      // Except when the next document is still connecting. Letting the animation run out
      // would clear the inline width and drop the bar to the connecting placeholders, then
      // grow it back: the collapse the hold exists to prevent. Take over from where the bar
      // is on screen instead; the code below holds it there or animates once from there.
      if (!settling || holdExpired) return
      const shown = bar.getBoundingClientRect().width
      stopAnimation.current?.()
      lastNavWidth = shown
      holding.current = true
    }

    // Measure the natural width: an inline width left by a hold would make scrollWidth
    // report the held value instead.
    // Without a transition while doing so: with one, clearing the inline width starts a CSS
    // transition from the held width, which is what `scrollWidth` would then report.
    if (holding.current) {
      bar.style.transition = 'none'
      bar.style.width = ''
    }

    const to = naturalWidth(bar)
    const from = lastNavWidth

    if (settling && !holdExpired && from !== null && to < from - 1) {
      // Hold: keep the current width until the document connects; the next render after
      // that animates once, from here to the final width. lastNavWidth stays as it was.
      holding.current = true
      bar.style.transition = 'none'
      bar.style.width = `${from}px`
      return
    }
    holding.current = false
    bar.style.transition = ''
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
    const stop = () => {
      settled = true
      cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      bar.removeEventListener('transitionend', done)
      animatingWidth.current = false
      stopAnimation.current = null
    }
    // transitionend bubbles: a tab's colour or the nav's own height ending would otherwise
    // end this early. Only the bar's own width counts. (The timeout fallback passes nothing.)
    const done = (event?: TransitionEvent) => {
      if (event && (event.target !== bar || event.propertyName !== 'width')) return
      if (settled) return
      stop()
      bar.style.width = ''
      bar.style.transition = ''
      // The contents may have changed again while this ran. Skip a detached node:
      // its scrollWidth is 0, and remembering 0 would make the next bar grow from
      // nothing -- the very thing this exists to prevent.
      if (bar.isConnected) lastNavWidth = naturalWidth(bar)
    }

    bar.addEventListener('transitionend', done)
    // A transitionend that never arrives -- interrupted, or a value the browser
    // decided not to animate -- would otherwise leave the bar pinned at an inline
    // width forever. `done` is idempotent, so whichever fires first wins.
    const timeout = window.setTimeout(() => done(), 1000)
    stopAnimation.current = () => {
      if (!settled) stop()
    }
    // Deliberately no cleanup and no dependency array: this runs after every render,
    // and returning a cleanup would tear the listener down before the transition it
    // belongs to had finished.
  })

  // Condensed once the page has scrolled past the bar's own height. One boolean, so
  // scrolling costs at most one re-render per crossing.
  const [condensed, setCondensed] = useState(false)

  useEffect(() => {
    let frame = 0
    function read() {
      frame = 0
      // A dead band, not a single threshold: at exactly 24px a one-pixel wobble
      // flips the state on every frame, and each flip re-renders the whole nav.
      setCondensed((was) => (was ? window.scrollY > 12 : window.scrollY > 24))
    }
    function onScroll() {
      // Coalesce a burst of scroll events into one read per frame.
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    // Read once on mount. A reload part-way down the page, or a #fragment target,
    // arrives already scrolled and fires no scroll event.
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [])

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
      <div className={styles.shell} data-nav-condensed={condensed}>
        <div className={`${styles.navWrap} ${condensed ? styles.navWrapCondensed : ''}`}>
          <nav
            ref={nav}
            className={`${styles.nav} ${condensed ? styles.navCondensed : ''}`}
            aria-label="Primary"
            data-testid="nav-bar"
            data-condensed={condensed}
          >
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

            {onDocument && (
              <NavPresence
                self={{ name: user.name, color: colorFor(user.id) }}
                documentId={activeDocumentId ?? null}
              />
            )}
            {activeDocumentId !== undefined && (
              <HistoryButton
                documentId={activeDocumentId}
                type={documents?.find((document) => document.id === activeDocumentId)?.type}
              />
            )}
            <SyncStatus documentId={activeDocumentId ?? null} />

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
