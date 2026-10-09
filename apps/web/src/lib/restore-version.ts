import * as Y from 'yjs'
import { restoreBoard } from '@crdt/shared/board'
import { restoreEditor } from './restore-editor'

/**
 * Puts a past version's content into `live` as ordinary edits, on top of whatever the
 * document holds now.
 *
 * Not `Y.applyUpdate(live, bytes)`: applying an old state over a newer one is a merge,
 * and a merge of a state the document already contains changes nothing. The restore
 * primitives compare the two and write only the difference, so the result is a new edit
 * from whoever restored, which is also what lets other people's in-flight typing survive.
 *
 * The version is read into a throwaway Y.Doc with no provider, which is destroyed here.
 */
export function restoreFromState(live: Y.Doc, type: 'doc' | 'board', state: Uint8Array): void {
  const past = new Y.Doc()
  try {
    Y.applyUpdate(past, state)
    if (type === 'board') restoreBoard(live, past)
    else restoreEditor(live, past)
  } finally {
    past.destroy()
  }
}

/**
 * What a restore says it did. A restore writes a diff against the document as it is now
 * and does not rewind it, so when other people are here their edits may have landed
 * alongside it and the result is not necessarily the version as it was. Claiming an
 * exact revert then would be false.
 */
export function restoreMessage(time: string, othersPresent: boolean): string {
  const base = `Restored version from ${time}`
  return othersPresent ? `${base} · merged with changes made since` : base
}
