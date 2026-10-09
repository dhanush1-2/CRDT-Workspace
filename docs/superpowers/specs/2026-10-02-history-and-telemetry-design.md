# History, Authorship and Telemetry — Design

**Status:** decisions made by the design owner on 2026-10-02. This is the spec that the
backend plan and the history/offline plan argue from.

**Scope:** the backend capability the remaining Glass features need — version history
with authorship, restore, a version number and sync telemetry for the status popover and
the offline pills, and card notes for the card detail sheet.

---

## Decision 1 — Authorship lives on the update row

**Chosen: a `userId` column on `DocumentUpdate`.**

Today each saved update records `clientId` — a Yjs client number, not a person — so "who
changed this?" is unanswerable. The alternative considered was a `clientId → userId`
session table, keeping update rows lean at the cost of a lookup. Rejected: at roughly 25
bytes per row, a hundred thousand updates is about 2.5 MB, and the join table adds a
failure mode (a missing session row) for no benefit at this scale.

**This is cheaper than it first looked.** The sync server already authenticates every
socket with a signed doc token and keeps the result on the room: `server.ts` verifies the
token and sets `userId: claims.sub`, and `room.ts` already declares `readonly userId:
string`. So the writer has the user id in hand at the moment it persists an update — no
new plumbing, just a column and passing a value that already exists.

**Consequences:**
- A migration adding `userId String?` to `DocumentUpdate`, nullable because existing rows
  have no author and backfilling one would be inventing history.
- A relation to `User` with `onDelete: SetNull` — deleting an account must not delete
  document history.
- Anything reading authorship must handle `null` and render it as "Unknown", not crash
  and not silently attribute it to someone.
- An index on `[documentId, id]` already exists and still serves the history query.

## Decision 2 — Restore is a new update, and concurrent edits survive

**Chosen: accept the merge.**

A CRDT never overwrites; it only merges. So "restore version 5" cannot stamp old state
over current state — there is no overwrite primitive to use. Restore is therefore applied
as *another update*: compute the document state at the chosen snapshot, derive the
transaction that turns current state into that state, and commit it like any other edit.

If someone is typing when that lands, both apply. The result is the restored version
*plus* their in-flight edit — strictly neither the old nor the new version.

The alternatives were locking the document for the duration (exact restore, but freezing
a collaborative document mid-sentence is baffling to the person it happens to) and
restoring into a copy (nothing can be lost, but it leaves two documents and the question
of which is real). Both rejected.

**Consequences:**
- Restore needs no locking, no new document state, and no special-casing in the sync
  server — it is an ordinary update, which means it is also undoable by restoring again.
- A restore is attributed to whoever performed it, via Decision 1, so history reads
  "Dhanush restored to Sep 27, 14:20" rather than appearing as an anonymous change.
- The UI must tell the truth about the merge: after a restore with other people present,
  say so rather than implying an exact revert. Exact copy is specifically what this
  design does not promise. **Implemented** in the restore message
  (`restoreMessage` in `apps/web/src/lib/restore-version.ts`): "Restored version from
  Sep 27, 14:20", plus " · merged with changes made since" when anyone else is present
  (connected, and at least one peer).
- **What the built merge does, measured (2026-10-09).** Restore is a diff from the
  restorer's current copy to the old state (`restoreEditor`, `restoreBoard`), so it is
  not "the old version plus everything since". Edits by others that had already reached
  the restorer are undone along with the restorer's own; only edits in flight when the
  update lands survive. Board with an idle peer: the peer's card, added after the chosen
  version and already synced, was removed, and the toast still said "merged". Document
  with a peer typing 70 characters: the 13 already sent were removed, the other 57
  survived after the restored text, and both browsers converged. This is the concurrent
  case the decision describes (both apply), but it is narrower than the wording suggests.
- **Open question for the owner: does the toast overclaim?** "Merged with changes made
  since" is accurate about the mechanism and misleading about the outcome, because it
  reads as the other person's work being kept. Options are to leave it, to say what is
  lost ("other people's recent edits were replaced"), or to change the mechanism. The
  copy has not been changed.
- Viewers cannot restore. The existing role check covers it, and it is the sync server's
  per-frame guard rather than a route: there is no restore route (see "Derived" below),
  so a viewer's restore update frame is rejected like any other edit from a viewer.

## Decision 3 — Offline edits survive a tab close (revised)

**Chosen: build local persistence. Match what Google Docs does.**

This reverses an earlier decision in this same document. The first pass kept today's
behaviour — edits survive a disconnect but die with the tab — on the grounds that a
second source of truth creates conflicts with no obviously-correct answer. The owner
asked what Google Docs does and to do the same, which settles it, and answering the
question properly also corrected an error of mine.

**What Google Docs does:** it persists offline edits locally, so they survive closing
the tab, quitting the browser and a reboot, and it says so ("Working offline", "All
changes saved offline"). It is opt-in — per document, or account-wide, and in Chrome via
the Docs offline extension. For conflicts its pattern is *offer to save a copy*: lost
edit permission while offline, or a document deleted while you were away, both end with
"save your version as a separate file".

**The correction.** The earlier text warned that a stale local copy could "resurrect
deliberately deleted content". That is a genuine hazard in Google's architecture, which
replays offline operations against the server's current state. It is largely **not** a
hazard here: Yjs records deletions as tombstones, so if a peer deleted a paragraph while
this client was offline and this client never touched it, merging leaves it deleted.
Resurrection happens only if the offline edits actually re-inserted that content, which
is correct behaviour rather than a bug.

So the hardest part of Google's offline system — rebasing operations against a moving
server state — does not exist for us. The CRDT already handles it. This is materially
cheaper than the first pass priced it.

**What to build:** `y-indexeddb` alongside the existing websocket provider, so the Yjs
document is backed by browser storage as well as the server. The handoff's copy at
line 199 ("your changes are saved on this device") becomes true and stays as written.

**The two conflict cases that remain, and their answers, following Docs:**

1. **Edit permission lost while offline.** On reconnect the sync server rejects the
   updates — the existing per-frame role enforcement already does this, which is why
   this is a UI problem and not a protocol one. The client must detect the rejection,
   stop trying, and offer to save the local version as a new document. Silently
   discarding an hour of someone's writing is the one outcome that is not acceptable.
2. **Document deleted while offline.** Same resolution: the document is gone, the local
   copy is not, and the user is offered a copy. The sync server already logs "dropping
   updates for a document that no longer exists", so the server side of this exists; the
   client currently ignores it.

**One deliberate divergence from Docs, flagged for the owner.** Docs makes offline
opt-in, because of storage quota on shared machines and because its offline mode needed
an extension. Neither reason applies here: `y-indexeddb` is a few hundred KB of library
and stores only documents the user actually opened. Always-on is simpler to build, has
no settings surface, and means nobody loses work because they forgot to flip a switch.
Recommendation: always-on. Say so if you want the toggle instead.

**Consequences for the plans:**
- A new dependency, `y-indexeddb`, and a provider composition change in
  `hooks/use-doc.ts` — the one place that owns the provider lifecycle.
- The "N changes waiting to sync" count can now come from persisted state rather than
  only from memory, which makes the offline pill's number meaningful after a reload.
- Two new client flows (permission-lost, document-deleted) that need the "save a copy"
  path, which needs a create-document-from-state capability the app does not have yet.
- This is the largest single item in the remaining work and should be its own plan,
  separate from history and from the status telemetry.

## Derived: what the backend must expose

From the three decisions, the capabilities the UI plans need:

| Capability | Shape | Serves |
|---|---|---|
| Snapshot list | **Built, UI built.** `GET /api/documents/[id]/history?limit=` (1 to 200, default 50) → `{ versions: [{ id, startedAt, endedAt, author: { id, name } \| null, updateCount }] }`, ids as strings. `listVersions` in `apps/web/src/lib/document-history.ts`. Not the `{ id, createdAt, ... description }` shape first drafted here: a version is a run of updates, so it has a start and an end, and no description. | History panel rows (built: the History panel, `HistoryPanel.tsx`; a row's sentence is derived on the client by diffing two states, since the backend supplies no description) |
| Snapshot content | **Built, UI built.** `GET /api/documents/[id]/history/[version]` → the document's state at that version as raw Yjs update bytes (`application/octet-stream`). `stateAtVersion` in `apps/web/src/lib/document-history.ts`. | Version preview bar (built: a read-only preview from a throwaway `Y.Doc`, the pill, and the slider) |
| Restore | **Not a route. UI built** (the pill's Restore button, with the merged-message above). `restoreBoard(live, from)` in `@crdt/shared/board` and `restoreEditor(live, from)` in `apps/web/src/lib/restore-editor.ts`, applied on the client to the live doc, and sent through the existing socket like any edit. Originally `POST /api/documents/[id]/history/[snapshotId]/restore`; amended for three reasons below. | Restore action (built, editors only, after the first sync) |
| Version number | **No work needed.** The newest entry from `listVersions` is the current version, and `DocumentUpdate.id` was already a monotonic `BigInt` sequence. | Status popover "Version" |
| Queued-edit count | count of unsynced updates held in the page | Offline pill "N changes" |
| Latency | round-trip measurement against the sync server | Status popover "Response time" |
| Card notes | `description` plus an activity log on the card's `Y.Map` | Card detail sheet |
| Local persistence | `y-indexeddb` beside the websocket provider, plus the two "save a copy" flows | Offline edits surviving a tab close |

**Why restore is not a route.** Three reasons:

1. The ProseMirror schema exists only on the client. Restoring the editor means diffing
   the past document into the live fragment (`updateYFragment`), which needs the schema
   the client builds from its extensions. The server has no such schema.
2. The sync server's per-frame role check already enforces editor-or-better on every
   update frame. A route that wrote an update would be a second write path that skips it,
   and would need its own copy of the check.
3. An update written by the server has no connection behind it, so it has no author
   (server-originated updates persist with a null `userId`). A restore sent through the
   restorer's own socket is attributed to them, as Decision 2 requires.

The version number and the queued count are **not** the same thing and must not be
conflated: the version is server-assigned and shared, the queued count is per-client and
local. `DocumentUpdate.id` is already a `BigInt` autoincrement, so the highest id for a
document is a usable version sequence with no new column.

Card notes need no backend at all — a `Y.Map` field is CRDT state, not database schema —
so they can be split out and shipped independently of the history work.

## Decision 4 — Offline persistence is always-on

**Chosen: always-on. No toggle.**

Google Docs makes offline opt-in, but both of its reasons are artifacts of its own
situation: storage quota on shared machines, and an offline mode that needed a browser
extension. Neither applies here — `y-indexeddb` is a small library and stores only
documents the user actually opened.

So there is no settings surface, nothing to discover, and nobody loses work because they
did not know a switch existed. The cost is that every opened document occupies some
browser storage; if that ever becomes a problem the answer is eviction by age, not a
toggle.

**Consequence:** the two conflict flows in Decision 3 are not edge cases for a minority
who opted in — they are on the main path for everyone. The "save a copy" path must be
built properly, not stubbed.

## Decisions made during implementation

Made while building the history and authorship backend
(`2026-10-03-history-and-authorship-backend.md`), not by the design owner. Each can be
overruled.

- **Version grouping window: 5 minutes.** `listVersions` merges consecutive updates by the
  same author when no gap exceeds 5 minutes (exactly 5 merges, 6 splits). Rows with a
  null author group with each other, never with a known author. Every few keystrokes
  write a row, so without grouping an hour of typing is thousands of entries. The number
  is a guess at what reads as one sitting; it is one constant, `VERSION_GAP_MINUTES`.
- **Scan bound: the newest 5,000 rows.** `listVersions` groups only the most recent
  5,000 update rows of the document (`VERSION_SCAN_ROWS`), as a backward index scan. This
  keeps the cost flat no matter how long the document lives. The cost is that older
  history is not listed, and the oldest version listed is clipped if its run straddles
  the boundary: its `startedAt` is late and its `updateCount` low, though its id and
  author are correct.
- **Raw bytes, not base64.** The version-content route returns `application/octet-stream`.
  Base64 in JSON is a third larger and costs an encode and decode for nothing, since
  `fetch` can hand the client an `ArrayBuffer` that `Y.applyUpdate` takes directly. Because
  a version never changes, the response carries `Cache-Control: private, max-age=31536000,
  immutable`.
- **The two restore primitives live in different packages.** `restoreBoard` is in
  `@crdt/shared/board` because the board is plain `Y.Map` and `Y.Array` data that needs
  no editor schema, and it sits beside the board mutations it is built from. It restores
  field by field in one transaction, brings back deleted columns and cards, and removes
  ones added since. `restoreEditor` is in `apps/web` because it needs ProseMirror; it diffs
  with `updateYFragment`, and a restore that changes nothing writes nothing.
- **Version content is rebuilt from update rows, never snapshots.** `stateAtVersion`
  replays every row with id up to the version. A snapshot is encoded from the sync
  server's live doc, which already holds edits queued but not yet persisted, while its
  `throughUpdateId` is only the last persisted row. So a snapshot can contain edits made
  after the id it claims to cover, and using one would show, and restore, later edits.
  Update rows are never deleted by the app, so they are an exact history.
- **A deleted author does not drop the batch.** In `store.append`, if the insert fails
  because the author's user row no longer exists, the batch is written again with null
  authors, once. Dropping real edits to save a name would be wrong. The failure is
  recognised by the `DocumentUpdate_userId_fkey` constraint name; on this Prisma version
  with the pg driver adapter it arrives at `meta.driverAdapterError.cause.constraint.index`,
  not `meta.field_name`. A deleted document is still a logged no-op, as before.

## Limitations of what was built

- **History older than the scan window is not listed.** Only the newest 5,000 update rows
  are grouped. The fix is a version table written as updates land, so the list reads
  that instead of regrouping rows. It is not built.
- **Version content costs O(rows up to the version).** `stateAtVersion` reads and merges
  every row up to the requested id, so cost grows with the document's history. The
  optimisation is to start from a snapshot, which needs snapshots that are exact (encoded
  at the recorded id) and a way to tell them from the legacy ones already written, which
  lag. Not built.
- **Query plan of the version list, as measured** on a 12,000-row scratch document (plus
  3,000 rows on another), so the 5,000-row bound was actually exercised: the inner scan is
  `Index Scan Backward` on `DocumentUpdate_documentId_id_idx` under a `Limit`, reading
  exactly 5,000 rows in 0.6 ms. Total execution 5.2 ms in the database, 13 ms for
  `listVersions` end to end. That is the plan on this data, with stale statistics
  (estimated 21 rows, 5,000 actual). It is not guaranteed: the same query shape can
  degrade to a primary-key scan with a filter on skewed data, as the last-activity query
  did (see "Last-activity query efficiency is planner-dependent" in the handoff).
- **Restore is not an exact revert when anyone else is editing.** As Decision 2 says, the
  result is the restored version plus any concurrent edit. The UI now says so when other
  people are present (see Decision 2, which also records what the merge really keeps).
- **Updates written before the migration have no author** and render as unknown. This is
  permanent for those rows: backfilling would invent history. Updates by a deleted
  account also become unknown (`ON DELETE SET NULL`).
- **A cached version can outlive a logout.** The version-content response is cacheable
  for a year, `private`. On a shared browser profile, someone else can re-read a version
  that was already fetched after the first user signs out. Severity Low: the bytes are
  one document's past state, and only on a profile that already fetched them.
- **Deployment order.** Production must run `prisma migrate deploy` against the
  production database before the sync server that writes `userId` is deployed. The
  migration `20261003000000_update_authorship` is additive (a nullable column, an index
  and a foreign key), so the old code keeps working against the new schema, but the new
  code fails every write against the old one.

## No open questions

All four decisions are settled. The backend plan can be written from this document.
