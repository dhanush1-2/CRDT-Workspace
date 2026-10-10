import Link from 'next/link'
import styles from './privacy.module.css'

export const metadata = { title: 'Privacy · CRDT Workspace' }

const CONTACT = 'dhanush12232002@gmail.com'

// Public, like /login: Google's consent screen links here, so it must load signed out.
// Every claim below is checked against the code; change the page when the data changes.
export default function PrivacyPage() {
  return (
    <main className={styles.shell}>
      <article className={styles.card}>
        <h1 className={styles.heading}>Privacy</h1>
        <p className={styles.lede}>Last updated October 9, 2026</p>

        <h2>What is stored</h2>
        <ul>
          <li>
            <strong>Your account:</strong> your name and email address, read from GitHub or Google
            when you sign in, and which of the two you used. The app asks those providers for
            your basic profile and email only. It keeps no access tokens and no password.
          </li>
          <li>
            <strong>Your work:</strong> the workspaces, boards and documents you create, every
            change made to them, and who made each change, so that version history can show it.
          </li>
          <li>
            <strong>Invitations:</strong> when a workspace owner invites an email address that
            has no account yet, that address, the role offered and who sent the invite.
            Revoking an invite deletes it.
          </li>
          <li>
            <strong>A sign-in cookie</strong> that keeps you signed in. There are no analytics,
            advertising or tracking cookies.
          </li>
        </ul>

        <h2>Who can see it</h2>
        <p>
          The members of a workspace see its documents, their history, and each other&apos;s names.
          While you have a document open, the people editing it with you see your name and
          cursor. Nothing is sold or shared with anyone else.
        </p>

        <h2>Where it is kept</h2>
        <p>
          The app runs on Render and the database on Neon, both in the United States. They store
          the data on the app&apos;s behalf.
        </p>

        <h2>Deleting your data</h2>
        <p>
          To have your account and its data deleted, email{' '}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Documents you edited in someone else&apos;s
          workspace stay with that workspace, with your changes no longer attributed to you.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>

        <p className={styles.back}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </article>
    </main>
  )
}
