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

function cut(title: string): string {
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1).trimEnd()}…` : title
}

function quoted(title: string): string {
  return `'${cut(title)}'`
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

// --- Boards -----------------------------------------------------------------------

/**
 * The list's title is cut like a card's but left unquoted: the design's own sentence is
 * "Moved 'Enforce roles' to Done". A list with an empty title has nothing to say, and
 * "Moved 'X' to " would read as a bug, so that falls back to the count.
 */
function destination(prefix: string, columnTitle: string | undefined): string | null {
  return columnTitle ? `${prefix} ${cut(columnTitle)}` : null
}

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
  // null is a difference that cannot be put into words (a list with no title to name).
  const differences: Array<string | null> = []

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
      differences.push(destination(`Moved ${quoted(now.title)} to`, after.columns.get(now.columnId)))
    } else if (now.order !== card.order) {
      differences.push(destination(`Reordered ${quoted(now.title)} in`, after.columns.get(now.columnId)))
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

/**
 * The document as a flat run of tokens: one per character (carrying its marks), plus
 * open and close tokens for every node (carrying its type and attributes). Two versions
 * can then be compared token by token, and a text change is distinguishable from a
 * structure or formatting change because only the former is made of character tokens.
 */
function tokens(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out
  const { type, text, content, attrs, marks } = node as {
    type?: string
    text?: string
    content?: unknown[]
    attrs?: unknown
    marks?: unknown
  }
  if (type === 'text') {
    const marked = JSON.stringify(marks ?? [])
    for (const char of text ?? '') out.push(`c${marked}|${char}`)
    return out
  }
  out.push(`<${type}${JSON.stringify(attrs ?? {})}`)
  for (const child of content ?? []) tokens(child, out)
  out.push('>')
  return out
}

const isCharacter = (token: string) => token.startsWith('c')

function describeDocument(beforeDoc: Y.Doc, afterDoc: Y.Doc): string | null {
  // The raw Y XML, not a schema-parsed document: reading it back needs no schema, and
  // reading it raw means a node the schema would drop still counts as a change.
  const was = tokens(yXmlFragmentToProsemirrorJSON(beforeDoc.getXmlFragment(EDITOR_FRAGMENT)))
  const now = tokens(yXmlFragmentToProsemirrorJSON(afterDoc.getXmlFragment(EDITOR_FRAGMENT)))

  // Trim what both ends share. What is left is one contiguous span in each version. It
  // is a plain "added" or "removed" only if one span is empty AND the other is nothing
  // but characters: typed text beside a bolded word, a new heading or a deleted
  // paragraph is not that, and saying "Added 3 characters" of it would be half the story.
  // A replacement, or two edits far apart (indistinguishable from one big replacement),
  // is "edited", never a net character count that would misreport.
  let start = 0
  const shortest = Math.min(was.length, now.length)
  while (start < shortest && was[start] === now[start]) start++
  let end = 0
  while (end < shortest - start && was[was.length - 1 - end] === now[now.length - 1 - end]) end++

  const removed = was.slice(start, was.length - end)
  const added = now.slice(start, now.length - end)
  if (removed.length === 0 && added.length === 0) return null
  if (removed.length === 0 && added.every(isCharacter)) return `Added ${plural(added.length, 'character')}`
  if (added.length === 0 && removed.every(isCharacter)) return `Removed ${plural(removed.length, 'character')}`
  return 'Edited the text'
}
