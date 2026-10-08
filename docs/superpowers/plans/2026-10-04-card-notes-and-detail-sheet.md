# Card Notes and Detail Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a board card somewhere to live: notes, an activity log of who did what, a column menu to move it, and the "Has notes" meta and selected outline the board has been missing.

**Architecture:** All of it is CRDT state, so none of it touches the database. `description` becomes another field on the card's existing `Y.Map<string>`. Activity is one top-level append-only `Y.Array` whose entries carry their own `cardId`, which avoids a per-card container that two clients could race to create. The card operations take the actor who performed them and write their log entry inside the same transaction as the mutation, so a change and its record cannot diverge.

**Tech Stack:** Yjs 13.6 (`Y.Map`, `Y.Array`, `doc.transact`), React 19, the existing `components/ui/Sheet.tsx` (backdrop, `g-sheet` entrance, focus trap), Vitest 5, Playwright.

**Spec:** `docs/design/glass-handoff.md` §11 (Card sheet) and §10 (Board), and the design owner's spec of 2026-10-04, `## 5. Card sheet`, quoted inline below. `docs/superpowers/specs/2026-10-02-history-and-telemetry-design.md` records that card notes need no backend and can ship independently of the history work.

## Refreshed 2026-10-07

Written at `d769738`. Checked against `main` at `f7a5cac`: `Board.tsx`, `packages/shared/src/board.ts` and `ui/Sheet.tsx` are unchanged since; `board.module.css` changed only in its column material (now `--glass-col`, `--blur-1`, `--dash`) and the board's centring, and `.cardSelected` is still there (line 118). Corrected: the spec pointer names the regenerated handoff's §11; the notes box takes §11's resting fill; the peer dot is §11's `#0ea5e9` unless the owner chooses the peer colour. Independent of the shell plan. Baseline at `f7a5cac`: Vitest 282, Playwright 157.

## Global Constraints

- **No Prisma schema changes, no sync-server changes, no new API routes.** A `Y.Map` field is CRDT state, not database schema. If any task seems to need a route, stop and say so rather than adding one.
- **Never delete and re-create a card's map entry.** `moveCard`'s comment in `packages/shared/src/board.ts` explains why: replacing the entry destroys a concurrent title edit and can leave a card in two columns. Every write in this plan is a field-level write on the existing entry.
- **Top-level Yjs types only, created by name.** `board.ts` states the reason: top-level types are created deterministically on every replica, so there is no "who creates the container" race. A nested per-card array would reintroduce exactly that race.
- Every colour, radius, duration and easing from a token where one exists. The sheet is `--r-sheet` (30) and the card is `--r-card` (18). Raw values only where the design gives that literal, with a comment.
- Pair every `backdrop-filter` with `-webkit-backdrop-filter`. Every animation and transition inside `@media (prefers-reduced-motion: no-preference)`.
- **Viewers are read-only throughout.** The existing board already hides every mutation control from a viewer, and the sync server rejects a viewer's update frames per-frame regardless. The sheet must match: no editable fields, no column menu, no footer actions.
- Every test proven to discriminate. **Commit before mutating.**
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build`, `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. **Record the baseline first.**
- Postgres on 5433 is shared across checkouts: never start, stop or restart it. Never touch `.env`, `docker-compose.yml` or `docker-compose.override.yml`. Never run any `fly` command. Never use bare `git stash` / `git stash pop`.

## Ordering

Independent of every other outstanding plan — it shares no files with the shell, material, offline, telemetry or history plans except `Board.tsx`, which only the visual-corrections plan's Task 5 touches (a diagnosis, usually no edit). Run it whenever.

`board.module.css` already contains `.cardSelected`, written and left unused for this sheet. Use it rather than writing another rule.

## Decisions made while writing this plan

Mine, not the design owner's. Each is a place the spec described a surface without saying how it is stored.

- **Activity is one top-level `Y.Array`, not a per-card one.** Entries carry `cardId` and the sheet filters. A per-card `Y.Array` has to be created by whichever client opens that card first, which is the race `board.ts` deliberately avoids for columns and cards.
- **The actor is a required parameter on every logging operation.** Optional would let a call site silently skip the log, and an activity list with holes is worse than none. It churns every call site and test, which is the price.
- **Only card-level events are logged:** created, moved, renamed, notes changed, deleted. Column operations are not, because the activity list lives in the card sheet.
- **Activity entries are never deleted, including when their card is.** They are a record of what happened. A deleted card's entries become unreachable, which is the same thing a tombstone is.

---

### Task 1: Notes on a card, and "Has notes" on the board

**Files:**
- Modify: `packages/shared/src/board.ts`
- Modify: `apps/web/src/components/Board.tsx`
- Modify: `apps/web/src/components/board.module.css`
- Test: `packages/shared/test/board.test.ts` (check this package's actual test location first), `apps/web/e2e/board.spec.ts`

**Interfaces:**
- Consumes: `cardsOf`, `readMap` (module-private in `board.ts`).
- Produces:
  - `CardView` gains `description: string`
  - `setCardDescription(doc: Y.Doc, cardId: string, description: string): void`

- [ ] **Step 1: Write the failing unit test**

```ts
it('stores notes on the card without disturbing its other fields', () => {
  const doc = new Y.Doc()
  addColumn(doc, { id: 'col-1', title: 'Todo' })
  addCard(doc, { id: 'card-1', title: 'Thing', columnId: 'col-1' })
  const before = listCards(doc, 'col-1')[0]!

  setCardDescription(doc, 'card-1', 'the notes')

  const after = listCards(doc, 'col-1')[0]!
  expect(after.description).toBe('the notes')
  // A field-level write, so nothing else moved.
  expect(after.title).toBe(before.title)
  expect(after.order).toBe(before.order)
  expect(after.columnId).toBe(before.columnId)
})

it('reads a card written before notes existed as having none', () => {
  // Boards created before this field exist in the database as updates that never
  // set it. An undefined read must be '' and not undefined, or every consumer has
  // to handle both.
  const doc = new Y.Doc()
  addColumn(doc, { id: 'col-1', title: 'Todo' })
  addCard(doc, { id: 'card-1', title: 'Thing', columnId: 'col-1' })
  expect(listCards(doc, 'col-1')[0]!.description).toBe('')
})

it('clearing the notes empties them rather than removing the field', () => {
  const doc = new Y.Doc()
  addColumn(doc, { id: 'col-1', title: 'Todo' })
  addCard(doc, { id: 'card-1', title: 'Thing', columnId: 'col-1' })
  setCardDescription(doc, 'card-1', 'something')
  setCardDescription(doc, 'card-1', '')
  expect(listCards(doc, 'col-1')[0]!.description).toBe('')
})

it('does nothing for a card that does not exist', () => {
  const doc = new Y.Doc()
  expect(() => setCardDescription(doc, 'nope', 'x')).not.toThrow()
})

it('writes nothing when the notes are unchanged', () => {
  const doc = new Y.Doc()
  addColumn(doc, { id: 'col-1', title: 'Todo' })
  addCard(doc, { id: 'card-1', title: 'Thing', columnId: 'col-1' })
  setCardDescription(doc, 'card-1', 'same')

  let updates = 0
  doc.on('update', () => (updates += 1))
  setCardDescription(doc, 'card-1', 'same')
  // The sheet saves on every keystroke. Rewriting an identical value would persist
  // a row and broadcast a frame for nothing.
  expect(updates).toBe(0)
})
```

- [ ] **Step 2: Run them to verify they fail, then implement**

```ts
export interface CardView {
  id: string
  title: string
  columnId: string
  order: string
  /** Empty for a card written before notes existed, and for one with none. */
  description: string
}
```

In `listCards`, `description: fields.description ?? ''`. And:

```ts
/**
 * Set a card's notes. A field-level write on the existing entry — never a replacement
 * of the entry — so a concurrent title edit or move survives it.
 *
 * Returns without writing when the value is unchanged: the sheet saves as you type,
 * and an identical write is a persisted row and a broadcast frame for nothing.
 */
export function setCardDescription(doc: Y.Doc, cardId: string, description: string): void {
  doc.transact(() => {
    const entry = cardsOf(doc).get(cardId)
    if (!entry) return
    if (entry.get('description') === description) return
    entry.set('description', description)
  })
}
```

An empty `doc.transact` emits no update, so the unchanged case needs no guard outside it — confirm that with the test rather than assuming.

- [ ] **Step 3: Write the failing board test**

```ts
test('a card with notes says so on the board', async ({ page }) => {
  // … seed, open a board, add a column and a card following this file's helpers
  await expect(page.getByTestId(`card-notes-${cardId}`)).toHaveCount(0)
  // Set the notes through the doc rather than the sheet, which does not exist yet.
  await page.evaluate(/* … */)
  await expect(page.getByTestId(`card-notes-${cardId}`)).toHaveText('Has notes')
})
```

Setting the notes from the test before the sheet exists is awkward. **Reorder instead:** put this assertion in Task 3, where the sheet can type them, and in this task assert only the unit behaviour. Say in the report that you did, so the board meta is not left untested.

- [ ] **Step 4: Render the meta**

In `Board.tsx`, inside the card, after the title:

```tsx
                    {card.description !== '' && (
                      <span className={styles.cardMeta} data-testid={`card-notes-${card.id}`}>
                        Has notes
                      </span>
                    )}
```

`board.module.css`:

```css
/* The design's card meta: small, faint, under the title. */
.cardMeta {
  display: block;
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--text-faint);
}
```

- [ ] **Step 5: Prove it discriminates**

Commit first. Then drop the `?? ''` in `listCards` and re-run: the pre-existing-card test fails with `undefined`. Then drop the unchanged guard and re-run: the no-write test fails with 1. Restore both.

- [ ] **Step 6: Run the full gate and commit**

```bash
git add apps/web packages/shared
git commit -m "feat(board): notes on a card, and a Has notes meta where there are any"
```

---

### Task 2: An activity log, written with the change

The spec: `Activity: who did what and when, e.g. "Grace moved to In progress · 09:04".`

**Files:**
- Modify: `packages/shared/src/board.ts`
- Modify: `apps/web/src/components/Board.tsx`
- Test: `packages/shared/test/board-activity.test.ts`

**Interfaces:**
- Consumes: `doc.transact`.
- Produces:
  - `type Actor = { id: string; name: string }`
  - `type ActivityEntry = { id: string; cardId: string; kind: 'created' | 'moved' | 'renamed' | 'noted' | 'deleted'; actorId: string; actorName: string; detail: string; at: string }`
  - `listActivity(doc: Y.Doc, cardId: string): ActivityEntry[]` — oldest first
  - `addCard`, `moveCard`, `renameCard`, `removeCard` and `setCardDescription` all take `actor: Actor` as their last parameter

- [ ] **Step 1: Write the failing test**

```ts
it('logs a creation, a move, a rename and a note, in order', () => {
  const doc = new Y.Doc()
  const grace: Actor = { id: 'u1', name: 'Grace' }
  addColumn(doc, { id: 'col-1', title: 'Todo' })
  addColumn(doc, { id: 'col-2', title: 'In progress' })

  addCard(doc, { id: 'card-1', title: 'Enforce roles', columnId: 'col-1' }, grace)
  moveCard(doc, 'card-1', { columnId: 'col-2' }, grace)
  renameCard(doc, 'card-1', 'Enforce roles properly', grace)
  setCardDescription(doc, 'card-1', 'some notes', grace)

  const entries = listActivity(doc, 'card-1')
  expect(entries.map((entry) => entry.kind)).toEqual(['created', 'moved', 'renamed', 'noted'])
  expect(entries.every((entry) => entry.actorName === 'Grace')).toBe(true)
  // The move names where it went, which is what makes the line readable.
  expect(entries[1]!.detail).toBe('In progress')
})

it('keeps one card\'s activity out of another\'s', () => {
  const doc = new Y.Doc()
  const actor: Actor = { id: 'u1', name: 'Grace' }
  addColumn(doc, { id: 'col-1', title: 'Todo' })
  addCard(doc, { id: 'card-1', title: 'A', columnId: 'col-1' }, actor)
  addCard(doc, { id: 'card-2', title: 'B', columnId: 'col-1' }, actor)

  expect(listActivity(doc, 'card-1')).toHaveLength(1)
  expect(listActivity(doc, 'card-2')).toHaveLength(1)
})

it('writes the change and its log entry in one update', () => {
  const doc = new Y.Doc()
  const actor: Actor = { id: 'u1', name: 'Grace' }
  addColumn(doc, { id: 'col-1', title: 'Todo' })
  addCard(doc, { id: 'card-1', title: 'A', columnId: 'col-1' }, actor)

  let updates = 0
  doc.on('update', () => (updates += 1))
  moveCard(doc, 'card-1', { columnId: 'col-1', afterCardId: undefined }, actor)
  // One transaction, so a peer can never receive the move without its record, or
  // the record without the move.
  expect(updates).toBe(1)
})

it('an unchanged write logs nothing', () => {
  const doc = new Y.Doc()
  const actor: Actor = { id: 'u1', name: 'Grace' }
  addColumn(doc, { id: 'col-1', title: 'Todo' })
  addCard(doc, { id: 'card-1', title: 'A', columnId: 'col-1' }, actor)
  setCardDescription(doc, 'card-1', '')
  // The card already has no notes, so nothing happened and nothing is recorded.
  expect(listActivity(doc, 'card-1').map((e) => e.kind)).toEqual(['created'])
})

it('two replicas converge on one ordered log', () => {
  const a = new Y.Doc()
  const b = new Y.Doc()
  const grace: Actor = { id: 'u1', name: 'Grace' }
  const dhanush: Actor = { id: 'u2', name: 'Dhanush' }
  addColumn(a, { id: 'col-1', title: 'Todo' })
  addCard(a, { id: 'card-1', title: 'A', columnId: 'col-1' }, grace)
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))

  // Concurrent, each unaware of the other.
  renameCard(a, 'card-1', 'From A', grace)
  setCardDescription(b, 'card-1', 'from B', dhanush)

  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))

  // Append-only, so both sides hold both entries in the same order. An activity
  // log that disagreed between replicas would be worse than no log.
  expect(listActivity(a, 'card-1')).toEqual(listActivity(b, 'card-1'))
  expect(listActivity(a, 'card-1')).toHaveLength(3)
})
```

The last test is the one that justifies a `Y.Array` over anything else. Keep it.

- [ ] **Step 2: Run them to verify they fail, then implement**

```ts
/**
 * Every card event, newest appended last.
 *
 * One top-level Y.Array rather than one per card: top-level types are created
 * deterministically by name on every replica, so there is no container to race over.
 * A per-card array would have to be created by whichever client opened that card
 * first — exactly the race the columns and cards maps are shaped to avoid.
 *
 * Append-only. Entries are never edited and never removed, including when their card
 * is deleted: they are a record of what happened, and a deleted card's entries are
 * unreachable in the same way a tombstone is.
 */
const activityOf = (doc: Y.Doc) => doc.getArray<Y.Map<string>>('activity')
```

Every logging op takes `actor` last and appends inside its existing `doc.transact`, after the mutation and only on the path where the mutation actually happened — so the `addCard` early return on a duplicate id logs nothing, and `setCardDescription`'s unchanged guard logs nothing.

`moveCard`'s `detail` is the destination column's title, read inside the transaction. If the column has no title, use its id and say so in a comment — an activity line reading "moved to" with nothing after it is worse than one naming an id.

`at` is `new Date().toISOString()`. It is the writer's clock, which can be wrong; that is unavoidable without a server round trip, and the design shows a time, not an ordering. Note it in the doc comment: **ordering comes from the array, not from `at`**, so a skewed clock makes a line read oddly but cannot reorder the log.

Entry ids are `crypto.randomUUID()` — needed as a React key, since two entries can otherwise be identical in every field.

- [ ] **Step 3: Thread the actor through the call sites**

`Board.tsx` is the only caller. It needs the actor's id and name: it already receives `provider` and `doc`; add an `actor: Actor` prop, passed from `DocumentClient`, which has `user.name` and (after the offline plan, or by adding it here) `user.id`. If `user.id` is not yet on the client, pass it from the page — it already crosses the boundary as the input to `colorFor`.

Update every existing board unit test and e2e test that calls a changed function, in this same commit.

- [ ] **Step 4: Prove it discriminates**

Commit first. Then:
1. Move the log append outside the `doc.transact` and re-run: the one-update test fails with 2.
2. Log from `setCardDescription` before its unchanged guard and re-run: the unchanged test fails.
3. Replace the `Y.Array` with a plain `Y.Map` keyed by entry id and re-run: the convergence test fails on ordering, because a map has no order. Restore.

- [ ] **Step 5: Run the full gate and commit**

```bash
git add apps/web packages/shared
git commit -m "feat(board): an append-only activity log, written in the same transaction as the change"
```

---

### Task 3: The card sheet

The spec, `## 5. Card sheet`: opens in the middle over a blurred backdrop; a top row with a column menu, "Grace is here too" with a pulsing blue dot, and `×`; a large editable title; an editable notes box placeholder "Add notes" that turns white with a violet ring on focus; an activity list; a footer with Delete card (red) and Done (violet) for editors; Esc and the backdrop close it; viewers see everything read-only; every change saves and syncs straight away. Width 580, radius 30, title 26/600 at line-height 1.22.

**Files:**
- Create: `apps/web/src/components/CardSheet.tsx`
- Create: `apps/web/src/components/card-sheet.module.css`
- Modify: `apps/web/src/components/Board.tsx`
- Modify: `apps/web/src/components/board.module.css`
- Modify: `apps/web/src/hooks/use-presence.ts`
- Test: `apps/web/e2e/card-sheet.spec.ts`

**Interfaces:**
- Consumes: `setCardDescription`, `renameCard`, `moveCard`, `removeCard`, `listActivity`, `listColumns` from `@crdt/shared/board`; `Sheet` from `@/components/ui/Sheet`; `usePresence`, `setCardFocus`.
- Produces: `<CardSheet card columns doc actor readOnly onClose peers />`

- [ ] **Step 1: Write the failing test**

Create `apps/web/e2e/card-sheet.spec.ts` covering, in this order:

```
1. clicking a card opens the sheet and gives the card the selected outline
2. the title is editable and the board's card title updates as you type
3. typing notes makes "Has notes" appear on the board behind the sheet
4. the column menu moves the card, and the board shows it in the new column
5. the activity list shows the move, naming the destination column
6. Delete card removes it and closes the sheet
7. Done closes without changing anything
8. Esc closes; the backdrop closes; focus returns to the card
9. a viewer's sheet has no editable fields, no column menu and no footer actions
10. with two browsers on the same card, each sees "<name> is here too"
11. the sheet survives the other person renaming the card underneath it
```

Case 3 is the board-meta assertion deferred from Task 1. Case 11 is the one that catches a sheet built from a snapshot taken at open time rather than from live CRDT state — write it as: B renames the card while A's sheet is open, then assert A's sheet title updates.

Case 9 needs the viewer to be able to open the sheet at all. **Decide and state it:** the spec says `Viewers: everything is read-only`, which means the sheet opens. So a viewer's card click opens a read-only sheet — it is how they read the notes and the activity.

- [ ] **Step 2: Run it to verify it fails, then build the sheet**

Read `components/ui/Sheet.tsx` first and use it: it already carries the backdrop (`rgba(30,40,35,.16)` + `blur(8px)`), the `g-sheet` entrance, Escape, the backdrop click and the focus trap. Do not reimplement any of those. The share sheet is the model to follow.

Everything renders from live CRDT reads through `useBoard`, never from state captured at open time — that is what case 11 checks. The sheet's own inputs are controlled by the CRDT value and write on change:

```tsx
  // Saves as you type, straight into the CRDT, which is what "every change saves and
  // syncs straight away" means. setCardDescription's unchanged guard is what stops
  // this being one persisted row per keystroke when nothing differs.
  onChange={(event) => setCardDescription(doc, card.id, event.target.value, actor)}
```

**The card-focus conflict.** `Board.tsx` already sets awareness `cardId` on hover and clears it on mouse leave. With the sheet open, moving the pointer off the card would clear it and the peer dot would vanish while two people are plainly on the same card. So while the sheet is open, hold the focus on its card and ignore hover:

```tsx
  // Hover is a weaker signal than an open sheet. Holding this while the sheet is up
  // stops the "is here too" dot flickering off every time the pointer moves.
  useEffect(() => {
    setCardFocus(provider, card.id)
    return () => setCardFocus(provider, null)
  }, [provider, card.id])
```

and make `Board.tsx`'s hover handlers no-ops while a sheet is open.

- [ ] **Step 3: The styles**

`card-sheet.module.css`, with the design's values and a comment on each literal the tokens do not cover: width 580, `--r-sheet`, the title at 26/600/1.22/−0.025em, the notes box per handoff §11: `border-radius: 20px`, `background: rgba(255, 255, 255, 0.6)` with a `1px solid #fff` border, `padding: 16px 18px`, placeholder "Add notes"; on focus `background: #fff` and `box-shadow: 0 0 0 1px var(--accent), 0 0 0 5px var(--accent-ring)` (this plan first said transparent until focus; §11 was regenerated after it and gives the resting fill), the activity rows with 24px avatars, the footer's red Delete (`--danger`, text only, no fill) and violet Done.

The peer line: `<name> is here too` with an 8px pulsing dot, `g-pulse 1.8s`. Handoff §11 gives the dot as the literal `#0ea5e9`. This plan originally chose the peer's own awareness colour instead (the design assigns each person a colour and the card outline already uses it); that was the plan author's choice, not the owner's, and §11 postdates it. **Use the peer's colour only if the owner confirms it; otherwise `#0ea5e9`**, and say in the report which one shipped.

Use `.cardSelected` from `board.module.css` for the open card's outline. It is already written for this.

- [ ] **Step 4: Prove it discriminates**

Commit first. Then:
1. Build the sheet from state captured at open time and re-run: case 11 fails.
2. Remove the `useEffect` that holds card focus and re-run: case 10 fails, or flickers — report which.
3. Let a viewer's sheet render the notes textarea and re-run: case 9 fails.
4. Remove `.cardSelected` from the open card and re-run: case 1 fails.

- [ ] **Step 5: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(board): the card detail sheet, read live from the CRDT"
```

---

### Task 4: Verify and reconcile

**Files:**
- Modify: `docs/design/glass-handoff.md`
- Modify: `docs/superpowers/specs/2026-10-02-history-and-telemetry-design.md`

- [ ] **Step 1: Use it with two browsers**

Open the same board in two browsers. Open the same card in both. Type notes in one and watch the other. Move it from one and watch the activity in the other. Delete it from one and see what the other's open sheet does — **write down what happened**, because the spec does not say, and if it leaves an empty sheet over a card that no longer exists, that is a defect this task should name and fix.

- [ ] **Step 2: Record it**

In the handoff, move the card detail sheet and the "Has notes" meta out of `### Deferred` and remove the note that `.cardSelected` is unused. Record:

- `description` as a card field, and that an absent one reads as `''`
- the activity log's shape, that it is one top-level array, that it is append-only, and that ordering comes from the array rather than from `at`
- the required `actor` parameter, and that it is required so an unlogged mutation is impossible
- the card-focus hold while the sheet is open, and why hover alone was not enough
- that the peer dot uses the person's own colour rather than the spec's literal blue
- whatever Step 1 found about a card deleted under an open sheet

In the design doc, mark `Card notes` built in the capability table, noting it shipped without touching the backend as predicted.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: record card notes, the activity log and the detail sheet"
```

---

## Self-Review

**1. Spec coverage.** `## 5. Card sheet` item by item: backdrop and centring (Task 3, via the existing `Sheet`), column menu, peer line, close `×`, editable title, notes with placeholder and focus ring, activity list, editor footer, Esc and backdrop close, viewer read-only, save-as-you-type. Plus the two board items the spec lists under `## 4. Board`: "Has notes" (Task 1) and the selected violet outline (Task 3). The storage both need is Tasks 1-2.

Deliberately **not** here: nothing from the card sheet section is deferred. The board's drag-over outline and the card peer chip were already built, and the visual-corrections plan owns the drag-over diagnosis.

**2. Placeholder scan.** Task 1 Step 3 contains a sketch that is then **withdrawn in the same step**, with the reason and the instruction to move the assertion to Task 3 and report it — because writing a test that reaches into the doc from the browser to set a field the UI cannot yet set would be worse than ordering the work properly. Task 3 Step 1 gives eleven numbered cases rather than code, because they all depend on the board fixtures, and names the two that carry the weight (live reads, held card focus). The package test location in Task 1 is to be checked, not assumed.

**3. Type consistency.** `Actor = { id, name }` is one type in `board.ts`, used as the last parameter of all five logging operations and as `Board`'s and `CardSheet`'s prop. `ActivityEntry` is returned by `listActivity` and consumed by `CardSheet` unchanged. `CardView.description` is `string`, never `string | undefined`, and `listCards` is the single place the absent case becomes `''`. `setCardDescription(doc, cardId, description, actor)` has that argument order in Task 1, is widened with `actor` in Task 2, and is called with four arguments in Task 3.

**4. Greenness between tasks.** Task 2 changes five function signatures and every call site and test in one commit, because a partial change does not typecheck. Task 1 ships `setCardDescription` with three parameters and Task 2 widens it to four — so Task 1's own tests are rewritten in Task 2's commit; that is noted here so a reviewer does not read it as churn.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-04-card-notes-and-detail-sheet.md`. It is independent of the other outstanding plans and can run at any point.
