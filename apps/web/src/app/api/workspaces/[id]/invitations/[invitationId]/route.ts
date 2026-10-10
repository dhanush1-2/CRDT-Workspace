import { HttpError, requireUser, requireWorkspaceRole, toResponse } from '@/lib/auth-guard'
import { revokeInvitation } from '@/lib/invitations'

/** Revoke a pending invitation. Its link stops working at once. Owners only. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId, invitationId } = await params
    // This route's own check. Nothing above it gates routes under workspaces/[id].
    await requireWorkspaceRole(user.id, workspaceId, 'owner')

    // Scoped by workspace inside revokeInvitation: owning one workspace does not let you
    // revoke another's invitation by id.
    if (!(await revokeInvitation(workspaceId, invitationId))) throw new HttpError(404, 'not found')
    return new Response(null, { status: 204 })
  } catch (error) {
    return toResponse(error)
  }
}
