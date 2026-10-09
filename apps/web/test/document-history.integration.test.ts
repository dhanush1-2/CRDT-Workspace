import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { prisma } from '@crdt/db'
import { listVersions, stateAtVersion, VersionTooLargeError, STATE_REPLAY_MAX_ROWS } from '../src/lib/document-history.js'

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
  let gapDocumentId: string
  let gapIds: bigint[]
  let workspaceId: string
  let alice: { id: string; name: string }
  let bob: { id: string; name: string }
  let ids: bigint[]
  let yjsUpdates: Uint8Array[]

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
    const updates: Uint8Array[] = (yjsUpdates = [])
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
    // Two anonymous rows a minute apart: only `IS NOT DISTINCT FROM` treats them as one
    // author. With `=` the comparison is null, every anonymous row starts a version.
    ids.push((await appendUpdate(documentId, new Uint8Array(updates[0]!), null, at(90))).id)
    ids.push((await appendUpdate(documentId, new Uint8Array(updates[0]!), null, at(91))).id)

    // A second document where the SAME author is adjacent to themselves across gaps, so
    // the time window is the only thing that can split them. (In the first document the
    // late row follows a different author, so the author clause alone would split it.)
    // 0 -> 5 minutes is exactly the window and stays one version; 5 -> 11 exceeds it.
    gapDocumentId = (
      await prisma.document.create({
        data: { workspaceId: workspace.id, type: 'doc', title: `${LABEL}-gap` },
      })
    ).id
    gapIds = []
    for (const minutes of [0, 5, 11]) {
      gapIds.push((await appendUpdate(gapDocumentId, updates[0]!, alice.id, at(minutes))).id)
    }
  })

  afterAll(async () => {
    await cleanUp()
  })

  it('collapses a run of one author\'s updates into one version', async () => {
    const versions = await listVersions(documentId)

    // Five rows, three versions: Alice's two adjacent updates are one editing run, and
    // the two anonymous updates a minute apart are another.
    expect(versions).toHaveLength(3)
    expect(versions.map((version) => version.updateCount)).toEqual([2, 1, 2])
  })

  it('returns versions newest first, with the author and the run\'s span', async () => {
    const versions = await listVersions(documentId)

    expect(versions[0]!.author).toBeNull()
    expect(versions[0]!.id).toBe(String(ids[4]))
    expect(versions[1]!.author).toEqual({ id: bob.id, name: 'Bob' })
    expect(versions[2]!.author).toEqual({ id: alice.id, name: 'Alice' })

    // The version's id is the highest update id in its run: the point you restore to.
    expect(versions[2]!.id).toBe(String(ids[1]))
    expect(versions[2]!.startedAt.toISOString()).toBe('2026-10-01T10:00:00.000Z')
    expect(versions[2]!.endedAt.toISOString()).toBe('2026-10-01T10:01:00.000Z')
  })

  it('splits a run when the same author returns after more than the window', async () => {
    const versions = await listVersions(gapDocumentId)

    // 0 and 5 minutes (exactly the window) are one version; 11 minutes is 6 after the
    // previous row, so it starts another. Both neighbours share an author, so only the
    // time window can make this split.
    expect(versions.map((version) => version.updateCount)).toEqual([1, 2])
    expect(versions[0]!.id).toBe(String(gapIds[2]))
    expect(versions[1]!.id).toBe(String(gapIds[1]))
  })

  it('refuses to replay more rows than the cap, counting only rows up to the version', async () => {
    expect(STATE_REPLAY_MAX_ROWS).toBe(20_000)

    // The document has five rows. A cap of four is exceeded by the full log...
    await expect(stateAtVersion(documentId, ids[4]!, 4)).rejects.toBeInstanceOf(VersionTooLargeError)
    // ...exactly at the cap is allowed...
    expect(await stateAtVersion(documentId, ids[4]!, 5)).not.toBeNull()
    // ...and an early version of the same document is judged by its own row count (2),
    // not the whole log's.
    expect(await stateAtVersion(documentId, ids[1]!, 2)).not.toBeNull()
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

  describe('with a snapshot', () => {
    const text = (state: Uint8Array | null) => {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, state!)
      return doc.getText('t').toString()
    }

    // A fresh document with the three updates, and a snapshot of the state after the
    // first `through` of them, recorded as covering up to that update's id.
    async function documentWithSnapshot(title: string, through: 1 | 2 | 3) {
      const document = await prisma.document.create({
        data: { workspaceId, type: 'doc', title: `${LABEL}-${title}` },
      })
      const rowIds: bigint[] = []
      for (const [index, update] of yjsUpdates.entries()) {
        rowIds.push((await appendUpdate(document.id, update, alice.id, new Date(index * 1000))).id)
      }
      const state = Y.mergeUpdates(yjsUpdates.slice(0, through))
      await prisma.documentSnapshot.create({
        data: { documentId: document.id, state: Buffer.from(state), throughUpdateId: rowIds[through - 1]! },
      })
      return { documentId: document.id, rowIds }
    }

    it('ignores a snapshot that covers more than the requested version', async () => {
      const { documentId: id, rowIds } = await documentWithSnapshot('snap-ahead', 3)

      // The snapshot holds all three inserts; version 1 must not leak the other two.
      expect(text(await stateAtVersion(id, rowIds[0]!))).toBe('one ')
      expect(text(await stateAtVersion(id, rowIds[2]!))).toBe('one two three')
    })

    it('ignores a snapshot whose content runs ahead of its throughUpdateId', async () => {
      // How the sync server really writes them: the snapshot encodes the live doc, which
      // already holds edits still queued for persistence, while throughUpdateId is only
      // the last row that reached the table. Those queued edits become rows after it.
      const document = await prisma.document.create({
        data: { workspaceId, type: 'doc', title: `${LABEL}-snap-lagging` },
      })
      const rowIds: bigint[] = []
      for (const [index, update] of yjsUpdates.entries()) {
        rowIds.push((await appendUpdate(document.id, update, alice.id, new Date(index * 1000))).id)
      }
      await prisma.documentSnapshot.create({
        data: {
          documentId: document.id,
          state: Buffer.from(Y.mergeUpdates(yjsUpdates)), // includes the third insert
          throughUpdateId: rowIds[1]!, // but claims to cover only through the second
        },
      })

      // Version 2 must be exactly the first two inserts; "three" came later.
      expect(text(await stateAtVersion(document.id, rowIds[1]!))).toBe('one two ')
      expect(text(await stateAtVersion(document.id, rowIds[2]!))).toBe('one two three')
    })
  })

  it('splits at every boundary between a known author and an anonymous one', async () => {
    // Alice, then anonymous a minute later, then Alice a minute after that. Time alone
    // would merge all three; only the author comparison can split them, in both
    // directions (known -> null, and null -> known).
    const document = await prisma.document.create({
      data: { workspaceId, type: 'doc', title: `${LABEL}-null-adjacency` },
    })
    const rowIds: bigint[] = []
    const authors = [alice.id, null, alice.id]
    for (const [index, userId] of authors.entries()) {
      rowIds.push((await appendUpdate(document.id, yjsUpdates[0]!, userId, new Date(index * 60_000))).id)
    }

    const versions = await listVersions(document.id)
    expect(versions.map((version) => version.updateCount)).toEqual([1, 1, 1])
    expect(versions.map((version) => version.author?.id ?? null)).toEqual([alice.id, null, alice.id])
  })
})
