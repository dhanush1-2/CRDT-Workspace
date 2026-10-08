import { prisma } from '@crdt/db'
import { loadConfig } from './config.js'
import { createSyncServer } from './server.js'
import { DocumentStore } from './store.js'
import { UpdateQueue, type UpdateSink } from './update-queue.js'
import { Metrics } from './metrics.js'

const config = loadConfig()

const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, ...extra, at: new Date().toISOString() }))

const metrics = new Metrics()

const store = new DocumentStore(prisma, { snapshotEvery: 100 })

// Wraps the store's `append` so every flush to Postgres is timed, without teaching
// the store itself about metrics. `snapshot` is instrumented separately below, where
// it's actually called (it isn't part of the queue's write path).
const instrumentedSink: UpdateSink = {
  async append(documentId, rows) {
    const started = performance.now()
    await store.append(documentId, rows)
    metrics.observe('sync_flush_duration_seconds', (performance.now() - started) / 1000)
  },
}

const queue = new UpdateQueue(instrumentedSink, {
  flushIntervalMs: 500,
  maxBatch: 64,
  onError: (error, attempt) =>
    log('error', 'update flush failed', { attempt, error: String(error) }),
})

setInterval(() => metrics.set('sync_queue_depth', queue.depth), 1000).unref()

const server = await createSyncServer({
  port: config.port,
  jwtSecret: config.jwtSecret,
  idleEvictMs: config.idleEvictMs,
  metrics,
  loadDocument: (documentId) => store.load(documentId),
  onPersist: (documentId, update, clientId, userId) =>
    queue.enqueue(documentId, { update, clientId, userId }),
  onDocumentPersisted: async (documentId, doc) => {
    if (store.needsSnapshot(documentId)) {
      await store.snapshot(documentId, doc)
      metrics.inc('sync_snapshot_total')
    }
  },
  onReject: (documentId, reason) => log('warn', 'frame rejected', { documentId, reason }),
})

log('info', 'sync server listening', { port: server.port })

let shuttingDown = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    log('info', 'draining update queue before exit', { depth: queue.depth })
    void queue
      .close()
      .then(() => server.close())
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        // A throw anywhere in this chain would otherwise leave the process hanging
        // instead of exiting — the opposite of a clean shutdown. Log and force exit
        // non-zero so an orchestrator (or a human) notices instead of waiting forever.
        log('error', 'shutdown failed', { error: String(error) })
        process.exit(1)
      })
  })
}
