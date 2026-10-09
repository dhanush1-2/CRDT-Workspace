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
  takeOpenFocus,
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
  /**
   * Asked once, when the panel mounts: true if the user just opened it and focus should
   * move in. The panel also mounts when the page navigates to another document with it
   * open (it is keyed on the document), and then focus is wherever the user left it.
   */
  takeOpenFocus: () => boolean
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
  // Only when it was opened, not each time it remounts for another document.
  useEffect(() => {
    if (takeOpenFocus()) heading.current?.focus()
    // Mount only: the answer is about how this panel came to exist.
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
  // One stop per version, counted from the oldest (stop 0 is the oldest version, stop
  // length - 1 the newest listed one), plus a last stop, `count`, for Now. Now is the
  // live document, which can hold edits newer than the newest version, so it is not the
  // newest version and has no row. `scrub` is where the thumb is while it is moving and
  // has not yet chosen anything; null once settled, when the thumb goes back to
  // following the selection.
  const count = versions.length
  const versionAt = (stop: number): DocumentVersion | undefined => versions[count - 1 - stop]
  const [scrub, setScrub] = useState<number | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsettled = useRef<number | null>(null)
  const stopWatchingPointer = useRef<(() => void) | null>(null)
  // What a settle reads when it runs: it fires from a timer and a window listener, which
  // would otherwise hold the props of the render that scheduled them.
  const latest = useRef({ versions, selectedVersionId, onPreview, onLive })
  latest.current = { versions, selectedVersionId, onPreview, onLive }

  const clearSettleTimer = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = null
  }, [])

  /** Chooses where the thumb is, if it has moved since the last choice. */
  const settle = useCallback(() => {
    clearSettleTimer()
    const stop = unsettled.current
    if (stop === null) return
    unsettled.current = null
    setScrub(null)
    const { versions, selectedVersionId, onPreview, onLive } = latest.current
    if (stop >= versions.length) {
      if (selectedVersionId !== null) onLive()
      return
    }
    // Not onPreview again for the version already chosen: a repeat choice means "retry".
    const version = versions[versions.length - 1 - stop]
    if (version && version.id !== selectedVersionId) onPreview(version)
  }, [clearSettleTimer])

  const moveTo = useCallback(
    (stop: number) => {
      unsettled.current = stop
      setScrub(stop)
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

  // The selection changed under a slider that was still waiting to choose: Back to now,
  // or the preview ending some other way. Whatever the thumb was heading for would have
  // brought a preview back after the user had left it. The settle's own change reaches
  // here too, and finds nothing left to abandon: settle clears the pending stop and the
  // timer before it chooses, and a keypress cannot fall between that and this render,
  // because the selection is an external store and React flushes it before the next event.
  useEffect(() => {
    abandonScrub()
  }, [selectedVersionId, abandonScrub])

  /**
   * A drag ends with the pointer, which may be released away from the thumb, so the
   * listeners are on the window, and only while a drag is under way.
   */
  const watchPointer = useCallback(() => {
    stopWatchingPointer.current?.()
    const release = () => {
      stopWatchingPointer.current?.()
      settle()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    stopWatchingPointer.current = () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      stopWatchingPointer.current = null
    }
  }, [settle])

  // The window losing focus is the one other time to choose without waiting. Not the
  // slider losing it: clicking a row blurs the slider first, and that would fetch the
  // version the thumb was on as well as the row's.
  useEffect(() => {
    window.addEventListener('blur', settle)
    return () => window.removeEventListener('blur', settle)
  }, [settle])

  // Closing the panel discards a choice that has not settled: nothing is left to fire
  // after the panel is gone and select a version on a document that is back to live.
  useEffect(
    () => () => {
      clearSettleTimer()
      unsettled.current = null
      stopWatchingPointer.current?.()
    },
    [clearSettleTimer],
  )

  const selectedAt = versions.findIndex((version) => version.id === selectedVersionId)
  const settledStop = selectedAt < 0 ? count : count - 1 - selectedAt
  const thumbAt = scrub ?? settledStop
  const thumbVersion = versionAt(thumbAt)
  const highlightedId = scrub !== null ? thumbVersion?.id : selectedVersionId

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
              max={count}
              step={1}
              value={thumbAt}
              onChange={(event) => moveTo(Number(event.currentTarget.value))}
              // A keyboard has no end to wait for: it settles after the pause, so a quick
              // run of arrow presses is one choice.
              onPointerDown={watchPointer}
              data-testid="history-slider"
            />
            <div className={styles.ends} aria-hidden="true">
              <span>Earliest</span>
              <span>Now</span>
            </div>
          </div>
          <ul className={styles.list}>
            {ready.versions.map((version) => (
              <li key={version.id}>
                <Row
                  version={version}
                  description={descriptions[version.id]}
                  selected={version.id === highlightedId}
                  follow={scrub !== null && version.id === highlightedId}
                  scrubbing={scrub !== null}
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
  follow,
  scrubbing,
  onSeen,
  onSelect,
}: {
  version: DocumentVersion
  description: string | undefined
  selected: boolean
  /** The slider is moving and is on this row: keep it in view. */
  follow: boolean
  /**
   * The slider is moving, on this row or another. A row it passes is not one the user has
   * stopped at, so nothing is described until it settles.
   */
  scrubbing: boolean
  onSeen: (versionId: string) => void
  onSelect: (version: DocumentVersion) => void
}) {
  const button = useRef<HTMLButtonElement>(null)

  // Describe a row when it is on screen. Inside the list's scroll container the
  // intersection is clipped to what is actually visible, so a row below the fold
  // does not count until it is scrolled to.
  //
  // Not while the slider is moving: it scrolls each row it reaches into view, and each
  // would be described on the way past. The observer is simply not made until the slider
  // settles, when `scrubbing` flips and the effect runs again, so the rows left on screen
  // are the ones described. Gating inside `onSeen` instead would be wrong: an observer
  // disconnects after its first hit, so a refused row would never be offered again.
  useEffect(() => {
    if (scrubbing) return
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
  }, [onSeen, version.id, scrubbing])

  // A row the slider has moved to may be far down a long list.
  useEffect(() => {
    if (follow) button.current?.scrollIntoView({ block: 'nearest' })
  }, [follow])

  // A selected row is described whether or not it was ever scrolled to, once the slider
  // has stopped on it: while it moves, the highlight is only passing through.
  useEffect(() => {
    if (selected && !scrubbing) onSeen(version.id)
  }, [selected, scrubbing, onSeen, version.id])

  const name = version.author?.name || 'Unknown'
  return (
    <button
      type="button"
      ref={button}
      className={styles.row}
      aria-pressed={selected}
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
