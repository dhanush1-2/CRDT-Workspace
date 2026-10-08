import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { WebSocket } from 'ws'
import { signDocToken } from '@crdt/shared/doc-token'
import type { Role } from '@crdt/shared/types'
import { createSyncServer, type SyncServer } from '../src/server.js'

const SECRET = 'test-secret-that-is-long-enough!!'

let server: SyncServer

beforeEach(async () => {
  server = await createSyncServer({ port: 0, jwtSecret: SECRET })
})

afterEach(async () => {
  await server.close()
})

async function connect(
  documentId: string,
  name: string,
  role: Role = 'editor',
  targetServer: SyncServer = server,
) {
  const token = await signDocToken(
    { sub: `usr_${name}`, docId: documentId, role, name, color: '#000' },
    SECRET,
  )
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(`ws://127.0.0.1:${targetServer.port}`, documentId, doc, {
    params: { token },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    // Without this, the two providers in this process sync over BroadcastChannel
    // and the test passes even with the server stopped.
    disableBc: true,
  })
  await new Promise<void>((resolve) => provider.once('sync', () => resolve()))
  return { doc, provider }
}

function eventually(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('condition not met in time'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('sync server', () => {
  it('hands the verified user of the sending socket to onPersist', async () => {
    const persisted: { documentId: string; clientId: string; userId: string | null }[] = []
    const capturing = await createSyncServer({
      port: 0,
      jwtSecret: SECRET,
      onPersist: (documentId, _update, clientId, userId) =>
        persisted.push({ documentId, clientId, userId }),
    })
    try {
      const a = await connect('doc_author', 'alice', 'editor', capturing)
      a.doc.getText('t').insert(0, 'hello')

      await eventually(() => persisted.length > 0)

      expect(persisted.map((p) => p.userId)).toEqual(persisted.map(() => 'usr_alice'))
      expect(persisted[0]!.documentId).toBe('doc_author')
      a.provider.destroy()
    } finally {
      await capturing.close()
    }
  })

  it('converges two clients on the same document', async () => {
    const a = await connect('doc_1', 'alice')
    const b = await connect('doc_1', 'bob')

    a.doc.getText('t').insert(0, 'hello ')
    b.doc.getText('t').insert(0, 'world ')

    await eventually(() => a.doc.getText('t').toString() === b.doc.getText('t').toString())

    expect(a.doc.getText('t').toString()).toContain('hello')
    expect(a.doc.getText('t').toString()).toContain('world')

    a.provider.destroy()
    b.provider.destroy()
  })

  it('isolates different documents', async () => {
    const a = await connect('doc_a', 'alice')
    const b = await connect('doc_b', 'bob')
    // A third client on A's own document, so the relay's liveness is proven
    // positively before checking the cross-document negative below — see the
    // 'never lets a viewer edit reach another client' test's comment for why this
    // ordering matters. Without it, this test would pass identically even if the
    // whole broadcast path were dead: a fixed wait followed by an absence check on a
    // never-live channel looks exactly like a working one.
    const aPeer = await connect('doc_a', 'alice-peer')

    a.doc.getText('t').insert(0, 'only-in-a')
    await eventually(() => aPeer.doc.getText('t').toString() === 'only-in-a')
    await new Promise((r) => setTimeout(r, 300))

    expect(b.doc.getText('t').toString()).toBe('')

    a.provider.destroy()
    aPeer.provider.destroy()
    b.provider.destroy()
  })

  it('closes a connection with no token using a permanent code', async () => {
    const doc = new Y.Doc()
    const closed = new Promise<{ code: number }>((resolve) => {
      const provider = new WebsocketProvider(
        `ws://127.0.0.1:${server.port}`, 'doc_1', doc,
        {
          WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
          disableBc: true,
        },
      )
      provider.once('closed', (event) => resolve(event))
    })

    const event = await closed
    expect(event.code).toBe(4401)
  })

  it('rejects a token minted for a different document', async () => {
    const token = await signDocToken(
      { sub: 'usr_1', docId: 'doc_other', role: 'editor', name: 'mallory', color: '#000' },
      SECRET,
    )
    const doc = new Y.Doc()
    const closed = new Promise<{ code: number }>((resolve) => {
      const provider = new WebsocketProvider(
        `ws://127.0.0.1:${server.port}`, 'doc_1', doc,
        {
          params: { token },
          WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
          disableBc: true,
        },
      )
      provider.once('closed', (event) => resolve(event))
    })

    expect((await closed).code).toBe(4403)
  })

  it('closes a malformed request with a permanent code and keeps serving other documents', async () => {
    const closed = new Promise<{ code: number }>((resolve) => {
      // A raw ws client, not y-websocket: we need a document-id segment with an invalid
      // percent-escape (%zz is not two hex digits), which decodeURIComponent rejects.
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/%zz`)
      ws.once('close', (code) => resolve({ code }))
      ws.once('error', () => {}) // a raw socket error alongside the close is not the point of this test
    })

    expect((await closed).code).toBe(4400)

    // The server must still be able to serve a normal document after a malformed request.
    const a = await connect('doc_after_malformed', 'alice')
    a.provider.destroy()
  })

  it('never lets a viewer edit reach another client', async () => {
    const editor = await connect('doc_v', 'editor-user', 'editor')
    const viewer = await connect('doc_v', 'viewer-user', 'viewer')

    viewer.doc.getText('t').insert(0, 'VIEWER WROTE THIS')
    editor.doc.getText('t').insert(0, 'editor wrote this')

    // Prove the relay is actually live in the direction that matters: the editor's
    // legitimate write must reach the viewer. Checking editor.doc here would pass
    // even with the relay completely dead, since it contains its own local insert.
    await eventually(() => viewer.doc.getText('t').toString().includes('editor wrote this'))
    await new Promise((r) => setTimeout(r, 300))

    expect(editor.doc.getText('t').toString()).not.toContain('VIEWER')

    editor.provider.destroy()
    viewer.provider.destroy()
  })

  it('catches a client up after it reconnects', async () => {
    const a = await connect('doc_r', 'alice')
    const b = await connect('doc_r', 'bob')

    b.provider.disconnect()
    a.doc.getText('t').insert(0, 'written while bob was away')
    b.doc.getText('t').insert(0, 'written by bob offline ')

    await new Promise((r) => setTimeout(r, 200))
    b.provider.connect()

    await eventually(() => a.doc.getText('t').toString() === b.doc.getText('t').toString())
    expect(b.doc.getText('t').toString()).toContain('while bob was away')
    expect(a.doc.getText('t').toString()).toContain('by bob offline')

    a.provider.destroy()
    b.provider.destroy()
  })

  it('evicts a room once the last client leaves', async () => {
    // The production default idleEvictMs is 30s (see config.ts / server.ts), which is
    // deliberately much longer than a test should wait. This test spins up its own
    // server with a short idleEvictMs so it exercises the same eviction code path
    // (DocumentRoom removal on empty room + scheduleEvict) without a 30s real-time wait.
    const shortEvictServer = await createSyncServer({
      port: 0,
      jwtSecret: SECRET,
      idleEvictMs: 200,
    })
    try {
      const a = await connect('doc_e', 'alice', 'editor', shortEvictServer)
      expect(shortEvictServer.roomCount).toBe(1)

      a.provider.destroy()
      await eventually(() => shortEvictServer.roomCount === 0, 3000)
    } finally {
      await shortEvictServer.close()
    }
  })

  it('does not drop the client handshake when document loading is slow', async () => {
    // ws does not queue frames for a listener that is not yet attached. Any real
    // async work before ws.on('message') is wired silently loses the client's
    // first frame and the handshake hangs forever. pause()/resume() guards this.
    const slowServer = await createSyncServer({
      port: 0,
      jwtSecret: SECRET,
      loadDocument: async () => {
        await new Promise((r) => setTimeout(r, 50))
        return null
      },
    })

    try {
      const { provider } = await connect('doc_slow', 'slow', 'editor', slowServer)
      provider.destroy()
    } finally {
      await slowServer.close()
    }
  }, 3000)
})
