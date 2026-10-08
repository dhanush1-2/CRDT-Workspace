import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { WebSocket } from 'ws'
import { prisma } from '@crdt/db'
import { signDocToken } from '@crdt/shared/doc-token'
import { createSyncServer, type SyncServer } from '../src/server.js'
import { DocumentStore } from '../src/store.js'
import { UpdateQueue } from '../src/update-queue.js'

const SECRET = 'test-secret-that-is-long-enough!!'

let documentId: string

beforeEach(async () => {
  const ws = await prisma.workspace.create({ data: { name: 'durability', ownerId: 'usr_t' } })
  const doc = await prisma.document.create({
    data: { workspaceId: ws.id, type: 'doc', title: 'durable' },
  })
  documentId = doc.id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: 'durability' } })
  await prisma.$disconnect()
})

async function startServer(store: DocumentStore): Promise<{ server: SyncServer; queue: UpdateQueue }> {
  const queue = new UpdateQueue(store, { flushIntervalMs: 50, maxBatch: 8 })
  const server = await createSyncServer({
    port: 0,
    jwtSecret: SECRET,
    loadDocument: (id) => store.load(id),
    onPersist: (id, update, clientId, userId) =>
      queue.enqueue(id, { update, clientId, userId }),
    onDocumentPersisted: async (id, doc) => {
      if (store.needsSnapshot(id)) await store.snapshot(id, doc)
    },
  })
  return { server, queue }
}

async function connect(server: SyncServer, name: string) {
  const token = await signDocToken(
    { sub: `usr_${name}`, docId: documentId, role: 'editor', name, color: '#000' },
    SECRET,
  )
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(`ws://127.0.0.1:${server.port}`, documentId, doc, {
    params: { token },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  })
  await new Promise<void>((resolve) => provider.once('sync', () => resolve()))
  return { doc, provider }
}

describe('durability', () => {
  it('restores document state after a full server restart', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 100 })

    const first = await startServer(store)
    const writer = await connect(first.server, 'alice')
    writer.doc.getText('t').insert(0, 'survives restart')

    await new Promise((r) => setTimeout(r, 150))
    await first.queue.close()
    writer.provider.destroy()
    await first.server.close()

    // A fresh store instance, not the one `first` used, so nothing about this pass can
    // be credited to in-memory bookkeeping carried across the "restart" — only what a
    // brand-new process reading from Postgres would have. Same reasoning the snapshot
    // test below already applies.
    const second = await startServer(new DocumentStore(prisma, { snapshotEvery: 100 }))
    const reader = await connect(second.server, 'bob')

    expect(reader.doc.getText('t').toString()).toBe('survives restart')

    reader.provider.destroy()
    await second.queue.close()
    await second.server.close()
  })

  it('writes a snapshot once the threshold is crossed and still loads correctly', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 5 })

    const first = await startServer(store)
    const writer = await connect(first.server, 'alice')

    for (let i = 0; i < 12; i += 1) {
      writer.doc.getText('t').insert(writer.doc.getText('t').length, `${i} `)
      await new Promise((r) => setTimeout(r, 60))
    }

    await first.queue.close()
    const expected = writer.doc.getText('t').toString()
    writer.provider.destroy()
    await first.server.close()

    const snapshots = await prisma.documentSnapshot.findMany({ where: { documentId } })
    expect(snapshots.length).toBeGreaterThan(0)

    const second = await startServer(new DocumentStore(prisma, { snapshotEvery: 5 }))
    const reader = await connect(second.server, 'bob')
    expect(reader.doc.getText('t').toString()).toBe(expected)

    reader.provider.destroy()
    await second.queue.close()
    await second.server.close()
  })

  it('gives a second client the loaded content instead of leaving it permanently blank', async () => {
    // Reproduces the race the final review found manually: `roomFor` used to register
    // the new DocumentRoom in `rooms` *before* awaiting `loadDocument`, so a second
    // connection landing during that window joined an empty Y.Doc and never learned the
    // load had completed (LOAD_ORIGIN updates are deliberately never broadcast to
    // peers, since that's what stops a load from re-triggering persistence). Seed real
    // content via a real DocumentStore write so `loadDocument` genuinely has state to
    // load, then inject an artificial delay so the load is still in flight when the
    // second client's connection lands.
    const store = new DocumentStore(prisma, { snapshotEvery: 100 })
    const seed = new Y.Doc()
    seed.getText('t').insert(0, 'seeded before cold load')
    await store.append(documentId, [{ update: Y.encodeStateAsUpdate(seed), clientId: 'seed', userId: null }])

    const server = await createSyncServer({
      port: 0,
      jwtSecret: SECRET,
      loadDocument: async (id) => {
        await new Promise((r) => setTimeout(r, 300))
        return store.load(id)
      },
    })

    try {
      const aPromise = connect(server, 'alice')
      // Land bob's connection about a sixth of the way into alice's 300ms load, so his
      // is a genuine mid-load arrival rather than a lucky race that happens to land
      // after the load already resolved.
      await new Promise((r) => setTimeout(r, 50))
      const bPromise = connect(server, 'bob')

      const [a, b] = await Promise.all([aPromise, bPromise])

      expect(a.doc.getText('t').toString()).toBe('seeded before cold load')
      expect(b.doc.getText('t').toString()).toBe('seeded before cold load')

      a.provider.destroy()
      b.provider.destroy()
    } finally {
      await server.close()
    }
  }, 5000)

  it('does not persist a viewer edit', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 100 })
    const { server, queue } = await startServer(store)

    const token = await signDocToken(
      { sub: 'usr_v', docId: documentId, role: 'viewer', name: 'v', color: '#000' },
      SECRET,
    )
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(`ws://127.0.0.1:${server.port}`, documentId, doc, {
      params: { token },
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    })
    await new Promise<void>((resolve) => provider.once('sync', () => resolve()))

    doc.getText('t').insert(0, 'viewer edit')
    await new Promise((r) => setTimeout(r, 200))
    await queue.close()

    const rows = await prisma.documentUpdate.findMany({ where: { documentId } })
    expect(rows).toHaveLength(0)

    provider.destroy()
    await server.close()
  })
})
