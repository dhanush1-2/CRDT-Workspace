# History Panel and Version Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the history backend into the surface the design describes: a panel that slides in from the right listing every version with who changed it and what they did, a slider to scrub through them, a read-only preview of any moment, and a pill that offers to put that version back.

**Architecture:** The panel reads the version list from the API the backend plan built. Previewing fetches that version's state as bytes and applies them to a throwaway `Y.Doc`, which the board and a read-only editor render instead of the live document — the live document is never touched by a preview. Restoring calls the client-side restore primitives, which write the past state into the live document as ordinary edits through the socket, so it is attributed, role-checked and merged like any other change.

**Tech Stack:** Yjs 13.6, `@tiptap/y-tiptap` (`updateYFragment`, `yXmlFragmentToProsemirrorJSON`), React 19, CSS Modules, Vitest 5, Playwright.

**Spec:** `docs/design/glass-handoff.md` (`**History.**`, the version-preview bar) and the design owner's spec of 2026-10-04, `## 7. History panel` and `## History` under the interaction spec, quoted inline below.

## Refreshed 2026-10-07

Written at `dd4e0e0`. Corrected since: the panel's material is now handoff §13's (`.66` white, blur 30 = `--blur-3`, radius 28) rather than the pre-migration tokens; Step 4's open question is settled by the shell plan's `--nav-bottom` variable. Order: after `2026-10-03-shell-routing-and-nav.md` (its Task 6 builds the History button this replaces the contents of, and its Task 2 moves the document page) and `2026-10-03-history-and-authorship-backend.md`. Baseline at `f7a5cac`: Vitest 282, Playwright 157.

## Global Constraints

- **Run after `2026-10-03-history-and-authorship-backend.md`.** This plan consumes `GET /api/documents/[id]/history`, `GET /api/documents/[id]/history/[version]`, `restoreBoard`, `restoreEditor` and `editorExtensions` / `getEditorSchema`, all of which that plan produces. Nothing here works without it.
- **Run after `2026-10-03-shell-routing-and-nav.md`.** Its Task 6 ships a placeholder History button and a "not available yet" panel. Task 2 here replaces that panel's contents; the button, its `aria-expanded` wiring, its focus return and its tests stay.
- **A preview never touches the live document.** It renders from a separate `Y.Doc` built from fetched bytes. If any code path applies preview state to the live doc, that is the defect this constraint exists to prevent.
- **Restore is not a route.** The backend plan established why: the ProseMirror schema exists only on the client, the sync server's per-frame role check already rejects a viewer's writes, and a server-written update has no connection behind it and therefore no author. Call the primitives.
- **Restore does not promise an exact revert**, per Decision 2 of the design. If anyone else is editing when it lands, both apply, and the result is the restored version plus their edit. The UI must say so rather than implying a clean revert.
- **Viewers may preview and may not restore.** The Restore control is hidden for them, and the protocol rejects it regardless.
- Every colour, radius, duration and easing from a token where one exists. The panel is `--r-panel` (28) and the rows are `--r-card` (18). `@keyframes g-side` already exists, written for this panel and currently unused.
- Pair every `backdrop-filter` with `-webkit-backdrop-filter`. Every animation and transition inside `@media (prefers-reduced-motion: no-preference)`.
- **The panel sits below the nav.** The design's layer order is canvas, content, history panel, nav, sheets, palette, messages. The panel's `top: 84px` assumes the unshrunk nav; the shell plan's scroll-condense moves the bar, so check what the panel does when the nav condenses and say what you found.
- Every test proven to discriminate. **Commit before mutating.**
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build`, `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. **Record the baseline first.**
- Postgres on 5433 is shared across checkouts: never start, stop or restart it. Never touch `.env`, `docker-compose.yml` or `docker-compose.override.yml`. Never run any `fly` command. Never use bare `git stash` / `git stash pop`.

## The gap between the spec and the backend, and how Task 1 closes it

The design's version row reads `Moved 'Enforce roles' to Done` — a sentence about what changed. The backend's `DocumentVersion` carries `id`, `startedAt`, `endedAt`, `author` and `updateCount`. **There is no description, and there is nowhere for one to have come from:** an update is an opaque Yjs binary, and the row that stores it has no idea what it meant.

So a description has to be derived, by applying two consecutive versions' states to two throwaway docs and comparing them. Task 1 does that, per document type, and falls back to a count when the diff is not something there are words for. The honest consequence, recorded in Task 6: some rows will read `4 changes` rather than a sentence, and that is the floor rather than a bug.

---

### Task 1: Say what changed between two versions

**Files:**
- Create: `apps/web/src/lib/version-description.ts`
- Test: `apps/web/test/version-description.test.ts`

**Interfaces:**
- Consumes: `listColumns`, `listCards` from `@crdt/shared/board`; `getEditorSchema`, `EDITOR_FRAGMENT`.
- Produces: `describeChange(before: Y.Doc | null, after: Y.Doc, type: 'doc' | 'board', updateCount: number): string`

- [ ] **Step 1: Write the failing test**

```ts
import * as Y from 'yjs'
import { describe, it, expect } from 'vitest'
import { addCard, addColumn, moveCard, removeCard, renameCard } from '@crdt/shared/board'
import { describeChange } from '../src/lib/version-description.js'

const actor = { id: 'u1', name: 'Grace' }

function board(): Y.Doc {
  const doc = new Y.Doc()
  addColumn(doc, { id: 'todo', title: 'Todo' })
  addColumn(doc, { id: 'done', title: 'Done' })
  addCard(doc, { id: 'c1', title: 'Enforce roles', columnId: 'todo' }, actor)
  return doc
}

function forked(from: Y.Doc): Y.Doc {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(from))
  return doc
}

describe('describeChange on a board', () => {
  it('names a move and where it went', () => {
    const before = board()
    const after = forked(before)
    moveCard(after, 'c1', { columnId: 'done' }, actor)
    // The design's own example sentence.
    expect(describeChange(before, after, 'board', 1)).toBe("Moved 'Enforce roles' to Done")
  })

  it('names an added card and a removed one', () => {
    const before = board()
    const added = forked(before)
    addCard(added, { id: 'c2', title: 'Ship it', columnId: 'todo' }, actor)
    expect(describeChange(before, added, 'board', 1)).toBe("Added 'Ship it'")

    const removed = forked(before)
    removeCard(removed, 'c1', actor)
    expect(describeChange(before, removed, 'board', 1)).toBe("Deleted 'Enforce roles'")
  })

  it('names a rename with both titles', () => {
    const before = board()
    const after = forked(before)
    renameCard(after, 'c1', 'Enforce roles properly', actor)
    expect(describeChange(before, after, 'board', 1)).toBe(
      "Renamed 'Enforce roles' to 'Enforce roles properly'",
    )
  })

  it('names an added column', () => {
    const before = board()
    const after = forked(before)
    addColumn(after, { id: 'blocked', title: 'Blocked' })
    expect(describeChange(before, after, 'board', 1)).toBe("Added the list 'Blocked'")
  })

  it('falls back to a count when several things changed', () => {
    const before = board()
    const after = forked(before)
    addCard(after, { id: 'c2', title: 'A', columnId: 'todo' }, actor)
    moveCard(after, 'c1', { columnId: 'done' }, actor)
    renameCard(after, 'c2', 'B', actor)
    // There is no one sentence for this, and inventing one would misreport it.
    expect(describeChange(before, after, 'board', 7)).toBe('7 changes')
  })

  it('describes the first version with no predecessor', () => {
    expect(describeChange(null, board(), 'board', 3)).toBe('Created the board')
  })
})

describe('describeChange on a document', () => {
  function withText(text: string): Y.Doc {
    const doc = new Y.Doc()
    doc.getText('plain').insert(0, text)
    return doc
  }

  it('counts characters added', () => {
    // Uses the editor's XML fragment in production; this test drives whichever
    // measure the implementation settles on. Match it to the real fragment.
    const before = withText('hello')
    const after = forked(before)
    after.getText('plain').insert(5, ' world')
    expect(describeChange(before, after, 'doc', 1)).toBe('Added 6 characters')
  })

  it('counts characters removed', () => {
    const before = withText('hello world')
    const after = forked(before)
    after.getText('plain').delete(5, 6)
    expect(describeChange(before, after, 'doc', 1)).toBe('Removed 6 characters')
  })

  it('reports a mixed edit as a count', () => {
    const before = withText('hello world')
    const after = forked(before)
    after.getText('plain').delete(0, 5)
    after.getText('plain').insert(0, 'goodbye')
    expect(describeChange(before, after, 'doc', 2)).toBe('Edited the text')
  })

  it('describes the first version with no predecessor', () => {
    expect(describeChange(null, withText('x'), 'doc', 1)).toBe('Created the document')
  })
})
```

The document cases use `getText('plain')` as a stand-in. **Replace them** with the editor's real fragment (`doc.getXmlFragment(EDITOR_FRAGMENT)`), measured with whatever the implementation uses — most likely the plain-text length from `yXmlFragmentToProsemirrorJSON`. Do not ship against a type the editor does not use; say in the report what you measured.

- [ ] **Step 2: Run them to verify they fail, then implement**

```ts
/**
 * One sentence about what changed between two versions.
 *
 * Derived, not stored: an update is opaque Yjs binary and the row holding it has no
 * idea what it meant, so the only way to describe a version is to build both states
 * and compare them.
 *
 * Deliberately conservative. A single recognisable change gets a sentence; anything
 * else gets a count, because a wrong sentence about someone's document is worse than
 * an uninformative one. "N changes" is the floor, not a bug.
 */
```

Structure it as: collect the set of differences (cards added, removed, moved, renamed; columns added, removed, renamed), and if exactly one difference exists, render its sentence; otherwise count. For documents, compare plain-text length: longer is "Added N characters", shorter is "Removed N characters", equal-but-different is "Edited the text".

- [ ] **Step 3: Prove it discriminates**

Commit first. Then make the single-change branch fire whenever at least one difference exists, and re-run: the fallback test fails, reporting a move while three things changed — which is the misreport the conservatism exists to avoid. Restore.

- [ ] **Step 4: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(history): derive a sentence describing what changed between two versions"
```

---

### Task 2: The panel, listing real versions

The spec: `A fixed panel at top:84px; right:16px; bottom:16px, 330px wide, radius 28, glass, entrance g-side .6s` / `Header "History" (18/600) + close` / `Version list, newest first: each entry has an avatar, a description and "Grace · Sep 30, 16:40". The selected entry is highlighted.`

**Files:**
- Modify: `apps/web/src/components/HistoryButton.tsx`
- Create: `apps/web/src/components/HistoryPanel.tsx`
- Create: `apps/web/src/components/history-panel.module.css`
- Create: `apps/web/src/lib/history-client.ts`
- Test: `apps/web/test/history-client.test.ts`, `apps/web/e2e/history.spec.ts`

**Interfaces:**
- Consumes: `GET /api/documents/[id]/history`; `describeChange` (Task 1); `colorFor`; `formatRelativeTime` / the date formatter in `@/lib/format`.
- Produces:
  - `fetchVersions(documentId: string, limit?: number): Promise<DocumentVersion[]>`
  - `fetchVersionState(documentId: string, versionId: string): Promise<Uint8Array>`
  - `<HistoryPanel documentId type onClose onPreview selectedVersionId />`

- [ ] **Step 1: Write the failing client test**

`history-client.test.ts`, against a stubbed `fetch`:

```
- fetchVersions returns the parsed versions and keeps ids as strings
- fetchVersions throws with the response's message on a non-2xx
- fetchVersionState returns the bytes as a Uint8Array, not an ArrayBuffer
- fetchVersionState throws on a 404 rather than resolving to an empty array
```

The last two matter: `response.arrayBuffer()` gives an `ArrayBuffer`, and `Y.applyUpdate` wants a `Uint8Array`; and an empty array would apply cleanly and silently show an empty document as if that were the version's content.

- [ ] **Step 2: Write the failing panel test**

`apps/web/e2e/history.spec.ts`:

```
1. the panel opens from the History button and is headed "History"
2. it lists one row per version, newest first, each with an author name and a time
3. a version by a deleted or pre-authorship author reads "Unknown", not blank
4. a row carries a derived description, not a raw id
5. clicking a row highlights it and nothing else
6. the close button closes the panel and returns focus to the History button
7. a document with no updates shows an empty state, not a spinner forever
8. a failed fetch shows an error the user can retry from, not an empty list
```

Case 3 needs a version with `userId` null — insert the update row directly with the Prisma client in the fixture, as the backend plan's own tests do. Case 8 stubs the route with `page.route`.

- [ ] **Step 3: Replace the placeholder**

`HistoryButton.tsx` keeps everything the shell plan gave it — `aria-expanded`, `aria-controls`, Escape with focus return, outside-click close, the white-while-open style — and renders `<HistoryPanel>` in place of the "not available yet" copy. Its existing e2e test asserts that copy; **update that assertion in this commit** rather than leaving two tests disagreeing.

The panel fetches on mount, holds `versions`, `loading` and `error`, and renders one row per version. Each row needs the previous version's state to describe itself, which means fetching every version's bytes — far too much for a list. **Fetch descriptions lazily:** render the row with author and time immediately and the description as "…" until its two states have been fetched, fetching only the rows that are on screen. Simpler alternative, and the one to take first: fetch states for the **newest ten** rows on mount and show `${updateCount} changes` for the rest. Measure both ways and report the byte cost; take the simple one unless it is visibly slow.

Styles (handoff §13): `position: fixed; top: calc(var(--nav-bottom, 68px) + 16px); right: 16px; bottom: 16px; width: 330px; z-index: 25`, `border-radius: var(--r-panel)` (28px), `background: rgba(255, 255, 255, 0.66)` (a §13 literal with no token; comment it as such, and pair it with the existing no-backdrop-filter fallback pattern at a higher white), `backdrop-filter: var(--blur-3)` with its `-webkit-` pair (blur 30), `box-shadow: var(--glass-hl)`, `animation: g-side 0.6s var(--ease)`, `z-index` below the nav's 30 and above the content's 1 — the design's layer order puts it there. Rows at `--r-card` with 32px avatars; the selected row highlighted, transitioning over 0.35s per the interaction spec.

- [ ] **Step 4: Follow the condensed nav**

The shell plan (Task 5) sets `--nav-bottom` on the app shell: 68px, and 52px once the nav condenses on scroll. The panel's `top` above reads it, so it sits 16px under the nav in both states (84px and 68px), matching §13's 84px at rest. Add `top 0.4s var(--ease)` to the panel's transitions inside its reduced-motion block so it moves with the nav. If the shell plan has not run, the fallback `68px` gives today's 84px.

- [ ] **Step 5: Prove it discriminates**

Commit first. Then: return the bytes as an `ArrayBuffer` from `fetchVersionState` and re-run the client test; render `author?.name` with no fallback and re-run case 3; remove the error branch and re-run case 8. Each should fail. Restore.

- [ ] **Step 6: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(history): the panel, listing real versions with authors and descriptions"
```

---

### Task 3: Preview a version

The spec: `Choosing an older version: the page or board switches to a read-only view of that moment, and the "viewing old version" pill appears under the nav.` / `The page underneath swaps to the old version with a 0.4s fade.`

**Files:**
- Create: `apps/web/src/components/VersionPreview.tsx`
- Create: `apps/web/src/components/ReadOnlyEditor.tsx`
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx`
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/document.module.css`
- Test: `apps/web/e2e/history.spec.ts`

**Interfaces:**
- Consumes: `fetchVersionState` (Task 2); `Board`; `editorExtensions`, `getEditorSchema`, `EDITOR_FRAGMENT`.
- Produces: `<VersionPreview documentId versionId type />` rendering the fetched state read-only.

**Whether a second editor component is needed.** This plan first justified `ReadOnlyEditor` by saying `Editor.tsx` requires a `provider` because `CollaborationCaret` does. **That reason no longer holds.** `Editor.tsx` no longer exists: the formatting toolbar plan absorbed it into `DocumentEditor.tsx`, which accepts a null `doc` and `provider` (it builds the editor without the Collaboration extensions and not editable when either is null). A preview has no provider, since it is a throwaway `Y.Doc` with no socket, and that alone is no longer an obstacle.

Two real differences remain, and they are what to decide on at implementation, not the provider: `DocumentEditor` has **no `content` prop**, so a preview would need one added to render text converted out of the fetched fragment, and it **always renders the toolbar** (a viewer sees the View tab and the zoom control), where a preview wants the toolbar hidden. If both are a small addition (a `content` prop and a `toolbar={false}`), extend `DocumentEditor` rather than keeping a second component, so the sheet, the zoom wrapper and the element styles are not duplicated. If it is not small, `ReadOnlyEditor` stays, built from `editorExtensions` (which the backend plan extracted precisely so the schema has one definition). Either way the preview must read `editorExtensions` and not a copy of the list. Say which was chosen and why in the task report. `Board` already tolerates a null provider through `usePresence` and `setCardFocus`; **verify that** before relying on it, and widen its prop type if it does not.

- [ ] **Step 1: Write the failing test**

```
1. selecting an older version of a board shows that moment's cards, and the live
   board's newer card is absent
2. the live document is unchanged underneath: close the preview and the newer card
   is back
3. a board preview has no add, delete or drag controls
4. selecting an older version of a doc shows that moment's text
5. a doc preview is not editable: typing into it changes nothing
6. the preview fetch failing leaves the live document on screen with an error, not
   a blank page
```

Case 2 is the one that matters most, and it is the constraint this plan opened with: a preview that leaked into the live document would pass cases 1, 3, 4 and 5.

- [ ] **Step 2: Build it**

`VersionPreview` fetches the bytes, applies them to a `Y.Doc` created in a `useMemo` keyed on `versionId`, and destroys that doc on unmount and on every change of version — a doc per preview, never reused, never the live one. Render `Board` with `readOnly` and a null provider, or `ReadOnlyEditor`, by `type`.

`DocumentClient` renders the preview **instead of** the live view while a version is selected, so there is no moment where both are mounted and writing. Cross-fade over 0.4s: the simplest honest version is a `g-fade 0.4s` on whichever view is mounted; a true cross-fade needs both mounted at once, which is exactly what this plan forbids. Use the one-sided fade and say so.

- [ ] **Step 3: Prove it discriminates**

Commit first. Then apply the fetched state to the live `doc` instead of a throwaway, and re-run: case 2 fails and the live document is corrupted — reset your test data afterwards. Then drop `readOnly` on the previewed board and re-run case 3. Restore both.

- [ ] **Step 4: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(history): preview a version read-only, never touching the live document"
```

---

### Task 4: The slider

The spec: `Slider: goes from Earliest to Now. Dragging it previews older versions.` / `Scrubbing: dragging the slider or clicking an entry moves the highlight between entries over 0.35s.`

**Files:**
- Modify: `apps/web/src/components/HistoryPanel.tsx`
- Modify: `apps/web/src/components/history-panel.module.css`
- Test: `apps/web/e2e/history.spec.ts`

**Interfaces:**
- Consumes: the panel's `versions` and selection state.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```
1. the slider's range covers every version, labelled Earliest and Now
2. moving it to the far right selects the newest version and leaves the preview
3. moving it left selects an older version, and the matching row highlights
4. the keyboard works: focus it, press ArrowLeft, and the selection moves one step
5. a document with one version renders the slider disabled rather than broken
```

Case 4 is not optional polish: a drag-only control is unusable without a mouse. A native `<input type="range">` gets it for free, which is the reason to use one.

- [ ] **Step 2: Build it**

A native `<input type="range">` with `min={0} max={versions.length - 1}`, value = the selected index counted from the oldest, so sliding right moves forward in time and matches "Earliest → Now". Give it an `aria-label` of "Version" and `aria-valuetext` naming the selected version's author and time, because the number alone tells a screen-reader user nothing.

Style the track and thumb with the accent per the spec's `Accent: … Used for buttons, the logo, focus rings and the slider`, keeping the native element.

- [ ] **Step 3: Prove it discriminates and commit**

Commit first, then replace the range input with a div-based drag handle and re-run case 4; it should fail. Restore.

```bash
git add apps/web
git commit -m "feat(history): a slider to scrub versions, keyboard included"
```

---

### Task 5: The preview pill, and Restore

The spec: `Viewing an old version: a dark pill showing "Ada · Sep 27, 14:20", Restore (editors and owners only; puts that version back as a new change) and Back to now (returns to the live document).` / `A restore also shows a message.`

**Files:**
- Create: `apps/web/src/components/VersionBar.tsx`
- Create: `apps/web/src/components/version-bar.module.css`
- Modify: `apps/web/src/components/AppShell.tsx`
- Test: `apps/web/e2e/history.spec.ts`

**Interfaces:**
- Consumes: `restoreBoard` from `@crdt/shared/board`, `restoreEditor` from `@/lib/restore-editor` (both from the backend plan); `fetchVersionState`; the toast hook.
- Produces: `<VersionBar version onRestore onBackToNow canRestore />`

**Where it sits.** Another centred pill under the nav, like the connection band. If the connection-states plan has run, **stack them** — preview pill above the connection band — rather than suppressing either. Both carry information the user needs, and a document can plainly be both offline and previewing. Say in the report what you did if that plan has not run.

- [ ] **Step 1: Write the failing test**

```
1. selecting a version shows the pill with that version's author and time
2. Back to now dismisses the pill and returns the live document
3. an editor sees Restore; a viewer does not
4. Restore puts the old content into the live document, and the pill goes
5. after a restore the version list has a new newest entry, attributed to whoever
   restored
6. a restore raises a message naming the version restored from
7. restoring while another browser is editing keeps that person's in-flight edit —
   and the message says the restore merged rather than claiming an exact revert
```

Case 7 is Decision 2 made observable. Two browsers: B types continuously while A restores; assert that B's text is still present afterwards **and** that the copy A sees does not claim an exact revert. If the copy does claim it, the copy is the defect.

- [ ] **Step 2: Build it**

Dark glass per the design — `rgba(28,29,27,.82)` with `blur(24px)` and white text, the same variant the toast uses. Entrance `g-up`.

Restore: fetch the version's state, build a throwaway doc, call `restoreBoard(liveDoc, pastDoc)` or `restoreEditor(liveDoc, pastDoc)` by type, then clear the selection so the live view returns. The update leaves through the normal socket — nothing here talks to the server directly.

The message, which must be true in both cases:

- alone: `Restored version from Sep 27, 14:20`
- with others present: `Restored version from Sep 27, 14:20 · merged with changes made since`

Decide "others present" from the peer count the store already publishes. The second form is the honest one and is why this task exists at all; do not ship only the first.

- [ ] **Step 3: Prove it discriminates**

Commit first. Then:
1. Have Restore apply the state to the live doc with `Y.applyUpdate` instead of the restore primitives, and re-run case 4. Expected: it fails, because applying an old state over a newer one is a merge that changes nothing — which is exactly why the primitives compute a diff instead.
2. Show Restore for viewers and re-run case 3.
3. Always use the short message and re-run case 7's copy assertion.

Restore each.

- [ ] **Step 4: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(history): the version pill, and a restore that tells the truth about merging"
```

---

### Task 6: Verify and reconcile

**Files:**
- Modify: `docs/design/glass-handoff.md`
- Modify: `docs/superpowers/specs/2026-10-02-history-and-telemetry-design.md`

- [ ] **Step 1: Use it with two browsers**

Open a board in two browsers. Make a dozen changes from both. Open the panel: are the authors right, are the descriptions sentences or counts, and in what proportion? Scrub the slider. Preview an old version and confirm the live document is untouched. Restore while the other browser is typing, and read the message. Write all of it down, including the ratio of sentences to counts.

- [ ] **Step 2: Record it**

In the handoff, move the history button, the history panel and the version preview bar out of `### Deferred` into the built list, and remove the note that `g-side` is unused. Record:

- that version descriptions are **derived by diffing two states**, that a single recognisable change gets a sentence and anything else gets a count, and the real ratio you measured
- how many versions' states the list fetches up front, and the byte cost
- that a preview renders from a throwaway `Y.Doc` and the live document is never written to
- that the preview's fade is one-sided, and why a true cross-fade was not built
- that restore goes through the socket, is attributed, and **says it merged** when anyone else is present
- what you decided about `top: 84px` under a condensed nav
- that the slider is a native range input, for the keyboard

In the design doc, mark the `Snapshot list`, `Snapshot content` and `Restore` capabilities as having their UI built, and note that Decision 2's "the UI must tell the truth about the merge" is now implemented in the restore message.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: record the history panel, version preview and restore surface"
```

---

## Self-Review

**1. Spec coverage.** `## 7. History panel` item by item: the panel's geometry and `g-side` entrance, the header and close, the version list with avatar, description and author-and-time, the selected highlight (Task 2); the Earliest-to-Now slider and the 0.35s highlight move (Task 4); the read-only preview and its 0.4s fade (Task 3); the dark pill with author, time, Restore and Back to now, and the restore message (Task 5). Task 1 exists because the spec asks for a sentence the backend cannot supply.

Deliberately **not** here: the status popover and the offline pills, which belong to the connection-states plan; the card sheet's activity list, which is per-card CRDT state and a different thing from document version history; and any server-side restore, which the backend plan ruled out with reasons.

**2. Placeholder scan.** Task 1's document-side tests use `getText('plain')` as an explicitly labelled stand-in, with an instruction to replace it with the editor's real fragment and report what was measured — because guessing the measure would be worse than naming the substitution. Tasks 2-5 give their e2e cases as numbered lists rather than code, since each depends on the board and document fixtures; every list names the case that carries the weight (the `Unknown` author, the untouched live document, the keyboard on the slider, the merged-restore copy). Task 2 Step 3 presents two description-fetching strategies and says which to take first and what to measure.

**3. Type consistency.** `DocumentVersion` is the backend plan's type, consumed unchanged; `id` stays a string from the route to the slider's value. `describeChange(before, after, type, updateCount)` has one signature, with `before` nullable for the first version. `fetchVersionState` returns `Uint8Array` at every layer — the conversion from `ArrayBuffer` happens once, inside it, and Task 2 Step 1 tests that. `restoreBoard(live, from)` and `restoreEditor(live, from)` keep the backend plan's live-first argument order.

**4. Greenness between tasks.** Every task ends on a green full gate. Task 2 updates the shell plan's "not available yet" assertion in the same commit as the copy it replaces. Task 3 widens `Board`'s provider prop, if needed, in the commit that first passes null.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-04-history-panel-and-preview.md`. Run it after the history-and-authorship backend plan and the shell plan.
