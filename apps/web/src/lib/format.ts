/** "1 document", "2 documents". Keeps a bare "1 documents" from ever reaching the page. */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Relative time for a "last activity" line: "just now", "2 minutes ago", "1 day ago",
 * "3 days ago". Every step up to a week is measured in elapsed time, so "1 day ago" means
 * 24 to 48 hours, not "the calendar day before". A timestamp slightly in the future
 * (clock skew between the app and the database) reads as "just now".
 *
 * A week or more falls back to a short en-US date ("Sep 20", or "Dec 30, 2025" in another
 * year). That one branch is not elapsed-based: it formats in the server's time zone, with
 * a fixed locale, so the day shown can differ from the viewer's by up to a day.
 */
export function formatRelativeTime(then: Date, now: Date = new Date()): string {
  const elapsed = now.getTime() - then.getTime()

  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${formatCount(Math.floor(elapsed / MINUTE), 'minute')} ago`
  if (elapsed < DAY) return `${formatCount(Math.floor(elapsed / HOUR), 'hour')} ago`

  const days = Math.floor(elapsed / DAY)
  if (days < 7) return `${formatCount(days, 'day')} ago`

  const sameYear = then.getFullYear() === now.getFullYear()
  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * "Sep 30, 16:40" for a version's line in the history panel: an absolute time, because
 * "3 days ago" cannot tell two versions from the same afternoon apart. The year appears
 * only when it differs from `now`'s. Read in the viewer's time zone, so this belongs on
 * the client; it would disagree with the server's during a server render.
 */
export function formatVersionTime(then: Date, now: Date = new Date()): string {
  const date = then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
  // hourCycle h23 so midnight is 00:05, not 24:05 or 12:05 AM.
  const time = then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${date}, ${time}`
}
