import { PROVIDERS, availableProviders } from '@/lib/oauth/providers'
import styles from './auth.module.css'

/**
 * The sign-in buttons, each sending the browser back to `next` afterwards. `next` must
 * already be a safe same-origin path: the login page passes it through safeNext, and
 * the invite page passes its own path. Only providers with credentials get a button.
 */
export function ProviderButtons({ next }: { next: string }) {
  const providers = availableProviders()
  if (providers.length === 0) {
    return (
      <p className={styles.alt} data-testid="no-providers">
        No sign-in providers are configured.
      </p>
    )
  }
  return (
    <div className={styles.providers}>
      {providers.map((id) => (
        <a
          key={id}
          className={`${styles.provider} ${id === 'github' ? styles.providerAccent : styles.providerGlass}`}
          href={`/api/auth/oauth/${id}?next=${encodeURIComponent(next)}`}
          data-testid={`signin-${id}`}
        >
          Continue with {PROVIDERS[id].label}
        </a>
      ))}
    </div>
  )
}
