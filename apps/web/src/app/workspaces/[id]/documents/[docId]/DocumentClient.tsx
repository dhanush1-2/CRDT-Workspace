'use client'

import { useEffect, useRef, useState } from 'react'
import { useCollaborativeDoc } from '@/hooks/use-doc'
import { useAnnouncePresence, usePresence } from '@/hooks/use-presence'
import { Board } from '@/components/Board'
import { DocumentEditor } from '@/components/DocumentEditor'
import { InlineTitle } from '@/components/InlineTitle'
import { VersionBar } from '@/components/VersionBar'
import { VersionPreview } from '@/components/VersionPreview'
import { useToast } from '@/components/ui/Toast'
import { clearDocState, hasOthersHere, publishDocState } from '@/lib/doc-state'
import { fetchVersionState } from '@/lib/history-client'
import { restoreFromState, restoreMessage } from '@/lib/restore-version'
import { clearVersion, useVersionSelection, type VersionDetails } from '@/lib/version-selection'
import styles from './document.module.css'

/**
 * Puts keyboard focus on the live page once it is back, for when the pill that held it
 * goes. The editor if there is one to type in; otherwise the title, which is given a
 * tabindex only so it can be focused (it is not a tab stop). An editor is created a
 * moment after the page mounts, so it is looked for over a few frames, not once.
 * Returns a cancel.
 */
function focusLiveView(editable: boolean): () => void {
  let frame = 0
  let tries = 0
  const attempt = () => {
    const editor = document.querySelector<HTMLElement>(
      '[data-testid="document-page"] .ProseMirror[contenteditable="true"]',
    )
    if (editor) {
      editor.focus({ preventScroll: true })
      return
    }
    if (editable && ++tries < 30) {
      frame = requestAnimationFrame(attempt)
      return
    }
    const heading = document.querySelector<HTMLElement>('[data-testid="document-heading"]')
    if (!heading) return
    // Focusable for this one call only: left in place it would make the title a click
    // target that takes focus, which a heading should not be.
    heading.tabIndex = -1
    heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true })
    heading.focus({ preventScroll: true })
  }
  attempt()
  return () => cancelAnimationFrame(frame)
}

export function DocumentClient({
  documentId,
  title,
  type,
  readOnly,
  user,
}: {
  documentId: string
  title: string
  type: 'doc' | 'board'
  readOnly: boolean
  user: { name: string; color: string }
}) {
  const { doc, provider, status, synced } = useCollaborativeDoc(documentId)
  const presence = usePresence(provider)
  useAnnouncePresence(provider, user)

  // Deliberately no dependency array: this runs after every render, and the store's
  // equality gate (same() in doc-state.ts) is what makes that cheap, because an
  // identical publish returns before notifying anyone. [documentId, status, presence]
  // would also be correct, since usePresence caches its snapshot by version and the
  // reference only changes when awareness does. Either way it is the gate that keeps
  // this safe, so keep it.
  useEffect(() => {
    publishDocState({
      documentId,
      status,
      peers: presence.map((peer) => ({
        clientId: peer.clientId,
        name: peer.name,
        color: peer.color,
      })),
    })
  })

  useEffect(() => () => clearDocState(documentId), [documentId])

  // A version picked in the History panel swaps the live view for a read-only one. The
  // pick belongs to this document: leaving it, or the page unmounting, drops it.
  const selection = useVersionSelection(documentId)
  useEffect(() => () => clearVersion(documentId), [documentId])

  // The version actually on screen, as VersionPreview reports it. Not the selection:
  // that can name a version that failed to load (the live view stays, so there is nothing
  // to restore or go back from) or trail the preview while the next one loads.
  const [shown, setShown] = useState<{ versionId: string; details?: VersionDetails } | null>(null)
  const toast = useToast()

  // Read after the awaits in restore(), when the answer may have changed.
  const others = hasOthersHere({ status, peers: presence })
  const othersRef = useRef(others)
  othersRef.current = others

  const refocus = useRef(false)
  useEffect(() => {
    if (selection || !refocus.current) return
    refocus.current = false
    return focusLiveView(type === 'doc' && !readOnly)
  }, [selection, type, readOnly])

  function backToNow() {
    refocus.current = true
    clearVersion(documentId)
  }

  async function restore(versionId: string, time: string) {
    if (!doc) return
    try {
      // Cached: the preview fetched it. A viewer cannot get here (no button), and the
      // sync server would refuse the update from one anyway.
      const state = await fetchVersionState(documentId, versionId)
      restoreFromState(doc, type, state)
    } catch (error) {
      console.error('restoring a version failed', error)
      toast('Could not restore that version. Try again.')
      return
    }
    toast(restoreMessage(time, othersRef.current))
    backToNow()
  }

  /*
    The page's only heading. Editors get the title as an input that reads as the heading
    (InlineTitle); viewers get the plain h1. A board now shows its title too: the owner
    asked to rename a board from inside it, which needs it on screen.
  */
  const headingClass = type === 'doc' ? styles.heading : styles.boardHeading
  const heading = readOnly ? (
    <h1 className={headingClass} data-testid="document-heading">
      {title}
    </h1>
  ) : (
    <h1 className={headingClass} data-testid="document-heading">
      <InlineTitle
        documentId={documentId}
        title={title}
        label={type === 'doc' ? 'Document title' : 'Board title'}
        className={styles.titleInput}
        testId="document-title"
      />
    </h1>
  )

  // The toolbar floats above the sheet as its own panel, so the editor can no longer
  // sit inside a wrapper rendered here: DocumentEditor renders both, and takes the
  // sheet's class and the heading so the sheet is still styled and titled from here.
  //
  // The board is a horizontal scroller with its own gutters and would be crushed into
  // a 780px column, so it gets no sheet and no toolbar.
  const live =
    type === 'doc' ? (
      <DocumentEditor
        doc={doc}
        provider={provider}
        user={user}
        readOnly={readOnly}
        sheetClassName={styles.page}
        heading={heading}
      />
    ) : (
      <div>
        {heading}
        {doc && <Board doc={doc} provider={provider} readOnly={readOnly} />}
      </div>
    )

  // A past version cannot be renamed, so its title is the plain heading whoever is looking.
  const previewHeading = (
    <h1 className={headingClass} data-testid="document-heading">
      {title}
    </h1>
  )

  // Restore waits for the first sync. Before it the local doc is empty, and the restore
  // primitives write a diff against what they see: the whole old content as new inserts,
  // which the server's state would then be merged with, duplicating it. After the first
  // sync a later disconnect is fine: the diff is against real content and merges on
  // reconnect.
  //
  // Only while a version is chosen and its preview is what is on screen. The pill is
  // fixed to the viewport under the nav (see version-bar.module.css), so it can be
  // rendered here beside the page rather than inside the shell's nav.
  const pill = selection && shown?.details && (
    <VersionBar
      author={shown.details.author}
      time={shown.details.time}
      canRestore={!readOnly && doc !== null && synced}
      onRestore={() => restore(shown.versionId, shown.details!.time)}
      onBackToNow={backToNow}
    />
  )

  return (
    <>
      {pill}
      <VersionPreview
        documentId={documentId}
        versionId={selection?.versionId ?? null}
        attempt={selection?.attempt ?? 0}
        label={selection?.label}
        details={selection?.details}
        onShown={setShown}
        type={type}
        heading={previewHeading}
        sheetClassName={styles.page}
        fallback={live}
      />
    </>
  )
}
