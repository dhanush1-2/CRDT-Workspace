import * as Y from 'yjs'
import { Prisma, type PrismaClient } from '@crdt/db'
import type { PendingUpdate, UpdateSink } from './update-queue.js'

export interface DocumentStoreOptions {
  snapshotEvery?: number
}

/**
 * Which foreign key a P2003 came from. On this Prisma version (driver adapter) `meta`
 * carries no `field_name`; the violated constraint name arrives at
 * `meta.driverAdapterError.cause.constraint.index`, e.g. "DocumentUpdate_userId_fkey".
 * `field_name` is still checked for the engine path that does supply it.
 */
function violatesUserForeignKey(error: Prisma.PrismaClientKnownRequestError): boolean {
  const meta = (error.meta ?? {}) as {
    field_name?: unknown
    driverAdapterError?: { cause?: { constraint?: { index?: unknown } } }
  }
  const named = [meta.field_name, meta.driverAdapterError?.cause?.constraint?.index]
  return named.some((value) => typeof value === 'string' && value.includes('userId'))
}

export class DocumentStore implements UpdateSink {
  private readonly snapshotEvery: number
  /** Updates appended since the last snapshot, per document. */
  private readonly sinceSnapshot = new Map<string, number>()
  /** Highest document_updates.id known to be durable, per document. */
  private readonly lastUpdateId = new Map<string, bigint>()

  constructor(
    private readonly prisma: PrismaClient,
    options: DocumentStoreOptions = {},
  ) {
    this.snapshotEvery = options.snapshotEvery ?? 100
  }

  /**
   * Rebuild a document's state as a single merged update: the newest snapshot,
   * plus every update recorded after it.
   */
  async load(documentId: string): Promise<Uint8Array | null> {
    const snapshot = await this.prisma.documentSnapshot.findFirst({
      where: { documentId },
      orderBy: { id: 'desc' },
      select: { state: true, throughUpdateId: true },
    })

    const updates = await this.prisma.documentUpdate.findMany({
      where: {
        documentId,
        ...(snapshot ? { id: { gt: snapshot.throughUpdateId } } : {}),
      },
      orderBy: { id: 'asc' },
      select: { id: true, update: true },
    })

    this.sinceSnapshot.set(documentId, updates.length)
    const newest = updates.at(-1)?.id ?? snapshot?.throughUpdateId ?? 0n
    this.lastUpdateId.set(documentId, newest)

    const parts: Uint8Array[] = []
    if (snapshot) parts.push(new Uint8Array(snapshot.state))
    for (const row of updates) parts.push(new Uint8Array(row.update))

    if (parts.length === 0) return null
    return Y.mergeUpdates(parts)
  }

  async append(documentId: string, rows: PendingUpdate[]): Promise<void> {
    if (rows.length === 0) return

    let created: Array<{ id: bigint }>
    try {
      created = await this.prisma.documentUpdate.createManyAndReturn({
        data: rows.map((row) => ({
          documentId,
          update: Buffer.from(row.update),
          clientId: row.clientId,
          userId: row.userId,
        })),
        select: { id: true },
      })
    } catch (error) {
      // Two foreign keys can produce P2003 now.
      //
      // A deleted document: the batch was still queued when the document went away
      // (this happens on every Playwright suite run, via the e2e fixtures' cleanup). It
      // can never succeed no matter how many times it is retried, unlike a transient
      // connection drop, so retrying forever would permanently pin sync_queue_depth
      // (the durability alarm) at a nonzero value. Treat it as a successful no-op: there
      // is nothing left to persist it for.
      //
      // A deleted user: only the attribution is impossible. Dropping the whole batch
      // would lose real edits to save a name, so retry once without the author.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        // The `rows.some` guard makes this terminate: the retry passes all-null rows, so
        // a second userId violation cannot recurse.
        if (violatesUserForeignKey(error) && rows.some((row) => row.userId !== null)) {
          console.error(
            JSON.stringify({
              level: 'error',
              msg: 'author no longer exists; persisting updates unattributed',
              documentId,
            }),
          )
          return this.append(
            documentId,
            rows.map((row) => ({ ...row, userId: null })),
          )
        }
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'dropping updates for a document that no longer exists',
            documentId,
          }),
        )
        return
      }
      throw error
    }

    let highest = this.lastUpdateId.get(documentId) ?? 0n
    for (const row of created) if (row.id > highest) highest = row.id
    this.lastUpdateId.set(documentId, highest)

    this.sinceSnapshot.set(documentId, (this.sinceSnapshot.get(documentId) ?? 0) + rows.length)
  }

  needsSnapshot(documentId: string): boolean {
    return (this.sinceSnapshot.get(documentId) ?? 0) >= this.snapshotEvery
  }

  /**
   * Compact the log. `throughUpdateId` is the newest update known to be durable,
   * which may be *behind* what the in-memory doc contains if a flush is in flight.
   * That is safe: the extra updates get re-applied on load, and Yjs updates are
   * idempotent. The reverse — claiming to include updates that are not in the
   * snapshot — cannot happen, because the doc is always a superset of what is durable.
   */
  async snapshot(documentId: string, doc: Y.Doc): Promise<void> {
    const throughUpdateId = this.lastUpdateId.get(documentId) ?? 0n

    await this.prisma.documentSnapshot.create({
      data: {
        documentId,
        state: Buffer.from(Y.encodeStateAsUpdate(doc)),
        throughUpdateId,
      },
    })

    this.sinceSnapshot.set(documentId, 0)
  }

  forget(documentId: string): void {
    this.sinceSnapshot.delete(documentId)
    this.lastUpdateId.delete(documentId)
  }
}
