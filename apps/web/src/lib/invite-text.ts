import type { Role } from '@crdt/shared/types'

const VERB: Record<Role, string> = { owner: 'own', editor: 'edit', viewer: 'view' }

/**
 * The invite page's first sentence. Without a document it names the workspace once:
 * the spec's "<document title, or the workspace name> in <workspace name>" would read
 * "edit Acme in Acme". An inviter who has deleted their account is "Someone".
 */
export function describeInvite(invite: {
  inviterName: string | null
  role: Role
  documentTitle: string | null
  workspaceName: string
}): string {
  const who = invite.inviterName ?? 'Someone'
  const what =
    invite.documentTitle === null
      ? invite.workspaceName
      : `${invite.documentTitle} in ${invite.workspaceName}`
  return `${who} invited you to ${VERB[invite.role]} ${what}.`
}
