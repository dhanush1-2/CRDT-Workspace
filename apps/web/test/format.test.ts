import { describe, it, expect } from 'vitest'
import {
  authorName,
  formatCount,
  formatRelativeTime,
  formatVersionLabel,
  formatVersionTime,
} from '../src/lib/format.js'

describe('formatCount', () => {
  it('uses the singular for exactly one and the plural otherwise, including zero', () => {
    expect(formatCount(1, 'document')).toBe('1 document')
    expect(formatCount(0, 'document')).toBe('0 documents')
    expect(formatCount(2, 'document')).toBe('2 documents')
  })

  it('takes an irregular plural', () => {
    expect(formatCount(1, 'person', 'people')).toBe('1 person')
    expect(formatCount(3, 'person', 'people')).toBe('3 people')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it('says "just now" under a minute, and for a timestamp slightly in the future', () => {
    expect(formatRelativeTime(ago(0), now)).toBe('just now')
    expect(formatRelativeTime(ago(59_999), now)).toBe('just now')
    expect(formatRelativeTime(ago(-5_000), now)).toBe('just now')
    expect(formatRelativeTime(ago(-400 * DAY), now)).toBe('just now')
  })

  it('counts minutes, singular at exactly one', () => {
    expect(formatRelativeTime(ago(MIN), now)).toBe('1 minute ago')
    expect(formatRelativeTime(ago(2 * MIN + 30_000), now)).toBe('2 minutes ago')
    expect(formatRelativeTime(ago(HOUR - 1), now)).toBe('59 minutes ago')
  })

  it('counts hours, singular at exactly one', () => {
    expect(formatRelativeTime(ago(HOUR), now)).toBe('1 hour ago')
    expect(formatRelativeTime(ago(5 * HOUR), now)).toBe('5 hours ago')
    expect(formatRelativeTime(ago(DAY - 1), now)).toBe('23 hours ago')
  })

  it('reads 24 to 48 hours as "1 day ago", in elapsed time and never "yesterday"', () => {
    expect(formatRelativeTime(ago(DAY), now)).toBe('1 day ago')
    // 47h59m is two calendar days back on the clock, but still one elapsed day.
    expect(formatRelativeTime(ago(2 * DAY - 1), now)).toBe('1 day ago')
  })

  it('counts several days up to a week', () => {
    expect(formatRelativeTime(ago(2 * DAY), now)).toBe('2 days ago')
    expect(formatRelativeTime(ago(6 * DAY + 23 * HOUR), now)).toBe('6 days ago')
  })

  it('falls back to a short date from a week on, with the year only when it differs', () => {
    // Built in local time, because the formatter reads local calendar fields.
    const localNow = new Date(2026, 9, 1, 12)
    // Exactly seven days is the boundary: one millisecond less is still "6 days ago".
    expect(formatRelativeTime(new Date(localNow.getTime() - 7 * DAY), localNow)).toBe('Sep 24')
    expect(formatRelativeTime(new Date(localNow.getTime() - 7 * DAY + 1), localNow)).toBe(
      '6 days ago',
    )
    expect(formatRelativeTime(new Date(2026, 8, 20, 12), localNow)).toBe('Sep 20')
    expect(formatRelativeTime(new Date(2025, 11, 30, 12), localNow)).toBe('Dec 30, 2025')
  })
})

describe('formatVersionTime', () => {
  // Local-time constructors, because the formatter reads the viewer's calendar fields.
  const now = new Date(2026, 9, 1, 12)

  it('reads "Sep 30, 16:40": a short date, then a 24-hour clock', () => {
    expect(formatVersionTime(new Date(2026, 8, 30, 16, 40), now)).toBe('Sep 30, 16:40')
  })

  it('pads the hour and minute, and calls midnight 00', () => {
    expect(formatVersionTime(new Date(2026, 8, 3, 0, 5), now)).toBe('Sep 3, 00:05')
  })

  it('adds the year when it is not this one', () => {
    expect(formatVersionTime(new Date(2025, 11, 30, 9, 7), now)).toBe('Dec 30, 2025, 09:07')
  })
})

describe('formatVersionLabel', () => {
  const now = new Date(2026, 9, 1, 12)
  const endedAt = new Date(2026, 8, 30, 16, 40)

  it('names the time and the author', () => {
    expect(formatVersionLabel({ endedAt, author: { name: 'Grace' } }, now)).toBe('Sep 30, 16:40, by Grace')
  })

  it('says Unknown when there is no author, or the name is blank', () => {
    expect(formatVersionLabel({ endedAt, author: null }, now)).toBe('Sep 30, 16:40, by Unknown')
    expect(formatVersionLabel({ endedAt, author: { name: '' } }, now)).toBe('Sep 30, 16:40, by Unknown')
  })
})

describe('authorName', () => {
  it('is the author\'s name, or Unknown when there is no author or the name is blank', () => {
    expect(authorName({ author: { name: 'Grace' } })).toBe('Grace')
    expect(authorName({ author: null })).toBe('Unknown')
    expect(authorName({ author: { name: '' } })).toBe('Unknown')
  })
})
