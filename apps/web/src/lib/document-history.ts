import * as Y from 'yjs'
import { prisma } from '@crdt/db'

export type DocumentVersion = {
  /** The highest update id in this run, as a string: the id is a BigInt. */
  id: string
  startedAt: Date
  endedAt: Date
  /** Null for updates written before authorship existed, or by a deleted account. */
  author: { id: string; name: string } | null
  updateCount: number
}

/**
 * A run of updates by one author with no gap longer than this is one version.
 * Every few keystrokes persists a row, so without grouping an hour of typing is
 * thousands of entries nobody can read.
 */
export const VERSION_GAP_MINUTES = 5

/**
 * How many of the newest update rows the grouping considers.
 *
 * Grouping the whole log would scan the whole log on every request. This is a
 * backward scan of the (documentId, id) index, bounded, and covers far more rows
 * than the versions returned. The cost is that history older than this window is
 * not listed, and the oldest version listed is truncated if its run straddles the
 * scan boundary: it shows a late `startedAt` and a low `updateCount`, though its id
 * and author are still correct. The fix, if that ever matters, is a materialised version table
 * written as updates land, not a bigger number here.
 */
export const VERSION_SCAN_ROWS = 5000

type VersionRow = {
  id: bigint
  startedAt: Date
  endedAt: Date
  userId: string | null
  updateCount: bigint
}

export async function listVersions(documentId: string, limit = 50): Promise<DocumentVersion[]> {
  // Window functions, because the alternative — reading rows and grouping in JS —
  // ships every byte of every update's metadata to the app to throw most of it away.
  // `IS NOT DISTINCT FROM` rather than `=` so two null authors compare equal; `=`
  // returns null and every anonymous update would start its own version.
  const rows = await prisma.$queryRaw<VersionRow[]>`
    WITH recent AS (
      SELECT "id", "userId", "createdAt"
      FROM "DocumentUpdate"
      WHERE "documentId" = ${documentId}
      ORDER BY "id" DESC
      LIMIT ${VERSION_SCAN_ROWS}
    ),
    marked AS (
      SELECT
        "id",
        "userId",
        "createdAt",
        CASE
          WHEN lag("userId") OVER w IS NOT DISTINCT FROM "userId"
           AND "createdAt" - lag("createdAt") OVER w
               <= make_interval(mins => ${VERSION_GAP_MINUTES})
          THEN 0
          ELSE 1
        END AS boundary
      FROM recent
      WINDOW w AS (ORDER BY "id")
    ),
    grouped AS (
      SELECT "id", "userId", "createdAt", sum(boundary) OVER (ORDER BY "id") AS run
      FROM marked
    )
    SELECT
      max("id") AS "id",
      min("createdAt") AS "startedAt",
      max("createdAt") AS "endedAt",
      min("userId") AS "userId",
      count(*) AS "updateCount"
    FROM grouped
    GROUP BY run
    ORDER BY run DESC
    LIMIT ${limit}
  `

  // min("userId") is safe only because every row in a run shares one author — that
  // is what the boundary condition guarantees. It is used in place of an aggregate
  // that preserves nulls, since min() over a single repeated value returns it.
  const authorIds = [...new Set(rows.map((row) => row.userId).filter((id) => id !== null))]
  const authors = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true },
      })
    ).map((user) => [user.id, user]),
  )

  return rows.map((row) => ({
    id: String(row.id),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    // A userId with no User row means the account was deleted between the two
    // queries. Unknown, not a crash and not a fabricated name.
    author: row.userId === null ? null : (authors.get(row.userId) ?? null),
    updateCount: Number(row.updateCount),
  }))
}

/**
 * The most update rows a single version preview will replay. Past this the request is
 * refused (413) rather than loading an unbounded log into memory on a small instance.
 */
export const STATE_REPLAY_MAX_ROWS = 20_000

export class VersionTooLargeError extends Error {
  constructor(
    readonly rows: number,
    readonly limit: number,
  ) {
    super(`version needs ${rows} update rows, over the ${limit} replay limit`)
    this.name = 'VersionTooLargeError'
  }
}

/**
 * The document's state as of `versionId`, as one merged Yjs update.
 *
 * Built from the update rows alone: every row with `id <= versionId`, in id order.
 * Snapshots are deliberately not used. The sync server writes a snapshot as the
 * encoding of its live in-memory doc, which already holds edits still queued for
 * persistence, while `throughUpdateId` is only the last row that reached the table.
 * Those queued edits become rows with higher ids, so a snapshot may contain changes
 * after the id it claims to cover, and using it here would show (and restore) edits
 * made after the requested version. Update rows are never deleted by the app (only
 * by the document's cascade), so the rows are always a complete, exact history.
 *
 * A later optimisation could start from a snapshot, but only with snapshots that are
 * exact (state encoded at the recorded id) and a way to tell them from the legacy
 * ones already written, which lag.
 */
export async function stateAtVersion(
  documentId: string,
  versionId: bigint,
  maxRows = STATE_REPLAY_MAX_ROWS,
): Promise<Uint8Array | null> {
  // Cost is O(rows <= versionId): every one of them is loaded and merged on each call.
  // Counting first is a cheap index range count that stops an old, busy document from
  // pulling its whole log into memory.
  const rows = await prisma.documentUpdate.count({
    where: { documentId, id: { lte: versionId } },
  })
  if (rows > maxRows) throw new VersionTooLargeError(rows, maxRows)

  const updates = await prisma.documentUpdate.findMany({
    where: { documentId, id: { lte: versionId } },
    orderBy: { id: 'asc' },
    select: { update: true },
  })

  if (updates.length === 0) return null
  // Prisma returns Bytes columns as Uint8Array, which mergeUpdates takes as is.
  return Y.mergeUpdates(updates.map((row) => row.update))
}
