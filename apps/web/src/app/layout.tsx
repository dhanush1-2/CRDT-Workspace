import './globals.css'

import type { ReactNode } from 'react'
import { Schibsted_Grotesk } from 'next/font/google'
import { CanvasBackground } from '@/components/CanvasBackground'
import { ToastProvider } from '@/components/ui/Toast'
import { WarmSync } from '@/components/WarmSync'

export const metadata = { title: 'CRDT Workspace' }

// Schibsted Grotesk, self-hosted by next/font at build time: the browser never asks Google
// for it, and next/font's metric-matched fallback face means the swap does not move text
// (spec, "Type"). Exposed as a CSS variable, which globals.css folds into --font.
const schibsted = Schibsted_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-schibsted',
})

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={schibsted.variable}>
      <body>
        <CanvasBackground />
        <ToastProvider>
          <WarmSync />
          {/*
            The canvas is fixed at z-index 0, so everything else needs a stacking
            context above it. position:relative is what gives z-index meaning here.
          */}
          <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
        </ToastProvider>
      </body>
    </html>
  )
}
