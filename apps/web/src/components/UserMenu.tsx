'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { colorFor } from '@/lib/color'
import type { SessionUser } from '@/lib/current-user'
import { signOut } from '@/lib/sign-out'
import styles from './user-menu.module.css'

export function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  // Close on an outside click or Escape. Without both, the popover strands the
  // person on any page with no obvious way back.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Focus may be inside the popover; closing would drop it to <body>.
        button.current?.focus()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={styles.avatar}
        style={{ color: colorFor(user.id) }}
        data-testid="account-trigger"
        ref={button}
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((value) => !value)}
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>

      {open && (
        <div className={styles.popover} data-testid="account-menu">
          <div className={styles.identity}>
            {/*
              current-user keeps its test id and its exact text: the e2e suite
              asserts the signed-in person's name here.
            */}
            <div className={styles.name} data-testid="current-user">
              {user.name}
            </div>
            <div className={styles.email}>{user.email}</div>
          </div>

          <Link className={styles.item} href="/" onClick={() => setOpen(false)}>
            All workspaces
          </Link>

          <button
            type="button"
            className={`${styles.item} ${styles.danger}`}
            data-testid="sign-out"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              // False when the request never reached the server. Without re-enabling here
              // the button would sit disabled forever with no way to retry.
              if (!(await signOut())) {
                setPending(false)
                return
              }
              // refresh() drops the server tree rendered for the old session
              // before navigating, so no signed-in data stays on screen.
              router.refresh()
              router.push('/login')
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
