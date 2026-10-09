import * as Y from 'yjs'
import { describe, it, expect } from 'vitest'
import { addCard, addColumn } from '@crdt/shared/board'
import { restoreFromState, restoreMessage } from '../src/lib/restore-version.js'

describe('restoreMessage', () => {
  it('names the version alone when nobody else is here', () => {
    expect(restoreMessage('Sep 27, 14:20', false)).toBe('Restored version from Sep 27, 14:20')
  })

  it('says it merged when others are here, rather than claiming an exact revert', () => {
    expect(restoreMessage('Sep 27, 14:20', true)).toBe(
      'Restored version from Sep 27, 14:20 · merged with changes made since',
    )
  })
})

describe('restoreFromState', () => {
  it('writes the difference into the live board, which a plain applyUpdate cannot', () => {
    const live = new Y.Doc()
    addColumn(live, { id: 'col', title: 'Todo' })
    const old = Y.encodeStateAsUpdate(live)
    addCard(live, { id: 'newer', title: 'newer', columnId: 'col' })

    // The control: applying the old state over the newer one leaves the newer card.
    const merged = new Y.Doc()
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(live))
    Y.applyUpdate(merged, old)
    expect([...merged.getMap('cards').keys()]).toHaveLength(1)

    restoreFromState(live, 'board', old)
    expect([...live.getMap('cards').keys()]).toHaveLength(0)
  })
})
