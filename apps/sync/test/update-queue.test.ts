import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UpdateQueue, type PendingUpdate, type UpdateSink } from '../src/update-queue.js'

function recordingSink() {
  const calls: Array<{ documentId: string; rows: PendingUpdate[] }> = []
  const sink: UpdateSink = {
    append: async (documentId, rows) => { calls.push({ documentId, rows }) },
  }
  return { sink, calls }
}

function failingSink(failures: number) {
  let attempts = 0
  const calls: Array<{ documentId: string; rows: PendingUpdate[] }> = []
  const sink: UpdateSink = {
    append: async (documentId, rows) => {
      attempts += 1
      if (attempts <= failures) throw new Error('postgres is down')
      calls.push({ documentId, rows })
    },
  }
  return { sink, calls, attempts: () => attempts }
}

const update = (n: number): PendingUpdate => ({
  update: new Uint8Array([n]),
  clientId: `c${n}`,
  userId: null,
})

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('UpdateQueue', () => {
  it('does not write immediately on enqueue', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    queue.enqueue('doc_1', update(1))

    expect(calls).toHaveLength(0)
    expect(queue.depth).toBe(1)
  })

  it('flushes after the interval elapses', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    queue.enqueue('doc_1', update(1))
    await vi.advanceTimersByTimeAsync(500)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.rows).toHaveLength(1)
    expect(queue.depth).toBe(0)
  })

  it('flushes immediately once the batch size is reached, without waiting', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 3 })

    queue.enqueue('doc_1', update(1))
    queue.enqueue('doc_1', update(2))
    queue.enqueue('doc_1', update(3))
    await vi.advanceTimersByTimeAsync(0)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.rows).toHaveLength(3)
  })

  it('preserves enqueue order within a document', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    for (let n = 1; n <= 5; n += 1) queue.enqueue('doc_1', update(n))
    await vi.advanceTimersByTimeAsync(500)

    expect(calls[0]!.rows.map((r) => r.update[0])).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps documents in separate batches', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    queue.enqueue('doc_a', update(1))
    queue.enqueue('doc_b', update(2))
    await vi.advanceTimersByTimeAsync(500)

    expect(calls).toHaveLength(2)
    expect(calls.map((c) => c.documentId).sort()).toEqual(['doc_a', 'doc_b'])
  })

  it('retains the batch and retries when the sink fails', async () => {
    const { sink, calls } = failingSink(2)
    const onError = vi.fn()
    const queue = new UpdateQueue(sink, {
      flushIntervalMs: 500,
      maxBatch: 64,
      retryBaseMs: 100,
      onError,
    })

    queue.enqueue('doc_1', update(1))
    queue.enqueue('doc_1', update(2))

    await vi.advanceTimersByTimeAsync(500)
    expect(calls).toHaveLength(0)
    expect(queue.depth).toBe(2)
    expect(onError).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)   // first retry, fails
    await vi.advanceTimersByTimeAsync(200)   // second retry, succeeds

    expect(calls).toHaveLength(1)
    expect(calls[0]!.rows.map((r) => r.update[0])).toEqual([1, 2])
    expect(queue.depth).toBe(0)
  })

  it('does not lose updates enqueued during a failed flush', async () => {
    const { sink, calls } = failingSink(1)
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64, retryBaseMs: 100 })

    queue.enqueue('doc_1', update(1))
    await vi.advanceTimersByTimeAsync(500)   // fails, row 1 goes back

    queue.enqueue('doc_1', update(2))
    await vi.advanceTimersByTimeAsync(100)   // retry succeeds

    expect(calls[0]!.rows.map((r) => r.update[0])).toEqual([1, 2])
  })

  it('flushes everything on close', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    queue.enqueue('doc_1', update(1))
    await queue.close()

    expect(calls).toHaveLength(1)
    expect(queue.depth).toBe(0)
  })

  it('puts a failed batch back ahead of updates that arrived during the write', async () => {
    // The merge order is only observable when something lands while append is
    // pending. Without that, a reversed merge produces the same array and the
    // test cannot fail — see "does not lose updates enqueued during a failed
    // flush" above, which enqueues only after the failure has already resolved.
    let releaseAppend: (() => void) | undefined
    const calls: Array<{ documentId: string; rows: PendingUpdate[] }> = []
    let attempts = 0

    const sink: UpdateSink = {
      append: async (documentId, rows) => {
        attempts += 1
        if (attempts === 1) {
          await new Promise<void>((resolve) => { releaseAppend = resolve })
          throw new Error('postgres is down')
        }
        calls.push({ documentId, rows })
      },
    }

    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64, retryBaseMs: 100 })

    queue.enqueue('doc_1', update(1))
    const flushing = queue.flush()
    await vi.advanceTimersByTimeAsync(0)   // let append start and block

    queue.enqueue('doc_1', update(2))      // lands while the first write is pending
    releaseAppend?.()                      // now let the first write fail
    await flushing

    await queue.flush()                    // drive the retry directly

    expect(calls).toHaveLength(1)
    expect(calls[0]!.rows.map((r) => r.update[0])).toEqual([1, 2])
  })

  it('does not let one poisoned document block others in the same drain pass', async () => {
    const calls: Array<{ documentId: string; rows: PendingUpdate[] }> = []
    const sink: UpdateSink = {
      append: async (documentId, rows) => {
        if (documentId === 'doc_poison') throw new Error('always fails')
        calls.push({ documentId, rows })
      },
    }
    const onError = vi.fn()
    const queue = new UpdateQueue(sink, {
      flushIntervalMs: 500,
      maxBatch: 64,
      retryBaseMs: 100,
      onError,
    })

    // The poisoned document is enqueued first, so the old code (which `return`ed on
    // the first failure instead of continuing) would abandon everything after it.
    queue.enqueue('doc_poison', update(1))
    queue.enqueue('doc_healthy_a', update(2))
    queue.enqueue('doc_healthy_b', update(3))

    await queue.flush()

    expect(calls.map((c) => c.documentId).sort()).toEqual(['doc_healthy_a', 'doc_healthy_b'])
    expect(queue.depth).toBe(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('does not spin forever within one pass on a document that always fails', async () => {
    let attempts = 0
    const sink: UpdateSink = {
      append: async () => {
        attempts += 1
        throw new Error('always fails')
      },
    }
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64, retryBaseMs: 100 })

    queue.enqueue('doc_poison', update(1))
    await queue.flush()

    // Exactly one attempt this pass — proves drain() didn't cycle back around and
    // retry the same still-failing document again before returning control.
    expect(attempts).toBe(1)
    expect(queue.depth).toBe(1)
  })

  it('close() warns when depth remains non-zero after the final drain attempt', async () => {
    const sink: UpdateSink = {
      append: async () => { throw new Error('postgres is down') },
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64, retryBaseMs: 100 })

    queue.enqueue('doc_1', update(1))
    await queue.close()

    expect(queue.depth).toBeGreaterThan(0)
    expect(warnSpy).toHaveBeenCalled()
    const logged = warnSpy.mock.calls.map((args) => args.join(' ')).join('\n')
    expect(logged).toContain('depth')

    warnSpy.mockRestore()
  })

  it('does not warn on close() when everything drained cleanly', async () => {
    const { sink } = recordingSink()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    queue.enqueue('doc_1', update(1))
    await queue.close()

    expect(queue.depth).toBe(0)
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('depth still reports pending rows while a write is hanging', async () => {
    const sink: UpdateSink = {
      append: () => new Promise<void>(() => {}), // never resolves
    }
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    queue.enqueue('doc_1', update(1))
    queue.enqueue('doc_1', update(2))
    await vi.advanceTimersByTimeAsync(500)   // flush fires, append hangs forever

    expect(queue.depth).toBe(2)
  })
})
