import type { ReactNode } from 'react'
import { LogoMark } from '@/components/LogoMark'
import styles from './auth.module.css'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.shell}>
      <div className={styles.card} data-testid="auth-card">
        <div className={styles.mark} aria-hidden="true" data-testid="auth-mark">
          <LogoMark />
        </div>
        {children}
      </div>
    </main>
  )
}
