import { describe, it, expect } from 'vitest'
import { activeDocumentIdFrom, documentHref } from '../src/lib/routes.js'

describe('documentHref', () => {
  it('nests the document under its workspace', () => {
    expect(documentHref('ws1', 'doc1')).toBe('/workspaces/ws1/documents/doc1')
  })
})

describe('activeDocumentIdFrom', () => {
  // The invariant that matters: the nav reads back what the links wrote. A change
  // to one function and not the other fails here and nowhere else.
  it('reads the id back out of a href it built', () => {
    expect(activeDocumentIdFrom(documentHref('ws1', 'doc1'))).toBe('doc1')
  })

  it('is undefined on the workspace overview', () => {
    expect(activeDocumentIdFrom('/workspaces/ws1')).toBeUndefined()
  })

  it('is undefined on the dashboard, on the documents collection, and for null', () => {
    expect(activeDocumentIdFrom('/')).toBeUndefined()
    expect(activeDocumentIdFrom('/workspaces/ws1/documents')).toBeUndefined()
    expect(activeDocumentIdFrom(null)).toBeUndefined()
  })

  it('tolerates a trailing slash', () => {
    expect(activeDocumentIdFrom('/workspaces/ws1/documents/doc1/')).toBe('doc1')
  })

  // A future sub-path of a document (a history route, say) should leave that
  // document's tab active rather than deactivating every tab.
  it('still finds the document on a deeper path under it', () => {
    expect(activeDocumentIdFrom('/workspaces/ws1/documents/doc1/history')).toBe('doc1')
  })

  it('is undefined for the legacy flat document path', () => {
    expect(activeDocumentIdFrom('/documents/doc1')).toBeUndefined()
  })

  it('does not match a workspace id containing a slash-escaped lookalike', () => {
    expect(activeDocumentIdFrom('/workspacesXws1/documents/doc1')).toBeUndefined()
  })
})
