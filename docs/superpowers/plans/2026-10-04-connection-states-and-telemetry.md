# Connection States and Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the connection legible. Amber when offline, a pulsing violet while catching up, a pill under the nav that says what is happening to your work, a status popover with real numbers, and a message when you come back.

**Architecture:** The nav cannot reach the Yjs provider today — the module store publishes status and peers, nothing else — so every item here is blocked on the same thing. The store gains a stable controls handle and a telemetry block, both published by `DocumentClient` through the existing equality gate. Latency is a real round trip over the live socket: a `sync-step1` frame out, the server's `sync-step2` reply back, timed. The queued count is local updates produced while the socket is down.

**Tech Stack:** y-websocket 3.1 (`provider.ws`, `provider.wsconnected`, `provider.synced`, `provider.connect/disconnect` are public), `lib0/encoding`, `useSyncExternalStore`, CSS Modules, Vitest 5, Playwright.

**Spec:** `docs/design/glass-handoff.md` §5.6 (under-nav floating pills), §5.7 (popovers, the Status popover) and §5.3 row 7 (the status pill), and the design owner's interaction spec of 2026-10-04, whose `## Connection states` section is quoted inline below.

## Refreshed 2026-10-07

Written at `d769738`. Corrected since: the spec pointer now names the regenerated handoff's §5.6/§5.7; the offline/syncing pill is §5.6's light glass with a dark Reconnect button (this plan had made the whole pill dark); it renders inside `.navWrap`, which was made a centred column for it; the popover's blur is §5.7's 30 (`--blur-3`). `AppShell.tsx` and `app-shell.module.css` gained the nav-width animation (`lastNavWidth`) and the content-sized nav since; Tasks 5-7 add to `AppShell` and must leave both intact. Order: after `offline-persistence` (unchanged), `history-and-authorship-backend` and `shell-routing-and-nav`. Baseline at `f7a5cac`: Vitest 282, Playwright 157.

## Global Constraints

- **Run after `2026-10-04-offline-persistence.md`.** The offline pill says "your changes are saved on this device". That is false until local persistence lands, and telling someone their work is safe when it is not is worse than showing no pill.
- **Run after `2026-10-03-history-and-authorship-backend.md`.** The popover's Version row reads the newest entry from `GET /api/documents/[id]/history`. Without it there is no version sequence to show.
- **No sync-server changes, no Prisma schema changes, no new API routes.** The latency probe uses frames the server already answers; the version comes from a route the history plan builds.
- **Never say anything about the user's work that is not true.** Every number shown here is measured, and the copy matches what the system actually guarantees. If a number is unavailable, show that it is unavailable — never a zero, which reads as "nothing pending".
- Every colour, radius, duration and easing from a token where one exists. `--warn: oklch(0.72 0.15 65)` and `@keyframes g-pulse` already exist and are **currently unused**; this plan is what uses them.
- Pair every `backdrop-filter` with `-webkit-backdrop-filter`. Every animation and transition inside `@media (prefers-reduced-motion: no-preference)`.
- `apps/web/test/css-tokens.test.ts` must keep passing.
- Every test proven to discriminate. **Commit before mutating.**
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build`, `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. **Record the baseline first.**
- Postgres on 5433 is shared across checkouts: never start, stop or restart it. Never touch `.env`, `docker-compose.yml` or `docker-compose.override.yml`. Never run any `fly` command. Never use bare `git stash` / `git stash pop`.

## The timing problem this plan has to solve first

`y-websocket` has no active close-on-offline behaviour. When the network goes away the socket stays open as far as the browser API is concerned, and the provider only reports `disconnected` when its dead-peer timer fires roughly thirty seconds later — then immediately retries and flips to `connecting`. The existing `collaboration.spec.ts` offline test documents this in a long comment and deliberately does **not** assert on the status badge for that reason.

So provider status alone cannot drive an offline pill: it would appear half a minute late. The prompt signal is the browser's own `offline` / `online` events on `window`, combined with provider status:

| Shown | Condition |
|---|---|
| Offline (amber) | `navigator.onLine === false`, **or** provider status `disconnected`/`fatal` |
| Syncing (violet, pulsing) | online and provider status `connecting`, **or** online and connected but `provider.synced === false` |
| Synced / "N here" (green) | online, connected and synced |

`navigator.onLine` is a coarse signal — it reports the OS link, not whether our server is reachable — which is exactly why it is one of two inputs rather than the only one.

---

### Task 1: The store carries controls and telemetry

**Files:**
- Modify: `apps/web/src/lib/doc-state.ts`
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx`
- Test: `apps/web/test/doc-state.test.ts`

**Interfaces:**
- Consumes: `publishDocState`, `same` from `@/lib/doc-state`.
- Produces:
  - `type DocControls = { goOffline(): void; reconnect(): void }`
  - `type DocTelemetry = { latencyMs: number | null; queued: number; version: string | null; online: boolean; synced: boolean }`
  - `DocState` gains `controls: DocControls | null` and `telemetry: DocTelemetry`
  - `EMPTY_TELEMETRY` exported for the server snapshot and for clearing

- [ ] **Step 1: Write the failing test**

Add to `apps/web/test/doc-state.test.ts` one test per new field that can change independently, in the shape the file already uses. The point of each is the same: a field the equality gate does not compare is a field that silently goes stale, which is why `cardId` was deliberately kept off `DocPeer`.

```ts
it('a change to any telemetry value alone notifies', () => {
  const base = { documentId: 'doc-1', status: 'connected' as const, peers: [], controls: null }
  publishDocState({ ...base, telemetry: { ...EMPTY_TELEMETRY, latencyMs: 30 } })

  let notified = 0
  const unsubscribe = subscribeDocState(() => (notified += 1))

  publishDocState({ ...base, telemetry: { ...EMPTY_TELEMETRY, latencyMs: 31 } })
  publishDocState({ ...base, telemetry: { ...EMPTY_TELEMETRY, latencyMs: 31, queued: 2 } })
  publishDocState({
    ...base,
    telemetry: { ...EMPTY_TELEMETRY, latencyMs: 31, queued: 2, version: '9' },
  })
  publishDocState({
    ...base,
    telemetry: { ...EMPTY_TELEMETRY, latencyMs: 31, queued: 2, version: '9', online: true },
  })
  publishDocState({
    ...base,
    telemetry: {
      ...EMPTY_TELEMETRY,
      latencyMs: 31,
      queued: 2,
      version: '9',
      online: true,
      synced: true,
    },
  })

  expect(notified).toBe(5)
  unsubscribe()
  clearDocState('doc-1')
})

it('an identical telemetry block does not notify', () => {
  // The gate's whole job: the latency probe republishes on a timer and the queue
  // counter republishes on every keystroke. Without this the nav re-renders on both.
  const state = {
    documentId: 'doc-2',
    status: 'connected' as const,
    peers: [],
    controls: null,
    telemetry: { ...EMPTY_TELEMETRY, latencyMs: 30, queued: 1 },
  }
  publishDocState(state)

  let notified = 0
  const unsubscribe = subscribeDocState(() => (notified += 1))
  publishDocState({ ...state, telemetry: { ...state.telemetry } })

  expect(notified).toBe(0)
  unsubscribe()
  clearDocState('doc-2')
})

it('a new controls identity notifies, because the nav holds onto it', () => {
  const base = {
    documentId: 'doc-3',
    status: 'connected' as const,
    peers: [],
    telemetry: EMPTY_TELEMETRY,
  }
  const controls = { goOffline() {}, reconnect() {} }
  publishDocState({ ...base, controls })

  let notified = 0
  const unsubscribe = subscribeDocState(() => (notified += 1))
  publishDocState({ ...base, controls })
  expect(notified).toBe(0)

  publishDocState({ ...base, controls: { goOffline() {}, reconnect() {} } })
  expect(notified).toBe(1)

  unsubscribe()
  clearDocState('doc-3')
})
```

The third test is why `DocumentClient` must build `controls` once with `useMemo` and not inline: an object literal in the render body is a new identity every render, and the gate would notify on every keystroke of every peer.

- [ ] **Step 2: Run it to verify it fails, then implement**

Extend the types, extend `same()` to compare all five telemetry values and the `controls` reference, add `EMPTY_TELEMETRY` and include it in `EMPTY`.

In `DocumentClient`, build the controls once:

```ts
  // Stable identity: this goes into the store, whose equality gate compares it by
  // reference, so a fresh object each render would notify every subscriber on every
  // render. `provider` is the only dependency.
  const controls = useMemo<DocControls | null>(
    () =>
      provider
        ? {
            goOffline: () => provider.disconnect(),
            reconnect: () => provider.connect(),
          }
        : null,
    [provider],
  )
```

- [ ] **Step 3: Prove it discriminates**

Commit first. Remove `latencyMs` from `same()`'s comparison and re-run: the first test fails with 4. Then compare `controls` structurally instead of by reference and re-run: the third test's second half fails. Restore both.

- [ ] **Step 4: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(doc-state): carry connection controls and telemetry to the nav"
```

---

### Task 2: Measure the round trip

The spec: `Response time: e.g. "38 ms"`.

**Files:**
- Create: `apps/web/src/lib/sync-latency.ts`
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx`
- Test: `apps/web/test/sync-latency.test.ts`

**Interfaces:**
- Consumes: `provider.ws`, `provider.wsconnected`, `provider.doc`.
- Produces: `measureLatency(provider, onSample: (ms: number) => void, options?): () => void`, `PROBE_INTERVAL_MS = 5000`

**The mechanism, and why this one.** The sync protocol is y-websocket's standard four message types, and the client is y-websocket, which will not send or understand a custom frame. But the server already answers `sync-step1` with `sync-step2`, addressed only to the sender, and the guard explicitly allows a viewer to send `sync-step1`. So the probe is: send `sync-step1`, time the next `sync-step2`.

Rejected alternatives: timing a `fetch` of the sync server's `/healthz` measures an HTTP round trip over a different connection, and would report a healthy number while the WebSocket was dead — precisely the case the pill exists for. A custom message type needs both a server change and a y-websocket patch. WebSocket-level ping/pong is not exposed to browser JavaScript at all.

**The cost, stated plainly:** `sync-step1` carries this client's state vector and the reply carries any diff the server has. In steady state the diff is empty and both frames are tens of bytes. Every five seconds, per open document. Say in the report what the frames actually measured at.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/sync-latency.test.ts`. Build a fake provider whose `ws` is an `EventTarget` with a `send` spy, drive it with `vi.useFakeTimers()` and an injected clock:

```
- sends a sync-step1 frame on the interval, and only while wsconnected
- reports the elapsed time when a sync-step2 arrives
- ignores a sync-step2 that arrives with no probe outstanding (the server sends one
  during the opening handshake; attributing that to a probe reports a wild number)
- ignores update and awareness frames
- does not stack probes: a second interval tick while one is outstanding replaces
  the outstanding probe rather than queueing, and a reply is attributed to the
  newest one only
- drops an outstanding probe when the socket closes, so a reply after a reconnect is
  not timed against a send from before it
- handles ArrayBuffer message data, which is what the browser delivers
- stops sending after the returned teardown runs
```

Build the frames with `lib0/encoding` in the test rather than importing the server's encoders, so the test fails if either side changes the wire format alone.

- [ ] **Step 2: Run it to verify it fails, then implement**

Keep the whole thing in one module with no React in it, so the tests above are the only consumer besides one effect. The outstanding probe is a single nullable timestamp, not a queue — there is never a reason to have two in flight.

```ts
/**
 * Time a round trip over the live socket.
 *
 * A `sync-step1` frame out, the server's `sync-step2` reply back. The server already
 * answers step1 and addresses the reply to the sender only, and the guard allows a
 * viewer to send it, so this needs no protocol change and works for every role.
 *
 * Measuring the real socket matters: timing an HTTP request to the sync server's
 * health endpoint would report a healthy number while the WebSocket was dead, which
 * is exactly the state the status pill exists to surface.
 */
```

- [ ] **Step 3: Publish it**

In `DocumentClient`, run the probe in an effect keyed on `provider`, hold the newest sample in state, and feed it into the published telemetry. Do **not** smooth or average it: the spec shows one number, and an average hides the spike that tells you something is wrong.

- [ ] **Step 4: Prove it discriminates**

Commit first. Then:
1. Attribute every `sync-step2` to a probe, outstanding or not, and re-run: the unsolicited-reply test fails.
2. Keep the outstanding probe across a socket close and re-run: the reconnect test fails.
3. Handle only `Uint8Array` message data and re-run: the `ArrayBuffer` test fails. This is the production shape.

Then look at the real number: open a document against the local sync server and read the sample. Single-digit milliseconds on loopback is expected; a number in the hundreds means the probe is measuring something else. Put the figure in the report.

- [ ] **Step 5: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(sync): measure the socket round trip with a sync-step1 probe"
```

---

### Task 3: Count what is waiting

The spec: `Waiting to sync: how many of your edits haven't been sent yet` and, on the offline pill, `…N changes saved on this device will sync when you're back.`

**Files:**
- Create: `apps/web/src/lib/queued-edits.ts`
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx`
- Test: `apps/web/test/queued-edits.test.ts`

**Interfaces:**
- Consumes: `provider.wsconnected`, `provider.on('sync')`, `doc.on('update')`.
- Produces: `countQueuedEdits(doc, provider, onChange: (n: number) => void): () => void`

**What counts.** A local update produced while the socket is not connected. Not a remote update, not an update applied from the local IndexedDB copy on load, and not one produced while connected — y-websocket sends those immediately. The count resets to zero when the provider reports a completed sync, which is the only moment the server is known to have everything.

**The two origins that must not be counted** are the trap in this task. `doc.on('update', (update, origin) => …)`: the websocket provider sets itself as the origin for remote updates, and `y-indexeddb` sets its persistence instance as the origin when it replays the local copy. Counting either turns "waiting to sync" into "updates I have seen", which on a fresh offline load would show a large number for work that is already saved.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/queued-edits.test.ts`:

```
- a local edit while disconnected increments
- a local edit while connected does not
- a remote update (origin = the provider) never increments, connected or not
- an update whose origin is the persistence handle never increments
- a completed sync resets to zero
- a disconnect does not reset (the edits are still waiting)
- the teardown unsubscribes from both the doc and the provider
```

Use a real `Y.Doc` and a fake provider object; transact with an explicit origin to simulate each case.

- [ ] **Step 2: Run it to verify it fails, then implement**

The origin test needs an identity to compare against. Pass the origins to ignore in, rather than guessing them inside the module:

```ts
export function countQueuedEdits(
  doc: Y.Doc,
  provider: { wsconnected: boolean; on(event: string, handler: (arg: boolean) => void): void; off(event: string, handler: (arg: boolean) => void): void },
  onChange: (queued: number) => void,
  /**
   * Origins that are not this user typing: the websocket provider (a remote edit)
   * and the local persistence (replaying what is already saved). Counting either
   * would report work that is not waiting for anything.
   */
  ignoreOrigins: readonly unknown[] = [],
): () => void
```

`DocumentClient` passes `[provider, session.persistence]`.

- [ ] **Step 3: Prove it discriminates**

Commit first. Remove the `ignoreOrigins` check and re-run: the remote-update and persistence tests fail. Then reset the count on disconnect instead of on sync and re-run: the disconnect test fails. Restore.

Then by hand: open a document, go offline in DevTools, type three words, and confirm the count is 3 — not 0, and not the character count. If Yjs batches a word into one update the number will be lower than the word count; whatever it is, write down what you observed and what the number means, because the pill says "changes" and the user will read it as something.

- [ ] **Step 4: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(sync): count the edits waiting to reach the server"
```

---

### Task 4: Amber, and a pulse

The spec: `Connected: green`, `Offline: amber oklch(0.72 0.15 65)`, `Syncing: the accent violet, with a pulse`, and `The intent: losing connection should feel safe, because the motion stays calm and nothing turns red.`

Today offline is `--danger` — the same red as Delete — and the syncing dot does not move. `--warn` and `g-pulse` are both defined and used nowhere.

**Files:**
- Modify: `apps/web/src/components/SyncStatus.tsx`
- Modify: `apps/web/src/components/app-shell.module.css`
- Test: `apps/web/e2e/glass-shell.spec.ts`

**Interfaces:**
- Consumes: `useDocState()` with the telemetry from Tasks 1-3.
- Produces: `data-connection="synced" | "offline" | "syncing"` on the status pill, alongside the existing `data-status`.

- [ ] **Step 1: Write the failing test**

```ts
test('the status pill goes amber offline and pulses while catching up, never red', async ({
  page,
}) => {
  const label = `${LABEL}-connection`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(documentPath(document))
  const pill = page.getByTestId('status')
  await expect(pill).toHaveAttribute('data-connection', 'synced')

  const dot = page.getByTestId('status-dot')
  const green = await dot.evaluate((el) => getComputedStyle(el).backgroundColor)

  await page.context().setOffline(true)
  // Driven by the browser's offline event, not by the provider's 30s dead-peer
  // timer, so this is prompt rather than half a minute late.
  await expect(pill).toHaveAttribute('data-connection', 'offline')
  const offline = await dot.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(offline).not.toBe(green)
  // The design is explicit that losing a connection must not read as an error.
  // --danger is rgb(196, 55, 43).
  expect(offline).not.toBe('rgb(196, 55, 43)')

  await page.context().setOffline(false)
  await expect(pill).toHaveAttribute('data-connection', 'synced')

  await cleanup(label)
})

test('the syncing dot animates and the synced dot does not', async ({ page }) => {
  const label = `${LABEL}-pulse`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(documentPath(document))
  await expect(page.getByTestId('status')).toHaveAttribute('data-connection', 'synced')

  // The other half: an unconditional pulse would pass an "is it pulsing" assertion
  // in the syncing state too, so assert its absence here first.
  const settled = await page
    .getByTestId('status-dot')
    .evaluate((el) => getComputedStyle(el).animationName)
  expect(settled).toBe('none')

  // Force the syncing state without waiting for a real reconnect.
  await page.evaluate(() => {
    document.querySelector('[data-testid="status"]')?.setAttribute('data-connection', 'syncing')
  })
  const pulsing = await page
    .getByTestId('status-dot')
    .evaluate((el) => getComputedStyle(el).animationName)
  expect(pulsing).toContain('pulse')

  await cleanup(label)
})
```

The attribute-poke in the second test checks that the **CSS** responds to the state, which is all CSS can be asked. Whether the state is ever reached is the first test's job. Say so in a comment, so nobody later mistakes it for a behaviour test.

- [ ] **Step 2: Run them to verify they fail**

Expected: FAIL — there is no `data-connection`, no `status-dot` testid, and offline is red.

- [ ] **Step 3: Derive the connection state**

In `SyncStatus.tsx`, replace the four-way `DISPLAY` map keyed on `DocStatus` with a derivation from status plus telemetry, following the table in this plan's preamble. Keep `data-status` — several existing tests use it — and add `data-connection`.

```tsx
type Connection = 'synced' | 'offline' | 'syncing'

/**
 * The browser's own offline event is the prompt signal: y-websocket keeps the socket
 * nominally open when the network goes away and only reports 'disconnected' when its
 * dead-peer timer fires about thirty seconds later. Provider status is the second
 * input, for the case where the network is fine and our server is not.
 */
function connectionOf(status: DocStatus, telemetry: DocTelemetry): Connection {
  if (!telemetry.online || status === 'disconnected' || status === 'fatal') return 'offline'
  if (status === 'connecting' || !telemetry.synced) return 'syncing'
  return 'synced'
}

const DISPLAY: Record<Connection, { label: string; dot: string }> = {
  synced: { label: 'Synced', dot: 'var(--ok)' },
  // Amber, not --danger. The design is explicit that losing a connection must not
  // read as an error: the work is safe on this device and the motion stays calm.
  offline: { label: 'Offline', dot: 'var(--warn)' },
  syncing: { label: 'Syncing', dot: 'var(--sync)' },
}
```

The `online` flag comes from `DocumentClient`, which listens for `window`'s `online` and `offline` events and seeds from `navigator.onLine`. Put that listener there, not in `SyncStatus`: the store is the one place this state is published from, and two components reading `navigator.onLine` independently will disagree.

The people count stays as the shell plan left it — peers plus you when anyone else is present, the connection label when alone — and only in the `synced` state.

- [ ] **Step 4: Add the pulse**

```css
/* Only while catching up. A dot that always pulsed would make the settled state
   restless, and would make the syncing state mean nothing. */
@media (prefers-reduced-motion: no-preference) {
  .status[data-connection='syncing'] .statusDot {
    animation: g-pulse 1.8s var(--ease) infinite;
  }
}
```

`g-pulse` already carries the design's figures — to 40% opacity and 80% scale at the midpoint.

- [ ] **Step 5: Prove it discriminates**

Commit first. Then:
1. Put `--danger` back for offline and re-run: the first test fails on the explicit red check.
2. Drop `!telemetry.online` from `connectionOf` and re-run: the offline transition fails, or takes thirty seconds — report which, because that is the timing problem this plan opened with.
3. Remove the `[data-connection='syncing']` qualifier so the pulse is unconditional, and re-run: the settled-state assertion fails.

- [ ] **Step 6: Run the full gate and commit**

```bash
git add apps/web
git commit -m "fix(status): amber offline, a pulsing dot while catching up, nothing red"
```

---

### Task 5: The pills under the nav, and the message when you return

The spec: `Offline: "You're offline. Keep working, your changes are saved on this device," or "…N changes saved on this device will sync when you're back." Includes a dark Reconnect button.` / `Syncing: "Back online. Syncing your changes…"` / `Done: … a message appears: "Back online · N changes synced".`

**Files:**
- Create: `apps/web/src/components/ConnectionBand.tsx`
- Create: `apps/web/src/components/connection-band.module.css`
- Modify: `apps/web/src/components/AppShell.tsx`
- Test: `apps/web/e2e/offline.spec.ts`

**Interfaces:**
- Consumes: `useDocState()`; the toast hook used by `ShareSheet`.
- Produces: `<ConnectionBand />`, rendered by `AppShell` between the nav and the content.

- [ ] **Step 1: Write the failing test**

```ts
test('going offline explains itself, counts the waiting edits, and confirms the return', async ({
  page,
}) => {
  const label = `${LABEL}-band`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(documentPath(document))
  await expect(page.getByTestId('connection-band')).toHaveCount(0)

  await page.context().setOffline(true)
  const band = page.getByTestId('connection-band')
  await expect(band).toBeVisible()
  // No edits yet, so no count — "0 changes" would be noise.
  await expect(band).toContainText("You're offline")
  await expect(band).toContainText('saved on this device')

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('offline words ')
  // Now it says how much is waiting.
  await expect(band).toContainText('will sync when you\'re back')
  await expect(page.getByTestId('queued-count')).not.toHaveText('0')

  const queued = await page.getByTestId('queued-count').innerText()

  await page.context().setOffline(false)
  await expect(page.getByTestId('status')).toHaveAttribute('data-connection', 'synced')
  await expect(band).toHaveCount(0)
  await expect(page.getByTestId('toast')).toHaveText(`Back online · ${queued} changes synced`)

  await cleanup(label)
})
```

Read `share-sheet.spec.ts` for the real toast testid. The `${queued} changes` interpolation will be wrong for a count of one — write the singular case into the component and add a second, smaller test for it, or assert with a regex; say which you chose.

- [ ] **Step 2: Run it to verify it fails, then build the band**

`ConnectionBand` renders nothing when `documentId === null` or the connection is `synced`. Otherwise a centred floating pill 10px below the nav (§5.6). Render it **inside `.navWrap`, after the `<nav>`** — `app-shell.module.css` made `.navWrap` a centred column for exactly these pills — and position it `absolute; top: calc(100% + 10px); left: 50%` so it floats over the page rather than pushing the content down while it is shown (`.navWrap` is `position: sticky`, which makes it the containing block). It enters with `g-up`, which already carries `translate(-50%, 16px)` and `scale(0.96)`, the shape a `left: 50%` pill needs.

Offline copy, branching on the count, with the count in its own element so the test can read it:

```tsx
        {queued === 0 ? (
          <>You&rsquo;re offline. Keep working, your changes are saved on this device.</>
        ) : (
          <>
            You&rsquo;re offline.{' '}
            <span data-testid="queued-count">{queued}</span>{' '}
            {queued === 1 ? 'change' : 'changes'} saved on this device will sync when
            you&rsquo;re back.
          </>
        )}
```

**The pill is light glass, not dark** (handoff §5.6, regenerated after this plan was first written, so it wins): `background: rgba(255, 255, 255, 0.62)` with `backdrop-filter: blur(24px) saturate(180%)` and its `-webkit-` pair (both §5.6 literals, no token; comment them), `border-radius: var(--r-pill)`, `padding: 6px 6px 6px 16px`, an 8px status dot, text in `--text-2`. Only the **Reconnect** button is dark: a 30px pill in `rgba(28, 29, 27, 0.82)` with white text, calling `controls.reconnect()`. (The dark glass for the whole pill is §5.6's *version preview* pill, which `history-panel-and-preview` builds.)

**The toolbar overlap.** On a document the toolbar sticks at `top: 80px` (64px once the shell plan's condensed nav lands), which is where this pill floats. The pill is above it in z-order (it is inside `.navWrap`, `z-index: 30`), so it covers the toolbar's centre while shown. That is acceptable for a transient state message; check it by eye at 1280px and say in the report whether any control under it is unreachable while offline.

Syncing copy: `Back online. Syncing your changes…` with no button.

**The copy is only true because local persistence landed.** Put that in a comment with the plan name, so nobody moves this component ahead of it.

- [ ] **Step 3: Raise the message on return**

In `ConnectionBand`, remember the count at the moment the connection leaves `synced`, and when it returns to `synced` raise `Back online · N changes synced` — using the remembered count, because by then the live count is zero. Suppress it when the remembered count is zero: nothing synced, so there is nothing to confirm.

- [ ] **Step 4: Prove it discriminates**

Commit first. Then:
1. Read the live count instead of the remembered one and re-run: the toast asserts `0 changes synced` and the test fails. This is the bug the remembering exists for.
2. Render the band whenever `documentId !== null` and re-run: the initial `toHaveCount(0)` fails.
3. Drop the singular branch and run the one-change test: it fails with "1 changes".

- [ ] **Step 5: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(status): the offline and syncing pills, and the message on return"
```

---

### Task 6: The status popover

The spec: `270px, radius 22, glass strong, origin top-right, g-pop .45s. Title ("Everything is up to date" / "Working offline" / "Catching up"), then a grid: People here, Response time, Waiting to sync, Version. Plus a "Go offline (simulate)" / "Reconnect now" button (dev only).`

**Files:**
- Create: `apps/web/src/components/StatusPopover.tsx`
- Create: `apps/web/src/components/status-popover.module.css`
- Modify: `apps/web/src/components/SyncStatus.tsx`
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx`
- Test: `apps/web/e2e/glass-shell.spec.ts`

**Interfaces:**
- Consumes: `useDocState()`; `GET /api/documents/[id]/history?limit=1` from the history backend plan.
- Produces: `<StatusPopover onClose />`, opened from the status pill.

**My ruling on the dev-only control.** "Go offline (simulate)" is a demo affordance and is gated on `process.env.NODE_ENV !== 'production'`. **"Reconnect now" ships in production**: a user whose socket is wedged has no other way to retry, and the offline band already offers it. The spec's "(dev only)" applies to the simulate half, which is the half that would be bewildering in production.

- [ ] **Step 1: Write the failing test**

Cover: the pill opens the popover and is `aria-expanded`; the title matches the state; all four rows are present with their labels; the response time is a number followed by `ms`; "Waiting to sync" shows the queued count; Version shows a version, and shows an em dash rather than `0` when the fetch fails; Escape closes and returns focus to the pill; a click outside closes; opening the popover closes the user menu and vice versa (the spec: `Opening one menu closes the other`).

The em-dash case needs the route stubbed to fail — use `page.route` to return a 500 for the history endpoint. A `0` there would read as "version zero", which is a lie about the document.

- [ ] **Step 2: Build it**

A disclosure anchored to the pill, same shape as the History button's panel from the shell plan: `position: absolute` inside a `position: relative` wrapper, `top: calc(100% + 10px); right: 0`, `transform-origin: top right`, `animation: g-pop 0.45s var(--ease)`, width 270, `border-radius: var(--r-pop)` (22), `background: var(--glass-mid)` (.72) plus `backdrop-filter: var(--blur-3)` (blur 30, handoff §5.7) with its `-webkit-` pair.

Titles, from the connection state: `synced` → "Everything is up to date"; `offline` → "Working offline"; `syncing` → "Catching up".

Rows:

| Label | Value |
|---|---|
| People here | `peers.length + 1` |
| Response time | `latencyMs === null ? '—' : \`${latencyMs} ms\`` |
| Waiting to sync | `queued` |
| Version | `version ?? '—'` |

Fetch the version in `DocumentClient`, not in the popover — the popover unmounts on close and would refetch on every open. Fetch once on mount and after each completed sync, since a sync is when the version can have moved. Publish it in the telemetry.

The "one menu at a time" rule: `AppShell` already holds a single `overlay` slot for the palette and the share sheet precisely so that opening one cannot leave another open. Add the popover and the user menu to that slot rather than giving each its own boolean. If `UserMenu` currently owns its own open state, move it; note the change in the report, because it is a behaviour change for the user menu.

- [ ] **Step 3: Prove it discriminates**

Commit first. Then: make the Version row render `version ?? 0` and re-run the stubbed-failure test; remove the focus return on Escape and re-run; give the popover its own boolean instead of the shared slot and re-run the one-menu-at-a-time test. Each should fail. Restore.

- [ ] **Step 4: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(status): the status popover, with measured numbers and no fabricated ones"
```

---

### Task 7: Go offline and Reconnect in the palette

The spec's palette results: `this workspace's documents, Overview, All workspaces, Share and Go offline / Reconnect.` The handoff records these as deliberately left out because the palette could not reach the provider. It can now.

**Files:**
- Modify: `apps/web/src/components/CommandPalette.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`
- Test: `apps/web/e2e/command-palette.spec.ts`

**Interfaces:**
- Consumes: `useDocState()`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Cover: on a document, the palette lists "Reconnect"; running it closes the palette and the document stays connected; on the dashboard, where there is no open document, neither item is listed; and the simulate item's presence follows the same build gate as the popover's — assert whichever way the test build runs and say which in the report.

- [ ] **Step 2: Implement**

Add the items from `useDocState()`'s `controls`, only when it is non-null, after Share. Keep the palette's existing `kind` labels consistent — these are `'Action'`, like Share.

- [ ] **Step 3: Prove it discriminates and commit**

Commit first, then render the items with `controls` null and re-run the dashboard test; it should fail.

```bash
git add apps/web
git commit -m "feat(palette): reconnect from the palette, now that it can reach the provider"
```

---

### Task 8: Verify and reconcile

**Files:**
- Modify: `docs/design/glass-handoff.md`
- Modify: `docs/superpowers/specs/2026-10-02-history-and-telemetry-design.md`

- [ ] **Step 1: Exercise it**

At the dev server with DevTools throttling: watch the pill go amber promptly, type and watch the count climb, press Reconnect, watch the dot pulse and then settle, and read the message. Open the popover in each of the three states. Write down the real latency figure and the real queued numbers.

- [ ] **Step 2: Record it**

In the handoff, move the status popover, the offline and syncing pills, and the palette's Go offline / Reconnect out of `### Deferred` into the built list, naming the files. Record:

- the two-input connection derivation and **why** — the thirty-second dead-peer timer is the kind of thing a later reader deletes as redundant
- the latency probe's mechanism, its measured cost in bytes and its interval
- what "N changes" counts, in the words you used in Task 3 Step 3
- that offline is `--warn` and that red is reserved for destructive actions and errors
- that "Reconnect now" ships in production while "Go offline (simulate)" does not, and why
- that the user menu now shares `AppShell`'s single overlay slot

In the design doc, mark `Version number`, `Queued-edit count` and `Latency` built in the capability table.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: record the connection states, the telemetry and their mechanisms"
```

---

## Self-Review

**1. Spec coverage.** The interaction spec's `## Connection states` section, end to end: amber dot and label (Task 4), the offline pill with its count and Reconnect (Task 5), the violet pulse (Task 4), the return message (Task 5). The handoff's status popover with all four rows (Task 6). The palette's two missing items (Task 7). Tasks 1-3 are the mechanisms the rest stand on.

Deliberately **not** here: local persistence, which is the plan before this one and which this plan's copy depends on; the version-preview bar and "Restored version from …", which belong to the history panel plan; and `--warn`'s other possible uses, since this plan uses it for exactly one thing.

**2. Placeholder scan.** Tasks 2, 3, 6 and 7 give their test cases as enumerated lists rather than full code, because each needs the fake-provider and seeding helpers those files already have, and every list names the case that carries the weight (the unsolicited `sync-step2`, the two ignored origins, the em dash instead of `0`, the empty-controls case). Three places require reporting a measured number rather than accepting a claim: the probe's frame size, the real latency, and what the queued count counts.

**3. Type consistency.** `DocControls` and `DocTelemetry` are defined once in `doc-state.ts` and imported everywhere else. `latencyMs` and `version` are `| null` at every layer, and the `—` rendering is the only place that absence becomes text. `connectionOf(status, telemetry)` has one signature, used by `SyncStatus`, `ConnectionBand` and `StatusPopover`; extract it to `doc-state.ts` if a third caller appears, and say so.

**4. Greenness between tasks.** Every task ends on a green full gate. Task 4 keeps `data-status` alongside the new `data-connection` so the existing suite's status assertions keep passing. Task 6 moves the user menu into the shared overlay slot in the same commit as the popover that needs it.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-04-connection-states-and-telemetry.md`. Run it after the offline-persistence plan and the history-and-authorship backend plan.
