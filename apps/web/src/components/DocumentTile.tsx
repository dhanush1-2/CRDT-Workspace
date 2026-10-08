'use client'

import Link from 'next/link'
import { useState } from 'react'
import { InlineTitle } from '@/components/InlineTitle'
import ui from '@/components/ui/ui.module.css'

/**
 * One document on the workspace overview. The tile is a link; editors also get a small
 * rename button, which swaps the title for a focused field until it saves or reverts.
 * While renaming, the tile is not a link, so a click in the field never navigates.
 */
export function DocumentTile({
  href,
  documentId,
  title,
  kind,
  updated,
  canEdit,
  classes,
}: {
  href: string
  documentId: string
  title: string
  kind: 'Board' | 'Page'
  updated: string
  canEdit: boolean
  // CSS-module lookups are string | undefined under noUncheckedIndexedAccess.
  classes: Record<'tile' | 'text' | 'title' | 'updated' | 'rename' | 'field' | 'wrap', string | undefined>
}) {
  const [renaming, setRenaming] = useState(false)

  const body = (
    <>
      <span className={`${ui.chip} ${ui.chipAccent}`} data-testid="document-kind">
        {kind}
      </span>
      <span className={classes.text}>
        {renaming ? (
          <InlineTitle
            documentId={documentId}
            title={title}
            label={`Rename ${title}`}
            className={classes.field}
            testId={`tile-title-${documentId}`}
            autoFocus
            onDone={() => setRenaming(false)}
          />
        ) : (
          <span className={classes.title}>{title}</span>
        )}
        <span className={classes.updated}>{updated}</span>
      </span>
    </>
  )

  return (
    <div className={classes.wrap}>
      {renaming ? (
        <div className={`${ui.glass} ${ui.tile} ${classes.tile}`} data-testid={`document-${documentId}`}>
          {body}
        </div>
      ) : (
        <Link href={href} className={`${ui.glass} ${ui.tile} ${classes.tile}`} data-testid={`document-${documentId}`}>
          {body}
        </Link>
      )}
      {canEdit && !renaming && (
        <button
          type="button"
          className={classes.rename}
          aria-label={`Rename ${title}`}
          title="Rename"
          data-testid={`rename-${documentId}`}
          onClick={() => setRenaming(true)}
        >
          ✎
        </button>
      )}
    </div>
  )
}
