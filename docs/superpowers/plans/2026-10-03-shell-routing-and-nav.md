# Shell, Routing and Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move documents under their workspace so one layout owns the nav, which makes the tab indicator slide across navigations, and finish the nav features the design specifies but the app does not have: a presence count that includes you, a label where the dashboard's tabs would be, a History button, the scroll-condensed nav, and a tab dropdown below 760px.

**Architecture:** Documents move from `/documents/[id]` to `/workspaces/[id]/documents/[docId]`. `AppShell` moves out of the three pages that each render their own copy and into `app/workspaces/[id]/layout.tsx`, so the nav DOM survives a navigation between the overview and any document. A layout cannot read the params of the segment below it, so the open document's id is derived from the pathname by a pure helper. The old flat URL stays as a redirect, because it is in bookmarks and in `?next=` values already minted into sign-in links.

**Tech Stack:** Next.js 16 App Router (forced `--webpack`), React 19, Prisma 7 with `@prisma/adapter-pg`, CSS Modules, Vitest 5, Playwright.

**Spec:** `docs/design/glass-handoff.md` — specifically `## 5. Nav` (5.3 contents, 5.4 the sliding indicator, 5.5 responsive and scroll), `## 13. History panel`, the `### Deferred, each needing its own plan` and `### Known limitations` subsections of `## Implementation status`, and the owner's screenshot review recorded in the Decisions section below.

## Refreshed 2026-10-07 — read this first

This plan was written on 2026-10-02 at `cc14f20`. Since then the following landed on `main`, and the tasks below have been corrected for them:

- **`1a98f61` — the pill and the bar carry their motion across a navigation**, by module-level memory (`lastMetrics` in `NavTabs.tsx`, `lastNavWidth` in `AppShell.tsx`), not by a shared layout. Two e2e tests already prove it (`glass-shell.spec.ts`, "the pill slides to the new tab across a navigation…" and "the nav animates to its new width across a navigation"). Task 2 still does the restructure the owner chose, and **keeps both mechanisms**: the dashboard is outside the workspace layout, so a dashboard ↔ workspace navigation still rebuilds the nav. Task 3 shrinks to the one thing only the layout gives: proof the nav node survives.
- **The document toolbar (`f7a5cac` and before)** rewrote `DocumentClient.tsx`. The document's visible heading now lives inside `DocumentClient` (passed to `DocumentEditor` as `heading`), and the page passes `title`. Task 2's page is updated to match. `editor-toolbar.spec.ts` (14 document `goto`s) did not exist when Step 11's list was written; that step is now grep-driven.
- **Token migration (2026-10-03):** `--glass-bg-strong` → `--glass-mid`, `--glass-bg-sheet` → `--glass-sheet`, `--glass-blur` → `--blur-2`, `--glass-highlight` → `--glass-hl`. Every CSS block below uses the new names.
- **The "Workspaces" label and the content-sized nav** landed in `12f785c`; Task 4 is cut to the presence count.
- **The toolbar sticks at `top: 80px`** because the nav does not condense (handoff deviation table, "Sticky offset (§12.1)"). Task 5 makes it follow the condensed nav.
- **Order against the other plans:** run this before `history-panel-and-preview`, `connection-states-and-telemetry`, `offline-persistence` and `material-and-motion-fidelity`, all of which name the moved document page. `2026-10-07-document-gaps.md` is independent; its specs open documents at `/documents/<id>`, which the Task 2 redirect keeps working.

## Global Constraints

- **The visual-corrections plan this used to wait for has run** (`2026-10-02-glass-visual-corrections.md`, merged). Nothing to wait for.
- **No Prisma schema changes, no sync-server changes, no new API routes.** Version history, authorship, the status popover, the queued-edit count and the latency ping all need backend work that belongs to `docs/superpowers/specs/2026-10-02-history-and-telemetry-design.md` and its own plan. The History button in Task 6 is a placeholder panel on purpose.
- **A layout does not gate its pages.** Next renders a layout and its page together, and a client-side navigation can fetch a page's RSC payload without its layout. Every page keeps its own auth check. The layout's check exists so the nav is never rendered for someone who cannot see the workspace.
- Every colour, radius, duration and easing from a token in `apps/web/src/app/globals.css` where one exists. Raw values only where the design gives that literal, with a comment saying so. Existing tokens: `--dur-fast: 0.3s`, `--dur: 0.55s`, `--dur-slow: 0.7s`, `--ease: cubic-bezier(0.32, 0.72, 0, 1)`, `--glass-mid: rgba(255, 255, 255, 0.72)`, `--glass-sheet`, `--glass-menu`, `--blur-1/2/3`, `--glass-hl`, `--r-panel: 28px` (full list: handoff §2).
- **Never widen a shared token to fix one surface.** `--glass-mid` is also the sheets' and popovers' background. The condensed nav sets its own background.
- Pair every `backdrop-filter` with `-webkit-backdrop-filter`. Every animation and transition inside `@media (prefers-reduced-motion: no-preference)`.
- `apps/web/test/css-tokens.test.ts` must keep passing. It walks `src` for `.css` files, so moved files are still covered.
- Every test proven to discriminate: run it against the unfixed code and watch it fail, or mutate the fix and watch it fail. **Commit before mutating** — `git checkout --` silently does nothing on an untracked file, which has bitten this project.
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build` (there is no root build script), `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. Revert `apps/web/next-env.d.ts` if the build rewrites it.
- **Record the baseline before Task 1** and compare against that, not against a number in this document. At `f7a5cac` (2026-10-03) it was Vitest 282, Playwright 157, 14 routes; any plan merged since moves it.
- Postgres on port 5433 is shared across checkouts: never start, stop or restart it. The native Postgres on 5432 is not ours. Never touch `.env`, `docker-compose.yml` or `docker-compose.override.yml`. Never run any `fly` command. Never use bare `git stash` / `git stash pop` — the stash stack is shared with other worktrees.

## Decisions already made by the design owner — do not re-litigate

- **Shared layout, the proper and bigger option.** The owner was offered a client-store shell in the root layout and chose the route restructure, having been told it rewrites every document URL, every link, the OAuth `next=` targets and several tests.
- **The presence count includes yourself.** "2 here" when one other person is present, not "1 here".
- **The History button ships now as a "Coming soon" panel**, not behind a feature flag and not omitted. The nav is supposed to have it, and a panel that says what it will do is honest; a button that silently does nothing is not.
- **Scroll-condensed nav:** 56px → 46px, the wrapper's top gap 12px → 6px, the bar's glass .72 → .85, over 0.4s, triggered after 24px of scroll.
- **Below 760px the tab strip becomes a dropdown.** The existing 1100px rules stay.
- Splatter sizing, the nav exclusion zone, content glass, the document page's gap and heading, and the column drag-over outline all belong to the visual-corrections plan. Not here.

## Known conflicts and orderings

| Where | What | Resolution |
|---|---|---|
| `app/documents/[id]/page.tsx` | The visible heading (`data-testid="document-heading"`) now lives inside `DocumentClient`; the page passes `title` | Task 2's new page passes `title` exactly as today's does. Nothing to carry across. |
| `app/documents/[id]/document.module.css` | Carries `.page` (sheet, `margin: 28px auto 64px`, `data-width`) and `.heading`; `DocumentClient` imports it | Move with `git mv` so the diff shows a rename, not a delete plus an add. |
| `globals.css:289` | A comment names the path `documents/[id]/document.module.css` | Task 2 updates the comment. A stale path in a comment is how the next reader is sent to a file that no longer exists. |
| `NavTabs.tsx` `lastMetrics`, `AppShell.tsx` `lastNavWidth` (`1a98f61`) | Their comments say the shared layout "removes the need for this entirely" | Not true for dashboard ↔ workspace, which still remounts. Task 2 keeps both and corrects the comments. |
| Task 5 `.nav` transition vs the existing `.nav { transition: width … }` | Two rules of equal specificity; the later one wins and drops the width animation | Task 5 writes one combined `transition` list. |
| Splatter nav exclusion (corrections Task 2, 90px) vs the condensed nav (Task 5 here, 52px total) | The exclusion zone was sized for the unshrunk nav | No change needed: 90px already covers the condensed 46 + 6 = 52px, and the splatter is painted once and does not react to scroll. Task 5 asserts the zone is not reduced. |
| Task 2 removes `activeDocumentId` from `AppShell`; Task 6 adds a `usePathname` read to `AppShell` | Both touch the same component | Task 2 first. Task 6 reuses the helper Task 1 creates. |
| Task 7 renders a second set of document links | Duplicate `data-testid` would break Playwright strict mode across the whole existing suite | The dropdown uses its own testids (`nav-menu-item-*`), never `tab-*`. Task 7 asserts `tab-overview` still resolves to exactly one element. |

---

### Task 1: Route helpers

One module with the two pure functions the restructure needs, so that the URL shape is written down in exactly one place and the nav's "which document is open" question has a tested answer.

**Files:**
- Create: `apps/web/src/lib/routes.ts`
- Test: `apps/web/test/routes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `documentHref(workspaceId: string, documentId: string): string` — returns `/workspaces/<workspaceId>/documents/<documentId>`
  - `activeDocumentIdFrom(pathname: string | null): string | undefined`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { activeDocumentIdFrom, documentHref } from '../src/lib/routes.js'

describe('documentHref', () => {
  it('nests the document under its workspace', () => {
    expect(documentHref('ws1', 'doc1')).toBe('/workspaces/ws1/documents/doc1')
  })
})

describe('activeDocumentIdFrom', () => {
  // The invariant that matters: the nav reads back what the links wrote. A change
  // to one function and not the other fails here and nowhere else.
  it('reads the id back out of a href it built', () => {
    expect(activeDocumentIdFrom(documentHref('ws1', 'doc1'))).toBe('doc1')
  })

  it('is undefined on the workspace overview', () => {
    expect(activeDocumentIdFrom('/workspaces/ws1')).toBeUndefined()
  })

  it('is undefined on the dashboard, on the documents collection, and for null', () => {
    expect(activeDocumentIdFrom('/')).toBeUndefined()
    expect(activeDocumentIdFrom('/workspaces/ws1/documents')).toBeUndefined()
    expect(activeDocumentIdFrom(null)).toBeUndefined()
  })

  it('tolerates a trailing slash', () => {
    expect(activeDocumentIdFrom('/workspaces/ws1/documents/doc1/')).toBe('doc1')
  })

  // A future sub-path of a document (a history route, say) should leave that
  // document's tab active rather than deactivating every tab.
  it('still finds the document on a deeper path under it', () => {
    expect(activeDocumentIdFrom('/workspaces/ws1/documents/doc1/history')).toBe('doc1')
  })

  it('is undefined for the legacy flat document path', () => {
    expect(activeDocumentIdFrom('/documents/doc1')).toBeUndefined()
  })

  it('does not match a workspace id containing a slash-escaped lookalike', () => {
    expect(activeDocumentIdFrom('/workspacesXws1/documents/doc1')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @crdt/web exec vitest run test/routes.test.ts`
Expected: FAIL — cannot resolve `../src/lib/routes.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/routes.ts`:

```ts
/**
 * The canonical URL for a document. Documents live under their workspace so that a
 * single layout at the workspace segment can own the nav for both the overview and
 * every document in it.
 */
export function documentHref(workspaceId: string, documentId: string): string {
  return `/workspaces/${workspaceId}/documents/${documentId}`
}

// Anchored at the start, and the id is followed by a slash or the end of the path, so
// a deeper path under a document still resolves to that document.
const DOCUMENT_PATH = /^\/workspaces\/[^/]+\/documents\/([^/]+)(?:\/|$)/

/**
 * The open document's id, read from the path.
 *
 * The nav lives in a layout at the workspace segment, and a layout cannot see the
 * params of the segment below it. The path is therefore the only place the nav can
 * learn which document is open. `usePathname()` supplies it, during the server
 * render as well as on the client, so the active tab is correct in the HTML.
 */
export function activeDocumentIdFrom(pathname: string | null): string | undefined {
  if (!pathname) return undefined
  return DOCUMENT_PATH.exec(pathname)?.[1]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @crdt/web exec vitest run test/routes.test.ts`
Expected: PASS, 9 assertions across 8 tests.

- [ ] **Step 5: Prove the round-trip test discriminates**

Commit nothing yet. Temporarily change `documentHref` to return `/documents/${documentId}` and re-run. Expected: the round-trip test and the `documentHref` test both fail. Restore the correct body.

- [ ] **Step 6: Run the full gate**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, baseline + 8 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/routes.ts apps/web/test/routes.test.ts
git commit -m "feat(routes): one place that knows a document's URL shape"
```

---

### Task 2: Nest documents under workspaces and move the nav into a layout

The restructure. This is one task because every intermediate state is broken: the moment `NavTabs` links to the new URL, the old page must still exist or the links 404; the moment the new page exists, the old one is duplicate code a reviewer would reject. The suite is red in the middle of this task and green at the end of it.

**Files:**
- Create: `apps/web/src/lib/workspace-context.ts`
- Create: `apps/web/src/app/workspaces/[id]/layout.tsx`
- Create: `apps/web/src/app/workspaces/[id]/documents/[docId]/page.tsx`
- Move (`git mv`): `apps/web/src/app/documents/[id]/DocumentClient.tsx` → `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx`
- Move (`git mv`): `apps/web/src/app/documents/[id]/document.module.css` → `apps/web/src/app/workspaces/[id]/documents/[docId]/document.module.css`
- Rewrite: `apps/web/src/app/documents/[id]/page.tsx` (becomes a redirect)
- Modify: `apps/web/src/app/workspaces/[id]/page.tsx` (loses `AppShell`, gains the shared loader)
- Modify: `apps/web/src/components/AppShell.tsx` (drops the `activeDocumentId` prop)
- Modify: `apps/web/src/components/NavTabs.tsx` (reads the active id from the path)
- Modify: `apps/web/src/components/CommandPalette.tsx` (uses `documentHref`)
- Modify: `apps/web/src/app/globals.css` (one comment's stale path)
- Modify: `apps/web/e2e/fixtures.ts` (adds `documentPath`)
- Modify: `apps/web/e2e/glass-shell.spec.ts`, `board.spec.ts`, `collaboration.spec.ts`, `command-palette.spec.ts`, `auth-flow.spec.ts`
- Test: `apps/web/e2e/routing.spec.ts` (new)

**Interfaces:**
- Consumes: `documentHref`, `activeDocumentIdFrom` from Task 1.
- Produces:
  - `loadWorkspaceContext(workspaceId: string, userId: string): Promise<WorkspaceContext>` where `WorkspaceContext = { role: Role; name: string; documents: { id: string; title: string; type: 'doc' | 'board'; createdAt: Date }[]; members: WorkspaceMemberView[] }`. Throws `HttpError(404)` for a workspace the caller cannot see.
  - `documentPath(document: { id: string; workspaceId: string }): string` in `e2e/fixtures.ts`.
  - `AppShell` no longer accepts `activeDocumentId`.
  - `NavTabs` props are `{ workspaceId, documents }`.

- [ ] **Step 1: Write the failing routing tests**

Create `apps/web/e2e/routing.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { cleanup, createDocument, documentPath, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-routing'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('the old flat document URL forwards to the canonical one', async ({ page }) => {
  const label = `${LABEL}-legacy`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(`/documents/${document.id}`)
  await expect(page).toHaveURL(documentPath(document))
  await expect(page.getByTestId(`tab-${document.id}`)).toHaveAttribute('data-active', 'true')

  await cleanup(label)
})

test('a document id under the wrong workspace is not found', async ({ page }) => {
  const mine = `${LABEL}-mine`
  const theirs = `${LABEL}-theirs`
  const { owner, workspace } = await seedWorkspace(mine)
  const other = await seedWorkspace(theirs)
  const strayDocument = await createDocument(other.workspace.id, 'doc')
  await signIn(page, owner.id)

  // A real document id, a workspace the signed-in user really owns, and no
  // relationship between them. Without the pairing check this renders someone
  // else's document under this workspace's nav and tab strip.
  const response = await page.goto(`/workspaces/${workspace.id}/documents/${strayDocument.id}`)
  expect(response?.status()).toBe(404)

  await cleanup(mine)
  await cleanup(theirs)
})

test('a signed-out visit to a canonical document URL carries that URL to sign-in', async ({
  page,
}) => {
  const label = `${LABEL}-signedout`
  const { workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')

  await page.goto(documentPath(document))
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(documentPath(document))}`)

  await cleanup(label)
})

test('the active tab is marked in the server HTML, not by hydration', async ({ page }) => {
  const label = `${LABEL}-ssr`
  const { owner, workspace } = await seedWorkspace(label)
  const open = await createDocument(workspace.id, 'doc')
  const other = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)

  // The raw response, never hydrated. usePathname() has to resolve during the
  // server render for this to hold; if it does not, the tab's active attributes
  // appear only after JS runs, React logs an attribute mismatch, and aria-current
  // is missing for anyone reading the page before hydration.
  const response = await page.request.get(documentPath(open))
  const html = await response.text()

  const openTag = new RegExp(`<a[^>]*data-testid="tab-${open.id}"[^>]*>`).exec(html)?.[0] ?? ''
  expect(openTag).not.toBe('')
  expect(openTag).toContain('aria-current="page"')
  expect(openTag).toContain('data-active="true"')

  // The other half: attributes rendered on every tab would pass the above.
  const otherTag = new RegExp(`<a[^>]*data-testid="tab-${other.id}"[^>]*>`).exec(html)?.[0] ?? ''
  expect(otherTag).not.toBe('')
  expect(otherTag).not.toContain('aria-current')
  expect(otherTag).toContain('data-active="false"')

  await cleanup(label)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @crdt/web exec playwright test e2e/routing.spec.ts`
Expected: FAIL — `documentPath` does not exist in `fixtures.ts`, so the file does not even compile.

- [ ] **Step 3: Add the fixture helper**

In `apps/web/e2e/fixtures.ts`, after `createDocument`:

```ts
/**
 * The canonical URL for a seeded document. Takes the row rather than two ids so
 * call sites cannot pair a document with the wrong workspace.
 */
export function documentPath(document: { id: string; workspaceId: string }): string {
  return `/workspaces/${document.workspaceId}/documents/${document.id}`
}
```

It deliberately does not import `documentHref` from `src/lib/routes.ts`: a test that builds its URL with the same function as the code under test cannot catch that function changing shape. These two agreeing is what `routing.spec.ts` checks.

- [ ] **Step 4: Write the shared workspace loader**

Create `apps/web/src/lib/workspace-context.ts`:

```ts
import { cache } from 'react'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { HttpError, requireWorkspaceRole } from './auth-guard.js'
import type { WorkspaceMemberView } from './members.js'

export type WorkspaceContext = {
  role: Role
  name: string
  documents: { id: string; title: string; type: 'doc' | 'board'; createdAt: Date }[]
  members: WorkspaceMemberView[]
}

/**
 * Everything the workspace nav and the pages under it need, loaded once.
 *
 * React's cache() memoises the result for the duration of one render, so the layout
 * and the page inside it share a single pair of queries rather than each running its
 * own. Both arguments are part of the key: the role is part of the result, so a memo
 * shared between users would be an access-control bug, not a performance win.
 *
 * Throws HttpError(404) for a workspace the caller is not a member of — the same
 * shape requireWorkspaceRole uses, so callers keep their existing 404 handling and a
 * non-member cannot tell a private workspace from one that does not exist.
 */
export const loadWorkspaceContext = cache(
  async (workspaceId: string, userId: string): Promise<WorkspaceContext> => {
    const role = await requireWorkspaceRole(userId, workspaceId, 'viewer')

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        name: true,
        documents: {
          select: { id: true, title: true, type: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        members: {
          select: { role: true, user: { select: { id: true, name: true, email: true } } },
          orderBy: { user: { name: 'asc' } },
        },
      },
    })
    // A membership row for a workspace that no longer exists: possible only in a
    // race with a delete, and the caller already handles 404.
    if (!workspace) throw new HttpError(404, 'not found')

    return {
      role,
      name: workspace.name,
      documents: workspace.documents,
      members: workspace.members.map((member) => ({
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        role: member.role,
      })),
    }
  },
)
```

- [ ] **Step 5: Write the workspace layout**

Create `apps/web/src/app/workspaces/[id]/layout.tsx`:

```tsx
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/AppShell'
import { HttpError } from '@/lib/auth-guard'
import { getCurrentUser } from '@/lib/current-user'
import { loadWorkspaceContext } from '@/lib/workspace-context'

/**
 * The nav for everything inside a workspace: the overview and every document.
 *
 * It lives here rather than in each page so that it is not remounted when you move
 * between them. The sliding tab indicator can only animate across a navigation if
 * the node it lives on survives that navigation; while each page rendered its own
 * AppShell, the pill appeared at its destination instead of travelling there.
 *
 * This layout does NOT gate the pages under it. Next renders a layout and its page
 * together, and a client-side navigation can fetch a page's RSC payload on its own,
 * so a layout is never a security boundary. Every page below does its own check.
 * This one's check is here so the nav is not rendered for someone who cannot see the
 * workspace.
 */
export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>
  children: ReactNode
}) {
  const { id } = await params

  const user = await getCurrentUser()
  // No redirect here, on purpose. Only the page knows the full path, so only the
  // page can build an accurate `?next=`, and it redirects for exactly this case —
  // which makes this branch unreachable in a real response. Racing the page with a
  // second, less accurate redirect would land a signed-out visitor on the workspace
  // overview after signing in rather than on the document they asked for.
  if (!user) return <>{children}</>

  let context
  try {
    context = await loadWorkspaceContext(id, user.id)
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }

  return (
    <AppShell
      user={user}
      workspace={{ id, name: context.name }}
      // Mapped, not passed whole: AppShell is a client component and NavDocument
      // carries no createdAt. Every prop crossing that boundary stays a plain string.
      documents={context.documents.map(({ id: documentId, title, type }) => ({
        id: documentId,
        title,
        type,
      }))}
      members={context.members}
      canManage={context.role === 'owner'}
      role={context.role}
    >
      {children}
    </AppShell>
  )
}
```

- [ ] **Step 6: Move the document page under the workspace**

Move the two sibling files first, so their relative imports keep resolving:

```bash
mkdir -p "apps/web/src/app/workspaces/[id]/documents/[docId]"
git mv "apps/web/src/app/documents/[id]/DocumentClient.tsx" "apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx"
git mv "apps/web/src/app/documents/[id]/document.module.css" "apps/web/src/app/workspaces/[id]/documents/[docId]/document.module.css"
```

Then create `apps/web/src/app/workspaces/[id]/documents/[docId]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { HttpError, requireWorkspaceRole } from '@/lib/auth-guard'
import { colorFor } from '@/lib/color'
import { getCurrentUser } from '@/lib/current-user'
import { documentHref } from '@/lib/routes'
import { DocumentClient } from './DocumentClient'

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>
}) {
  const { id: workspaceId, docId } = await params

  const user = await getCurrentUser()
  // Outside any try/catch — redirect() signals by throwing.
  if (!user) redirect(`/login?next=${encodeURIComponent(documentHref(workspaceId, docId))}`)

  // The layout above is not a gate (see its comment); this is the access check.
  // Declared with its type: `let role` alone is implicitly `any` under strict.
  let role: Role
  try {
    role = await requireWorkspaceRole(user.id, workspaceId, 'viewer')
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }

  // Both ids in the where clause. A real document id paired with a workspace the
  // caller happens to own would otherwise render someone else's document under this
  // workspace's nav and tabs. Queried only after the role check, so a non-member
  // never learns whether an id exists.
  const document = await prisma.document.findFirst({
    where: { id: docId, workspaceId },
    select: { title: true, type: true },
  })
  if (!document) notFound()

  // The visible heading is rendered by DocumentClient from `title` (it sits inside the
  // zoomed wrapper with the editor; see DocumentEditor), exactly as on the old page.
  return (
    <DocumentClient
      documentId={docId}
      title={document.title}
      type={document.type}
      readOnly={role === 'viewer'}
      user={{ name: user.name, color: colorFor(user.id) }}
    />
  )
}
```

`requireWorkspaceRole` returns `Promise<Role>` (`apps/web/src/lib/auth-guard.ts:51`, checked 2026-10-07).

- [ ] **Step 7: Turn the old route into a redirect**

Replace the whole contents of `apps/web/src/app/documents/[id]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import { HttpError, requireDocumentRole } from '@/lib/auth-guard'
import { getCurrentUser } from '@/lib/current-user'
import { documentHref } from '@/lib/routes'

/**
 * The old flat document URL.
 *
 * Documents live under their workspace now, but this path is in bookmarks, in links
 * people have shared, and in `?next=` values already minted into sign-in URLs. It
 * resolves the workspace and forwards.
 *
 * The role check runs before the redirect because the canonical URL contains the
 * workspace id: redirecting first would hand that id to anyone holding a document id,
 * including people with no access to either.
 */
export default async function LegacyDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const user = await getCurrentUser()
  // The legacy path, not the canonical one: nothing has been looked up yet, so there
  // is no workspace id to put in the URL. After signing in the user lands back here
  // and is forwarded from a request that can resolve it.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/documents/${id}`)}`)

  let workspaceId: string
  try {
    ;({ workspaceId } = await requireDocumentRole(user.id, id, 'viewer'))
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }

  redirect(documentHref(workspaceId, id))
}
```

- [ ] **Step 8: Strip AppShell out of the workspace overview**

In `apps/web/src/app/workspaces/[id]/page.tsx`:

- Replace the inline `requireWorkspaceRole` call and the `prisma.workspace.findUnique` block with one `loadWorkspaceContext(id, user.id)` call inside the existing try/catch, keeping the `HttpError`/404 → `notFound()` handling.
- Delete the `<AppShell …>` wrapper and its import, and the now-unused `AppShell`, `prisma` and `requireWorkspaceRole` imports. The page's root element becomes `<div className={styles.page}>`.
- `role`, `workspace.name`, `workspace.documents` and `members` all come off the context object. `canCreate` and the `MembersPanel` props are unchanged apart from where they read from.
- Document links become `href={documentHref(id, document.id)}`.
- Keep the page's own `getCurrentUser()` / `redirect('/login?next=…')` — the layout does not gate it.

- [ ] **Step 9: Point the nav and the palette at the new URL**

`apps/web/src/components/NavTabs.tsx`:

```tsx
import { usePathname } from 'next/navigation'
import { activeDocumentIdFrom, documentHref } from '@/lib/routes'

export function NavTabs({
  workspaceId,
  documents,
}: {
  workspaceId: string
  documents: NavDocument[]
}) {
  // The nav lives in the workspace layout, which cannot see the [docId] param of the
  // segment below it. usePathname resolves during the server render too, so the
  // active tab is already marked in the HTML and hydration has nothing to correct.
  const pathname = usePathname()
  const activeDocumentId = activeDocumentIdFrom(pathname)
  // … the rest of the component is unchanged; both layout effects keep
  // [activeDocumentId, documents] and [documentId, othersHere] as their deps.
```

and the document tab's `href` (today `` `/documents/${document.id}` ``, `NavTabs.tsx:191`) becomes `documentHref(workspaceId, document.id)`.

**Keep `lastMetrics`** (module level, `NavTabs.tsx:30`). Within a workspace the nav now survives navigation and the memory is redundant, but the dashboard renders its own `AppShell` outside this layout, so a dashboard ↔ workspace navigation still builds a new strip and still needs it. Replace the last sentence of its comment ("The shared-layout restructure removes the need for this entirely, because the nav stops being rebuilt.") with: "Within a workspace the nav now lives in the workspace layout and is not rebuilt, so this only matters for a navigation to or from the dashboard, which is outside that layout."

`apps/web/src/components/AppShell.tsx`: delete the `activeDocumentId` prop from the type and the destructuring, and drop it from the `<NavTabs>` call. **Keep `lastNavWidth`** and the width effect for the same reason. The effect runs after every render with no dependency array, so on a navigation that keeps the nav mounted it animates from the last width to the new one exactly as it does on a remount; nothing in it needs changing. In its comment block, change "the bar is a brand-new node on every navigation" to "the bar is a brand-new node on a navigation to or from the dashboard".

`apps/web/src/components/CommandPalette.tsx`: the documents loop becomes

```ts
run: go(workspace ? documentHref(workspace.id, document.id) : `/documents/${document.id}`),
```

The fallback is not dead code to delete: `documents` and `workspace` are independent optional props, and the legacy path still resolves. A `workspace!` here would be a crash waiting for the first caller that passes one without the other.

- [ ] **Step 10: Fix the stale comment**

`apps/web/src/app/globals.css` line ~289 names `documents/[id]/document.module.css`. Update it to `workspaces/[id]/documents/[docId]/document.module.css`.

- [ ] **Step 11: Migrate the e2e suite**

Find every flat document URL the specs open (the line numbers moved with the toolbar work, so search rather than trusting a list):

```bash
grep -nE "goto\(\`/documents/|/documents/\\$\{" apps/web/e2e/*.ts
```

At 2026-10-07 that is `editor-toolbar.spec.ts` (14), `glass-shell.spec.ts` (13), `auth-flow.spec.ts` (5), `board.spec.ts` (2), `collaboration.spec.ts` (1, inside `openAs`), `command-palette.spec.ts` (1). Import `documentPath` and replace each `` page.goto(`/documents/${x.id}`) `` with `page.goto(documentPath(x))`, keeping any query string (`` page.goto(`${documentPath(x)}?nobc=1`) ``). In `collaboration.spec.ts` change `openAs(context, userId, documentId)` to take a path as its third argument and update every call site. In `editor-toolbar.spec.ts` the shared `openDocument` helper covers most cases; the multi-context tests build their own URLs. `createDocument` returns the Prisma row, which carries `workspaceId`, so `documentPath(document)` works wherever a test already has the document.

The redirect would keep these tests passing unchanged, but each would then exercise the redirect rather than the page, and a regression in the canonical route would hide behind it.

Leave alone, on purpose:

- `auth-flow.spec.ts`, 'a document in a workspace you are not a member of': stays on the legacy path. It proves the redirect route also 404s rather than leaking a workspace id. Add one line of comment saying so. `routing.spec.ts` covers the canonical path's 404.
- `auth-flow.spec.ts`, 'an unauthenticated visit to a document' (the `toHaveURL(`/login?next=…/documents/…`)` assertion, ~line 227): leave the legacy path and the legacy `next=` assertion exactly as they are; that is the behaviour the redirect route preserves. The final `page.goto` after `signIn` now lands on the canonical URL; add `await expect(page).toHaveURL(documentPath(document))` before the `[aria-current="page"]` assertion.

One assertion changes rather than moves:

- `command-palette.spec.ts` ~line 100: tighten `toHaveURL(new RegExp(\`/documents/${target.id}$\`))` to `toHaveURL(documentPath(target))`. The old regex matches the canonical URL by accident, which is exactly why it must be made exact.

Afterwards, the same grep should show only the deliberate legacy uses above.

- [ ] **Step 12: Run the routing tests**

Run: `pnpm --filter @crdt/web exec playwright test e2e/routing.spec.ts`
Expected: PASS, 4 tests.

If the SSR test fails because `usePathname()` returns `null` during the server render, do not paper over it with `suppressHydrationWarning`. The contingency is to mark the active tab only after mount (`const [mounted, setMounted] = useState(false)` set in an effect, active state gated on it), accept that `aria-current` arrives with hydration, change that test to assert the post-hydration state, and record the shortfall in the handoff under Task 8. Report which of the two worlds you are in.

- [ ] **Step 13: Prove the pairing check discriminates**

Commit first. Then delete `workspaceId` from the `findFirst` where clause and re-run `routing.spec.ts`. Expected: 'a document id under the wrong workspace is not found' fails with 200 instead of 404. Restore it.

- [ ] **Step 14: Run the full gate**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: all green. The route count in the build output goes from 14 to 15 (the legacy redirect stays, the canonical document route is new).

- [ ] **Step 15: Commit**

```bash
git add -A apps/web
git commit -m "refactor(routing): nest documents under workspaces, nav in one layout

The tab indicator could not animate across a navigation because each page
rendered its own AppShell, so the whole nav remounted and the pill appeared at
its destination. One layout at the workspace segment now owns it.

The old /documents/[id] URL stays as a redirect: it is in bookmarks and in
?next= values already minted into sign-in links."
```

---

### Task 3: Prove the nav node survives a navigation

**Refreshed 2026-10-07.** The slide itself is already proven: `1a98f61` added "the pill slides to the new tab across a navigation instead of appearing there" and "the nav animates to its new width across a navigation" to `glass-shell.spec.ts`, and Task 2's gate keeps them green. Those pass with or without the layout, because module-level memory carries the motion across a remount. What only the layout gives, and nothing yet proves, is that the nav is **not rebuilt**: no remount, no re-run of the entrance animation, no lost focus, no lost scroll position in the tab strip. That is this task.

**Files:**
- Test: `apps/web/e2e/glass-shell.spec.ts`

**Interfaces:**
- Consumes: `documentPath` from `e2e/fixtures.ts`.
- Produces: nothing.

- [ ] **Step 1: Write the test**

Add to `apps/web/e2e/glass-shell.spec.ts`:

```ts
test('moving between the overview and documents keeps the same nav element', async ({ page }) => {
  const label = `${LABEL}-same-nav`
  const { owner, workspace } = await seedWorkspace(label)
  const first = await createDocument(workspace.id, 'board')
  const second = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(`/workspaces/${workspace.id}`)
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav).toBeVisible()
  // A marker on the DOM node itself. A rebuilt nav is a new node without it.
  await nav.evaluate((el) => el.setAttribute('data-e2e-marker', 'kept'))

  // Overview -> document -> another document -> overview: the two hard directions
  // (different pages) and the easy one (two instances of the same page).
  for (const tab of [`tab-${first.id}`, `tab-${second.id}`, 'tab-overview']) {
    await page.getByTestId(tab).click()
    await expect(page.getByTestId(tab)).toHaveAttribute('data-active', 'true')
    await expect(nav).toHaveAttribute('data-e2e-marker', 'kept')
  }

  await cleanup(label)
})
```

- [ ] **Step 2: Run it, expect PASS**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts -g "same nav element|pill slides|animates to its new width"`
Expected: PASS, 3 tests (the new one and the two from `1a98f61`).

- [ ] **Step 3: Prove it discriminates**

Commit first. Then temporarily wrap the layout's `<AppShell>` in `<div key={Math.random()}>` in `app/workspaces/[id]/layout.tsx`, which forces a remount on every render, and re-run. Expected: the new test fails on the marker after the first click, while the two motion tests still pass, which is the point: they cannot tell a kept nav from a rebuilt one. Restore.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/glass-shell.spec.ts
git commit -m "test(nav): the nav element survives navigation inside a workspace"
```

---

### Task 4: The presence count (the dashboard's tab slot is already done)

**The "Workspaces" label landed on 2026-10-04 in `12f785c`**, with the content-sized
nav, because that geometry turned the unlabelled slot into a visible hole. `nav-context`
exists and is covered; the label half of this task has been removed. What remains is
the presence count including yourself (handoff §5.3 row 7: "`{n} here` (**you included**)").

**Files:**
- Modify: `apps/web/src/components/SyncStatus.tsx:23`
- Modify: `apps/web/e2e/collaboration.spec.ts` (line ~212, `'1 here'` → `'2 here'`)
- Test: `apps/web/e2e/glass-shell.spec.ts`

**Interfaces:**
- Consumes: `useDocState()` from `@/lib/doc-state` (`peers` excludes this tab's own client).
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

In `apps/web/e2e/collaboration.spec.ts`, inside 'both users see each other in the presence bar', add before the cleanup:

```ts
  // The count includes you. Two browsers are open, so it says two, not one.
  await expect(pageA.getByTestId('status')).toHaveText('2 here')
```

Add to `apps/web/e2e/glass-shell.spec.ts`:

```ts
test('alone in a document the pill says Synced, not a count of one', async ({ page }) => {
  const label = `${LABEL}-alone`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(documentPath(document))
  // Counting yourself when there is nobody else would make this "1 here", which
  // tells the reader nothing. The design's copy for that state is "Synced".
  await expect(page.getByTestId('status')).toHaveText('Synced')

  await cleanup(label)
})
```

Also update the existing 'below 1100px the avatars and the status label stay available' test in `collaboration.spec.ts`: its `getByText('1 here')` becomes `getByText('2 here')`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts -g "alone in a document" e2e/collaboration.spec.ts`
Expected: the collaboration assertions FAIL (the count reads '1 here'); 'alone in a document' already passes, and is there to pin the solo state against the change in Step 3.

- [ ] **Step 3: Count yourself**

In `apps/web/src/components/SyncStatus.tsx`, replace the `text` line:

```ts
  // `peers` excludes this tab's own client, so the count is peers plus you — what
  // "3 here" means to the person reading it. Alone, a count of one says nothing, so
  // that state keeps the connection label instead.
  const text = status === 'connected' && peers.length > 0 ? `${peers.length + 1} here` : label
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts e2e/collaboration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Prove the count test discriminates**

Commit first. Change `peers.length + 1` back to `peers.length` and re-run `collaboration.spec.ts`. Expected: the '2 here' assertion fails with '1 here'. Then change the solo branch to `${peers.length + 1} here` unconditionally and re-run. Expected: 'alone in a document' fails with '1 here'. Restore both.

- [ ] **Step 6: Run the full gate**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/SyncStatus.tsx apps/web/e2e/collaboration.spec.ts apps/web/e2e/glass-shell.spec.ts
git commit -m "fix(nav): count yourself among the people here"
```

---

### Task 5: The nav condenses on scroll

Handoff §5.5: "Scroll > 24px: add `data-compact`. Height 56 → 46, wrapper top padding 12 → 6, fill .72 → .85, animated over .4s with `--ease`." This plan's attribute is `data-condensed` (the tests below use it); either name satisfies the spec, which describes behaviour.

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/components/app-shell.module.css`
- Modify: `apps/web/src/components/editor-toolbar.module.css` (the toolbar follows the nav)
- Modify: `docs/design/glass-handoff.md` (the "Sticky offset (§12.1)" deviation row)
- Test: `apps/web/e2e/glass-shell.spec.ts`, `apps/web/e2e/editor-toolbar.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `data-condensed="true" | "false"` on the element carrying `data-testid="nav-bar"`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/e2e/glass-shell.spec.ts`:

```ts
test('the nav condenses once the page is scrolled, with a dead band on the way back', async ({
  page,
}) => {
  const label = `${LABEL}-condense`
  const { owner, workspace } = await seedWorkspace(label)
  // Enough tiles for the overview to be taller than a short viewport.
  for (let i = 0; i < 8; i++) await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.setViewportSize({ width: 1280, height: 420 })
  await page.goto(`/workspaces/${workspace.id}`)

  const bar = page.getByTestId('nav-bar')
  await expect(bar).toHaveAttribute('data-condensed', 'false')

  // Guard the premise: nothing below means anything if the page cannot scroll.
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  )
  expect(scrollable).toBeGreaterThan(100)

  const tall = (await bar.boundingBox())!
  expect(Math.round(tall.height)).toBe(56)
  expect(Math.round(tall.y)).toBe(12)

  await page.evaluate(() => window.scrollTo(0, 40))
  await expect(bar).toHaveAttribute('data-condensed', 'true')
  // Polled: the height and the gap are transitioned over 0.4s.
  await expect.poll(async () => Math.round((await bar.boundingBox())!.height)).toBe(46)
  await expect.poll(async () => Math.round((await bar.boundingBox())!.y)).toBe(6)

  // Inside the dead band. A single 24px threshold would flip back here, and every
  // flip re-renders the whole nav; jitter around the threshold would strobe it.
  await page.evaluate(() => window.scrollTo(0, 18))
  await expect(bar).toHaveAttribute('data-condensed', 'true')

  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(bar).toHaveAttribute('data-condensed', 'false')
  await expect.poll(async () => Math.round((await bar.boundingBox())!.height)).toBe(56)

  await cleanup(label)
})

test('a page loaded already scrolled starts condensed', async ({ page }) => {
  const label = `${LABEL}-condense-load`
  const { owner, workspace } = await seedWorkspace(label)
  for (let i = 0; i < 8; i++) await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.setViewportSize({ width: 1280, height: 420 })
  await page.goto(`/workspaces/${workspace.id}#people-heading`)

  // A listener alone never fires here: the browser restores or jumps the scroll
  // position without a scroll event the effect can hear.
  await expect(page.getByTestId('nav-bar')).toHaveAttribute('data-condensed', 'true')

  await cleanup(label)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts -g "condense"`
Expected: FAIL — there is no `nav-bar` testid.

- [ ] **Step 3: Add the scroll state**

In `apps/web/src/components/AppShell.tsx`, beside the existing `useEffect` for the keyboard shortcut:

```tsx
  // Condensed once the page has scrolled past the bar's own height. One boolean, so
  // scrolling costs at most one re-render per crossing.
  const [condensed, setCondensed] = useState(false)

  useEffect(() => {
    let frame = 0
    function read() {
      frame = 0
      // A dead band, not a single threshold: at exactly 24px a one-pixel wobble
      // flips the state on every frame, and each flip re-renders the whole nav.
      setCondensed((was) => (was ? window.scrollY > 12 : window.scrollY > 24))
    }
    function onScroll() {
      // Coalesce a burst of scroll events into one read per frame.
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    // Read once on mount. A reload part-way down the page, or a #fragment target,
    // arrives already scrolled and fires no scroll event.
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [])
```

Then apply it to the shell, the wrapper and the bar. Today they read `<div className={styles.navWrap}>` and `<nav ref={nav} className={styles.nav} aria-label="Primary">` (`AppShell.tsx:162-163`); keep the `ref`, which the width animation needs:

```tsx
      <div className={styles.shell} data-nav-condensed={condensed}>
        …
        <div className={`${styles.navWrap} ${condensed ? styles.navWrapCondensed : ''}`}>
          <nav
            ref={nav}
            className={`${styles.nav} ${condensed ? styles.navCondensed : ''}`}
            aria-label="Primary"
            data-testid="nav-bar"
            data-condensed={condensed}
          >
```

`data-nav-condensed` goes on the outermost `.shell` element, the one that wraps both the nav and `children`, so that the document toolbar (inside `children`) can read it through a CSS variable in Step 4. If the outermost element is not `.shell`, put it on whichever element wraps both.

- [ ] **Step 4: Add the CSS**

In `apps/web/src/components/app-shell.module.css`, after the `.nav` rule:

```css
/*
  The condensed state. 56 → 46, the wrapper's gap 12 → 6, the glass .72 → .85, over
  0.4s. All four are design literals: there is no 0.4s token (--dur-fast is 0.3s,
  --dur is 0.55s), and the .85 background is set here rather than on
  --glass-mid, which the sheets and popovers also use.
*/
.navCondensed {
  height: 46px;
  background: rgba(255, 255, 255, 0.85);
}

.navWrapCondensed {
  padding-top: 6px;
}

@media (prefers-reduced-motion: no-preference) {
  .navWrap {
    transition: padding-top 0.4s var(--ease);
  }
}
```

**Do not add a second `transition` to `.nav`.** It already has `transition: width var(--dur) var(--ease)` inside the existing reduced-motion block (the in-page width animation, handoff §5.2), and a later rule of the same specificity would replace it, silently dropping the width animation. Edit that existing declaration to the combined list instead:

```css
    transition:
      width var(--dur) var(--ease),
      height 0.4s var(--ease),
      background 0.4s var(--ease);
```

`AppShell`'s cross-navigation width animation sets `transition` inline for the length of one width change and then clears it, which hands control back to this list; a height change that lands during that half-second simply does not animate, which is acceptable.

Expose the nav's bottom edge to the page, on the shell, so the toolbar can follow it (12px wrapper gap + 56px bar = 68; condensed 6 + 46 = 52):

```css
/* The nav's bottom edge, for anything sticky under it (the document toolbar). */
.shell {
  --nav-bottom: 68px;
}

.shell[data-nav-condensed='true'] {
  --nav-bottom: 52px;
}
```

The 36px-high children still fit at 46px (5px of clearance each side), so nothing inside the bar needs a condensed variant.

**The toolbar follows.** `editor-toolbar.module.css` sticks the toolbar at `top: 80px`, which the handoff's deviation table explains as "the nav in this repo does not condense on scroll, so there is no smaller offset to follow". §12.1 asks for "12px under the nav". Change the toolbar's `top: 80px` to:

```css
  /* 12px under the nav (handoff 12.1), following it when it condenses on scroll. */
  top: calc(var(--nav-bottom, 68px) + 12px);
```

and add `top 0.4s var(--ease)` to the toolbar's transitions inside its reduced-motion block (or add a reduced-motion block with `transition: top 0.4s var(--ease)` if it has none; read the file first and extend any existing `transition` list rather than adding a second declaration). `editor-toolbar.spec.ts`'s 'the toolbar stays 80px from the top while the page scrolls' now expects 64 (52 + 12) once scrolled; update that assertion to `toBeCloseTo(64, 0)` behind an `expect.poll`, because `top` animates over 0.4s.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts -g "condense|width|pill slides" e2e/editor-toolbar.spec.ts -g "80px|toolbar stays"`
Expected: PASS, including both nav-motion tests from `1a98f61` (the guard on the combined `transition`) and the updated toolbar offset test.

- [ ] **Step 6: Prove the tests discriminate**

Commit first. Then:
1. Delete the `read()` call before `addEventListener` and re-run. Expected: 'a page loaded already scrolled' fails.
2. Replace the dead band with a single `window.scrollY > 24` and re-run. Expected: the dead-band assertion at scrollY 18 fails.

3. Replace the combined `.nav` transition with the height/background-only list the first draft of this plan had, and re-run "the nav animates to its new width across a navigation". Expected: it still passes, because that test drives the inline transition. So also check in-page: on a document, open a second browser so "2 here" appears and measure the bar's width over 300ms with `page.evaluate` and `requestAnimationFrame`; with the width transition gone it jumps in one frame. Record the measurement in the report. This is the regression the combined list prevents, and no existing test pins it, so add that check to `glass-shell.spec.ts` as its own test if it discriminates.

Restore all three.

- [ ] **Step 7: Check the splatter exclusion zone still covers the bar**

The visual-corrections plan keeps the splatter out of the top 90px. Condensed, the bar occupies 6 + 46 = 52px, so it is still inside that zone, and the splatter is painted once and does not react to scroll. Confirm by reading the exclusion constant in `apps/web/src/components/PaintSplatter.tsx` and checking it is unchanged at 90. Do not reduce it to match the condensed height: the bar is 68px tall before you scroll.

- [ ] **Step 7b: Record the toolbar offset in the handoff**

In `docs/design/glass-handoff.md`, replace the deviation-table row that begins `| Sticky offset (§12.1) |` with:

```markdown
| Sticky offset (§12.1) | "12px under the nav" | `top: calc(var(--nav-bottom) + 12px)`: 80px, and 64px once the nav condenses | `--nav-bottom` is set on the shell from the nav's state (68px, condensed 52px); the toolbar's `top` animates with the nav over .4s. |
```

- [ ] **Step 8: Run the full gate**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add apps/web docs/design/glass-handoff.md
git commit -m "feat(nav): condense the bar once the page scrolls, and the toolbar follows it"
```

---

### Task 6: The History button

The nav is supposed to have a History button on documents. The panel behind it needs a snapshot list, authorship on updates and a restore route — none of which exist, and all of which belong to the history backend plan. So the button ships now and says so.

**Files:**
- Create: `apps/web/src/components/HistoryButton.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/components/app-shell.module.css`
- Test: `apps/web/e2e/glass-shell.spec.ts`

**Interfaces:**
- Consumes: `activeDocumentIdFrom` from `@/lib/routes` (Task 1).
- Produces: nothing other components use.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/e2e/glass-shell.spec.ts`:

```ts
test('History is offered on a document, explains itself, and closes cleanly', async ({ page }) => {
  const label = `${LABEL}-history`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  // Not on the overview: the design puts History among the per-document controls.
  await page.goto(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId('history')).toHaveCount(0)

  await page.goto(documentPath(document))
  const button = page.getByTestId('history')
  await expect(button).toBeVisible()
  await expect(button).toHaveAttribute('aria-expanded', 'false')

  await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  const panel = page.getByTestId('history-panel')
  await expect(panel).toBeVisible()
  // It must not imply it works. Whatever the wording, it has to say it is not here yet.
  await expect(panel).toContainText('not available yet')

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  // Escape without a focus return leaves the keyboard at the top of the document.
  await expect(button).toBeFocused()

  // A click elsewhere closes it too.
  await button.click()
  await expect(panel).toBeVisible()
  await page.getByTestId('search').click()
  await expect(panel).toHaveCount(0)
  await page.keyboard.press('Escape')

  await cleanup(label)
})
```

The final `Escape` is there because clicking `search` opens the palette; leaving it open would bleed into whatever runs next in the file.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts -g "History is offered"`
Expected: FAIL — no `history` testid.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/HistoryButton.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './app-shell.module.css'

/**
 * The nav's History control.
 *
 * The panel the design specifies lists every saved version of a document with its
 * author and lets you preview or restore one. None of that exists yet: updates carry
 * a Yjs client number rather than a user, and there is no snapshot list, content or
 * restore route. Those are the history backend's work.
 *
 * The button ships anyway, because the alternative to a control that explains itself
 * is a nav that quietly lacks a feature the design has. It must never imply the
 * feature works.
 *
 * A disclosure, not a menu: the panel is prose, so aria-expanded plus aria-controls
 * describes it exactly and no menu/menuitem semantics are invented for it.
 */
export function HistoryButton() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Without this, Escape drops focus to the document body and the next Tab
      // restarts from the top of the page.
      button.current?.focus()
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      // The button's own click toggles; closing here as well would reopen it.
      if (button.current?.contains(target) || panel.current?.contains(target)) return
      setOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div className={styles.historyWrap}>
      <button
        type="button"
        ref={button}
        className={`${styles.history} ${open ? styles.historyOpen : ''}`}
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls="history-panel"
        data-testid="history"
      >
        History
      </button>

      {open && (
        <div
          id="history-panel"
          ref={panel}
          className={styles.historyPanel}
          role="group"
          aria-label="History"
          data-testid="history-panel"
        >
          <p className={styles.historyTitle}>History</p>
          <p className={styles.historyBody}>
            Version history is not available yet. When it arrives, this panel will list
            every saved version of this document with who changed it, and let you preview
            or restore one.
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Render it on documents only**

In `apps/web/src/components/AppShell.tsx`, add the imports and the pathname read:

```tsx
import { usePathname } from 'next/navigation'
import { activeDocumentIdFrom } from '@/lib/routes'
import { HistoryButton } from './HistoryButton'
```

```tsx
  // Read from the path rather than from the doc-state store: the store is populated
  // by the page after it mounts, so the button would pop into the nav a beat after
  // the rest of it.
  const onDocument = activeDocumentIdFrom(usePathname()) !== undefined
```

and render it directly **before** `<SyncStatus />` (`AppShell.tsx`, today `<SyncStatus />` then `<NavPresence />` then the Share button):

```tsx
            {onDocument && <HistoryButton />}
            <SyncStatus />
```

Handoff §5.3 orders the right side as presence avatars (5), History (6), status pill (7), Share (8). The avatars currently sit *after* the status pill, which is an existing deviation this task does not fix; record it in Task 8 as a deviation, and leave the reorder to `material-and-motion-fidelity` (presence detail) or the owner.

- [ ] **Step 5: Add the CSS**

In `apps/web/src/components/app-shell.module.css`:

```css
/* The panel is positioned against this, not against the nav: the nav's
   backdrop-filter makes it a containing block for fixed descendants, and an
   absolutely positioned panel wants a positioned parent of its own anyway. */
.historyWrap {
  position: relative;
  flex: none;
}

/* Field style, like the search and status pills. White when open, per the design. */
.history {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 14px;
  border-radius: var(--r-pill);
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  box-shadow: inset 0 1px 2px rgba(30, 30, 50, 0.06);
  color: #55585f;
  font-size: 14px;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.historyOpen {
  background: #fff;
}

@media (prefers-reduced-motion: no-preference) {
  .history {
    transition: background var(--dur-fast) var(--ease);
  }
}

.historyPanel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 300px;
  padding: 18px 20px 20px;
  border-radius: var(--r-panel);
  background: var(--glass-sheet);
  backdrop-filter: var(--blur-2);
  -webkit-backdrop-filter: var(--blur-2);
  border: 1px solid var(--glass-border);
  box-shadow:
    var(--glass-hl),
    0 18px 40px rgba(30, 30, 50, 0.16);
}

@media (prefers-reduced-motion: no-preference) {
  .historyPanel {
    transform-origin: top right;
    animation: g-pop 0.45s var(--ease);
  }
}

/* 18/600, the heading size the design gives the real panel. */
.historyTitle {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
}

.historyBody {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-muted);
}
```

Check that `g-pop` exists in `globals.css` before using it; it is the nav's own entrance keyframe, so it should. If the panel's `color`/`background` literals above have tokens, use the tokens — `#55585f` is copied from the sibling `.search` and `.status` rules, which is why it is a literal here too.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts -g "History is offered"`
Expected: PASS.

- [ ] **Step 7: Prove it discriminates**

Commit first. Then:
1. Delete `button.current?.focus()` from the Escape handler and re-run. Expected: the `toBeFocused` assertion fails.
2. Remove the `onDocument &&` guard so the button renders everywhere, and re-run. Expected: the `toHaveCount(0)` assertion on the overview fails.

Restore both.

- [ ] **Step 8: Run the full gate**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(nav): a History button that says what it will do and that it is not ready"
```

---

### Task 7: Tabs become a dropdown below 760px

**Files:**
- Create: `apps/web/src/components/NavMenu.tsx`
- Modify: `apps/web/src/components/NavTabs.tsx`
- Modify: `apps/web/src/components/nav-tabs.module.css`
- Test: `apps/web/e2e/glass-shell.spec.ts`

**Interfaces:**
- Consumes: `activeDocumentIdFrom`, `documentHref` from `@/lib/routes`; `NavDocument` from `./AppShell`; `useDocState` from `@/lib/doc-state`.
- Produces: `NavMenu({ workspaceId, documents })`.

Both the strip and the menu render; CSS shows exactly one. That keeps the server render viewport-independent — a `matchMedia` read would differ between server and client and flash on every load — and `display: none` removes the hidden one from the accessibility tree, which is correct here because the two carry the same links.

**The menu must not reuse the strip's testids.** `tab-overview`, `tab-<id>` and `tab-dot-<id>` appear all over the existing suite, and Playwright's strict mode fails on two matches even when one is `display: none`. The menu's testids are `nav-menu`, `nav-menu-item-overview`, `nav-menu-item-<id>` and `nav-menu-dot`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/e2e/glass-shell.spec.ts`:

```ts
test('below 760px the tab strip becomes a dropdown', async ({ page }) => {
  const label = `${LABEL}-narrow-tabs`
  const { owner, workspace } = await seedWorkspace(label)
  const first = await createDocument(workspace.id, 'doc')
  const second = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(documentPath(first))
  await expect(page.getByTestId('tab-overview')).toBeVisible()
  await expect(page.getByTestId('nav-menu')).toBeHidden()
  // One element, not two. A duplicated testid breaks every existing tab assertion.
  await expect(page.getByTestId('tab-overview')).toHaveCount(1)

  await page.setViewportSize({ width: 700, height: 800 })
  await expect(page.getByTestId('tab-overview')).toBeHidden()
  const trigger = page.getByTestId('nav-menu')
  await expect(trigger).toBeVisible()
  // It names where you are, which is the one thing the strip showed that a single
  // button has to keep.
  await expect(trigger).toContainText(first.title)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('nav-menu-item-overview')).toBeVisible()
  await expect(page.getByTestId(`nav-menu-item-${first.id}`)).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByTestId(`nav-menu-item-${second.id}`)).not.toHaveAttribute('aria-current')

  await page.getByTestId(`nav-menu-item-${second.id}`).click()
  await expect(page).toHaveURL(documentPath(second))
  // The nav survives the navigation now, so a menu left open would stay open over
  // the new page.
  await expect(page.getByTestId(`nav-menu-item-${second.id}`)).toHaveCount(0)
  await expect(trigger).toContainText(second.title)

  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('nav-menu-item-overview')).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await cleanup(label)
})

test('at 760px the nav does not force the page to scroll sideways', async ({ page }) => {
  const label = `${LABEL}-760`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.setViewportSize({ width: 760, height: 800 })
  await page.goto(documentPath(document))
  await expect(page.getByTestId('nav-menu')).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  await cleanup(label)
})
```

`first.title` and `second.title` both come back as `e2e doc` / `e2e board` from the fixture, so they are distinguishable.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts -g "760|dropdown"`
Expected: FAIL — no `nav-menu`.

- [ ] **Step 3: Write the menu**

Create `apps/web/src/components/NavMenu.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useDocState } from '@/lib/doc-state'
import { activeDocumentIdFrom, documentHref } from '@/lib/routes'
import type { NavDocument } from './AppShell'
import styles from './nav-tabs.module.css'

/**
 * The tab strip, for widths where a strip does not fit: one button naming where you
 * are, and a list of everywhere you can go.
 *
 * It renders alongside the strip and CSS picks one. A matchMedia read instead would
 * make the server render depend on a viewport the server cannot know, and the wrong
 * one would be visible until hydration.
 *
 * A disclosure of links, not a menu: links in a menu need menuitem semantics that
 * fight their own role, and nothing here needs arrow-key navigation that Tab does
 * not already provide.
 */
export function NavMenu({
  workspaceId,
  documents,
}: {
  workspaceId: string
  documents: NavDocument[]
}) {
  const pathname = usePathname()
  const activeDocumentId = activeDocumentIdFrom(pathname)
  const { documentId, peers } = useDocState()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const active = documents.find((document) => document.id === activeDocumentId)
  const label = active ? active.title : 'Overview'

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (button.current?.contains(target) || list.current?.contains(target)) return
      setOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div className={styles.menu}>
      <button
        type="button"
        ref={button}
        className={styles.menuTrigger}
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls="nav-menu-list"
        data-testid="nav-menu"
      >
        <span className={styles.menuLabel}>{label}</span>
        {/* The strip puts this dot on the open document's tab; here the trigger is
            the open document, so it carries it. */}
        {activeDocumentId !== undefined &&
          activeDocumentId === documentId &&
          peers.length > 0 && (
            <span className={styles.presenceDot} aria-hidden="true" data-testid="nav-menu-dot" />
          )}
        <span className={styles.menuCaret} aria-hidden="true" />
      </button>

      {open && (
        <ul id="nav-menu-list" ref={list} className={styles.menuList}>
          <li>
            <Link
              className={`${styles.menuItem} ${!activeDocumentId ? styles.menuItemActive : ''}`}
              href={`/workspaces/${workspaceId}`}
              aria-current={!activeDocumentId ? 'page' : undefined}
              onClick={() => setOpen(false)}
              data-testid="nav-menu-item-overview"
            >
              Overview
            </Link>
          </li>
          {documents.map((document) => {
            const isActive = document.id === activeDocumentId
            return (
              <li key={document.id}>
                <Link
                  className={`${styles.menuItem} ${isActive ? styles.menuItemActive : ''}`}
                  href={documentHref(workspaceId, document.id)}
                  aria-current={isActive ? 'page' : undefined}
                  // The nav outlives the navigation now, so the menu has to be told
                  // to close; it would otherwise stay open over the new page.
                  onClick={() => setOpen(false)}
                  data-testid={`nav-menu-item-${document.id}`}
                >
                  {document.title}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Render both from NavTabs**

`NavTabs` returns a fragment holding the strip it already renders and the menu:

```tsx
  return (
    <>
      <div className={styles.strip} ref={strip} style={{ /* unchanged */ }}>
        {/* unchanged */}
      </div>
      <NavMenu workspaceId={workspaceId} documents={documents} />
    </>
  )
```

The strip keeps `flex: 0 1 auto` (`nav-tabs.module.css`; a growing strip makes the content-sized nav grow to the window and lose its centring, see that file's comment), so a fragment containing two flex items of the nav is fine: only one of them is ever displayed, and the menu is sized the same way.

- [ ] **Step 5: Add the CSS**

In `apps/web/src/components/nav-tabs.module.css`:

```css
/* One of these two is displayed at a time; see NavMenu. */
.menu {
  position: relative;
  display: none;
  /* 0 1 auto like the strip: a growing child stretches the content-sized nav. */
  flex: 0 1 auto;
  min-width: 0;
}

@media (max-width: 760px) {
  .strip {
    display: none;
  }
  .menu {
    display: flex;
    align-items: center;
  }
}

.menuTrigger {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--field-border);
  border-radius: var(--r-pill);
  background: var(--field-bg);
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}

/* The one thing that must shrink: a long document title would otherwise push the
   caret, and then the rest of the nav, off the edge. */
.menuLabel {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.menuCaret {
  flex: none;
  margin-left: auto;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--icon-faint);
}

.menuList {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  z-index: 1;
  min-width: 220px;
  max-width: 280px;
  margin: 0;
  padding: 6px;
  list-style: none;
  border-radius: var(--r-card);
  background: var(--glass-sheet);
  backdrop-filter: var(--blur-2);
  -webkit-backdrop-filter: var(--blur-2);
  border: 1px solid var(--glass-border);
  box-shadow:
    var(--glass-hl),
    0 18px 40px rgba(30, 30, 50, 0.16);
}

@media (prefers-reduced-motion: no-preference) {
  .menuList {
    transform-origin: top left;
    animation: g-pop 0.45s var(--ease);
  }
}

.menuItem {
  display: block;
  padding: 8px 12px;
  border-radius: 12px;
  color: var(--text-muted);
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menuItem:hover {
  background: rgba(255, 255, 255, 0.7);
  color: var(--text);
  text-decoration: none;
}

/* The same active colour the strip's active tab uses. */
.menuItemActive,
.menuItemActive:hover {
  font-weight: 600;
  color: oklch(0.36 0.11 285);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts -g "760|dropdown"`
Expected: PASS, 2 tests.

Handoff §5.5 says the workspace name hides below 760px; this plan's first draft only capped it if the overflow test failed. Hide it, and the divider beside it, in `app-shell.module.css`:

```css
/* Below 760px the tabs become one dropdown and the workspace name hides (handoff 5.5).
   The logo still links to the dashboard; the dropdown's Overview entry replaces the name. */
@media (max-width: 760px) {
  .workspaceName,
  .divider {
    display: none;
  }
}
```

and add to the 'below 760px the tab strip becomes a dropdown' test: `await expect(page.getByTestId('workspace-link')).toBeHidden()`. If the overflow test still fails at 760px, report the measured overflow and its culprit; do not relax the assertion.

- [ ] **Step 7: Prove the tests discriminate**

Commit first. Then:
1. Change the `@media (max-width: 760px)` breakpoint to `420px` and re-run. Expected: the dropdown test fails at 700px, where the strip is still shown.
2. Remove `onClick={() => setOpen(false)}` from the document link and re-run. Expected: the "menu closed after navigating" assertion fails. This is the assertion that only matters because Task 2 made the nav survive a navigation.

Restore both.

- [ ] **Step 8: Measure the phone case and record it**

At 375px, measure and write down in the task report: `documentElement.scrollWidth - innerWidth`, and whether the account avatar's bounding box is fully on screen. The handoff records a 17px overflow and an unreachable account menu at that width. This task was not asked to fix 375px; Task 8 records whatever the dropdown changed about it, measured rather than assumed.

- [ ] **Step 9: Run the full gate**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(nav): a tab dropdown below 760px"
```

---

### Task 8: Verify and reconcile the handoff

The handoff is the binding spec. Three of its recorded limitations are no longer true, and the route shape it describes has changed.

**Files:**
- Modify: `docs/design/glass-handoff.md`

**Interfaces:**
- Consumes: the measurements from Tasks 2, 3, 5 and 7.
- Produces: nothing.

- [ ] **Step 1: Look at it**

Run `pnpm --filter @crdt/web dev` and open, at 1280px: the dashboard, a workspace overview, and a document. Then at 700px and at 375px. Scroll each past 24px. Open the History panel and the tab dropdown.

Write down, for the report:
1. Does the pill travel when you click between tabs, and from Overview to a document?
2. Does the nav condense, and does it settle rather than flicker when you scroll slowly across the threshold?
3. At 700px, is the dropdown usable and does the rest of the nav fit?
4. At 375px, what is still broken?

- [ ] **Step 2: Update `## Implementation status`**

- **Delete** the "The tab indicator does not animate across navigations" limitation (~line 1386). It was already stale before this plan: `1a98f61` made the pill and the bar animate across navigations with module-level memory. Replace it with one line in the built list: the nav lives in `app/workspaces/[id]/layout.tsx` and is not rebuilt inside a workspace (Task 3's test), documents are at `/workspaces/[id]/documents/[docId]`, the old flat URL redirects, and `lastMetrics` / `lastNavWidth` remain for navigations to and from the dashboard. Resolve the "still an open question" about the glide near line 1221 the same way.
- **Record** that the presence avatars sit after the status pill, where §5.3 puts them before it (deviation table), and that History is placed per §5.3.
- **Add** a line stating that a layout is not an access gate in this codebase and every page under it checks for itself — with the reason, because this is the kind of thing a later reader deletes as duplication.
- **Update** the "No phone layout" limitation with what Task 7 measured at 375px. If the dropdown fixed part of it, say which part; if the avatar is still off screen, keep the limitation and say so.
- **Record** the condensed nav's values (56→46, 12→6, .72→.85, 0.4s, 24px with a 12px dead band) under §5.5's build notes (the Implementation status section, not §5.5 itself, which is regenerated from the design tool), and note that 0.4s is a literal because no token matches, and that the attribute is `data-condensed` where §5.5 says `data-compact`.
- **Record** the 760px breakpoint beside the existing 1100px rules, and that the dropdown is a disclosure of links rather than a menu, deliberately.
- **Record** the presence count copy: peers plus you when anyone else is present, the connection label when alone.
- **Move** "History button" out of `### Deferred` into a new, honest entry: the button and an explanatory panel are built; the panel's contents wait on the history backend. The history panel and version preview bar stay deferred.

- [ ] **Step 3: Check the handoff for other stale claims**

Grep it for `/documents/` and for `AppShell`, and fix every path and claim that the restructure invalidated — including the component table near the top of the file.

- [ ] **Step 4: Commit**

```bash
git add docs/design/glass-handoff.md
git commit -m "docs: record the shell restructure, the condensed nav and the 760px dropdown"
```

---

## Self-Review

**1. Spec coverage.** Of the owner's review and the handoff's deferred shell work, this plan covers: the shared layout and the route restructure (Task 2), the tab-highlight slide and its proof (Tasks 2-3), the presence count including yourself and the dashboard "Workspaces" label (Task 4), scroll-shrink (Task 5), the History button (Task 6), and tabs-to-dropdown below 760px (Task 7). Task 1 is the shared vocabulary those depend on; Task 8 reconciles the spec.

Deliberately **not** here, with their owners named: splatter sizing, the nav exclusion zone, content glass, the document page's gap and heading, and the column drag-over outline belong to `2026-10-02-glass-visual-corrections.md`, which runs first. The status popover, the offline and syncing pills, the palette's "Go offline" item, the history panel and version preview bar, the card detail sheet and "Has notes" all need backend capability and belong to the history and telemetry plans.

**2. Placeholder scan.** One intentional gap, and it is flagged twice rather than hidden: the document page's heading element in Task 2 Step 6 is a `HEADING:` comment, because its exact markup is produced by the visual-corrections plan's Task 4 and copying a guess here would either conflict with that plan or quietly drop its change. Step 6 names both things left to finish, including the `role` variable that the sketch leaves undefined on purpose so the implementer has to read it rather than paste it.

**3. Type consistency.** `documentHref(workspaceId, documentId)` and `activeDocumentIdFrom(pathname)` are used with those signatures in Tasks 2, 6 and 7. `loadWorkspaceContext(workspaceId, userId)` is called with that argument order in the layout and the overview page; the document page deliberately does not use it, because it needs a role and a title, not a member list. `documentPath(document)` takes the seeded row in every e2e call site. `NavTabs` loses `activeDocumentId` in Task 2 before Task 7 adds a sibling to it. `AppShell` gains `condensed` state in Task 5 and an `onDocument` read in Task 6, in that order.

**4. Greenness between tasks.** Task 2 is the only task that is red in the middle, and it has to be: links, pages and tests move together. Every other task ends on a green full gate. Task 4 changes two existing assertions (`'1 here'` → `'2 here'` in `collaboration.spec.ts`) in the same commit as the behaviour, so no commit leaves them disagreeing.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-03-shell-routing-and-nav.md`. Run it after `2026-10-02-glass-visual-corrections.md`.
