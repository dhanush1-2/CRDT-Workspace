import { useSyncExternalStore } from 'react'

/**
 * Which version of which document the user has chosen in the History panel, if any.
 *
 * A module store, like doc-state.ts, because the three places that care are far apart in
 * the tree: the panel writes it, the document page reads it to swap its live view for the
 * preview, and the nav's "viewing an old version" pill reads it too. The document id is
 * part of the value so a pick never outlives a navigation to another document.
 */
export type VersionDetails = {
  /** Who wrote the version, or "Unknown". */
  author: string
  /** When it ended, as the panel writes it: "Sep 30, 16:40". */
  time: string
}

export type VersionSelection = {
  documentId: string
  versionId: string
  /** Rises with every pick, so choosing a version again can mean "try again". */
  attempt: number
  /** What a screen reader is told is on screen, e.g. "Sep 30, 16:40, by Grace". */
  label?: string
  /** The same facts as `label`, in parts, for the pill and the restore message to quote. */
  details?: VersionDetails
}

let selection: VersionSelection | null = null
// Never reset: a pick that comes back to a version it failed on earlier must still look new.
let picks = 0
const listeners = new Set<() => void>()

function publish(next: VersionSelection | null): void {
  selection = next
  for (const listener of listeners) listener()
}

/**
 * Choosing the version that is already chosen is a retry, not a no-op: after a failed
 * preview the row stays selected and its notice says "try again", and the only thing
 * the user can do from there is click it. The preview ignores the new attempt when it is
 * already showing that version, so a repeat click on a working one changes nothing.
 */
export function selectVersion(
  documentId: string,
  versionId: string,
  label?: string,
  details?: VersionDetails,
): void {
  picks += 1
  publish({ documentId, versionId, attempt: picks, label, details })
}

/**
 * Clears the selection. With a document id, only if the selection belongs to that
 * document: React may unmount the old document after the new one has mounted, and an
 * unguarded clear would drop a pick made on the one now on screen.
 */
export function clearVersion(documentId?: string): void {
  if (!selection) return
  if (documentId !== undefined && selection.documentId !== documentId) return
  publish(null)
}

export function getVersionSelection(): VersionSelection | null {
  return selection
}

export function subscribeVersionSelection(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The selection for `documentId`, or null when nothing, or another document, is selected. */
export function useVersionSelection(documentId: string): VersionSelection | null {
  return useSyncExternalStore(
    subscribeVersionSelection,
    () => (selection?.documentId === documentId ? selection : null),
    // A constant, so the server render and the first client render agree.
    () => null,
  )
}
