import * as Y from 'yjs'
import { describe, it, expect } from 'vitest'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import {
  addCard,
  addColumn,
  moveCard,
  removeCard,
  removeColumn,
  renameCard,
  renameColumn,
} from '@crdt/shared/board'
import { getEditorSchema } from '../src/components/editor-schema.js'
import { EDITOR_FRAGMENT } from '../src/components/editor-fragment.js'
import { describeChange } from '../src/lib/version-description.js'

function board(): Y.Doc {
  const doc = new Y.Doc()
  addColumn(doc, { id: 'todo', title: 'Todo' })
  addColumn(doc, { id: 'done', title: 'Done' })
  addCard(doc, { id: 'c1', title: 'Enforce roles', columnId: 'todo' })
  return doc
}

function forked(from: Y.Doc): Y.Doc {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(from))
  return doc
}

describe('describeChange on a board', () => {
  it('names a move and where it went', () => {
    const before = board()
    const after = forked(before)
    moveCard(after, 'c1', { columnId: 'done' })
    // The design's own example sentence.
    expect(describeChange(before, after, 'board', 1)).toBe("Moved 'Enforce roles' to Done")
  })

  it('names a reorder inside one list as a reorder, not a move', () => {
    const before = board()
    addCard(before, { id: 'c2', title: 'Second', columnId: 'todo' })
    const after = forked(before)
    moveCard(after, 'c2', { columnId: 'todo', beforeCardId: 'c1' })
    expect(describeChange(before, after, 'board', 1)).toBe("Reordered 'Second' in Todo")
  })

  it('names an added card and a removed one', () => {
    const before = board()
    const added = forked(before)
    addCard(added, { id: 'c2', title: 'Ship it', columnId: 'todo' })
    expect(describeChange(before, added, 'board', 1)).toBe("Added 'Ship it'")

    const removed = forked(before)
    removeCard(removed, 'c1')
    expect(describeChange(before, removed, 'board', 1)).toBe("Deleted 'Enforce roles'")
  })

  it('names a rename with both titles', () => {
    const before = board()
    const after = forked(before)
    renameCard(after, 'c1', 'Enforce roles properly')
    expect(describeChange(before, after, 'board', 1)).toBe(
      "Renamed 'Enforce roles' to 'Enforce roles properly'",
    )
  })

  it('names an added column', () => {
    const before = board()
    const after = forked(before)
    addColumn(after, { id: 'blocked', title: 'Blocked' })
    expect(describeChange(before, after, 'board', 1)).toBe("Added the list 'Blocked'")
  })

  it('names a renamed column with both titles', () => {
    const before = board()
    const after = forked(before)
    renameColumn(after, 'todo', 'Backlog')
    expect(describeChange(before, after, 'board', 1)).toBe("Renamed the list 'Todo' to 'Backlog'")
  })

  it('names a removed empty column', () => {
    const before = board()
    const after = forked(before)
    removeColumn(after, 'done')
    expect(describeChange(before, after, 'board', 1)).toBe("Deleted the list 'Done'")
  })

  it('names a removed column once, counting the cards that went with it', () => {
    const before = board()
    addCard(before, { id: 'c2', title: 'Second', columnId: 'todo' })
    addCard(before, { id: 'c3', title: 'Third', columnId: 'done' })

    const one = forked(before)
    removeColumn(one, 'done')
    expect(describeChange(before, one, 'board', 1)).toBe("Deleted the list 'Done' and its 1 card")

    const two = forked(before)
    removeColumn(two, 'todo')
    expect(describeChange(before, two, 'board', 1)).toBe("Deleted the list 'Todo' and its 2 cards")
  })

  it('shortens a long title rather than filling the row', () => {
    const before = board()
    const after = forked(before)
    addCard(after, { id: 'c2', title: 'x'.repeat(100), columnId: 'todo' })
    const sentence = describeChange(before, after, 'board', 1)
    expect(sentence.length).toBeLessThan(60)
    expect(sentence.startsWith("Added 'xxx")).toBe(true)
    expect(sentence).toContain('…')
  })

  it('falls back to a count when several things changed', () => {
    const before = board()
    const after = forked(before)
    addCard(after, { id: 'c2', title: 'A', columnId: 'todo' })
    moveCard(after, 'c1', { columnId: 'done' })
    renameCard(after, 'c2', 'B')
    // There is no one sentence for this, and inventing one would misreport it.
    expect(describeChange(before, after, 'board', 7)).toBe('7 changes')
  })

  it('falls back to a count when one card was both moved and renamed', () => {
    const before = board()
    const after = forked(before)
    moveCard(after, 'c1', { columnId: 'done' })
    renameCard(after, 'c1', 'Renamed too')
    expect(describeChange(before, after, 'board', 2)).toBe('2 changes')
  })

  it('falls back to a count when nothing visible differs', () => {
    const before = board()
    expect(describeChange(before, forked(before), 'board', 1)).toBe('1 change')
  })

  it('describes the first version with no predecessor', () => {
    expect(describeChange(null, board(), 'board', 3)).toBe('Created the board')
  })
})

describe('describeChange on a document', () => {
  /** A one-paragraph document in the editor's own fragment, the way production stores it. */
  function withText(text: string): Y.Doc {
    const doc = new Y.Doc()
    prosemirrorJSONToYXmlFragment(
      getEditorSchema(),
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      doc.getXmlFragment(EDITOR_FRAGMENT),
    )
    return doc
  }

  /** The text node inside the first paragraph, which is what typing edits. */
  function textNode(doc: Y.Doc): Y.XmlText {
    const paragraph = doc.getXmlFragment(EDITOR_FRAGMENT).get(0) as Y.XmlElement
    return paragraph.get(0) as Y.XmlText
  }

  it('counts characters added', () => {
    const before = withText('hello')
    const after = forked(before)
    textNode(after).insert(5, ' world')
    expect(describeChange(before, after, 'doc', 1)).toBe('Added 6 characters')
  })

  it('says character, not characters, for one', () => {
    const before = withText('hello')
    const after = forked(before)
    textNode(after).insert(5, '!')
    expect(describeChange(before, after, 'doc', 1)).toBe('Added 1 character')
  })

  it('counts characters removed', () => {
    const before = withText('hello world')
    const after = forked(before)
    textNode(after).delete(5, 6)
    expect(describeChange(before, after, 'doc', 1)).toBe('Removed 6 characters')
  })

  it('reports a replacement as an edit, not a net count', () => {
    const before = withText('hello world')
    const after = forked(before)
    textNode(after).delete(0, 5)
    textNode(after).insert(0, 'goodbye')
    expect(describeChange(before, after, 'doc', 2)).toBe('Edited the text')
  })

  it('does not call two separate insertions one insertion', () => {
    const before = withText('hello')
    const after = forked(before)
    textNode(after).insert(0, 'a')
    textNode(after).insert(6, 'b')
    expect(describeChange(before, after, 'doc', 2)).toBe('Edited the text')
  })

  it('reports a formatting-only change as an edit', () => {
    const before = withText('hello')
    const after = forked(before)
    textNode(after).format(0, 5, { bold: {} })
    expect(describeChange(before, after, 'doc', 1)).toBe('Edited the text')
  })

  it('falls back to a count when nothing differs', () => {
    const before = withText('hello')
    expect(describeChange(before, forked(before), 'doc', 3)).toBe('3 changes')
  })

  it('describes the first version with no predecessor', () => {
    expect(describeChange(null, withText('x'), 'doc', 1)).toBe('Created the document')
  })
})
