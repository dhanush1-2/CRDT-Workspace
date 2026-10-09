import type { PrismaClient } from '@crdt/db'

export const SCHEMA_NOT_READY_MESSAGE =
  'DocumentUpdate.userId is missing: run prisma migrate deploy before deploying this version'

export class SchemaNotReadyError extends Error {
  constructor(cause: unknown) {
    super(`${SCHEMA_NOT_READY_MESSAGE} (${String(cause)})`, { cause })
    this.name = 'SchemaNotReadyError'
  }
}

/**
 * Fails if the database does not have the columns this version writes.
 *
 * Without it, a deploy that lands before its migration makes every insert fail with
 * an error `append` rightly treats as transient, so the queue retries forever, the
 * health check stays green, and edits live only in memory until the free-tier
 * service sleeps. A process that refuses to start never passes the platform's
 * health check, so the previous instance keeps serving.
 *
 * `LIMIT 0` makes it a planning-only query: it errors on a missing column and
 * reads no rows.
 */
export async function assertSchemaReady(prisma: Pick<PrismaClient, '$queryRaw'>): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT "userId" FROM "DocumentUpdate" LIMIT 0`
  } catch (error) {
    throw new SchemaNotReadyError(error)
  }
}
