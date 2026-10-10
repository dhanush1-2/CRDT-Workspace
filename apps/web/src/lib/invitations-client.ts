import type { InvitationLinkResult, InvitationView } from './members.js'

// The share sheet's calls to the invitation routes. Each returns null (or false) for a
// refusal and for a request that never got an answer: fetch rejects then, and the
// sheet only needs to know that it did not work.

/** An invite link's path, made absolute on this browser's origin, which is the app's. */
export function absoluteInviteUrl(path: string): string {
  return new URL(path, window.location.origin).toString()
}

export async function fetchPendingInvitations(workspaceId: string): Promise<InvitationView[] | null> {
  try {
    const response = await fetch(`/api/workspaces/${workspaceId}/invitations`, { cache: 'no-store' })
    if (!response.ok) return null
    return ((await response.json()) as { invitations: InvitationView[] }).invitations
  } catch {
    return null
  }
}

/** Copy link: a new link for a pending invitation. The old one stops working. */
export async function fetchNewInviteLink(
  workspaceId: string,
  invitationId: string,
): Promise<InvitationLinkResult | null> {
  try {
    const response = await fetch(`/api/workspaces/${workspaceId}/invitations/${invitationId}/link`, {
      method: 'POST',
    })
    if (!response.ok) return null
    return (await response.json()) as InvitationLinkResult
  } catch {
    return null
  }
}

export async function deleteInvitation(workspaceId: string, invitationId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/workspaces/${workspaceId}/invitations/${invitationId}`, {
      method: 'DELETE',
    })
    return response.ok
  } catch {
    return false
  }
}
