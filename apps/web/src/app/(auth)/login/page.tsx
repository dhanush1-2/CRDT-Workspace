import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/current-user'
import { safeNext } from '@/lib/safe-next'
import { oauthErrorMessage } from '@/lib/oauth/errors'
import { ProviderButtons } from '../ProviderButtons'
import styles from '../auth.module.css'
import ui from '@/components/ui/ui.module.css'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { next, error } = await searchParams
  // A repeated ?next= arrives as an array. Narrow it; anything that isn't a
  // single string falls back to the default rather than crashing the page.
  const destination = safeNext(typeof next === 'string' ? next : undefined)

  // redirect() signals by throwing — it is deliberately outside any try/catch.
  if (await getCurrentUser()) redirect(destination)

  // ?error= only selects one of a fixed set of messages; it is never displayed.
  const message = oauthErrorMessage(error)

  return (
    <>
      <div className={styles.intro}>
        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.lede}>Sign in to your workspaces.</p>
      </div>
      {message && (
        <p className={ui.error} role="alert" data-testid="auth-error">
          {message}
        </p>
      )}
      <ProviderButtons next={destination} />
      <p className={styles.alt}>
        New here? Signing in creates your account and a workspace of your own.{' '}
        <Link href="/privacy" data-testid="privacy-link">Privacy</Link>
      </p>
    </>
  )
}
