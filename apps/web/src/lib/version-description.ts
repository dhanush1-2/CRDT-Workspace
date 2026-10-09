import * as Y from 'yjs'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { listCards, listColumns } from '@crdt/shared/board'
import { EDITOR_FRAGMENT } from '@/components/editor-fragment'

/**
 * One sentence about what changed between two versions.
 *
 * Derived, not stored: an update is opaque Yjs binary and the row holding it has no
 * idea what it meant, so the only way to describe a version is to build both states
 * and compare them.
 *
 * Deliberately conservative. A single recognisable change gets a sentence; anything
 * else gets a count, because a wrong sentence about someone's document is worse than
 * an uninformative one. "N changes" is the floor, not a bug.
 */
export function describeChange(
  before: Y.Doc | null,
  after: Y.Doc,
  type: 'doc' | 'board',
  updateCount: number,
): string {
  if (!before) return type === 'board' ? 'Created the board' : 'Created the document'

  const sentence = type === 'board' ? describeBoard(before, after) : describeDocument(before, after)
  if (sentence) return sentence

  return `${updateCount} ${updateCount === 1 ? 'change' : 'changes'}`
}

/** Titles go into a narrow list row, so a long one is cut rather than left to wrap. */
const MAX_TITLE = 40

function quoted(title: string): string {
  const shown = title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1).trimEnd()}…` : title
  return `'${shown}'`
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

// --- Boards -----------------------------------------------------------------------

interface CardState {
  title: string
  columnId: string
  order: string
}

function readBoard(doc: Y.Doc): {
  columns: Map<string, string>
  cards: Map<string, CardState>
} {
  const columns = new Map<string, string>()
  const cards = new Map<string, CardState>()
  for (const column of listColumns(doc)) {
    columns.set(column.id, column.title)
    for (const card of listCards(doc, column.id)) {
      cards.set(card.id, { title: card.title, columnId: column.id, order: card.order })
    }
  }
  return { columns, cards }
}

/** Every difference is one sentence; a version is describable only if there is exactly one. */
function describeBoard(beforeDoc: Y.Doc, afterDoc: Y.Doc): string | null {
  const before = readBoard(beforeDoc)
  const after = readBoard(afterDoc)
  const differences: string[] = []

  const removedColumns = new Set<string>()
  for (const [id, title] of before.columns) {
    if (!after.columns.has(id)) removedColumns.add(id)
    else if (after.columns.get(id) !== title) {
      differences.push(`Renamed the list ${quoted(title)} to ${quoted(after.columns.get(id)!)}`)
    }
  }
  for (const [id, title] of after.columns) {
    if (!before.columns.has(id)) differences.push(`Added the list ${quoted(title)}`)
  }

  // Deleting a column deletes its cards in the same transaction. Those cards are part
  // of that one difference, not a pile of separate ones that would turn it into a count.
  const cardsLostWithColumn = new Map<string, number>()
  for (const [id, card] of before.cards) {
    const now = after.cards.get(id)
    if (!now) {
      if (removedColumns.has(card.columnId)) {
        cardsLostWithColumn.set(card.columnId, (cardsLostWithColumn.get(card.columnId) ?? 0) + 1)
      } else {
        differences.push(`Deleted ${quoted(card.title)}`)
      }
      continue
    }
    if (now.columnId !== card.columnId) {
      differences.push(`Moved ${quoted(now.title)} to ${after.columns.get(now.columnId) ?? ''}`)
    } else if (now.order !== card.order) {
      differences.push(`Reordered ${quoted(now.title)} in ${after.columns.get(now.columnId) ?? ''}`)
    }
    if (now.title !== card.title) {
      differences.push(`Renamed ${quoted(card.title)} to ${quoted(now.title)}`)
    }
  }
  for (const [id, card] of after.cards) {
    if (!before.cards.has(id)) differences.push(`Added ${quoted(card.title)}`)
  }

  for (const id of removedColumns) {
    const lost = cardsLostWithColumn.get(id) ?? 0
    const name = quoted(before.columns.get(id)!)
    differences.push(
      lost > 0 ? `Deleted the list ${name} and its ${plural(lost, 'card')}` : `Deleted the list ${name}`,
    )
  }

  return differences.length === 1 ? differences[0]! : null
}

// --- Documents --------------------------------------------------------------------

/** Every text node's characters, in order. Structure and marks are left out on purpose. */
function plainText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const { type, text, content } = node as { type?: string; text?: string; content?: unknown[] }
  if (type === 'text') return text ?? ''
  return (content ?? []).map(plainText).join('')
}

function describeDocument(beforeDoc: Y.Doc, afterDoc: Y.Doc): string | null {
  // The raw Y XML, not a schema-parsed document: reading it back needs no schema, and
  // reading it raw means a node the schema would drop still counts as a change.
  const beforeJson = yXmlFragmentToProsemirrorJSON(beforeDoc.getXmlFragment(EDITOR_FRAGMENT))
  const afterJson = yXmlFragmentToProsemirrorJSON(afterDoc.getXmlFragment(EDITOR_FRAGMENT))
  const was = plainText(beforeJson)
  const now = plainText(afterJson)

  if (was === now) {
    // Same characters, different document: formatting, or a paragraph split. Not nothing.
    return JSON.stringify(beforeJson) === JSON.stringify(afterJson) ? null : 'Edited the text'
  }

  // Trim what both ends share. What is left is one contiguous span in each version. If
  // one span is empty, the edit was a pure insertion or deletion and its size is exact.
  // Anything else (a replacement, or two edits far apart, which this cannot tell from
  // one big replacement) is "edited", never a net character count that would misreport.
  let start = 0
  const shortest = Math.min(was.length, now.length)
  while (start < shortest && was[start] === now[start]) start++
  let end = 0
  while (end < shortest - start && was[was.length - 1 - end] === now[now.length - 1 - end]) end++

  const removed = was.length - start - end
  const added = now.length - start - end
  if (removed === 0 && added > 0) return `Added ${plural(added, 'character')}`
  if (added === 0 && removed > 0) return `Removed ${plural(removed, 'character')}`
  return 'Edited the text'
}
