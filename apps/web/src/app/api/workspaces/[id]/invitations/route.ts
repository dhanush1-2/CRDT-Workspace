import { requireUser, requireWorkspaceRole, toResponse } from '@/lib/auth-guard'
import { NO_STORE, listPendingInvitations } from '@/lib/invitations'

/**
 * Pending invitations, for the share sheet's Invited list. Owners only: only owners can
 * invite, so only owners see who has been invited.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId } = await params
    // This route's own check. Nothing above it gates routes under workspaces/[id].
    await requireWorkspaceRole(user.id, workspaceId, 'owner')

    const invitations = await listPendingInvitations(workspaceId)
    return Response.json({ invitations }, { headers: NO_STORE })
  } catch (error) {
    return toResponse(error)
  }
}
