import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import {
  INVITE_TTL_MS,
  hashInviteToken,
  inviteLink,
  isWellFormedInviteToken,
  newInviteToken,
  normalizeEmail,
} from './invite-token.js'
import type { InvitationLinkResult, InvitationView } from './members.js'
import { documentHref } from './routes.js'

// Relative imports only, never the '@/' alias: e2e/fixtures.ts imports this file, and
// Playwright does not resolve the app's alias.

/** For any response that carries a token or lists invitations. */
export const NO_STORE = { 'cache-control': 'no-store' } as const

const VIEW_SELECT = { id: true, email: true, role: true, expiresAt: true } as const

function toView(
  row: { id: string; email: string; role: Role; expiresAt: Date },
  now: Date,
): InvitationView {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() <= now.getTime(),
  }
}

const expiryFrom = (now: Date) => new Date(now.getTime() + INVITE_TTL_MS)

/**
 * Stores a pending invitation for an email with no account, or replaces the one that
 * email already has in this workspace: new token, role, document, inviter and expiry,
 * and not accepted. The token's hash changes, so the old link stops working.
 *
 * Resetting `acceptedAt` re-opens a used invitation. That is deliberate: this is only
 * called for an email with no account, so inviting it again means the owner wants it
 * to work again.
 */
export async function createOrReplaceInvitation(input: {
  workspaceId: string
  email: string
  role: Role
  documentId: string | null
  invitedById: string
  now?: Date
}): Promise<InvitationLinkResult> {
  const now = input.now ?? new Date()
  const email = normalizeEmail(input.email)
  const { token, tokenHash } = newInviteToken()
  const fields = {
    role: input.role,
    documentId: input.documentId,
    invitedById: input.invitedById,
    tokenHash,
    expiresAt: expiryFrom(now),
    acceptedAt: null,
  }
  const row = await prisma.invitation.upsert({
    where: { workspaceId_email: { workspaceId: input.workspaceId, email } },
    create: { workspaceId: input.workspaceId, email, ...fields },
    update: fields,
    select: VIEW_SELECT,
  })
  return { invitation: toView(row, now), link: inviteLink(token) }
}

/**
 * Copy link: a fresh token for a pending invitation, with the expiry reset. Only a hash
 * is stored, so the old link cannot be shown again; it stops working instead (the plan's
 * Copy-link decision). Null when this is not a pending invitation of this workspace.
 */
export async function reissueInvitation(
  workspaceId: string,
  invitationId: string,
  now = new Date(),
): Promise<InvitationLinkResult | null> {
  const { token, tokenHash } = newInviteToken()
  const [row] = await prisma.invitation.updateManyAndReturn({
    // Scoped by workspace, so an owner elsewhere cannot re-issue it by id.
    where: { id: invitationId, workspaceId, acceptedAt: null },
    data: { tokenHash, expiresAt: expiryFrom(now) },
    select: VIEW_SELECT,
  })
  return row ? { invitation: toView(row, now), link: inviteLink(token) } : null
}

/** Revoke: delete it, so its link finds nothing. False when there was no such pending invitation here. */
export async function revokeInvitation(workspaceId: string, invitationId: string): Promise<boolean> {
  const { count } = await prisma.invitation.deleteMany({
    where: { id: invitationId, workspaceId, acceptedAt: null },
  })
  return count > 0
}

/** Pending invitations, oldest first. Expired ones are included and marked: Copy link revives them. */
export async function listPendingInvitations(workspaceId: string, now = new Date()): Promise<InvitationView[]> {
  const rows = await prisma.invitation.findMany({
    where: { workspaceId, acceptedAt: null },
    // id breaks a tie, so two invitations made in the same millisecond list in a fixed order.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: VIEW_SELECT,
  })
  return rows.map((row) => toView(row, now))
}

/**
 * Accepts one invitation for `userId`, atomically. It is marked used only if it is
 * still pending and unexpired (and, from the invite page, still carries this token: a
 * re-issue or a revoke in between wins). Then the membership is inserted with ON
 * CONFLICT DO NOTHING, so someone who is already a member keeps their role. An invite
 * never changes a role, up or down.
 *
 * Exported for the integration test, which changes the row underneath it.
 */
export async function acceptOne(
  match: { id: string; tokenHash?: string },
  userId: string,
  now: Date,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.invitation.updateManyAndReturn({
      where: { ...match, acceptedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
      select: { workspaceId: true, role: true },
    })
    if (!row) return false
    await tx.workspaceMember.createMany({
      data: [{ workspaceId: row.workspaceId, userId, role: row.role }],
      skipDuplicates: true,
    })
    return true
  })
}

/**
 * Accepts every pending, unexpired invitation for the user's email, on sign-in. The
 * email is the one stored on the user, which a provider verified when the account was
 * made, and the same one the invite page compares. Returns how many were accepted.
 */
export async function acceptPendingInvitations(userId: string, now = new Date()): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user) return 0
  const pending = await prisma.invitation.findMany({
    where: { email: normalizeEmail(user.email), acceptedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  })
  let accepted = 0
  for (const { id } of pending) {
    if (await acceptOne({ id }, userId, now)) accepted += 1
  }
  return accepted
}

export type InviteSummary = {
  email: string
  role: Role
  inviterName: string | null
  workspaceName: string
  documentTitle: string | null
}

export type InviteOutcome =
  | { kind: 'invalid' }
  | { kind: 'sign-in'; invite: InviteSummary }
  | { kind: 'mismatch'; invitedEmail: string; signedInEmail: string }
  | { kind: 'redirect'; to: string }

/**
 * What the invite page shows for a token and the person viewing it, accepting the
 * invitation when that person is the one it is for.
 *
 * Expired, revoked, used and unknown tokens are all `invalid`, carrying nothing about
 * the workspace: the page must not say which case applies, or whether the token ever
 * existed. One exception: a used link opened by the person it was for sends them on.
 * Signing in through the link accepts it (the sign-in sweep) before the browser comes
 * back here, and that person must land in the document, not on "no longer valid".
 */
export async function resolveInvite(
  token: string,
  user: { id: string; email: string } | null,
  now = new Date(),
): Promise<InviteOutcome> {
  if (!isWellFormedInviteToken(token)) return { kind: 'invalid' }
  const tokenHash = hashInviteToken(token)
  const row = await prisma.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      role: true,
      workspaceId: true,
      documentId: true,
      expiresAt: true,
      acceptedAt: true,
      workspace: { select: { name: true } },
      document: { select: { title: true } },
      invitedBy: { select: { name: true } },
    },
  })
  if (!row) return { kind: 'invalid' }

  const destination = row.documentId
    ? documentHref(row.workspaceId, row.documentId)
    : `/workspaces/${row.workspaceId}`
  const isInvitee = user !== null && normalizeEmail(user.email) === row.email

  if (row.acceptedAt !== null) return isInvitee ? { kind: 'redirect', to: destination } : { kind: 'invalid' }
  if (row.expiresAt.getTime() <= now.getTime()) return { kind: 'invalid' }
  if (user === null) {
    return {
      kind: 'sign-in',
      invite: {
        email: row.email,
        role: row.role,
        inviterName: row.invitedBy?.name ?? null,
        workspaceName: row.workspace.name,
        documentTitle: row.document?.title ?? null,
      },
    }
  }
  if (!isInvitee) return { kind: 'mismatch', invitedEmail: row.email, signedInEmail: user.email }

  if (await acceptOne({ id: row.id, tokenHash }, user.id, now)) return { kind: 'redirect', to: destination }

  // Nothing matched. Either the same person's other tab accepted it a moment ago (a double
  // click), in which case they are a member now and belong in the document, or it was
  // re-issued, revoked or expired in between. Read the row once more to tell which.
  const settled = await prisma.invitation.findUnique({ where: { tokenHash }, select: { acceptedAt: true } })
  return settled?.acceptedAt != null ? { kind: 'redirect', to: destination } : { kind: 'invalid' }
}
