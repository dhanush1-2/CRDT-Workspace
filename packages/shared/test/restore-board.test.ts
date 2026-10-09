import * as Y from 'yjs'
import { describe, it, expect } from 'vitest'
import {
  addCard, addColumn, listCards, listColumns, moveCard, removeColumn, renameColumn, restoreBoard,
} from '../src/board.js'

describe('restoreBoard', () => {
  it('brings back a deleted card and removes one added since', () => {
    const past = new Y.Doc()
    addColumn(past, { id: 'col-1', title: 'Todo' })
    addCard(past, { id: 'card-1', title: 'Write it', columnId: 'col-1' })

    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))
    live.getMap('cards').delete('card-1')
    addCard(live, { id: 'card-2', title: 'Added later', columnId: 'col-1' })

    restoreBoard(live, past)

    const cards = listCards(live, 'col-1')
    expect(cards.map((card) => card.id)).toEqual(['card-1'])
    expect(cards[0]!.title).toBe('Write it')
  })

  it('restores a moved card to its old column and order', () => {
    const past = new Y.Doc()
    addColumn(past, { id: 'col-1', title: 'Todo' })
    addColumn(past, { id: 'col-2', title: 'Done' })
    addCard(past, { id: 'card-1', title: 'Thing', columnId: 'col-1' })
    const wasOrder = listCards(past, 'col-1')[0]!.order

    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))
    moveCard(live, 'card-1', { columnId: 'col-2' })

    restoreBoard(live, past)

    expect(listCards(live, 'col-2')).toEqual([])
    expect(listCards(live, 'col-1')[0]!.order).toBe(wasOrder)
  })

  it('is one transaction, so it is one update on the wire', () => {
    const past = new Y.Doc()
    addColumn(past, { id: 'col-1', title: 'Todo' })
    addCard(past, { id: 'card-1', title: 'A', columnId: 'col-1' })
    addCard(past, { id: 'card-2', title: 'B', columnId: 'col-1' })

    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))
    live.getMap('cards').delete('card-1')
    live.getMap('cards').delete('card-2')

    let updates = 0
    live.on('update', () => (updates += 1))
    restoreBoard(live, past)
    // Not cosmetic: each update is a persisted row and a broadcast frame, and a
    // restore that arrives in pieces is visible to everyone else as the board
    // reassembling itself.
    expect(updates).toBe(1)
  })

  it('writes fields rather than replacing an entry, so a concurrent edit survives', () => {
    // Two replicas. One restores; the other, at the same time, renames the card.
    const past = new Y.Doc()
    addColumn(past, { id: 'col-1', title: 'Todo' })
    addCard(past, { id: 'card-1', title: 'Original', columnId: 'col-1' })

    const restorer = new Y.Doc()
    const editor = new Y.Doc()
    const base = Y.encodeStateAsUpdate(past)
    Y.applyUpdate(restorer, base)
    Y.applyUpdate(editor, base)

    // The restorer's live state has drifted: the card moved.
    moveCard(restorer, 'card-1', { columnId: 'col-1', afterCardId: undefined })
    restorer.getMap<Y.Map<string>>('cards').get('card-1')!.set('order', 'zz')

    // Meanwhile the other replica renames it.
    editor.getMap<Y.Map<string>>('cards').get('card-1')!.set('title', 'Renamed')

    restoreBoard(restorer, past)
    Y.applyUpdate(editor, Y.encodeStateAsUpdate(restorer))
    Y.applyUpdate(restorer, Y.encodeStateAsUpdate(editor))

    // The rename survives: restore touched `order`, not `title`. Deleting and
    // re-creating the entry — which is the obvious implementation — loses it.
    expect(listCards(restorer, 'col-1')[0]!.title).toBe('Renamed')
    expect(listCards(editor, 'col-1')[0]!.title).toBe('Renamed')
  })

  it('brings back a deleted column with its cards, undoes a rename, and removes a new column', () => {
    const past = new Y.Doc()
    addColumn(past, { id: 'A', title: 'Alpha' })
    addColumn(past, { id: 'B', title: 'Beta' })
    addCard(past, { id: 'a1', title: 'A one', columnId: 'A' })
    addCard(past, { id: 'a2', title: 'A two', columnId: 'A' })
    addCard(past, { id: 'b1', title: 'B one', columnId: 'B' })

    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))
    expect(removeColumn(live, 'A')).toBe(2)
    renameColumn(live, 'B', 'Renamed')
    addColumn(live, { id: 'C', title: 'Gamma' })
    expect(listColumns(live).map((c) => c.id)).toEqual(['B', 'C'])

    restoreBoard(live, past)

    expect(listColumns(live)).toEqual(listColumns(past))
    expect(listColumns(live).map((c) => [c.id, c.title])).toEqual([['A', 'Alpha'], ['B', 'Beta']])
    for (const id of ['A', 'B']) {
      expect(listCards(live, id)).toEqual(listCards(past, id))
    }
    expect(listCards(live, 'A').map((c) => c.id)).toEqual(['a1', 'a2'])
    expect(listCards(live, 'C')).toEqual([])
  })
})
