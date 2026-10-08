import { describe, it, expect } from 'vitest'
import { hasOthersHere, publishDocState, clearDocState, getDocState, subscribeDocState } from '@/lib/doc-state'

describe('doc state store', () => {
  it('notifies subscribers and returns a stable snapshot', () => {
    let calls = 0
    const stop = subscribeDocState(() => { calls += 1 })
    publishDocState({ documentId: 'a', status: 'connected', peers: [] })
    const first = getDocState()
    // A second identical publish must not notify: useSyncExternalStore re-renders
    // every subscriber on each notify, and the provider publishes on every
    // awareness tick.
    publishDocState({ documentId: 'a', status: 'connected', peers: [] })
    expect(calls).toBe(1)
    expect(getDocState()).toBe(first)
    stop()
  })

  it('a stale unmount does not clear a newer document', () => {
    publishDocState({ documentId: 'old', status: 'connected', peers: [] })
    publishDocState({ documentId: 'new', status: 'connected', peers: [] })
    clearDocState('old')
    expect(getDocState().documentId).toBe('new')
  })

  it('clearing the current document resets the store', () => {
    publishDocState({
      documentId: 'new',
      status: 'connected',
      peers: [{ clientId: 1, name: 'Eddie', color: '#fff' }],
    })
    let calls = 0
    const stop = subscribeDocState(() => { calls += 1 })
    clearDocState('new')
    // The other half of the stale-clear test above: a guard that never lets a
    // clear through passes that one too, and leaves a stale pill in the nav.
    expect(getDocState().documentId).toBeNull()
    expect(getDocState().peers).toEqual([])
    expect(getDocState().status).toBe('connecting')
    expect(calls).toBe(1)
    stop()
  })

  it('a change to peers alone notifies', () => {
    publishDocState({ documentId: 'p', status: 'connected', peers: [] })
    let calls = 0
    const stop = subscribeDocState(() => { calls += 1 })
    publishDocState({
      documentId: 'p',
      status: 'connected',
      peers: [{ clientId: 1, name: 'Eddie', color: '#fff' }],
    })
    expect(calls).toBe(1)
    // And each field a peer carries, since the nav draws all three.
    publishDocState({
      documentId: 'p',
      status: 'connected',
      peers: [{ clientId: 1, name: 'Edwina', color: '#fff' }],
    })
    expect(calls).toBe(2)
    publishDocState({
      documentId: 'p',
      status: 'connected',
      peers: [{ clientId: 1, name: 'Edwina', color: '#000' }],
    })
    expect(calls).toBe(3)
    publishDocState({
      documentId: 'p',
      status: 'connected',
      peers: [{ clientId: 2, name: 'Edwina', color: '#000' }],
    })
    expect(calls).toBe(4)
    stop()
  })

  it('a change to status alone notifies', () => {
    publishDocState({ documentId: 's', status: 'connecting', peers: [] })
    let calls = 0
    const stop = subscribeDocState(() => { calls += 1 })
    publishDocState({ documentId: 's', status: 'connected', peers: [] })
    expect(calls).toBe(1)
    expect(getDocState().status).toBe('connected')
    stop()
  })
})

describe('hasOthersHere', () => {
  const peer = { clientId: 1, name: 'A', color: '#000' }
  it('is true only when connected with peers', () => {
    expect(hasOthersHere({ status: 'connected', peers: [peer] })).toBe(true)
    expect(hasOthersHere({ status: 'connected', peers: [] })).toBe(false)
  })
  it('is false while not connected, however stale the peers are', () => {
    expect(hasOthersHere({ status: 'disconnected', peers: [peer] })).toBe(false)
    expect(hasOthersHere({ status: 'connecting', peers: [peer] })).toBe(false)
  })
})
