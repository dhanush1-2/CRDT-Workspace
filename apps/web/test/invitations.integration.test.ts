import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import {
  acceptPendingInvitations,
  createOrReplaceInvitation,
  listPendingInvitations,
  reissueInvitation,
  resolveInvite,
  revokeInvitation,
} from '../src/lib/invitations.js'
import { INVITE_TTL_MS } from '../src/lib/invite-token.js'

const RUN = Date.now().toString(36)
const email = (label: string) => `invite-${label}-${RUN}@example.com`
const tokenOf = (link: string) => link.slice('/invite/'.length)
const longAgo = () => new Date(Date.now() - INVITE_TTL_MS - 60_000)

let owner: { id: string }
let workspaceId: string
let otherWorkspaceId: string
let documentId: string
let documentPath: string

beforeAll(async () => {
  owner = await prisma.user.create({ data: { email: email('owner'), name: 'Olive' }, select: { id: true } })
  workspaceId = (await prisma.workspace.create({ data: { name: `invite-ws-${RUN}`, ownerId: owner.id } })).id
  otherWorkspaceId = (
    await prisma.workspace.create({ data: { name: `invite-other-${RUN}`, ownerId: owner.id } })
  ).id
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId, userId: owner.id, role: 'owner' },
      { workspaceId: otherWorkspaceId, userId: owner.id, role: 'owner' },
    ],
  })
  documentId = (await prisma.document.create({ data: { workspaceId, type: 'doc', title: 'Launch plan' } })).id
  documentPath = `/workspaces/${workspaceId}/documents/${documentId}`
})

afterAll(async () => {
  // Workspace.ownerId has no foreign key; workspaces go first, invitations with them.
  await prisma.workspace.deleteMany({ where: { name: { endsWith: `-${RUN}` } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${RUN}@example.com` } } })
  await prisma.$disconnect()
})

function makeUser(label: string) {
  return prisma.user.create({ data: { email: email(label), name: 'Invitee' }, select: { id: true, email: true } })
}

function invite(
  label: string,
  options: { role?: Role; documentId?: string | null; workspaceId?: string; now?: Date } = {},
) {
  return createOrReplaceInvitation({
    workspaceId: options.workspaceId ?? workspaceId,
    email: email(label),
    role: options.role ?? 'editor',
    documentId: options.documentId === undefined ? documentId : options.documentId,
    invitedById: owner.id,
    now: options.now,
  })
}

async function roleOf(userId: string, inWorkspace = workspaceId) {
  const row = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: inWorkspace, userId } },
    select: { role: true },
  })
  return row?.role ?? null
}

describe('createOrReplaceInvitation', () => {
  it('stores the email trimmed and lowercased, and only a hash of the token', async () => {
    const { invitation, link } = await createOrReplaceInvitation({
      workspaceId,
      email: `  ${email('case').toUpperCase()} `,
      role: 'viewer',
      documentId: null,
      invitedById: owner.id,
    })
    expect(invitation.email).toBe(email('case'))
    expect(link).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/)

    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })
    expect(row.email).toBe(email('case'))
    expect(row.tokenHash).toBe(createHash('sha256').update(tokenOf(link)).digest('hex'))
    // The token itself is nowhere in the row.
    expect(JSON.stringify(row)).not.toContain(tokenOf(link))
  })

  it('expires 14 days after it is made', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z')
    const { invitation } = await invite('ttl', { now })
    expect(invitation.expiresAt).toBe('2026-10-23T12:00:00.000Z')
    expect(invitation.expired).toBe(false)
  })

  it('replaces an earlier invitation for the same email: new link, role and expiry, old link dead', async () => {
    const first = await invite('again', { role: 'viewer' })
    const second = await createOrReplaceInvitation({
      workspaceId,
      email: email('again').toUpperCase(),
      role: 'owner',
      documentId: null,
      invitedById: owner.id,
    })

    expect(second.invitation.id).toBe(first.invitation.id)
    expect(second.link).not.toBe(first.link)
    expect(second.invitation.role).toBe('owner')
    expect(await prisma.invitation.count({ where: { workspaceId, email: email('again') } })).toBe(1)
    expect(await resolveInvite(tokenOf(first.link), null)).toEqual({ kind: 'invalid' })
    expect((await resolveInvite(tokenOf(second.link), null)).kind).toBe('sign-in')
  })
})

describe('resolveInvite', () => {
  it('treats malformed, unknown, expired and revoked tokens exactly alike', async () => {
    const expired = await invite('expired', { now: longAgo() })
    const revoked = await invite('revoked')
    expect(await revokeInvitation(workspaceId, revoked.invitation.id)).toBe(true)

    const tokens = ['', 'not-a-token', '../etc/passwd', 'A'.repeat(43), tokenOf(expired.link), tokenOf(revoked.link)]
    for (const token of tokens) {
      expect(await resolveInvite(token, null), token).toEqual({ kind: 'invalid' })
    }
  })

  it('shows a signed-out visitor who invited them, to what, and as whom', async () => {
    const { link } = await invite('summary', { role: 'viewer' })
    expect(await resolveInvite(tokenOf(link), null)).toEqual({
      kind: 'sign-in',
      invite: {
        email: email('summary'),
        role: 'viewer',
        inviterName: 'Olive',
        workspaceName: `invite-ws-${RUN}`,
        documentTitle: 'Launch plan',
      },
    })
  })

  it('tells someone signed in under another email who it is for, and accepts nothing', async () => {
    const { link, invitation } = await invite('mismatch')
    const other = await makeUser('someone-else')

    expect(await resolveInvite(tokenOf(link), other)).toEqual({
      kind: 'mismatch',
      invitedEmail: email('mismatch'),
      signedInEmail: other.email,
    })
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).acceptedAt).toBeNull()
    expect(await roleOf(other.id)).toBeNull()
  })

  it('accepts for the invited person and sends them to the document, with the invited role', async () => {
    const { link, invitation } = await invite('accept', { role: 'viewer' })
    const invitee = await makeUser('accept')

    expect(await resolveInvite(tokenOf(link), invitee)).toEqual({ kind: 'redirect', to: documentPath })
    expect(await roleOf(invitee.id)).toBe('viewer')
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).acceptedAt).not.toBeNull()

    // The same person opening it again is sent on, not told it is spent...
    expect(await resolveInvite(tokenOf(link), invitee)).toEqual({ kind: 'redirect', to: documentPath })
    // ...and nobody else learns it was ever used.
    expect(await resolveInvite(tokenOf(link), null)).toEqual({ kind: 'invalid' })
    expect(await resolveInvite(tokenOf(link), await makeUser('bystander'))).toEqual({ kind: 'invalid' })
  })

  it('matches the invited email whatever its capitalisation', async () => {
    const { link } = await invite('caps', { role: 'editor' })
    const invitee = await makeUser('caps')
    expect(
      await resolveInvite(tokenOf(link), { id: invitee.id, email: invitee.email.toUpperCase() }),
    ).toEqual({ kind: 'redirect', to: documentPath })
    expect(await roleOf(invitee.id)).toBe('editor')
  })

  it('never changes an existing member role, down or up', async () => {
    const editor = await makeUser('member-editor')
    const viewer = await makeUser('member-viewer')
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: editor.id, role: 'editor' },
        { workspaceId, userId: viewer.id, role: 'viewer' },
      ],
    })
    const down = await invite('member-editor', { role: 'viewer' })
    const up = await invite('member-viewer', { role: 'owner' })

    expect((await resolveInvite(tokenOf(down.link), editor)).kind).toBe('redirect')
    expect((await resolveInvite(tokenOf(up.link), viewer)).kind).toBe('redirect')
    expect(await roleOf(editor.id)).toBe('editor')
    expect(await roleOf(viewer.id)).toBe('viewer')
  })

  it('lands on the workspace when there is no document, or the document was deleted', async () => {
    const plain = await invite('nodoc', { documentId: null })
    expect(await resolveInvite(tokenOf(plain.link), await makeUser('nodoc'))).toEqual({
      kind: 'redirect',
      to: `/workspaces/${workspaceId}`,
    })

    const doomed = await prisma.document.create({ data: { workspaceId, type: 'board', title: 'Doomed' } })
    const gone = await invite('gone', { documentId: doomed.id })
    await prisma.document.delete({ where: { id: doomed.id } })
    expect(await resolveInvite(tokenOf(gone.link), await makeUser('gone'))).toEqual({
      kind: 'redirect',
      to: `/workspaces/${workspaceId}`,
    })
  })

  it('does not accept an expired invitation even for the person it was for', async () => {
    const late = await invite('late', { now: longAgo() })
    const invitee = await makeUser('late')
    expect(await resolveInvite(tokenOf(late.link), invitee)).toEqual({ kind: 'invalid' })
    expect(await roleOf(invitee.id)).toBeNull()
  })
})

describe('reissueInvitation', () => {
  it('makes a new link, resets the expiry, and retires the old link', async () => {
    const now = new Date()
    const first = await invite('reissue', { now: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) })
    const again = await reissueInvitation(workspaceId, first.invitation.id, now)

    expect(again).not.toBeNull()
    expect(again!.link).not.toBe(first.link)
    expect(again!.invitation.id).toBe(first.invitation.id)
    expect(again!.invitation.expiresAt).toBe(new Date(now.getTime() + INVITE_TTL_MS).toISOString())
    expect(await resolveInvite(tokenOf(first.link), null)).toEqual({ kind: 'invalid' })
    expect((await resolveInvite(tokenOf(again!.link), null)).kind).toBe('sign-in')
  })

  it('refuses an invitation from another workspace, and one already accepted', async () => {
    const mine = await invite('reissue-scope')
    expect(await reissueInvitation(otherWorkspaceId, mine.invitation.id)).toBeNull()
    expect((await resolveInvite(tokenOf(mine.link), null)).kind).toBe('sign-in')

    const used = await invite('reissue-used')
    await resolveInvite(tokenOf(used.link), await makeUser('reissue-used'))
    expect(await reissueInvitation(workspaceId, used.invitation.id)).toBeNull()
  })
})

describe('revokeInvitation', () => {
  it('deletes the invitation so its link finds nothing; another workspace cannot', async () => {
    const target = await invite('revoke-scope')
    expect(await revokeInvitation(otherWorkspaceId, target.invitation.id)).toBe(false)
    expect((await resolveInvite(tokenOf(target.link), null)).kind).toBe('sign-in')

    expect(await revokeInvitation(workspaceId, target.invitation.id)).toBe(true)
    expect(await prisma.invitation.findUnique({ where: { id: target.invitation.id } })).toBeNull()
    expect(await resolveInvite(tokenOf(target.link), null)).toEqual({ kind: 'invalid' })
  })
})

describe('listPendingInvitations', () => {
  it('lists pending invitations oldest first, marks expired ones, leaves out accepted ones, and carries no token', async () => {
    // A workspace of its own, so other tests' invitations cannot appear here.
    const listWorkspaceId = (
      await prisma.workspace.create({ data: { name: `invite-list-${RUN}`, ownerId: owner.id } })
    ).id
    await invite('list-pending', { workspaceId: listWorkspaceId, documentId: null })
    await invite('list-stale', { workspaceId: listWorkspaceId, documentId: null, now: longAgo() })
    const used = await invite('list-used', { workspaceId: listWorkspaceId, documentId: null })
    await resolveInvite(tokenOf(used.link), await makeUser('list-used'))

    const list = await listPendingInvitations(listWorkspaceId)
    expect(list.map((i) => [i.email, i.expired])).toEqual([
      [email('list-pending'), false],
      [email('list-stale'), true],
    ])
    expect(Object.keys(list[0]!).sort()).toEqual(['email', 'expired', 'expiresAt', 'id', 'role'])
  })
})

describe('acceptPendingInvitations', () => {
  it('accepts every pending invitation for the email, skips expired ones, and keeps existing roles', async () => {
    const person = await makeUser('sweep')
    const make = async (suffix: string) =>
      (await prisma.workspace.create({ data: { name: `invite-sweep-${suffix}-${RUN}`, ownerId: owner.id } })).id
    const a = await make('a')
    const b = await make('b')
    const c = await make('c')
    await prisma.workspaceMember.create({ data: { workspaceId: a, userId: person.id, role: 'owner' } })
    const base = { email: person.email.toUpperCase(), documentId: null, invitedById: owner.id }
    await createOrReplaceInvitation({ ...base, workspaceId: a, role: 'viewer' })
    await createOrReplaceInvitation({ ...base, workspaceId: b, role: 'editor' })
    const stale = await createOrReplaceInvitation({ ...base, workspaceId: c, role: 'editor', now: longAgo() })

    expect(await acceptPendingInvitations(person.id)).toBe(2)
    expect(await roleOf(person.id, a)).toBe('owner')
    expect(await roleOf(person.id, b)).toBe('editor')
    expect(await roleOf(person.id, c)).toBeNull()
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: stale.invitation.id } })).acceptedAt).toBeNull()

    // Nothing left to accept.
    expect(await acceptPendingInvitations(person.id)).toBe(0)
  })
})
