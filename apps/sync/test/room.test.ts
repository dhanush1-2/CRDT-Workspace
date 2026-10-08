import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import { Awareness } from 'y-protocols/awareness'
import { DocumentRoom, LOAD_ORIGIN, type Connection } from '../src/room.js'
import {
  MESSAGE_SYNC,
  applyAwarenessFrame,
  encodeAwareness,
  encodeSyncStep1,
  encodeUpdate,
  handleSyncFrame,
  peekFrame,
} from '../src/protocol.js'
import type { Role } from '@crdt/shared/types'

function fakeConnection(id: string, role: Role = 'editor') {
  const sent: Uint8Array[] = []
  const closed: Array<{ code: number; reason: string }> = []
  const conn: Connection = {
    id,
    userId: `usr_${id}`,
    role,
    send: (data) => { sent.push(data) },
    close: (code, reason) => { closed.push({ code, reason }) },
  }
  return { conn, sent, closed }
}

describe('DocumentRoom', () => {
  it("reports the connection's user as the author of an update", () => {
    const persisted: { clientId: string; userId: string | null }[] = []
    const room = new DocumentRoom('doc_1', {
      onPersist: (_update, clientId, userId) => persisted.push({ clientId, userId }),
    })
    const a = fakeConnection('conn-1')
    room.add(a.conn)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'hello')
    room.handleFrame(a.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))

    expect(persisted).toEqual([{ clientId: 'conn-1', userId: 'usr_conn-1' }])
  })

  it('reports no author for an update with no connection behind it', () => {
    const persisted: { clientId: string; userId: string | null }[] = []
    const room = new DocumentRoom('doc_1', {
      onPersist: (_update, clientId, userId) => persisted.push({ clientId, userId }),
    })

    // No origin: the server itself changed the document. There is no user to name, and
    // naming one would be a lie about who did it.
    room.doc.getText('t').insert(0, 'hello')

    expect(persisted).toEqual([{ clientId: 'server', userId: null }])
  })

  it('relays an editor update to peers but not back to the sender', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    const b = fakeConnection('b')
    room.add(a.conn)
    room.add(b.conn)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'hello')
    room.handleFrame(a.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))

    expect(a.sent).toHaveLength(0)
    expect(b.sent).toHaveLength(1)
    expect(peekFrame(b.sent[0]!)).toBe('update')
    expect(room.doc.getText('t').toString()).toBe('hello')
  })

  it('answers sync-step1 on the sender connection only', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    room.doc.getText('t').insert(0, 'server state')
    const a = fakeConnection('a')
    const b = fakeConnection('b')
    room.add(a.conn)
    room.add(b.conn)

    room.handleFrame(a.conn, encodeSyncStep1(new Y.Doc()))

    expect(a.sent.map(peekFrame)).toContain('sync-step2')
    expect(b.sent).toHaveLength(0)
  })

  it('calls onPersist once per applied update with the sender id', () => {
    const onPersist = vi.fn()
    const room = new DocumentRoom('doc_1', { onPersist })
    const a = fakeConnection('a')
    room.add(a.conn)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'x')
    room.handleFrame(a.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))

    expect(onPersist).toHaveBeenCalledTimes(1)
    expect(onPersist.mock.calls[0]![1]).toBe('a')
  })

  it('does not persist state loaded from storage', () => {
    const onPersist = vi.fn()
    const room = new DocumentRoom('doc_1', { onPersist })

    const stored = new Y.Doc()
    stored.getText('t').insert(0, 'from disk')
    room.loadState(Y.encodeStateAsUpdate(stored))

    expect(onPersist).not.toHaveBeenCalled()
    expect(room.doc.getText('t').toString()).toBe('from disk')
  })

  it('drops a viewer update: no peer relay, no persistence, permission denied sent', () => {
    const onPersist = vi.fn()
    const room = new DocumentRoom('doc_1', { onPersist })
    const viewer = fakeConnection('v', 'viewer')
    const editor = fakeConnection('e', 'editor')
    room.add(viewer.conn)
    room.add(editor.conn)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'sneaky')
    room.handleFrame(viewer.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))

    expect(room.doc.getText('t').toString()).toBe('')
    expect(editor.sent).toHaveLength(0)
    expect(onPersist).not.toHaveBeenCalled()
    expect(viewer.sent).toHaveLength(1) // the permission-denied frame
  })

  it('drops a viewer handshake sync-step2 without sending anything back', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const viewer = fakeConnection('v', 'viewer')
    room.add(viewer.conn)

    const client = new Y.Doc()
    const step2 = handleSyncFrame(encodeSyncStep1(room.doc), client, 'test')!
    room.handleFrame(viewer.conn, step2)

    expect(viewer.sent).toHaveLength(0)
  })

  it('reports size and stops relaying to removed connections', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    const b = fakeConnection('b')
    room.add(a.conn)
    room.add(b.conn)
    expect(room.size).toBe(2)

    room.remove(b.conn)
    expect(room.size).toBe(1)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'y')
    room.handleFrame(a.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))
    expect(b.sent).toHaveLength(0)
  })

  it('survives a malformed frame without throwing', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    room.add(a.conn)

    expect(() => room.handleFrame(a.conn, new Uint8Array([200, 200, 200]))).not.toThrow()
    expect(room.size).toBe(1)
  })

  it('closes the connection with 4500 on a malformed sync-step1 payload, without killing the room', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    const b = fakeConnection('b')
    room.add(a.conn)
    room.add(b.conn)

    // Valid header, but a length prefix for the state-vector payload far larger
    // than the bytes that actually follow. peekFrame classifies this as
    // 'sync-step1' (a well-formed header), so the guard allows it through, and
    // lib0's readVarUint8Array throws RangeError('Invalid typed array length')
    // deep inside readSyncStep1 when it tries to slice past the buffer's end.
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    encoding.writeVarUint(encoder, syncProtocol.messageYjsSyncStep1)
    encoding.writeVarUint(encoder, 9999)
    const malformed = encoding.toUint8Array(encoder)

    expect(() => room.handleFrame(a.conn, malformed)).not.toThrow()
    expect(a.closed).toEqual([{ code: 4500, reason: 'frame handling failed' }])

    // One bad frame kills one connection, not the room: b is still tracked,
    // and the room still processes new frames correctly afterwards.
    expect(room.size).toBe(2)
    const source = new Y.Doc()
    source.getText('t').insert(0, 'still alive')
    room.handleFrame(b.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))
    expect(room.doc.getText('t').toString()).toBe('still alive')
  })

  it('closes the connection with 4500 on a malformed update payload (protocol.ts errorHandler fix)', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    room.add(a.conn)

    // Same shape of corruption as above, but for the messageYjsUpdate branch,
    // which is routed through readSyncStep2/readUpdate. Those functions used to
    // swallow the error with console.error and never rethrow; handleSyncFrame
    // now passes an errorHandler that rethrows, so this must also close 4500.
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate)
    encoding.writeVarUint(encoder, 9999)
    const malformed = encoding.toUint8Array(encoder)

    expect(() => room.handleFrame(a.conn, malformed)).not.toThrow()
    expect(a.closed).toEqual([{ code: 4500, reason: 'frame handling failed' }])
  })

  it('relays a real awareness update to peers and clears it for them when the sender disconnects', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    const b = fakeConnection('b')
    room.add(a.conn)
    room.add(b.conn)

    // Connection A's own client-side awareness, announcing cursor state — this
    // is the shape of frame a real editor client sends.
    const clientDoc = new Y.Doc()
    const clientAwareness = new Awareness(clientDoc)
    clientAwareness.setLocalState({ cursor: { x: 1, y: 2 } })
    const frame = encodeAwareness(clientAwareness, [clientDoc.clientID])

    room.handleFrame(a.conn, frame)

    expect(b.sent).toHaveLength(1)
    expect(peekFrame(b.sent[0]!)).toBe('awareness')

    // Decode what B actually received by applying it to a fresh mirror
    // Awareness instance, using the same protocol helper the real client uses.
    const mirror = new Awareness(new Y.Doc())
    applyAwarenessFrame(b.sent[0]!, mirror, 'test')
    expect(mirror.getStates().get(clientDoc.clientID)).toEqual({ cursor: { x: 1, y: 2 } })

    room.remove(a.conn)

    expect(b.sent).toHaveLength(2)
    expect(peekFrame(b.sent[1]!)).toBe('awareness')

    applyAwarenessFrame(b.sent[1]!, mirror, 'test')
    expect(mirror.getStates().get(clientDoc.clientID)).toBeUndefined()
  })

  it('pushes existing awareness state to a newly-added connection, unprompted', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    room.add(a.conn)

    // A's real client-side awareness, announcing presence — the same shape a
    // real editor client sends. This is applied before B ever connects, and
    // B never sends (and a real y-websocket client never would send, over an
    // actual WebSocket) a query-awareness frame asking for it.
    const clientDoc = new Y.Doc()
    const clientAwareness = new Awareness(clientDoc)
    clientAwareness.setLocalState({ user: { name: 'Alice' } })
    room.handleFrame(a.conn, encodeAwareness(clientAwareness, [clientDoc.clientID]))

    const b = fakeConnection('b')
    room.add(b.conn)

    // B must receive A's existing state immediately on being added — not
    // after any subsequent awareness update from either side.
    expect(b.sent).toHaveLength(1)
    expect(peekFrame(b.sent[0]!)).toBe('awareness')

    const mirror = new Awareness(new Y.Doc())
    applyAwarenessFrame(b.sent[0]!, mirror, 'test')
    expect(mirror.getStates().get(clientDoc.clientID)).toEqual({ user: { name: 'Alice' } })
  })

  it('sends nothing to a new connection when the room has no awareness state yet', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')

    room.add(a.conn)

    expect(a.sent).toHaveLength(0)
  })
})
