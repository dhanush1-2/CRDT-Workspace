'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLayoutEffect, useRef, useState } from 'react'
import { hasOthersHere, useDocState } from '@/lib/doc-state'
import { activeDocumentIdFrom, documentHref } from '@/lib/routes'
import type { NavDocument } from './AppShell'
import { NavMenu } from './NavMenu'
import styles from './nav-tabs.module.css'

type Metrics = { x: number; w: number }

/**
 * The pill's last position, kept outside the component so it survives a client
 * navigation.
 *
 * Every page renders its own AppShell, so this component is a new instance on every
 * navigation and its state starts empty -- which made the pill appear at its
 * destination instead of travelling there. Seeded from this, the new nav first draws
 * the pill where the old one left it and then slides to the new tab.
 *
 * Safe despite being module scope on the server: it is only ever written from
 * measureIndicator, which runs in a layout effect, and layout effects do not run
 * during SSR. So on the server this is always null, every render agrees, and there is
 * nothing for hydration to disagree about.
 *
 * It can be stale across workspaces -- a position measured in one workspace's strip
 * means little in another's -- in which case the pill slides from a slightly wrong
 * place. Still better than materialising out of nothing. Within a workspace the nav now
 * lives in the workspace layout and is not rebuilt, so this only matters for a navigation
 * to or from the dashboard, which is outside that layout.
 */
let lastMetrics: Metrics | null = null

function isOverflowing(element: HTMLElement) {
  // The fade hints that there is more to scroll to, so it drops once the strip
  // is scrolled to the far end.
  return (
    element.scrollWidth > element.clientWidth + 2 &&
    element.scrollLeft + element.clientWidth < element.scrollWidth - 2
  )
}

export function NavTabs({
  workspaceId,
  documents,
}: {
  workspaceId: string
  documents: NavDocument[]
}) {
  // The nav lives in the workspace layout, which cannot see the [docId] param of the
  // segment below it. usePathname resolves during the server render too, so the
  // active tab is already marked in the HTML and hydration has nothing to correct.
  const pathname = usePathname()
  const activeDocumentId = activeDocumentIdFrom(pathname)
  // The store holds the open document only, so a dot can only ever appear on the active
  // tab. Presence on other documents needs per-document awareness the client does not
  // subscribe to.
  const { documentId, status, peers } = useDocState()
  // Only while connected. The dot claims other people are in this document right
  // now, and a disconnected tab cannot know that -- awareness goes stale rather
  // than empty, so without this the dot would keep asserting it after the socket
  // dropped.
  const othersHere = hasOthersHere({ status, peers })
  const strip = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(lastMetrics)
  const [overflowing, setOverflowing] = useState(false)
  // The transition is withheld until the indicator has been placed and painted
  // once. On a hard load the server renders the indicator at width 0 and it is only
  // sized during hydration, so animating from that first state would make the pill
  // visibly grow from nothing.
  //
  // After a client navigation there is a remembered position to start from, so the
  // transition is on from the first frame -- that is the whole point of remembering it.
  const [animated, setAnimated] = useState(lastMetrics !== null)
  const animatedOnce = useRef(lastMetrics !== null)

  function measureIndicator(element: HTMLElement) {
    const active = element.querySelector<HTMLElement>('[data-active="true"]')
    if (!active) {
      setMetrics(null)
      return null
    }
    const next = { x: active.offsetLeft, w: active.offsetWidth }
    // Remembered for the next instance of this component; see lastMetrics.
    lastMetrics = next
    // offsetLeft is relative to the positioned strip, so it does not change as
    // the strip scrolls. Bail out when nothing moved to skip a re-render.
    setMetrics((prev) => (prev && prev.x === next.x && prev.w === next.w ? prev : next))
    return active
  }

  // Runs when the active tab or the tab list changes. useLayoutEffect so the
  // indicator is positioned before the first client paint.
  useLayoutEffect(() => {
    const element = strip.current
    if (!element) return

    const active = measureIndicator(element)

    // Keep the active tab in view without scrollIntoView, which also scrolls
    // every ancestor and yanks the whole page sideways. This runs only when the
    // active tab changes: running it on every scroll event would drag the strip
    // back whenever the user scrolled away from the active tab by hand.
    if (active) {
      const left = active.offsetLeft
      const right = left + active.offsetWidth
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth'
      if (left < element.scrollLeft) {
        element.scrollTo({ left: left - 12, behavior })
      } else if (right > element.scrollLeft + element.clientWidth) {
        element.scrollTo({ left: right - element.clientWidth + 24, behavior })
      }
    }
    setOverflowing(isOverflowing(element))

    if (animatedOnce.current) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        animatedOnce.current = true
        setAnimated(true)
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocumentId, documents])

  // The dot widens the active tab, so the indicator must be re-measured when it
  // appears or goes. The strip's own ResizeObserver does not fire: the strip does not
  // change size, one tab inside it does.
  useLayoutEffect(() => {
    const element = strip.current
    if (element) measureIndicator(element)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, othersHere])

  // Resize re-measures the indicator; scrolling only updates the edge fade.
  useLayoutEffect(() => {
    const element = strip.current
    if (!element) return

    const observer = new ResizeObserver(() => {
      measureIndicator(element)
      setOverflowing(isOverflowing(element))
    })
    observer.observe(element)
    const onScroll = () => setOverflowing(isOverflowing(element))
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div
        className={styles.strip}
        ref={strip}
        style={{
          maskImage: overflowing ? 'linear-gradient(90deg,#000 82%,transparent)' : 'none',
          WebkitMaskImage: overflowing ? 'linear-gradient(90deg,#000 82%,transparent)' : 'none',
        }}
      >
        <span
          className={`${styles.indicator} ${animated ? styles.indicatorAnimated : ''}`}
          aria-hidden="true"
          style={{
            transform: `translateX(${metrics?.x ?? 0}px)`,
            width: metrics?.w ?? 0,
            opacity: metrics ? 1 : 0,
          }}
        />

        <Link
          className={`${styles.tab} ${!activeDocumentId ? styles.tabActive : ''}`}
          href={`/workspaces/${workspaceId}`}
          aria-current={!activeDocumentId ? 'page' : undefined}
          data-active={!activeDocumentId}
          data-testid="tab-overview"
        >
          Overview
        </Link>

        {documents.map((document) => {
          const isActive = document.id === activeDocumentId
          return (
            <Link
              key={document.id}
              className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
              href={documentHref(workspaceId, document.id)}
              aria-current={isActive ? 'page' : undefined}
              data-active={isActive}
              data-testid={`tab-${document.id}`}
            >
              {document.title}
              {document.id === documentId && othersHere && (
                <span
                  className={styles.presenceDot}
                  aria-hidden="true"
                  data-testid={`tab-dot-${document.id}`}
                />
              )}
            </Link>
          )
        })}
      </div>
      <NavMenu workspaceId={workspaceId} documents={documents} othersHere={othersHere} />
    </>
  )
}
