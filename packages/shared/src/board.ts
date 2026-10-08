import * as Y from 'yjs'
import { between } from './fractional-index.js'

export interface CardView {
  id: string
  title: string
  columnId: string
  order: string
}

export interface ColumnView {
  id: string
  title: string
  order: string
}

/**
 * Both maps are top-level Yjs types. Top-level types are created deterministically
 * by name on every replica, so there is no "who creates the container" race — which
 * there would be with nested maps initialized lazily by whichever client arrives first.
 */
const cardsOf = (doc: Y.Doc) => doc.getMap<Y.Map<string>>('cards')
const columnsOf = (doc: Y.Doc) => doc.getMap<Y.Map<string>>('columns')

function readMap(entry: Y.Map<string> | undefined): Record<string, string> | null {
  if (!entry) return null
  return Object.fromEntries(entry.entries())
}

/** Sort by order key, then by id, so every replica agrees even on identical keys. */
function compare(a: { order: string; id: string }, b: { order: string; id: string }): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function addColumn(doc: Y.Doc, input: { id: string; title: string }): void {
  doc.transact(() => {
    const columns = columnsOf(doc)
    if (columns.has(input.id)) return

    const existing = listColumns(doc)
    const order = between(existing.at(-1)?.order ?? null, null)

    const entry = new Y.Map<string>()
    entry.set('title', input.title)
    entry.set('order', order)
    columns.set(input.id, entry)
  })
}

/** Writes the title field on the column's existing entry, like renameCard. */
export function renameColumn(doc: Y.Doc, columnId: string, title: string): void {
  doc.transact(() => {
    columnsOf(doc).get(columnId)?.set('title', title)
  })
}

/**
 * Deletes a column and every card in it, in one transaction so a peer never sees the
 * column gone with its cards still listed, or the reverse. Returns the number of cards
 * deleted, which is what the confirmation shows.
 *
 * A card a peer moves into this column concurrently, before this deletion reaches them,
 * keeps a columnId that no longer exists and is not listed anywhere. That is the same
 * outcome as deleting it, which is what the person deleting the column asked for.
 */
export function removeColumn(doc: Y.Doc, columnId: string): number {
  let removed = 0
  doc.transact(() => {
    const cards = cardsOf(doc)
    for (const [cardId, entry] of [...cards.entries()]) {
      if (entry.get('columnId') === columnId) {
        cards.delete(cardId)
        removed += 1
      }
    }
    columnsOf(doc).delete(columnId)
  })
  return removed
}

export function listColumns(doc: Y.Doc): ColumnView[] {
  const out: ColumnView[] = []
  for (const [id, entry] of columnsOf(doc).entries()) {
    const fields = readMap(entry)
    if (!fields?.order) continue
    out.push({ id, title: fields.title ?? '', order: fields.order })
  }
  return out.sort(compare)
}

export function listCards(doc: Y.Doc, columnId: string): CardView[] {
  const out: CardView[] = []
  for (const [id, entry] of cardsOf(doc).entries()) {
    const fields = readMap(entry)
    if (!fields?.order || fields.columnId !== columnId) continue
    out.push({ id, title: fields.title ?? '', columnId, order: fields.order })
  }
  return out.sort(compare)
}

/** The order key for a slot in `columnId`, expressed relative to neighbouring cards. */
function orderFor(
  doc: Y.Doc,
  columnId: string,
  position: { afterCardId?: string; beforeCardId?: string },
  excludeCardId?: string,
): string {
  const siblings = listCards(doc, columnId).filter((c) => c.id !== excludeCardId)

  if (position.afterCardId) {
    const at = siblings.findIndex((c) => c.id === position.afterCardId)
    if (at !== -1) return between(siblings[at]!.order, siblings[at + 1]?.order ?? null)
  }

  if (position.beforeCardId) {
    const at = siblings.findIndex((c) => c.id === position.beforeCardId)
    if (at !== -1) return between(siblings[at - 1]?.order ?? null, siblings[at]!.order)
  }

  // Default: append to the end of the column.
  return between(siblings.at(-1)?.order ?? null, null)
}

export function addCard(
  doc: Y.Doc,
  input: { id: string; title: string; columnId: string; afterCardId?: string; beforeCardId?: string },
): void {
  doc.transact(() => {
    const cards = cardsOf(doc)
    if (cards.has(input.id)) return

    const entry = new Y.Map<string>()
    entry.set('title', input.title)
    entry.set('columnId', input.columnId)
    entry.set('order', orderFor(doc, input.columnId, input))
    cards.set(input.id, entry)
  })
}

/**
 * A move writes two fields on the card's existing map entry. It never deletes and
 * re-creates the entry, which is what keeps a concurrent title edit and a concurrent
 * move from destroying each other — and what makes it impossible for a card to end
 * up in two columns.
 */
export function moveCard(
  doc: Y.Doc,
  cardId: string,
  target: { columnId: string; afterCardId?: string; beforeCardId?: string },
): void {
  doc.transact(() => {
    const entry = cardsOf(doc).get(cardId)
    if (!entry) return

    entry.set('columnId', target.columnId)
    entry.set('order', orderFor(doc, target.columnId, target, cardId))
  })
}

export function renameCard(doc: Y.Doc, cardId: string, title: string): void {
  doc.transact(() => {
    cardsOf(doc).get(cardId)?.set('title', title)
  })
}

export function removeCard(doc: Y.Doc, cardId: string): void {
  doc.transact(() => {
    cardsOf(doc).delete(cardId)
  })
}
