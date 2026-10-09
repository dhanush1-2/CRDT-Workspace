/**
 * The browser's side of the history routes: the version list, and the document's state
 * as of a version.
 *
 * Kept free of React so the rules that matter (ids stay strings, bytes are a
 * Uint8Array, a failure is never an empty result, a version is fetched once) can be
 * tested against a stubbed fetch.
 */

export type DocumentVersion = {
  /** The highest update id in the run. A string: the column is a 64-bit integer. */
  id: string
  startedAt: Date
  endedAt: Date
  /** Null for updates written before authorship existed, or by a deleted account. */
  author: { id: string; name: string } | null
  updateCount: number
}

/** The server answered 413: replaying history up to this version is past what it will do. */
export class VersionTooLargeError extends Error {
  constructor() {
    super('too large to preview')
    this.name = 'VersionTooLargeError'
  }
}

/** The message the route put in its JSON body, or a status line when it had none. */
async function failure(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error) return new Error(body.error)
  } catch {
    // Not JSON (a proxy's error page, say). Fall through to the status.
  }
  return new Error(`Request failed (${response.status})`)
}

type VersionJson = Omit<DocumentVersion, 'startedAt' | 'endedAt'> & {
  startedAt: string
  endedAt: string
}

export async function fetchVersions(documentId: string, limit = 50): Promise<DocumentVersion[]> {
  const response = await fetch(`/api/documents/${documentId}/history?limit=${limit}`)
  if (!response.ok) throw await failure(response)
  const body = (await response.json()) as { versions: VersionJson[] }
  return body.versions.map((version) => ({
    ...version,
    startedAt: new Date(version.startedAt),
    endedAt: new Date(version.endedAt),
  }))
}

/**
 * How many of a document's newest update rows the server groups into versions
 * (VERSION_SCAN_ROWS in document-history.ts, which this file cannot import because that
 * module reaches for the database).
 */
const SERVER_SCAN_ROWS = 5000

/**
 * Whether the oldest version in `versions` is the document's first.
 *
 * Only then does it have nothing before it. A full list may have older versions beyond
 * its end, and so may a short one when the server's scan stopped before the start of the
 * log: the oldest version listed is then merely the oldest it looked at, and a sentence
 * claiming it created the document would be wrong.
 */
export function listReachesFirstVersion(versions: DocumentVersion[], limit: number): boolean {
  if (versions.length >= limit) return false
  const scanned = versions.reduce((sum, version) => sum + version.updateCount, 0)
  return scanned < SERVER_SCAN_ROWS
}

// --- Version states ----------------------------------------------------------------

/**
 * How many state requests run at once. Each one makes the server replay the document's
 * history up to that version, so opening the panel on a long document must not send a
 * dozen of them together.
 */
const MAX_CONCURRENT = 2

let active = 0
const waiting: Array<() => void> = []

async function inQueue<T>(task: () => Promise<T>): Promise<T> {
  if (active < MAX_CONCURRENT) active += 1
  // Otherwise wait to be handed a slot, which stays counted in `active`.
  else await new Promise<void>((resolve) => waiting.push(resolve))
  try {
    return await task()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
  }
}

/**
 * A state never changes once it is written (the version is an update id, and the state
 * is every update up to it), so nothing here is ever invalidated. The cap is for memory
 * alone: a state is the whole document, and a long session through a big one would
 * otherwise hold them all. It is least-recently-used, and counts a request in flight.
 */
const CACHE_LIMIT = 64
const cache = new Map<string, Promise<Uint8Array>>()

/** For tests, which share one module between cases. */
export function clearVersionStateCache(): void {
  cache.clear()
}

async function requestState(documentId: string, versionId: string): Promise<Uint8Array> {
  const response = await fetch(`/api/documents/${documentId}/history/${versionId}`)
  if (response.status === 413) throw new VersionTooLargeError()
  // Never an empty array for a failure: it would apply cleanly and show a blank
  // document as if that were what the version held.
  if (!response.ok) throw await failure(response)
  // arrayBuffer() gives an ArrayBuffer; Y.applyUpdate wants a Uint8Array.
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * The document's Yjs state as of `versionId`.
 *
 * Rejects with VersionTooLargeError for a version the server will not replay, so the
 * caller can say so; that outcome is remembered, because asking again gets the same
 * answer. Any other failure is not remembered, so a retry asks again.
 */
export function fetchVersionState(documentId: string, versionId: string): Promise<Uint8Array> {
  const key = `${documentId}/${versionId}`
  const cached = cache.get(key)
  if (cached) {
    // Re-insert so the Map's order is recency.
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }

  const pending = inQueue(() => requestState(documentId, versionId))
  cache.set(key, pending)
  pending.catch((error: unknown) => {
    if (!(error instanceof VersionTooLargeError) && cache.get(key) === pending) cache.delete(key)
  })
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  return pending
}
