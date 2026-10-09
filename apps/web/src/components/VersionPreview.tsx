'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as Y from 'yjs'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import type { JSONContent } from '@tiptap/react'
import { Board } from './Board'
import { DocumentEditor } from './DocumentEditor'
import { EDITOR_FRAGMENT } from './editor-fragment'
import { fetchVersionState, VersionTooLargeError } from '@/lib/history-client'
import type { VersionDetails } from '@/lib/version-selection'
import styles from './version-preview.module.css'

/** What a fetched state became: text for a document, a throwaway Y.Doc for a board. */
type Built = { versionId: string; label?: string; details?: VersionDetails } & ({ content: JSONContent } | { board: Y.Doc })
type Failure = { versionId: string; attempt: number; message: string }

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

/**
 * Turns fetched bytes into something to render, on a Y.Doc made for this one version.
 * A document is read out as plain content and its Y.Doc destroyed on the spot; a board
 * keeps its Y.Doc because the board reads its cards from one, and VersionPreview destroys
 * it when the version changes or the preview goes away. Never the live doc: the bytes are
 * applied to a new one, which has no provider, no socket and no persistence.
 */
function build(
  type: 'doc' | 'board',
  versionId: string,
  label: string | undefined,
  details: VersionDetails | undefined,
  bytes: Uint8Array,
): Built {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, bytes)
    if (type === 'board') return { versionId, label, details, board: doc }
    const content = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(EDITOR_FRAGMENT)) as JSONContent
    doc.destroy()
    return { versionId, label, details, content: content.content?.length ? content : EMPTY_DOC }
  } catch (error) {
    doc.destroy()
    throw error
  }
}

/**
 * The document, or board, as it stood at `versionId`, read-only. With no `versionId` it
 * renders `fallback`, the live view, untouched.
 *
 * The preview replaces the live view rather than sitting over it, so there is never a
 * moment when both are mounted and one could write to the other. It is shown only once
 * its state has arrived; until then (and for good if the state cannot be had) the live
 * view stays on screen, with a notice when it failed. The live doc and its provider are
 * owned by the page and are not touched here: only the editor or board built on them
 * comes and goes.
 */
export function VersionPreview({
  documentId,
  versionId,
  attempt = 0,
  label,
  details,
  onShown,
  type,
  heading,
  sheetClassName,
  fallback,
}: {
  documentId: string
  /** Null when nothing is selected. */
  versionId: string | null
  /** Which pick of that version this is; a higher one retries a failed load. */
  attempt?: number
  /** Names the version for a screen reader. */
  label?: string
  /** The same version in parts, handed back through `onShown` for the pill to quote. */
  details?: VersionDetails
  /**
   * Told which version is actually on screen: its id and details when a preview is
   * showing, null when the live view is (nothing chosen, still loading the first, or
   * the chosen one failed). The version on screen can trail the one chosen while the
   * next one loads, so whoever describes it should ask here rather than assume.
   */
  onShown?: (shown: { versionId: string; details?: VersionDetails } | null) => void
  type: 'doc' | 'board'
  /** A plain, non-editable title: a past version cannot be renamed. */
  heading: ReactNode
  sheetClassName?: string
  /** The live view, shown whenever there is no preview to show. */
  fallback: ReactNode
}) {
  // The last version that loaded stays up while the next one loads, so moving between
  // rows does not flash the live page between them.
  const [shown, setShown] = useState<Built | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)

  // Read by the effect below without being one of its dependencies: a version that is
  // already on screen must not be fetched and rebuilt because it was clicked again.
  const showing = useRef<string | null>(null)
  showing.current = shown?.versionId ?? null
  const labelRef = useRef(label)
  labelRef.current = label
  const detailsRef = useRef(details)
  detailsRef.current = details

  useEffect(() => {
    if (!versionId) {
      setShown(null)
      return
    }
    if (showing.current === versionId) return
    let current = true
    fetchVersionState(documentId, versionId, { urgent: true }).then(
      (bytes) => {
        if (!current) return
        try {
          setShown(build(type, versionId, labelRef.current, detailsRef.current, bytes))
          setFailure(null)
        } catch {
          setShown(null)
          setFailure({ versionId, attempt, message: 'Could not read that version.' })
        }
      },
      (error: unknown) => {
        if (!current) return
        setShown(null)
        setFailure({
          versionId,
          attempt,
          message:
            error instanceof VersionTooLargeError
              ? 'This version is too large to preview.'
              : 'Could not load that version. Try again.',
        })
      },
    )
    return () => {
      current = false
    }
  }, [documentId, versionId, attempt, type])

  // A board's throwaway Y.Doc goes when it is replaced or the preview unmounts.
  useEffect(() => {
    if (!shown || !('board' in shown)) return
    const doc = shown.board
    return () => doc.destroy()
  }, [shown])

  // Tied to the attempt, so choosing the row again drops the old notice in the same
  // render, before the new fetch has had time to fail or succeed.
  const failed = failure?.versionId === versionId && failure.attempt === attempt ? failure : null
  const preview = versionId && !failed ? shown : null

  // The live view fades back in when it returns from a preview (it mounts again then),
  // but not on the page's first load, where nothing has swapped.
  const [previewed, setPreviewed] = useState(false)
  useEffect(() => {
    if (preview) setPreviewed(true)
  }, [preview])

  const shownId = preview?.versionId ?? null
  const shownDetails = preview?.details
  const onShownRef = useRef(onShown)
  onShownRef.current = onShown
  useEffect(() => {
    onShownRef.current?.(shownId ? { versionId: shownId, details: shownDetails } : null)
  }, [shownId, shownDetails])

  return (
    <>
      {failed && (
        <p
          role="alert"
          className={styles.notice}
          data-testid="preview-notice"
          data-version-preview=""
        >
          {failed.message}
        </p>
      )}
      {/* Always mounted, so a screen reader is watching it before its text changes. Focus
          stays in the panel, so without this the page swapping underneath is silent. */}
      <p role="status" className={styles.visuallyHidden} data-testid="preview-status">
        {preview?.label ? `Showing the version from ${preview.label}.` : ''}
      </p>
      {preview ? (
        <div
          key={preview.versionId}
          role="region"
          aria-label={`Earlier version of this ${type === 'board' ? 'board' : 'document'}`}
          className={styles.fade}
          data-testid="version-preview"
          data-version-preview=""
          data-version-id={preview.versionId}
        >
          {'board' in preview ? (
            <>
              {heading}
              <Board doc={preview.board} provider={null} readOnly />
            </>
          ) : (
            <DocumentEditor
              doc={null}
              provider={null}
              user={{ name: '', color: '' }}
              readOnly
              toolbar={false}
              content={preview.content}
              sheetClassName={sheetClassName}
              heading={heading}
            />
          )}
        </div>
      ) : (
        <div key="live" className={previewed ? styles.fade : undefined}>
          {fallback}
        </div>
      )}
    </>
  )
}
