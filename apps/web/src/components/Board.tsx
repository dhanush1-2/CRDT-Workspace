'use client'

import { useState } from 'react'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import { addCard, addColumn, moveCard, removeCard } from '@crdt/shared/board'
import { useBoard } from '@/hooks/use-board'
import { setCardFocus, usePresence } from '@/hooks/use-presence'
import { CardPresence } from '@/components/Presence'
import { ColumnHead } from './ColumnHead'
import styles from './board.module.css'

interface BoardProps {
  doc: Y.Doc
  provider: WebsocketProvider | null
  readOnly?: boolean
}

interface DragPayload {
  cardId: string
}

export function Board({ doc, provider, readOnly = false }: BoardProps) {
  const { columns, cardsByColumn } = useBoard(doc)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const presence = usePresence(provider)

  function handleDrop(event: React.DragEvent, columnId: string, beforeCardId?: string) {
    event.preventDefault()
    setDragOver(null)
    // A moved card remounts under its new column, so the source node that would
    // fire dragend is detached and React never hears it. Clear here as well.
    setDragging(null)
    if (readOnly) return

    const raw = event.dataTransfer.getData('application/x-card')
    if (!raw) return

    let payload: DragPayload
    try {
      payload = JSON.parse(raw) as DragPayload
    } catch {
      return
    }

    moveCard(doc, payload.cardId, { columnId, beforeCardId })
  }

  return (
    <div className={styles.scroller}>
      {columns.map((column) => (
        <section
          key={column.id}
          data-testid={`column-${column.id}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(column.id)
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(event) => handleDrop(event, column.id)}
          className={`${styles.column} ${dragOver === column.id ? styles.columnOver : ''}`}
        >
          <ColumnHead
            doc={doc}
            columnId={column.id}
            title={column.title}
            count={(cardsByColumn.get(column.id) ?? []).length}
            readOnly={readOnly}
          />

          <div className={styles.cards}>
            {(cardsByColumn.get(column.id) ?? []).map((card) => {
              const peerHere = presence.some((user) => user.cardId === card.id)
              return (
                <article
                  key={card.id}
                  data-testid={`card-${card.id}`}
                  data-column={column.id}
                  data-readonly={readOnly}
                  className={`${styles.card} ${peerHere ? styles.cardPeer : ''} ${dragging === card.id ? styles.cardDragging : ''}`}
                  draggable={!readOnly}
                  onDragStart={(event) => {
                    setDragging(card.id)
                    event.dataTransfer.setData(
                      'application/x-card',
                      JSON.stringify({ cardId: card.id } satisfies DragPayload),
                    )
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => setDragging(null)}
                  onDrop={(event) => {
                    event.stopPropagation()
                    handleDrop(event, column.id, card.id)
                  }}
                  onFocus={() => setCardFocus(provider, card.id)}
                  onBlur={() => setCardFocus(provider, null)}
                  onMouseEnter={() => setCardFocus(provider, card.id)}
                  onMouseLeave={() => setCardFocus(provider, null)}
                  tabIndex={0}
                >
                  <span className={styles.cardTitle}>{card.title}</span>
                  {!readOnly && (
                    <button
                      aria-label={`Delete ${card.title}`}
                      onClick={() => removeCard(doc, card.id)}
                      className={styles.delete}
                    >
                      ×
                    </button>
                  )}
                  <CardPresence users={presence} cardId={card.id} />
                </article>
              )
            })}
          </div>

          {!readOnly && (
            <button
              data-testid={`add-card-${column.id}`}
              onClick={() =>
                addCard(doc, {
                  id: crypto.randomUUID(),
                  title: 'New card',
                  columnId: column.id,
                })
              }
              className={styles.addCard}
            >
              + Add a card
            </button>
          )}
        </section>
      ))}

      {!readOnly && (
        <button
          data-testid="add-column"
          onClick={() => addColumn(doc, { id: crypto.randomUUID(), title: 'New column' })}
          className={styles.addList}
        >
          + Add a list
        </button>
      )}
    </div>
  )
}
