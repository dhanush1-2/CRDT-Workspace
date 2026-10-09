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
    selectVersion('doc-1', '7')
    expect(getVersionSelection()).toEqual({ documentId: 'doc-1', versionId: '7' })
  })

  it('notifies subscribers once per real change and keeps the snapshot stable', () => {
    let calls = 0
    const stop = subscribeVersionSelection(() => {
      calls += 1
    })
    selectVersion('doc-1', '7')
    const first = getVersionSelection()
    selectVersion('doc-1', '7') // same pick: nobody needs to hear about it
    expect(calls).toBe(1)
    expect(getVersionSelection()).toBe(first)
    selectVersion('doc-1', '8')
    expect(calls).toBe(2)
    stop()
  })

  it('clearing with a document id clears only that document', () => {
    selectVersion('doc-new', '7')
    clearVersion('doc-old') // a stale unmount must not clear the document now on screen
    expect(getVersionSelection()).toEqual({ documentId: 'doc-new', versionId: '7' })
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
