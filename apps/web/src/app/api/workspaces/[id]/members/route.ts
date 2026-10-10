import { z } from 'zod'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { requireUser, requireWorkspaceRole, toResponse } from '@/lib/auth-guard'
import { NO_STORE, createOrReplaceInvitation } from '@/lib/invitations'
import type { MemberPostResult } from '@/lib/members'

const Body = z.object({
  // Sign-in stores emails trimmed and lowercased, so the lookup must match that,
  // or inviting "Ada@Example.com" would never find ada@example.com.
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['owner', 'editor', 'viewer']),
  // The document the share sheet was opened from, if any. Only an invitation uses it:
  // accepting one lands there. Ignored when the email already has an account.
  documentId: z.string().min(1).max(64).optional(),
})

/**
 * True if changing `targetUserId`'s role to `nextRole` would leave the workspace with
 * zero owners — i.e. the target is currently the workspace's last remaining owner and
 * `nextRole` is not `owner`. Narrow, partial fix for a workspace being left permanently
 * ownerless: it only blocks this specific self-lockout path. There is deliberately no
 * member-removal route and no confirmation-flag mechanism here — both are tracked
 * separately and out of scope for this change.
 */
export async function wouldLeaveWorkspaceOwnerless(
  workspaceId: string,
  targetUserId: string,
  nextRole: Role,
): Promise<boolean> {
  if (nextRole === 'owner') return false

  const current = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    select: { role: true },
  })
  if (current?.role !== 'owner') return false

  const ownerCount = await prisma.workspaceMember.count({ where: { workspaceId, role: 'owner' } })
  return ownerCount <= 1
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId } = await params
    await requireWorkspaceRole(user.id, workspaceId, 'owner')

    const body = await request.json().catch(() => null)
    const parsed = Body.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const invitee = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    })

    if (!invitee) {
      // Nobody has signed in with this email yet. Store a pending invitation and hand
      // the owner its link to send; inviting the same email again replaces it.
      const documentId = parsed.data.documentId ?? null
      if (documentId !== null) {
        // Both ids, so an invitation can never point into another workspace.
        const document = await prisma.document.findFirst({
          where: { id: documentId, workspaceId },
          select: { id: true },
        })
        if (!document) return Response.json({ error: 'invalid document' }, { status: 400 })
      }
      const created = await createOrReplaceInvitation({
        workspaceId,
        email: parsed.data.email,
        role: parsed.data.role,
        documentId,
        invitedById: user.id,
      })
      const result: MemberPostResult = { kind: 'invitation', ...created }
      // no-store: this body holds the only copy of the token there will ever be.
      return Response.json(result, { status: 201, headers: NO_STORE })
    }

    if (await wouldLeaveWorkspaceOwnerless(workspaceId, invitee.id, parsed.data.role)) {
      return Response.json(
        { error: 'workspace must have at least one owner' },
        { status: 400 },
      )
    }

    const member = await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId: invitee.id } },
      create: { workspaceId, userId: invitee.id, role: parsed.data.role },
      update: { role: parsed.data.role },
      select: { userId: true, role: true },
    })
    const result: MemberPostResult = { kind: 'member', ...member }
    return Response.json(result, { status: 201 })
  } catch (error) {
    return toResponse(error)
  }
}
