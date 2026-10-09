import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { prisma } from '@crdt/db'
import { listVersions, stateAtVersion } from '../src/lib/document-history.js'

const LABEL = 'history-integration'

// Rows are inserted with explicit createdAt values so the grouping window is
// exercised deterministically rather than depending on how fast the test runs.
async function appendUpdate(
  documentId: string,
  update: Uint8Array,
  userId: string | null,
  createdAt: Date,
) {
  return prisma.documentUpdate.create({
    data: { documentId, update: Buffer.from(update), clientId: 'test', userId, createdAt },
    select: { id: true },
  })
}

// Cleans by exact label, so it is safe to call before (a crashed earlier run) and after.
async function cleanUp() {
  await prisma.workspace.deleteMany({ where: { name: LABEL } })
  await prisma.user.deleteMany({
    where: { email: { in: [`${LABEL}-alice@test.local`, `${LABEL}-bob@test.local`] } },
  })
}

describe('document history', () => {
  let documentId: string
  let workspaceId: string
  let alice: { id: string; name: string }
  let bob: { id: string; name: string }
  let ids: bigint[]

  beforeAll(async () => {
    await cleanUp()
    alice = await prisma.user.create({
      data: { email: `${LABEL}-alice@test.local`, name: 'Alice' },
      select: { id: true, name: true },
    })
    bob = await prisma.user.create({
      data: { email: `${LABEL}-bob@test.local`, name: 'Bob' },
      select: { id: true, name: true },
    })
    const workspace = await prisma.workspace.create({
      data: { name: LABEL, ownerId: alice.id },
    })
    workspaceId = workspace.id
    const document = await prisma.document.create({
      data: { workspaceId: workspace.id, type: 'doc', title: LABEL },
    })
    documentId = document.id

    // Three real Yjs updates on one text type, so the state at each point is
    // checkable rather than opaque bytes.
    const doc = new Y.Doc()
    const updates: Uint8Array[] = []
    doc.on('update', (update: Uint8Array) => updates.push(update))
    doc.getText('t').insert(0, 'one ')
    doc.getText('t').insert(4, 'two ')
    doc.getText('t').insert(8, 'three')

    const base = new Date('2026-10-01T10:00:00.000Z')
    const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000)
    ids = []
    // Alice twice within the window, then Bob, then Alice again after a long gap.
    ids.push((await appendUpdate(documentId, updates[0]!, alice.id, at(0))).id)
    ids.push((await appendUpdate(documentId, updates[1]!, alice.id, at(1))).id)
    ids.push((await appendUpdate(documentId, updates[2]!, bob.id, at(2))).id)
    ids.push((await appendUpdate(documentId, new Uint8Array(updates[0]!), null, at(90))).id)
  })

  afterAll(async () => {
    await cleanUp()
  })

  it('collapses a run of one author\'s updates into one version', async () => {
    const versions = await listVersions(documentId)

    // Four rows, three versions: Alice's two adjacent updates are one editing run.
    expect(versions).toHaveLength(3)
    expect(versions.map((version) => version.updateCount)).toEqual([1, 1, 2])
  })

  it('returns versions newest first, with the author and the run\'s span', async () => {
    const versions = await listVersions(documentId)

    expect(versions[0]!.author).toBeNull()
    expect(versions[1]!.author).toEqual({ id: bob.id, name: 'Bob' })
    expect(versions[2]!.author).toEqual({ id: alice.id, name: 'Alice' })

    // The version's id is the highest update id in its run: the point you restore to.
    expect(versions[2]!.id).toBe(String(ids[1]))
    expect(versions[2]!.startedAt.toISOString()).toBe('2026-10-01T10:00:00.000Z')
    expect(versions[2]!.endedAt.toISOString()).toBe('2026-10-01T10:01:00.000Z')
  })

  it('splits a run when the same author returns after a long gap', async () => {
    const versions = await listVersions(documentId)
    // The last row is 88 minutes after the one before it. Same-author adjacency is
    // not enough; without the time window this would merge into Bob's neighbour or
    // Alice's first run depending on order.
    expect(versions[0]!.id).toBe(String(ids[3]))
    expect(versions[0]!.updateCount).toBe(1)
  })

  it('serves the document state as it was at a version', async () => {
    const atSecond = await stateAtVersion(documentId, ids[1]!)
    expect(atSecond).not.toBeNull()

    const doc = new Y.Doc()
    Y.applyUpdate(doc, atSecond!)
    // Two of the three inserts had happened.
    expect(doc.getText('t').toString()).toBe('one two ')

    const atThird = await stateAtVersion(documentId, ids[2]!)
    const later = new Y.Doc()
    Y.applyUpdate(later, atThird!)
    expect(later.getText('t').toString()).toBe('one two three')
  })

  it('is null for a document with no updates and for a version before any', async () => {
    const empty = await prisma.document.create({
      data: { workspaceId, type: 'doc', title: `${LABEL}-empty` },
    })
    expect(await listVersions(empty.id)).toEqual([])
    expect(await stateAtVersion(empty.id, 1n)).toBeNull()
    expect(await stateAtVersion(documentId, 0n)).toBeNull()
  })
})
