'use client'

import { useEffect } from 'react'
import { useCollaborativeDoc } from '@/hooks/use-doc'
import { useAnnouncePresence, usePresence } from '@/hooks/use-presence'
import { Board } from '@/components/Board'
import { DocumentEditor } from '@/components/DocumentEditor'
import { InlineTitle } from '@/components/InlineTitle'
import { VersionPreview } from '@/components/VersionPreview'
import { clearDocState, publishDocState } from '@/lib/doc-state'
import { clearVersion, useVersionSelection } from '@/lib/version-selection'
import styles from './document.module.css'

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
  const { doc, provider, status } = useCollaborativeDoc(documentId)
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

  return (
    <VersionPreview
      documentId={documentId}
      versionId={selection?.versionId ?? null}
      attempt={selection?.attempt ?? 0}
      label={selection?.label}
      type={type}
      heading={previewHeading}
      sheetClassName={styles.page}
      fallback={live}
    />
  )
}
