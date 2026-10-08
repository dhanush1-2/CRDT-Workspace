import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// The store still describes document A, busy and connected, while the route is document B.
// This is the window between a move and the new page publishing; the nav must not borrow A's
// people or A's status for B. (Rendered on the server, where the real store hook always
// returns its empty snapshot, so the hook is replaced with the stale state.)
vi.mock('@/lib/doc-state', () => ({
  useDocState: () => ({
    documentId: 'doc-a',
    status: 'connected',
    peers: [{ clientId: 7, name: 'Pat', color: '#123456' }],
  }),
}))

const { NavPresence } = await import('@/components/NavPresence')
const { SyncStatus } = await import('@/components/SyncStatus')

describe('the nav while the next document connects', () => {
  const self = { name: 'Eddie', color: '#abcdef' }

  it('shows no one from the previous document', () => {
    const html = renderToStaticMarkup(<NavPresence self={self} documentId="doc-b" />)
    expect(html).toContain('presence-self')
    expect(html).not.toContain('presence-7')
  })

  it('shows the previous document\'s people on that document', () => {
    const html = renderToStaticMarkup(<NavPresence self={self} documentId="doc-a" />)
    expect(html).toContain('presence-7')
  })

  it('reads connecting, not the previous document\'s head count', () => {
    const html = renderToStaticMarkup(<SyncStatus documentId="doc-b" />)
    expect(html).toContain('data-status="connecting"')
    expect(html).not.toContain('2 here')
  })

  it('reports the previous document\'s status on that document', () => {
    const html = renderToStaticMarkup(<SyncStatus documentId="doc-a" />)
    expect(html).toContain('data-status="connected"')
    expect(html).toContain('2 here')
  })
})
