import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as Y from 'yjs'
import { WebSocket } from 'ws'
import { prisma } from '@crdt/db'
import { createSyncServer, type SyncServer } from '@crdt/sync/server'
import { DocumentStore } from '@crdt/sync/store'
import { UpdateQueue } from '@crdt/sync/update-queue'
import { mintDocToken } from '../src/app/api/documents/[id]/token/route.js'
import { createDocSession } from '../src/lib/doc-session.js'

const SECRET = 'sync-secret-that-is-long-enough!'

let server: SyncServer
let queue: UpdateQueue
let documentId: string
let editor: { id: string; name: string; email: string }
let viewer: { id: string; name: string; email: string }

/**
 * Populated by the server's own `onReject` hook. Used in the second test to prove the
 * server actually received and rejected the viewer's malicious frame, rather than
 * inferring it from a fixed delay that would pass whether or not the frame was ever
 * processed.
 */
const rejections: Array<{ documentId: string; reason: string }> = []

beforeAll(async () => {
  process.env.SYNC_JWT_SECRET = SECRET

  // Namespaced as "role-enforce-e2e-" rather than "rbac-e2e-": workspace-routes.integration.test.ts
  // cleans up with `email: { contains: 'rbac-' } }`, which would also match a "rbac-e2e-*"
  // address and delete these users mid-run when both files execute concurrently under
  // Vitest's default parallelism — that collision was diagnosed by hand (see task-19
  // report) and produced exactly this symptom: an indefinite hang, because
  // createDocSession retries a failing token fetch forever rather than throwing.
  const e = await prisma.user.create({
    data: { email: 'role-enforce-e2e-editor@example.com', name: 'Editor', passwordHash: 'x' },
  })
  const v = await prisma.user.create({
    data: { email: 'role-enforce-e2e-viewer@example.com', name: 'Viewer', passwordHash: 'x' },
  })
  editor = { id: e.id, name: e.name, email: e.email }
  viewer = { id: v.id, name: v.name, email: v.email }

  const workspace = await prisma.workspace.create({ data: { name: 'role-enforce-e2e', ownerId: e.id } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspace.id, userId: e.id, role: 'editor' },
      { workspaceId: workspace.id, userId: v.id, role: 'viewer' },
    ],
  })
  documentId = (
    await prisma.document.create({
      data: { workspaceId: workspace.id, type: 'doc', title: 'role-enforce-e2e doc' },
    })
  ).id

  const store = new DocumentStore(prisma, { snapshotEvery: 100 })
  queue = new UpdateQueue(store, { flushIntervalMs: 50, maxBatch: 8 })
  server = await createSyncServer({
    port: 0,
    jwtSecret: SECRET,
    loadDocument: (id) => store.load(id),
    onPersist: (id, update, clientId, userId) =>
      queue.enqueue(id, { update, clientId, userId }),
    onReject: (id, reason) => {
      rejections.push({ documentId: id, reason })
    },
  })
})

afterAll(async () => {
  await queue.close()
  await server.close()
  await prisma.workspace.deleteMany({ where: { name: 'role-enforce-e2e' } })
  await prisma.user.deleteMany({ where: { email: { contains: 'role-enforce-e2e-' } } })
  await prisma.$disconnect()
})

async function sessionFor(user: { id: string; name: string; email: string }) {
  const session = createDocSession({
    documentId,
    syncUrl: `ws://127.0.0.1:${server.port}`,
    disableBc: true,
    WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
    fetchToken: async () => (await mintDocToken(user, documentId)).token,
  })
  await new Promise<void>((resolve) => session.provider.once('sync', () => resolve()))
  return session
}

function eventually(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('role enforcement, end to end', () => {
  it('lets a viewer read what an editor writes', async () => {
    const e = await sessionFor(editor)
    const v = await sessionFor(viewer)

    e.doc.getText('t').insert(0, 'editor content')
    await eventually(() => v.doc.getText('t').toString() === 'editor content')

    e.destroy()
    v.destroy()
  })

  it('never lets a viewer edit reach the editor, the server, or the database', async () => {
    const e = await sessionFor(editor)
    const v = await sessionFor(viewer)

    // Drain anything still buffered from the previous test so the row-count assertion
    // below measures only what this test itself causes to be persisted.
    await queue.flush()
    const rowsBefore = await prisma.documentUpdate.count({ where: { documentId } })
    const rejectionsBefore = rejections.length

    // The viewer's malicious edit goes first. Do not just wait a fixed delay and hope
    // the server got to it: this project has already shipped three tests that could
    // not fail even when the property they named was violated (a viewer-liveness check
    // reading the wrong document, a merge-order test whose interleaving never happened,
    // an auth check whose vulnerable branch was never reached). Waiting on the server's
    // own `onReject` hook proves the server actually received and rejected this exact
    // frame, rather than assuming enough time has passed.
    v.doc.getText('t').insert(0, 'VIEWER EDIT')
    await eventually(() =>
      rejections
        .slice(rejectionsBefore)
        .some((r) => r.documentId === documentId && r.reason === 'viewer_update'),
    )

    // Only now does the editor write, and only now do we wait for it to land. Each
    // client's frames are handled by the server in the order the server receives them,
    // so by the time the rejection above was observed, any broadcast the viewer's edit
    // might illegitimately have triggered would already have gone out. Waiting for the
    // editor's edit to arrive on the *viewer's own* independent Y.Doc (a different
    // process-local object, reachable only through the real WebSocket round trip)
    // proves the propagation channel is genuinely live — a dead relay could not produce
    // this — while leaving the malicious edit every remaining opportunity to have
    // piggybacked along if the guard were broken.
    e.doc.getText('t').insert(0, 'legitimate ')
    await eventually(() => v.doc.getText('t').toString().includes('legitimate'))

    // Only the editor's doc matters here: the viewer's own doc is expected to still
    // show 'VIEWER EDIT' optimistically (see the third test) — that is a UI concern,
    // not a leak. What must never happen is this text reaching a *different* client.
    expect(e.doc.getText('t').toString()).not.toContain('VIEWER EDIT')

    await queue.flush()

    const rows = await prisma.documentUpdate.findMany({
      where: { documentId },
      select: { clientId: true },
    })
    // Proves the persistence channel fired for *this test's* writes specifically —
    // not merely that some row exists somewhere, which could be left over from an
    // earlier test and pass by accident even if this test's own write never persisted.
    expect(rows.length).toBeGreaterThan(rowsBefore)

    const restored = new Y.Doc()
    const store = new DocumentStore(prisma)
    Y.applyUpdate(restored, (await store.load(documentId))!)
    // The positive check matters as much as the negative one: it proves the editor's
    // legitimate write is what actually reached disk, so the negative check below isn't
    // vacuously true because nothing at all got persisted.
    expect(restored.getText('t').toString()).toContain('legitimate')
    expect(restored.getText('t').toString()).not.toContain('VIEWER EDIT')

    e.destroy()
    v.destroy()
  })

  it('leaves the viewer optimistically showing their own rejected edit', async () => {
    // Worth knowing and worth saying out loud: the viewer's own tab still shows the
    // text they typed, because Yjs applied it locally before the server refused it.
    // The UI prevents this by disabling input for viewers; the server guarantees the
    // edit never escapes that tab. Those are two different jobs.
    const v = await sessionFor(viewer)
    v.doc.getText('t').insert(0, 'LOCAL ONLY')
    expect(v.doc.getText('t').toString()).toContain('LOCAL ONLY')
    v.destroy()
  })
})
