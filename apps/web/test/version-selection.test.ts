import { afterEach, describe, expect, it } from 'vitest'
import {
  clearVersion,
  getVersionSelection,
  selectVersion,
  subscribeVersionSelection,
} from '@/lib/version-selection'

afterEach(() => clearVersion())

describe('version selection store', () => {
  it('holds the document and version that were selected', () => {
    selectVersion('doc-1', '7', 'Sep 30, 16:40, by Grace')
    expect(getVersionSelection()).toMatchObject({
      documentId: 'doc-1',
      versionId: '7',
      label: 'Sep 30, 16:40, by Grace',
    })
  })

  it('carries the author and time in parts, for the pill and the restore message', () => {
    selectVersion('doc-1', '7', 'Sep 30, 16:40, by Grace', { author: 'Grace', time: 'Sep 30, 16:40' })
    expect(getVersionSelection()?.details).toEqual({ author: 'Grace', time: 'Sep 30, 16:40' })
  })

  it('a repeat pick of the same version is a retry: a new snapshot, with a higher attempt', () => {
    let calls = 0
    const stop = subscribeVersionSelection(() => {
      calls += 1
    })
    selectVersion('doc-1', '7')
    const first = getVersionSelection()!
    selectVersion('doc-1', '7')
    const second = getVersionSelection()!
    expect(calls).toBe(2)
    expect(second).not.toBe(first)
    expect(second.attempt).toBeGreaterThan(first.attempt)
    // Coming back to a version after another one is a fresh pick too, never an old attempt.
    selectVersion('doc-1', '8')
    selectVersion('doc-1', '7')
    expect(getVersionSelection()!.attempt).toBeGreaterThan(second.attempt)
    stop()
  })

  it('keeps the snapshot stable between changes', () => {
    selectVersion('doc-1', '7')
    expect(getVersionSelection()).toBe(getVersionSelection())
  })

  it('clearing with a document id clears only that document', () => {
    selectVersion('doc-new', '7')
    clearVersion('doc-old') // a stale unmount must not clear the document now on screen
    expect(getVersionSelection()).toMatchObject({ documentId: 'doc-new', versionId: '7' })
    clearVersion('doc-new')
    expect(getVersionSelection()).toBeNull()
  })

  it('clearing with no argument always clears, and an empty store stays quiet', () => {
    let calls = 0
    const stop = subscribeVersionSelection(() => {
      calls += 1
    })
    clearVersion()
    expect(calls).toBe(0)
    selectVersion('doc-1', '7')
    clearVersion()
    expect(getVersionSelection()).toBeNull()
    expect(calls).toBe(2)
    stop()
  })
})
