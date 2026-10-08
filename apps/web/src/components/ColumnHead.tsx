'use client'

import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { removeColumn, renameColumn } from '@crdt/shared/board'
import styles from './board.module.css'

/**
 * A column's header: its title (editable for editors), its card count, and delete.
 *
 * The title is an input that looks like text. Enter or leaving the field saves it,
 * Escape puts it back, and an empty name is never saved. It writes to the CRDT, so a
 * rename reaches everyone on the board at once. The field follows the shared title
 * while it is not being edited, so a peer's rename shows up here too.
 *
 * Deleting an empty column is immediate. A column with cards asks first, in place,
 * saying how many cards will go with it.
 */
export function ColumnHead({
  doc,
  columnId,
  title,
  count,
  readOnly,
}: {
  doc: Y.Doc
  columnId: string
  title: string
  count: number
  readOnly: boolean
}) {
  const [value, setValue] = useState(title)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const cancelled = useRef(false)

  useEffect(() => {
    if (!editing) setValue(title)
  }, [title, editing])

  if (readOnly) {
    return (
      <div className={styles.columnHead}>
        <h2 className={styles.columnTitle} data-testid={`col-title-${columnId}`}>
          {title}
        </h2>
        <span className={styles.count}>{count}</span>
      </div>
    )
  }

  function commit() {
    setEditing(false)
    if (cancelled.current) {
      cancelled.current = false
      setValue(title)
      return
    }
    const next = value.trim()
    if (next === '' || next === title) {
      setValue(title)
      return
    }
    renameColumn(doc, columnId, next)
  }

  if (confirming) {
    return (
      <div className={styles.columnConfirm} role="group" aria-label="Delete column" data-testid={`col-confirm-${columnId}`}>
        <span className={styles.columnConfirmText}>
          Delete “{title}” and its {count} {count === 1 ? 'card' : 'cards'}?
        </span>
        <button
          type="button"
          className={styles.columnConfirmDelete}
          data-testid={`col-confirm-delete-${columnId}`}
          onClick={() => removeColumn(doc, columnId)}
        >
          Delete
        </button>
        <button
          type="button"
          className={styles.columnConfirmCancel}
          data-testid={`col-confirm-cancel-${columnId}`}
          // Focus would otherwise be lost with the row that held it.
          autoFocus
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className={styles.columnHead}>
      <input
        className={`${styles.columnTitle} ${styles.columnTitleInput}`}
        aria-label="Column name"
        value={value}
        maxLength={200}
        data-testid={`col-title-${columnId}`}
        onFocus={() => setEditing(true)}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            cancelled.current = true
            event.currentTarget.blur()
          }
        }}
      />
      <span className={styles.count}>{count}</span>
      <button
        type="button"
        className={styles.columnDelete}
        aria-label={`Delete column ${title}`}
        title="Delete column"
        data-testid={`col-delete-${columnId}`}
        onClick={() => (count === 0 ? removeColumn(doc, columnId) : setConfirming(true))}
      >
        ×
      </button>
    </div>
  )
}
