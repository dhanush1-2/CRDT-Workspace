import { describe, expect, it } from 'vitest'
import { STATUS_DISPLAY } from '@/components/status-display'

describe('the status pill (spec, "Status")', () => {
  it('is green when connected, the accent while syncing, amber offline, and never red', () => {
    expect(STATUS_DISPLAY.connected).toEqual({ label: 'Synced', dot: 'var(--ok)' })
    expect(STATUS_DISPLAY.connecting).toEqual({ label: 'Syncing', dot: 'var(--sync)' })
    expect(STATUS_DISPLAY.disconnected).toEqual({ label: 'Offline', dot: 'var(--warn)' })
    expect(STATUS_DISPLAY.fatal).toEqual({ label: 'Offline', dot: 'var(--warn)' })
  })
})
