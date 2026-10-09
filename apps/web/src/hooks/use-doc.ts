'use client'

import { useEffect, useState } from 'react'
import { createDocSession, type DocSession, type DocStatus } from '@/lib/doc-session'
import { SYNC_URL } from '@/lib/sync-url'


async function fetchToken(documentId: string): Promise<string> {
  const response = await fetch(`/api/documents/${documentId}/token`, { method: 'POST' })
  if (!response.ok) throw new Error(`token request failed: ${response.status}`)
  const body = (await response.json()) as { token: string }
  return body.token
}

export function useCollaborativeDoc(documentId: string) {
  const [session, setSession] = useState<DocSession | null>(null)
  const [status, setStatus] = useState<DocStatus>('connecting')
  // Whether the provider has synced at least once. Not provider.synced, which goes back
  // to false on every disconnect: what matters to a caller is whether the local doc has
  // ever received the server's state, since before that it is empty and not the document.
  const [synced, setSynced] = useState(false)

  useEffect(() => {
    const created = createDocSession({
      documentId,
      syncUrl: SYNC_URL,
      fetchToken: () => fetchToken(documentId),
      // Cross-tab sync is a genuine feature for users, so it stays on by default.
      // Automated browser tests append ?nobc=1 to force every tab through the server,
      // otherwise a broken WebSocket still looks like working collaboration.
      disableBc: new URLSearchParams(window.location.search).has('nobc'),
    })
    const unsubscribe = created.onStatus(setStatus)
    const onSync = (isSynced: boolean) => {
      if (isSynced) setSynced(true)
    }
    created.provider.on('sync', onSync)
    setSession(created)

    return () => {
      created.provider.off('sync', onSync)
      setSynced(false)
      unsubscribe()
      created.destroy()
      setSession(null)
    }
  }, [documentId])

  return { doc: session?.doc ?? null, provider: session?.provider ?? null, status, synced }
}
