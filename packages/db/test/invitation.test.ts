import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '../src/index.js'

// A per-run suffix keeps emails, hashes and names unique, so a crashed earlier run
// that skipped cleanup cannot make this one fail on a unique constraint.
const RUN = Date.now().toString(36)
const email = (label: string) => `invitation-schema-${label}-${RUN}@example.com`
const hash = (label: string) => `hash-${label}-${RUN}`
const later = () => new Date(Date.now() + 60_000)

let inviterId: string
let workspaceId: string

beforeAll(async () => {
  inviterId = (await prisma.user.create({ data: { email: email('inviter'), name: 'Inviter' } })).id
  workspaceId = (
    await prisma.workspace.create({ data: { name: `invitation-schema-${RUN}`, ownerId: inviterId } })
  ).id
})

afterAll(async () => {
  // Workspace.ownerId has no foreign key, so deleting users does not remove workspaces.
  await prisma.workspace.deleteMany({
    where: { name: { startsWith: 'invitation-schema-', endsWith: RUN } },
  })
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${RUN}@example.com` } } })
  await prisma.$disconnect()
})

describe('Invitation', () => {
  it('stores a pending invitation with a role and an optional document', async () => {
    const document = await prisma.document.create({
      data: { workspaceId, type: 'doc', title: 'Invited' },
    })
    const row = await prisma.invitation.create({
      data: {
        workspaceId,
        email: email('pending'),
        role: 'viewer',
        documentId: document.id,
        invitedById: inviterId,
        tokenHash: hash('pending'),
        expiresAt: later(),
      },
    })
    expect(row.acceptedAt).toBeNull()
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.role).toBe('viewer')
  })

  it('allows one invitation per email per workspace', async () => {
    await prisma.invitation.create({
      data: { workspaceId, email: email('once'), role: 'editor', tokenHash: hash('once-a'), expiresAt: later() },
    })
    await expect(
      prisma.invitation.create({
        data: { workspaceId, email: email('once'), role: 'viewer', tokenHash: hash('once-b'), expiresAt: later() },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('never lets two invitations share a token hash, even across workspaces', async () => {
    const other = await prisma.workspace.create({
      data: { name: `invitation-schema-other-${RUN}`, ownerId: inviterId },
    })
    await prisma.invitation.create({
      data: { workspaceId, email: email('hash-a'), role: 'editor', tokenHash: hash('shared'), expiresAt: later() },
    })
    await expect(
      prisma.invitation.create({
        data: {
          workspaceId: other.id,
          email: email('hash-b'),
          role: 'editor',
          tokenHash: hash('shared'),
          expiresAt: later(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('outlives its document and its inviter, and goes with its workspace', async () => {
    const inviter = await prisma.user.create({ data: { email: email('leaver'), name: 'Leaver' } })
    const ws = await prisma.workspace.create({
      data: { name: `invitation-schema-cascade-${RUN}`, ownerId: inviter.id },
    })
    const document = await prisma.document.create({
      data: { workspaceId: ws.id, type: 'board', title: 'Doomed' },
    })
    const row = await prisma.invitation.create({
      data: {
        workspaceId: ws.id,
        email: email('orphan'),
        role: 'viewer',
        documentId: document.id,
        invitedById: inviter.id,
        tokenHash: hash('orphan'),
        expiresAt: later(),
      },
    })

    // SetNull, not Cascade: the invitation still works, landing on the workspace and
    // naming no inviter.
    await prisma.document.delete({ where: { id: document.id } })
    await prisma.user.delete({ where: { id: inviter.id } })
    const after = await prisma.invitation.findUnique({ where: { id: row.id } })
    expect(after).not.toBeNull()
    expect(after!.documentId).toBeNull()
    expect(after!.invitedById).toBeNull()

    await prisma.workspace.delete({ where: { id: ws.id } })
    expect(await prisma.invitation.findUnique({ where: { id: row.id } })).toBeNull()
  })
})
