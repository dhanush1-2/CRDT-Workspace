# Nav Polish and Renaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Board columns can be renamed and deleted; documents and boards can be renamed from the workspace overview and from inside the open document or board; the nav shows everyone in the document (you included) as one group and keeps its width steady while you move between documents.

**Architecture:** Column rename and delete are two new CRDT operations in `packages/shared/src/board.ts`, so they sync live like every other board edit. Document titles live in Postgres; a new `PATCH /api/documents/[id]` (editors and owners) changes one, and the client calls `router.refresh()` so the layout-owned nav and the page re-render with it. The nav's document-only items (people, History, status) are decided by the route, not by whether the document has connected yet, and the width animation holds its current width while a newly opened document connects, then animates once.

**Tech Stack:** Next.js 16 App Router (forced `--webpack`), React 19.3, Yjs 13.6, Prisma 7, Zod 4, Vitest 5, Playwright 1.63.

**Spec:** The owner's requests of 2026-10-08 (recorded under **Decisions** below, binding) and `docs/design/glass-handoff.md` §5.3 (nav contents and order), §10 (Board). Per the handoff's Precedence section, these later decisions win over §1–20 where they differ; Task 6 records them there.

## Decisions (owner, 2026-10-08 — binding)

1. **Nav moves smoothly.** Moving between pages must not make the nav "collapse and open". It grows or shrinks once, smoothly, to fit its contents, the way the tab highlight slides.
2. **Everyone together.** Everyone in the open document, **you included**, is one avatar group, placed before History and the status pill (§5.3 order: people, History, status, Share, account). The account menu stays at the far right but must not look like a second person.
3. **Rename documents and boards** from the workspace overview and from inside the open document or board. The nav's tab updates.
4. **Columns:** rename a column inline (new columns are still created as "New column"); delete a column. Deleting a column that still has cards asks first and says how many cards will be deleted. An empty column deletes straight away.
5. **Rename visibility (controller's decision, stated to the owner):** a new title is saved to Postgres; the person renaming sees it everywhere at once; other people see it on their next data load (a navigation that refetches, `router.refresh()`, or a reload). Not live-synced through the CRDT.

## Global Constraints

- **No Prisma schema changes and no sync-server changes.** One new API route: `PATCH /api/documents/[id]`.
- **Titles:** trimmed; 1–200 characters after trimming, the same bound as `POST /api/workspaces/[id]/documents` (`z.string().min(1).max(200)`). An empty or unchanged title is not sent; the field reverts.
- **Roles:** renaming documents and editing columns needs `editor` or `owner`. Viewers see plain text and no rename or delete controls. The API enforces this independently of the UI.
- **Test ids must not collide with existing prefix selectors.** `e2e/board.spec.ts` counts columns with `[data-testid^="column-"]` and cards with `[data-testid^="card-"]`. New board test ids use the prefix `col-` (`col-title-<id>`, `col-delete-<id>`, `col-confirm-<id>`, `col-confirm-delete-<id>`, `col-confirm-cancel-<id>`). Never start a new test id with `column-` or `card-`.
- **Tokens:** every colour, radius, duration and easing from `apps/web/src/app/globals.css` where one exists (`--text`, `--text-2`, `--text-muted`, `--danger`, `--field-bg`, `--field-border`, `--accent`, `--accent-ring`, `--r-pill`, `--r-item`, `--dur-fast`, `--dur`, `--ease`, …). Raw values only where the design gives a literal, with a comment. Every transition inside `@media (prefers-reduced-motion: no-preference)`. `apps/web/test/css-tokens.test.ts` must keep passing.
- **Keep intact:** `AppShell`'s `lastNavWidth`, `ref={nav}`, the no-dependency width `useLayoutEffect`, the `condensed` scroll state, `.navWrap`'s fixed 68px height; `NavTabs`'s `lastMetrics` and `hasOthersHere`.
- Every page under `app/workspaces/[id]/` keeps its own auth check. The workspace layout is not a gate.
- Postgres on port 5433 is shared across checkouts: never start, stop or restart it or Docker. Never touch `.env`, `docker-compose.yml`, `docker-compose.override.yml`. Never run `fly`. Never use bare `git stash`/`git stash pop`. Never stage `README.md` (the owner's uncommitted edit). Revert `apps/web/next-env.d.ts` if a build rewrites it.
- Every test proven to discriminate: watch it fail on the unfixed code, or mutate the fix and watch it fail. **Commit before mutating**; restore with `git checkout -- <file>` (tracked files only).
- Full gate per task: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`. Baseline at `a78da27`: Vitest 292, Playwright 171, 15 routes. Task 3 adds an API route, which `next build` also lists, so the route count rises by one there; record the number you see. Known flake: collaboration 'formatting made in one browser appears in the other' may fail once; rerun it alone 3 times and report.

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/board.ts` | **Modify.** `renameColumn`, `removeColumn`. |
| `packages/shared/test/board.test.ts` | **Modify.** Their unit tests. |
| `apps/web/src/components/ColumnHead.tsx` | **Create.** A column's header: editable title, card count, delete with inline confirm. |
| `apps/web/src/components/Board.tsx` | **Modify.** Renders `ColumnHead`. |
| `apps/web/src/components/board.module.css` | **Modify.** Title input, delete button, confirm row. |
| `apps/web/src/app/api/documents/[id]/route.ts` | **Create.** `PATCH` — rename. |
| `apps/web/test/document-rename.integration.test.ts` | **Create.** Route tests against the real database. |
| `apps/web/src/lib/rename-document.ts` | **Create.** The client's one call to that route. |
| `apps/web/src/components/InlineTitle.tsx` | **Create.** An input that looks like text, commits on Enter/blur, reverts on Escape/empty/failure. |
| `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx` | **Modify.** Editable heading for docs and boards. |
| `apps/web/src/app/workspaces/[id]/documents/[docId]/document.module.css` | **Modify.** Board title style; input reset for the heading. |
| `apps/web/src/components/DocumentTile.tsx` | **Create.** One overview tile: link plus rename. |
| `apps/web/src/app/workspaces/[id]/page.tsx` | **Modify.** Renders `DocumentTile`. |
| `apps/web/src/app/workspaces/[id]/workspace.module.css` (the overview's existing stylesheet; confirm its name from the page's import) | **Modify.** Rename button and tile input. |
| `apps/web/src/components/NavPresence.tsx`, `SyncStatus.tsx`, `AppShell.tsx`, `UserMenu.tsx`, `user-menu.module.css`, `app-shell.module.css` | **Modify.** Tasks 4–5. |
| `apps/web/e2e/renaming.spec.ts` | **Create.** Rename e2e (Task 3). |
| `apps/web/e2e/board.spec.ts`, `glass-shell.spec.ts`, `collaboration.spec.ts` | **Modify.** |
| `docs/design/glass-handoff.md` | **Modify.** Task 6. |

---

### Task 1: Rename and delete a column in the board model

**Files:**
- Modify: `packages/shared/src/board.ts` (after `addColumn`)
- Test: `packages/shared/test/board.test.ts`

**Interfaces:**
- Produces: `renameColumn(doc: Y.Doc, columnId: string, title: string): void` and `removeColumn(doc: Y.Doc, columnId: string): number` (returns how many cards it deleted).

- [ ] **Step 1: Write the failing tests** — append inside `describe('board', …)` in `packages/shared/test/board.test.ts`, and add `renameColumn, removeColumn` to its import:

```ts
  it('renames a column in place, keeping its id and position', () => {
    const doc = board()
    renameColumn(doc, 'todo', 'Backlog')
    expect(listColumns(doc).map((c) => [c.id, c.title])).toEqual([
      ['todo', 'Backlog'],
      ['doing', 'Doing'],
    ])
  })

  it('renaming a column that does not exist does nothing', () => {
    const doc = board()
    renameColumn(doc, 'nope', 'x')
    expect(listColumns(doc).map((c) => c.title)).toEqual(['To do', 'Doing'])
  })

  it('removing a column deletes it and every card in it, and only those', () => {
    const doc = board()
    addCard(doc, { id: 'a', title: 'A', columnId: 'todo' })
    addCard(doc, { id: 'b', title: 'B', columnId: 'todo' })
    addCard(doc, { id: 'c', title: 'C', columnId: 'doing' })

    expect(removeColumn(doc, 'todo')).toBe(2)
    expect(listColumns(doc).map((c) => c.id)).toEqual(['doing'])
    expect(listCards(doc, 'todo')).toEqual([])
    expect(listCards(doc, 'doing').map((c) => c.id)).toEqual(['c'])
    // Gone from the shared map, not merely hidden: nothing is left to resurface if a
    // column with the same id were ever recreated.
    expect(doc.getMap('cards').has('a')).toBe(false)
  })

  it('removing a column is one transaction, so a peer sees it all at once', () => {
    const doc = board()
    addCard(doc, { id: 'a', title: 'A', columnId: 'todo' })
    let transactions = 0
    doc.on('afterTransaction', () => { transactions += 1 })
    removeColumn(doc, 'todo')
    expect(transactions).toBe(1)
  })

  it('a rename made on one replica reaches the other', () => {
    const a = board()
    const b = new Y.Doc()
    sync(a, b)
    renameColumn(b, 'doing', 'In progress')
    sync(a, b)
    expect(listColumns(a).find((c) => c.id === 'doing')?.title).toBe('In progress')
  })
```

- [ ] **Step 2: Run them, expect FAIL** (`renameColumn is not exported`).

Run: `pnpm --filter @crdt/shared exec vitest run test/board.test.ts` (if the package has no such filter name, read `packages/shared/package.json` for its name and use it, or run `pnpm exec vitest run --project shared packages/shared/test/board.test.ts` from the root).

- [ ] **Step 3: Implement** — in `packages/shared/src/board.ts`, after `addColumn`:

```ts
/** Writes the title field on the column's existing entry, like renameCard. */
export function renameColumn(doc: Y.Doc, columnId: string, title: string): void {
  doc.transact(() => {
    columnsOf(doc).get(columnId)?.set('title', title)
  })
}

/**
 * Deletes a column and every card in it, in one transaction so a peer never sees the
 * column gone with its cards still listed, or the reverse. Returns the number of cards
 * deleted, which is what the confirmation shows.
 *
 * A card a peer moves into this column concurrently, before this deletion reaches them,
 * keeps a columnId that no longer exists and is not listed anywhere. That is the same
 * outcome as deleting it, which is what the person deleting the column asked for.
 */
export function removeColumn(doc: Y.Doc, columnId: string): number {
  let removed = 0
  doc.transact(() => {
    const cards = cardsOf(doc)
    for (const [cardId, entry] of [...cards.entries()]) {
      if (entry.get('columnId') === columnId) {
        cards.delete(cardId)
        removed += 1
      }
    }
    columnsOf(doc).delete(columnId)
  })
  return removed
}
```

- [ ] **Step 4: Run, expect PASS.** Prove discrimination: make `removeColumn` delete only the column (skip the card loop), watch the "only those" test fail; restore.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/board.ts packages/shared/test/board.test.ts
git commit -m "feat(board): rename and remove a column, its cards with it"
```

---

### Task 2: Column header — editable title and delete

**Files:**
- Create: `apps/web/src/components/ColumnHead.tsx`
- Modify: `apps/web/src/components/Board.tsx:63-66` (the `columnHead` block)
- Modify: `apps/web/src/components/board.module.css`
- Test: `apps/web/e2e/board.spec.ts`

**Interfaces:**
- Consumes: `renameColumn`, `removeColumn` (Task 1).
- Produces: `<ColumnHead doc columnId title count readOnly />`.

- [ ] **Step 1: Write the failing e2e tests** — append to `apps/web/e2e/board.spec.ts` (it already has `openBoard(page, label, columns)` returning column ids, and `addCard(page, columnId)`):

```ts
test('a column is renamed in place, and the new name reaches a second browser', async ({
  page,
  browser,
}) => {
  const label = `${LABEL}-rename-col`
  const [columnId] = await openBoard(page, label, 1)
  const title = page.getByTestId(`col-title-${columnId}`)
  await expect(title).toHaveValue('New column')

  await title.click()
  await title.fill('Backlog')
  await title.press('Enter')
  await expect(title).toHaveValue('Backlog')
  await expect(title).not.toBeFocused()

  // Live through the CRDT: a second browser on the same board sees it without reloading.
  const url = page.url()
  const context = await browser.newContext()
  await context.addCookies(await page.context().cookies())
  const other = await context.newPage()
  await other.goto(`${url}?nobc=1`)
  await expect(other.getByTestId(`col-title-${columnId}`)).toHaveValue('Backlog')
  await page.getByTestId(`col-title-${columnId}`).fill('Done')
  await page.getByTestId(`col-title-${columnId}`).press('Enter')
  await expect(other.getByTestId(`col-title-${columnId}`)).toHaveValue('Done')
  await context.close()
})

test('Escape or an empty name puts the column title back', async ({ page }) => {
  const [columnId] = await openBoard(page, `${LABEL}-rename-revert`, 1)
  const title = page.getByTestId(`col-title-${columnId}`)

  await title.fill('Something')
  await title.press('Escape')
  await expect(title).toHaveValue('New column')

  await title.fill('   ')
  await title.press('Enter')
  await expect(title).toHaveValue('New column')
})

test('an empty column deletes straight away', async ({ page }) => {
  const [first, second] = await openBoard(page, `${LABEL}-delete-empty`, 2)
  await page.getByTestId(`col-delete-${first}`).click()
  await expect(page.getByTestId(`column-${first}`)).toHaveCount(0)
  await expect(page.getByTestId(`column-${second}`)).toHaveCount(1)
  await expect(page.getByTestId(`col-confirm-${first}`)).toHaveCount(0)
})

test('deleting a column with cards asks first, naming the count, and Cancel keeps it', async ({
  page,
}) => {
  const [columnId] = await openBoard(page, `${LABEL}-delete-cards`, 1)
  await addCard(page, columnId)
  await addCard(page, columnId)
  await addCard(page, columnId)

  await page.getByTestId(`col-delete-${columnId}`).click()
  const confirm = page.getByTestId(`col-confirm-${columnId}`)
  await expect(confirm).toContainText('3 cards')
  await page.getByTestId(`col-confirm-cancel-${columnId}`).click()
  await expect(confirm).toHaveCount(0)
  await expect(page.getByTestId(`column-${columnId}`).locator('[data-testid^="card-"]')).toHaveCount(3)

  await page.getByTestId(`col-delete-${columnId}`).click()
  await page.getByTestId(`col-confirm-delete-${columnId}`).click()
  await expect(page.getByTestId(`column-${columnId}`)).toHaveCount(0)
})

test('one card is "1 card", not "1 cards"', async ({ page }) => {
  const [columnId] = await openBoard(page, `${LABEL}-delete-one`, 1)
  await addCard(page, columnId)
  await page.getByTestId(`col-delete-${columnId}`).click()
  await expect(page.getByTestId(`col-confirm-${columnId}`)).toContainText('1 card')
  await expect(page.getByTestId(`col-confirm-${columnId}`)).not.toContainText('1 cards')
})
```

Also add a viewer test, following the existing viewer pattern in this file (search it for `'viewer'` and `addMember`): a viewer sees the column title as text (`col-title-<id>` is not an editable input: `toHaveCount(0)` for `input[data-testid="col-title-<id>"]`, and the title text is visible) and no `col-delete-<id>`.

- [ ] **Step 2: Run, expect FAIL** (`col-title-…` not found).

Run: `pnpm --filter @crdt/web exec playwright test e2e/board.spec.ts`

- [ ] **Step 3: Create `apps/web/src/components/ColumnHead.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { removeColumn, renameColumn } from '@crdt/shared/board'
import styles from './board.module.css'

/**
 * A column's header: its title (editable for editors), its card count, and delete.
 *
 * The title is an input that looks like text. Enter or leaving the field saves it,
 * Escape puts it back, and an empty name is never saved. It writes to the CRDT, so a
 * rename reaches everyone on the board at once. The field follows the shared title
 * while it is not being edited, so a peer's rename shows up here too.
 *
 * Deleting an empty column is immediate. A column with cards asks first, in place,
 * saying how many cards will go with it.
 */
export function ColumnHead({
  doc,
  columnId,
  title,
  count,
  readOnly,
}: {
  doc: Y.Doc
  columnId: string
  title: string
  count: number
  readOnly: boolean
}) {
  const [value, setValue] = useState(title)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const cancelled = useRef(false)

  useEffect(() => {
    if (!editing) setValue(title)
  }, [title, editing])

  if (readOnly) {
    return (
      <div className={styles.columnHead}>
        <h2 className={styles.columnTitle} data-testid={`col-title-${columnId}`}>
          {title}
        </h2>
        <span className={styles.count}>{count}</span>
      </div>
    )
  }

  function commit() {
    setEditing(false)
    if (cancelled.current) {
      cancelled.current = false
      setValue(title)
      return
    }
    const next = value.trim()
    if (next === '' || next === title) {
      setValue(title)
      return
    }
    renameColumn(doc, columnId, next)
  }

  if (confirming) {
    return (
      <div className={styles.columnConfirm} role="group" aria-label="Delete column" data-testid={`col-confirm-${columnId}`}>
        <span className={styles.columnConfirmText}>
          Delete “{title}” and its {count} {count === 1 ? 'card' : 'cards'}?
        </span>
        <button
          type="button"
          className={styles.columnConfirmDelete}
          data-testid={`col-confirm-delete-${columnId}`}
          onClick={() => removeColumn(doc, columnId)}
        >
          Delete
        </button>
        <button
          type="button"
          className={styles.columnConfirmCancel}
          data-testid={`col-confirm-cancel-${columnId}`}
          // Focus would otherwise be lost with the row that held it.
          autoFocus
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className={styles.columnHead}>
      <input
        className={`${styles.columnTitle} ${styles.columnTitleInput}`}
        aria-label="Column name"
        value={value}
        maxLength={200}
        data-testid={`col-title-${columnId}`}
        onFocus={() => setEditing(true)}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            cancelled.current = true
            event.currentTarget.blur()
          }
        }}
      />
      <span className={styles.count}>{count}</span>
      <button
        type="button"
        className={styles.columnDelete}
        aria-label={`Delete column ${title}`}
        title="Delete column"
        data-testid={`col-delete-${columnId}`}
        onClick={() => (count === 0 ? removeColumn(doc, columnId) : setConfirming(true))}
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Use it in `Board.tsx`** — replace the `<div className={styles.columnHead}>…</div>` block (today an `<h2 className={styles.columnTitle}>` and the count) with:

```tsx
          <ColumnHead
            doc={doc}
            columnId={column.id}
            title={column.title}
            count={(cardsByColumn.get(column.id) ?? []).length}
            readOnly={readOnly}
          />
```

and import `ColumnHead` from `./ColumnHead`.

- [ ] **Step 5: Styles** — append to `apps/web/src/components/board.module.css`:

```css
/* The column title as an input that reads as the heading it replaces. */
.columnTitleInput {
  flex: 1 1 auto;
  width: 100%;
  padding: 2px 6px;
  margin: -2px -6px;
  border: 0;
  border-radius: var(--r-item);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.columnTitleInput:hover {
  background: rgba(255, 255, 255, 0.6); /* the design's hover white for glass rows */
}

.columnTitleInput:focus-visible,
.columnTitleInput:focus {
  outline: none;
  background: #fff;
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-ring);
}

.columnDelete {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.columnDelete:hover {
  background: rgba(0, 0, 0, 0.06); /* same as the count chip's tint, slightly stronger */
  color: var(--danger);
}

.columnConfirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 2px 12px;
  font-size: 13px;
  color: var(--text-2);
}

.columnConfirmText {
  flex: 1 1 100%;
}

.columnConfirmDelete,
.columnConfirmCancel {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--r-pill);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.columnConfirmDelete {
  background: var(--danger);
  color: #fff;
}

.columnConfirmCancel {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text);
}

@media (prefers-reduced-motion: no-preference) {
  .columnTitleInput,
  .columnDelete {
    transition: background var(--dur-fast) var(--ease);
  }
}
```

- [ ] **Step 6: Run the board spec, expect PASS.** Then check nothing else broke: search the e2e suite for assertions on the old `<h2>` column heading (`grep -rn "columnTitle\|getByRole('heading'" apps/web/e2e`) and update any that read the column title as heading text to read `col-title-<id>`'s value. Prove discrimination: make `commit` skip the empty-name guard (watch the revert test fail); make delete always confirm (watch the empty-column test fail); restore.

- [ ] **Step 7: Full gate, then commit**

```bash
git add apps/web/src/components/ColumnHead.tsx apps/web/src/components/Board.tsx apps/web/src/components/board.module.css apps/web/e2e/board.spec.ts
git commit -m "feat(board): rename a column in place, and delete it, asking first when it has cards"
```

---

### Task 3: Rename documents and boards

**Files:**
- Create: `apps/web/src/app/api/documents/[id]/route.ts`
- Create: `apps/web/test/document-rename.integration.test.ts`
- Create: `apps/web/src/lib/rename-document.ts`
- Create: `apps/web/src/components/InlineTitle.tsx`
- Create: `apps/web/src/components/DocumentTile.tsx`
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx` (the `heading`), its `page.tsx` (pass `canEdit`), `document.module.css`
- Modify: `apps/web/src/app/workspaces/[id]/page.tsx` (tiles), and the overview stylesheet it imports
- Create: `apps/web/e2e/renaming.spec.ts`

**Interfaces:**
- Produces: `PATCH /api/documents/[id]` with body `{ title: string }` → `200 { id, title }`, `400` invalid, `403` viewer, `404` not found or not a member, `401` signed out. `renameDocument(documentId: string, title: string): Promise<boolean>`. `<InlineTitle documentId title label className testId autoFocus? onDone? />`.

- [ ] **Step 1: Write the failing route test** — `apps/web/test/document-rename.integration.test.ts`, following `workspace-routes.integration.test.ts`'s setup (it mocks `next/headers` `cookies` and signs a session with `signSession(userId, process.env.SESSION_SECRET!)`; read it and copy that pattern, including how it builds the cookie value):

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { cookies } from 'next/headers'
import { prisma } from '@crdt/db'
import { PATCH } from '../src/app/api/documents/[id]/route.js'
import { signSession, SESSION_COOKIE } from '../src/lib/session.js'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

let ownerId: string
let editorId: string
let viewerId: string
let strangerId: string
let documentId: string

beforeAll(async () => {
  const make = (email: string) =>
    prisma.user.create({ data: { email, name: email, passwordHash: 'x' }, select: { id: true } })
  ownerId = (await make('rename-owner@example.com')).id
  editorId = (await make('rename-editor@example.com')).id
  viewerId = (await make('rename-viewer@example.com')).id
  strangerId = (await make('rename-stranger@example.com')).id
  const workspace = await prisma.workspace.create({ data: { name: 'rename-ws', ownerId } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspace.id, userId: ownerId, role: 'owner' },
      { workspaceId: workspace.id, userId: editorId, role: 'editor' },
      { workspaceId: workspace.id, userId: viewerId, role: 'viewer' },
    ],
  })
  documentId = (await prisma.document.create({ data: { workspaceId: workspace.id, type: 'doc', title: 'Before' } })).id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: 'rename-ws' } })
  await prisma.user.deleteMany({ where: { email: { contains: 'rename-' } } })
  await prisma.$disconnect()
})

async function patchAs(userId: string | null, id: string, body: unknown) {
  const token = userId ? await signSession(userId, process.env.SESSION_SECRET!) : null
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (token && name === SESSION_COOKIE ? { value: token } : undefined),
  } as never)
  const request = new Request('http://localhost/api', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ id }) })
}

const titleNow = async () => (await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).title

describe('PATCH /api/documents/[id]', () => {
  it('lets an editor rename, trimming the title', async () => {
    const response = await patchAs(editorId, documentId, { title: '  Plans  ' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: documentId, title: 'Plans' })
    expect(await titleNow()).toBe('Plans')
  })

  it('lets an owner rename', async () => {
    expect((await patchAs(ownerId, documentId, { title: 'Owner title' })).status).toBe(200)
    expect(await titleNow()).toBe('Owner title')
  })

  it('refuses a viewer with 403 and changes nothing', async () => {
    const before = await titleNow()
    expect((await patchAs(viewerId, documentId, { title: 'Nope' })).status).toBe(403)
    expect(await titleNow()).toBe(before)
  })

  it('hides the document from a non-member with 404', async () => {
    expect((await patchAs(strangerId, documentId, { title: 'Nope' })).status).toBe(404)
  })

  it('is 401 signed out', async () => {
    expect((await patchAs(null, documentId, { title: 'Nope' })).status).toBe(401)
  })

  it('is 404 for a document that does not exist', async () => {
    expect((await patchAs(ownerId, 'does-not-exist', { title: 'x' })).status).toBe(404)
  })

  it('rejects an empty, whitespace-only, too long or missing title with 400', async () => {
    const before = await titleNow()
    for (const body of [{ title: '' }, { title: '   ' }, { title: 'x'.repeat(201) }, {}, null]) {
      expect((await patchAs(ownerId, documentId, body)).status, JSON.stringify(body)).toBe(400)
    }
    expect(await titleNow()).toBe(before)
  })
})
```

Check, before relying on it, that `requireUser()` throws `HttpError(401)` when there is no session cookie and that `requireWorkspaceRole` throws 403 for an insufficient role and 404 for a non-member (`apps/web/src/lib/auth-guard.ts`). If any code differs, assert what the existing routes return and say so in the report.

- [ ] **Step 2: Run, expect FAIL** (module not found).

Run: `pnpm --filter @crdt/web exec vitest run test/document-rename.integration.test.ts`

- [ ] **Step 3: Create the route** — `apps/web/src/app/api/documents/[id]/route.ts`:

```ts
import { z } from 'zod'
import { prisma } from '@crdt/db'
import { requireDocumentRole, requireUser, toResponse } from '@/lib/auth-guard'

// Same bound as creating a document (POST /api/workspaces/[id]/documents), applied
// after trimming, so "   " is empty rather than a three-character title.
const Body = z.object({ title: z.string().trim().min(1).max(200) })

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id } = await params
    // Editors and owners. A viewer gets 403; a non-member or a missing id gets 404, so
    // an id alone never confirms that a document exists.
    await requireDocumentRole(user.id, id, 'editor')

    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const document = await prisma.document.update({
      where: { id },
      data: { title: parsed.data.title },
      select: { id: true, title: true },
    })
    return Response.json(document)
  } catch (error) {
    return toResponse(error)
  }
}
```

- [ ] **Step 4: Run, expect PASS.** Prove discrimination: lower the role to `'viewer'` (viewer test fails); drop `.trim()` (whitespace case fails); restore. Commit:

```bash
git add "apps/web/src/app/api/documents/[id]/route.ts" apps/web/test/document-rename.integration.test.ts
git commit -m "feat(api): rename a document, editors and owners only"
```

- [ ] **Step 5: The client call** — `apps/web/src/lib/rename-document.ts`:

```ts
/** Renames a document. True when the server saved it. */
export async function renameDocument(documentId: string, title: string): Promise<boolean> {
  const response = await fetch(`/api/documents/${documentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  return response.ok
}
```

- [ ] **Step 6: The shared title field** — `apps/web/src/components/InlineTitle.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { renameDocument } from '@/lib/rename-document'

/**
 * A document's title as an input that reads as text. Enter or leaving the field saves;
 * Escape, an empty value or an unchanged one puts it back. A failed save puts it back
 * and says so. After a save, router.refresh() re-renders the server components, which
 * is what updates the nav's tab (owned by the workspace layout) and this page.
 */
export function InlineTitle({
  documentId,
  title,
  label,
  className,
  testId,
  autoFocus = false,
  onDone,
}: {
  documentId: string
  title: string
  label: string
  className?: string
  testId: string
  autoFocus?: boolean
  onDone?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [value, setValue] = useState(title)
  const [saving, setSaving] = useState(false)
  const cancelled = useRef(false)

  // A refresh brings the saved title back down; follow it.
  useEffect(() => setValue(title), [title])

  async function commit() {
    if (saving) return
    if (cancelled.current) {
      cancelled.current = false
      setValue(title)
      onDone?.()
      return
    }
    const next = value.trim()
    if (next === '' || next === title) {
      setValue(title)
      onDone?.()
      return
    }
    setSaving(true)
    const saved = await renameDocument(documentId, next)
    setSaving(false)
    if (!saved) {
      setValue(title)
      toast('Could not rename. Try again.')
      onDone?.()
      return
    }
    setValue(next)
    onDone?.()
    router.refresh()
  }

  return (
    <input
      className={className}
      aria-label={label}
      value={value}
      maxLength={200}
      autoFocus={autoFocus}
      aria-busy={saving}
      data-testid={testId}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          cancelled.current = true
          event.currentTarget.blur()
        }
      }}
    />
  )
}
```

- [ ] **Step 7: Write the failing e2e** — `apps/web/e2e/renaming.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'
import { addMember, cleanup, createDocument, documentPath, seedWorkspace, sessionCookieFor, signIn } from './fixtures.js'

const LABEL = 'e2e-rename'
test.afterAll(async () => {
  await cleanup(LABEL)
})

async function open(page: Page, label: string, type: 'doc' | 'board') {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, type)
  await signIn(page, owner.id)
  await page.goto(documentPath(document))
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  return { owner, workspace, document }
}

test('a document is renamed from its own title, and the nav tab follows', async ({ page }) => {
  const { document } = await open(page, `${LABEL}-doc`, 'doc')
  const title = page.getByTestId('document-title')
  await expect(title).toHaveValue('e2e doc')

  await title.fill('Quarterly plan')
  await title.press('Enter')
  await expect(page.getByTestId(`tab-${document.id}`)).toContainText('Quarterly plan')
  await page.reload()
  await expect(page.getByTestId('document-title')).toHaveValue('Quarterly plan')
})

test('a board is renamed from inside the board', async ({ page }) => {
  const { document } = await open(page, `${LABEL}-board`, 'board')
  const title = page.getByTestId('document-title')
  await expect(title).toBeVisible()
  await title.fill('Sprint board')
  await title.press('Enter')
  await expect(page.getByTestId(`tab-${document.id}`)).toContainText('Sprint board')
})

test('Escape and an empty title put the name back and save nothing', async ({ page }) => {
  await open(page, `${LABEL}-revert`, 'doc')
  const title = page.getByTestId('document-title')
  await title.fill('Not this')
  await title.press('Escape')
  await expect(title).toHaveValue('e2e doc')
  await title.fill('  ')
  await title.press('Enter')
  await expect(title).toHaveValue('e2e doc')
  await page.reload()
  await expect(page.getByTestId('document-title')).toHaveValue('e2e doc')
})

test('a document is renamed from its tile on the workspace overview', async ({ page }) => {
  const { owner, workspace } = await seedWorkspace(`${LABEL}-tile`)
  const document = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)

  await page.getByTestId(`rename-${document.id}`).click()
  const field = page.getByTestId(`tile-title-${document.id}`)
  await expect(field).toBeFocused()
  await field.fill('Roadmap')
  await field.press('Enter')
  await expect(page.getByTestId(`document-${document.id}`)).toContainText('Roadmap')
  await expect(page.getByTestId(`tab-${document.id}`)).toContainText('Roadmap')
})

test('a viewer sees the title as text and no rename control', async ({ browser }) => {
  const label = `${LABEL}-viewer`
  const { workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')
  const context = await browser.newContext()
  await context.addCookies([await sessionCookieFor(viewer.id)])
  const page = await context.newPage()

  await page.goto(documentPath(document))
  await expect(page.getByTestId('document-heading')).toHaveText('e2e doc')
  await expect(page.getByTestId('document-title')).toHaveCount(0)
  await page.goto(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId(`rename-${document.id}`)).toHaveCount(0)
  await context.close()
})
```

(`createDocument` titles documents `e2e doc` / `e2e board`; confirm in `e2e/fixtures.ts`.)

- [ ] **Step 8: Run, expect FAIL** (`document-title` not found).

- [ ] **Step 9: The heading in the open document or board** — `DocumentClient` already receives `readOnly={role === 'viewer'}` from the page, so no new prop is needed: editors are `!readOnly`. In `DocumentClient.tsx`, replace the `heading` element with:

```tsx
  /*
    The page's only heading. Editors get the title as an input that reads as the heading
    (InlineTitle); viewers get the plain h1. A board now shows its title too: the owner
    asked to rename a board from inside it, which needs it on screen.
  */
  const headingClass = type === 'doc' ? styles.heading : styles.boardHeading
  const heading = readOnly ? (
    <h1 className={headingClass} data-testid="document-heading">
      {title}
    </h1>
  ) : (
    <h1 className={headingClass} data-testid="document-heading">
      <InlineTitle
        documentId={documentId}
        title={title}
        label={type === 'doc' ? 'Document title' : 'Board title'}
        className={styles.titleInput}
        testId="document-title"
      />
    </h1>
  )
```

Existing tests read the heading: search `apps/web/e2e` for `document-heading`. For an editor the h1 now holds an input, so a `toHaveText(title)` on it fails; change those to `expect(page.getByTestId('document-title')).toHaveValue(title)` (viewer tests keep `toHaveText`). Size assertions on the h1 (the zoom tests) still hold, because the input inherits the heading's font. A test that expected the board heading to be visually hidden must now expect it visible. Then find where the board branch renders today (the `heading` is passed to `DocumentEditor` for docs; for boards it is rendered before `<Board …/>` — read the file's JSX and keep the heading in the same place, now visible). Import `InlineTitle` from `@/components/InlineTitle`. Remove the `ui` import if nothing else uses `ui.labelHidden`.

Append to `document.module.css`:

```css
/* A board's title: smaller than a document's, above the columns, aligned with the
   board's 1000px measure (the toolbar's). */
.boardHeading {
  max-width: 1000px;
  margin: 24px auto 0;
  padding: 0 18px;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

/* The title input inherits the heading's type exactly, so editing does not move text. */
.titleInput {
  width: 100%;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: var(--r-item);
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  line-height: inherit;
}

.titleInput:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-ring);
}
```

The board's own scroller has `padding-top: 44px` (`board.module.css`); with a title above it, reduce that to `20px` only on board pages if the gap looks doubled — measure the title's bottom to the first column's top at 1280px and keep it between 20 and 28px; report the number.

- [ ] **Step 10: The overview tile** — `apps/web/src/components/DocumentTile.tsx` (a client component; the overview page is a server component and passes plain values):

```tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import { InlineTitle } from '@/components/InlineTitle'
import ui from '@/components/ui/ui.module.css'

/**
 * One document on the workspace overview. The tile is a link; editors also get a small
 * rename button, which swaps the title for a focused field until it saves or reverts.
 * While renaming, the tile is not a link, so a click in the field never navigates.
 */
export function DocumentTile({
  href,
  documentId,
  title,
  kind,
  updated,
  canEdit,
  classes,
}: {
  href: string
  documentId: string
  title: string
  kind: 'Board' | 'Page'
  updated: string
  canEdit: boolean
  classes: { tile: string; text: string; title: string; updated: string; rename: string; field: string; wrap: string }
}) {
  const [renaming, setRenaming] = useState(false)

  const body = (
    <>
      <span className={`${ui.chip} ${ui.chipAccent}`} data-testid="document-kind">
        {kind}
      </span>
      <span className={classes.text}>
        {renaming ? (
          <InlineTitle
            documentId={documentId}
            title={title}
            label={`Rename ${title}`}
            className={classes.field}
            testId={`tile-title-${documentId}`}
            autoFocus
            onDone={() => setRenaming(false)}
          />
        ) : (
          <span className={classes.title}>{title}</span>
        )}
        <span className={classes.updated}>{updated}</span>
      </span>
    </>
  )

  return (
    <div className={classes.wrap}>
      {renaming ? (
        <div className={`${ui.glass} ${ui.tile} ${classes.tile}`} data-testid={`document-${documentId}`}>
          {body}
        </div>
      ) : (
        <Link href={href} className={`${ui.glass} ${ui.tile} ${classes.tile}`} data-testid={`document-${documentId}`}>
          {body}
        </Link>
      )}
      {canEdit && !renaming && (
        <button
          type="button"
          className={classes.rename}
          aria-label={`Rename ${title}`}
          title="Rename"
          data-testid={`rename-${documentId}`}
          onClick={() => setRenaming(true)}
        >
          ✎
        </button>
      )}
    </div>
  )
}
```

In `app/workspaces/[id]/page.tsx`, replace the `<Link …>…</Link>` per document with:

```tsx
                <DocumentTile
                  key={document.id}
                  href={documentHref(id, document.id)}
                  documentId={document.id}
                  title={document.title}
                  kind={document.type === 'board' ? 'Board' : 'Page'}
                  updated={`updated ${formatRelativeTime(lastActivity.get(document.id) ?? document.createdAt, now)}`}
                  canEdit={canCreate}
                  classes={{
                    wrap: styles.docTileWrap,
                    tile: styles.docTile,
                    text: styles.docText,
                    title: styles.docTitle,
                    updated: styles.docUpdated,
                    rename: styles.docRename,
                    field: styles.docTitleInput,
                  }}
                />
```

and add to the overview's stylesheet (the module `styles` imports from):

```css
/* The tile and its rename button. The button sits over the tile's top-right corner and
   shows on hover or keyboard focus; the tile underneath stays one link. */
.docTileWrap {
  position: relative;
}

.docRename {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--field-border);
  border-radius: var(--r-pill);
  background: #fff;
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  opacity: 0;
}

.docTileWrap:hover .docRename,
.docRename:focus-visible {
  opacity: 1;
}

/* No hover on touch screens: keep it visible there. */
@media (hover: none) {
  .docRename {
    opacity: 1;
  }
}

.docTitleInput {
  width: 100%;
  padding: 2px 6px;
  margin: -2px -6px;
  border: 0;
  border-radius: var(--r-item);
  background: #fff;
  color: var(--text);
  font: inherit;
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-ring);
}

.docTitleInput:focus {
  outline: none;
}

@media (prefers-reduced-motion: no-preference) {
  .docRename {
    transition: opacity var(--dur-fast) var(--ease);
  }
}
```

Copy the existing tile's `data-testid` and kind chip exactly (the overview's existing e2e tests read `document-<id>` and `document-kind`). Keep `styles.docs`'s grid working: the wrapper is now the grid item, so check the grid's child selectors in the stylesheet (`.docs > *` or similar) still size the tile; adjust them to target `.docTileWrap` and let the tile fill it (`height: 100%`) if needed.

- [ ] **Step 11: Run renaming.spec.ts and the overview/document specs, expect PASS.** Prove discrimination: remove `router.refresh()` (the nav-tab assertions fail); remove the `cancelled` branch (the Escape test fails); restore. Full gate.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/lib/rename-document.ts apps/web/src/components/InlineTitle.tsx apps/web/src/components/DocumentTile.tsx "apps/web/src/app/workspaces/[id]" apps/web/e2e/renaming.spec.ts
git commit -m "feat(documents): rename a document or board from its title or its overview tile"
```

---

### Task 4: Everyone in the document, together

**Files:**
- Modify: `apps/web/src/components/NavPresence.tsx`
- Modify: `apps/web/src/components/SyncStatus.tsx`
- Modify: `apps/web/src/components/AppShell.tsx` (the right side of the nav, today: `{onDocument && <HistoryButton />}`, `<SyncStatus />`, `<NavPresence />`, Share, `<UserMenu />`)
- Modify: `apps/web/src/components/UserMenu.tsx`, `apps/web/src/components/user-menu.module.css`
- Test: `apps/web/e2e/glass-shell.spec.ts`, `apps/web/e2e/collaboration.spec.ts`

**Interfaces:**
- Consumes: `activeDocumentIdFrom(pathname)` (`@/lib/routes`), `colorFor(userId)` (`@/lib/color`), `useDocState()`.
- Produces: `<NavPresence self={{ name, color } | null} documentId={string | null} />`, `<SyncStatus documentId={string | null} />`; test id `presence-self`.

- [ ] **Step 1: Write the failing tests** — in `glass-shell.spec.ts`:

```ts
test('on a document you are in the people group, before History and the status pill', async ({ page }) => {
  const label = `${LABEL}-self`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const self = page.getByTestId('presence-self')
  await expect(self).toBeVisible()
  await expect(self).toHaveAttribute('aria-label', /\(you\)/)

  // Order along the bar: people, History, status, Share, account.
  const order = await page.getByRole('navigation', { name: 'Primary' }).evaluate((nav) =>
    ['presence', 'history', 'status', 'share', 'account-trigger'].map((id) => {
      const el = nav.querySelector(`[data-testid="${id}"]`)
      return el ? el.getBoundingClientRect().left : Number.NaN
    }),
  )
  expect(order.every((x) => !Number.isNaN(x))).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)

  await page.goto(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId('presence')).toHaveCount(0)
  await cleanup(label)
})

test('the account button does not look like a person in the document', async ({ page }) => {
  const label = `${LABEL}-account-look`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const self = page.getByTestId('presence-self')
  const account = page.getByTestId('account-trigger')
  const fill = (locator: typeof self) => locator.evaluate((el) => getComputedStyle(el).backgroundColor)
  // The people group is filled with each person's colour; the account button is not.
  expect(await fill(account)).toBe('rgb(255, 255, 255)')
  expect(await fill(self)).not.toBe('rgb(255, 255, 255)')
  await cleanup(label)
})
```

Use the History button's and the account trigger's real test ids: read `HistoryButton.tsx` and `UserMenu.tsx`; if the account trigger has no `data-testid`, add `data-testid="account-trigger"` to it in this task. In `collaboration.spec.ts`, where two people share a document, assert the group holds two avatars in each browser: `await expect(pageA.getByTestId('presence').locator('[role="img"]')).toHaveCount(2)`.

- [ ] **Step 2: Run, expect FAIL** (`presence-self` not found).

- [ ] **Step 3: `NavPresence`** — replace the component:

```tsx
'use client'

import { useDocState } from '@/lib/doc-state'
import styles from './app-shell.module.css'

/**
 * Everyone in the open document, you first. Rendered on every document page from the
 * first render, because whether you are on a document is known from the route; it does
 * not wait for the connection. Peers come from the doc-state store, and only for the
 * document on screen: while a newly opened one connects, the store may still describe
 * the previous one, whose people are not here.
 */
export function NavPresence({
  self,
  documentId,
}: {
  self: { name: string; color: string } | null
  documentId: string | null
}) {
  const state = useDocState()
  if (!self || !documentId) return null
  const peers = state.documentId === documentId ? state.peers : []

  return (
    <div className={styles.presence} role="group" aria-label="People here" data-testid="presence">
      <span
        className={styles.avatar}
        style={{ background: self.color }}
        title={`${self.name} (you)`}
        role="img"
        aria-label={`${self.name} (you)`}
        data-testid="presence-self"
      >
        {self.name.slice(0, 1).toUpperCase()}
      </span>
      {peers.map((peer) => (
        <span
          key={peer.clientId}
          className={styles.avatar}
          style={{ background: peer.color }}
          title={peer.name}
          role="img"
          aria-label={peer.name}
          // Keyed on clientId, not name: two people can share a display name.
          data-testid={`presence-${peer.clientId}`}
        >
          {peer.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: `SyncStatus`** — take the route's document id, and read the store only when it describes that document:

```tsx
export function SyncStatus({ documentId }: { documentId: string | null }) {
  const state = useDocState()
  if (documentId === null) return null
  // The store may still describe the document you just left; until this one has
  // published, it is connecting.
  const current = state.documentId === documentId
  const status = current ? state.status : 'connecting'
  const peers = current ? state.peers : []

  const { label, dot } = DISPLAY[status]
  const text = status === 'connected' && peers.length > 0 ? `${peers.length + 1} here` : label
  // … the returned JSX is unchanged
```

- [ ] **Step 5: `AppShell`** — compute the route's document id once (it already computes `onDocument` from `activeDocumentIdFrom(usePathname())`; keep that read and name the id), import `colorFor` from `@/lib/color`, and reorder the right side to people, History, status, Share, account:

```tsx
            {onDocument && <NavPresence self={{ name: user.name, color: colorFor(user.id) }} documentId={activeDocumentId} />}
            {onDocument && <HistoryButton />}
            <SyncStatus documentId={activeDocumentId ?? null} />
```

where `const activeDocumentId = activeDocumentIdFrom(usePathname())` and `const onDocument = activeDocumentId !== undefined`. Pass `documentId={activeDocumentId ?? null}` to `NavPresence` too.

- [ ] **Step 6: The account button** — in `UserMenu.tsx`, remove `style={{ background: colorFor(user.id) }}` from the trigger, add `style={{ color: colorFor(user.id) }}` and `data-testid="account-trigger"` (if absent). In `user-menu.module.css`, `.avatar`:

```css
.avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  /* Not a person in the document: white with a field border and the initial in your
     colour, so it never reads as a second avatar in the people group (owner, 2026-10-08). */
  background: #fff;
  box-shadow: inset 0 0 0 1px var(--field-border);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
```

- [ ] **Step 7: Run the new tests and `glass-shell.spec.ts` + `collaboration.spec.ts`, expect PASS.** Update existing assertions that encoded the old behaviour (search for `getByTestId('presence')` and `presence-` in `e2e/`): a test that expected no `presence` group when alone now sees one avatar (you). Below 1100px the group is still clipped for screen readers only (`.presence` rule in `app-shell.module.css`); leave that rule. Prove discrimination: render `NavPresence` after `SyncStatus` again (order test fails); give the account button its colour fill back (look test fails); restore. Full gate.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components apps/web/e2e
git commit -m "feat(nav): everyone in the document as one group, you first, before History and status"
```

---

### Task 5: The nav keeps its width while the next document connects

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx` (the width `useLayoutEffect`)
- Test: `apps/web/e2e/glass-shell.spec.ts`

**Interfaces:**
- Consumes: `activeDocumentId` (Task 4), `useDocState()`.
- Produces: nothing new.

Why: on a move from one document to another the route changes at once, but the new document starts `connecting` with no peers, so the status text and the people group shrink, then grow back when it connects. Each change animates, which reads as the nav collapsing and reopening. While the document on screen is still connecting, the nav does not shrink; when it connects (or after 1.5s at most), it animates once to its final width. Growing is never held.

- [ ] **Step 1: Write the failing test** — `glass-shell.spec.ts`:

```ts
test('moving between two busy documents does not collapse the nav', async ({ page, browser }) => {
  const label = `${LABEL}-no-collapse`
  const { owner, workspace } = await seedWorkspace(label)
  const first = await createDocument(workspace.id, 'doc')
  const second = await createDocument(workspace.id, 'doc')
  const peer = await addMember(workspace.id, label, 'editor')

  // One other person sits in both documents (two tabs), so both read "2 here" with two avatars.
  const peerContext = await browser.newContext()
  await peerContext.addCookies([await sessionCookieFor(peer.id)])
  for (const document of [first, second]) {
    const tab = await peerContext.newPage()
    await tab.goto(`${documentPath(document)}?nobc=1`)
    await expect(tab.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  }

  await signIn(page, owner.id)
  await page.goto(`${documentPath(first)}?nobc=1`)
  await expect(page.getByTestId('status')).toHaveText('2 here')
  const bar = page.getByRole('navigation', { name: 'Primary' })
  const start = (await bar.boundingBox())!.width

  const samples = page.evaluate(async () => {
    const nav = document.querySelector('nav[aria-label="Primary"]')!
    const out: number[] = []
    const t0 = performance.now()
    while (performance.now() - t0 < 2000) {
      out.push(nav.getBoundingClientRect().width)
      await new Promise((r) => requestAnimationFrame(r))
    }
    return out
  })
  await page.getByTestId(`tab-${second.id}`).click()
  const widths = await samples
  await expect(page.getByTestId('status')).toHaveText('2 here')

  // Never narrower than where it started, by more than rounding.
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(start - 2)
  await peerContext.close()
  await cleanup(label)
})
```

Read `glass-shell.spec.ts`'s imports and add `addMember`, `sessionCookieFor`, `Page` as needed. Before Step 3, run it and report the minimum width it records against `start` on the current code (it should dip by roughly one avatar plus the status text).

- [ ] **Step 2: Run, expect FAIL**; record the dip.

- [ ] **Step 3: Implement** in `AppShell.tsx`. Read `const docState = useDocState()` (today the call's result is discarded; keep the subscription). Add:

```tsx
  // A document on screen that has not connected yet. Its status text and people are
  // placeholders that are about to be replaced, so the bar must not shrink to them.
  const settling =
    activeDocumentId !== undefined &&
    (docState.documentId !== activeDocumentId || docState.status === 'connecting')
  const holding = useRef(false)
  const [holdExpired, setHoldExpired] = useState(false)
  useEffect(() => {
    if (!settling) {
      setHoldExpired(false)
      return
    }
    // Never hold forever: a document that cannot connect still gets a correct bar.
    const timer = window.setTimeout(() => setHoldExpired(true), 1500)
    return () => window.clearTimeout(timer)
  }, [settling])
```

and at the start of the width `useLayoutEffect`, after the `animatingWidth` guard and before `const to = bar.scrollWidth`:

```tsx
    // Measure the natural width: an inline width left by a hold would make scrollWidth
    // report the held value instead.
    if (holding.current) {
      bar.style.transition = ''
      bar.style.width = ''
    }
```

then, after `const to = bar.scrollWidth` and `const from = lastNavWidth`, before `lastNavWidth = to`:

```tsx
    if (settling && !holdExpired && from !== null && to < from - 1) {
      // Hold: keep the current width until the document connects; the next render after
      // that animates once, from here to the final width.
      holding.current = true
      bar.style.transition = 'none'
      bar.style.width = `${from}px`
      return
    }
    holding.current = false
```

Keep everything else in the effect as it is (the `from === null` and `< 1` early returns, the reduced-motion check, the pin-then-rAF animation, `done()`). Read the effect carefully: the existing `const from = lastNavWidth; lastNavWidth = to` lines must become `const from = lastNavWidth` … hold check … `lastNavWidth = to`, in that order, so a hold does not overwrite `lastNavWidth`.

- [ ] **Step 4: Run, expect PASS.** Also run the existing nav motion tests (`-g "pill slides|animates to its new width|same nav element|condense"`). Prove discrimination: set the hold condition to `false` (the test fails with the dip); restore. Full gate.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/AppShell.tsx apps/web/e2e/glass-shell.spec.ts
git commit -m "fix(nav): hold the bar's width while the next document connects, so it never collapses and reopens"
```

---

### Task 6: Record it in the handoff

**Files:**
- Modify: `docs/design/glass-handoff.md`

- [ ] **Step 1:** In the Precedence section, add a paragraph "Decisions of 2026-10-08" listing Decisions 1–5 above in one line each.
- [ ] **Step 2:** In the deviation table, delete the row recording the presence avatars sitting after the status pill (Task 4 fixed it) and add rows: the account button is white with your colour as its initial (§5.3 row 9 shows a filled avatar; changed so it does not read as a second person); a board shows its title above the columns (§10 has no title slot); document titles are not live-synced (Decision 5); column rename/delete exist (§10 does not specify them).
- [ ] **Step 3:** In Implementation status → Built, add one line each for: column rename and delete (`board.ts` `renameColumn`/`removeColumn`, `ColumnHead.tsx`); `PATCH /api/documents/[id]` and `InlineTitle`/`DocumentTile`; the people group including you; the width hold while a document connects (1.5s cap).
- [ ] **Step 4: Commit**

```bash
git add docs/design/glass-handoff.md
git commit -m "docs: record renaming, column editing, the people group and the steady nav"
```
