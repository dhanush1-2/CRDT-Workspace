import type { Role } from '@crdt/shared/types'

/** A workspace member as the client sees it: plain strings only, safe to pass from a server component. */
export type WorkspaceMemberView = { id: string; name: string; email: string; role: Role }

/**
 * A pending invitation as the owner's share sheet sees it. No token and no hash: a link
 * is only ever in the response of the call that made it.
 */
export type InvitationView = {
  id: string
  email: string
  role: Role
  /** ISO 8601. */
  expiresAt: string
  /** Past its expiry when the server answered. Copy link makes a new link and revives it. */
  expired: boolean
}

/** What making a link returns, by inviting someone new or by Copy link. `link` is a path: /invite/<token>. */
export type InvitationLinkResult = { invitation: InvitationView; link: string }

/** POST /api/workspaces/[id]/members: an existing user is added at once; anyone else gets a pending invitation. */
export type MemberPostResult =
  | { kind: 'member'; userId: string; role: Role }
  | ({ kind: 'invitation' } & InvitationLinkResult)
