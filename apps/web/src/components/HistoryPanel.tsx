'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import * as Y from 'yjs'
import { colorFor } from '@/lib/color'
import { formatVersionTime } from '@/lib/format'
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
  selectedVersionId,
  ref,
  style,
}: {
  documentId: string
  /** Unknown when the document is not in the nav's list; rows then show counts. */
  type?: 'doc' | 'board'
  onClose: () => void
  onPreview: (version: DocumentVersion) => void
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
        <ul className={styles.list}>
          {ready.versions.map((version) => (
            <li key={version.id}>
              <Row
                version={version}
                description={descriptions[version.id]}
                selected={version.id === selectedVersionId}
                onSeen={describe}
                onSelect={onPreview}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Row({
  version,
  description,
  selected,
  onSeen,
  onSelect,
}: {
  version: DocumentVersion
  description: string | undefined
  selected: boolean
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
      aria-current={selected ? 'true' : undefined}
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
