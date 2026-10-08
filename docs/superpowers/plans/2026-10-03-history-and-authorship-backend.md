# History and Authorship Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "who changed this, and what did it look like before?" answerable. Record the author on every persisted update, serve a grouped version list and the document state at any version, and provide the two restore primitives that turn a past state into a new edit.

**Architecture:** Updates gain a nullable `userId`. The sync server already authenticates every socket and keeps `userId` on the connection, so the author is in hand at the moment an update is persisted — the change is a column and a value passed along a path that already exists. Two read-only API routes serve the version list and the state at a version. Restore is deliberately **not** a route: it is a client operation that writes the past state into the live document through the normal socket, which is the only way it can be a real CRDT merge, inherit the per-frame role check, and be attributed to whoever performed it.

**Tech Stack:** Prisma 7 with `@prisma/adapter-pg` (no Rust engine), Postgres, Yjs 13.6, `@tiptap/y-tiptap` (`updateYFragment`), Next.js 16 route handlers, Zod 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-02-history-and-telemetry-design.md` — Decision 1 (authorship on the update row), Decision 2 (restore is a new update, accept the merge, editor or better), and the `## Derived: what the backend must expose` table.

## Refreshed 2026-10-07

Written at `dd4e0e0`. One correction since: `f7a5cac` removed Tiptap's `FontFamily` and `FontSize` from the schema (their `parseHTML` accepts any pasted value), so `textStyle` carries `color` only until `2026-10-07-document-gaps.md` adds curated `fontFamily`/`fontSize` back. The coverage constraint and Task 5's fourth test are adjusted to read the attributes from the schema rather than assume them. Baseline at `f7a5cac`: Vitest 282, Playwright 157, 14 routes. Order: independent of the shell plan (no UI); must run before `history-panel-and-preview` and `connection-states-and-telemetry`.

## Global Constraints

- **Decision 2's substance is binding; its mechanism in the capability table is not.** The table lists `POST /api/documents/[id]/history/[snapshotId]/restore`. This plan does not build that route, and Task 6 amends the spec to say why: a server-side restore would have to reimplement the ProseMirror schema on the server, would bypass the per-frame role enforcement the sync protocol already applies, and would have to invent an authorship story for an update with no connection behind it. Everything Decision 2 actually decided — restore is applied as another update, the merge is accepted, no locking, viewers cannot restore, the UI must not promise an exact revert — is preserved exactly.
- **A document can only be restored by a schema that includes every mark and node it carries.** A mark present in a document but absent from the schema used to read it is dropped silently, with no error anywhere, and a restore writes that loss back into the live document as ordinary edits. The document formatting toolbar (`2026-10-03-document-formatting-toolbar.md`, built) added to what a document can hold: the marks `textStyle` (carrying colour; and, once `2026-10-07-document-gaps.md` has run, the curated `fontFamily` and `fontSize` ids), `highlight`, `underline` and `strike`, the `textAlign` attribute on headings and paragraphs, and the nodes `table`, `tableRow`, `tableCell`, `tableHeader`, `codeBlock` and `horizontalRule`. All of them are in `editorExtensions`, and `restoreEditor` reads `getEditorSchema()`, which is built from that same list. **The editor, `getEditorSchema()` and `restoreEditor` must never drift apart**: a new mark or node is added to `editorExtensions` and nowhere else, and this plan's `restore-editor.test.ts` must carry a document using every one of the above through a restore (Task 5, Step 7).
- **No UI in this plan.** The history panel, the version preview bar and the status popover are a separate plan; this one ends at the API and the primitives. Build no components.
- **The database on port 5433 is shared across checkouts.** Never start, stop or restart it. The migration here is additive and the new column is nullable, so other checkouts running older code are unaffected — but say so in the task report, because applying a migration to a shared database is a side effect beyond this worktree.
- Never touch `.env`, `docker-compose.yml` or `docker-compose.override.yml`. Never run any `fly` command. Never use bare `git stash` / `git stash pop` — the stash stack is shared with other worktrees.
- **`DocumentUpdate.id` is a `BigInt`.** `Response.json` throws `TypeError: Do not know how to serialize a BigInt`. Every id crossing an API boundary is a string.
- **Authorship is nullable and must stay nullable.** Every row written before this migration has no author, and inventing one would be fabricating history. Every reader handles `null` and renders it as unknown — never crashes, never silently attributes it to somebody.
- Existing roles are the only access control: `viewer` may read history, `editor` and `owner` may write. Reading history is a read.
- Every test proven to discriminate: run it against the unfixed code and watch it fail, or mutate the fix and watch it fail. **Commit before mutating** — `git checkout --` silently does nothing on an untracked file, which has bitten this project.
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build`, `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. **Record the baseline before Task 1** and compare against it.
- Integration tests in this repo are named `*.integration.test.ts` and talk to the real database. Follow that convention; do not mock Prisma.

## Decisions made while writing this plan

These are mine, not the owner's. Each is a place the spec was silent and something had to be chosen.

- **Versions are grouped, not raw update rows.** Every few keystrokes persists a row; a document with an hour of typing has thousands. A version is a run of consecutive updates by the same author with no gap longer than **5 minutes**. Its id is the highest update id in the run, which is exactly the point you would restore to.
- **The grouping scan is bounded to the most recent 5,000 update rows.** Grouping the whole log means scanning the whole log on every request. 5,000 rows is a backward index scan on `(documentId, id)` and covers far more than the 50 versions returned. The consequence — history older than that window is not listed — is a real limitation, recorded in Task 6, with a materialised version table as the fix if it ever matters.
- **State-at-a-version is served as raw bytes**, `application/octet-stream`, not base64 JSON. The client applies it to a throwaway `Y.Doc`; base64 would inflate it by a third for nothing.
- **The two restore primitives live in different packages**, because one is pure Yjs and one is not. `restoreBoard` goes in `packages/shared/src/board.ts` beside the other board operations. `restoreEditor` needs a ProseMirror schema and `@tiptap/y-tiptap`, so it lives in the web app and runs on the client.
- **Restore is field-level, never delete-and-recreate.** `moveCard`'s comment explains why: deleting and re-creating a card's map entry destroys a concurrent title edit and can put a card in two columns. Restore writes the same way.

---

### Task 1: Record the author on every update

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261003000000_update_authorship/migration.sql`
- Test: `packages/db/test/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DocumentUpdate.userId: string | null`, with a `User.updates` back-relation and `onDelete: SetNull`.

- [ ] **Step 1: Read the existing schema test**

Read `packages/db/test/schema.test.ts` first and follow whatever it asserts about models. Add to it rather than inventing a parallel style.

- [ ] **Step 2: Write the failing test**

Add to `packages/db/test/schema.test.ts`:

```ts
it('records the author of an update, and keeps the update when the author is deleted', async () => {
  // Seeded through the real client, so this exercises the column, the relation and
  // the referential action together.
  const user = await prisma.user.create({
    data: { email: 'authorship@test.local', name: 'Author' },
  })
  const workspace = await prisma.workspace.create({
    data: { name: 'authorship', ownerId: user.id },
  })
  const document = await prisma.document.create({
    data: { workspaceId: workspace.id, type: 'doc', title: 'authorship' },
  })

  const authored = await prisma.documentUpdate.create({
    data: {
      documentId: document.id,
      update: Buffer.from([1, 2, 3]),
      clientId: 'conn-1',
      userId: user.id,
    },
    select: { id: true, userId: true },
  })
  expect(authored.userId).toBe(user.id)

  // Nullable on purpose: every row written before this migration has no author, and
  // a server-originated update has no connection behind it.
  const anonymous = await prisma.documentUpdate.create({
    data: { documentId: document.id, update: Buffer.from([4]), clientId: 'server' },
    select: { userId: true },
  })
  expect(anonymous.userId).toBeNull()

  // Deleting an account must not delete the document's history. SetNull, not Cascade:
  // the change stays, the attribution goes.
  await prisma.user.delete({ where: { id: user.id } })
  const after = await prisma.documentUpdate.findUnique({
    where: { id: authored.id },
    select: { userId: true },
  })
  expect(after).not.toBeNull()
  expect(after!.userId).toBeNull()

  await prisma.workspace.delete({ where: { id: workspace.id } })
})
```

Deleting the user cascades to `WorkspaceMember` but not to `Workspace` (which has a plain `ownerId` with no relation), so the explicit workspace delete at the end is the cleanup. Check the file's existing cleanup pattern and match it.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @crdt/db exec vitest run test/schema.test.ts`
Expected: FAIL — `userId` is not a known field of `DocumentUpdateCreateInput`.

- [ ] **Step 4: Change the schema**

In `packages/db/prisma/schema.prisma`:

```prisma
model User {
  id           String            @id @default(cuid())
  email        String            @unique
  name         String
  passwordHash String?
  createdAt    DateTime          @default(now())
  memberships  WorkspaceMember[]
  accounts     Account[]
  updates      DocumentUpdate[]
}

model DocumentUpdate {
  id         BigInt   @id @default(autoincrement())
  documentId String
  update     Bytes
  clientId   String
  /// Who made this change. Null for rows written before authorship existed, and for
  /// updates the server originates with no connection behind them.
  userId     String?
  createdAt  DateTime @default(now())
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user       User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([documentId, id])
  @@index([userId])
}
```

The `userId` index is for the foreign key, which Postgres does not index automatically; without it, deleting a user scans every update row.

- [ ] **Step 5: Write the migration by hand**

This repo's migrations are hand-named (`20260921120000_oauth_accounts`), so write the SQL rather than letting `migrate dev` invent a name. Create `packages/db/prisma/migrations/20261003000000_update_authorship/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "DocumentUpdate" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "DocumentUpdate_userId_idx" ON "DocumentUpdate"("userId");

-- AddForeignKey
ALTER TABLE "DocumentUpdate" ADD CONSTRAINT "DocumentUpdate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Nullable with no default and no backfill: adding a nullable column is a metadata-only change in Postgres, so it does not rewrite the table.

- [ ] **Step 6: Apply it and regenerate the client**

Run: `pnpm --filter @crdt/db exec prisma migrate dev` then `pnpm --filter @crdt/db run generate`

`migrate dev` applies the pending migration without creating a new one when the schema already matches it. If it instead reports drift or offers to reset, **stop and report** — a reset would destroy data in a database shared with other checkouts. Never answer yes to a reset prompt.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @crdt/db exec vitest run test/schema.test.ts`
Expected: PASS.

- [ ] **Step 8: Prove the referential action discriminates**

Commit first. Then change `onDelete: SetNull` to `onDelete: Cascade` in the schema only (do not migrate), and confirm `prisma validate` still passes while the test's intent would now be wrong — then restore it. The real proof is the test's `expect(after).not.toBeNull()` against the applied migration: note in the report that the SQL says `ON DELETE SET NULL` and that the test observes the row surviving.

- [ ] **Step 9: Run the full gate**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/db
git commit -m "feat(db): record who authored each document update

Nullable: rows written before this have no author, and backfilling one would be
inventing history. SetNull on user delete, because deleting an account must not
delete a document's history."
```

---

### Task 2: Thread the author from the socket to the row

The sync server already verifies a signed doc token per socket and keeps `userId` on the connection. This carries that value down the path the update already takes.

**Files:**
- Modify: `apps/sync/src/room.ts`
- Modify: `apps/sync/src/server.ts`
- Modify: `apps/sync/src/update-queue.ts`
- Modify: `apps/sync/src/store.ts`
- Modify: `apps/sync/src/index.ts`
- Test: `apps/sync/test/room.test.ts`, `apps/sync/test/store.integration.test.ts`, `apps/sync/test/server.integration.test.ts`

**Interfaces:**
- Consumes: `DocumentUpdate.userId` from Task 1.
- Produces:
  - `RoomOptions.onPersist(update: Uint8Array, clientId: string, userId: string | null): void`
  - `SyncServerOptions.onPersist?(documentId: string, update: Uint8Array, clientId: string, userId: string | null): void`
  - `PendingUpdate = { update: Uint8Array; clientId: string; userId: string | null }`

- [ ] **Step 1: Write the failing tests**

In `apps/sync/test/room.test.ts`, add:

```ts
it('reports the connection\'s user as the author of an update', () => {
  const persisted: { clientId: string; userId: string | null }[] = []
  const room = new DocumentRoom('doc-1', {
    onPersist: (_update, clientId, userId) => persisted.push({ clientId, userId }),
  })
  // Follow this file's existing helper for building a Connection; it needs
  // id/userId/role/send/close.
  const conn = connectionFor({ id: 'conn-1', userId: 'user-1', role: 'editor' })
  room.add(conn)

  room.doc.getText('t').insert(0, 'hello', conn)

  expect(persisted).toEqual([{ clientId: 'conn-1', userId: 'user-1' }])
})

it('reports no author for an update with no connection behind it', () => {
  const persisted: { clientId: string; userId: string | null }[] = []
  const room = new DocumentRoom('doc-1', {
    onPersist: (_update, clientId, userId) => persisted.push({ clientId, userId }),
  })

  // No origin: the server itself changed the document. There is no user to name, and
  // naming one would be a lie about who did it.
  room.doc.getText('t').insert(0, 'hello')

  expect(persisted).toEqual([{ clientId: 'server', userId: null }])
})
```

In `apps/sync/test/store.integration.test.ts`, add a case asserting that `append` writes the `userId` through, including a `null` row in the same batch as an authored one:

```ts
it('writes each row\'s author, including none', async () => {
  // Seed a document and a user following this file's existing fixtures.
  await store.append(documentId, [
    { update: new Uint8Array([1]), clientId: 'conn-1', userId: user.id },
    { update: new Uint8Array([2]), clientId: 'server', userId: null },
  ])

  const rows = await prisma.documentUpdate.findMany({
    where: { documentId },
    orderBy: { id: 'asc' },
    select: { clientId: true, userId: true },
  })
  expect(rows).toEqual([
    { clientId: 'conn-1', userId: user.id },
    { clientId: 'server', userId: null },
  ])
})
```

In `apps/sync/test/server.integration.test.ts`, add the end-to-end assertion: connect with a doc token for a known user, send an update, and assert the `onPersist` callback received that user id. This is the one that proves the wiring rather than the parts.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @crdt/sync exec vitest run`
Expected: FAIL — `onPersist` takes two arguments, and `PendingUpdate` has no `userId`.

- [ ] **Step 3: Change the room**

`apps/sync/src/room.ts`:

```ts
export interface RoomOptions {
  onPersist(update: Uint8Array, clientId: string, userId: string | null): void
  onReject?(reason: string, conn: Connection): void
}
```

and in the `doc.on('update')` handler:

```ts
        const sender = origin as Connection | undefined
        this.broadcast(encodeUpdate(update), sender)
        // The connection carries the verified user from its doc token, so the author
        // is known here without a lookup. No connection means the server itself made
        // the change and there is nobody to attribute it to.
        this.options.onPersist(update, sender?.id ?? 'server', sender?.userId ?? null)
```

`origin` is typed as `Connection | undefined` already, but a plain object with no `userId` would read as `undefined` and become `null`, which is the correct outcome rather than a crash.

- [ ] **Step 4: Change the server, the queue and the store**

`apps/sync/src/server.ts`: widen `SyncServerOptions.onPersist` to the four-argument form and pass the third along:

```ts
        onPersist: (update, clientId, userId) => {
          metrics.inc('sync_updates_received_total', { role: 'writer' })
          options.onPersist?.(documentId, update, clientId, userId)
          // … the snapshot call below is unchanged
        },
```

`apps/sync/src/update-queue.ts`:

```ts
export interface PendingUpdate {
  update: Uint8Array
  clientId: string
  /** Null for updates the server originates, and never backfilled. */
  userId: string | null
}
```

`apps/sync/src/store.ts`, inside `createManyAndReturn`:

```ts
        data: rows.map((row) => ({
          documentId,
          update: Buffer.from(row.update),
          clientId: row.clientId,
          userId: row.userId,
        })),
```

`apps/sync/src/index.ts`:

```ts
  onPersist: (documentId, update, clientId, userId) =>
    queue.enqueue(documentId, { update, clientId, userId }),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @crdt/sync exec vitest run`
Expected: PASS.

- [ ] **Step 6: Check the foreign key cannot break persistence**

`store.append` already treats `P2003` (foreign key violation) as a successful no-op, logged, because a deleted document makes the write permanently impossible. The new `userId` foreign key introduces a second way to hit `P2003`: an update from a user whose account was deleted mid-session.

Decide and record: that row would be dropped silently along with the whole batch, which is worse than losing the attribution. Make the handler distinguish them — retry the batch once with `userId: null` when the violating constraint is the user one, and keep the existing drop-and-log only for the document constraint:

```ts
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        // Two foreign keys can produce this now. A deleted document means the write
        // can never succeed — drop it. A deleted user means only the attribution is
        // impossible, and dropping the whole batch would lose real edits to save a
        // name, so retry once without the author.
        const field = String(error.meta?.field_name ?? '')
        if (field.includes('userId') && rows.some((row) => row.userId !== null)) {
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
        console.error(/* … the existing document-gone log, unchanged … */)
        return
      }
```

The `rows.some(...)` guard is what makes this terminate: the retry passes all-null rows, so a second `userId` violation cannot recurse.

Add a test for it in `store.integration.test.ts`: append with a `userId` that does not exist in `User`, then assert the rows landed with `userId: null` rather than being dropped.

Verify the `field_name` meta actually contains the constraint name on this Prisma version by logging it from the test once — if it does not, match on the constraint name from `error.meta` by whatever key is present, and report what you found. Do not ship a branch keyed on a field you have not observed.

- [ ] **Step 7: Prove the tests discriminate**

Commit first. Then:
1. Change `sender?.userId ?? null` to `null` and re-run. Expected: the room test and the server integration test both fail.
2. Remove `userId: row.userId` from the store's `data` mapping and re-run. Expected: the store test fails with `null` where an id was expected.
3. Remove the `rows.some(...)` guard and point a row at a missing user. Expected: infinite recursion or a stack overflow — which is why the guard is there. Restore it immediately.

- [ ] **Step 8: Run the full gate**

Run: `pnpm typecheck && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: all green. The Playwright suite exercises the real sync server, so a break in this path shows up there.

- [ ] **Step 9: Commit**

```bash
git add apps/sync
git commit -m "feat(sync): attribute each persisted update to the connection's user

The socket is already authenticated and the connection already carries the user,
so this is a value passed along a path that existed. A deleted author degrades to
an unattributed row rather than dropping the batch."
```

---

### Task 3: The version list and the state at a version

The read side, as a library with integration tests, before any route wraps it.

**Files:**
- Create: `apps/web/src/lib/document-history.ts`
- Test: `apps/web/test/document-history.integration.test.ts`

**Interfaces:**
- Consumes: `DocumentUpdate.userId` (Task 1).
- Produces:
  - `type DocumentVersion = { id: string; startedAt: Date; endedAt: Date; author: { id: string; name: string } | null; updateCount: number }`
  - `listVersions(documentId: string, limit?: number): Promise<DocumentVersion[]>` — newest first
  - `stateAtVersion(documentId: string, versionId: bigint): Promise<Uint8Array | null>`
  - `const VERSION_GAP_MINUTES = 5`, `const VERSION_SCAN_ROWS = 5000`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/document-history.integration.test.ts`:

```ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { prisma } from '@crdt/db'
import { listVersions, stateAtVersion } from '../src/lib/document-history.js'

const LABEL = 'history-integration'

// Rows are inserted with explicit createdAt values so the grouping window is
// exercised deterministically rather than depending on how fast the test runs.
async function appendUpdate(
  documentId: string,
  update: Uint8Array,
  userId: string | null,
  createdAt: Date,
) {
  return prisma.documentUpdate.create({
    data: { documentId, update: Buffer.from(update), clientId: 'test', userId, createdAt },
    select: { id: true },
  })
}

describe('document history', () => {
  let documentId: string
  let alice: { id: string; name: string }
  let bob: { id: string; name: string }
  let ids: bigint[]

  beforeAll(async () => {
    alice = await prisma.user.create({
      data: { email: `${LABEL}-alice@test.local`, name: 'Alice' },
      select: { id: true, name: true },
    })
    bob = await prisma.user.create({
      data: { email: `${LABEL}-bob@test.local`, name: 'Bob' },
      select: { id: true, name: true },
    })
    const workspace = await prisma.workspace.create({
      data: { name: LABEL, ownerId: alice.id },
    })
    const document = await prisma.document.create({
      data: { workspaceId: workspace.id, type: 'doc', title: LABEL },
    })
    documentId = document.id

    // Three real Yjs updates on one text type, so the state at each point is
    // checkable rather than opaque bytes.
    const doc = new Y.Doc()
    const updates: Uint8Array[] = []
    doc.on('update', (update: Uint8Array) => updates.push(update))
    doc.getText('t').insert(0, 'one ')
    doc.getText('t').insert(4, 'two ')
    doc.getText('t').insert(8, 'three')

    const base = new Date('2026-10-01T10:00:00.000Z')
    const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000)
    ids = []
    // Alice twice within the window, then Bob, then Alice again after a long gap.
    ids.push((await appendUpdate(documentId, updates[0]!, alice.id, at(0))).id)
    ids.push((await appendUpdate(documentId, updates[1]!, alice.id, at(1))).id)
    ids.push((await appendUpdate(documentId, updates[2]!, bob.id, at(2))).id)
    ids.push((await appendUpdate(documentId, new Uint8Array(updates[0]!), null, at(90))).id)
  })

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: LABEL } })
    await prisma.user.deleteMany({ where: { email: { contains: `${LABEL}-` } } })
  })

  it('collapses a run of one author\'s updates into one version', async () => {
    const versions = await listVersions(documentId)

    // Four rows, three versions: Alice's two adjacent updates are one editing run.
    expect(versions).toHaveLength(3)
    expect(versions.map((version) => version.updateCount)).toEqual([1, 1, 2])
  })

  it('returns versions newest first, with the author and the run\'s span', async () => {
    const versions = await listVersions(documentId)

    expect(versions[0]!.author).toBeNull()
    expect(versions[1]!.author).toEqual({ id: bob.id, name: 'Bob' })
    expect(versions[2]!.author).toEqual({ id: alice.id, name: 'Alice' })

    // The version's id is the highest update id in its run: the point you restore to.
    expect(versions[2]!.id).toBe(String(ids[1]))
    expect(versions[2]!.startedAt.toISOString()).toBe('2026-10-01T10:00:00.000Z')
    expect(versions[2]!.endedAt.toISOString()).toBe('2026-10-01T10:01:00.000Z')
  })

  it('splits a run when the same author returns after a long gap', async () => {
    const versions = await listVersions(documentId)
    // The last row is 88 minutes after the one before it. Same-author adjacency is
    // not enough; without the time window this would merge into Bob's neighbour or
    // Alice's first run depending on order.
    expect(versions[0]!.id).toBe(String(ids[3]))
    expect(versions[0]!.updateCount).toBe(1)
  })

  it('serves the document state as it was at a version', async () => {
    const atSecond = await stateAtVersion(documentId, ids[1]!)
    expect(atSecond).not.toBeNull()

    const doc = new Y.Doc()
    Y.applyUpdate(doc, atSecond!)
    // Two of the three inserts had happened.
    expect(doc.getText('t').toString()).toBe('one two ')

    const atThird = await stateAtVersion(documentId, ids[2]!)
    const later = new Y.Doc()
    Y.applyUpdate(later, atThird!)
    expect(later.getText('t').toString()).toBe('one two three')
  })

  it('is null for a document with no updates and for a version before any', async () => {
    const empty = await prisma.document.create({
      data: {
        workspaceId: (await prisma.workspace.findFirstOrThrow({ where: { name: LABEL } })).id,
        type: 'doc',
        title: `${LABEL}-empty`,
      },
    })
    expect(await listVersions(empty.id)).toEqual([])
    expect(await stateAtVersion(empty.id, 1n)).toBeNull()
    expect(await stateAtVersion(documentId, 0n)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @crdt/web exec vitest run test/document-history.integration.test.ts`
Expected: FAIL — cannot resolve `../src/lib/document-history.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/document-history.ts`:

```ts
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
 * not listed; the fix, if that ever matters, is a materialised version table
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
 * The document's state as of `versionId`, as one merged Yjs update.
 *
 * Deliberately a near-copy of `DocumentStore.load` in the sync server rather than a
 * shared helper: that one lives in another package the web app only depends on for
 * tests, it always loads the newest state, and it maintains in-memory bookkeeping
 * this must not touch. The shared part is three lines of merge.
 */
export async function stateAtVersion(
  documentId: string,
  versionId: bigint,
): Promise<Uint8Array | null> {
  // The newest snapshot that does not already include changes after this version.
  const snapshot = await prisma.documentSnapshot.findFirst({
    where: { documentId, throughUpdateId: { lte: versionId } },
    orderBy: { id: 'desc' },
    select: { state: true, throughUpdateId: true },
  })

  const updates = await prisma.documentUpdate.findMany({
    where: {
      documentId,
      id: { lte: versionId, ...(snapshot ? { gt: snapshot.throughUpdateId } : {}) },
    },
    orderBy: { id: 'asc' },
    select: { update: true },
  })

  const parts: Uint8Array[] = []
  if (snapshot) parts.push(new Uint8Array(snapshot.state))
  for (const row of updates) parts.push(new Uint8Array(row.update))

  if (parts.length === 0) return null
  return Y.mergeUpdates(parts)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @crdt/web exec vitest run test/document-history.integration.test.ts`
Expected: PASS, 5 tests.

If the raw query fails to parse, check `make_interval(mins => …)` against this Postgres version first; the fallback is `(${VERSION_GAP_MINUTES} || ' minutes')::interval`, which is still parameterised. Do not switch to string interpolation.

- [ ] **Step 5: Prove the grouping discriminates**

Commit first. Then, one at a time:
1. Drop the time-window clause so only the author decides a boundary. Expected: the long-gap test fails — Alice's two runs merge.
2. Drop the author clause so only the gap decides. Expected: the collapse test fails — Bob's update joins Alice's run.
3. Change `IS NOT DISTINCT FROM` to `=`. Expected: nothing fails with this fixture, because it has only one anonymous row. Add a fifth row, anonymous and one minute after the fourth, and confirm it then splits into two versions with `=` and one with `IS NOT DISTINCT FROM`. Keep the extra row and the assertion.

Restore each and re-run.

- [ ] **Step 6: Record the query plan**

Run `EXPLAIN ANALYZE` on the `listVersions` query against the test document and paste the plan into the task report. This project has been bitten once by a nested-relation `take` that read the whole table and once by a lateral join whose plan was planner-dependent. State plainly whether the inner `recent` CTE uses an index scan on `(documentId, id)` and what the measured time is.

- [ ] **Step 7: Run the full gate**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/document-history.ts apps/web/test/document-history.integration.test.ts
git commit -m "feat(history): grouped version list and state-at-a-version"
```

---

### Task 4: The two history routes

**Files:**
- Create: `apps/web/src/app/api/documents/[id]/history/route.ts`
- Create: `apps/web/src/app/api/documents/[id]/history/[version]/route.ts`
- Test: `apps/web/test/history-routes.integration.test.ts`

**Interfaces:**
- Consumes: `listVersions`, `stateAtVersion` (Task 3); `requireUser`, `requireDocumentRole`, `toResponse` from `@/lib/auth-guard`.
- Produces: `GET /api/documents/[id]/history` → `{ versions: DocumentVersion[] }`; `GET /api/documents/[id]/history/[version]` → raw bytes.

- [ ] **Step 1: Read the existing route tests**

Read `apps/web/test/workspace-routes.integration.test.ts` and `apps/web/test/doc-token-route.integration.test.ts` first. They import the route handlers directly and call them with a `Request` and a params promise; follow that, and match how they build an authenticated request.

- [ ] **Step 2: Write the failing test**

Create `apps/web/test/history-routes.integration.test.ts`, covering:

```
- a viewer can list versions           → 200, versions newest first
- a non-member cannot                  → 404, not 403 (never confirms the id exists)
- an unauthenticated caller            → 401
- ids come back as strings             → typeof version.id === 'string'
- a viewer can read state at a version → 200, application/octet-stream, bytes apply
                                          to a Y.Doc and give the expected text
- a version id that is not a number    → 400
- a version id of a different document → 404
- a version id past the end            → 404
```

The "ids come back as strings" case is not pedantry: `Response.json` throws on a `BigInt`, so a route that forgets the conversion fails with a 500 rather than a wrong value.

The "version id of a different document" case is the one that matters most. Write it explicitly: seed two documents, take a version id from the second, request it under the first, and expect 404. `stateAtVersion` filters by `documentId`, so the result would otherwise be a silent `null` or — worse, if the filter were ever dropped — another document's content.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @crdt/web exec vitest run test/history-routes.integration.test.ts`
Expected: FAIL — the route modules do not exist.

- [ ] **Step 4: Write the list route**

Create `apps/web/src/app/api/documents/[id]/history/route.ts`:

```ts
import { z } from 'zod'
import { requireDocumentRole, requireUser, toResponse } from '@/lib/auth-guard'
import { listVersions } from '@/lib/document-history'

// Capped: the client shows a panel, not an archive, and an unbounded limit is a
// free way for any member to ask for the whole log.
const Query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: documentId } = await params
    // Reading history is a read. requireDocumentRole returns 404 rather than 403 for
    // a document the caller cannot see, so a non-member cannot tell it exists.
    await requireDocumentRole(user.id, documentId, 'viewer')

    const parsed = Query.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    if (!parsed.success) return Response.json({ error: 'invalid query' }, { status: 400 })

    const versions = await listVersions(documentId, parsed.data.limit)
    return Response.json({ versions })
  } catch (error) {
    return toResponse(error)
  }
}
```

`DocumentVersion.id` is already a string from Task 3, so `Response.json` has no `BigInt` to choke on. `startedAt` and `endedAt` serialise as ISO strings.

- [ ] **Step 5: Write the state route**

Create `apps/web/src/app/api/documents/[id]/history/[version]/route.ts`:

```ts
import { requireDocumentRole, requireUser, toResponse } from '@/lib/auth-guard'
import { stateAtVersion } from '@/lib/document-history'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: documentId, version } = await params
    await requireDocumentRole(user.id, documentId, 'viewer')

    // The id is a BigInt in the database and arrives as a path segment. BigInt()
    // throws SyntaxError on anything that is not an integer literal — including
    // '1.5', '1e3' and '', all of which Number() would happily accept.
    let versionId: bigint
    try {
      versionId = BigInt(version)
    } catch {
      return Response.json({ error: 'invalid version' }, { status: 400 })
    }

    const state = await stateAtVersion(documentId, versionId)
    // A version of another document, or past the end of this one. Not an empty
    // body: an empty 200 is indistinguishable from a document with no content.
    if (!state) return Response.json({ error: 'not found' }, { status: 404 })

    return new Response(state as unknown as BodyInit, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(state.byteLength),
        // A version's bytes never change once written, but the response is
        // per-document and per-member, so it must not be shared by a proxy.
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    return toResponse(error)
  }
}
```

Check whether `new Response(uint8Array)` needs the cast on this TypeScript version before adding it; if it does not, drop the cast rather than leaving a needless `unknown`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @crdt/web exec vitest run test/history-routes.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Prove the tests discriminate**

Commit first. Then:
1. Change `requireDocumentRole(…, 'viewer')` to skip the call entirely in the list route. Expected: the non-member test fails with 200.
2. Change the `BigInt(version)` guard to `Number(version)` with a `Number.isNaN` check. Expected: the "not a number" case still passes for `'abc'` but a new case with `'1.5'` returns 404 instead of 400 — add that case and watch it fail, then restore `BigInt`.
3. Drop the `if (!state)` guard. Expected: the past-the-end case fails, returning 200 with an empty body.

Restore each.

- [ ] **Step 8: Run the full gate**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: all green. The build's route count grows by two.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(api): history list and state-at-a-version routes"
```

---

### Task 5: The restore primitives

Restore applies a past state to the live document as ordinary edits. The spec's capability table imagined a server route; this is the client-side function pair instead, for the reasons in the Global Constraints.

**Files:**
- Modify: `packages/shared/src/board.ts`
- Create: `packages/shared/test/restore-board.test.ts` (or wherever this package's tests live — check first)
- Create: `apps/web/src/lib/restore-editor.ts`
- Test: `apps/web/test/restore-editor.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (these are pure Yjs operations; the bytes they work from come from Task 4).
- Produces:
  - `restoreBoard(live: Y.Doc, from: Y.Doc): void` from `@crdt/shared/board`
  - `restoreEditor(live: Y.Doc, from: Y.Doc): void` from `@/lib/restore-editor`
- Consumes, already built by the toolbar plan: `editorExtensions` and `getEditorSchema()` from `@/components/editor-schema`, and `EDITOR_FRAGMENT` from `@/components/editor-fragment`. This task creates neither.

- [ ] **Step 1: Write the failing board test**

```ts
import * as Y from 'yjs'
import { describe, it, expect } from 'vitest'
import { addCard, addColumn, listCards, listColumns, moveCard, restoreBoard } from '../src/board.js'

describe('restoreBoard', () => {
  it('brings back a deleted card and removes one added since', () => {
    const past = new Y.Doc()
    addColumn(past, { id: 'col-1', title: 'Todo' })
    addCard(past, { id: 'card-1', title: 'Write it', columnId: 'col-1' })

    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))
    live.getMap('cards').delete('card-1')
    addCard(live, { id: 'card-2', title: 'Added later', columnId: 'col-1' })

    restoreBoard(live, past)

    const cards = listCards(live, 'col-1')
    expect(cards.map((card) => card.id)).toEqual(['card-1'])
    expect(cards[0]!.title).toBe('Write it')
  })

  it('restores a moved card to its old column and order', () => {
    const past = new Y.Doc()
    addColumn(past, { id: 'col-1', title: 'Todo' })
    addColumn(past, { id: 'col-2', title: 'Done' })
    addCard(past, { id: 'card-1', title: 'Thing', columnId: 'col-1' })
    const wasOrder = listCards(past, 'col-1')[0]!.order

    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))
    moveCard(live, 'card-1', { columnId: 'col-2' })

    restoreBoard(live, past)

    expect(listCards(live, 'col-2')).toEqual([])
    expect(listCards(live, 'col-1')[0]!.order).toBe(wasOrder)
  })

  it('is one transaction, so it is one update on the wire', () => {
    const past = new Y.Doc()
    addColumn(past, { id: 'col-1', title: 'Todo' })
    addCard(past, { id: 'card-1', title: 'A', columnId: 'col-1' })
    addCard(past, { id: 'card-2', title: 'B', columnId: 'col-1' })

    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))
    live.getMap('cards').delete('card-1')
    live.getMap('cards').delete('card-2')

    let updates = 0
    live.on('update', () => (updates += 1))
    restoreBoard(live, past)
    // Not cosmetic: each update is a persisted row and a broadcast frame, and a
    // restore that arrives in pieces is visible to everyone else as the board
    // reassembling itself.
    expect(updates).toBe(1)
  })

  it('writes fields rather than replacing an entry, so a concurrent edit survives', () => {
    // Two replicas. One restores; the other, at the same time, renames the card.
    const past = new Y.Doc()
    addColumn(past, { id: 'col-1', title: 'Todo' })
    addCard(past, { id: 'card-1', title: 'Original', columnId: 'col-1' })

    const restorer = new Y.Doc()
    const editor = new Y.Doc()
    const base = Y.encodeStateAsUpdate(past)
    Y.applyUpdate(restorer, base)
    Y.applyUpdate(editor, base)

    // The restorer's live state has drifted: the card moved.
    moveCard(restorer, 'card-1', { columnId: 'col-1', afterCardId: undefined })
    restorer.getMap<Y.Map<string>>('cards').get('card-1')!.set('order', 'zz')

    // Meanwhile the other replica renames it.
    editor.getMap<Y.Map<string>>('cards').get('card-1')!.set('title', 'Renamed')

    restoreBoard(restorer, past)
    Y.applyUpdate(editor, Y.encodeStateAsUpdate(restorer))
    Y.applyUpdate(restorer, Y.encodeStateAsUpdate(editor))

    // The rename survives: restore touched `order`, not `title`. Deleting and
    // re-creating the entry — which is the obvious implementation — loses it.
    expect(listCards(restorer, 'col-1')[0]!.title).toBe('Renamed')
    expect(listCards(editor, 'col-1')[0]!.title).toBe('Renamed')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @crdt/shared exec vitest run`
Expected: FAIL — `restoreBoard` is not exported.

- [ ] **Step 3: Write restoreBoard**

Append to `packages/shared/src/board.ts`:

```ts
/**
 * Write `from`'s board state into `live` as ordinary edits.
 *
 * A CRDT has no overwrite primitive — it only merges — so a restore cannot stamp old
 * state over current state. It is another edit, which is what makes it attributable,
 * undoable by restoring again, and subject to the same role check as any other write.
 *
 * Field-level, never delete-and-recreate: see moveCard's comment. Replacing a card's
 * map entry destroys a concurrent title edit and can leave a card in two columns.
 *
 * One transaction, so it leaves as one update: a restore that arrives in pieces is
 * visible to everyone else as the board reassembling itself.
 */
export function restoreBoard(live: Y.Doc, from: Y.Doc): void {
  live.transact(() => {
    for (const name of ['columns', 'cards'] as const) {
      const target = live.getMap<Y.Map<string>>(name)
      const source = from.getMap<Y.Map<string>>(name)

      // Anything the restored version did not have. Keys are collected first: the
      // map is being mutated inside the loop.
      for (const id of [...target.keys()]) {
        if (!source.has(id)) target.delete(id)
      }

      for (const [id, entry] of source.entries()) {
        const fields = Object.fromEntries(entry.entries())
        const existing = target.get(id)

        if (!existing) {
          const fresh = new Y.Map<string>()
          for (const [key, value] of Object.entries(fields)) fresh.set(key, value)
          target.set(id, fresh)
          continue
        }

        // Only the fields that actually differ, so a restore that changes nothing
        // produces no operations at all.
        for (const [key, value] of Object.entries(fields)) {
          if (existing.get(key) !== value) existing.set(key, value)
        }
        for (const key of [...existing.keys()]) {
          if (!(key in fields)) existing.delete(key)
        }
      }
    }
  })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @crdt/shared exec vitest run`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the concurrent-edit test discriminates**

Commit first. Then replace the field-level branch with `target.set(id, fresh)` unconditionally — the obvious implementation — and re-run. Expected: the concurrent-edit test fails, the rename gone. Restore. Note in the report that this is the test the whole design of the function exists for.

- [ ] **Step 6: Consume the editor's schema**

The editor restore needs the same ProseMirror schema the editor renders with. That module already exists: `apps/web/src/components/editor-schema.ts` was extracted by the toolbar plan (Task 1) and extended by its Tasks 2 to 6. `DocumentEditor.tsx` already spreads `editorExtensions` in front of the Collaboration extensions. **Do not create, copy or edit the extension list here**, and there is no `Editor.tsx` to modify: that component was absorbed into `DocumentEditor.tsx` and deleted.

Read `editor-schema.ts` first and confirm two things, so the restore is written against what is there and not against what this plan remembers:

1. `editorExtensions` carries every mark and node listed in the constraint above. If one is missing, that is a drift to report, not to patch around in `restore-editor.ts`.
2. `getEditorSchema()` is built from `editorExtensions` and nothing else, so it is by construction the editor's own schema.

`restore-editor.ts` imports `getEditorSchema` from it, exactly as Step 9 shows. Nothing is added to the module in this task, so this step has no commit of its own.

- [ ] **Step 7: Write the failing editor-restore test**

Create `apps/web/test/restore-editor.test.ts`:

```ts
import * as Y from 'yjs'
import { describe, it, expect } from 'vitest'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { getEditorSchema } from '../src/components/editor-schema.js'
import { EDITOR_FRAGMENT } from '../src/components/editor-fragment.js'
import { restoreEditor } from '../src/lib/restore-editor.js'

function docWith(text: string): Y.Doc {
  const doc = new Y.Doc()
  prosemirrorJSONToYXmlFragment(
    getEditorSchema(),
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    doc.getXmlFragment(EDITOR_FRAGMENT),
  )
  return doc
}

function textOf(doc: Y.Doc): string {
  return JSON.stringify(
    yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(EDITOR_FRAGMENT), getEditorSchema()),
  )
}

describe('restoreEditor', () => {
  it('brings the past text back', () => {
    const past = docWith('the original')
    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))

    // Edit the live document away from the past state.
    const fragment = live.getXmlFragment(EDITOR_FRAGMENT)
    prosemirrorJSONToYXmlFragment(
      getEditorSchema(),
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rewritten' }] }] },
      fragment,
    )
    expect(textOf(live)).toContain('rewritten')

    restoreEditor(live, past)

    expect(textOf(live)).toContain('the original')
    expect(textOf(live)).not.toContain('rewritten')
  })

  it('is one transaction, so it is one update on the wire', () => {
    const past = docWith('before')
    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))
    prosemirrorJSONToYXmlFragment(
      getEditorSchema(),
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'after' }] }] },
      live.getXmlFragment(EDITOR_FRAGMENT),
    )

    let updates = 0
    live.on('update', () => (updates += 1))
    restoreEditor(live, past)
    expect(updates).toBe(1)
  })

  it('restoring to the current state writes nothing', () => {
    const past = docWith('unchanged')
    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))

    let updates = 0
    live.on('update', () => (updates += 1))
    restoreEditor(live, past)
    // A diff, not a rewrite. A restore to where you already are is a no-op, and a
    // version-history panel will call it exactly that way when someone clicks the
    // newest version.
    expect(updates).toBe(0)
  })
})
```

A fourth test carries the constraint at the top of this plan: build a past document with `prosemirrorJSONToYXmlFragment` that uses every toolbar mark and node (a `textStyle` mark with `color`, plus `fontFamily: 'serif'` and `fontSize: 21` **only if** `getEditorSchema().marks.textStyle.spec.attrs` has those keys — they were removed in `f7a5cac` and come back, as curated ids rather than CSS, with `2026-10-07-document-gaps.md`; build the test's mark attrs from that object's keys so it is right before and after that plan; `highlight` with a colour; `underline`; `strike`; a paragraph and a heading with `textAlign: 'center'`; a `table` with a header row and cells; a `codeBlock`; a `horizontalRule`), restore it into an empty live document, and assert `yXmlFragmentToProsemirrorJSON` of the live fragment equals the past one's. Prove it discriminates by deleting one extension from `editorExtensions` locally and watching the test fail with that mark or node missing, then put it back.

The third test is the one that proves `updateYFragment` is really diffing rather than replacing. If it fails, do not relax it before establishing why: a restore that always writes is a restore that always creates a new version, and the history panel would grow an entry every time someone looked at it.

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm --filter @crdt/web exec vitest run test/restore-editor.test.ts`
Expected: FAIL — `restore-editor` does not exist.

- [ ] **Step 9: Write restoreEditor**

Create `apps/web/src/lib/restore-editor.ts`:

```ts
import type * as Y from 'yjs'
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { EDITOR_FRAGMENT } from '@/components/editor-fragment'
import { getEditorSchema } from '@/components/editor-schema'

/**
 * Write `from`'s text into `live` as ordinary edits.
 *
 * `updateYFragment` is y-prosemirror's own diff: it walks the live fragment against
 * a ProseMirror node and writes the minimum set of operations that makes them match.
 * That is what makes a restore merge sensibly with someone else's in-flight typing
 * rather than replacing the paragraph they are in.
 *
 * It needs the ProseMirror schema, which only the client has, which is why restore
 * is a client operation and not an API route. The update it produces leaves through
 * the normal socket, so it is attributed to whoever restored, and the sync server's
 * per-frame role check rejects it from a viewer without any extra enforcement.
 *
 * It does not promise an exact revert. If someone is typing when this lands, both
 * apply, and the result is the restored version plus their edit. The UI has to say
 * so; see Decision 2 in the design.
 */
export function restoreEditor(live: Y.Doc, from: Y.Doc): void {
  const schema = getEditorSchema()
  const target = live.getXmlFragment(EDITOR_FRAGMENT)
  const past = yXmlFragmentToProseMirrorRootNode(from.getXmlFragment(EDITOR_FRAGMENT), schema)

  live.transact(() => {
    // Fresh binding metadata. updateYFragment's fourth argument is a BindingMetadata
    // ({ mapping, isOMark }) on this version of @tiptap/y-tiptap, not a bare Map —
    // verified against dist/src/plugins/sync-plugin.d.ts. Both start empty because
    // this is a one-shot update with no editor binding to keep in step; handing it a
    // live binding's metadata would corrupt that binding's position cache.
    updateYFragment(live, target, past, { mapping: new Map(), isOMark: new Map() })
  })
}
```

The signatures above were read off `apps/web/node_modules/@tiptap/y-tiptap/dist/src/` while writing this plan and match: `yXmlFragmentToProseMirrorRootNode(yXmlFragment, schema): Node`, `updateYFragment(y, yDomFragment, pNode, meta: BindingMetadata): void`, `prosemirrorJSONToYXmlFragment(schema, state, xmlFragment?)`, and `getSchema(extensions, editor?)` from `@tiptap/core`. Re-check them if the dependency has moved; if `updateYFragment` is unavailable, the fallback is `yXmlFragmentToProsemirrorJSON` plus `schema.nodeFromJSON` and a delete-and-reinsert, which costs the no-op property the third test asserts — report that trade rather than silently taking it.

- [ ] **Step 10: Run it to verify it passes**

Run: `pnpm --filter @crdt/web exec vitest run test/restore-editor.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 11: Prove the no-op test discriminates**

Commit first. Then replace the `updateYFragment` call with a delete-everything-and-reinsert:

```ts
    target.delete(0, target.length)
    prosemirrorJSONToYXmlFragment(schema, past.toJSON(), target)
```

Re-run. Expected: the first two tests still pass and the third fails with `updates === 1`. That is the difference between a diff and a rewrite. Restore.

- [ ] **Step 12: Confirm the viewer path is already closed**

No new enforcement is needed, but confirm it rather than assuming: read `apps/sync/src/guard.ts` and `apps/sync/test/guard.test.ts` and verify a viewer's `update` frame is rejected. Quote the relevant assertion in the report. If it is not covered, add the test — a restore is an update frame, and "viewers cannot restore" is Decision 2.

- [ ] **Step 13: Run the full gate**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: all green.

- [ ] **Step 14: Commit**

```bash
git add apps/web packages/shared
git commit -m "feat(history): restore primitives for the board and the editor

Restore is a client operation, not a route: it needs the ProseMirror schema, and
going through the socket is what makes it attributable, role-checked and a real
CRDT merge rather than an overwrite the data model does not have."
```

---

### Task 6: Reconcile the design doc

The spec is the authority this plan argued from, and this plan contradicts one line of it and answers three questions it left open.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-02-history-and-telemetry-design.md`
- Modify: `docs/design/glass-handoff.md`

**Interfaces:**
- Consumes: the measurements and findings from Tasks 2-5.
- Produces: nothing.

- [ ] **Step 1: Amend the capability table**

In the design doc's `## Derived: what the backend must expose`:

- Replace the `Restore` row's shape. It is not `POST /api/documents/[id]/history/[snapshotId]/restore`. It is `restoreBoard` / `restoreEditor` applied on the client, through the existing socket. Give the three reasons: the ProseMirror schema exists only on the client; the per-frame role check already enforces editor-or-better and a route would bypass it; and an update written by the server has no connection behind it and therefore no author.
- Mark `Snapshot list` and `Snapshot content` as built, naming the two routes and `apps/web/src/lib/document-history.ts`.
- Note that `Version number` needs no extra work: the newest entry from `listVersions` is the current version, and `DocumentUpdate.id` was already a monotonic sequence.
- Leave `Queued-edit count`, `Latency` and `Local persistence` untouched. They are other plans'.

- [ ] **Step 2: Record the decisions this plan had to make**

Add a short section to the design doc, titled as decisions made during implementation rather than by the owner, covering: the 5-minute grouping window, the 5,000-row scan bound and what it costs, raw bytes rather than base64, the split of the two restore primitives across packages, and the deleted-author retry in `store.append`.

- [ ] **Step 3: Record the limitations**

With the numbers measured in Task 3 Step 6, not estimates:

- History older than the scan window is not listed. Name the fix (a version table written as updates land) and say it is not built.
- The version list's query plan, as measured.
- Restore does not promise an exact revert when anyone else is editing, per Decision 2. Say that the UI owes the user that sentence, and that the UI is not in this plan.
- Updates written before this migration have no author and render as unknown. This is permanent for those rows.

- [ ] **Step 4: Update the handoff**

In `docs/design/glass-handoff.md`, the `### Deferred` list says the History button and panel "need a snapshot list and fetch API, and authorship on updates". Those now exist. Rewrite the entry to say the backend is built and name it, leaving the panel and the version preview bar deferred on the UI alone. Also fix the "updated" line limitation, which blames the missing authorship schema for the absent author — the schema is no longer the blocker.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: record the history backend, and why restore is not a route"
```

---

## Self-Review

**1. Spec coverage.** Of the design doc's capability table: snapshot list (Task 3-4), snapshot content (Task 3-4), restore (Task 5, mechanism amended with reasons in Task 6), version number (falls out of Task 3, recorded in Task 6), authorship (Tasks 1-2). Deliberately **not** here: the queued-edit count and the latency ping, which need provider and sync-server work and belong with the status popover; local persistence, which the design doc itself says should be its own plan; and card notes, which need no backend at all and can ship with the card detail sheet. Every one of Decision 1, 2 and 4's consequences has a task, except the two "save a copy" flows, which are the offline plan's.

**2. Placeholder scan.** Three places deliberately defer to the codebase instead of guessing, and each says what to do with what it finds: the `Connection` helper in `room.test.ts` (Task 2 Step 1), the authenticated-request pattern in the existing route tests (Task 4 Step 1), and `yXmlFragmentToProseMirrorRootNode`'s signature (Task 5 Step 9). Task 4 Step 2 gives the test cases as a list rather than code, because the request-construction helper is the file's and copying a guess of it would be worse than naming the eight cases exactly. Task 2 Step 6 requires observing `error.meta.field_name` before shipping a branch keyed on it.

**3. Type consistency.** `onPersist` is three arguments in `RoomOptions` and four in `SyncServerOptions` throughout — the document id is the server's to add. `PendingUpdate.userId` is `string | null`, matching `DocumentUpdate.userId`'s nullability, and never `undefined`. `DocumentVersion.id` is a `string` in Task 3 and consumed as a string in Task 4. `stateAtVersion` takes a `bigint` and the route converts; `listVersions` returns strings and the route does not. `restoreBoard(live, from)` and `restoreEditor(live, from)` share an argument order on purpose — live first, in both.

**4. Greenness between tasks.** Every task ends on a green full gate. Task 2 widens three callback signatures in one commit, which is why its files list includes all five modules: a partial change does not typecheck. Task 5's Step 6 consumes the schema module the toolbar plan already built and edits nothing, so Task 5 adds only `restore-editor.ts`, its test and the board primitive.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-03-history-and-authorship-backend.md`. It is independent of the two frontend plans and can run before, after or alongside them — it shares no files with either.
