'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Role } from '@crdt/shared/types'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { colorFor } from '@/lib/color'
import {
  absoluteInviteUrl,
  deleteInvitation,
  fetchNewInviteLink,
  fetchPendingInvitations,
} from '@/lib/invitations-client'
import type { InvitationView, MemberPostResult, WorkspaceMemberView } from '@/lib/members'
import { ROLE_LABEL } from '@/lib/role-label'
import styles from './share-sheet.module.css'
import ui from '@/components/ui/ui.module.css'

/** The invite link on screen: just made by inviting someone, or by Copy link. */
type ShownLink = { invitationId: string; email: string; url: string }

export function ShareSheet({
  workspaceId,
  workspaceName,
  members,
  canManage,
  documentId,
  onClose,
}: {
  workspaceId: string
  workspaceName: string
  members: WorkspaceMemberView[]
  canManage: boolean
  /** The open document, when the sheet was opened from one. An invitation remembers it. */
  documentId?: string
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const invitedHeadingId = useId()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [invitations, setInvitations] = useState<InvitationView[]>([])
  const [invitationsFailed, setInvitationsFailed] = useState(false)
  const [shown, setShown] = useState<ShownLink | null>(null)
  // Where focus goes once a revoked row has left the list (see onRevoke).
  const [refocus, setRefocus] = useState<{ revokeId: string | null } | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const invitedRef = useRef<HTMLElement>(null)

  // Fetched here rather than passed down from the layout: the layout renders for every
  // member, and who has been invited is for owners only. The API enforces that as well.
  const loadInvitations = useCallback(async () => {
    if (!canManage) return
    const list = await fetchPendingInvitations(workspaceId)
    setInvitationsFailed(list === null)
    if (list !== null) setInvitations(list)
  }, [canManage, workspaceId])

  useEffect(() => {
    void loadInvitations()
  }, [loadInvitations])

  // Deleting the row the keyboard was on would drop focus to the page. Once the list has
  // re-rendered without it, focus lands on a neighbour's Revoke button, or on the email
  // field when the list is gone. An effect, so the target exists in the DOM by then.
  useEffect(() => {
    if (!refocus) return
    const target = refocus.revokeId
      ? invitedRef.current?.querySelector<HTMLElement>(`[data-testid="invited-revoke-${refocus.revokeId}"]`)
      : null
    ;(target ?? emailRef.current)?.focus()
    setRefocus(null)
  }, [refocus, invitations])

  async function postMember(body: {
    email: string
    role: Role
    documentId?: string
  }): Promise<MemberPostResult | null> {
    setError(null)
    setPending(true)
    let response: Response
    try {
      response = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      // fetch rejects, rather than resolving with an error status, when the request
      // never reaches the server. Without this the rejection escapes and pending
      // stays true, leaving the control disabled with nothing shown.
      setError('Could not reach the server. Check your connection and try again.')
      setPending(false)
      return null
    }
    const payload: unknown = await response.json().catch(() => null)
    setPending(false)
    if (!response.ok || payload === null) {
      setError(
        response.status === 403
          ? 'Your role in this workspace changed. Reload the page.'
          : ((payload as { error?: string } | null)?.error ?? 'Could not update that member'),
      )
      return null
    }
    return payload as MemberPostResult
  }

  async function copy(url: string, announce: string) {
    // A failure from an earlier copy must not stay on screen beside a success.
    setError(null)
    try {
      await navigator.clipboard.writeText(url)
      toast(announce)
    } catch {
      // No clipboard: an insecure origin, a denied permission, or Safari refusing a
      // write that follows a network round trip. The link is in the field, selected on
      // focus, so it can still be copied by hand.
      setError('Could not copy the link. Select it in the field and copy it yourself.')
    }
  }

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    if (!email) return
    // The members route upserts, so posting an existing member would silently
    // change their role instead of inviting anyone. Catch it here and say so;
    // role changes have their own control on the row.
    const existing = members.find((m) => m.email.toLowerCase() === email.toLowerCase())
    if (existing) {
      setError(`${email} already has access.`)
      return
    }
    const role = String(data.get('role') ?? 'editor') as Role
    // Inviting a pending email again replaces its invitation, and its old link stops
    // working. Say so rather than let it look like a second invite.
    const replacing = invitations.some((i) => i.email === email.toLowerCase())
    const result = await postMember({ email, role, ...(documentId ? { documentId } : {}) })
    // Clear the field only on success, as before: a failed invite keeps what was typed
    // so it can be corrected.
    if (!result) return
    form.reset()
    if (result.kind === 'member') {
      toast(`${email} added`)
      router.refresh()
      return
    }
    setShown({
      invitationId: result.invitation.id,
      email: result.invitation.email,
      url: absoluteInviteUrl(result.link),
    })
    toast(
      replacing
        ? `New invite link for ${result.invitation.email}. The old link no longer works.`
        : `Invite link created for ${result.invitation.email}`,
    )
    void loadInvitations()
  }

  async function onRoleChange(member: WorkspaceMemberView, role: Role) {
    const result = await postMember({ email: member.email, role })
    // postMember has shown its own error when it returns null. Anything but a member
    // here (an invitation, if the account vanished) did not change this person's role.
    if (!result) return
    if (result.kind !== 'member') {
      setError('Could not update that member')
      return
    }
    toast(role === 'editor' ? `${member.name} can edit now` : `${member.name} is now ${ROLE_LABEL[role]}`)
    router.refresh()
  }

  // Copy link in the Invited list. Only a hash of each token is stored, so the link
  // first sent cannot be shown again: this makes a new one and the old one stops
  // working (the plan's Copy-link decision). The toast and the note say so.
  async function onCopyNew(invitation: InvitationView) {
    setError(null)
    setPending(true)
    const result = await fetchNewInviteLink(workspaceId, invitation.id)
    setPending(false)
    if (!result) {
      setError('Could not make a new link. Reload the page and try again.')
      return
    }
    const url = absoluteInviteUrl(result.link)
    setShown({ invitationId: invitation.id, email: invitation.email, url })
    await copy(url, `New link copied for ${invitation.email}. The old link no longer works.`)
    void loadInvitations()
  }

  async function onRevoke(invitation: InvitationView) {
    setError(null)
    setPending(true)
    const ok = await deleteInvitation(workspaceId, invitation.id)
    setPending(false)
    if (!ok) {
      setError('Could not revoke that invite. Reload the page and try again.')
      return
    }
    if (shown?.invitationId === invitation.id) setShown(null)
    toast(`Invite for ${invitation.email} revoked`)
    // The next row, else the previous one, else the email field (no revokeId).
    const at = invitations.findIndex((i) => i.id === invitation.id)
    const neighbour = invitations[at + 1] ?? invitations[at - 1]
    setInvitations((list) => list.filter((i) => i.id !== invitation.id))
    setRefocus({ revokeId: neighbour?.id ?? null })
    void loadInvitations()
  }

  return (
    <Sheet title={`Share "${workspaceName}"`} onClose={onClose}>
      {canManage && (
        <form className={styles.invite} onSubmit={onInvite}>
          <input
            className={styles.inviteInput}
            ref={emailRef}
            name="email"
            type="email"
            required
            placeholder="teammate@company.com"
            aria-label="Invite by email"
            data-testid="member-email"
          />
          <select
            className={styles.inviteRole}
            name="role"
            defaultValue="editor"
            aria-label="Role"
            data-testid="member-role"
          >
            <option value="viewer">{ROLE_LABEL.viewer}</option>
            <option value="editor">{ROLE_LABEL.editor}</option>
            <option value="owner">{ROLE_LABEL.owner}</option>
          </select>
          <Button type="submit" disabled={pending} data-testid="add-member">
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      )}

      {error && (
        <p className={ui.error} role="alert" data-testid="member-error">
          {error}
        </p>
      )}

      {canManage && shown && (
        <div className={styles.linkPanel} data-testid="invite-link-panel">
          <p className={styles.linkNote}>
            Send this link to {shown.email}. It works only for them, for 14 days.
          </p>
          <div className={styles.linkRow}>
            <input
              className={styles.linkInput}
              readOnly
              value={shown.url}
              aria-label={`Invite link for ${shown.email}`}
              data-testid="invite-link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button onClick={() => void copy(shown.url, 'Link copied')} data-testid="invite-link-copy">
              Copy link
            </Button>
          </div>
        </div>
      )}

      <div className={styles.people}>
        {members.map((member) => (
          <div className={styles.row} key={member.id} data-testid={`share-member-${member.id}`}>
            <span
              className={styles.avatar}
              style={{ background: colorFor(member.id) }}
              aria-hidden="true"
            >
              {(member.name || member.email).slice(0, 1).toUpperCase()}
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{member.name}</span>
              <span className={styles.email}>{member.email}</span>
            </span>
            {canManage ? (
              <select
                className={styles.inviteRole}
                value={member.role}
                aria-label={`Role for ${member.name}`}
                data-testid={`role-for-${member.id}`}
                disabled={pending}
                onChange={(event) => void onRoleChange(member, event.target.value as Role)}
              >
                <option value="viewer">{ROLE_LABEL.viewer}</option>
                <option value="editor">{ROLE_LABEL.editor}</option>
                <option value="owner">{ROLE_LABEL.owner}</option>
              </select>
            ) : (
              <span className={styles.rowRole}>{ROLE_LABEL[member.role]}</span>
            )}
          </div>
        ))}
      </div>

      {canManage && invitations.length > 0 && (
        <section className={styles.invited} ref={invitedRef} aria-labelledby={invitedHeadingId} data-testid="invited-list">
          <h3 className={styles.invitedHeading} id={invitedHeadingId}>
            Invited
          </h3>
          {invitations.map((invitation) => (
            <div className={styles.row} key={invitation.id} data-testid={`invited-${invitation.id}`}>
              <span className={`${styles.avatar} ${styles.avatarPending}`} aria-hidden="true">
                {invitation.email.slice(0, 1).toUpperCase()}
              </span>
              <span className={styles.text}>
                <span className={styles.name} title={invitation.email}>
                  {invitation.email}
                </span>
                <span className={styles.email}>
                  {ROLE_LABEL[invitation.role]}
                  {invitation.expired ? ' · link expired' : ''}
                </span>
              </span>
              <Button
                variant="ghost"
                className={styles.rowButton}
                disabled={pending}
                aria-label={`Copy link for ${invitation.email}`}
                data-testid={`invited-copy-${invitation.id}`}
                onClick={() => void onCopyNew(invitation)}
              >
                Copy link
              </Button>
              <Button
                variant="danger"
                className={styles.rowButton}
                disabled={pending}
                aria-label={`Revoke invite for ${invitation.email}`}
                data-testid={`invited-revoke-${invitation.id}`}
                onClick={() => void onRevoke(invitation)}
              >
                Revoke
              </Button>
            </div>
          ))}
          <p className={styles.invitedNote}>
            Copy link makes a new link each time; earlier links for them stop working.
          </p>
        </section>
      )}

      {canManage && invitationsFailed && (
        <p className={ui.error} role="alert" data-testid="invited-error">
          Could not load pending invites. Reload the page to try again.
        </p>
      )}

      <p className={styles.footnote}>
        Someone without an account gets an invite link to send them. Role changes apply the
        next time they connect.
      </p>
    </Sheet>
  )
}
