import { useSyncExternalStore } from 'react'

/**
 * Which version of which document the user has chosen in the History panel, if any.
 *
 * A module store, like doc-state.ts, because the three places that care are far apart in
 * the tree: the panel writes it, the document page reads it to swap its live view for the
 * preview, and the nav's "viewing an old version" pill reads it too. The document id is
 * part of the value so a pick never outlives a navigation to another document.
 */
export type VersionSelection = { documentId: string; versionId: string }

let selection: VersionSelection | null = null
const listeners = new Set<() => void>()

function publish(next: VersionSelection | null): void {
  selection = next
  for (const listener of listeners) listener()
}

export function selectVersion(documentId: string, versionId: string): void {
  // The same pick again changes nothing, and a notify would re-render every reader.
  if (selection?.documentId === documentId && selection.versionId === versionId) return
  publish({ documentId, versionId })
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
