export interface PendingUpdate {
  update: Uint8Array
  clientId: string
  /** Null for updates the server originates, and never backfilled. */
  userId: string | null
}

export interface UpdateSink {
  append(documentId: string, rows: PendingUpdate[]): Promise<void>
}

export interface UpdateQueueOptions {
  flushIntervalMs?: number
  maxBatch?: number
  retryBaseMs?: number
  maxRetryDelayMs?: number
  onError?(error: unknown, attempt: number): void
}

/**
 * Buffers updates in memory and writes them to the sink in batches.
 *
 * The point is that persistence never sits in the broadcast path: a slow or dead
 * database degrades durability, not collaboration. The cost is a bounded window
 * (flushIntervalMs) of updates that exist only in memory, which close() drains on
 * SIGTERM so planned restarts lose nothing.
 */
export class UpdateQueue {
  private readonly buffers = new Map<string, PendingUpdate[]>()
  private readonly flushIntervalMs: number
  private readonly maxBatch: number
  private readonly retryBaseMs: number
  private readonly maxRetryDelayMs: number

  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()
  /** Retry attempt count per document, so one poisoned document's backoff doesn't
   *  reset or inflate every other document's. */
  private readonly retryAttempts = new Map<string, number>()
  private closed = false
  private inFlight = 0

  constructor(
    private readonly sink: UpdateSink,
    private readonly options: UpdateQueueOptions = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? 500
    this.maxBatch = options.maxBatch ?? 64
    this.retryBaseMs = options.retryBaseMs ?? 100
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 10_000
  }

  get depth(): number {
    let total = this.inFlight
    for (const rows of this.buffers.values()) total += rows.length
    return total
  }

  enqueue(documentId: string, pending: PendingUpdate): void {
    if (this.closed) throw new Error('queue is closed')

    const rows = this.buffers.get(documentId)
    if (rows) rows.push(pending)
    else this.buffers.set(documentId, [pending])

    if (this.depth >= this.maxBatch) void this.flush()
    else this.schedule(this.flushIntervalMs)
  }

  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.drain())
    return this.chain
  }

  async close(): Promise<void> {
    this.closed = true
    this.clearTimer()
    await this.flush()

    // A SIGTERM drain is supposed to be the last chance to make everything durable.
    // If anything is still buffered after that one attempt (a document whose sink
    // write keeps failing), say so loudly rather than exiting as if nothing were
    // lost — this is the durability alarm, and a silent success here is exactly the
    // failure mode that let it stay silently wrong.
    if (this.depth > 0) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'update queue could not fully drain before shutdown; updates remain unpersisted',
          depth: this.depth,
        }),
      )
    }
  }

  private schedule(delayMs: number): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delayMs)
    // Do not hold the process open just because a flush is pending.
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private async drain(): Promise<void> {
    // A document that fails goes back into `buffers` (moved to the end, since Map
    // re-insertion on an existing key changes iteration order) so any other document
    // still gets its turn. Without tracking what this pass has already tried, that
    // same re-insertion would let a permanently-failing document cycle back around
    // and spin forever within a single drain() call once it's the only thing left.
    // Once a document has failed once this pass, leave it for the next scheduled
    // retry instead of hammering it again immediately.
    const failedThisPass = new Set<string>()

    while (this.buffers.size > 0) {
      const entry = this.buffers.entries().next()
      if (entry.done) return

      const [documentId, rows] = entry.value
      if (failedThisPass.has(documentId)) break

      this.buffers.delete(documentId)
      this.inFlight = rows.length

      try {
        await this.sink.append(documentId, rows)
        this.retryAttempts.delete(documentId)
      } catch (error) {
        // Put the batch back at the front so ordering within the document survives,
        // ahead of anything enqueued while the write was in flight.
        const arrived = this.buffers.get(documentId) ?? []
        this.buffers.set(documentId, [...rows, ...arrived])
        failedThisPass.add(documentId)

        const attempt = (this.retryAttempts.get(documentId) ?? 0) + 1
        this.retryAttempts.set(documentId, attempt)
        this.options.onError?.(error, attempt)

        if (!this.closed) {
          const delay = Math.min(
            this.retryBaseMs * 2 ** (attempt - 1),
            this.maxRetryDelayMs,
          )
          this.schedule(delay)
        }
        // Don't let one poisoned document abandon the rest of this pass — a failed
        // write here used to `return` immediately, silently skipping every other
        // document still buffered, which is exactly what let a SIGTERM drain report
        // success while dropping other documents' updates.
        continue
      } finally {
        // Cleared after the catch has restored rows to the buffer, so depth
        // never momentarily reports zero while data is still unpersisted.
        this.inFlight = 0
      }
    }
  }
}
