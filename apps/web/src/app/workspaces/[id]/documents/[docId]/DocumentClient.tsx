'use client'

import { useEffect } from 'react'
import { useCollaborativeDoc } from '@/hooks/use-doc'
import { useAnnouncePresence, usePresence } from '@/hooks/use-presence'
import { Board } from '@/components/Board'
import { DocumentEditor } from '@/components/DocumentEditor'
import { clearDocState, publishDocState } from '@/lib/doc-state'
import styles from './document.module.css'
import ui from '@/components/ui/ui.module.css'

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

  /*
    The page's only heading, and the only one there has ever been -- it used to be
    screen-reader-only in page.tsx. Visible on a document, where the design shows a
    title; still clipped on a board, where the design has no title slot but the
    page still needs an accessible name.
  */
  const heading = (
    <h1
      className={type === 'doc' ? styles.heading : ui.labelHidden}
      data-testid="document-heading"
    >
      {title}
    </h1>
  )

  // The toolbar floats above the sheet as its own panel, so the editor can no longer
  // sit inside a wrapper rendered here: DocumentEditor renders both, and takes the
  // sheet's class and the heading so the sheet is still styled and titled from here.
  if (type === 'doc') {
    return (
      <DocumentEditor
        doc={doc}
        provider={provider}
        user={user}
        readOnly={readOnly}
        sheetClassName={styles.page}
        heading={heading}
      />
    )
  }

  // The board is a horizontal scroller with its own gutters and would be crushed into
  // a 780px column, so it gets no sheet and no toolbar.
  return (
    <div>
      {heading}
      {doc && <Board doc={doc} provider={provider} readOnly={readOnly} />}
    </div>
  )
}
