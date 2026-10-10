'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { signOut } from '@/lib/sign-out'
import styles from '../../auth.module.css'
import ui from '@/components/ui/ui.module.css'

/**
 * Signs out and stays on this page. Re-rendered signed out, the page offers sign-in for
 * the invited email, and the token never has to go into another URL to get back here.
 */
export function InviteSignOut() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <>
      {failed && (
        <p className={ui.error} role="alert">
          Could not sign out. Check your connection and try again.
        </p>
      )}
      <button
        type="button"
        className={`${styles.provider} ${styles.providerGlass} ${styles.providerButton}`}
        disabled={pending}
        data-testid="invite-sign-out"
        onClick={async () => {
          setPending(true)
          setFailed(false)
          if (!(await signOut())) {
            setPending(false)
            setFailed(true)
            return
          }
          router.refresh()
        }}
      >
        Sign out
      </button>
    </>
  )
}
