'use client'

import type { ButtonHTMLAttributes } from 'react'
import styles from './ui.module.css'

type Variant = 'accent' | 'plain' | 'ghost' | 'danger'

const VARIANT_CLASS: Record<Variant, string> = {
  accent: styles.accent!,
  plain: styles.plainButton!,
  ghost: styles.ghost!,
  danger: styles.danger!,
}

export function Button({
  variant = 'accent',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      type={type}
      className={[styles.button, VARIANT_CLASS[variant], className].filter(Boolean).join(' ')}
    />
  )
}
