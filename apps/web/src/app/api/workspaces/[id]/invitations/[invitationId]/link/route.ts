import { HttpError, requireUser, requireWorkspaceRole, toResponse } from '@/lib/auth-guard'
import { NO_STORE, reissueInvitation } from '@/lib/invitations'

/**
 * Copy link in the Invited list: a fresh link for a pending invitation, with the expiry
 * reset. Only a hash of a token is stored, so the old link cannot be shown again; it
 * stops working instead. Owners only.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId, invitationId } = await params
    // This route's own check. Nothing above it gates routes under workspaces/[id].
    await requireWorkspaceRole(user.id, workspaceId, 'owner')

    const result = await reissueInvitation(workspaceId, invitationId)
    if (!result) throw new HttpError(404, 'not found')
    // no-store: this body holds the only copy of the new token there will ever be.
    return Response.json(result, { headers: NO_STORE })
  } catch (error) {
    return toResponse(error)
  }
}
