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
 * A rename is written only when the text was changed during this edit. Focusing the field
 * and leaving it alone writes nothing, so it cannot put back an older name over a peer's
 * rename that arrived meanwhile; the field then shows the current shared title.
 *
 * Deleting an empty column is immediate. A column with cards asks first, in place,
 * saying how many cards will go with it. Focus is kept on the keyboard path: Cancel and
 * Escape return it to the delete button, and a deleted column hands it to the next
 * column's delete button, else the previous one's, else the Add a list button.
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
  const dirty = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)

  useEffect(() => {
    if (!editing) setValue(title)
  }, [title, editing])

  // Cancelling the prompt unmounts the row that held focus; put it back on the delete button.
  useEffect(() => {
    if (!confirming && restoreFocus.current) {
      restoreFocus.current = false
      deleteButton.current?.focus()
    }
  }, [confirming])

  function cancelConfirm() {
    restoreFocus.current = true
    setConfirming(false)
  }

  function remove() {
    // The column is about to unmount with whatever has focus. Its siblings stay mounted,
    // so focus one of them first: next column's delete, else previous, else Add a list.
    const section = root.current?.closest('section')
    const sibling = (el: Element | null | undefined) =>
      el?.matches('section') ? el.querySelector<HTMLElement>('[data-testid^="col-delete-"]') : null
    const target =
      sibling(section?.nextElementSibling) ??
      sibling(section?.previousElementSibling) ??
      section?.parentElement?.querySelector<HTMLElement>('[data-testid="add-column"]')
    target?.focus()
    removeColumn(doc, columnId)
  }

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
    const changed = dirty.current
    dirty.current = false
    if (cancelled.current) {
      cancelled.current = false
      setValue(title)
      return
    }
    const next = value.trim()
    if (!changed) {
      setValue(title)
      return
    }
    if (next === '' || next === title) {
      setValue(title)
      return
    }
    renameColumn(doc, columnId, next)
  }

  if (confirming) {
    return (
      <div
        ref={root}
        className={styles.columnConfirm}
        role="group"
        aria-label="Delete column"
        data-testid={`col-confirm-${columnId}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancelConfirm()
        }}
      >
        <span className={styles.columnConfirmText}>
          Delete “{title}” and its {count} {count === 1 ? 'card' : 'cards'}?
        </span>
        <button
          type="button"
          className={styles.columnConfirmDelete}
          data-testid={`col-confirm-delete-${columnId}`}
          onClick={remove}
        >
          Delete
        </button>
        <button
          type="button"
          className={styles.columnConfirmCancel}
          data-testid={`col-confirm-cancel-${columnId}`}
          // Focus would otherwise be lost with the row that held it.
          autoFocus
          onClick={cancelConfirm}
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div ref={root} className={styles.columnHead}>
      <input
        className={`${styles.columnTitle} ${styles.columnTitleInput}`}
        aria-label="Column name"
        value={value}
        maxLength={200}
        data-testid={`col-title-${columnId}`}
        onFocus={() => {
          dirty.current = false
          setEditing(true)
        }}
        onChange={(event) => {
          dirty.current = true
          setValue(event.target.value)
        }}
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
        ref={deleteButton}
        type="button"
        className={styles.columnDelete}
        aria-label={`Delete column ${title}`}
        title="Delete column"
        data-testid={`col-delete-${columnId}`}
        onClick={() => (count === 0 ? remove() : setConfirming(true))}
      >
        ×
      </button>
    </div>
  )
}
