'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import * as Y from 'yjs'
import { colorFor } from '@/lib/color'
import { formatVersionLabel, formatVersionTime } from '@/lib/format'
import {
  fetchVersions,
  fetchVersionState,
  listReachesFirstVersion,
  type DocumentVersion,
} from '@/lib/history-client'
import { describeChange, describeCount } from '@/lib/version-description'
import styles from './history-panel.module.css'

/** What the panel asks the server for. The panel is a recent-history view, not an archive. */
const LIST_LIMIT = 50

/**
 * How long the slider waits after its last movement before it chooses a version. Each
 * choice makes the server replay the document's history up to that version, so a drag
 * across ten versions must not ask for ten replays. The thumb and the highlighted row
 * move at once; only the choice waits.
 */
const SETTLE_MS = 200

const NO_VERSIONS: DocumentVersion[] = []

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; versions: DocumentVersion[]; complete: boolean }

/**
 * The sentence for one row.
 *
 * A row is described by comparing its state with the one before it in the list, so each
 * row costs two state requests (shared with its neighbours through the client's cache).
 * Anything that stops that comparison, whether the previous version is not in the list,
 * a state is too large to replay, or a request fails, falls back to the update count
 * instead of failing the row: a count is true, and the list is useful without sentences.
 */
async function describeVersion(
  documentId: string,
  type: 'doc' | 'board' | undefined,
  versions: DocumentVersion[],
  index: number,
  complete: boolean,
): Promise<string> {
  const version = versions[index]!
  const older = versions[index + 1]
  if (!type || (!older && !complete)) return describeCount(version.updateCount)

  const docs: Y.Doc[] = []
  const build = (bytes: Uint8Array) => {
    const doc = new Y.Doc()
    docs.push(doc)
    Y.applyUpdate(doc, bytes)
    return doc
  }
  try {
    if (!older) {
      // The document's first version: nothing before it, and describeChange does not
      // read `after` in that case, so its state is not worth a request.
      return describeChange(null, new Y.Doc(), type, version.updateCount)
    }
    const [before, after] = await Promise.all([
      fetchVersionState(documentId, older.id),
      fetchVersionState(documentId, version.id),
    ])
    return describeChange(build(before), build(after), type, version.updateCount)
  } catch {
    // Any failure falls back to the count for this open. The client's cache evicts
    // failures (a 413 excepted, which would only repeat), so reopening the panel retries.
    return describeCount(version.updateCount)
  } finally {
    for (const doc of docs) doc.destroy()
  }
}

export function HistoryPanel({
  documentId,
  type,
  onClose,
  onPreview,
  onLive,
  selectedVersionId,
  ref,
  style,
}: {
  documentId: string
  /** Unknown when the document is not in the nav's list; rows then show counts. */
  type?: 'doc' | 'board'
  onClose: () => void
  onPreview: (version: DocumentVersion) => void
  /** The slider reached Now: leave the preview and show the live document. */
  onLive: () => void
  selectedVersionId: string | null
  ref?: Ref<HTMLElement>
  /** Carries --nav-bottom, which does not cascade into a portal. */
  style?: CSSProperties
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [descriptions, setDescriptions] = useState<Record<string, string>>({})
  // Rows whose description has been asked for: a row scrolling in and out must not ask twice.
  const requested = useRef(new Set<string>())
  const heading = useRef<HTMLHeadingElement>(null)

  // The panel is portalled to the end of <body>, so it does not follow its button in tab
  // order; left alone, a keyboard user would Tab through the rest of the page to reach
  // it. Focus goes to the heading, not a control, so a screen reader announces the panel
  // it has entered and the first Tab lands on the close button. Not a trap: Tab and
  // Escape leave it as usual (HistoryButton returns focus to its button on Escape).
  useEffect(() => {
    heading.current?.focus()
  }, [])

  useEffect(() => {
    let current = true
    requested.current = new Set()
    setLoad({ kind: 'loading' })
    setDescriptions({})
    fetchVersions(documentId, LIST_LIMIT).then(
      (versions) => {
        if (!current) return
        setLoad({
          kind: 'ready',
          versions,
          complete: listReachesFirstVersion(versions, LIST_LIMIT),
        })
      },
      (error: unknown) => {
        if (!current) return
        setLoad({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not load history',
        })
      },
    )
    return () => {
      current = false
    }
  }, [documentId, attempt])

  const ready = load.kind === 'ready' ? load : null
  const versions = ready?.versions ?? NO_VERSIONS

  // --- The slider ---
  //
  // Positions are counted from the oldest version, so the right-hand end (the last
  // position) is Now: the live document, which is no version at all. `scrub` is where
  // the thumb is while it is moving and has not yet chosen anything; null once settled,
  // when the thumb goes back to following the selection.
  const top = Math.max(versions.length - 1, 0)
  const [scrub, setScrub] = useState<number | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsettled = useRef<number | null>(null)
  // What a settle reads when it runs: it fires from a timer and a window listener, which
  // would otherwise hold the props of the render that scheduled them.
  const latest = useRef({ versions, selectedVersionId, onPreview, onLive })
  latest.current = { versions, selectedVersionId, onPreview, onLive }

  const clearSettleTimer = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = null
  }, [])

  /** Chooses the version the thumb is on, if it has moved since the last choice. */
  const settle = useCallback(() => {
    clearSettleTimer()
    const index = unsettled.current
    if (index === null) return
    unsettled.current = null
    setScrub(null)
    const { versions, selectedVersionId, onPreview, onLive } = latest.current
    const end = versions.length - 1
    if (index >= end) {
      if (selectedVersionId !== null) onLive()
      return
    }
    // Not onPreview again for the version already chosen: a repeat choice means "retry".
    const version = versions[end - index]
    if (version && version.id !== selectedVersionId) onPreview(version)
  }, [clearSettleTimer])

  const moveTo = useCallback(
    (index: number) => {
      unsettled.current = index
      setScrub(index)
      clearSettleTimer()
      settleTimer.current = setTimeout(settle, SETTLE_MS)
    },
    [settle, clearSettleTimer],
  )

  /** A row was chosen directly: whatever the thumb was heading for no longer matters. */
  const abandonScrub = useCallback(() => {
    clearSettleTimer()
    unsettled.current = null
    setScrub(null)
  }, [clearSettleTimer])

  useEffect(() => clearSettleTimer, [clearSettleTimer])

  const selectedAt = versions.findIndex((version) => version.id === selectedVersionId)
  const settledIndex = selectedAt < 0 ? top : top - selectedAt
  const thumbAt = scrub ?? settledIndex
  const atNow = scrub !== null ? scrub >= top : selectedVersionId === null
  const highlightedId = scrub !== null ? (scrub >= top ? null : versions[top - scrub]?.id) : selectedVersionId
  const thumbVersion = atNow ? undefined : versions[top - thumbAt]

  const describe = useCallback(
    (versionId: string) => {
      if (!ready || requested.current.has(versionId)) return
      requested.current.add(versionId)
      const index = ready.versions.findIndex((version) => version.id === versionId)
      if (index < 0) return
      void describeVersion(documentId, type, ready.versions, index, ready.complete).then(
        (description) => setDescriptions((was) => ({ ...was, [versionId]: description })),
      )
    },
    [documentId, type, ready],
  )

  return (
    <section
      id="history-panel"
      ref={ref}
      className={styles.panel}
      style={style}
      aria-labelledby="history-title"
      data-testid="history-panel"
    >
      <div className={styles.header}>
        <h2 id="history-title" ref={heading} tabIndex={-1} className={styles.title}>
          History
        </h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close history">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {load.kind === 'loading' && (
        <p className={styles.note} role="status" data-testid="history-loading">
          Loading versions…
        </p>
      )}

      {load.kind === 'error' && (
        <div className={styles.error} role="alert">
          <p>{load.message}</p>
          <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      {ready && ready.versions.length === 0 && (
        <p className={styles.note} data-testid="history-empty">
          No versions yet. Changes to this document will be listed here.
        </p>
      )}

      {ready && ready.versions.length > 0 && (
        <>
          <div className={styles.scrub}>
            <input
              type="range"
              className={styles.slider}
              aria-label="Version"
              aria-valuetext={thumbVersion ? formatVersionLabel(thumbVersion) : 'Now'}
              min={0}
              max={top}
              step={1}
              value={thumbAt}
              // One version leaves nothing to move between.
              disabled={ready.versions.length < 2}
              onChange={(event) => moveTo(Number(event.currentTarget.value))}
              // A drag ends with the pointer, which may be released away from the thumb, so
              // the listener is on the window. A keyboard has no end to wait for: it settles
              // after the pause, so a quick run of arrow presses is one choice.
              onPointerDown={() => {
                window.addEventListener('pointerup', settle, { once: true })
                window.addEventListener('pointercancel', settle, { once: true })
              }}
              onBlur={settle}
              data-testid="history-slider"
            />
            <div className={styles.ends} aria-hidden="true">
              <span>Earliest</span>
              <span>Now</span>
            </div>
          </div>
          <ul className={styles.list}>
            {ready.versions.map((version, index) => (
              <li key={version.id}>
                <Row
                  version={version}
                  description={descriptions[version.id]}
                  selected={version.id === highlightedId}
                  // Now sits on the newest row, which is as near as the list can point.
                  current={atNow && index === 0}
                  follow={scrub !== null && (version.id === highlightedId || (atNow && index === 0))}
                  onSeen={describe}
                  onSelect={(chosen) => {
                    abandonScrub()
                    onPreview(chosen)
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function Row({
  version,
  description,
  selected,
  current,
  follow,
  onSeen,
  onSelect,
}: {
  version: DocumentVersion
  description: string | undefined
  selected: boolean
  /** The live document is showing and this is the newest version. */
  current: boolean
  /** The slider is moving and is on this row: keep it in view. */
  follow: boolean
  onSeen: (versionId: string) => void
  onSelect: (version: DocumentVersion) => void
}) {
  const button = useRef<HTMLButtonElement>(null)

  // Describe a row when it is on screen. Inside the list's scroll container the
  // intersection is clipped to what is actually visible, so a row below the fold
  // does not count until it is scrolled to.
  useEffect(() => {
    const element = button.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        onSeen(version.id)
      },
      { rootMargin: '80px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [onSeen, version.id])

  // A row the slider has moved to may be far down a long list.
  useEffect(() => {
    if (follow) button.current?.scrollIntoView({ block: 'nearest' })
  }, [follow])

  // A selected row is described whether or not it was ever scrolled to.
  useEffect(() => {
    if (selected) onSeen(version.id)
  }, [selected, onSeen, version.id])

  const name = version.author?.name || 'Unknown'
  return (
    <button
      type="button"
      ref={button}
      className={styles.row}
      aria-pressed={selected}
      aria-current={current ? 'true' : undefined}
      onClick={() => onSelect(version)}
      data-testid="history-row"
    >
      <span
        className={styles.avatar}
        style={{ background: version.author ? colorFor(version.author.id) : 'var(--text-faint)' }}
        aria-hidden="true"
      >
        {version.author ? name.trim().charAt(0).toUpperCase() || '?' : '?'}
      </span>
      <span className={styles.text}>
        <span className={styles.description} data-testid="history-row-description">
          {description ?? '…'}
        </span>
        <span className={styles.meta}>
          <span data-testid="history-row-author">{name}</span>
          {' · '}
          {formatVersionTime(version.endedAt)}
        </span>
      </span>
    </button>
  )
}
