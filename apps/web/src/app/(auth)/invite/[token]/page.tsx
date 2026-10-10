import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/current-user'
import { resolveInvite } from '@/lib/invitations'
import { describeInvite } from '@/lib/invite-text'
import { ProviderButtons } from '../../ProviderButtons'
import { InviteSignOut } from './InviteSignOut'
import styles from '../../auth.module.css'

export const metadata: Metadata = {
  title: 'Invitation · CRDT Workspace',
  // The token is in this page's URL. With no referrer, no request from here, to another
  // site or to this one, ever carries it in a Referer header.
  referrer: 'no-referrer',
}

// Public, like /login and /privacy: the person opening this usually has no account yet.
// It does its own check instead: a link is accepted only for a signed-in user whose
// email is the invitation's (resolveInvite).
// Never link to /invite/... with next/link: it prefetches, which would run this page, and
// this page accepts the invitation on a GET.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  // The session first. Reading the cookie makes this render dynamic before anything
  // else runs, so no outcome for any token is ever prerendered or served from a cache.
  const user = await getCurrentUser()
  const { token } = await params
  const outcome = await resolveInvite(token, user)

  // redirect() signals by throwing, so it stays outside any try/catch.
  if (outcome.kind === 'redirect') redirect(outcome.to)

  if (outcome.kind === 'invalid') {
    // One message for expired, revoked, used and unknown links alike, naming nothing.
    return (
      <>
        <div className={styles.intro}>
          <h1 className={styles.heading}>Invitation</h1>
          <p className={styles.lede} data-testid="invite-invalid">
            This invite link is no longer valid. Ask the person who shared it for a new one.
          </p>
        </div>
        <p className={styles.alt}>
          <Link href="/">Go to your workspaces</Link>
        </p>
      </>
    )
  }

  if (outcome.kind === 'mismatch') {
    return (
      <>
        <div className={styles.intro}>
          <h1 className={styles.heading}>Invitation</h1>
          <p className={`${styles.lede} ${styles.inviteText}`} data-testid="invite-mismatch">
            This invite is for <strong>{outcome.invitedEmail}</strong>. You&apos;re signed in as{' '}
            <strong>{outcome.signedInEmail}</strong>.
          </p>
        </div>
        <InviteSignOut />
      </>
    )
  }

  // Signed out, valid link. Sign-in returns here: by then the callback has accepted the
  // invitation for the right email, and this page sends them on (resolveInvite).
  return (
    <>
      <div className={styles.intro}>
        <h1 className={styles.heading}>You&apos;re invited</h1>
        <p className={`${styles.lede} ${styles.inviteText}`} data-testid="invite-summary">
          {describeInvite(outcome.invite)} Sign in as <strong>{outcome.invite.email}</strong> to open it.
        </p>
      </div>
      <ProviderButtons next={`/invite/${token}`} />
      <p className={styles.alt}>
        New here? Signing in creates your account.{' '}
        <Link href="/privacy" data-testid="privacy-link">
          Privacy
        </Link>
      </p>
    </>
  )
}
