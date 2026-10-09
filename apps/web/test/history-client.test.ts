import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearVersionStateCache,
  fetchVersions,
  fetchVersionState,
  listReachesFirstVersion,
  type DocumentVersion,
  VersionTooLargeError,
} from '../src/lib/history-client.js'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  clearVersionStateCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function bytes(...values: number[]): Response {
  return new Response(new Uint8Array(values), {
    headers: { 'content-type': 'application/octet-stream' },
  })
}

describe('fetchVersions', () => {
  it('returns the parsed versions and keeps ids as strings', async () => {
    fetchMock.mockResolvedValue(
      json({
        versions: [
          {
            id: '9007199254740993', // past Number.MAX_SAFE_INTEGER: must never become a number
            startedAt: '2026-09-30T16:35:00.000Z',
            endedAt: '2026-09-30T16:40:00.000Z',
            author: { id: 'u1', name: 'Grace' },
            updateCount: 4,
          },
          {
            id: '12',
            startedAt: '2026-09-30T10:00:00.000Z',
            endedAt: '2026-09-30T10:00:00.000Z',
            author: null,
            updateCount: 1,
          },
        ],
      }),
    )

    const versions = await fetchVersions('doc-1', 25)

    expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-1/history?limit=25')
    expect(versions).toHaveLength(2)
    expect(versions[0]!.id).toBe('9007199254740993')
    expect(typeof versions[0]!.id).toBe('string')
    expect(versions[0]!.endedAt).toEqual(new Date('2026-09-30T16:40:00.000Z'))
    expect(versions[0]!.author).toEqual({ id: 'u1', name: 'Grace' })
    expect(versions[1]!.author).toBeNull()
  })

  it("throws with the response's message on a non-2xx", async () => {
    fetchMock.mockResolvedValue(json({ error: 'not found' }, 404))
    await expect(fetchVersions('doc-1')).rejects.toThrow('not found')
  })

  it('throws something readable when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(fetchVersions('doc-1')).rejects.toThrow(/502/)
  })
})

describe('fetchVersionState', () => {
  it('returns the bytes as a Uint8Array, not an ArrayBuffer', async () => {
    fetchMock.mockResolvedValue(bytes(1, 2, 3))

    const state = await fetchVersionState('doc-1', '7')

    expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-1/history/7')
    // Y.applyUpdate wants a Uint8Array; an ArrayBuffer type-checks nowhere and throws at runtime.
    expect(state).toBeInstanceOf(Uint8Array)
    expect([...state]).toEqual([1, 2, 3])
  })

  it('throws on a 404 rather than resolving to an empty array', async () => {
    // An empty array applies cleanly and would show an empty document as that version's content.
    fetchMock.mockResolvedValue(json({ error: 'not found' }, 404))
    await expect(fetchVersionState('doc-1', '7')).rejects.toThrow('not found')
  })

  it('answers a 413 with a distinct error the caller can recognise', async () => {
    fetchMock.mockResolvedValue(json({ error: 'too large to preview' }, 413))
    await expect(fetchVersionState('doc-1', '7')).rejects.toBeInstanceOf(VersionTooLargeError)
  })

  it('does not fetch a version twice', async () => {
    fetchMock.mockImplementation(async () => bytes(1, 2, 3))

    await fetchVersionState('doc-1', '7')
    await fetchVersionState('doc-1', '7')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares one request between callers that ask while it is in flight', async () => {
    fetchMock.mockImplementation(async () => bytes(1))

    await Promise.all([fetchVersionState('doc-1', '7'), fetchVersionState('doc-1', '7')])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keys the cache by document as well as version', async () => {
    fetchMock.mockImplementation(async () => bytes(1))

    await fetchVersionState('doc-1', '7')
    await fetchVersionState('doc-2', '7')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('remembers that a version is too large', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'too large to preview' }, 413))

    await expect(fetchVersionState('doc-1', '7')).rejects.toBeInstanceOf(VersionTooLargeError)
    await expect(fetchVersionState('doc-1', '7')).rejects.toBeInstanceOf(VersionTooLargeError)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure, so a retry asks again', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'boom' }, 500))
    fetchMock.mockResolvedValueOnce(bytes(9))

    await expect(fetchVersionState('doc-1', '7')).rejects.toThrow('boom')
    const state = await fetchVersionState('doc-1', '7')

    expect([...state]).toEqual([9])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('runs at most two state requests at once', async () => {
    let running = 0
    let peak = 0
    fetchMock.mockImplementation(async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 10))
      running -= 1
      return bytes(1)
    })

    await Promise.all(['1', '2', '3', '4', '5', '6'].map((id) => fetchVersionState('doc-1', id)))

    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(peak).toBe(2)
  })
})

describe('listReachesFirstVersion', () => {
  const version = (id: string, updateCount: number): DocumentVersion => ({
    id,
    startedAt: new Date(0),
    endedAt: new Date(0),
    author: null,
    updateCount,
  })

  it('is true when the server returned fewer versions than were asked for', () => {
    expect(listReachesFirstVersion([version('2', 1), version('1', 1)], 50)).toBe(true)
  })

  it('is false when the list is full, since older versions may sit beyond it', () => {
    expect(listReachesFirstVersion([version('2', 1), version('1', 1)], 2)).toBe(false)
  })

  it('is false when the server reached the end of what it scans, however short the list', () => {
    // One long session of 5,000 updates is a single version; the log goes back further.
    expect(listReachesFirstVersion([version('9000', 5000)], 50)).toBe(false)
  })

  it('is true for an empty list', () => {
    expect(listReachesFirstVersion([], 50)).toBe(true)
  })
})
