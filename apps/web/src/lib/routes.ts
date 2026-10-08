/**
 * The canonical URL for a document. Documents live under their workspace so that a
 * single layout at the workspace segment can own the nav for both the overview and
 * every document in it.
 */
export function documentHref(workspaceId: string, documentId: string): string {
  return `/workspaces/${workspaceId}/documents/${documentId}`
}

// Anchored at the start, and the id is followed by a slash or the end of the path, so
// a deeper path under a document still resolves to that document.
const DOCUMENT_PATH = /^\/workspaces\/[^/]+\/documents\/([^/]+)(?:\/|$)/

/**
 * The open document's id, read from the path.
 *
 * The nav lives in a layout at the workspace segment, and a layout cannot see the
 * params of the segment below it. The path is therefore the only place the nav can
 * learn which document is open. `usePathname()` supplies it, during the server
 * render as well as on the client, so the active tab is correct in the HTML.
 */
export function activeDocumentIdFrom(pathname: string | null): string | undefined {
  if (!pathname) return undefined
  return DOCUMENT_PATH.exec(pathname)?.[1]
}
