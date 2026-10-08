import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { cookies } from 'next/headers'
import { prisma } from '@crdt/db'
import { PATCH } from '../src/app/api/documents/[id]/route.js'
import { signSession, SESSION_COOKIE } from '../src/lib/session.js'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

let ownerId: string
let editorId: string
let viewerId: string
let strangerId: string
let documentId: string

beforeAll(async () => {
  // A crashed earlier run must not break this one. startsWith, not contains: the e2e
  // suite's users are named e2e-rename-..., and must survive a Vitest run beside it.
  await prisma.workspace.deleteMany({ where: { name: 'rename-ws' } })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'rename-' } } })
  const make = (email: string) =>
    prisma.user.create({ data: { email, name: email, passwordHash: 'x' }, select: { id: true } })
  ownerId = (await make('rename-owner@example.com')).id
  editorId = (await make('rename-editor@example.com')).id
  viewerId = (await make('rename-viewer@example.com')).id
  strangerId = (await make('rename-stranger@example.com')).id
  const workspace = await prisma.workspace.create({ data: { name: 'rename-ws', ownerId } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspace.id, userId: ownerId, role: 'owner' },
      { workspaceId: workspace.id, userId: editorId, role: 'editor' },
      { workspaceId: workspace.id, userId: viewerId, role: 'viewer' },
    ],
  })
  documentId = (await prisma.document.create({ data: { workspaceId: workspace.id, type: 'doc', title: 'Before' } })).id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: 'rename-ws' } })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'rename-' } } })
  await prisma.$disconnect()
})

async function patchAs(userId: string | null, id: string, body: unknown) {
  const token = userId ? await signSession(userId, process.env.SESSION_SECRET!) : null
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (token && name === SESSION_COOKIE ? { value: token } : undefined),
  } as never)
  const request = new Request('http://localhost/api', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ id }) })
}

const titleNow = async () => (await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).title

describe('PATCH /api/documents/[id]', () => {
  it('lets an editor rename, trimming the title', async () => {
    const response = await patchAs(editorId, documentId, { title: '  Plans  ' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: documentId, title: 'Plans' })
    expect(await titleNow()).toBe('Plans')
  })

  it('lets an owner rename', async () => {
    expect((await patchAs(ownerId, documentId, { title: 'Owner title' })).status).toBe(200)
    expect(await titleNow()).toBe('Owner title')
  })

  it('refuses a viewer with 403 and changes nothing', async () => {
    const before = await titleNow()
    expect((await patchAs(viewerId, documentId, { title: 'Nope' })).status).toBe(403)
    expect(await titleNow()).toBe(before)
  })

  it('hides the document from a non-member with 404', async () => {
    expect((await patchAs(strangerId, documentId, { title: 'Nope' })).status).toBe(404)
  })

  it('is 401 signed out', async () => {
    expect((await patchAs(null, documentId, { title: 'Nope' })).status).toBe(401)
  })

  it('is 404 for a document that does not exist', async () => {
    expect((await patchAs(ownerId, 'does-not-exist', { title: 'x' })).status).toBe(404)
  })

  it('rejects an empty, whitespace-only, too long or missing title with 400', async () => {
    const before = await titleNow()
    for (const body of [{ title: '' }, { title: '   ' }, { title: 'x'.repeat(201) }, {}, null]) {
      expect((await patchAs(ownerId, documentId, body)).status, JSON.stringify(body)).toBe(400)
    }
    expect(await titleNow()).toBe(before)
  })
})
