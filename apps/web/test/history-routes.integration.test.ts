import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as Y from 'yjs'
import { cookies } from 'next/headers'
import { prisma } from '@crdt/db'
import { GET as listHistory } from '../src/app/api/documents/[id]/history/route.js'
import { GET as readVersion } from '../src/app/api/documents/[id]/history/[version]/route.js'
import { signSession, SESSION_COOKIE } from '../src/lib/session.js'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

// The replay cap is 20,000 rows, too many to seed. Rather than add a test-only switch to
// production code, this wraps the real stateAtVersion and passes the cap the optional
// parameter already accepts. Everything else in the module (and the error class the
// route's instanceof check uses) is the real one.
const replay = vi.hoisted(() => ({ cap: undefined as number | undefined }))
vi.mock('../src/lib/document-history.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/document-history.js')>()
  return {
    ...actual,
    stateAtVersion: (documentId: string, versionId: bigint) =>
      actual.stateAtVersion(documentId, versionId, replay.cap),
  }
})

// Unique prefix, matched with startsWith: the history library suite uses
// `history-integration-...` and the e2e suite `...@e2e.test`; neither may be hit.
const PREFIX = 'history-routes'
const WORKSPACE = `${PREFIX}-ws`
const email = (who: string) => `${PREFIX}-${who}@test.local`
const EMAILS = ['owner', 'viewer', 'stranger'].map(email)

let ownerId: string
let viewerId: string
let strangerId: string
let documentId: string
let otherDocumentId: string
let ownIds: bigint[]
let foreignId: bigint
let pastTheEnd: bigint

async function cleanUp() {
  await prisma.workspace.deleteMany({ where: { name: WORKSPACE } })
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } })
}

async function appendUpdate(docId: string, update: Uint8Array, userId: string | null, createdAt: Date) {
  return prisma.documentUpdate.create({
    data: { documentId: docId, update: Buffer.from(update), clientId: 'test', userId, createdAt },
    select: { id: true },
  })
}

function updatesFor(texts: string[]): Uint8Array[] {
  const doc = new Y.Doc()
  const out: Uint8Array[] = []
  doc.on('update', (u: Uint8Array) => out.push(u))
  let at = 0
  for (const text of texts) {
    doc.getText('t').insert(at, text)
    at += text.length
  }
  return out
}

beforeAll(async () => {
  await cleanUp()
  const make = (who: string) =>
    prisma.user.create({ data: { email: email(who), name: who, passwordHash: 'x' }, select: { id: true } })
  ownerId = (await make('owner')).id
  viewerId = (await make('viewer')).id
  strangerId = (await make('stranger')).id
  const workspace = await prisma.workspace.create({ data: { name: WORKSPACE, ownerId } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspace.id, userId: ownerId, role: 'owner' },
      { workspaceId: workspace.id, userId: viewerId, role: 'viewer' },
    ],
  })
  documentId = (await prisma.document.create({ data: { workspaceId: workspace.id, type: 'doc', title: 'A' } })).id
  otherDocumentId = (await prisma.document.create({ data: { workspaceId: workspace.id, type: 'doc', title: 'B' } })).id

  // Document A: three updates, two authors' worth of spacing so there are two versions
  // (owner, then after a long gap, owner again). Document B interleaves between them so
  // A's ids have a hole that belongs to B.
  const base = new Date('2026-10-01T10:00:00.000Z')
  const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000)
  const [a0, a1, a2] = updatesFor(['one ', 'two ', 'three']) as [Uint8Array, Uint8Array, Uint8Array]
  const [b0] = updatesFor(['alien']) as [Uint8Array]
  ownIds = []
  ownIds.push((await appendUpdate(documentId, a0, ownerId, at(0))).id)
  foreignId = (await appendUpdate(otherDocumentId, b0, ownerId, at(1))).id
  ownIds.push((await appendUpdate(documentId, a1, ownerId, at(2))).id)
  ownIds.push((await appendUpdate(documentId, a2, ownerId, at(60))).id)

  const max = await prisma.documentUpdate.aggregate({ _max: { id: true } })
  pastTheEnd = (max._max.id ?? 0n) + 1_000_000n
})

afterAll(async () => {
  await cleanUp()
  await prisma.$disconnect()
})

function signedIn(userId: string | null) {
  return (async () => {
    const token = userId ? await signSession(userId, process.env.SESSION_SECRET!) : null
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => (token && name === SESSION_COOKIE ? { value: token } : undefined),
    } as never)
  })()
}

async function list(userId: string | null, id: string, query = '') {
  await signedIn(userId)
  return listHistory(new Request(`http://localhost/api/documents/${id}/history${query}`), {
    params: Promise.resolve({ id }),
  })
}

async function read(userId: string | null, id: string, version: string) {
  await signedIn(userId)
  return readVersion(new Request(`http://localhost/api/documents/${id}/history/${version}`), {
    params: Promise.resolve({ id, version }),
  })
}

describe('GET /api/documents/[id]/history', () => {
  it('lets a viewer list versions, newest first', async () => {
    const response = await list(viewerId, documentId)
    expect(response.status).toBe(200)
    const { versions } = await response.json()
    expect(versions.map((v: { id: string }) => v.id)).toEqual([String(ownIds[2]), String(ownIds[1])])
    expect(versions[1].updateCount).toBe(2)
  })

  it('returns ids as strings, not numbers', async () => {
    const { versions } = await (await list(ownerId, documentId)).json()
    expect(versions.length).toBeGreaterThan(0)
    for (const version of versions) expect(typeof version.id).toBe('string')
  })

  it('hides the document from a non-member with 404, not 403', async () => {
    expect((await list(strangerId, documentId)).status).toBe(404)
  })

  it('is 404 for a document that does not exist', async () => {
    expect((await list(ownerId, 'does-not-exist')).status).toBe(404)
  })

  it('is 401 signed out', async () => {
    expect((await list(null, documentId)).status).toBe(401)
  })

  it('honours a limit and rejects an out-of-range or non-numeric one with 400', async () => {
    const { versions } = await (await list(ownerId, documentId, '?limit=1')).json()
    expect(versions).toHaveLength(1)
    for (const query of ['?limit=0', '?limit=201', '?limit=1.5', '?limit=abc', '?limit=-1']) {
      expect((await list(ownerId, documentId, query)).status, query).toBe(400)
    }
    expect((await list(ownerId, documentId, '?limit=200')).status).toBe(200)
  })
})

describe('GET /api/documents/[id]/history/[version]', () => {
  it('lets a viewer read the state at a version as raw bytes', async () => {
    const response = await read(viewerId, documentId, String(ownIds[1]))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength))
    const doc = new Y.Doc()
    Y.applyUpdate(doc, bytes)
    expect(doc.getText('t').toString()).toBe('one two ')
  })

  it('gives the later state at the later version', async () => {
    const bytes = new Uint8Array(await (await read(viewerId, documentId, String(ownIds[2]))).arrayBuffer())
    const doc = new Y.Doc()
    Y.applyUpdate(doc, bytes)
    expect(doc.getText('t').toString()).toBe('one two three')
  })

  it('hides the document from a non-member with 404, not 403', async () => {
    expect((await read(strangerId, documentId, String(ownIds[0]))).status).toBe(404)
  })

  it('is 401 signed out', async () => {
    expect((await read(null, documentId, String(ownIds[0]))).status).toBe(401)
  })

  it('rejects a version that is not a plain non-negative integer with 400', async () => {
    for (const version of ['abc', '1.5', '1e3', '', ' 7', '0x10', '-1', '+1']) {
      expect((await read(ownerId, documentId, version)).status, JSON.stringify(version)).toBe(400)
    }
  })

  it('is 413 when the version would replay more rows than the cap, and 200 once under it', async () => {
    replay.cap = 2
    try {
      // ownIds[2] is the third row of the document: over a cap of 2.
      const response = await read(viewerId, documentId, String(ownIds[2]))
      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({ error: 'too large to preview' })
      expect(response.headers.get('cache-control') ?? '').not.toContain('immutable')

      // The second row replays exactly two rows: at the cap, so allowed.
      expect((await read(viewerId, documentId, String(ownIds[1]))).status).toBe(200)
    } finally {
      replay.cap = undefined
    }
  })

  it('is 404 for a version id that belongs to a different document', async () => {
    // foreignId sits between A's first and second rows. Replaying A up to it would
    // succeed with A's content, so only an explicit ownership check gives 404.
    const response = await read(ownerId, documentId, String(foreignId))
    expect(response.status).toBe(404)
  })

  it('is 404 for a version id past the end', async () => {
    expect((await read(ownerId, documentId, String(pastTheEnd))).status).toBe(404)
  })

  it('is 404, not 500, for an id too large for the database column', async () => {
    expect((await read(ownerId, documentId, '9'.repeat(30))).status).toBe(404)
  })
})
