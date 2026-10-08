# Offline Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make edits made offline survive closing the tab, quitting the browser and a reboot — what Google Docs does — and handle the two ways that local copy can end up orphaned without ever silently discarding someone's work.

**Architecture:** `y-indexeddb` sits beside the websocket provider in `createDocSession`, which is already the single owner of the provider lifecycle. The CRDT does the hard part: Yjs records deletions as tombstones, so merging a stale local copy does not resurrect content someone else deleted, and none of Google's operation-rebasing machinery is needed. What is left is two conflict flows — edit permission lost while offline, and the document deleted while offline — each ending in an offer to save the local version somewhere it cannot be lost.

**Tech Stack:** Yjs 13.6, `y-indexeddb`, `y-websocket` 3.1 (`provider.ws`, `provider.wsconnected`, `provider.synced`, `provider.messageHandlers` are all public), IndexedDB, Next.js 16, Vitest 5, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-history-and-telemetry-design.md` — Decision 3 (build local persistence, match Google Docs, the two conflict cases) and Decision 4 (always-on, no toggle).

## Refreshed 2026-10-07

Written at `d769738`. Checked against `main` at `f7a5cac`: `doc-session.ts`, `use-doc.ts`, `UserMenu.tsx`, `doc-session.integration.test.ts` and `collaboration.spec.ts` are unchanged since, so every step that edits them stands. `DocumentClient.tsx` was rewritten by the document toolbar (it now renders `DocumentEditor`, which owns the toolbar and the editor, and passes it the `doc` and `provider` from `useCollaborativeDoc`); Task 1's change to it is only a new `userId` prop passed through to `useCollaborativeDoc`, which still applies. Its path moves with the shell plan, which should run first. Baseline at `f7a5cac`: Vitest 282, Playwright 157.

Two reminders the toolbar work taught: commit `apps/web/package.json` and `pnpm-lock.yaml` together when Task 1 adds `y-indexeddb` (the Render build runs `pnpm install --frozen-lockfile`), and Task 1 Step 4 contains a sketch the plan itself marks as wrong ("opens the database twice") — implement the fix it describes, never the sketch.

## Global Constraints

- **Always-on. No toggle, no setting, no opt-in.** Decision 4. There is no settings surface to add and nobody should lose work because they did not know a switch existed. If storage ever becomes a problem the answer is eviction by age, not a toggle.
- **Never silently discard a local copy.** Decision 3 names this as the one unacceptable outcome. Every path where the local copy cannot be synced must end with the user holding their work.
- **The local database name is scoped to the signed-in user.** IndexedDB is per-origin, not per-account. Two people using the same browser must not read each other's local copies — including of a document one of them has since lost access to. This is access control, not tidiness.
- **No sync-server changes and no Prisma schema changes.** One new API route is permitted only if Task 6 proves it is needed; the plan's design avoids it.
- `createDocSession` must stay testable in Node. IndexedDB does not exist there and `apps/web/test/doc-session.integration.test.ts` runs there, so persistence is injected, never imported unconditionally at the point of use.
- Every test proven to discriminate. **Commit before mutating** — `git checkout --` silently does nothing on an untracked file, which has bitten this project.
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build`, `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. **Record the baseline first.**
- Postgres on 5433 is shared across checkouts: never start, stop or restart it. Never touch `.env`, `docker-compose.yml` or `docker-compose.override.yml`. Never run any `fly` command. Never use bare `git stash` / `git stash pop`.

## Ordering

**Run this before `2026-10-04-connection-states-and-telemetry.md`.** That plan shows the offline pill, whose copy is "your changes are saved on this device". That sentence is false until this plan lands — today an offline edit lives in memory and dies with the tab. Shipping the pill first would mean telling the user something untrue about their own work.

Independent of the history backend, the shell plan and the material plan. It touches `doc-session.ts`, `use-doc.ts`, `DocumentClient.tsx` and `UserMenu.tsx`; the shell plan moves `DocumentClient.tsx`, so if both are pending, run the shell plan first.

## What the CRDT already handles — do not build defences against it

An earlier draft of the design warned that a stale local copy could resurrect deliberately deleted content. That is a real hazard in Google's architecture, which replays offline operations against the server's current state. It is **not** a hazard here: Yjs records a deletion as a tombstone, so if a peer deleted a paragraph while this client was offline and this client never touched it, merging leaves it deleted. Content comes back only if the offline edits actually re-inserted it, which is correct behaviour.

So there is no rebase, no operation log, no conflict resolution to write. Do not add any.

---

### Task 1: A local copy of every document you open

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/lib/doc-session.ts`
- Create: `apps/web/src/lib/local-doc-store.ts`
- Modify: `apps/web/src/hooks/use-doc.ts`
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx`
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/page.tsx`
- Test: `apps/web/test/local-doc-store.test.ts`, `apps/web/test/doc-session.integration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `localDbName(userId: string, documentId: string): string`
  - `type LocalPersistence = { whenSynced: Promise<unknown>; destroy(): Promise<void> }`
  - `DocSessionOptions` gains `userId: string` and `createPersistence?: (name: string, doc: Y.Doc) => LocalPersistence | null`
  - `DocSession` gains `persistence: LocalPersistence | null`
  - `useCollaborativeDoc(documentId, userId)` — second argument required

- [ ] **Step 1: Write the failing name test**

Create `apps/web/test/local-doc-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { localDbName } from '../src/lib/local-doc-store.js'

describe('localDbName', () => {
  it('scopes the local copy to one user and one document', () => {
    expect(localDbName('user-1', 'doc-1')).toBe('crdt:user-1:doc-1')
  })

  it('gives two users on the same browser different databases', () => {
    // IndexedDB is per-origin, not per-account. Without the user in the name, signing
    // in as someone else on a shared machine reads the previous person's local copy —
    // including of a document this account cannot open on the server.
    expect(localDbName('user-1', 'doc-1')).not.toBe(localDbName('user-2', 'doc-1'))
  })

  it('cannot be confused by an id containing the separator', () => {
    // cuid ids never contain a colon, but a name built by concatenation should still
    // not let one id impersonate another pair.
    expect(localDbName('a:b', 'c')).not.toBe(localDbName('a', 'b:c'))
  })
})
```

The third case fails for a naive `` `crdt:${userId}:${documentId}` `` — both give `crdt:a:b:c`. Encode each part.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @crdt/web exec vitest run test/local-doc-store.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the store module**

```bash
pnpm --filter @crdt/web add y-indexeddb
```

Pin the exact version in `package.json` the way every other dependency there is pinned (no `^`).

Create `apps/web/src/lib/local-doc-store.ts`:

```ts
import type * as Y from 'yjs'

/** The subset of IndexeddbPersistence this app uses. Injected so Node tests can fake it. */
export type LocalPersistence = {
  whenSynced: Promise<unknown>
  destroy(): Promise<void>
}

/**
 * The IndexedDB database holding one user's local copy of one document.
 *
 * The user id is part of the name because IndexedDB is scoped to the origin, not to
 * the account: two people sharing a browser would otherwise share local copies, and
 * one of them might no longer have access to that document on the server. Each part
 * is percent-encoded so no pair of ids can produce another pair's name.
 */
export function localDbName(userId: string, documentId: string): string {
  return `crdt:${encodeURIComponent(userId)}:${encodeURIComponent(documentId)}`
}

/**
 * Open the real IndexedDB-backed persistence. Returns null where IndexedDB is not
 * available — a server render, a Node test, or a browser in a mode that blocks it —
 * so the caller degrades to memory-only rather than throwing.
 *
 * Imported dynamically: y-indexeddb touches `indexedDB` at construction, and this
 * module is reachable from code that also runs on the server.
 */
export async function openLocalPersistence(
  name: string,
  doc: Y.Doc,
): Promise<LocalPersistence | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const { IndexeddbPersistence } = await import('y-indexeddb')
    return new IndexeddbPersistence(name, doc)
  } catch {
    // Private browsing and blocked site data both throw here. Losing the local copy
    // is a degradation; failing to open the document would be a defect.
    return null
  }
}
```

- [ ] **Step 4: Compose it into the session**

In `doc-session.ts`, add to `DocSessionOptions`:

```ts
  /** The signed-in user, for the local database's name. */
  userId: string
  /**
   * Opens the local copy. Defaults to IndexedDB. Tests pass a fake, or `() => null`
   * for memory-only: `IndexeddbPersistence` cannot be constructed in Node, and this
   * module's own integration tests run there.
   */
  createPersistence?: (name: string, doc: Y.Doc) => LocalPersistence | null
```

and in `createDocSession`, after the provider is constructed and before `connectWithToken()`:

```ts
  // Beside the websocket provider, not instead of it. Both write into the same Y.Doc
  // and Yjs merges them; the local copy is what makes an offline edit survive the tab
  // closing, and it loads immediately rather than waiting for the server.
  const persistence =
    options.createPersistence?.(localDbName(options.userId, options.documentId), doc) ?? null
```

`destroy()` must tear it down too, and must not leave a floating rejection:

```ts
      if (persistence) void persistence.destroy().catch(() => {})
```

`destroy()` on `IndexeddbPersistence` closes the database **without deleting it** — which is the whole point. Confirm that against the installed version and say so in the report; if it deletes, use whatever method closes without clearing.

Return `persistence` on the session object.

The default wiring lives in `use-doc.ts`, not in `doc-session.ts`, because the default is async:

```ts
    const created = createDocSession({
      documentId,
      userId,
      syncUrl: SYNC_URL,
      fetchToken: () => fetchToken(documentId),
      disableBc: new URLSearchParams(window.location.search).has('nobc'),
      // Synchronous by contract, so the real async open is kicked off here and the
      // handle attached when it resolves. The document is usable either way.
      createPersistence: (name, doc) => {
        let handle: LocalPersistence | null = null
        void openLocalPersistence(name, doc).then((opened) => (handle = opened))
        return {
          whenSynced: openLocalPersistence(name, doc).then(() => undefined),
          destroy: async () => handle?.destroy(),
        }
      },
    })
```

**That sketch is wrong on purpose and must not be copied.** It opens the database twice, and `handle` is captured before assignment. Fix it properly: either make `createPersistence` return a promise and have `createDocSession` await it before connecting, or open it once and share the single promise. Pick one, write it, and say in the report which and why. The simplest correct shape is `createPersistence?: (name, doc) => Promise<LocalPersistence | null>` with the session awaiting it before `provider.connect()`, so the local copy is applied before the server's state arrives.

`useCollaborativeDoc` takes `userId` and passes it through; `DocumentClient` takes it as a prop; the document page passes `user.id`. Note that `user.id` already crosses to the client as the input to `colorFor`, so nothing new is exposed.

- [ ] **Step 5: Test the composition in Node**

Add to `apps/web/test/doc-session.integration.test.ts`:

```ts
it('applies the local copy before connecting, and tears it down on destroy', async () => {
  const doc = new Y.Doc()
  // Stand-in for a previous session's saved state.
  doc.getText('t').insert(0, 'from disk')
  const saved = Y.encodeStateAsUpdate(doc)

  let destroyed = 0
  let openedName: string | null = null

  const session = createDocSession({
    documentId: 'doc-1',
    userId: 'user-1',
    syncUrl: 'ws://localhost:1',
    fetchToken: async () => 'token',
    createPersistence: async (name, target) => {
      openedName = name
      Y.applyUpdate(target, saved)
      return { whenSynced: Promise.resolve(), destroy: async () => void (destroyed += 1) }
    },
    // … whatever this file already passes for WebSocketImpl and the timing options
  })

  await session.whenLocalReady // or whatever Step 4 settled on; name it in the report
  expect(openedName).toBe('crdt:user-1:doc-1')
  expect(session.doc.getText('t').toString()).toBe('from disk')

  session.destroy()
  expect(destroyed).toBe(1)
})
```

Follow the file's existing fake-WebSocket setup rather than inventing one.

- [ ] **Step 6: Prove it survives a tab close, in a real browser**

Add to `apps/web/e2e/collaboration.spec.ts` (or a new `offline.spec.ts`):

```ts
test('an edit made offline is still there after the tab is closed and reopened', async ({
  browser,
}) => {
  const label = `${LABEL}-persist`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')

  // One context for both pages: IndexedDB is per-origin per-context, and a second
  // context would be a different browser profile with none of the first's storage.
  const context = await browser.newContext()
  const first = await openAs(context, owner.id, documentPath(document))

  await first.locator('.ProseMirror').click()
  await first.keyboard.type('online-first ')

  await context.setOffline(true)
  await first.waitForTimeout(300)
  await first.locator('.ProseMirror').click()
  await first.keyboard.type('typed-while-offline ')

  // The tab goes, taking the in-memory Y.Doc with it. Before this plan, so did the text.
  await first.close()

  const second = await context.newPage()
  await second.goto(documentPath(document))
  // Still offline, so this cannot have come from the server.
  await expect(second.locator('.ProseMirror')).toContainText('typed-while-offline')

  await context.setOffline(false)
  await expect(second.getByTestId('status')).toHaveAttribute('data-status', 'connected')

  // And it reaches the server, from a third page in a fresh context.
  const other = await browser.newContext()
  const third = await openAs(other, owner.id, documentPath(document))
  await expect(third.locator('.ProseMirror')).toContainText('typed-while-offline')

  await other.close()
  await context.close()
  await cleanup(label)
})
```

`openAs` appends `?nobc=1`, which disables BroadcastChannel — keep it, or the second page could converge from the first through the channel rather than from IndexedDB, and the test would pass without any persistence at all. Confirm in the report that `?nobc=1` is in the URLs the test uses.

- [ ] **Step 7: Run and prove it discriminates**

Commit first. Then make `createPersistence` return `null` in `use-doc.ts` and re-run the e2e test. Expected: it fails at the `typed-while-offline` assertion on the reopened page — the text is gone, exactly as it is today. Restore.

Then check the browser's own storage: open the dev server, edit a document, and confirm in DevTools → Application → IndexedDB that a database named `crdt:<your-user-id>:<doc-id>` exists. Paste the name into the report.

- [ ] **Step 8: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(offline): keep a local copy of every document you open

Edits made offline now survive closing the tab. y-indexeddb sits beside the
websocket provider and Yjs merges both; tombstones mean a stale local copy
cannot resurrect content someone else deleted, so there is no rebase to write.

The database name carries the user id: IndexedDB is per-origin, not per-account."
```

---

### Task 2: Signing out clears this device

A local copy that outlives the session is the other half of the per-user name. Someone signing out on a shared machine should not leave their documents in that browser.

**Files:**
- Modify: `apps/web/src/lib/local-doc-store.ts`
- Modify: `apps/web/src/components/UserMenu.tsx`
- Test: `apps/web/e2e/auth-flow.spec.ts`

**Interfaces:**
- Consumes: `localDbName` (Task 1).
- Produces: `clearLocalDocs(userId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
test('signing out removes this device\'s local copies', async ({ page }) => {
  const label = `${LABEL}-signout-clear`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(documentPath(document))
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('local text ')

  // The database exists while signed in.
  const before = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
  expect(before.some((name) => name?.startsWith('crdt:'))).toBe(true)

  await page.getByTestId('user-menu').click()
  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL(/\/login/)

  const after = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
  expect(after.some((name) => name?.startsWith('crdt:'))).toBe(false)

  await cleanup(label)
})
```

Read `UserMenu.tsx` for the real testids before writing `user-menu` / `sign-out`. `indexedDB.databases()` is Chromium-only; this suite runs Chromium, so note that limitation in the test's comment rather than reaching for a cross-browser approach.

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — the databases are still there after sign-out.

- [ ] **Step 3: Implement the clear**

```ts
/**
 * Delete every local copy belonging to one user.
 *
 * Signing out on a shared machine must not leave that account's documents in the
 * browser. Scoped by the name prefix rather than deleting everything, so one account
 * signing out does not take another's local copies with it.
 *
 * `indexedDB.databases()` is not available everywhere (Firefox does not implement it).
 * Where it is missing this is a no-op and the local copies outlive the session — a
 * real gap, recorded in the handoff, not something to paper over by guessing names.
 */
export async function clearLocalDocs(userId: string): Promise<void> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return

  const prefix = `crdt:${encodeURIComponent(userId)}:`
  let names: (string | undefined)[]
  try {
    names = (await indexedDB.databases()).map((info) => info.name)
  } catch {
    return
  }

  await Promise.all(
    names
      .filter((name): name is string => !!name && name.startsWith(prefix))
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(name)
            // Resolve on every outcome: a blocked delete (another tab still has the
            // database open) must not hang the sign-out.
            request.onsuccess = () => resolve()
            request.onerror = () => resolve()
            request.onblocked = () => resolve()
          }),
      ),
  )
}
```

In `UserMenu.tsx`, call it **before** the logout request, awaiting it, and proceed with sign-out even if it throws — a failed clear must never trap someone signed in. The component needs `user.id`; check whether `SessionUser` is already passed whole (it is) so no prop change is needed.

- [ ] **Step 4: Run and prove it discriminates**

Commit first. Remove the `clearLocalDocs` call and re-run: the test fails on the `after` assertion. Then change the prefix filter to clear everything and add a second database in the test under another user's name to confirm it is left alone. Keep that assertion.

- [ ] **Step 5: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(offline): signing out deletes this account's local copies"
```

---

### Task 3: Notice when the server will not take the edits

Two things can orphan a local copy: edit permission taken away while offline, and the document deleted while offline. The server already handles both correctly — it rejects the frames, and it logs "dropping updates for a document that no longer exists" — and the client currently ignores both. This task is the detection only; Task 4 is what to do about it.

**Files:**
- Create: `apps/web/src/lib/sync-rejection.ts`
- Modify: `apps/web/src/lib/doc-session.ts`
- Test: `apps/web/test/sync-rejection.test.ts`

**Interfaces:**
- Consumes: `provider.ws`, `provider.on('status')` from y-websocket.
- Produces:
  - `type SyncRejection = 'permission-denied' | 'document-gone'`
  - `watchRejections(provider, onReject: (reason: SyncRejection) => void): () => void`
  - `DocSession` gains `onRejection(listener): () => void`

**The two detections.**

*Permission denied* arrives as a `MESSAGE_AUTH` (type 2) frame; `room.ts` sends it through `encodePermissionDenied` the first time a viewer tries to write. y-websocket's own handler for type 2 logs it and does nothing else. Rather than replacing that handler, add a second `message` listener to `provider.ws` and peek at the first varuint — the browser `WebSocket` supports multiple listeners, so y-websocket's own handling is untouched. Re-attach on every reconnect, because y-websocket constructs a new socket each time.

*Document gone* has no frame. The signal is the token endpoint: `requireDocumentRole` 404s for a document that no longer exists, so a token fetch that fails with 404 means gone — as distinct from a network failure, which must keep retrying. `connectWithToken` currently swallows every token error into a retry; it has to tell a 404 apart.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/sync-rejection.test.ts`, testing `watchRejections` against a fake provider whose `ws` is an `EventTarget` you dispatch frames at:

```ts
import { describe, it, expect, vi } from 'vitest'
import * as encoding from 'lib0/encoding'
import { watchRejections } from '../src/lib/sync-rejection.js'

// The real frame the sync server sends: MESSAGE_AUTH, then y-protocols' auth payload.
// Built here rather than imported from the server so the test fails if either side
// changes the wire format unilaterally.
function permissionDeniedFrame(): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 2) // MESSAGE_AUTH
  encoding.writeVarUint(encoder, 0) // messagePermissionDenied
  encoding.writeVarString(encoder, 'your role is read-only for this document')
  return encoding.toUint8Array(encoder)
}

describe('watchRejections', () => {
  it('reports a permission-denied frame once', () => {
    const ws = new EventTarget() as unknown as WebSocket
    const provider = { ws, on: vi.fn(), off: vi.fn() }
    const seen: string[] = []
    watchRejections(provider as never, (reason) => seen.push(reason))

    const frame = permissionDeniedFrame()
    ws.dispatchEvent(new MessageEvent('message', { data: frame }))
    ws.dispatchEvent(new MessageEvent('message', { data: frame }))

    // Once. The server sends it on the first rejected frame, but a flurry of
    // rejected updates must not raise a flurry of offers to save a copy.
    expect(seen).toEqual(['permission-denied'])
  })

  it('ignores sync and awareness frames', () => {
    const ws = new EventTarget() as unknown as WebSocket
    const provider = { ws, on: vi.fn(), off: vi.fn() }
    const seen: string[] = []
    watchRejections(provider as never, (reason) => seen.push(reason))

    for (const type of [0, 1, 3]) {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, type)
      ws.dispatchEvent(
        new MessageEvent('message', { data: encoding.toUint8Array(encoder) }),
      )
    }

    expect(seen).toEqual([])
  })

  it('survives a malformed frame', () => {
    const ws = new EventTarget() as unknown as WebSocket
    const provider = { ws, on: vi.fn(), off: vi.fn() }
    const seen: string[] = []
    // A hostile or truncated frame must not throw inside a WebSocket listener, where
    // nothing catches it.
    expect(() => {
      watchRejections(provider as never, (reason) => seen.push(reason))
      ws.dispatchEvent(new MessageEvent('message', { data: new Uint8Array([255, 255]) }))
    }).not.toThrow()
    expect(seen).toEqual([])
  })
})
```

Check how `MessageEvent.data` arrives in the browser — y-websocket sets `binaryType = 'arraybuffer'`, so the real event carries an `ArrayBuffer`, not a `Uint8Array`. Handle both and add a test for the `ArrayBuffer` shape; a watcher that only handles `Uint8Array` would pass these tests and detect nothing in production. **This is the trap in this task.**

- [ ] **Step 2: Run it to verify it fails, then implement**

Write `watchRejections` to: attach a `message` listener to `provider.ws`, re-attach on `provider.on('status')` when a new socket appears, normalise `ArrayBuffer`/`Uint8Array`/`Blob` (ignore `Blob` — y-websocket does not use it, but do not throw), read the leading varuint with `lib0/decoding` inside a try/catch, fire once per reason, and return a function that removes every listener.

- [ ] **Step 3: Tell a 404 token apart from a network failure**

In `doc-session.ts`, `fetchToken` currently throws an untyped `Error` from `use-doc.ts`. Give it a distinguishable shape — `use-doc.ts` already has the status code:

```ts
export class DocumentGoneError extends Error {
  constructor() {
    super('document no longer exists')
    this.name = 'DocumentGoneError'
  }
}
```

thrown from `fetchToken` on a 404 only. In `connectWithToken`'s catch, a `DocumentGoneError` stops retrying and reports `document-gone`; anything else keeps the existing retry. A 403 is **not** this: it means the document exists and the role is insufficient, which is `permission-denied`.

Add a test to `doc-session.integration.test.ts`: a `fetchToken` that throws `DocumentGoneError` must emit the rejection and must not schedule a retry. Assert the retry's absence by advancing fake timers and checking `fetchToken` was called exactly once — a version that kept retrying would hammer the endpoint for a document that will never come back.

- [ ] **Step 4: Prove the detections discriminate**

Commit first. Then:
1. Make the frame check accept any message type and re-run: the ignore test fails.
2. Make `connectWithToken` treat `DocumentGoneError` like any other error and re-run: the no-retry test fails.
3. Make `watchRejections` handle only `Uint8Array` and re-run: the `ArrayBuffer` test fails. Note in the report that this is the production shape.

- [ ] **Step 5: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(offline): detect that the server will not accept these edits"
```

---

### Task 4: Offer to save the copy, and make the offer work

Decision 3: both conflict cases end with "save your version as a separate file". Silently discarding an hour of someone's writing is the one outcome that is not acceptable.

**Files:**
- Create: `apps/web/src/components/OrphanedCopy.tsx`
- Create: `apps/web/src/components/orphaned-copy.module.css`
- Create: `apps/web/src/lib/save-a-copy.ts`
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx`
- Test: `apps/web/test/save-a-copy.test.ts`, `apps/web/e2e/offline.spec.ts`

**Interfaces:**
- Consumes: `SyncRejection` (Task 3); `createDocSession` (Task 1); the existing `POST /api/workspaces/[id]/documents` route.
- Produces:
  - `copyIntoNewDocument(args: { workspaceId, title, type, state: Uint8Array, userId }): Promise<{ id: string }>`
  - `downloadCopy(args: { title: string; state: Uint8Array; text: string }): void`
  - `<OrphanedCopy reason workspaceId documentId documentTitle type doc userId canCreate />`

**Two routes out, because one is not always available.** The obvious answer — create a new document and push the local state into it — needs permission to create in that workspace. In the permission-denied case the user may have been demoted to viewer, and a viewer cannot create. So:

- **Can create** (editor or owner): create an empty document called `"<title> (offline copy)"`, open a session for it, apply the local state, wait for it to sync, then offer to open it.
- **Cannot create**: offer a **file download** — the Yjs state as `.ydoc` bytes and the readable text as `.txt` in one click each. It is not as good as a document, and it is far better than losing the work.

No new API route: creating uses the route that already exists, and the state goes through the normal sync socket, which means it is attributed and role-checked like any other edit.

- [ ] **Step 1: Write the failing unit test**

Create `apps/web/test/save-a-copy.test.ts`. Cover `copyIntoNewDocument` against a stubbed `fetch` and a stubbed session factory:

```
- creates the document with the "(offline copy)" title and the same type
- applies the local state into the new document's Y.Doc
- resolves only after the new session reports synced  (a resolve-before-sync would
  tell the user their work is safe while it is still only in memory)
- rejects with the response's error when the create fails, and does NOT destroy the
  local copy
```

The third case is the one that matters: write it as an assertion that the promise is still pending before the fake session emits `sync`, using an explicit flag rather than a timeout.

And `downloadCopy`: assert it creates an object URL, clicks an anchor with the expected filename, and revokes the URL. Stub `URL.createObjectURL`.

- [ ] **Step 2: Implement both**

In `copyIntoNewDocument`, the ordering is the whole correctness story:

```ts
/**
 * Put the local state into a brand-new document.
 *
 * Order matters: create, open, apply, wait for sync, and only then resolve. The
 * caller tells the user their work is safe when this resolves, so resolving before
 * the server has it would be a lie. Nothing here deletes the local copy — that
 * happens, if ever, after the user has seen the new document.
 */
```

- [ ] **Step 3: Build the surface**

`OrphanedCopy` is a sheet, not a toast: it needs a decision, and a message that disappears after three seconds is the wrong shape for one. Reuse `components/ui/Sheet.tsx`, which already carries the backdrop, the `g-sheet` entrance and the focus trap.

Copy, which must be exact about what happened and what is safe:

- Permission denied: heading "Your access changed"; body "You no longer have permission to edit this document, so the changes you made offline can't be saved to it. They're still on this device. Save them as a separate document before you close this tab."
- Document gone: heading "This document was deleted"; body "Someone deleted this document while you were offline. Your changes are still on this device. Save them as a separate document before you close this tab."

Primary action "Save as a new document" when `canCreate`, otherwise "Download my changes" with both file buttons. **No dismiss-and-lose path**: the only close is after a successful save, or an explicit second confirmation that says the changes stay on this device and the sheet can be reopened. Do not add an `×` that quietly abandons the work.

Show the sheet from `DocumentClient` on a rejection, and put the editor into read-only at the same time — more typing into a document that cannot be saved just makes the problem bigger.

- [ ] **Step 4: Write the failing e2e test**

In `apps/web/e2e/offline.spec.ts`, the permission-denied flow end to end:

```
1. seed a workspace, an owner and an editor, and a doc document
2. open as the editor, type, go offline, type more
3. while offline, the owner demotes the editor to viewer through the members API
4. come back online
5. the sheet appears with "Your access changed"
6. the editor is read-only
7. click "Save as a new document"
8. a new document appears in the workspace whose text contains the offline edit
```

Step 7 needs the editor to still be able to create — a viewer cannot. So run the demotion to `viewer` and assert the **download** path, and add a second test that demotes nothing but deletes the document, where the user is still an editor and the create path is available. Between them both branches are covered. Say in the report which test covers which branch.

- [ ] **Step 5: Run everything and prove it discriminates**

Commit first. Then:
1. Make `copyIntoNewDocument` resolve before the new session syncs, and assert the unit test fails.
2. Remove the read-only switch and re-run the e2e test: typing after the rejection should be refused by the test.
3. Add an `×` that closes the sheet without saving, and confirm no test catches it — then **do not keep it**, and record in the report that the absence of a dismiss path is deliberate and untested-for, because a test cannot prove a button is absent for the right reason.

- [ ] **Step 6: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(offline): offer to save an orphaned local copy, and make the offer work"
```

---

### Task 5: Verify and reconcile

**Files:**
- Modify: `docs/superpowers/specs/2026-10-02-history-and-telemetry-design.md`
- Modify: `docs/design/glass-handoff.md`

- [ ] **Step 1: Exercise all four paths by hand**

At the dev server: edit offline and reload; edit offline, close the tab, reopen; get demoted while offline; get the document deleted while offline. Write down what you saw at each step, including anything that looked wrong but passed.

- [ ] **Step 2: Record it**

In the design doc, mark Decision 3's "Local persistence" capability built, naming the files. Add what the implementation settled that the decision did not:

- the per-user database name, and that it is access control
- the two routes out of an orphaned copy, and that the download exists because a demoted user cannot create
- sign-out clearing local copies, and that `indexedDB.databases()` is Chromium-and-WebKit-only, so on Firefox the clear is a no-op and local copies outlive the session — a real gap, not a rounding error
- that no rebase was needed, and why

In the handoff, the line "your changes are saved on this device" is now true. Say so, and note that the offline pill that displays it belongs to the connection-states plan, which must run after this one for that reason.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: record local persistence and the two orphaned-copy flows"
```

---

## Self-Review

**1. Spec coverage.** Decision 3: local persistence (Task 1), permission-lost (Tasks 3-4), document-deleted (Tasks 3-4), the "save a copy" path built properly rather than stubbed (Task 4). Decision 4: always-on, no toggle — there is no settings task because there is deliberately no setting. Task 2 is not in the design doc; it follows from the per-user naming that Task 1 needed, and the design doc is amended in Task 5 to record it.

Deliberately **not** here: the offline and syncing pills, the queued-edit count, the "Back online · N changes synced" message and the status popover all belong to the connection-states plan. This plan is what makes that plan's copy true.

**2. Placeholder scan.** Task 1 Step 4 contains a **deliberately broken** sketch, labelled as such in bold, with the correct shape named and a requirement to report which was chosen — because the async/sync boundary there is the one real design decision in the task and handing over working code would hide it. Task 4 Steps 1 and 4 give test cases as lists rather than code, because both depend on the file's existing stubbing and seeding helpers; each names the assertion that carries the weight.

**3. Type consistency.** `LocalPersistence` is the same two-member type in `local-doc-store.ts`, in `DocSessionOptions.createPersistence`'s return, and on `DocSession.persistence`. `localDbName(userId, documentId)` keeps that argument order in Task 1, Task 2's prefix and the e2e assertions. `SyncRejection` is the same union in `watchRejections`, `DocSession.onRejection` and `OrphanedCopy`'s `reason` prop. `copyIntoNewDocument` takes one options object everywhere.

**4. Greenness between tasks.** Every task ends on a green full gate. Task 1 changes `useCollaborativeDoc`'s signature and all its callers in one commit. Task 3 adds detection with no surface, which is inert until Task 4 subscribes to it — deliberately, so the detection can be reviewed on its own.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-04-offline-persistence.md`. Run it after the shell plan and **before** the connection-states plan.
