import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import * as Y from 'yjs'
import { prisma } from '@crdt/db'
import { DocumentStore } from '../src/store.js'

let workspaceId: string
let documentId: string
const AUTHOR_EMAIL = 'store-author@store-test.invalid'

beforeEach(async () => {
  const ws = await prisma.workspace.create({ data: { name: 'store-test', ownerId: 'usr_t' } })
  workspaceId = ws.id
  const doc = await prisma.document.create({
    data: { workspaceId, type: 'doc', title: 'store-test-doc' },
  })
  documentId = doc.id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: 'store-test' } })
  await prisma.user.deleteMany({ where: { email: AUTHOR_EMAIL } })
  await prisma.$disconnect()
})

function updateFrom(text: string): Uint8Array {
  const doc = new Y.Doc()
  doc.getText('t').insert(0, text)
  return Y.encodeStateAsUpdate(doc)
}

describe('DocumentStore', () => {
  it('returns null for a document with no history', async () => {
    const store = new DocumentStore(prisma)
    await expect(store.load(documentId)).resolves.toBeNull()
  })

  it('round-trips updates into a usable document state', async () => {
    const store = new DocumentStore(prisma)
    await store.append(documentId, [{ update: updateFrom('hello'), clientId: 'c1', userId: null }])

    const state = await store.load(documentId)
    expect(state).not.toBeNull()

    const restored = new Y.Doc()
    Y.applyUpdate(restored, state!)
    expect(restored.getText('t').toString()).toBe('hello')
  })

  it('merges many updates in insertion order', async () => {
    const store = new DocumentStore(prisma)
    const source = new Y.Doc()
    const rows = []
    for (const word of ['a', 'b', 'c', 'd']) {
      const before = Y.encodeStateVector(source)
      source.getText('t').insert(source.getText('t').length, word)
      rows.push({ update: Y.encodeStateAsUpdate(source, before), clientId: 'c1', userId: null })
    }
    for (const row of rows) await store.append(documentId, [row])

    const restored = new Y.Doc()
    Y.applyUpdate(restored, (await store.load(documentId))!)
    expect(restored.getText('t').toString()).toBe('abcd')
  })

  it('asks for a snapshot only after the threshold is crossed', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 3 })
    expect(store.needsSnapshot(documentId)).toBe(false)

    await store.append(documentId, [
      { update: updateFrom('a'), clientId: 'c1', userId: null },
      { update: updateFrom('b'), clientId: 'c1', userId: null },
    ])
    expect(store.needsSnapshot(documentId)).toBe(false)

    await store.append(documentId, [{ update: updateFrom('c'), clientId: 'c1', userId: null }])
    expect(store.needsSnapshot(documentId)).toBe(true)
  })

  it('writes a snapshot and loads from it instead of the whole log', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 2 })
    const doc = new Y.Doc()

    doc.getText('t').insert(0, 'first ')
    await store.append(documentId, [{ update: Y.encodeStateAsUpdate(doc), clientId: 'c1', userId: null }])
    doc.getText('t').insert(doc.getText('t').length, 'second')
    await store.append(documentId, [{ update: Y.encodeStateAsUpdate(doc), clientId: 'c1', userId: null }])

    await store.snapshot(documentId, doc)
    expect(store.needsSnapshot(documentId)).toBe(false)

    const snapshots = await prisma.documentSnapshot.findMany({ where: { documentId } })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]!.throughUpdateId > 0n).toBe(true)

    const fresh = new DocumentStore(prisma, { snapshotEvery: 2 })
    const restored = new Y.Doc()
    Y.applyUpdate(restored, (await fresh.load(documentId))!)
    expect(restored.getText('t').toString()).toBe('first second')
  })

  it('includes updates written after the snapshot', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 100 })
    const doc = new Y.Doc()

    doc.getText('t').insert(0, 'before ')
    await store.append(documentId, [{ update: Y.encodeStateAsUpdate(doc), clientId: 'c1', userId: null }])
    await store.snapshot(documentId, doc)

    doc.getText('t').insert(doc.getText('t').length, 'after')
    await store.append(documentId, [{ update: Y.encodeStateAsUpdate(doc), clientId: 'c1', userId: null }])

    const fresh = new DocumentStore(prisma)
    const restored = new Y.Doc()
    Y.applyUpdate(restored, (await fresh.load(documentId))!)
    expect(restored.getText('t').toString()).toBe('before after')
  })

  it('drops updates for a document that no longer exists instead of retrying forever', async () => {
    // Reproduces what happens on every Playwright suite run via the e2e fixtures'
    // cleanup: a document is deleted while a flush batch for it is still queued, so
    // the batch's append hits a real foreign-key violation (Postgres P2003) that can
    // never succeed no matter how many times it's retried.
    const store = new DocumentStore(prisma)
    await prisma.document.delete({ where: { id: documentId } })

    await expect(
      store.append(documentId, [{ update: updateFrom('orphaned'), clientId: 'c1', userId: null }]),
    ).resolves.toBeUndefined()
  })

  it('tolerates re-applying updates a snapshot already contains', async () => {
    // Yjs updates are idempotent, which is why throughUpdateId can be conservative
    // without being wrong. This test pins that property so nobody "fixes" the
    // boundary with a fragile timestamp comparison later.
    const store = new DocumentStore(prisma)
    const doc = new Y.Doc()
    doc.getText('t').insert(0, 'once')
    const update = Y.encodeStateAsUpdate(doc)

    await store.append(documentId, [{ update, clientId: 'c1', userId: null }])
    await store.append(documentId, [{ update, clientId: 'c1', userId: null }])

    const restored = new Y.Doc()
    Y.applyUpdate(restored, (await store.load(documentId))!)
    expect(restored.getText('t').toString()).toBe('once')
  })

  it("writes each row's author, including none", async () => {
    const store = new DocumentStore(prisma)
    await prisma.user.deleteMany({ where: { email: AUTHOR_EMAIL } })
    const user = await prisma.user.create({ data: { email: AUTHOR_EMAIL, name: 'store-author' } })

    await store.append(documentId, [
      { update: new Uint8Array([1]), clientId: 'conn-1', userId: user.id },
      { update: new Uint8Array([2]), clientId: 'server', userId: null },
    ])

    const rows = await prisma.documentUpdate.findMany({
      where: { documentId },
      orderBy: { id: 'asc' },
      select: { clientId: true, userId: true },
    })
    expect(rows).toEqual([
      { clientId: 'conn-1', userId: user.id },
      { clientId: 'server', userId: null },
    ])
  })

  it('keeps the edits and drops only the attribution when the author no longer exists', async () => {
    const store = new DocumentStore(prisma)

    await store.append(documentId, [
      { update: new Uint8Array([1]), clientId: 'conn-1', userId: 'usr_does_not_exist' },
      { update: new Uint8Array([2]), clientId: 'server', userId: null },
    ])

    const rows = await prisma.documentUpdate.findMany({
      where: { documentId },
      orderBy: { id: 'asc' },
      select: { clientId: true, userId: true },
    })
    expect(rows).toEqual([
      { clientId: 'conn-1', userId: null },
      { clientId: 'server', userId: null },
    ])
  })
})
