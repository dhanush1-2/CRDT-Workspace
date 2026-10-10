# Gallery Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Glass look (translucent blurred panels, pills) with Gallery (flat white surfaces, hairlines, 2px corners, violet accent, Schibsted Grotesk) on every screen, changing no feature, layout, route, test id or motion except where the spec says so.

**Architecture:** A foundation of three tasks lands the Gallery tokens, the font, the canvas and splatter, a "no red" guard and a fix for the app-wide dead CSS-module animations. Then each screen, in the spec's order, swaps its own stylesheets from the glass tokens to the Gallery ones and proves the change with computed-style Playwright checks in a new `e2e/gallery.spec.ts`. A growing list in `test/gallery-material.test.ts` stops a migrated file from drifting back. A cleanup task deletes the glass tokens once nothing reads them, and a records task writes `docs/design/gallery-handoff.md`.

**Tech Stack:** Next.js 16.3.5 App Router (forced `--webpack`), React 19.3, CSS Modules plus `apps/web/src/app/globals.css`, `next/font/google`, Tiptap 3.31, Vitest 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-10-gallery-redesign-design.md` (approved by Dhanush, 2026-10-10). It is binding. Visual reference: `docs/design/Workspace F - Gallery.dc.html` (open with `support.js` beside it; build only its defaults: violet, canvas "gallery", splashes "subtle", splashColor "gallery", toolbarPlacement "sheet"). Where the spec and the reference disagree, the spec wins; every such case is listed under "Decisions made in this plan" and recorded in the handoff. Read the spec and your own task before starting.

## Global Constraints

- **Never edit `.env`, `docker-compose.yml` or `docker-compose.override.yml`.**
- **Never start, stop or restart the Postgres on port 5433** (shared across checkouts) **and never touch the Postgres on 5432** (not ours; never guess its credentials). Never start, stop or restart Docker.
- **Never run any `fly` command.**
- **Never use bare `git stash` / `git stash pop`.** The stash stack is shared with other worktrees and sessions.
- **Never run `pkill`, and never kill a process you did not start.**
- **Stage by explicit path only**; never `git add -A`, `git add .` or `git commit -a`. **Never stage** `README.md` (the owner's uncommitted edit), `CRDT workspace design.zip`, `apps/web/next-env.d.ts` or `apps/web/AGENTS.md`. If a dev server or build modifies `next-env.d.ts` or `AGENTS.md`, restore it with `git checkout -- <file>`. Quote paths with brackets: `git add "apps/web/src/app/workspaces/[id]/page.tsx"`.
- **Do not push.** The branch is `gallery-redesign`; it merges once, after Dhanush has seen it.
- **Do not execute `docs/superpowers/plans/2026-10-04-material-and-motion-fidelity.md`.** The spec sets it aside.
- **Truncated files.** If `git status` shows a source file you did not write as modified, and it ends mid-file, restore it with `git checkout -- <file>` and say so in your report. This has happened three times in this repo from an unknown writer.
- **Every transition and animation sits inside `@media (prefers-reduced-motion: no-preference)`.** From Task 3 on, `apps/web/test/css-motion.test.ts` enforces it for every CSS file. JavaScript-driven motion checks `matchMedia('(prefers-reduced-motion: reduce)')` and skips.
- **Tokens:** use the tokens in `apps/web/src/app/globals.css` (Task 1 adds the Gallery set: `--paper`, `--paper-soft`, `--ink`, `--hairline`, `--rule`, `--wash`, `--shadow-float`, `--r`, `--selection`, and the violet `--accent*` family). A raw value only where the spec or the reference gives a literal that no token holds, with a comment saying so. `apps/web/test/css-tokens.test.ts` must keep passing; Task 1 extends it for the next/font variable.
- **Corners:** `border-radius: var(--r)` (2px) on everything. Only avatars, status and presence dots, the nav logo, swatches, the slider thumb and the round × close buttons keep `50%`.
- **Shadows:** none, except floating menus, sheets and the ⌘K palette, which get `var(--shadow-float)`. Rings drawn as `0 0 0 Npx` (focus, selection, the board card's hairline) stay. See "Decisions" for which panels count as sheets.
- **No red anywhere** except `#c4372b` (`--danger`) for error text and the delete action. From Task 2 on, `apps/web/test/no-red.test.ts` enforces it.
- **Keep every `data-testid`, every ARIA attribute, every route, and every CSS-module class name that a test selects by substring:** `indicator`, `strip`, `scroller`, `people`, `canvas` (in `canvas-background.module.css`), `statusDot`. New test ids may be added.
- **CSS-module animation names** referring to the shared keyframes in `globals.css` are written `global(g-pop)` (Task 3 explains why). `apps/web/test/css-motion.test.ts` enforces it.
- **Tests are updated, never deleted**, unless the spec removes the thing they test; then the task says so and replaces the test with one for what the spec puts in its place. Each task lists exactly which existing tests change and why.
- **Every new or changed test must be shown to discriminate**: write it first and watch it fail against the unchanged code, or (for a test of behaviour that already exists) commit, mutate the code so the behaviour breaks, watch the test fail, and restore with `git checkout -- <file>` (tracked files only). Say in the task report which way each test was proven.
- **e2e cleanup is per label.** Every Playwright test seeds under its own label (`${LABEL}-something`) and calls `cleanup(label)` at its end; each file calls `cleanup(LABEL)` in `test.afterAll`.
- **Geometry after Task 3.** Entrance animations run from Task 3 on. Before reading a bounding box straight after a navigation, call `settleAnimations(page)` from `e2e/fixtures.ts` (Task 3 adds it). Never loosen an assertion to absorb an animation.
- **Fonts are fetched at build time.** `next/font/google` downloads Schibsted Grotesk during `next build` and `next dev`. If a build fails on the font download, stop and report; do not switch to a local font or a system font.
- **Next.js here is not the one you know.** Read `apps/web/AGENTS.md` and the guide under `apps/web/node_modules/next/dist/docs/` before writing Next-specific code (`01-app/01-getting-started/13-fonts.md` and `01-app/03-api-reference/02-components/font.md` for fonts).
- **Full gate per task**, from the repo root: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`. Task 1 records the baseline first (Vitest count, Playwright count, route count `next build` prints); every report compares with it. This plan adds no route.
- **Known flaky two-browser tests:** "formatting made in one browser appears in the other" (`e2e/editor-toolbar.spec.ts`) and "a card added in one browser appears in the other" (`e2e/collaboration.spec.ts`) may fail once. Rerun each alone three times (`pnpm --filter @crdt/web exec playwright test -g "<name>"`) and report the results.
- **Deviations are recorded as you go.** Task 1 creates `docs/design/gallery-handoff.md` with a "Deviations from the reference" table. Each task appends the rows it lists, plus any further deviation it makes, numbered `T<task>.<n>`. Task 14 writes the rest of the handoff around that table. Do not edit this plan file.
- **Commit at the end of each task** with the message the task gives, staging only the paths it lists.

## Decisions made in this plan

The spec left some things open, and the spec, the reference and the current code disagree in places. Each decision below is binding on the tasks. Tasks 1 to 13 record the ones they implement as deviation rows; Task 14 copies this list into the handoff.

**Where the spec and the reference disagree (the spec wins):**

1. **Nav bar shadow.** The reference gives the bar `0 24px 48px -28px rgba(0,0,0,.25)`. The spec says "No blur, no shadow". Built: no shadow.
2. **Hover lifts.** The reference keeps `translateY(-1px)` plus the floating shadow on the GitHub sign-in button, and a shadow on tile and card hover. The spec removes hover lifts and says only the border changes. Built: tiles and cards turn their border `#1c1d1b` on hover; no button lifts; presses (`scale(.92–.98)`) stay. The nav avatars' `translateY(-3px)` hover goes; their `scale(1.06)` stays.
3. **Tile fill.** The reference fills workspace and document tiles and the People card `#fbfbf9`, turning `#fff` on hover. The spec's rule maps anything that was 60%+ white to `#ffffff` (these were `.7`). Built: `#ffffff`, and hover changes only the border.
4. **Toasts and dark pills.** The reference gives the toast and the version pill the floating shadow. The spec lists only floating menus, sheets and the palette. Built: no shadow.
5. **Board card peer ring.** The reference keeps `0 4px 14px rgba(14,165,233,.18)` under the 2px peer ring. Built: the ring only.
6. **Splatter palette.** The reference's "gallery" palette, with its reds mapped to violet, is eight entries with `#1c1c1c` twice. The spec lists seven: violet `#6d3fd6` three times, `#1c1c1c`, `#454545`, `#9a9a9a`, ochre `#e9a21f`. Built: the spec's seven.
7. **Splatter geometry.** The reference draws splats with a different generator (sizes 14–40px, its own ray and drop counts). The spec keeps "the agreed numbers". Built: the current `lib/splatter/geometry.ts` unchanged.
8. **Sign out.** The reference colours it `#c4372b`. The spec allows red only for errors and the delete action. Built: `--text`.
9. **Document toolbar when stuck.** The reference uses `inset 0 1px 0 #fff, 0 1px 2px …, 0 8px 22px rgba(30,30,50,.12)` and a `rgba(40,40,60,.08)` border. The spec says "hairline border" and "the floating shadow". Built: `1px solid var(--hairline)` and `var(--shadow-float)` when stuck.
10. **Chips that rely on a shadow.** The reference draws the active toolbar tab and the selected Narrow/Wide and Page/Board segment as white with `0 1px 3px` shadows. Built: the toolbar tab is white with a `0 0 0 1px var(--hairline)` ring (a white chip on a white bar needs an edge); the segments are white on their grey track with no shadow.

**Where the spec and the current code disagree:**

11. **Splat scale.** The spec's table says `range(0.6, 1.2)`. The code ships `range(0.7, 1.4)`, Dhanush's own decision of 2026-10-03 recorded in `glass-handoff.md`'s Precedence section, and the spec says sizing "keeps the agreed numbers" and asks for the choice to be recorded. Built: `range(0.7, 1.4)` kept. (Question 2 below.)
12. **Base and body size.** The code's base is 16px and the document body 18px (Dhanush, 2026-10-03). The spec's tables say body 17px and base 15px. Built: the spec's 15px and 17px, and the document h3 returns to 17px with the body, as in the reference. (Question 1 below.)
13. **"These replace the current 68 → 52."** In the code, 68 and 52 are the nav wrapper's totals (12px gap + 56px bar, 6 + 46), and the bar already goes 56 → 46 with the gap 12 → 6. Nothing changes; the tests asserting 56, 46, 12, 6 and 68 stay as they are.
14. **The offline status dot** is `--danger` (red) in the code. The spec says amber. Built: `--warn`.

**Where the spec is silent or ambiguous (decided here):**

15. **Which panels are "sheets".** The share and card sheets, the ⌘K palette, the History panel, the sign-in card (and the invite and privacy cards that share its look), the document's page sheet (the spec itself calls it "the page sheet") and every popover or dropdown get `var(--shadow-float)`, as the reference draws them. The nav bar, tiles, columns, board cards, the People card, toasts, the version pill and the meta pill get none. (Question 4 below.)
16. **Content and identity colours are not chrome.** The editor's "Red" text colour (`#c4372b`), the red diagonal on the highlight menu's "None" swatch, and the user colour `#e11d48` stay: the first two are in the reference and in documents people have written, the third is a person's identity colour and changing it would recolour people. `test/no-red.test.ts` names exactly these three as allowed. (Question 3 below.)
17. **White-on-white hover and selection.** The reference uses `#fff` for the hover of toolbar tools, the workspace name and history rows, and for the selected history row, all on white surfaces, where it is invisible. Built: hover is `--wash` (`rgba(40,40,60,.06)`, the reference's own menu-row hover); the selected history row is `--accent-tint` (the history test requires the chosen row to differ).
18. **Sticky toolbar top.** The reference pins it at `top:80px`. The code follows the nav as it condenses (`calc(var(--nav-bottom) + 12px)`, 80px at rest and 64px condensed), and the spec keeps existing motion. Built: it keeps following; at rest it is 80px as the spec says.
19. **Toolbar entrance.** The floating toolbar entered with `g-pop .6s`; inside the sheet the reference uses `g-fade .4s`. Built: `g-fade .4s`.
20. **Error boxes and fields.** `ui.error` was a red-tinted box; it becomes white with a hairline, the text in `--danger`. The link field's invalid border was red; it becomes `--rule`. The column delete confirmation's red fill becomes `--danger` text on the grey of its Cancel neighbour.
21. **People "Manage" link** stays inside the People card, where it is now; the reference moves it beside the heading. Layout is not in scope.
22. **The syncing dot pulses.** The reference names an animation `c-pulse` that it never defines (dead in the reference itself). Built: `g-pulse 1s` infinite, inside the reduced-motion guard.
23. **The toast's entrance.** `globals.css`'s `g-up` translates by `-50%` because the reference centres the toast itself; here the wrapper centres it, so a live `g-up` would throw the toast sideways for half a second. The toast gets a module-local `up` keyframes with the same rise and scale and no `-50%`.

**The dead-animation fix (spec, "Known app-wide bug").** Investigated: the build hashes every animation name inside a CSS module (`app-shell_g-pop__eL_lj` in `.next/static/css`), while the keyframes live unhashed in `globals.css`, so 17 module animations across 12 files point at keyframes that do not exist; even the canvas blobs' `g-paint` is dead. Next's bundled `postcss-modules-local-by-default` honours a `global(name)` function inside `animation` and `animation-name` and emits the bare name (verified against the bundled plugin: `animation: global(g-pop) .6s` compiles to `animation: g-pop .6s`). Chosen: write `global(g-…)` in every module, keep one set of keyframes in `globals.css`. Rejected: per-module copies of the keyframes (eight keyframe sets duplicated across twelve files, drifting apart) and a global utility class (it would need `:global` selectors or TSX class changes in every component). `test/css-motion.test.ts` fails on a bare `g-` name in a module, and an e2e test proves the animations run.

**The nav, replaced versus reused.**

- *Reused unchanged:* `lastNavWidth` (module-level in `AppShell.tsx`), `naturalWidth()`, the `ResizeObserver` that keeps `lastNavWidth` equal to the bar on screen, the whole "settling"/hold logic for documents that are still connecting, the `transitionend` handler that only accepts the bar's own `width` (`event.target === bar && event.propertyName === 'width'`), its 1000ms timeout fallback, the reduced-motion early return, and the condensed state. In `NavTabs.tsx`: `lastMetrics` (module-level), `measureIndicator`, the two-frame `animated` gate, the `scrollTo` that keeps the active tab in view, the `ResizeObserver`, and the overflow-driven right-edge fade. `NavTabs.tsx` does not change.
- *Replaced:* the tween's start. Today it pins the old width, waits one `requestAnimationFrame`, then sets the target. The spec's order is: pin the old width with `transition: none`, force a layout (`void bar.offsetWidth`), then set `transition: width var(--dur) var(--ease)` and the target width in the same task. Task 4 adds a test for the case the handoff says this order failed on (a brand-new nav, dashboard → workspace) and gives the exact fallback if it does.
- *Replaced:* the indicator's look. The liquid-glass pill becomes a 2px `var(--accent)` underline at the bottom of the strip; positioning (`transform: translateX(offsetLeft)`, `width: offsetWidth`) and its transitions are untouched.
- *Order of a tab change, for the record:* (1) the strip renders with the remembered `lastMetrics` and, when there was one, the transition class already on; (2) `useLayoutEffect` reads `active.offsetLeft` and `offsetWidth`, and that read forces style and layout with the old transform committed; (3) `setMetrics` re-renders synchronously with the new transform and width, which the browser transitions over 0.55s with `--ease`. On the first-ever mount there is no remembered position: the underline is placed at opacity 0 → 1 without a transition, and the transition class is added two frames later, so it never grows from nothing. Under reduced motion the transition rules do not apply (they sit inside the no-preference block) and `scrollTo` uses `behavior: 'auto'`.
- *Right-edge fade:* unchanged: `mask-image: linear-gradient(90deg,#000 82%,transparent)` set inline only while `scrollWidth > clientWidth + 2` and the strip is not scrolled to its end, re-read on scroll and on resize.

## Questions only Dhanush can answer

The plan proceeds on the stated default for each; changing one later is a one-line change.

1. **Base 15px and document body 17px**, as the spec's tables say, undoing your 2026-10-03 move to 16px and 18px? Default: 15 and 17.
2. **Splat scale** `range(0.6, 1.2)` from the spec's table, or your later `range(0.7, 1.4)`? Default: keep 0.7–1.4.
3. **Red exceptions:** keep the editor's Red text colour, the red stroke on the "None" highlight swatch and the `#e11d48` person colour? Default: keep all three.
4. **Floating shadow on the document page and the sign-in card**, as the reference draws them (reading "sheets" to include them)? Default: yes.
5. **Sign out in plain text**, not red? Default: plain text.

## File structure

| File | Task | Change |
|---|---|---|
| `apps/web/src/app/globals.css` | 1, 6, 13 | Gallery tokens, violet accent, `--font`, 15px base, `::selection`; document typography; glass tokens deleted |
| `apps/web/src/app/layout.tsx` | 1 | Schibsted Grotesk through `next/font/google`, variable on `<html>` |
| `apps/web/src/app/icon.svg` | 1 | Fill `#6d3fd6` |
| `apps/web/test/css-tokens.test.ts` | 1 | Knows `--font-schibsted` comes from `layout.tsx` |
| `apps/web/test/gallery-tokens.test.ts` | 1 | New: token values, favicon |
| `apps/web/e2e/gallery.spec.ts` | 1, 2, 3, 4, 5, 6, 8, 9, 10, 11 | New: per-screen computed-style checks |
| `docs/design/gallery-handoff.md` | 1, every task, 14 | New: deviation table, then the full handoff |
| `apps/web/src/components/canvas-background.module.css` | 2, 3 | Blob colours; `global(g-paint)` |
| `apps/web/src/lib/splatter/geometry.ts`, `apps/web/src/components/PaintSplatter.tsx` | 2 | Gallery palette, opacity 0.38 |
| `apps/web/src/components/status-display.ts` | 2 | New: the status pill's labels and dots |
| `apps/web/test/css-walk.ts` | 2 | New: CSS declaration walker shared by the guards |
| `apps/web/test/no-red.test.ts`, `apps/web/test/gallery-material.test.ts` | 2 | New guards |
| `apps/web/test/css-motion.test.ts`, `apps/web/e2e/fixtures.ts` | 3 | New guard; `settleAnimations` |
| 12 module stylesheets | 3 | `global(g-…)` |
| `AppShell.tsx`, `app-shell.module.css`, `nav-tabs.module.css`, `user-menu.module.css`, `ui/Button.tsx`, `ui/ui.module.css` | 4 | Nav |
| `board.module.css` | 5 | Board |
| `DocumentEditor.tsx`, `EditorToolbar.tsx`, `VersionPreview.tsx`, `DocumentClient.tsx`, `document.module.css`, `editor-toolbar.module.css` | 6 | Document sheet and toolbar |
| `HomeTools.tsx`, `HomeMenus.tsx`, `EditorMenu.tsx`, `editor-toolbar.module.css` | 7 | Alignment dropdown |
| `workspaces/[id]/page.tsx`, `workspace.module.css`, `DocumentTile.tsx`, `ui/ui.module.css`, `app/page.tsx` | 8 | Workspace overview and the shared tile primitives |
| `app/page.tsx`, `dashboard.module.css` | 9 | Dashboard |
| `(auth)/*`, `privacy/*` | 10 | Sign-in, invite, privacy |
| `ui/sheet.module.css`, `share-sheet.module.css`, `command-palette.module.css` | 11 | Share sheet, palette, toasts |
| `history-panel.module.css`, `version-bar.module.css`, `version-preview.module.css` | 12 | History panel and version pill |
| `docs/design/glass-handoff.md` | 14 | Pointer at the top |

## Tests that change

Sixteen existing tests change for certain; up to three more may need a `settleAnimations` call in Task 3 (listed there). None is deleted; two have their subject removed by the spec and are rewritten in place.

| Test | File | Task | New assertion and why |
|---|---|---|---|
| the column under the pointer shows the accent outline while a card is dragged | `e2e/board.spec.ts` | 1 | `ACCENT_INSET` becomes `oklch(0.5 0.17 290) 0px 0px 0px 2px inset`: the spec's new `--accent`. |
| the pill slides to the new tab across a navigation instead of appearing there | `e2e/glass-shell.spec.ts` | 4 | Renamed "the underline slides …"; assertions unchanged. The spec replaces the pill with an underline that moves the same way. |
| the nav is a pill sized to its contents and centred | `e2e/glass-shell.spec.ts` | 4 | Renamed "the nav is a bar …"; assertions unchanged. The bar has 2px corners now. |
| a document sits on the 780px glass sheet and a board does not | `e2e/glass-shell.spec.ts` | 6 | Radius `2px`; the sheet's padding is `0` and `document-body` carries `40px / 56px / 96px`: the spec puts the toolbar inside the sheet. |
| the toolbar sits above the document sheet, not inside it | `e2e/editor-toolbar.spec.ts` | 6 | Becomes "the toolbar sits inside the document sheet, at its top, inset 10px": the spec's default placement. |
| hovering an active toggle keeps its accent fill | `e2e/editor-toolbar.spec.ts` | 6 | Unpressed hover fill `rgba(40, 40, 60, 0.06)` (`--wash`), not `rgba(255, 255, 255, 0.9)`: no glass whites (decision 17). |
| a menu blurs the page behind it: no ancestor of its panel is a backdrop root | `e2e/editor-toolbar.spec.ts` | 6 | The spec removes blur, the subject of this test. Replaced in place by "a menu is a flat white panel with the floating shadow, and nothing above it blurs": no `backdrop-filter` on the menu or any ancestor, white, hairline, `--shadow-float`. |
| the Link popover blurs the page behind it: no ancestor is a backdrop root | `e2e/editor-toolbar.spec.ts` | 6 | Same reason, same replacement, for the Link popover. |
| headings, paragraphs, quote, code, lists and rule carry 12.7's values | `e2e/editor-toolbar.spec.ts` | 6 | h3 `17px` / `22.95px`; p `17px` / `28.05px`; quote rule `oklch(0.5 0.17 290 / .35)`; code block radius `2px`: the spec's body size, the new accent and 2px corners. |
| a table and its cells carry 12.7's values … | `e2e/editor-toolbar.spec.ts` | 6 | Table radius `2px`: 2px corners. |
| the sheet keeps 28px above it, and its text is 18px | `e2e/editor-toolbar.spec.ts` | 6 | Text `17px`, renamed "… its text is 17px": the spec's body size. |
| each alignment sets the paragraph and marks itself, and only itself, active | `e2e/editor-toolbar.spec.ts` | 7 | Opens the Alignment dropdown before each choice; reads `aria-selected` on its options: the spec groups alignment into one dropdown. |
| clear formatting removes the marks and returns the block to a paragraph | `e2e/editor-toolbar.spec.ts` | 7 | Centres through the dropdown. Same reason. |
| formatting made in one browser appears in the other | `e2e/editor-toolbar.spec.ts` | 7 | Centres through the dropdown. Same reason. |
| the tool row is one Tab stop, and the arrow keys move within it | `e2e/editor-toolbar.spec.ts` | 7 | Left of Clear is now the `tb-align` trigger; Enter opens it on the current option, End and Enter choose Justify. Same reason. |
| the tiles and the People card sit on raised glass, not the shared token | `e2e/glass-shell.spec.ts` | 8, 9 | Renamed "the tiles and the People card are flat white surfaces"; they are `rgb(255, 255, 255)` with no `backdrop-filter`. The `--glass-light` assertion is replaced: it guarded other glass surfaces from thickening, and the spec removes glass. Task 8 changes the overview half, Task 9 the dashboard half. |

---

### Task 1: Foundation — Gallery tokens, violet, Schibsted Grotesk and the favicon

**Files:**
- Modify: `apps/web/src/app/globals.css` (the `:root` token block, lines 1–84; the `body` rule, lines 109–123)
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/icon.svg`
- Modify: `apps/web/test/css-tokens.test.ts`
- Modify: `apps/web/e2e/board.spec.ts:198`
- Create: `apps/web/test/gallery-tokens.test.ts`
- Create: `apps/web/e2e/gallery.spec.ts`
- Create: `docs/design/gallery-handoff.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, for every later task:
  - Tokens in `globals.css` `:root`: `--accent: oklch(0.5 0.17 290)`, `--accent-hover: oklch(0.45 0.17 290)`, `--accent-text: oklch(0.44 0.17 290)`, `--accent-tint: oklch(0.95 0.027 290)`, `--accent-soft` and `--accent-ring: oklch(0.5 0.17 290 / 0.12)`, `--toast-dot: oklch(0.64 0.17 290)`, `--selection: oklch(0.9 0.027 290 / 0.6)`, `--paper: #ffffff`, `--paper-soft: #fbfbf9`, `--ink: #161616`, `--hairline: #e4e4e0`, `--rule: #1c1d1b`, `--wash: rgba(40, 40, 60, 0.06)`, `--shadow-float: 0 24px 48px -28px rgba(0, 0, 0, 0.25)`, `--r: 2px`, `--font: var(--font-schibsted), system-ui, sans-serif`. The glass tokens (`--glass-*`, `--blur-*`, `--accent-shadow`, `--r-pill` … `--r-sheet`) stay until Task 13.
  - `--font-schibsted`, set on `<html>` by `next/font` in `apps/web/src/app/layout.tsx`.
  - `apps/web/e2e/gallery.spec.ts` with `const LABEL = 'e2e-gallery'`, `test.afterAll(cleanup(LABEL))`, the constants `WHITE = 'rgb(255, 255, 255)'`, `PAPER_SOFT = 'rgb(251, 251, 249)'`, `HAIRLINE = 'rgb(228, 228, 224)'`, `RULE = 'rgb(28, 29, 27)'`, `INK = 'rgb(22, 22, 22)'`, `FLOAT = 'rgba(0, 0, 0, 0.25) 0px 24px 48px -28px'`, and the helpers `resolveColour(page: Page, value: string): Promise<string>` and `material(locator: Locator): Promise<{ background: string; backdrop: string; shadow: string; radius: string; borderColor: string; borderWidth: string }>`. Later tasks append one `test.describe` block each and extend the import line as they need.
  - `docs/design/gallery-handoff.md` with a `## Deviations from the reference` table (`| # | Where | Reference or before | Built | Why |`). Later tasks append rows numbered `T<task>.<n>`.

- [ ] **Step 1: Record the baseline**

Run from the repo root: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Write down: the Vitest test count, the Playwright test count (passed / failed / flaky), and the route count `next build` prints. Report them. If anything already fails, report it before changing anything.

- [ ] **Step 2: Write the failing token test**

Create `apps/web/test/gallery-tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const globals = readFileSync(join(SRC, 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** A custom property's value in the first :root block, as written. */
function token(name: string): string | undefined {
  const root = globals.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? ''
  return root.match(new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]+);`))?.[1]?.trim()
}

describe('Gallery tokens (spec: "Colour", "Material", "Type")', () => {
  it('the accent is violet, with the five values the spec gives', () => {
    expect(token('--accent')).toBe('oklch(0.5 0.17 290)')
    expect(token('--accent-hover')).toBe('oklch(0.45 0.17 290)')
    expect(token('--accent-text')).toBe('oklch(0.44 0.17 290)')
    expect(token('--accent-tint')).toBe('oklch(0.95 0.027 290)')
    expect(token('--accent-ring')).toBe('oklch(0.5 0.17 290 / 0.12)')
    expect(token('--accent-soft')).toBe('oklch(0.5 0.17 290 / 0.12)')
  })

  it('the toast dot is the accent 0.14 lighter, and selected text is a pale violet', () => {
    expect(token('--toast-dot')).toBe('oklch(0.64 0.17 290)')
    expect(token('--selection')).toBe('oklch(0.9 0.027 290 / 0.6)')
    expect(globals).toMatch(/::selection\s*\{\s*background:\s*var\(--selection\);?\s*\}/)
  })

  it('surfaces, lines, the one shadow and the one corner', () => {
    expect(token('--paper')).toBe('#ffffff')
    expect(token('--paper-soft')).toBe('#fbfbf9')
    expect(token('--ink')).toBe('#161616')
    expect(token('--hairline')).toBe('#e4e4e0')
    expect(token('--rule')).toBe('#1c1d1b')
    expect(token('--wash')).toBe('rgba(40, 40, 60, 0.06)')
    expect(token('--shadow-float')).toBe('0 24px 48px -28px rgba(0, 0, 0, 0.25)')
    expect(token('--r')).toBe('2px')
  })

  it('text, status and danger keep the values the spec lists', () => {
    expect(token('--text')).toBe('#1c1d1b')
    expect(token('--text-2')).toBe('#3d403b')
    expect(token('--text-muted')).toBe('#5f625d')
    expect(token('--text-faint')).toBe('#6c6f6a')
    expect(token('--ok')).toBe('oklch(0.62 0.13 150)')
    expect(token('--warn')).toBe('oklch(0.72 0.15 65)')
    expect(token('--sync')).toBe('var(--accent)')
    expect(token('--danger')).toBe('#c4372b')
  })

  it('the font is Schibsted Grotesk through next/font, and the base is 15px', () => {
    expect(token('--font')).toBe('var(--font-schibsted), system-ui, sans-serif')
    const body = globals.match(/\nbody\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(body).toMatch(/font-family:\s*var\(--font\);/)
    expect(body).toMatch(/font-size:\s*15px;/)
  })

  it('the favicon is a violet disc around the unchanged three-dot glyph', () => {
    const icon = readFileSync(join(SRC, 'app/icon.svg'), 'utf8')
    expect(icon).toContain('<circle cx="26" cy="26" r="26" fill="#6d3fd6"/>')
    expect(icon).toContain(
      '<path d="M16 34 L26 17 L36 34 Z" fill="none" stroke="#fff" stroke-width="2.75" stroke-linejoin="round"/>',
    )
    expect(icon.match(/<circle cx="\d+" cy="\d+" r="4\.75" fill="#fff"\/>/g)).toHaveLength(3)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @crdt/web exec vitest run test/gallery-tokens.test.ts`
Expected: FAIL on the accent, toast dot, surface, font and favicon cases (the text and status case already passes; it is a guard against the next steps).

- [ ] **Step 4: Write the failing Playwright foundation checks**

Create `apps/web/e2e/gallery.spec.ts`:

```ts
import { test, expect, type Locator, type Page } from '@playwright/test'
import { cleanup, seedWorkspace, signIn } from './fixtures.js'

/**
 * The Gallery redesign, screen by screen (docs/superpowers/specs/2026-10-10-gallery-redesign-design.md).
 * Each block reads computed styles on representative elements, so a stylesheet that loses a
 * rule, or a glass value that survives, fails here rather than only on screen.
 */
const LABEL = 'e2e-gallery'

test.afterAll(async () => {
  await cleanup(LABEL)
})

// Gallery's literals as the browser computes them.
const WHITE = 'rgb(255, 255, 255)'
const PAPER_SOFT = 'rgb(251, 251, 249)'
const HAIRLINE = 'rgb(228, 228, 224)'
const RULE = 'rgb(28, 29, 27)'
const INK = 'rgb(22, 22, 22)'
const FLOAT = 'rgba(0, 0, 0, 0.25) 0px 24px 48px -28px'

/** What a colour literal or a var() resolves to, so values are compared as the browser writes them. */
function resolveColour(page: Page, value: string): Promise<string> {
  return page.evaluate((input) => {
    const probe = document.createElement('div')
    probe.style.color = input
    document.body.append(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    return out
  }, value)
}

/** The material of one element: everything Gallery changed about a surface. */
function material(locator: Locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      background: style.backgroundColor,
      backdrop: style.backdropFilter,
      shadow: style.boxShadow,
      radius: style.borderTopLeftRadius,
      borderColor: style.borderTopColor,
      borderWidth: style.borderTopWidth,
    }
  })
}

test.describe('foundation', () => {
  test('Schibsted Grotesk is loaded through next/font and is the page font, at a 15px base', async ({
    page,
  }) => {
    await page.goto('/login')
    const font = await page.evaluate(async () => {
      await document.fonts.ready
      const style = getComputedStyle(document.body)
      return {
        family: style.fontFamily,
        size: style.fontSize,
        loaded: [...document.fonts].some(
          (face) => /Schibsted/i.test(face.family) && face.status === 'loaded',
        ),
      }
    })
    expect(font.family).toMatch(/Schibsted/i)
    expect(font.loaded).toBe(true)
    expect(font.size).toBe('15px')
  })

  test('the accent is violet: the sign-in button and the nav logo are filled with it', async ({
    page,
  }) => {
    const label = `${LABEL}-accent`
    const { owner } = await seedWorkspace(label)
    await page.goto('/login')
    const accent = await resolveColour(page, 'var(--accent)')
    expect(accent).toBe(await resolveColour(page, 'oklch(0.5 0.17 290)'))
    await expect(page.getByTestId('signin-github')).toHaveCSS('background-color', accent)

    await signIn(page, owner.id)
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'All workspaces' }).locator('span')).toHaveCSS(
      'background-color',
      accent,
    )
    await cleanup(label)
  })
})
```

`WHITE`, `PAPER_SOFT`, `HAIRLINE`, `RULE`, `INK`, `FLOAT` and `material` are used by later tasks; Playwright does not typecheck this folder (`apps/web/tsconfig.json` includes `src` and `test` only), so unused constants are fine.

- [ ] **Step 5: Run it and watch it fail**

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts`
Expected: both FAIL: the family is the system stack, the size is 16px, and the accent resolves to `oklch(0.42 0.11 285)`.

- [ ] **Step 6: Replace the token block in `globals.css`**

Replace lines 1–84 of `apps/web/src/app/globals.css` (from `:root {` through the `--font: …;` line and its closing `}`) with:

```css
:root {
  /*
    The design system. Gallery (2026-10-10; docs/design/gallery-handoff.md) replaces the
    Glass look of glass-handoff.md section 2. The glass tokens further down are still read
    by screens that have not moved to Gallery yet, and go once none does.

    Tokens that are ours rather than the spec's, each for a reason:
      --dur*  the designs write durations as literals (.25s, .3s, .4s, .55s, .6s);
              three tokens are better than scattering those through every stylesheet
      --font  the spec names a family; editor-type.ts stores `var(--font)` in documents
              so they follow it. --font-schibsted is set on <html> by next/font
              (app/layout.tsx)
      --ok-text  a contrast-safe variant of --ok, which is a dot colour and does not
              meet 4.5:1 as text
      --accent-soft  the toolbar's pressed fill: the reference's accent at 12%
  */

  /* text */
  --text: #1c1d1b;
  --text-2: #3d403b;
  --text-muted: #5f625d;
  --text-faint: #6c6f6a;
  --icon-faint: #a3a6a0;
  /* The one red in the UI: error text and the delete action (spec, "Colour"). */
  --danger: #c4372b;

  /* accent: violet, hue 290 (spec, "Colour"). Its hex fallback, #6d3fd6, is used where a
     CSS colour cannot go: the favicon (app/icon.svg) and the splatter's canvas palette. */
  --accent: oklch(0.5 0.17 290);
  --accent-hover: oklch(0.45 0.17 290);
  --accent-text: oklch(0.44 0.17 290);
  --accent-tint: oklch(0.95 0.027 290);
  --accent-soft: oklch(0.5 0.17 290 / 0.12);
  --accent-ring: oklch(0.5 0.17 290 / 0.12);
  /* Glass only: nothing in Gallery casts an accent glow. Removed once no screen reads it. */
  --accent-shadow: oklch(0.5 0.17 290 / 0.22);

  /* status */
  --ok: oklch(0.62 0.13 150);
  --ok-text: oklch(0.5 0.13 150);
  --warn: oklch(0.72 0.15 65);
  --sync: var(--accent);
  /* The accent 0.14 lighter at its own chroma and hue (spec, "Toast dot"). */
  --toast-dot: oklch(0.64 0.17 290);
  --selection: oklch(0.9 0.027 290 / 0.6);

  /* canvas */
  --canvas-base: #f1f1ef;

  /* Gallery surfaces (spec, "Material") */
  --paper: #ffffff; /* everything that was 60% or more opaque white glass */
  --paper-soft: #fbfbf9; /* the more see-through surfaces: board columns, the sign-in card */
  --ink: #161616; /* dark pills and toasts */
  --hairline: #e4e4e0; /* replaces every white glass border */
  --rule: #1c1d1b; /* section rules, and the border a tile or card takes on hover */
  /* The reference's hover fill for a row or a tool on a white surface. */
  --wash: rgba(40, 40, 60, 0.06);
  /* The one shadow: floating menus, sheets and the palette. */
  --shadow-float: 0 24px 48px -28px rgba(0, 0, 0, 0.25);
  /* The one corner. Avatars, dots and the logo stay round (50%). */
  --r: 2px;

  /* glass: read only by screens not yet moved to Gallery */
  --glass-light: rgba(255, 255, 255, 0.55);
  --glass-col: rgba(255, 255, 255, 0.42);
  --glass-mid: rgba(255, 255, 255, 0.72);
  --glass-tool: rgba(255, 255, 255, 0.76);
  --glass-page: rgba(255, 255, 255, 0.78);
  --glass-sheet: rgba(255, 255, 255, 0.82);
  --glass-menu: rgba(255, 255, 255, 0.88);
  --glass-border: rgba(255, 255, 255, 0.85);
  --glass-hl: inset 0 1px 0 rgba(255, 255, 255, 0.95);
  --blur-1: blur(20px) saturate(180%);
  --blur-2: blur(28px) saturate(190%);
  --blur-3: blur(30px) saturate(190%);

  /* fields & lines */
  --field-bg: rgba(240, 240, 244, 0.9);
  --field-border: rgba(40, 40, 60, 0.12);
  --line: rgba(40, 40, 60, 0.07);
  --sep: rgba(40, 40, 60, 0.12);
  --dash: rgba(40, 40, 60, 0.22);
  --track: rgba(40, 40, 60, 0.08);

  /* motion: --ease is the spec's; the durations are ours (see above) */
  --ease: cubic-bezier(0.32, 0.72, 0, 1);
  --dur-fast: 0.3s;
  --dur: 0.55s;
  --dur-slow: 0.7s;

  /* radii: Glass. Each screen moves to --r; removed once none reads them. */
  --r-pill: 999px;
  --r-tool: 10px;
  --r-item: 12px;
  --r-card: 18px;
  --r-menu: 18px;
  --r-pop: 22px;
  --r-tile: 24px;
  --r-col: 26px;
  --r-panel: 28px;
  --r-sheet: 30px;

  --font: var(--font-schibsted), system-ui, sans-serif;
}
```

- [ ] **Step 7: The 15px base and `::selection`**

In the same file, replace the `body { … }` rule (lines 109–123 before Step 6) with:

```css
body {
  min-height: 100%;
  margin: 0;
  background: var(--canvas-base);
  color: var(--text);
  font-family: var(--font);
  /* 15px, the spec's base ("Type"). Text with no size of its own inherits it; the nav,
     tabs, tiles, meta lines and chips all set their own. The document body sets 17px. */
  font-size: 15px;
  line-height: 1.47;
  letter-spacing: -0.01em;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

::selection {
  background: var(--selection);
}
```

- [ ] **Step 8: Load the font through `next/font`**

Replace `apps/web/src/app/layout.tsx` with:

```tsx
import './globals.css'

import type { ReactNode } from 'react'
import { Schibsted_Grotesk } from 'next/font/google'
import { CanvasBackground } from '@/components/CanvasBackground'
import { ToastProvider } from '@/components/ui/Toast'
import { WarmSync } from '@/components/WarmSync'

export const metadata = { title: 'CRDT Workspace' }

// Schibsted Grotesk, self-hosted by next/font at build time: the browser never asks Google
// for it, and next/font's metric-matched fallback face means the swap does not move text
// (spec, "Type"). Exposed as a CSS variable, which globals.css folds into --font.
const schibsted = Schibsted_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-schibsted',
})

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={schibsted.variable}>
      <body>
        <CanvasBackground />
        <ToastProvider>
          <WarmSync />
          {/*
            The canvas is fixed at z-index 0, so everything else needs a stacking
            context above it. position:relative is what gives z-index meaning here.
          */}
          <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
        </ToastProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 9: The favicon follows the accent**

Replace `apps/web/src/app/icon.svg` with (one line, glyph unchanged, only the disc's fill differs):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52"><circle cx="26" cy="26" r="26" fill="#6d3fd6"/><g transform="translate(26 26) scale(1.3) translate(-26 -26)"><path d="M16 34 L26 17 L36 34 Z" fill="none" stroke="#fff" stroke-width="2.75" stroke-linejoin="round"/><circle cx="26" cy="17" r="4.75" fill="#fff"/><circle cx="16" cy="34" r="4.75" fill="#fff"/><circle cx="36" cy="34" r="4.75" fill="#fff"/></g></svg>
```

The nav logo and the sign-in mark already paint `var(--accent)` behind `LogoMark`, so they follow the new accent with no change.

- [ ] **Step 10: Teach the token guard about the next/font variable**

`globals.css` now reads `var(--font-schibsted)`, which next/font defines on `<html>`, not in `globals.css`. In `apps/web/test/css-tokens.test.ts`, after the line `expect(defined.size).toBeGreaterThan(10)` insert:

```ts
    // Defined outside globals.css, by next/font: app/layout.tsx passes this name as its
    // `variable` and puts the class on <html>. Checked against the source, so renaming
    // the variable there without renaming it here fails.
    const EXTERNAL = ['--font-schibsted']
    const layout = readFileSync(join(SRC, 'app/layout.tsx'), 'utf8')
    for (const name of EXTERNAL) expect(layout).toContain(`variable: '${name}'`)
```

and change the dangling check from

```ts
        if (!defined.has(match[1])) dangling.push(`${match[1]} in ${relative(SRC, file)}`)
```

to

```ts
        if (!defined.has(match[1]) && !EXTERNAL.includes(match[1]!))
          dangling.push(`${match[1]} in ${relative(SRC, file)}`)
```

- [ ] **Step 11: The board's drag-over ring is the new accent**

In `apps/web/e2e/board.spec.ts`, test "the column under the pointer shows the accent outline while a card is dragged", change

```ts
  const ACCENT_INSET = 'oklch(0.42 0.11 285) 0px 0px 0px 2px inset'
```

to

```ts
  const ACCENT_INSET = 'oklch(0.5 0.17 290) 0px 0px 0px 2px inset'
```

Why: the spec's `--accent` is `oklch(0.5 0.17 290)`; `.columnOver` still draws `inset 0 0 0 2px var(--accent)`.

- [ ] **Step 12: Run the new tests and watch them pass**

Run: `pnpm --filter @crdt/web exec vitest run test/gallery-tokens.test.ts test/css-tokens.test.ts`
Expected: PASS.
Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts e2e/board.spec.ts -g "foundation|accent outline"`
Expected: PASS.

- [ ] **Step 13: Start the handoff**

Create `docs/design/gallery-handoff.md`:

```md
# Handoff: CRDT Workspace, "Gallery"

**Status: being built** on branch `gallery-redesign`, from
`docs/superpowers/plans/2026-10-10-gallery-redesign.md`. The per-screen sections are written
by that plan's last task. Until then the spec
(`docs/superpowers/specs/2026-10-10-gallery-redesign-design.md`) and the table below are the
record.

## Deviations from the reference

The reference is `docs/design/Workspace F - Gallery.dc.html`, built at its defaults (violet,
canvas "gallery", splashes "subtle", splash colour "gallery", toolbar placement "sheet").
Each row is a place the build differs from it, or from the code before Gallery, and why.
Rows are added by the task that made the decision.

| # | Where | Reference or before | Built | Why |
|---|---|---|---|---|
| T1.1 | Font loading | A `<link>` to fonts.googleapis.com | `next/font/google`, self-hosted, with a metric-matched fallback face | The spec ("Type") asks for Next's font mechanism and no layout shift; no request goes to Google from the browser. |
| T1.2 | Base and document body size | Code before: 16px base, 18px body (Dhanush, 2026-10-03) | 15px base, 17px body | The spec's "Type" tables. Open question 1 in the plan. |
| T1.3 | `--accent-soft` | The reference writes the accent at 12% inline | A token, equal to `--accent-ring` | One name for the toolbar's pressed fill. |
```

- [ ] **Step 14: Run the full gate**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: everything passes, counts equal the baseline plus the new tests (6 Vitest, 2 Playwright). The font change can widen text: if a test's *premise* check fails (for example the tab-overflow test's "the strip overflows" guard), report it and adjust the premise (viewport or document count), never the assertion. Apply the flaky-test rule from Global Constraints.

- [ ] **Step 15: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/layout.tsx apps/web/src/app/icon.svg \
  apps/web/test/css-tokens.test.ts apps/web/test/gallery-tokens.test.ts \
  apps/web/e2e/gallery.spec.ts apps/web/e2e/board.spec.ts docs/design/gallery-handoff.md
git commit -m "feat(gallery): tokens, violet accent, Schibsted Grotesk and the favicon"
```

---

### Task 2: Foundation — the canvas, the splatter, and no red

**Files:**
- Modify: `apps/web/src/app/globals.css` (`--canvas-base`)
- Modify: `apps/web/src/components/canvas-background.module.css` (blob colours, comment)
- Modify: `apps/web/src/lib/splatter/geometry.ts` (`PALETTES`)
- Modify: `apps/web/src/components/PaintSplatter.tsx` (palette prop, layer opacity)
- Modify: `apps/web/test/splatter-geometry.test.ts`
- Create: `apps/web/src/components/status-display.ts`
- Modify: `apps/web/src/components/SyncStatus.tsx`
- Modify: `apps/web/src/components/UserMenu.tsx`, `apps/web/src/components/user-menu.module.css` (Sign out)
- Modify: `apps/web/src/components/ui/ui.module.css` (`.danger:hover`, `.error`)
- Modify: `apps/web/src/components/board.module.css` (`.columnConfirmDelete`)
- Modify: `apps/web/src/components/editor-toolbar.module.css` (`.linkInput[aria-invalid='true']`)
- Create: `apps/web/test/css-walk.ts`, `apps/web/test/no-red.test.ts`, `apps/web/test/gallery-material.test.ts`, `apps/web/test/status-display.test.ts`
- Modify: `apps/web/e2e/gallery.spec.ts` (append a block)
- Modify: `docs/design/gallery-handoff.md` (append rows)

**Interfaces:**
- Consumes: Task 1's tokens (`--wash`, `--hairline`, `--paper`, `--rule`, `--warn`, `--text`) and `e2e/gallery.spec.ts` helpers (`LABEL`, `WHITE`, `resolveColour`, `material`).
- Produces:
  - `apps/web/test/css-walk.ts` exporting `SRC: string` (absolute path of `apps/web/src`), `sourceFiles(extensions: readonly string[], dir?: string): string[]` (absolute paths), `rel(path: string): string` (path relative to `src`, forward slashes), `declarations(css: string): Declaration[]` and `interface Declaration { prop: string; value: string; selector: string; context: string[] }` (`selector` is the innermost block's prelude; `context` lists every enclosing prelude, outermost first).
  - `apps/web/test/gallery-material.test.ts` with `const MIGRATED: string[]` (paths relative to `src`). **Every later screen task appends its stylesheets to this array.**
  - `STATUS_DISPLAY: Record<DocStatus, { label: string; dot: string }>` exported from `apps/web/src/components/status-display.ts`.
  - `PALETTES = { gallery: [...] }` in `lib/splatter/geometry.ts`; `PaintSplatter`'s `palette` prop is `'gallery'`.

- [ ] **Step 1: The shared CSS walker**

Create `apps/web/test/css-walk.ts`:

```ts
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** apps/web/src, absolute. */
export const SRC = fileURLToPath(new URL('../src', import.meta.url))

/** Every file under `dir` (default src) whose name ends with one of `extensions`. */
export function sourceFiles(extensions: readonly string[], dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(extensions, path)
    return extensions.some((extension) => path.endsWith(extension)) ? [path] : []
  })
}

/** A path relative to src with forward slashes, as the guards' allowlists write it. */
export function rel(path: string): string {
  return relative(SRC, path).split('\\').join('/')
}

export interface Declaration {
  prop: string
  value: string
  /** The prelude of the block the declaration sits in: a selector, or `from` in keyframes. */
  selector: string
  /** Every enclosing prelude, outermost first; the last is `selector`. */
  context: string[]
}

/**
 * The declarations of a stylesheet, comments stripped. A brace walk, which is enough for
 * this repo's CSS: no string or url() in it holds a brace or a semicolon.
 */
export function declarations(css: string): Declaration[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Declaration[] = []
  const stack: string[] = []
  let buffer = ''
  const flush = () => {
    const declaration = buffer.trim()
    buffer = ''
    const colon = declaration.indexOf(':')
    if (colon <= 0 || stack.length === 0) return
    out.push({
      prop: declaration.slice(0, colon).trim().toLowerCase(),
      value: declaration.slice(colon + 1).trim(),
      selector: stack[stack.length - 1]!,
      context: [...stack],
    })
  }
  for (const char of text) {
    if (char === '{') {
      stack.push(buffer.trim())
      buffer = ''
    } else if (char === '}') {
      flush()
      stack.pop()
    } else if (char === ';') {
      flush()
    } else {
      buffer += char
    }
  }
  return out
}
```

- [ ] **Step 2: The failing "no red" guard**

Create `apps/web/test/no-red.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { declarations, rel, sourceFiles } from './css-walk.js'

type Rgb = [number, number, number]

/** A hex or rgb()/rgba() literal as 0-255 channels; null for anything else. */
function toRgb(colour: string): Rgb | null {
  const hex = colour.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join('') : hex[1]!
    return [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16)) as Rgb
  }
  const rgb = colour.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

/** Hue in degrees; saturation and lightness 0-1. */
function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const lightness = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, lightness]
  const saturation = d / (1 - Math.abs(2 * lightness - 1))
  let hue = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  hue *= 60
  if (hue < 0) hue += 360
  return [hue, saturation, lightness]
}

/**
 * Whether a colour literal reads as red: for hex and rgb, a saturated mid-lightness colour
 * within 15 degrees of pure red; for oklch, real chroma at a hue of 0-40 or 345-360 (oklch's
 * red sits near 29). Oranges (#c9661a, 26 degrees), ambers, pinks (#c2417f, 331 degrees) and
 * the pale highlight swatches fall outside it.
 */
function isReddish(colour: string): boolean {
  const oklch = colour.match(/^oklch\(\s*[\d.]+%?\s+([\d.]+)\s+([\d.]+)/i)
  if (oklch) {
    const chroma = Number(oklch[1])
    const hue = Number(oklch[2])
    return chroma >= 0.08 && (hue <= 40 || hue >= 345)
  }
  const rgb = toRgb(colour)
  if (!rgb) return false
  const [hue, saturation, lightness] = toHsl(rgb)
  return saturation >= 0.35 && lightness >= 0.15 && lightness <= 0.85 && (hue <= 15 || hue >= 345)
}

/** Every colour literal in a source file. */
function colours(text: string): string[] {
  return [...text.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)|oklch\([^)]*\)/gi)].map((m) =>
    m[0].toLowerCase(),
  )
}

/**
 * The only red literals allowed in src (spec, "Colour": no red anywhere except #c4372b for
 * error and delete text). The last three are content and identity colours, not chrome; see
 * the plan's decision 16.
 */
const ALLOWED_RED = new Set([
  'app/globals.css #c4372b', // --danger itself
  'components/editor-palettes.ts #c4372b', // the editor's "Red" text colour: document content
  'components/editor-toolbar.module.css #c4372b', // the stroke across the "None" highlight swatch
  'lib/color.ts #e11d48', // a person's colour; changing it would recolour people
])

/** The only rules that may use var(--danger), and only for `color`: error text and delete. */
const DANGER_RULES = new Set([
  'components/ui/ui.module.css .danger',
  'components/ui/ui.module.css .error',
  'components/history-panel.module.css .error',
  'components/editor-toolbar.module.css .linkNote',
  'components/board.module.css .columnDelete:hover',
  'components/board.module.css .columnConfirmDelete',
])

describe('no red', () => {
  it('the red test knows red from its neighbours', () => {
    for (const red of ['#c4372b', '#e11d48', '#e2453c', 'rgba(196, 55, 43, 0.06)', 'oklch(0.62 0.13 25)']) {
      expect(isReddish(red), red).toBe(true)
    }
    for (const other of ['#c9661a', '#c2417f', '#e9a21f', '#ffd6e8', '#6d3fd6', '#1c1c1c', 'oklch(0.72 0.15 65)', 'oklch(0.5 0.17 290)']) {
      expect(isReddish(other), other).toBe(false)
    }
  })

  it('no red literal appears in src outside the four allowed uses', () => {
    const found = new Set<string>()
    const stray: string[] = []
    for (const file of sourceFiles(['.css', '.ts', '.tsx', '.svg'])) {
      for (const colour of colours(readFileSync(file, 'utf8'))) {
        if (!isReddish(colour)) continue
        const where = `${rel(file)} ${colour}`
        if (ALLOWED_RED.has(where)) found.add(where)
        else stray.push(where)
      }
    }
    expect(stray).toEqual([])
    // And the allowlist is not stale: each entry is still there to be allowed.
    expect([...found].sort()).toEqual([...ALLOWED_RED].sort())
  })

  it('var(--danger) colours only error text and the delete action', () => {
    const found = new Set<string>()
    for (const file of sourceFiles(['.css'])) {
      for (const declaration of declarations(readFileSync(file, 'utf8'))) {
        if (!declaration.value.includes('var(--danger)')) continue
        const where = `${rel(file)} ${declaration.selector}`
        expect(declaration.prop, where).toBe('color')
        expect(DANGER_RULES.has(where), `${where} uses --danger`).toBe(true)
        found.add(where)
      }
    }
    expect([...found].sort()).toEqual([...DANGER_RULES].sort())
    for (const file of sourceFiles(['.ts', '.tsx'])) {
      expect(readFileSync(file, 'utf8'), rel(file)).not.toContain('var(--danger)')
    }
  })
})
```

- [ ] **Step 3: The failing material guard and status test**

Create `apps/web/test/gallery-material.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declarations, SRC } from './css-walk.js'

/**
 * Stylesheets that have moved to Gallery, relative to src. Each screen's task appends its
 * files; the cleanup task replaces the list with every stylesheet in src.
 */
const MIGRATED: string[] = ['components/canvas-background.module.css']

const RADII = new Set(['var(--r)', '50%', '0', 'inherit'])
/** The canvas blobs keep their organic shape: paint, not UI. */
const RADIUS_EXCEPTIONS = new Set(['components/canvas-background.module.css .blob'])
/** A ring: `[inset] 0 0 0 Npx [colour]`. Focus, selection and the board card's hairline. */
const RING = /^(inset\s+)?0(px)?\s+0(px)?\s+0(px)?\s+[\d.]+px(\s+\S.*)?$/

/** A box-shadow's layers, split on the commas that are not inside a function. */
function layers(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  out.push(current.trim())
  return out
}

describe('Gallery material in migrated stylesheets', () => {
  it.each(MIGRATED)('%s: no blur, no glass token, 2px corners, no shadow but the float and rings', (path) => {
    const problems: string[] = []
    for (const d of declarations(readFileSync(join(SRC, path), 'utf8'))) {
      const where = `${d.selector} { ${d.prop}: ${d.value} }`
      const inKeyframes = d.context.some((prelude) => prelude.startsWith('@keyframes'))
      if (d.prop.endsWith('backdrop-filter')) problems.push(`blur: ${where}`)
      if (/var\(--(glass|blur)-|var\(--accent-shadow\)|var\(--r-[a-z]/.test(d.value)) {
        problems.push(`glass token: ${where}`)
      }
      if (
        !inKeyframes &&
        /^border(-[a-z]+)*-radius$/.test(d.prop) &&
        !RADII.has(d.value) &&
        !RADIUS_EXCEPTIONS.has(`${path} ${d.selector}`)
      ) {
        problems.push(`radius: ${where}`)
      }
      if (!inKeyframes && d.prop === 'box-shadow') {
        for (const layer of layers(d.value)) {
          if (layer !== 'none' && layer !== 'var(--shadow-float)' && !RING.test(layer)) {
            problems.push(`shadow: ${where}`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })
})
```

Create `apps/web/test/status-display.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { STATUS_DISPLAY } from '@/components/status-display'

describe('the status pill (spec, "Status")', () => {
  it('is green when connected, the accent while syncing, amber offline, and never red', () => {
    expect(STATUS_DISPLAY.connected).toEqual({ label: 'Synced', dot: 'var(--ok)' })
    expect(STATUS_DISPLAY.connecting).toEqual({ label: 'Syncing', dot: 'var(--sync)' })
    expect(STATUS_DISPLAY.disconnected).toEqual({ label: 'Offline', dot: 'var(--warn)' })
    expect(STATUS_DISPLAY.fatal).toEqual({ label: 'Offline', dot: 'var(--warn)' })
  })
})
```

In `apps/web/test/splatter-geometry.test.ts`, replace the three `PALETTES.purple` with `PALETTES.gallery`, and add inside the `describe('splat geometry', …)` block:

```ts
  it("the palette is Gallery's: violet three times, three greys and an ochre, no red", () => {
    expect(PALETTES.gallery).toEqual([
      '#6d3fd6', '#6d3fd6', '#6d3fd6', '#1c1c1c', '#454545', '#9a9a9a', '#e9a21f',
    ])
    expect(Object.keys(PALETTES)).toEqual(['gallery'])
  })
```

- [ ] **Step 4: The failing canvas checks**

Append to `apps/web/e2e/gallery.spec.ts`:

```ts
test.describe('canvas, splatter and colour', () => {
  test('the canvas is near-white, its five blobs almost colourless, and the splatter at 0.38', async ({
    page,
  }) => {
    await page.goto('/login')
    await expect(page.locator('[class*="canvas-background_canvas"]')).toHaveCSS(
      'background-color',
      'rgb(246, 246, 244)',
    )
    const blobs = [
      'oklch(0.93 0.004 90)',
      'oklch(0.94 0.004 250)',
      'oklch(0.92 0.003 60)',
      'oklch(0.95 0.003 200)',
      'oklch(0.93 0.004 120)',
    ]
    for (const [index, colour] of blobs.entries()) {
      await expect(page.locator(`[class*="canvas-background_b${index + 1}"]`)).toHaveCSS(
        'background-color',
        await resolveColour(page, colour),
      )
    }
    await expect(page.getByTestId('paint-splatter')).toHaveCSS('opacity', '0.38')
  })

  test('Sign out is plain text, not red', async ({ page }) => {
    const label = `${LABEL}-signout`
    const { owner } = await seedWorkspace(label)
    await signIn(page, owner.id)
    await page.goto('/')
    await page.getByLabel('Account').click()
    await expect(page.getByTestId('sign-out')).toHaveCSS('color', await resolveColour(page, 'var(--text)'))
    await cleanup(label)
  })
})
```

- [ ] **Step 5: Run them and watch them fail**

Run: `pnpm --filter @crdt/web exec vitest run test/no-red.test.ts test/gallery-material.test.ts test/status-display.test.ts test/splatter-geometry.test.ts`
Expected: no-red FAILS listing `components/ui/ui.module.css rgba(196, 55, 43, …)` (three) and `lib/splatter/geometry.ts #e2453c`, and the danger case fails on `user-menu.module.css .danger`, `board.module.css .columnConfirmDelete` (a `background`), `editor-toolbar.module.css .linkInput[aria-invalid='true']` and `SyncStatus.tsx`; status-display FAILS (module missing); the palette case FAILS. The material guard PASSES already for `canvas-background.module.css` (it has no glass), which is expected: it is the guard later tasks lean on.
Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts -g "canvas, splatter"`
Expected: FAIL (canvas `rgb(241, 241, 239)`, old blob colours, opacity `0.32`, Sign out red).

- [ ] **Step 6: The canvas**

In `globals.css` change `--canvas-base: #f1f1ef;` to `--canvas-base: #f6f6f4;`.

In `apps/web/src/components/canvas-background.module.css`, set the five blob backgrounds (sizes, positions and durations unchanged) and fix the splatter comment:

```css
.b1 {
  width: 620px;
  height: 520px;
  left: -140px;
  top: -160px;
  background: oklch(0.93 0.004 90);
  animation-duration: 52s;
}

.b2 {
  width: 520px;
  height: 460px;
  right: -120px;
  top: -60px;
  background: oklch(0.94 0.004 250);
  animation-duration: 60s;
  animation-direction: reverse;
}

.b3 {
  width: 480px;
  height: 420px;
  right: 18%;
  bottom: -180px;
  background: oklch(0.92 0.003 60);
  animation-duration: 68s;
}

.b4 {
  width: 520px;
  height: 440px;
  left: 12%;
  bottom: -200px;
  background: oklch(0.95 0.003 200);
  animation-duration: 76s;
  animation-direction: reverse;
}

.b5 {
  width: 360px;
  height: 320px;
  left: 44%;
  top: 22%;
  background: oklch(0.93 0.004 120);
  animation-duration: 84s;
}

/*
  The splatter sits above the blobs and below the weave, so the texture reads
  over the paint. Opacity comes from the strength setting (.38 subtle, .9 bold)
  and is set inline, since it is one number driven by a prop.
*/
```

(The blob colours are the spec's "Blobs" list in order; the weave is unchanged.)

- [ ] **Step 7: The splatter palette and opacity**

In `apps/web/src/lib/splatter/geometry.ts`, replace the comment above `PALETTES` and the constant with:

```ts
// Gallery's splatter (spec, "Painted background and splatter"): violet #6d3fd6 listed three
// times so `pick` lands on it most often, then three greys and an ochre. No red. This settles
// the Glass-era question of whether violet was duplicated: it is, three times. The reference's
// other palettes ("purple", "orange") are settings the spec does not build.
export const PALETTES = {
  gallery: ['#6d3fd6', '#6d3fd6', '#6d3fd6', '#1c1c1c', '#454545', '#9a9a9a', '#e9a21f'],
} as const
```

In `apps/web/src/components/PaintSplatter.tsx`:
- `palette?: 'purple' | 'orange'` becomes `palette?: 'gallery'`;
- `const LAYER_OPACITY = { subtle: 0.32, bold: 0.9 } as const` becomes `const LAYER_OPACITY = { subtle: 0.38, bold: 0.9 } as const`;
- the default `palette = 'purple'` becomes `palette = 'gallery'`.

Everything else in the file (seed, sizes `random.range(0.7, 1.4)`, the 90px exclusion, 30fps, DPR cap) stays. The scale stays 0.7–1.4: see decision 11.

- [ ] **Step 8: Status dots without red**

Create `apps/web/src/components/status-display.ts`:

```ts
import type { DocStatus } from '@/lib/doc-session'

/**
 * The nav status pill per connection state (spec, "Status"): green when connected, the
 * accent while syncing (the dot pulses; see app-shell.module.css), amber when offline.
 * Kept apart from SyncStatus so it can be tested without React.
 */
export const STATUS_DISPLAY: Record<DocStatus, { label: string; dot: string }> = {
  connected: { label: 'Synced', dot: 'var(--ok)' },
  connecting: { label: 'Syncing', dot: 'var(--sync)' },
  disconnected: { label: 'Offline', dot: 'var(--warn)' },
  fatal: { label: 'Offline', dot: 'var(--warn)' },
}
```

In `apps/web/src/components/SyncStatus.tsx`, delete the `DISPLAY` constant, add `import { STATUS_DISPLAY } from './status-display'`, and change `const { label, dot } = DISPLAY[status]` to `const { label, dot } = STATUS_DISPLAY[status]`. Remove the now-unused `import type { DocStatus } from '@/lib/doc-session'` if nothing else in the file uses it.

- [ ] **Step 9: Red only for errors and delete**

In `apps/web/src/components/user-menu.module.css`, delete the rule:

```css
.danger {
  color: var(--danger);
}
```

In `apps/web/src/components/UserMenu.tsx`, change `className={`${styles.item} ${styles.danger}`}` to `className={styles.item}`. Sign out is not an error or a delete (decision 8).

In `apps/web/src/components/ui/ui.module.css`, replace

```css
.danger:hover:not(:disabled) {
  background: rgba(196, 55, 43, 0.08);
}
```

with

```css
.danger:hover:not(:disabled) {
  background: var(--wash);
}
```

and replace the `.error` rule with

```css
/* An error message: white with a hairline, the words in --danger. The only red is the text. */
.error {
  padding: 10px 14px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-card);
  background: var(--paper);
  color: var(--danger);
  font-size: 13px;
}
```

In `apps/web/src/components/board.module.css`, replace

```css
.columnConfirmDelete {
  background: var(--danger);
  color: #fff;
}
```

with

```css
/* The delete action: red words on the Cancel button's grey, not a red fill. */
.columnConfirmDelete {
  background: rgba(0, 0, 0, 0.05);
  color: var(--danger);
}
```

In `apps/web/src/components/editor-toolbar.module.css`, replace

```css
.linkInput[aria-invalid='true'] {
  border-color: var(--danger);
}
```

with

```css
/* Invalid: a dark edge, not a red one. The message under the field says what is wrong. */
.linkInput[aria-invalid='true'] {
  border-color: var(--rule);
}
```

- [ ] **Step 10: Run the guards and the checks; watch them pass**

Run: `pnpm --filter @crdt/web exec vitest run test/no-red.test.ts test/gallery-material.test.ts test/status-display.test.ts test/splatter-geometry.test.ts`
Expected: PASS.
Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts`
Expected: PASS.

- [ ] **Step 11: Record**

Append to the table in `docs/design/gallery-handoff.md`:

```md
| T2.1 | Splatter palette | Reference "gallery": eight entries, `#1c1c1c` twice, reds mapped to violet | `#6d3fd6` ×3, `#1c1c1c`, `#454545`, `#9a9a9a`, `#e9a21f` | The spec's list (decision 6). |
| T2.2 | Splatter geometry | Reference: its own generator (sizes 14–40px) | `lib/splatter/geometry.ts` unchanged: core 11px, rays `scale × range(1.5, 4)` wide and `coreR × range(1.5, 5)` long, tip `scale × range(1, 2.5)`, droplets out to ×4 and shrinking, `10 + 8·√(W·H)/1100` splats | The spec keeps the agreed numbers (decision 7). |
| T2.3 | Splat scale | Spec table `range(0.6, 1.2)` | `range(0.7, 1.4)`, as shipped | Dhanush's 2026-10-03 decision; the spec asks for the choice to be recorded (decision 11, question 2). |
| T2.4 | Offline status dot | Code before: `--danger` (red) | `--warn` (amber) | The spec's status table (decision 14). |
| T2.5 | Sign out | Reference `#c4372b` | `--text` | Red is for errors and delete only (decision 8, question 5). |
| T2.6 | Error box, invalid field, column delete confirm | Code before: red tint and border; red field border; red fill | White box with a hairline; `--rule` field edge; `--danger` text on grey | Only error and delete *text* is red (decision 20). |
| T2.7 | Red that stays | — | Editor "Red" text colour, the "None" highlight swatch's stroke, person colour `#e11d48` | Content and identity colours, not chrome (decision 16, question 3). Named in `test/no-red.test.ts`. |
```

- [ ] **Step 12: Run the full gate**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: all pass. The splatter's seeded pattern changes (new palette), which no test pins.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/components/canvas-background.module.css \
  apps/web/src/lib/splatter/geometry.ts apps/web/src/components/PaintSplatter.tsx \
  apps/web/src/components/status-display.ts apps/web/src/components/SyncStatus.tsx \
  apps/web/src/components/UserMenu.tsx apps/web/src/components/user-menu.module.css \
  apps/web/src/components/ui/ui.module.css apps/web/src/components/board.module.css \
  apps/web/src/components/editor-toolbar.module.css \
  apps/web/test/css-walk.ts apps/web/test/no-red.test.ts apps/web/test/gallery-material.test.ts \
  apps/web/test/status-display.test.ts apps/web/test/splatter-geometry.test.ts \
  apps/web/e2e/gallery.spec.ts docs/design/gallery-handoff.md
git commit -m "feat(gallery): the near-white canvas, the Gallery splatter, and no red outside errors"
```

---

### Task 3: Foundation — make the CSS-module entrance animations run

**Files:**
- Modify (one declaration each, listed in Step 4): `apps/web/src/components/app-shell.module.css`, `apps/web/src/app/(auth)/auth.module.css`, `apps/web/src/components/command-palette.module.css`, `apps/web/src/app/dashboard.module.css`, `apps/web/src/app/workspaces/[id]/workspace.module.css`, `apps/web/src/components/history-panel.module.css`, `apps/web/src/components/nav-tabs.module.css`, `apps/web/src/components/ui/sheet.module.css`, `apps/web/src/components/user-menu.module.css`, `apps/web/src/components/board.module.css`, `apps/web/src/components/editor-toolbar.module.css`, `apps/web/src/components/canvas-background.module.css`, `apps/web/src/components/version-bar.module.css`
- Create: `apps/web/test/css-motion.test.ts`
- Modify: `apps/web/e2e/fixtures.ts` (add `settleAnimations`)
- Modify: `apps/web/e2e/gallery.spec.ts` (append), and only if they fail as described in Step 8, `apps/web/e2e/glass-shell.spec.ts`
- Modify: `docs/design/gallery-handoff.md`

**Interfaces:**
- Consumes: `declarations`, `rel`, `SRC`, `sourceFiles` from `apps/web/test/css-walk.ts` (Task 2); `gallery.spec.ts` helpers (Task 1).
- Produces:
  - The convention every later task follows: in a `*.module.css`, a shared keyframes is named `global(g-pop)` (likewise `g-in`, `g-sheet`, `g-side`, `g-fade`, `g-pulse`, `g-paint`); `g-up` is not used by modules (the toast has its own `up`).
  - `export async function settleAnimations(page: Page): Promise<void>` in `apps/web/e2e/fixtures.ts`: resolves once no finite animation or transition is running on the page (infinite ones, such as the blobs, are ignored).

**Why this fix:** see "The dead-animation fix" under Decisions. In short: `animation: g-pop 0.6s` inside a module compiles to `animation: app-shell_g-pop__eL_lj .6s`, a name with no keyframes, so nothing runs. `animation: global(g-pop) 0.6s` compiles to the bare `g-pop`, which `globals.css` defines.

- [ ] **Step 1: The failing guard**

Create `apps/web/test/css-motion.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declarations, rel, SRC, sourceFiles } from './css-walk.js'

const KEYWORDS = new Set([
  'none', 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards',
  'backwards', 'both', 'running', 'paused', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
  'linear', 'step-start', 'step-end', 'initial', 'inherit', 'unset',
])

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const keyframesIn = (css: string) =>
  new Set([...stripComments(css).matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!))

const GLOBALS = readFileSync(join(SRC, 'app/globals.css'), 'utf8')
const SHARED = keyframesIn(GLOBALS)

/** The keyframes names in an animation value, and whether each is wrapped in global(). */
function animationNames(value: string): { name: string; global: boolean }[] {
  const plain = value.replace(/\b(var|cubic-bezier|steps)\([^)]*\)/g, ' ')
  const out: { name: string; global: boolean }[] = []
  for (const m of plain.matchAll(/global\(\s*([\w-]+)\s*\)|(?<![\w.-])(-?[a-zA-Z_][\w-]*)/g)) {
    if (m[1]) out.push({ name: m[1], global: true })
    else if (m[2] && !KEYWORDS.has(m[2].toLowerCase())) out.push({ name: m[2], global: false })
  }
  return out
}

describe('CSS motion', () => {
  it('globals.css holds the shared keyframes', () => {
    expect([...SHARED].sort()).toEqual(['g-fade', 'g-in', 'g-paint', 'g-pop', 'g-pulse', 'g-sheet', 'g-side', 'g-up'])
  })

  it('a module reaches a shared keyframes through global(), and a local name only if it defines it', () => {
    // A bare name in a CSS module is hashed per file (app-shell_g-pop__x), and no keyframes
    // carry that name: the animation silently does not run. global(name) keeps it bare.
    const problems: string[] = []
    let checked = 0
    for (const file of sourceFiles(['.module.css'])) {
      const css = readFileSync(file, 'utf8')
      const local = keyframesIn(css)
      for (const d of declarations(css)) {
        if (d.prop !== 'animation' && d.prop !== 'animation-name') continue
        for (const { name, global } of animationNames(d.value)) {
          checked += 1
          if (global ? !SHARED.has(name) : !local.has(name)) {
            problems.push(`${rel(file)} ${d.selector}: ${d.prop}: ${d.value}`)
          }
        }
      }
    }
    // A floor, so a broken walk cannot pass by finding nothing.
    expect(checked).toBeGreaterThan(15)
    expect(problems).toEqual([])
  })

  it('globals.css does not use global(), which only a CSS module understands', () => {
    expect(stripComments(GLOBALS)).not.toMatch(/global\(/)
  })

  it('every transition and animation sits inside prefers-reduced-motion: no-preference', () => {
    const problems: string[] = []
    for (const file of sourceFiles(['.css'])) {
      for (const d of declarations(readFileSync(file, 'utf8'))) {
        if (!['transition', 'transition-property', 'animation', 'animation-name'].includes(d.prop)) continue
        if (d.value === 'none') continue
        const guarded = d.context.some((prelude) => /prefers-reduced-motion:\s*no-preference/.test(prelude))
        if (!guarded) problems.push(`${rel(file)} ${d.selector}: ${d.prop}: ${d.value}`)
      }
    }
    expect(problems).toEqual([])
  })
})
```

- [ ] **Step 2: The failing proof that animations run**

Append to `apps/web/e2e/gallery.spec.ts`:

```ts
test.describe('motion', () => {
  /** Records the name of every CSS animation that runs in the first 3s of each page load. */
  async function recordAnimations(page: Page) {
    await page.addInitScript(() => {
      const seen = new Set<string>()
      ;(window as unknown as { __animations: Set<string> }).__animations = seen
      const start = performance.now()
      const sample = () => {
        for (const animation of document.getAnimations()) {
          if (animation instanceof CSSAnimation) seen.add(animation.animationName)
        }
        if (performance.now() - start < 3000) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  }
  const recorded = (page: Page) =>
    page.evaluate(() => [...(window as unknown as { __animations: Set<string> }).__animations])

  test('the shared entrance animations actually run from CSS modules', async ({ page }) => {
    const label = `${LABEL}-motion`
    const { owner } = await seedWorkspace(label)
    await signIn(page, owner.id)
    await recordAnimations(page)
    await page.goto('/')
    // The nav pops in, the dashboard rises, and the canvas blobs drift.
    await expect
      .poll(() => recorded(page))
      .toEqual(expect.arrayContaining(['g-pop', 'g-in', 'g-paint']))
    await cleanup(label)
  })

  test.describe('with prefers-reduced-motion: reduce', () => {
    test.use({ reducedMotion: 'reduce' })

    test('none of them runs', async ({ page }) => {
      const label = `${LABEL}-motion-reduced`
      const { owner } = await seedWorkspace(label)
      await signIn(page, owner.id)
      await recordAnimations(page)
      await page.goto('/')
      await expect(page.getByTestId('nav-bar')).toBeVisible()
      await page.waitForTimeout(1000)
      expect((await recorded(page)).filter((name) => name.startsWith('g-'))).toEqual([])
      await cleanup(label)
    })
  })
})
```

- [ ] **Step 3: Run both and watch them fail**

Run: `pnpm --filter @crdt/web exec vitest run test/css-motion.test.ts`
Expected: FAIL: 17 module declarations listed by the second case, and `components/version-bar.module.css .button: transition: …` by the last.
Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts -g "motion"`
Expected: the first test FAILS (nothing recorded); the reduced-motion test passes (it already holds; the first test is what proves this one can see an animation).

- [ ] **Step 4: Wrap every shared name in `global()`**

Make exactly these replacements (each is the whole declaration; nothing else on the line changes):

| File | Selector | Before | After |
|---|---|---|---|
| `components/app-shell.module.css` | `.nav` | `animation: g-pop 0.6s var(--ease);` | `animation: global(g-pop) 0.6s var(--ease);` |
| `app/(auth)/auth.module.css` | `.card` | `animation: g-sheet var(--dur-slow) var(--ease);` | `animation: global(g-sheet) var(--dur-slow) var(--ease);` |
| `components/command-palette.module.css` | `.overlay` | `animation: g-fade 0.35s var(--ease);` | `animation: global(g-fade) 0.35s var(--ease);` |
| `components/command-palette.module.css` | `.sheet` | `animation: g-sheet var(--dur-slow) var(--ease);` | `animation: global(g-sheet) var(--dur-slow) var(--ease);` |
| `app/dashboard.module.css` | `.page` | `animation: g-in var(--dur-slow) var(--ease);` | `animation: global(g-in) var(--dur-slow) var(--ease);` |
| `app/workspaces/[id]/workspace.module.css` | `.page` | `animation: g-in var(--dur-slow) var(--ease);` | `animation: global(g-in) var(--dur-slow) var(--ease);` |
| `components/history-panel.module.css` | `.panel` | `animation: g-side 0.6s var(--ease);` | `animation: global(g-side) 0.6s var(--ease);` |
| `components/nav-tabs.module.css` | `.menuList` | `animation: g-pop 0.45s var(--ease);` | `animation: global(g-pop) 0.45s var(--ease);` |
| `components/ui/sheet.module.css` | `.overlay` | `animation: g-fade 0.35s var(--ease);` | `animation: global(g-fade) 0.35s var(--ease);` |
| `components/ui/sheet.module.css` | `.sheet` | `animation: g-sheet var(--dur-slow) var(--ease);` | `animation: global(g-sheet) var(--dur-slow) var(--ease);` |
| `components/user-menu.module.css` | `.popover` | `animation: g-pop 0.45s var(--ease);` | `animation: global(g-pop) 0.45s var(--ease);` |
| `components/board.module.css` | `.card` | `animation: g-in 0.5s var(--ease);` | `animation: global(g-in) 0.5s var(--ease);` |
| `components/editor-toolbar.module.css` | `.root` | `animation: g-pop 0.6s var(--ease);` | `animation: global(g-pop) 0.6s var(--ease);` |
| `components/editor-toolbar.module.css` | `.toolsRow` | `animation: g-fade var(--dur-fast) var(--ease);` | `animation: global(g-fade) var(--dur-fast) var(--ease);` |
| `components/editor-toolbar.module.css` | `.menu` | `animation: g-pop 0.4s var(--ease);` | `animation: global(g-pop) 0.4s var(--ease);` |
| `components/canvas-background.module.css` | `.blob` | `animation-name: g-paint;` | `animation-name: global(g-paint);` |

- [ ] **Step 5: The toast gets its own rise**

`g-up` translates by `-50%` because the reference centres the toast on itself; here `.toastWrap` centres it, so a running `g-up` would pull the toast half its width to the left for half a second (decision 23). In `apps/web/src/components/ui/sheet.module.css`, replace

```css
@media (prefers-reduced-motion: no-preference) {
  .toast {
    animation: g-up 0.55s var(--ease);
  }
}
```

with

```css
/*
  The toast's rise. Not globals.css's g-up, which translates by -50% for a toast that centres
  itself; this one is centred by .toastWrap, so the shared keyframes would throw it sideways.
*/
@keyframes up {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .toast {
    animation: up 0.55s var(--ease);
  }
}
```

- [ ] **Step 6: The one unguarded transition**

In `apps/web/src/components/version-bar.module.css`, delete `transition: background var(--dur-fast) var(--ease);` from `.button`, and add after the `.button:hover` rule:

```css
@media (prefers-reduced-motion: no-preference) {
  .button {
    transition: background var(--dur-fast) var(--ease);
  }
}
```

- [ ] **Step 7: `settleAnimations`**

Append to `apps/web/e2e/fixtures.ts`:

```ts
/**
 * Waits until no finite animation or transition is running anywhere on the page, over two
 * quiet frames (a transition does not exist until the style recalculation after the change
 * that starts it). Infinite ones, such as the canvas blobs, are ignored. Call it before
 * reading geometry straight after a navigation: entrance animations scale and move things.
 */
export async function settleAnimations(page: Page) {
  await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const running = () =>
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState !== 'finished' &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Number.POSITIVE_INFINITY),
        )
    for (let quiet = 0; quiet < 2; ) {
      const pending = running()
      if (pending.length === 0) quiet += 1
      else {
        quiet = 0
        await Promise.allSettled(pending.map((animation) => animation.finished))
      }
      await frame()
    }
  })
}
```

- [ ] **Step 8: Run the guard, the proof, and then the full suite**

Run: `pnpm --filter @crdt/web exec vitest run test/css-motion.test.ts` — Expected: PASS.
Run: `pnpm --filter @crdt/web build`, then `grep -o 'animation[a-z-]*:[^;}]*' apps/web/.next/static/css/*.css | grep -c '_g-'` — Expected: `0` (no hashed `g-` name survives).
Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts -g "motion"` — Expected: PASS.

Then run the whole Playwright suite. Animations that never ran now run, and a test that reads a bounding box straight after a navigation can catch the nav mid-`g-pop` (scaled to .96 and 6px high). The likely ones, in `e2e/glass-shell.spec.ts`: "the nav logo actually renders at 36px", "the board title sits below the nav, the columns follow it, and they are centred", "account menu rows centre their labels vertically". For each test that fails this way, and only those, add `await settleAnimations(page)` (import it from `./fixtures.js`) immediately before its first geometry read, and change nothing else. Report every test you touched.

- [ ] **Step 9: Record**

Append to `docs/design/gallery-handoff.md`:

```md
| T3.1 | Entrance animations | Reference: inline `animation: g-pop …` | `global(g-pop)` and friends in every CSS module; one set of keyframes in `globals.css` | CSS modules hashed the names, so 17 module animations (and the blobs) never ran. Guarded by `test/css-motion.test.ts`. |
| T3.2 | Toast entrance | Reference `g-up` (translate −50%) | A module-local `up` without the −50% | The toast here is centred by its wrapper (decision 23). |
```

- [ ] **Step 10: Run the full gate**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/components/app-shell.module.css "apps/web/src/app/(auth)/auth.module.css" \
  apps/web/src/components/command-palette.module.css apps/web/src/app/dashboard.module.css \
  "apps/web/src/app/workspaces/[id]/workspace.module.css" apps/web/src/components/history-panel.module.css \
  apps/web/src/components/nav-tabs.module.css apps/web/src/components/ui/sheet.module.css \
  apps/web/src/components/user-menu.module.css apps/web/src/components/board.module.css \
  apps/web/src/components/editor-toolbar.module.css apps/web/src/components/canvas-background.module.css \
  apps/web/src/components/version-bar.module.css apps/web/test/css-motion.test.ts \
  apps/web/e2e/fixtures.ts apps/web/e2e/gallery.spec.ts docs/design/gallery-handoff.md
# plus apps/web/e2e/glass-shell.spec.ts if Step 8 touched it
git commit -m "fix(motion): CSS-module animations name the shared keyframes through global()"
```

---

### Task 4: Nav — the white bar, the tween, and the underline

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx` (the width tween's start, lines 218–241)
- Replace: `apps/web/src/components/app-shell.module.css`
- Replace: `apps/web/src/components/nav-tabs.module.css`
- Replace: `apps/web/src/components/user-menu.module.css`
- Modify: `apps/web/src/components/ui/Button.tsx`, `apps/web/src/components/ui/ui.module.css` (buttons and `.chip` only)
- Modify: `apps/web/e2e/glass-shell.spec.ts` (two test names)
- Modify: `apps/web/e2e/gallery.spec.ts` (append), `apps/web/test/gallery-material.test.ts` (`MIGRATED`), `docs/design/gallery-handoff.md`
- Unchanged on purpose: `apps/web/src/components/NavTabs.tsx`, `NavMenu.tsx`, `SyncStatus.tsx`, `NavPresence.tsx`

**Interfaces:**
- Consumes: Task 1 tokens; `settleAnimations` (Task 3, `e2e/fixtures.ts`); `gallery.spec.ts` helpers `LABEL`, `WHITE`, `HAIRLINE`, `FLOAT`, `resolveColour`, `material`; `MIGRATED` in `test/gallery-material.test.ts`; the `global(g-…)` convention.
- Produces: `Button` variants `'accent' | 'plain' | 'ghost' | 'danger'` (`'glass'` is renamed `'plain'`; no caller uses it); class `.plainButton` in `ui.module.css`. The nav keeps every test id and class name the suites read: `nav-bar`, `search`, `status` (with `data-status`), `history`, `account-trigger`, `.strip`, `.indicator`, `.statusDot`.

Read "The nav, replaced versus reused" under Decisions before starting. The module-level `lastNavWidth` (AppShell) and `lastMetrics` (NavTabs) are reused; only the tween's start and the indicator's look change.

- [ ] **Step 1: The failing nav checks**

Append to `apps/web/e2e/gallery.spec.ts`, and add `addMember, createDocument, documentPath, settleAnimations` to its `./fixtures.js` import:

```ts
test.describe('nav', () => {
  test('the bar is solid white with the spec’s edge, square corners, no blur and no shadow', async ({
    page,
  }) => {
    const label = `${LABEL}-navbar`
    const { owner } = await seedWorkspace(label)
    await signIn(page, owner.id)
    await page.goto('/')
    await settleAnimations(page)
    expect(await material(page.getByTestId('nav-bar'))).toEqual({
      background: WHITE,
      backdrop: 'none',
      shadow: 'none',
      radius: '2px',
      borderColor: 'rgba(40, 40, 60, 0.1)',
      borderWidth: '1px',
    })
    const search = await material(page.getByTestId('search'))
    expect(search).toMatchObject({ radius: '2px', shadow: 'none', backdrop: 'none' })
    // The logo stays round, and casts nothing.
    expect(await material(page.getByRole('link', { name: 'All workspaces' }).locator('span'))).toMatchObject({
      radius: '50%',
      shadow: 'none',
    })
    await cleanup(label)
  })

  test('the open tab has violet 600 text over a 2px violet underline; the others are grey 500', async ({
    page,
  }) => {
    const label = `${LABEL}-tabs`
    const { owner, workspace } = await seedWorkspace(label)
    const document = await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.goto(documentPath(document))
    await settleAnimations(page)

    const active = page.getByTestId(`tab-${document.id}`)
    await expect(active).toHaveCSS('color', await resolveColour(page, 'var(--accent-text)'))
    await expect(active).toHaveCSS('font-weight', '600')
    await expect(page.getByTestId('tab-overview')).toHaveCSS('color', 'rgb(95, 98, 93)')
    await expect(page.getByTestId('tab-overview')).toHaveCSS('font-weight', '500')

    const underline = page.locator('[class*="indicator"]')
    const look = await underline.evaluate((el) => {
      const style = getComputedStyle(el)
      const strip = el.parentElement!.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      return {
        height: style.height,
        background: style.backgroundColor,
        radius: style.borderTopLeftRadius,
        backdrop: style.backdropFilter,
        shadow: style.boxShadow,
        bottomGap: Math.abs(strip.bottom - box.bottom),
      }
    })
    expect(look).toMatchObject({
      height: '2px',
      background: await resolveColour(page, 'var(--accent)'),
      radius: '0px',
      backdrop: 'none',
      shadow: 'none',
    })
    expect(look.bottomGap).toBeLessThan(0.5)
    await cleanup(label)
  })

  test('the underline slides: its transform and width move from one tab to the next', async ({ page }) => {
    const label = `${LABEL}-slide`
    const { owner, workspace } = await seedWorkspace(label)
    const first = await createDocument(workspace.id, 'doc')
    const second = await createDocument(workspace.id, 'board')
    await signIn(page, owner.id)
    await page.goto(documentPath(first))
    await settleAnimations(page)

    const underline = page.locator('[class*="indicator"]')
    const read = () => underline.evaluate((el) => getComputedStyle(el).transform)
    const before = await read()
    await expect(underline).toHaveCSS('transition-duration', '0.55s, 0.55s, 0.3s')

    await page.getByTestId(`tab-${second.id}`).click()
    await expect(page.getByTestId(`tab-${second.id}`)).toHaveAttribute('data-active', 'true')
    await expect.poll(read).not.toBe(before)
    await cleanup(label)
  })

  test('the nav tweens its width when it is built anew, from the dashboard into a workspace', async ({
    page,
  }) => {
    const label = `${LABEL}-fresh`
    const { owner, workspace } = await seedWorkspace(label)
    await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto('/')
    await settleAnimations(page)
    const width = () => page.getByTestId('nav-bar').evaluate((el) => (el as HTMLElement).offsetWidth)
    const before = await width()

    // offsetWidth, not the bounding box: the new nav also pops in (g-pop scales it), and a
    // scaled box would show "intermediate" widths with no tween at all.
    const sampling = page.evaluate(async () => {
      const out: number[] = []
      const start = performance.now()
      while (performance.now() - start < 1500) {
        const nav = document.querySelector<HTMLElement>('[data-testid="nav-bar"]')
        if (nav) out.push(nav.offsetWidth)
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      return out
    })
    await page.getByTestId(`workspace-${workspace.id}`).click()
    const widths = await sampling
    await expect(page.getByTestId('tab-overview')).toBeVisible()
    await settleAnimations(page)
    const after = await width()

    expect(after).toBeGreaterThan(before + 40)
    expect(widths.filter((w) => w > before + 2 && w < after - 2).length).toBeGreaterThan(2)
    await cleanup(label)
  })

  test.describe('with prefers-reduced-motion: reduce', () => {
    test.use({ reducedMotion: 'reduce' })

    test('the bar and the underline change size without animating', async ({ page }) => {
      const label = `${LABEL}-navreduced`
      const { owner, workspace } = await seedWorkspace(label)
      const document = await createDocument(workspace.id, 'doc')
      await signIn(page, owner.id)
      await page.setViewportSize({ width: 1600, height: 900 })
      await page.goto(`/workspaces/${workspace.id}`)
      await expect(page.getByTestId('tab-overview')).toHaveAttribute('data-active', 'true')
      await expect(page.locator('[class*="indicator"]')).toHaveCSS('transition-duration', '0s')

      const inline = page.evaluate(async () => {
        const out: string[] = []
        const start = performance.now()
        while (performance.now() - start < 1200) {
          out.push((document.querySelector('[data-testid="nav-bar"]') as HTMLElement).style.width)
          await new Promise((resolve) => requestAnimationFrame(resolve))
        }
        return out
      })
      await page.getByTestId(`tab-${document.id}`).click()
      // No tween ever pins an inline width.
      expect((await inline).every((value) => value === '')).toBe(true)
      await cleanup(label)
    })
  })

  test('the tab strip fades at its right edge only while more tabs are off to the right', async ({
    page,
  }) => {
    const label = `${LABEL}-fade`
    const { owner, workspace } = await seedWorkspace(label)
    await page.setViewportSize({ width: 1280, height: 720 })
    const documents = []
    for (let i = 0; i < 9; i++) documents.push(await createDocument(workspace.id, 'doc'))
    await signIn(page, owner.id)
    await page.goto(documentPath(documents[0]!))
    const strip = page.locator('[class*="strip"]')
    await expect.poll(() => strip.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(40)

    const mask = () => strip.evaluate((el) => getComputedStyle(el).maskImage)
    await expect.poll(mask).toContain('linear-gradient')
    await strip.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
    await expect.poll(mask).toBe('none')
    await cleanup(label)
  })

  test('a syncing status dot pulses in the accent, and stops once connected', async ({ page }) => {
    const label = `${LABEL}-pulse`
    const { owner, workspace } = await seedWorkspace(label)
    const document = await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    // Hold the token so the document stays connecting long enough to look at.
    await page.route(`**/api/documents/${document.id}/token`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000))
      await route.continue()
    })
    await page.goto(documentPath(document))
    const status = page.getByTestId('status')
    await expect(status).toHaveAttribute('data-status', 'connecting')
    const dot = status.locator('[class*="statusDot"]')
    await expect(dot).toHaveCSS('animation-name', 'g-pulse')
    await expect(dot).toHaveCSS('background-color', await resolveColour(page, 'var(--accent)'))
    expect(await dot.evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0)

    await expect(status).toHaveAttribute('data-status', 'connected', { timeout: 15_000 })
    await expect(dot).toHaveCSS('animation-name', 'none')
    await cleanup(label)
  })

  test('the narrow-screen tab menu and the account menu are white floating panels', async ({ page }) => {
    const label = `${LABEL}-navmenus`
    const { owner, workspace } = await seedWorkspace(label)
    const document = await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.setViewportSize({ width: 700, height: 800 })
    await page.goto(documentPath(document))
    await page.getByTestId('nav-menu').click()
    const floating = {
      background: WHITE,
      backdrop: 'none',
      shadow: FLOAT,
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    }
    await settleAnimations(page)
    expect(await material(page.locator('#nav-menu-list'))).toEqual(floating)
    await page.keyboard.press('Escape')

    await page.getByLabel('Account').click()
    await settleAnimations(page)
    expect(await material(page.getByTestId('account-menu'))).toEqual(floating)
    await cleanup(label)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts -g "nav"`
Expected: the bar, tab, underline, pulse and menu tests FAIL against Glass (blur, pill radius, a 32px pill with a glass gradient, no pulse, glass menus). The tween, reduced-motion and fade tests describe behaviour that already exists: they should PASS now, and Step 8 proves they can fail.

- [ ] **Step 3: The tween's start, in the spec's order**

In `apps/web/src/components/AppShell.tsx`, replace this block (inside the width `useLayoutEffect`, starting at line 218):

```ts
    animatingWidth.current = true
    // Pin the start width with no transition, let it paint, and only then change to
    // the target. The usual set-then-force-a-reflow trick is not enough here: the bar
    // is a brand-new node on a navigation to or from the dashboard, and a property's
    // first resolved value on a freshly inserted element is its initial value, not
    // something to transition from -- measured, the transition was swallowed and the
    // width simply jumped. A real frame in between gives the browser a painted
    // "before".
    bar.style.transition = 'none'
    bar.style.width = `${from}px`
    const frame = requestAnimationFrame(() => {
      bar.style.transition = 'width var(--dur) var(--ease)'
      bar.style.width = `${to}px`
    })

    let settled = false
    const stop = () => {
      settled = true
      cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
```

with:

```ts
    animatingWidth.current = true
    // The spec's tween ("Nav bar"), in its order: (1) the bar at the old width, with no
    // transition; (2) a forced layout, which commits that width as the value the
    // transition starts from; (3) the transition on and the new width, over --dur
    // (0.55s) with --ease (cubic-bezier(.32,.72,0,1)). `done` below clears the inline
    // width on the bar's own width transitionend. On the first-ever mount `from` is null
    // and this is never reached; under reduced motion the early return above skips it.
    bar.style.transition = 'none'
    bar.style.width = `${from}px`
    void bar.offsetWidth
    bar.style.transition = 'width var(--dur) var(--ease)'
    bar.style.width = `${to}px`

    let settled = false
    const stop = () => {
      settled = true
      window.clearTimeout(timeout)
```

Nothing else in `AppShell.tsx` changes: `lastNavWidth`, `naturalWidth`, the `ResizeObserver`, the hold for a connecting document, `done` (which ignores any `transitionend` that is not the bar's own `width`) and its 1000ms timeout all stay.

- [ ] **Step 4: The bar's stylesheet**

Replace `apps/web/src/components/app-shell.module.css` with:

```css
.shell {
  min-height: 100vh;
}

/* The nav's bottom edge, for anything sticky under it (the document toolbar). */
.shell {
  --nav-bottom: 68px;
}

.shell[data-nav-condensed='true'] {
  --nav-bottom: 52px;
}

/*
  The nav floats over the scrolling page rather than pinning to the viewport
  edge, so the 12px of padding is part of the design, not a margin on the bar.
*/
.navWrap {
  position: sticky;
  top: 0;
  z-index: 30;
  padding: 12px 16px 0;
  /* A constant in-flow box: 12 + 56. The condensed state moves the bar inside it (the
     padding drops to 6) but never changes this height. If it did, everything below
     would shift up, scroll anchoring would pull scrollY back under the expand
     threshold, and the bar would flip again for as long as the user rested there.
     Anything that hangs under the bar (floating pills) overflows rather than grows it. */
  box-sizing: border-box;
  height: 68px;
  /* A column, not a row: the bar is centred, and so are the pills that sit under it. */
  display: flex;
  flex-direction: column;
  align-items: center;
}

/*
  The bar (spec, "Nav bar"): solid white, the spec's own edge colour, 2px corners, no blur
  and no shadow. As wide as its contents and never wider than the window; AppShell tweens
  the width between contents (lastNavWidth). The tabs strip must stay `flex: 0 1 auto` and
  the Workspaces link `flex: none` for this to hold: a growing child makes the bar grow to
  the window and the centring is lost.
*/
.nav {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  width: fit-content;
  max-width: 100%;
  padding: 0 8px 0 10px;
  border-radius: var(--r);
  background: var(--paper);
  /* The spec's literal for the bar's edge: a shade darker than --hairline. */
  border: 1px solid rgba(40, 40, 60, 0.1);
}

@media (prefers-reduced-motion: no-preference) {
  .nav {
    animation: global(g-pop) 0.6s var(--ease);
    /* The width line is the CSS backstop for a contents change inside one page; the JS
       tween in AppShell is what runs across a navigation. */
    transition:
      width var(--dur) var(--ease),
      height 0.4s var(--ease);
  }
}

/* Condensed past 24px of scroll (spec): 56 → 46, the wrapper's gap 12 → 6, over 0.4s.
   0.4s is a literal: no token is 0.4s. */
.navCondensed {
  height: 46px;
}

.navWrapCondensed {
  padding-top: 6px;
}

@media (prefers-reduced-motion: no-preference) {
  .navWrap {
    transition: padding-top 0.4s var(--ease);
  }
}

/* The logo stays a round accent disc (spec, "Corners"); it casts nothing. */
.logo {
  display: block;
  flex: none;
  width: 36px;
  height: 36px;
  border: 0;
  /* 5px of fill around the 26px glyph (LogoMark), so the dots never touch the edge. */
  padding: 5px;
  box-sizing: border-box;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
}

@media (prefers-reduced-motion: no-preference) {
  .logo {
    transition: transform 0.4s var(--ease);
  }
  .logo:hover {
    transform: rotate(-8deg) scale(1.05);
  }
  .logo:active {
    transform: scale(0.92);
  }
}

/*
  Deliberate deviation from the prototype, which caps nothing: a 120-character workspace
  name would otherwise stretch the nav and make the whole page scroll sideways. It shrinks
  and truncates instead. 240px is not a design value; it leaves the tab strip its room.

  A block with a line-height rather than display:flex, because text-overflow: ellipsis only
  applies to a block container's own text.
*/
.workspaceName {
  display: block;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 240px;
  height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--r);
  background: transparent;
  font-size: 15px;
  font-weight: 600;
  line-height: 36px;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The reference's #fff hover is invisible on the white bar; the wash shows. */
.workspaceName:hover {
  background: var(--wash);
  text-decoration: none;
}

@media (prefers-reduced-motion: no-preference) {
  .workspaceName {
    transition: background var(--dur-fast) var(--ease);
  }
}

.divider {
  flex: none;
  width: 1px;
  height: 22px;
  /* Raw value on purpose: the reference gives this divider rgba(0,0,0,.08), which has no
     token. --field-border is a different colour. */
  background: rgba(0, 0, 0, 0.08);
}

/*
  The Workspaces link, styled as an inactive tab: 32px high, 0 14px, 14px/500 in
  --text-muted, no background of its own. `flex: none` so a tight bar shrinks the
  workspace name and the tab strip, never this label.
*/
.navLink {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--r);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  white-space: nowrap;
}

.navLink:hover {
  color: var(--text);
  text-decoration: none;
}

/* The current page: the open tab's text style. The underline belongs to the tab strip and
   is not drawn here. */
.navLinkCurrent,
.navLinkCurrent:hover {
  font-weight: 600;
  color: var(--accent-text);
}

@media (prefers-reduced-motion: no-preference) {
  .navLink {
    transition: color var(--dur-fast) var(--ease);
  }
}

/* A flex item that would otherwise shrink and wrap its label when the nav is tight. */
.viewOnly {
  flex: none;
  white-space: nowrap;
}

/* Field style: the spec keeps fields at rgba(40,40,60,.12). #55585f is the reference's
   literal for this label; no token holds it. */
.search {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  min-width: 170px;
  padding: 0 10px 0 14px;
  border-radius: var(--r);
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  color: #55585f;
  font-size: 14px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.search:hover {
  background: var(--paper);
  border-color: var(--dash);
}

@media (prefers-reduced-motion: no-preference) {
  .search {
    transition:
      background var(--dur-fast) var(--ease),
      border-color var(--dur-fast) var(--ease);
  }
}

.kbd {
  margin-left: auto;
  padding: 2px 6px;
  border: 1px solid var(--field-border);
  border-radius: var(--r);
  background: var(--paper);
  font-size: 11px;
  color: var(--text-muted);
}

/* A field-style pill: dot plus label. The label carries the meaning in words, so the
   state is never colour alone. */
.status {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px;
  border-radius: var(--r);
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  color: var(--text-2);
  font-size: 14px;
  white-space: nowrap;
}

.statusDot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

/* Syncing: the accent dot pulses (spec, "Status"). Its colour comes from status-display.ts. */
@media (prefers-reduced-motion: no-preference) {
  .status[data-status='connecting'] .statusDot {
    animation: global(g-pulse) 1s ease-in-out infinite;
  }
}

.presence {
  flex: none;
  display: flex;
  align-items: center;
  /* The first avatar's ring would otherwise touch the status pill's edge. */
  padding: 0 2px;
}

/* The 2px white ring is a box-shadow so the fill stays a full 28px circle. */
.avatar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px #fff;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: default;
}

.avatar + .avatar {
  margin-left: -7px;
}

/* No hover lift (spec, "Hover"); the small grow stays. */
@media (prefers-reduced-motion: no-preference) {
  .avatar {
    transition: transform var(--dur-fast) var(--ease);
  }
  .avatar:hover {
    transform: scale(1.06);
  }
}

/* Below 1100px the nav sheds its optional pieces before it wraps. */
@media (max-width: 1100px) {
  .search {
    min-width: 0;
  }
  .searchLabel {
    display: none;
  }
  /*
    The design hides the status label and the avatars here for compactness. display:none
    would also remove them from the accessibility tree, leaving the status colour-only
    and the names unavailable, so they are clipped instead (same pattern as .labelHidden
    in ui.module.css; a media rule cannot compose it).
  */
  .statusLabel,
  .presence {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  /* The label is gone, so the pill shrinks to the dot with even padding. */
  .status {
    padding: 0 13px;
  }
}

.content {
  position: relative;
  z-index: 1;
}

/* The panel itself is not in here: it is portalled to <body> (see HistoryButton). */
.historyWrap {
  flex: none;
}

/* Field style, like the search and status pills. White while open. */
.history {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 14px;
  border-radius: var(--r);
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  color: #55585f;
  font-size: 14px;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.historyOpen {
  background: var(--paper);
}

@media (prefers-reduced-motion: no-preference) {
  .history {
    transition: background var(--dur-fast) var(--ease);
  }
}

/* Below 760px the tabs become one dropdown and the workspace name hides. The Workspaces
   link hides with it: the logo still links to the dashboard, and the dropdown's Overview
   entry replaces the name. */
@media (max-width: 760px) {
  .workspaceName,
  .divider,
  .navLink {
    display: none;
  }
}
```

- [ ] **Step 5: The tab strip and its underline**

Replace `apps/web/src/components/nav-tabs.module.css` with:

```css
.strip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  /* Not `1 1 auto`. The nav sizes itself to this row, so a strip that grows to fill the
     nav makes the nav grow to fill the window: each would be waiting for the other, and
     the bar would stop being centred. It takes the space it needs, can still shrink to
     120px (spec, "Tabs"), and scrolls sideways with the edge fade beyond that. */
  flex: 0 1 auto;
  min-width: 120px;
  padding: 3px;
  border-radius: var(--r);
  overflow-x: auto;
  scrollbar-width: none;
  /*
    The right-edge fade is applied inline from measured overflow (NavTabs), not here: an
    unconditional mask fades the right edge of a two-tab strip forever, which reads as a
    rendering fault rather than as "there is more".
  */
}

.strip::-webkit-scrollbar {
  display: none;
}

.tab {
  position: relative;
  z-index: 1;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--r);
  background: transparent;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
}

@media (prefers-reduced-motion: no-preference) {
  .tab {
    transition: color var(--dur-fast);
  }
}

/*
  The strip clips its overflow, so the global 2px-outside ring would be cut off
  on every side. Draw it inside the tab instead.
*/
.tab:focus-visible {
  outline-offset: -2px;
}

.tab:hover {
  color: var(--text);
  text-decoration: none;
}

/* The open tab: violet text at 600 (spec, "Active tab"). Inactive tabs are --text-muted
   (#5f625d) at 500, above. */
.tabActive,
.tabActive:hover {
  font-weight: 600;
  color: var(--accent-text);
}

/*
  The open tab's underline (spec, "Active tab"): a 2px accent rule at the bottom of the
  strip. NavTabs places it with transform: translateX(offsetLeft) and sizes it with
  width: offsetWidth, both measured from the open tab, and remembers the last position
  at module level (lastMetrics) so it slides across page changes too.
*/
.indicator {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--accent);
  pointer-events: none;
}

@media (prefers-reduced-motion: no-preference) {
  /* Added only after the first placement; see NavTabs. */
  .indicatorAnimated {
    transition:
      transform var(--dur) var(--ease),
      width var(--dur) var(--ease),
      opacity var(--dur-fast) var(--ease);
  }
}

/* Others are in this document. aria-hidden: the status pill already says how many. */
.presenceDot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
}

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
  border-radius: var(--r);
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

/* A floating menu: white, a hairline, the floating shadow. */
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
  border-radius: var(--r);
  background: var(--paper);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-float);
}

@media (prefers-reduced-motion: no-preference) {
  .menuList {
    transform-origin: top left;
    animation: global(g-pop) 0.45s var(--ease);
  }
}

.menuItem {
  display: block;
  padding: 8px 12px;
  border-radius: var(--r);
  color: var(--text-muted);
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menuItem:hover {
  background: var(--wash);
  color: var(--text);
  text-decoration: none;
}

/* The same colour the strip's open tab uses. */
.menuItemActive,
.menuItemActive:hover {
  font-weight: 600;
  color: var(--accent-text);
}
```

- [ ] **Step 6: The account menu**

Replace `apps/web/src/components/user-menu.module.css` with:

```css
.wrap {
  position: relative;
  flex: none;
}

.avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  /* Not a person in the document: white with a field-coloured ring and the initial in your
     colour, so it never reads as a second avatar in the people group (owner, 2026-10-08). */
  background: var(--paper);
  box-shadow: inset 0 0 0 1px var(--field-border);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

@media (prefers-reduced-motion: no-preference) {
  .avatar {
    transition: transform 0.4s var(--ease);
  }
  .avatar:active {
    transform: scale(0.94);
  }
}

/* A floating menu: white, a hairline, the floating shadow. */
.popover {
  position: absolute;
  top: 48px;
  right: 0;
  width: 220px;
  padding: 6px;
  border-radius: var(--r);
  background: var(--paper);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-float);
  transform-origin: top right;
}

@media (prefers-reduced-motion: no-preference) {
  .popover {
    animation: global(g-pop) 0.45s var(--ease);
  }
}

.identity {
  padding: 10px 12px;
}

.name {
  font-size: 14px;
  font-weight: 600;
}

.email {
  font-size: 13px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--r);
  background: transparent;
  text-align: left;
  font-size: 14px;
  color: var(--text);
  cursor: pointer;
}

.item:hover {
  background: var(--wash);
  text-decoration: none;
}
```

(`.danger` is already gone: Task 2.)

- [ ] **Step 7: Flat buttons and chips**

In `apps/web/src/components/ui/ui.module.css`:
- in `.button`, change `border-radius: var(--r-pill);` to `border-radius: var(--r);`;
- replace the `.accent` rule with
  ```css
  .accent {
    background: var(--accent);
    color: #fff;
  }
  ```
- replace the `.glassButton` and `.glassButton:hover:not(:disabled)` rules with
  ```css
  /* A white button with a field edge, for a secondary action on a white surface. */
  .plainButton {
    background: var(--paper);
    border-color: var(--field-border);
    color: var(--text);
  }

  .plainButton:hover:not(:disabled) {
    border-color: var(--dash);
  }
  ```
- in `.chip`, change `border-radius: var(--r-pill);` to `border-radius: var(--r);`.

In `apps/web/src/components/ui/Button.tsx`, change `type Variant = 'accent' | 'glass' | 'ghost' | 'danger'` to `type Variant = 'accent' | 'plain' | 'ghost' | 'danger'` and `glass: styles.glassButton!,` to `plain: styles.plainButton!,`. Nothing passes `variant="glass"` (checked: `grep -rn 'variant="glass"' apps/web/src` is empty), so no caller changes.

- [ ] **Step 8: Run the nav checks, then prove the existing-behaviour ones discriminate**

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts -g "nav"` — Expected: all PASS.

**If "the nav tweens its width when it is built anew" fails** (the widths jump straight from `before` to `after`), the handoff's measured finding holds for this browser: a forced layout does not give a freshly inserted bar a "before". Then, and only then, change the replacement in Step 3 so the target is set one frame later, keeping the forced layout:

```ts
    bar.style.transition = 'none'
    bar.style.width = `${from}px`
    void bar.offsetWidth
    const frame = requestAnimationFrame(() => {
      bar.style.transition = 'width var(--dur) var(--ease)'
      bar.style.width = `${to}px`
    })

    let settled = false
    const stop = () => {
      settled = true
      cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
```

rerun, and record it as deviation T4.6 in Step 10.

Prove the three existing-behaviour tests discriminate. Commit first (Step 11's `git add` list, message "wip"), then for each mutation run the named test, watch it FAIL, and restore with `git checkout -- <file>`:
- "built anew": in `AppShell.tsx` change `const from = lastNavWidth` to `const from = null as number | null`.
- "reduced motion": in `AppShell.tsx` delete the line `if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return`.
- "fades at its right edge": in `NavTabs.tsx` replace both inline mask expressions, `overflowing ? 'linear-gradient(90deg,#000 82%,transparent)' : 'none'`, with `'none'`.
Then squash the wip commit into the task commit in Step 11 (`git reset --soft HEAD~1` before committing; this rewrites only your own unpushed commit).

- [ ] **Step 9: The two renamed tests and the material guard**

In `apps/web/e2e/glass-shell.spec.ts`, rename (assertions unchanged):
- `'the pill slides to the new tab across a navigation instead of appearing there'` → `'the underline slides to the new tab across a navigation instead of appearing there'`, and in that test's comments "pill" → "underline";
- `'the nav is a pill sized to its contents and centred'` → `'the nav is a bar sized to its contents and centred'`.

In `apps/web/test/gallery-material.test.ts`, extend `MIGRATED`:

```ts
const MIGRATED: string[] = [
  'components/canvas-background.module.css',
  'components/app-shell.module.css',
  'components/nav-tabs.module.css',
  'components/user-menu.module.css',
]
```

Run: `pnpm --filter @crdt/web exec vitest run test/gallery-material.test.ts` — Expected: PASS.

- [ ] **Step 10: Record**

Append to `docs/design/gallery-handoff.md`:

```md
| T4.1 | Nav bar | Reference: floating shadow under the bar | No shadow | The spec: "No blur, no shadow" (decision 1). |
| T4.2 | Workspace name hover | Reference `#fff` on the white bar | `--wash` | Invisible otherwise (decision 17). |
| T4.3 | Presence avatars hover | Code before: `translateY(-3px) scale(1.06)` | `scale(1.06)` | No hover lifts (decision 2). |
| T4.4 | Status pill text | Code before `#55585f` | `--text-2`, as the reference; the search label keeps `#55585f` | The reference's values per control. |
| T4.5 | Syncing dot | Reference `c-pulse 1s` (undefined in the reference) | `g-pulse 1s` infinite, reduced-motion guarded | Decision 22. |
| T4.6 | Width tween start | Spec: pin, force a layout, animate | (Only if Step 8's fallback was needed: pin, force a layout, set the target one frame later) | (Only if used: a freshly inserted bar did not transition from a forced layout in this Chrome; measured.) |
| T4.7 | `Button` variant | `glass` | `plain` | No glass; no caller used it. |
```

Delete row T4.6 if the fallback was not needed.

- [ ] **Step 11: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: all pass (the existing nav tests, "the nav condenses …" with its 56/46/12/6/68 values, "moving between two busy documents does not collapse the nav", "a child transition ending does not cut the nav width animation short", and the underline tests among them).

```bash
git add apps/web/src/components/AppShell.tsx apps/web/src/components/app-shell.module.css \
  apps/web/src/components/nav-tabs.module.css apps/web/src/components/user-menu.module.css \
  apps/web/src/components/ui/Button.tsx apps/web/src/components/ui/ui.module.css \
  apps/web/e2e/glass-shell.spec.ts apps/web/e2e/gallery.spec.ts \
  apps/web/test/gallery-material.test.ts docs/design/gallery-handoff.md
git commit -m "feat(gallery): the nav is a white bar with a sliding violet underline"
```

---

### Task 5: Board

**Files:**
- Replace: `apps/web/src/components/board.module.css`
- Modify: `apps/web/e2e/gallery.spec.ts` (append), `apps/web/test/gallery-material.test.ts` (`MIGRATED`), `docs/design/gallery-handoff.md`

**Interfaces:**
- Consumes: Task 1 tokens; `gallery.spec.ts` helpers `LABEL`, `WHITE`, `PAPER_SOFT`, `HAIRLINE`, `RULE`, `material`; `settleAnimations`, `createDocument`, `documentPath` (already imported by Task 4); `MIGRATED`.
- Produces: nothing new. Keeps the class names `scroller`, `column`, `columnOver`, `card`, `cardPeer`, `cardDragging`, `peers`, `peerChip`, `peerAvatar`, `count` and every test id (`column-*`, `card-*`, `add-card-*`, `add-column`, `col-*`).

- [ ] **Step 1: The failing board checks**

Append to `apps/web/e2e/gallery.spec.ts`:

```ts
test.describe('board', () => {
  /** A board with one column and one card; returns their locators. */
  async function boardWithACard(page: Page, label: string) {
    const { owner, workspace } = await seedWorkspace(label)
    const board = await createDocument(workspace.id, 'board')
    await signIn(page, owner.id)
    await page.goto(documentPath(board))
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await page.getByTestId('add-column').click()
    const column = page.locator('[data-testid^="column-"]').first()
    await expect(column).toBeVisible()
    const columnId = (await column.getAttribute('data-testid'))!.replace('column-', '')
    await page.getByTestId(`add-card-${columnId}`).click()
    const card = column.locator('article[data-testid^="card-"]').first()
    await expect(card).toBeVisible()
    await settleAnimations(page)
    return { column, card, addCard: page.getByTestId(`add-card-${columnId}`) }
  }

  test('columns are the softer white with a hairline; cards are white with a hairline ring', async ({
    page,
  }) => {
    const label = `${LABEL}-board`
    const { column, card, addCard } = await boardWithACard(page, label)
    expect(await material(column)).toEqual({
      background: PAPER_SOFT,
      backdrop: 'none',
      shadow: 'none',
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    })
    expect(await material(card)).toMatchObject({
      background: WHITE,
      backdrop: 'none',
      shadow: `${HAIRLINE} 0px 0px 0px 1px`,
      radius: '2px',
    })
    expect(await material(addCard)).toMatchObject({ background: WHITE, radius: '2px', borderColor: HAIRLINE })
    const addList = page.getByTestId('add-column')
    await expect(addList).toHaveCSS('border-top-style', 'dashed')
    expect(await material(addList)).toMatchObject({ background: WHITE, radius: '2px', backdrop: 'none', shadow: 'none' })
    await cleanup(label)
  })

  test('a hovered card does not lift; its edge turns dark', async ({ page }) => {
    const label = `${LABEL}-cardhover`
    const { card } = await boardWithACard(page, label)
    await card.hover()
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(`${RULE} 0px 0px 0px 1px`)
    await settleAnimations(page)
    await expect(card).toHaveCSS('transform', 'none')
    await cleanup(label)
  })
})
```

`card-presence-*` test ids also start with `card-`, which is why the card locator is `article[data-testid^="card-"]` (cards are `<article>` elements in `Board.tsx`; check, and use the card's element name if it differs).

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts -g "board"`
Expected: FAIL (glass column `rgba(255, 255, 255, 0.42)`, radius 26px; card radius 18px; hover lift `translateY(-3px)`).

- [ ] **Step 3: The board's stylesheet**

Replace `apps/web/src/components/board.module.css` with:

```css
.scroller {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  /* The board's title sits between the nav and the columns (24px under the nav), so the
     columns' own top padding is 20px: measured from the title's bottom to the first
     column's top at 1280px. */
  padding: 20px 16px 16px;
  overflow-x: auto;
  /*
    Centred when the columns fit, full width and scrolling when they do not.
    fit-content resolves to min(max-content, available), so these three lines give
    both behaviours. `justify-content: center` is the obvious alternative and is
    wrong: with overflow it makes the first column unreachable.
  */
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
}

/* Column (spec, "Material"): it was the most see-through glass (.42), so it takes the
   softer white, with a hairline and 2px corners. */
.column {
  flex: none;
  width: 290px;
  border-radius: var(--r);
  padding: 14px;
  background: var(--paper-soft);
  border: 1px solid var(--hairline);
}

/* Drag-over: white, with a 2px accent ring inside. No transition: the held-drag test
   reads the ring mid-drag, and the column never had one. */
.columnOver {
  background: var(--paper);
  box-shadow: inset 0 0 0 2px var(--accent);
}

.columnHead {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 2px 12px;
}

.columnTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  min-width: 0;
  overflow-wrap: anywhere;
}

/* Count chip: 22px, rgba(0,0,0,.05), the reference's literal. */
.count {
  flex: none;
  display: grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 7px;
  border-radius: var(--r);
  background: rgba(0, 0, 0, 0.05);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
}

.cards {
  display: grid;
  gap: 8px;
}

/* Card (spec, "Shadows"): white with a 0 0 0 1px hairline ring instead of a border, so a
   selected or peer ring can replace it without moving anything. */
.card {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--r);
  background: var(--paper);
  box-shadow: 0 0 0 1px var(--hairline);
  cursor: grab;
}

.card[data-readonly='true'] {
  cursor: default;
}

/* Hover: no lift; the edge turns dark (spec, "Hover"). The press stays. */
.card:hover {
  box-shadow: 0 0 0 1px var(--rule);
}

@media (prefers-reduced-motion: no-preference) {
  .card {
    animation: global(g-in) 0.5s var(--ease);
    transition:
      transform var(--dur-fast) var(--ease),
      box-shadow var(--dur-fast) var(--ease);
  }
  .card:active {
    transform: scale(0.98);
  }
}

.cardDragging {
  opacity: 0.4;
}

/* Used by the card sheet in a later plan; no caller wires selection yet. */
.cardSelected {
  box-shadow: 0 0 0 2px var(--accent);
}

/* A remote peer on the card: the peer's 2px ring, without the glow under it. */
.cardPeer {
  box-shadow: 0 0 0 2px #0ea5e9;
}

/* Zero basis: with .card wrapping, an auto basis would push the × onto its own row. */
.cardTitle {
  flex: 1 1 0;
  min-width: 0;
  font-size: 14.5px;
  line-height: 1.35;
  color: var(--text);
  overflow-wrap: anywhere;
}

/* Delete ×: a 24px circle for editors. Round, like the other × buttons. */
.delete {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.delete:hover {
  background: rgba(0, 0, 0, 0.1);
  color: var(--text);
}

/* Full-width row under the title and delete button; .card's gap supplies the spacing. */
.peers {
  flex-basis: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* Peer chip: avatar + name, rgba(14,165,233,.1) with text #0b6e99, the reference's literals. */
.peerChip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px 3px 3px;
  border-radius: var(--r);
  background: rgba(14, 165, 233, 0.1);
  color: #0b6e99;
  font-size: 12px;
  font-weight: 500;
}

.peerAvatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}

/* "+ Add a card": white with a hairline. The reference fills it #fbfbf9, the column's own
   colour, where it disappears. */
.addCard {
  width: 100%;
  height: 36px;
  margin-top: 8px;
  border: 1px solid var(--hairline);
  border-radius: var(--r);
  background: var(--paper);
  color: var(--text-2);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.addCard:hover {
  border-color: var(--rule);
  color: var(--text);
}

/* "+ Add a list": 230x54, a dashed edge on white. */
.addList {
  flex: none;
  width: 230px;
  height: 54px;
  border: 1.5px dashed var(--dash);
  border-radius: var(--r);
  background: var(--paper);
  color: var(--text-2);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.addList:hover {
  border-color: var(--rule);
  color: var(--text);
}

@media (prefers-reduced-motion: no-preference) {
  .addCard,
  .addList {
    transition:
      border-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      transform 0.4s var(--ease);
  }
  .addList:active,
  .addCard:active {
    transform: scale(0.97);
  }
}

/* The column title as an input that reads as the heading it replaces. */
.columnTitleInput {
  flex: 1 1 auto;
  width: 100%;
  padding: 2px 6px;
  margin: -2px -6px;
  border: 0;
  border-radius: var(--r);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.columnTitleInput:hover {
  background: var(--wash);
}

.columnTitleInput:focus-visible,
.columnTitleInput:focus {
  outline: none;
  background: var(--paper);
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-ring);
}

.columnDelete {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--r);
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

/* Deleting a column is the delete action: its glyph may turn --danger. */
.columnDelete:hover {
  background: rgba(0, 0, 0, 0.06);
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
  border-radius: var(--r);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

/* The delete action: red words on the Cancel button's grey, not a red fill. */
.columnConfirmDelete {
  background: rgba(0, 0, 0, 0.05);
  color: var(--danger);
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

- [ ] **Step 4: Run, then guard and record**

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts e2e/board.spec.ts e2e/collaboration.spec.ts` — Expected: PASS (the drag-over ring test with Task 1's accent value, the peer-ring test which reads `rgb(14, 165, 233)`, and the opacity test).

Add `'components/board.module.css',` to `MIGRATED` in `apps/web/test/gallery-material.test.ts`; run `pnpm --filter @crdt/web exec vitest run test/gallery-material.test.ts` — Expected: PASS.

Append to `docs/design/gallery-handoff.md`:

```md
| T5.1 | Card peer ring | Reference `0 0 0 2px #0ea5e9, 0 4px 14px rgba(14,165,233,.18)` | `0 0 0 2px #0ea5e9` | No shadows but the float (decision 5). |
| T5.2 | Card hover | Reference: white ring plus the floating shadow | `0 0 0 1px #1c1d1b`, no lift | Spec, "Hover" (decision 2). |
| T5.3 | "+ Add a card" | Reference `#fbfbf9` on the `#fbfbf9` column | White with a hairline; hover darkens the edge | The reference's fill is invisible on its column. |
| T5.4 | Column transitions | Reference: `background .4s, box-shadow .4s` | None, as before | The held-drag test reads the drag-over ring mid-drag; the column never animated. |
| T5.5 | Column delete confirm | Code before: red fill | `--danger` text on the Cancel grey | Decision 20 (made in Task 2). |
```

- [ ] **Step 5: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add apps/web/src/components/board.module.css apps/web/e2e/gallery.spec.ts \
  apps/web/test/gallery-material.test.ts docs/design/gallery-handoff.md
git commit -m "feat(gallery): flat board columns and cards"
```

---

### Task 6: Document — the page sheet, the toolbar inside it, and the document's type

**Files:**
- Modify: `apps/web/src/components/DocumentEditor.tsx` (render; new prop `bodyClassName`)
- Modify: `apps/web/src/components/EditorToolbar.tsx` (stuck state, `data-stuck`, `tb-panel`)
- Modify: `apps/web/src/components/VersionPreview.tsx` (pass `bodyClassName` through)
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx` (pass `bodyClassName`)
- Replace: `apps/web/src/app/workspaces/[id]/documents/[docId]/document.module.css`
- Modify: `apps/web/src/components/editor-toolbar.module.css` (blocks listed in Step 6)
- Modify: `apps/web/src/app/globals.css` (the `.editor .ProseMirror` rules and the caret label)
- Modify: `apps/web/e2e/editor-toolbar.spec.ts`, `apps/web/e2e/glass-shell.spec.ts`, `apps/web/e2e/gallery.spec.ts`, `apps/web/test/gallery-material.test.ts`, `docs/design/gallery-handoff.md`

**Interfaces:**
- Consumes: Task 1 tokens; `settleAnimations`; `gallery.spec.ts` helpers; `MIGRATED`.
- Produces:
  - `DocumentEditor` prop `bodyClassName?: string`; the sheet `<div data-testid="document-page" data-width=… data-toolbar="true|false">` now contains the toolbar first, then `<div className={bodyClassName} data-testid="document-body">` holding the zoom wrapper (`document-zoom`), the heading and the editor.
  - `VersionPreview` prop `bodyClassName?: string`, passed to its `DocumentEditor`.
  - `EditorToolbar`'s `<section data-testid="tb-root">` carries `data-stuck="true|false"`; its panel is `<div data-testid="tb-panel">`.
  - `document.module.css` classes `.page`, `.body`, `.heading`, `.boardHeading`, `.titleInput`.
  - Task 7 adds to `editor-toolbar.module.css` after this task's edits; the class names `.tool`, `.menu`, `.menuList`, `.styleRow` stay.

- [ ] **Step 1: The failing document checks**

Append to `apps/web/e2e/gallery.spec.ts`:

```ts
test.describe('document', () => {
  async function openDoc(page: Page, label: string) {
    const { owner, workspace } = await seedWorkspace(label)
    const document = await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.goto(documentPath(document))
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await settleAnimations(page)
  }

  test('the page is one white sheet with the floating shadow, and the toolbar is a white bar at its top', async ({
    page,
  }) => {
    const label = `${LABEL}-doc`
    await openDoc(page, label)
    expect(await material(page.getByTestId('document-page'))).toEqual({
      background: WHITE,
      backdrop: 'none',
      shadow: FLOAT,
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    })
    expect(await material(page.getByTestId('tb-panel'))).toEqual({
      background: WHITE,
      backdrop: 'none',
      shadow: 'none',
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    })
    const root = page.getByTestId('tb-root')
    await expect(root).toHaveCSS('position', 'sticky')
    await expect(root).toHaveCSS('top', '80px')
    await expect(root).toHaveCSS('padding-top', '10px')
    await cleanup(label)
  })

  test('the open toolbar tab is a white chip in the accent; the others are plain grey', async ({ page }) => {
    const label = `${LABEL}-tbtabs`
    await openDoc(page, label)
    expect(await material(page.getByTestId('tb-tab-home'))).toMatchObject({
      background: WHITE,
      radius: '2px',
      shadow: `${HAIRLINE} 0px 0px 0px 1px`,
    })
    await expect(page.getByTestId('tb-tab-home')).toHaveCSS('color', await resolveColour(page, 'var(--accent)'))
    await expect(page.getByTestId('tb-tab-home')).toHaveCSS('font-weight', '600')
    await expect(page.getByTestId('tb-tab-insert')).toHaveCSS('color', 'rgb(95, 98, 93)')
    await expect(page.getByTestId('tb-tab-insert')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await cleanup(label)
  })

  test('the toolbar takes the floating shadow only while it is stuck', async ({ page }) => {
    const label = `${LABEL}-stuck`
    await page.setViewportSize({ width: 1280, height: 420 })
    await openDoc(page, label)
    const root = page.getByTestId('tb-root')
    const shadow = () => page.getByTestId('tb-panel').evaluate((el) => getComputedStyle(el).boxShadow)
    await expect(root).toHaveAttribute('data-stuck', 'false')
    expect(await shadow()).toBe('none')

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(root).toHaveAttribute('data-stuck', 'true')
    await expect.poll(shadow).toBe(FLOAT)

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(root).toHaveAttribute('data-stuck', 'false')
    await expect.poll(shadow).toBe('none')
    await cleanup(label)
  })
})
```

- [ ] **Step 2: Update the existing document tests (they will fail until Step 7)**

In `apps/web/e2e/editor-toolbar.spec.ts`:

(a) Replace the whole test `'the toolbar sits above the document sheet, not inside it'` with:

```ts
test('the toolbar sits inside the document sheet, at its top, inset 10px', async ({ page }) => {
  await openDocument(page, `${LABEL}-above`)
  await settled(page)

  // A child of the sheet, ahead of the text (spec, "Document toolbar": by default the bar
  // sits inside the page sheet).
  expect(
    await page.getByTestId('tb-root').evaluate((el) => el.parentElement?.dataset.testid),
  ).toBe('document-page')
  const sheet = (await page.getByTestId('document-page').boundingBox())!
  const panel = (await page.getByTestId('tb-panel').boundingBox())!
  // The sheet's 1px border plus the 10px inset, on the top and on both sides.
  expect(panel.y - sheet.y).toBeCloseTo(11, 0)
  expect(panel.x - sheet.x).toBeCloseTo(11, 0)
  expect(sheet.x + sheet.width - (panel.x + panel.width)).toBeCloseTo(11, 0)
  // And the text comes after it, in the same sheet.
  const body = (await page.getByTestId('document-body').boundingBox())!
  expect(body.y).toBeGreaterThanOrEqual(panel.y + panel.height)
})
```

(b) In `'hovering an active toggle keeps its accent fill'`, change the comment "An unpressed button turns white on hover;" to "An unpressed button takes the wash on hover;" and the last line to

```ts
  await expect.poll(() => fill('italic')).toBe('rgba(40, 40, 60, 0.06)')
```

(c) Replace the whole test `'a menu blurs the page behind it: no ancestor of its panel is a backdrop root'` with (the spec removes blur, which is what the old test was about; this checks what replaces it):

```ts
test('a menu is a flat white panel with the floating shadow, and nothing above it blurs', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-backdrop`)
  await prose(page).click()

  for (const id of ['style', 'color', 'highlight'] as const) {
    await openMenu(page, id)
    const found = await tb(page, `${id}-menu`).evaluate((menu) => {
      const blurred: string[] = []
      for (let el: Element | null = menu; el; el = el.parentElement) {
        if (getComputedStyle(el).backdropFilter !== 'none') blurred.push(el.className || el.tagName)
      }
      const style = getComputedStyle(menu)
      return {
        blurred,
        background: style.backgroundColor,
        shadow: style.boxShadow,
        radius: style.borderTopLeftRadius,
        border: style.borderTopColor,
      }
    })
    expect(found, `${id} menu`).toEqual({
      blurred: [],
      background: 'rgb(255, 255, 255)',
      shadow: 'rgba(0, 0, 0, 0.25) 0px 24px 48px -28px',
      radius: '2px',
      border: 'rgb(228, 228, 224)',
    })
    await page.keyboard.press('Escape')
  }
})
```

(d) Replace the whole test `'the Link popover blurs the page behind it: no ancestor is a backdrop root'` with:

```ts
test('the Link popover is a flat white panel with the floating shadow, and nothing above it blurs', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-backdrop`)
  await prose(page).click()
  await openInsert(page)
  await openLink(page)
  const found = await tb(page, 'insert-link-menu').evaluate((menu) => {
    const blurred: string[] = []
    for (let el: Element | null = menu; el; el = el.parentElement) {
      if (getComputedStyle(el).backdropFilter !== 'none') blurred.push(el.className || el.tagName)
    }
    const style = getComputedStyle(menu)
    return { blurred, background: style.backgroundColor, shadow: style.boxShadow, radius: style.borderTopLeftRadius }
  })
  expect(found).toEqual({
    blurred: [],
    background: 'rgb(255, 255, 255)',
    shadow: 'rgba(0, 0, 0, 0.25) 0px 24px 48px -28px',
    radius: '2px',
  })
})
```

(e) In `'headings, paragraphs, quote, code, lists and rule carry 12.7’s values'`, replace the h3 comment and assertion, the paragraph comment and assertion, the quote's border colour and the code block's radius:

```ts
  // h3 is 17px, level with the 17px body (spec, "Document headings and body"; the reference's h3).
  expect(await computed(page, 'h3', ['font-size', 'font-weight', 'line-height', 'margin-top', 'margin-bottom', 'color'])).toEqual({
    'font-size': '17px', 'font-weight': '600', 'line-height': '22.95px', 'margin-top': '22px', 'margin-bottom': '8px', color: text,
  })

  // The body is 17px with a 1.65 line-height (spec, "Document headings and body").
  expect(await computed(page, 'p', ['font-size', 'line-height', 'margin-bottom'])).toEqual({
    'font-size': '17px', 'line-height': '28.05px', 'margin-bottom': '14px',
  })
```

```ts
    'border-left-color': await resolveColour(page, 'oklch(0.5 0.17 290 / .35)'), color: muted,
```

```ts
    'margin-bottom': '14px', 'padding-top': '14px', 'padding-left': '16px', 'border-top-left-radius': '2px',
```

(f) In `'a table and its cells carry 12.7’s values, …'`, change `'border-top-left-radius': '12px'` to `'border-top-left-radius': '2px'`.

(g) Rename `'the sheet keeps 28px above it, and its text is 18px'` to `'the sheet keeps 28px above it, and its text is 17px'` and change its `'18px'` to `'17px'`.

In `apps/web/e2e/glass-shell.spec.ts`, test `'a document sits on the 780px glass sheet and a board does not'`: rename it `'a document sits on the 780px sheet and a board does not'`, and replace

```ts
  expect(sheet!.radius).toBe('30px')
  expect(sheet!.paddingTop).toBe('56px')
  expect(sheet!.paddingBottom).toBe('96px')
  expect(sheet!.width).toBeLessThanOrEqual(780)
```

with

```ts
  expect(sheet!.radius).toBe('2px')
  // The toolbar now sits inside the sheet, so the sheet has no padding of its own; the body
  // under the toolbar carries the text's 40 / 56 / 96 (the reference's sheet padding).
  expect(sheet!.paddingTop).toBe('0px')
  expect(sheet!.paddingBottom).toBe('0px')
  expect(sheet!.width).toBeLessThanOrEqual(780)
  const body = page.getByTestId('document-body')
  await expect(body).toHaveCSS('padding-top', '40px')
  await expect(body).toHaveCSS('padding-left', '56px')
  await expect(body).toHaveCSS('padding-bottom', '96px')
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts -g "document"` — Expected: FAIL (glass sheet, toolbar outside it, no `tb-panel`).
Run: `pnpm --filter @crdt/web exec playwright test e2e/editor-toolbar.spec.ts e2e/glass-shell.spec.ts -g "inside the document sheet|hovering an active|flat white panel|12.7|17px|780px sheet"` — Expected: FAIL.

- [ ] **Step 4: The toolbar moves into the sheet**

In `apps/web/src/components/DocumentEditor.tsx`:
- add to `DocumentEditorProps`, after `sheetClassName`:
  ```ts
  /** The padding box under the toolbar, inside the sheet. Its styles live with the page too. */
  bodyClassName?: string
  ```
- add `bodyClassName,` to the destructured props after `sheetClassName,`;
- replace the component's doc comment's first paragraph with: "The document surface: the page sheet, with the toolbar sticky at its top (spec, "Document toolbar": by default the bar sits inside the page sheet) and the text under it.";
- replace the whole `return ( … )` with:

```tsx
  return (
    // data-width, not a second class: the sheet's stylesheet owns what each width is.
    // data-toolbar lets it give the body less top padding under the toolbar (40px) than
    // without one (56px, a read-only preview), as the reference does.
    <div
      className={sheetClassName}
      data-testid="document-page"
      data-width={pageWidth}
      data-toolbar={toolbar ? 'true' : 'false'}
    >
      {toolbar && (
        <EditorToolbar
          editor={editor}
          // Home and Insert need an editor that is bound: for one effect the editor is
          // unbound, non-editable and without the Collaboration extension, so it has no
          // undo, and a click on Undo there throws. View does not depend on this.
          editable={editor?.isEditable === true}
          readOnly={readOnly}
          view={{ zoom, onZoom: setZoom, pageWidth, onPageWidth: setPageWidth }}
        />
      )}
      <div className={bodyClassName} data-testid="document-body">
        {/* CSS zoom wraps the title as well as the editor (handoff 12.4, resolved against
            the prototype: it zooms a div that contains the document's h1, so the title
            scales with the body). Zooming only `.editor` left a 32px title over 12.6px
            text at 70%. A percentage string: it is unambiguous as a CSS value.

            Verified in Chromium 153 only. The exposure is not the remote carets (inline
            widget spans, they scale with the text anywhere) but ProseMirror's own
            posAtCoords/coordsAtPos, which drive clicks, drag selection and scroll-into-view
            and which Chrome older than 128, and possibly Safari, report unzoomed. */}
        <div data-testid="document-zoom" style={{ zoom: `${zoom}%` }}>
          {heading}
          <EditorContent editor={editor} className="editor" />
        </div>
      </div>
    </div>
  )
```

In `apps/web/src/components/VersionPreview.tsx`, add `bodyClassName,` after `sheetClassName,` in the destructured props, `bodyClassName?: string` after `sheetClassName?: string` in the props type, and `bodyClassName={bodyClassName}` after `sheetClassName={sheetClassName}` on its `<DocumentEditor>`.

In `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx`, add `bodyClassName={styles.body}` after `sheetClassName={styles.page}` on both the `<DocumentEditor>` and the `<VersionPreview>`, and change the comment above `const live =` to:

```tsx
  // The toolbar sits inside the sheet, at its top (spec, "Document toolbar"), so the editor
  // cannot sit inside a wrapper rendered here: DocumentEditor renders the sheet, the toolbar
  // and the body, and takes the sheet's classes and the heading so they are still styled and
  // titled from here.
```

- [ ] **Step 5: The toolbar knows when it is stuck**

In `apps/web/src/components/EditorToolbar.tsx`:
- change the React import to `import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'`;
- add above `interface EditorToolbarProps`:

```ts
/**
 * Whether the sticky toolbar has left its place at the top of the sheet. At rest its top is
 * the sheet's top plus the sheet's 1px border; the gap grows past 2px only while the page
 * scrolls the sheet up under it. Read on scroll and resize, at most once a frame.
 */
function useStuck(root: RefObject<HTMLElement | null>): boolean {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const element = root.current
    const sheet = element?.parentElement
    if (!element || !sheet) return
    let frame = 0
    const read = () => {
      frame = 0
      setStuck(element.getBoundingClientRect().top - sheet.getBoundingClientRect().top > 2)
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [root])
  return stuck
}
```

- change the component's doc comment to: "The Word-style ribbon, sticky at the top of the page sheet (spec, "Document toolbar"). Row 1 holds the tabs, a "View only" chip for viewers and the word count; row 2 holds the open tab's tools. It takes the floating shadow while stuck.";
- inside `EditorToolbar`, after `const lastColours = useLastColours()`, add:

```ts
  const root = useRef<HTMLElement>(null)
  const stuck = useStuck(root)
```

- change the opening `<section …>` to:

```tsx
    <section
      ref={root}
      className={styles.root}
      aria-label="Document toolbar"
      data-testid="tb-root"
      data-stuck={stuck}
      // The bounds of "outside the toolbar" for a menu's click-away close.
      {...MENU_SCOPE}
    >
      <div className={styles.panel} data-testid="tb-panel">
```

(the old `<div className={styles.panel}>` line is replaced by the last line above).

- [ ] **Step 6: The sheet's and the toolbar's styles**

Replace `apps/web/src/app/workspaces/[id]/documents/[docId]/document.module.css` with:

```css
/*
  The page sheet (spec, "Material"): solid white, a hairline, 2px corners, and the floating
  shadow a sheet has (decision 15). The toolbar sits inside it, at its top; .body carries
  the text's padding under it.
*/
.page {
  max-width: 780px;
  /* 28px below the nav, per the design owner's review: the sheet was touching the
     bottom of the bar. */
  margin: 28px auto 64px;
  border-radius: var(--r);
  background: var(--paper);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-float);
}

/* The View tab's Wide. Narrow is the 780px above. */
.page[data-width='wide'] {
  max-width: 1040px;
}

/* The sheet widens and narrows over .55s rather than jumping. Reduced motion gets the jump. */
@media (prefers-reduced-motion: no-preference) {
  .page {
    transition: max-width var(--dur) var(--ease);
  }
}

/* The text's padding: 56 / 56 / 96 without a toolbar (a read-only preview), 40 on top under
   the toolbar (the reference's sheet padding in both cases). */
.body {
  padding: 56px 56px 96px;
}

.page[data-toolbar='true'] > .body {
  padding-top: 40px;
}

/*
  The document's own title. Size, weight and letter-spacing come from the global h1
  rule, which already carries the design's 32px / 600 / -0.025em, so they are not
  repeated here; only the measure-specific bits are.
*/
.heading {
  margin: 0 0 20px;
  line-height: 1.2;
  text-wrap: pretty;
}

/* A board's title: smaller than a document's, above the columns, on a 1000px measure. */
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
  border-radius: var(--r);
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

In `apps/web/src/components/editor-toolbar.module.css` make these replacements:

1. Replace everything from the top of the file through the end of the `.panel::before { … }` rule (the header comment, `.root`, its media block, `.panel` and `.panel::before`) with:

```css
/*
  The ribbon (spec, "Document toolbar"): inside the page sheet, sticky 80px from the top
  (12px under the nav, following it as it condenses), inset 10px from the sheet's edges.
  A white bar with a hairline; the floating shadow only while stuck (EditorToolbar sets
  data-stuck). The floating placement above the sheet is the reference's alternative and is
  not built.
*/

.root {
  position: sticky;
  top: calc(var(--nav-bottom, 68px) + 12px);
  z-index: 20;
  padding: 10px 10px 0;
}

@media (prefers-reduced-motion: no-preference) {
  .root {
    animation: global(g-fade) 0.4s var(--ease);
    transition: top 0.4s var(--ease);
  }
}

.panel {
  border-radius: var(--r);
  background: var(--paper);
  border: 1px solid var(--hairline);
}

.root[data-stuck='true'] .panel {
  box-shadow: var(--shadow-float);
}

@media (prefers-reduced-motion: no-preference) {
  .panel {
    transition: box-shadow var(--dur-fast) var(--ease);
  }
}
```

2. In `.tab`, `border-radius: var(--r-pill);` → `border-radius: var(--r);`.
3. Replace `.tabActive { … }` with:

```css
/* The open tab: a white chip in the accent (spec). On the white bar it needs an edge, and
   Gallery has no small shadows, so the edge is a hairline ring. */
.tabActive {
  background: var(--paper);
  box-shadow: 0 0 0 1px var(--hairline);
  color: var(--accent);
  font-weight: 600;
}
```

4. In `.viewOnly`, `border-radius: var(--r-pill);` → `border-radius: var(--r);`.
5. In `.tool`, `border-radius: var(--r-tool);` → `border-radius: var(--r);`.
6. Replace the `.tool:hover:not(.toolActive):not([aria-expanded='true']):not([aria-disabled='true'])` rule with:

```css
.tool:hover:not(.toolActive):not([aria-expanded='true']):not([aria-disabled='true']) {
  /* The wash, not the reference's #fff, which is invisible on the white bar. Not applied to
     an active toggle: the pointer is on the button the moment it is pressed, so a hover
     fill that beat the active one would hide the toggle's new state. */
  background: var(--wash);
}
```

7. In `.toolField`, replace the comment and `background: rgba(255, 255, 255, 0.8);` with `background: var(--paper);`.
8. In `.toolField:hover:not(.toolActive):not([aria-expanded='true'])` and in `.tool.toolField[aria-expanded='true']`, `background: #fff;` → `background: var(--paper);` (the field stays white on hover; the `.tool` wash must not reach it).
9. Replace `.menu { … }` (not its media block) with:

```css
/* The panel: one container for every toolbar menu. A floating menu: white, a hairline,
   the floating shadow. */
.menu {
  position: absolute;
  left: 0;
  top: 40px;
  z-index: 5;
  padding: 8px;
  border-radius: var(--r);
  background: var(--paper);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-float);
  transform-origin: top left;
}
```

10. In `.styleRow`, `border-radius: var(--r-item);` → `border-radius: var(--r);`; in `.styleRow:hover`, `background: rgba(40, 40, 60, 0.06);` → `background: var(--wash);`.
11. In `.colourBar`, `border-radius: 2px;` → `border-radius: var(--r);`.
12. In `.linkInput`, `border-radius: var(--r-pill);` → `border-radius: var(--r);` and `background: #fff;` → `background: var(--paper);` (delete its "White pill" comment).
13. In `.linkAdd, .linkRemove`, `border-radius: var(--r-pill);` → `border-radius: var(--r);`; in `.linkRemove`, `background: rgba(40, 40, 60, 0.06);` → `background: var(--wash);`.
14. In `.segmented` and `.segment`, `border-radius: var(--r-pill);` → `border-radius: var(--r);`.
15. Replace `.segmentOn { … }` with:

```css
/* The chosen width: white on the grey track. No shadow (Gallery has no small shadows). */
.segmentOn {
  background: var(--paper);
}
```

- [ ] **Step 7: The document's type and the remote caret**

In `apps/web/src/app/globals.css`:

1. Replace the comment block that starts `/* Tiptap editor surface. Typography follows the Glass document spec` with:

```css
/* Tiptap editor surface. Typography follows the spec's "Document headings and body": H1 32px
   600 -0.025em, H2 21px 600, body 17px / 1.65; the rest from glass-handoff.md 12.7's element
   table. The page sheet (document.module.css) supplies the padding.

   Literal values below are the reference's: rgba(40,40,60,.14), .1 and .05 and a 35% accent,
   none of which is a token. */
```

2. Replace the h3 comment and rule with:

```css
/* 17px, level with the body: the design marks a subheading by weight, colour (--text
   against --text-2) and its 22px top margin, never by size. */
.editor .ProseMirror h3 {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  margin: 22px 0 8px;
  color: var(--text);
}
```

3. Replace the paragraph rule with:

```css
.editor .ProseMirror p {
  /* 17px / 1.65 (spec, "Document headings and body"). */
  font-size: 17px;
  line-height: 1.65;
  color: var(--text-2);
  margin: 0 0 14px;
}
```

4. In `.editor .ProseMirror blockquote`, `border-left: 3px solid oklch(0.42 0.11 285 / 0.35);` → `border-left: 3px solid oklch(0.5 0.17 290 / 0.35);` (the accent at 35%).
5. In `.editor .ProseMirror pre`, `border-radius: 14px;` → `border-radius: var(--r);`.
6. In `.editor .ProseMirror table`, `border-radius: var(--r-item);` → `border-radius: var(--r);`.
7. In the table-cell paragraph comment, "At 18px it would be bigger" → "At 17px it would be bigger".
8. In `.collaboration-carets__label`, `border-radius: var(--r-pill);` → `border-radius: var(--r);`, and delete the line `box-shadow: 0 4px 10px rgba(30, 45, 40, 0.18);` (no shadows; the reference's caret label has none).

- [ ] **Step 8: Run them and watch them pass; guard and record**

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts e2e/editor-toolbar.spec.ts e2e/glass-shell.spec.ts e2e/history.spec.ts`
Expected: PASS, including "the toolbar follows the nav up to 64px from the top while the page scrolls" (unchanged: `tb-root` is the sticky box), "Narrow and Wide set the sheet to 780px and 1040px", the zoom tests, and the history preview tests (a preview renders the sheet with `data-toolbar="false"` and 56px on top).

Add `'app/workspaces/[id]/documents/[docId]/document.module.css',` and `'components/editor-toolbar.module.css',` to `MIGRATED`; run `pnpm --filter @crdt/web exec vitest run test/gallery-material.test.ts test/no-red.test.ts test/css-motion.test.ts` — Expected: PASS.

Append to `docs/design/gallery-handoff.md`:

```md
| T6.1 | Toolbar when stuck | Reference `inset 0 1px 0 #fff, 0 1px 2px rgba(30,30,50,.05), 0 8px 22px rgba(30,30,50,.12)`; border `rgba(40,40,60,.08)` | `var(--shadow-float)`; `1px solid var(--hairline)` | The spec: "hairline border", "the floating shadow" (decision 9). |
| T6.2 | Toolbar's open tab | Reference: white chip, `0 1px 3px rgba(30,30,50,.12)` | White chip with a `0 0 0 1px` hairline ring | No small shadows; a white chip on a white bar needs an edge (decision 10). |
| T6.3 | Tool hover | Reference `#fff` on the white bar | `--wash` | Invisible otherwise (decision 17). |
| T6.4 | Sticky top | Reference `top:80px` fixed | `calc(var(--nav-bottom) + 12px)`: 80px at rest, 64px when the nav condenses | Existing motion is kept (decision 18). |
| T6.5 | Toolbar entrance | Code before `g-pop .6s` (floating) | `g-fade .4s`, the reference's for the in-sheet bar | Decision 19. |
| T6.6 | Page sheet shadow | Spec lists "sheets" | The page sheet has the floating shadow, as the reference draws it | The spec calls it "the page sheet" (decision 15, question 4). |
| T6.7 | Narrow/Wide segment | Reference: white with `0 1px 3px` | White on the grey track, no shadow | Decision 10. |
| T6.8 | Remote caret label | Code before `0 4px 10px` shadow, pill | No shadow, 2px corners | No shadows; the reference's label has none. |
| T6.9 | Document h3 | Code before 18px (level with the 18px body) | 17px | Moves with the 17px body; the reference's 17px. |
```

- [ ] **Step 9: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add apps/web/src/components/DocumentEditor.tsx apps/web/src/components/EditorToolbar.tsx \
  apps/web/src/components/VersionPreview.tsx \
  "apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx" \
  "apps/web/src/app/workspaces/[id]/documents/[docId]/document.module.css" \
  apps/web/src/components/editor-toolbar.module.css apps/web/src/app/globals.css \
  apps/web/e2e/editor-toolbar.spec.ts apps/web/e2e/glass-shell.spec.ts apps/web/e2e/gallery.spec.ts \
  apps/web/test/gallery-material.test.ts docs/design/gallery-handoff.md
git commit -m "feat(gallery): the document sheet with its toolbar inside, and 17px reading text"
```

---

### Task 7: Document — alignment becomes one dropdown

**Files:**
- Modify: `apps/web/src/components/EditorMenu.tsx` (`MenuName`, new prop `panelClassName`)
- Modify: `apps/web/src/components/HomeMenus.tsx` (new `AlignMenu`, `ALIGNMENTS`, `Alignment`)
- Modify: `apps/web/src/components/HomeTools.tsx` (use `AlignMenu`)
- Modify: `apps/web/src/components/editor-toolbar.module.css` (append the alignment rules)
- Modify: `apps/web/e2e/editor-toolbar.spec.ts`, `docs/design/gallery-handoff.md`

**Interfaces:**
- Consumes: `EditorMenu`, `MenuItem`, `MenuControl`, `useMenuGroup` (`EditorMenu.tsx`); `ToolButton`'s `.tool svg` rule; Task 6's `editor-toolbar.module.css` (`.menuList` sets `width: 240px; padding: 6px`).
- Produces:
  - `export type Alignment = 'left' | 'center' | 'right' | 'justify'` and `export const ALIGNMENTS: readonly { id: Alignment; label: string; path: string }[]` in `HomeMenus.tsx` (moved from `HomeTools.tsx`).
  - `export function AlignMenu({ editor, control, current }: { editor: Editor; control: MenuControl; current: Alignment })` in `HomeMenus.tsx`.
  - `MenuName` now `'style' | 'color' | 'highlight' | 'insert-link' | 'align'`.
  - `EditorMenu` prop `panelClassName?: string`, appended to the panel's classes.
  - Test ids: trigger `tb-align` (`aria-haspopup="listbox"`, `aria-label="Alignment: <current label>"`), panel `tb-align-menu`, options `tb-align-left`, `tb-align-center`, `tb-align-right`, `tb-align-justify` (`role="option"`, `aria-selected`). The four ids are kept; they move from the row into the menu.

- [ ] **Step 1: Update and add the alignment tests (they fail until Step 3)**

In `apps/web/e2e/editor-toolbar.spec.ts`:

(a) Widen `openMenu`'s parameter: `async function openMenu(page: Page, id: 'style' | 'color' | 'highlight' | 'align')`.

(b) Replace the whole test `'each alignment sets the paragraph and marks itself, and only itself, active'` with:

```ts
test('each alignment sets the paragraph and marks itself, and only itself, active', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-align`)
  await prose(page).click()
  await page.keyboard.type('aligned')
  const ids = ['left', 'center', 'right', 'justify'] as const

  // An untouched paragraph is left-aligned, and the dropdown says so.
  await openMenu(page, 'align')
  await expect(tb(page, 'align-left')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')

  for (const id of [...ids].reverse()) {
    await openMenu(page, 'align')
    await tb(page, `align-${id}`).click()
    // Choosing closes the menu.
    await expect(tb(page, 'align-menu')).toHaveCount(0)
    await expect(prose(page).locator('p').first()).toHaveCSS('text-align', id)
    await openMenu(page, 'align')
    for (const other of ids) {
      await expect(tb(page, `align-${other}`)).toHaveAttribute(
        'aria-selected',
        other === id ? 'true' : 'false',
      )
    }
    await page.keyboard.press('Escape')
  }
})
```

(c) In `'clear formatting removes the marks and returns the block to a paragraph'`, replace `await tb(page, 'align-center').click()` with:

```ts
  await openMenu(page, 'align')
  await tb(page, 'align-center').click()
```

(d) In `'formatting made in one browser appears in the other'`, replace `await tb(a.page, 'align-center').click()` with:

```ts
  await openMenu(a.page, 'align')
  await tb(a.page, 'align-center').click()
```

(e) In `'the tool row is one Tab stop, and the arrow keys move within it'`, replace its last four lines (from the comment "And Enter on a focused tool presses it" to the end of the test body) with:

```ts
  // And Enter on a focused tool presses it: the keyboard path works, not only the mouse.
  // Left of Clear is the Alignment dropdown; Enter opens it on the current choice.
  await page.keyboard.press('ArrowLeft')
  await expect(tb(page, 'align')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(tb(page, 'align-left')).toBeFocused()
  await page.keyboard.press('End')
  await expect(tb(page, 'align-justify')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(tb(page, 'align-menu')).toHaveCount(0)
  await expect(tb(page, 'align')).toBeFocused()
  await expect(prose(page).locator('p').first()).toHaveCSS('text-align', 'justify')
```

(f) Add after that test:

```ts
test('alignment is one dropdown: the four choices live in its menu, not in the row', async ({ page }) => {
  await openDocument(page, `${LABEL}-align-menu`)
  await prose(page).click()

  const trigger = tb(page, 'align')
  await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
  await expect(trigger).toHaveAttribute('aria-label', 'Alignment: Align left')
  for (const id of ['left', 'center', 'right', 'justify']) {
    await expect(tb(page, `align-${id}`)).toHaveCount(0)
  }

  await openMenu(page, 'align')
  await expect(tb(page, 'align-menu').getByRole('option')).toHaveCount(4)
  expect((await tb(page, 'align-menu').boundingBox())!.width).toBeCloseTo(170, 0)
  await tb(page, 'align-center').click()
  await expect(trigger).toHaveAttribute('aria-label', 'Alignment: Center')
})
```

Run: `pnpm --filter @crdt/web exec playwright test e2e/editor-toolbar.spec.ts -g "alignment|clear formatting removes|one Tab stop|formatting made in one browser"`
Expected: FAIL (no `tb-align` trigger).

- [ ] **Step 2: The menu shell takes a name and a panel class**

In `apps/web/src/components/EditorMenu.tsx`:
- `export type MenuName = 'style' | 'color' | 'highlight' | 'insert-link'` → `export type MenuName = 'style' | 'color' | 'highlight' | 'insert-link' | 'align'`;
- add to `EditorMenuProps`, after `restoreTo?`:
  ```ts
  /** Extra classes for the panel, for a menu whose size differs from its variant's. */
  panelClassName?: string
  ```
- add `panelClassName,` to the destructured props after `restoreTo,`;
- change the panel's `className` to append it:

```tsx
            className={`${styles.menu} ${
              variant === 'list'
                ? styles.menuList
                : variant === 'popover'
                  ? styles.menuPopover
                  : styles.menuSwatches
            } ${panelClassName ?? ''}`}
```

- [ ] **Step 3: `AlignMenu`, and the Home row uses it**

Append to `apps/web/src/components/HomeMenus.tsx`:

```tsx
// ---------------------------------------------------------------------------
// Alignment (spec, "Document toolbar": the alignment controls are one dropdown)
// ---------------------------------------------------------------------------

export type Alignment = 'left' | 'center' | 'right' | 'justify'

export const ALIGNMENTS: readonly { id: Alignment; label: string; path: string }[] = [
  { id: 'left', label: 'Align left', path: 'M2 3.5h12M2 6.5h8M2 9.5h12M2 12.5h8' },
  { id: 'center', label: 'Center', path: 'M2 3.5h12M4 6.5h8M2 9.5h12M4 12.5h8' },
  { id: 'right', label: 'Align right', path: 'M2 3.5h12M6 6.5h8M2 9.5h12M6 12.5h8' },
  { id: 'justify', label: 'Justify', path: 'M2 3.5h12M2 6.5h12M2 9.5h12M2 12.5h12' },
]

/**
 * One trigger showing the current alignment, and a 170px list of the four. A listbox like
 * the Style menu: the arrows move through it, Enter chooses, Esc closes. Choosing sets the
 * alignment rather than toggling it: pressing the one already chosen must not silently
 * revert to the default.
 */
export function AlignMenu({
  editor,
  control,
  current,
}: {
  editor: Editor
  control: MenuControl
  current: Alignment
}) {
  const shown = ALIGNMENTS.find((entry) => entry.id === current) ?? ALIGNMENTS[0]!
  return (
    <EditorMenu
      name="align"
      control={control}
      variant="list"
      label={`Alignment: ${shown.label}`}
      title="Alignment"
      menuLabel="Alignment"
      panelClassName={styles.menuAlign}
      trigger={
        <>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d={shown.path} />
          </svg>
          <span className={styles.alignCaret} aria-hidden="true">
            ▼
          </span>
        </>
      }
    >
      {ALIGNMENTS.map((entry) => (
        <MenuItem
          key={entry.id}
          role="option"
          selected={current === entry.id}
          label={entry.label}
          className={styles.alignRow}
          data-testid={`tb-align-${entry.id}`}
          onChoose={() => editor.chain().setTextAlign(entry.id).run()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d={entry.path} />
          </svg>
          <span>{entry.label}</span>
        </MenuItem>
      ))}
    </EditorMenu>
  )
}
```

In `apps/web/src/components/HomeTools.tsx`:
- delete `type Alignment = …` and the `ALIGNMENTS` constant;
- change the `./HomeMenus` import to

```ts
import {
  AlignMenu,
  ColourMenu,
  HighlightMenu,
  StyleMenu,
  readBlockStyle,
  type Alignment,
  type BlockReading,
  type LastColours,
} from './HomeMenus'
```

- replace the `{ALIGNMENTS.map((entry) => ( <ToolButton … /> ))}` block with

```tsx
      <AlignMenu editor={editor} control={menu('align')} current={format.align} />
```

(the `<ToolSeparator />` before and after it stay; `menu` is the existing `useMenuGroup()` result, so opening Alignment closes Style, colour or highlight).

- update the doc comment's list "lists, alignment and clear formatting" to "lists, the alignment dropdown and clear formatting", and "The three menus" to "The four menus".

- [ ] **Step 4: The dropdown's styles**

Append to `apps/web/src/components/editor-toolbar.module.css` (after everything else, so `.menuAlign` wins over `.menuList` at equal specificity):

```css
/* The Alignment dropdown (spec, "Document toolbar"): a trigger with the current alignment's
   icon and a small caret, and a 170px list of the four, each with its icon. */
.alignCaret {
  font-size: 8px;
  opacity: 0.6;
}

.menuAlign {
  width: 170px;
  padding: 6px;
}

.alignRow {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: var(--r);
  background: transparent;
  color: var(--text-2);
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}

.alignRow:hover {
  background: var(--wash);
}

/* The current alignment reads as pressed, as the tool buttons do. */
.alignRow[aria-selected='true'] {
  background: var(--accent-soft);
  color: var(--accent);
}

.alignRow svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (prefers-reduced-motion: no-preference) {
  .alignRow {
    transition: background 0.2s var(--ease);
  }
}
```

- [ ] **Step 5: Run them and watch them pass; record**

Run: `pnpm --filter @crdt/web exec playwright test e2e/editor-toolbar.spec.ts` — Expected: PASS (all of it: the Style, colour and highlight menu tests share the shell and must not change).
Run: `pnpm --filter @crdt/web exec vitest run test/gallery-material.test.ts test/css-motion.test.ts test/tool-button.test.ts` — Expected: PASS.

Append to `docs/design/gallery-handoff.md`:

```md
| T7.1 | Alignment | Code before: four buttons in the Home row | One dropdown (`tb-align`), a 170px listbox of the four; the four test ids move into it | The spec: "grouped into one dropdown"; values from the reference's align menu. |
```

- [ ] **Step 6: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add apps/web/src/components/EditorMenu.tsx apps/web/src/components/HomeMenus.tsx \
  apps/web/src/components/HomeTools.tsx apps/web/src/components/editor-toolbar.module.css \
  apps/web/e2e/editor-toolbar.spec.ts docs/design/gallery-handoff.md
git commit -m "feat(gallery): alignment is one dropdown in the toolbar"
```

---

### Task 8: Workspace overview, and the shared tile primitives

**Files:**
- Replace: `apps/web/src/components/ui/ui.module.css`
- Replace: `apps/web/src/app/workspaces/[id]/workspace.module.css`
- Modify: `apps/web/src/app/workspaces/[id]/page.tsx`, `apps/web/src/components/DocumentTile.tsx`, `apps/web/src/app/page.tsx` (one class name)
- Modify: `apps/web/e2e/glass-shell.spec.ts`, `apps/web/e2e/gallery.spec.ts`, `apps/web/test/gallery-material.test.ts`, `docs/design/gallery-handoff.md`

**Interfaces:**
- Consumes: Task 1 tokens; Task 2's `.error` and `.danger:hover`; Task 4's `.button`, `.accent`, `.plainButton`, `.chip` (all restated in the file below); `gallery.spec.ts` helpers; `MIGRATED`.
- Produces, in `ui.module.css`: `.surface` (renamed from `.glass`: white with a hairline), `.pageTitle` (52px / 600 / −0.04em / 1.02, used by Task 9 too), `.metaPill` (renamed from `.bgPill`), and the flat `.tile`, `.tileCreate`, `.pillInput`, `.chip`, `.chipAccent`, `.segmented`, `.segment`, `.segmentOn`, `.error`. In `workspace.module.css`: `.sectionHeading`. Every class `TextField`, `Button`, `CreateDocumentForm`, `CreateWorkspaceForm`, `ShareSheet` and the auth pages read from `ui.module.css` keeps its name (`button`, `accent`, `plainButton`, `ghost`, `danger`, `field`, `label`, `labelHidden`, `pillInput`, `tile`, `tileCreate`, `chip`, `chipAccent`, `segmented`, `segment`, `segmentInput`, `segmentOn`, `error`).

- [ ] **Step 1: The failing overview checks**

Append to `apps/web/e2e/gallery.spec.ts`:

```ts
test.describe('workspace overview', () => {
  async function openOverview(page: Page, label: string) {
    const { owner, workspace } = await seedWorkspace(label)
    const document = await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.goto(`/workspaces/${workspace.id}`)
    await settleAnimations(page)
    return { workspace, document }
  }

  test('the workspace name is a 52px title; Documents and People are small capitals under a dark rule', async ({
    page,
  }) => {
    const label = `${LABEL}-overview-type`
    await openOverview(page, label)
    const title = page.getByRole('heading', { level: 1 })
    await expect(title).toHaveCSS('font-size', '52px')
    await expect(title).toHaveCSS('font-weight', '600')
    await expect(title).toHaveCSS('letter-spacing', '-2.08px')
    await expect(title).toHaveCSS('line-height', '53.04px')
    for (const name of ['Documents', 'People']) {
      const heading = page.getByRole('heading', { level: 2, name })
      await expect(heading).toHaveCSS('font-size', '12px')
      await expect(heading).toHaveCSS('font-weight', '600')
      await expect(heading).toHaveCSS('text-transform', 'uppercase')
      await expect(heading).toHaveCSS('letter-spacing', '1.2px')
      await expect(heading).toHaveCSS('padding-top', '10px')
      await expect(heading).toHaveCSS('border-top', `1px solid ${RULE}`)
    }
    await cleanup(label)
  })

  test('the meta pill, the tiles and the People card are white with a hairline; the create tile is dashed', async ({
    page,
  }) => {
    const label = `${LABEL}-overview-material`
    const { document } = await openOverview(page, label)
    const flat = {
      background: WHITE,
      backdrop: 'none',
      shadow: 'none',
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    }
    expect(await material(page.getByText(/1 document · 1 person/))).toEqual(flat)
    expect(await material(page.getByTestId(`document-${document.id}`))).toEqual(flat)
    expect(await material(page.locator('[class*="people"]').first())).toEqual(flat)
    const kind = page.getByTestId('document-kind')
    await expect(kind).toHaveCSS('background-color', await resolveColour(page, 'var(--accent-tint)'))
    await expect(kind).toHaveCSS('border-top-left-radius', '2px')
    const create = page.locator('[class*="tileCreate"]')
    await expect(create).toHaveCSS('border-top-style', 'dashed')
    expect(await material(create)).toMatchObject({ background: WHITE, radius: '2px', shadow: 'none', backdrop: 'none' })
    await cleanup(label)
  })

  test('a hovered tile does not lift; its edge turns dark', async ({ page }) => {
    const label = `${LABEL}-overview-hover`
    const { document } = await openOverview(page, label)
    const tile = page.getByTestId(`document-${document.id}`)
    await tile.hover()
    await expect.poll(() => tile.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(RULE)
    await settleAnimations(page)
    await expect(tile).toHaveCSS('transform', 'none')
    await expect(tile).toHaveCSS('box-shadow', 'none')
    await cleanup(label)
  })
})
```

In `apps/web/e2e/glass-shell.spec.ts`, replace the whole test `'the tiles and the People card sit on raised glass, not the shared token'` with (the dashboard half moves in Task 9; the old `--glass-light` assertion guarded other glass surfaces from thickening, and the spec removes glass, so it is replaced by the no-blur check):

```ts
test('the tiles and the People card are flat white surfaces', async ({ page }) => {
  const label = `${LABEL}-glassfill`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  // The dashboard tile still carries its own .7 override until the dashboard moves.
  await page.goto('/')
  await expect(page.getByTestId(`workspace-${workspace.id}`)).toHaveCSS(
    'background-color',
    'rgba(255, 255, 255, 0.7)',
  )

  // Two class selectors could tie on specificity and leave the winner to stylesheet order;
  // this is the check that the intended fill wins on the overview.
  await page.goto(`/workspaces/${workspace.id}`)
  for (const surface of [
    page.getByTestId(`document-${document.id}`),
    page.locator('[class*="people"]').first(),
  ]) {
    await expect(surface).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(surface).toHaveCSS('backdrop-filter', 'none')
  }

  await cleanup(label)
})
```

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts e2e/glass-shell.spec.ts -g "workspace overview|flat white surfaces"`
Expected: FAIL (32px title, 21px headings, glass tiles and pill).

- [ ] **Step 2: The shared primitives**

Replace `apps/web/src/components/ui/ui.module.css` with:

```css
/*
  The shared surface (spec, "Material"): solid white with a hairline. Every flat panel that
  sits on the canvas composes it: the dashboard and overview tiles, the People card.
*/
.surface {
  background: var(--paper);
  border: 1px solid var(--hairline);
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: var(--r);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

@media (prefers-reduced-motion: no-preference) {
  .button {
    transition:
      transform 0.4s var(--ease),
      background var(--dur-fast) var(--ease),
      border-color var(--dur-fast) var(--ease);
  }
  .button:active:not(:disabled) {
    transform: scale(0.96);
  }
}

.button:disabled,
.button[aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
}

.accent {
  background: var(--accent);
  color: #fff;
}

.accent:hover:not(:disabled) {
  background: var(--accent-hover);
}

/* A white button with a field edge, for a secondary action on a white surface. */
.plainButton {
  background: var(--paper);
  border-color: var(--field-border);
  color: var(--text);
}

.plainButton:hover:not(:disabled) {
  border-color: var(--dash);
}

.ghost {
  background: transparent;
  color: var(--text-muted);
}

.ghost:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text);
}

/* The delete action (Revoke): red words, a neutral hover. */
.danger {
  background: transparent;
  color: var(--danger);
}

.danger:hover:not(:disabled) {
  background: var(--wash);
}

.field {
  display: grid;
  gap: 6px;
}

.label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}

/* Visually hidden but still read by screen readers and by Playwright's getByLabel. */
.labelHidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* A field (the spec keeps fields at rgba(40,40,60,.12)). */
.pillInput {
  width: 100%;
  height: 40px;
  padding: 0 16px;
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  border-radius: var(--r);
  font-size: 14.5px;
}

.pillInput::placeholder {
  color: var(--text-faint);
}

.pillInput:focus {
  outline: none;
  background: var(--paper);
  border-color: var(--accent);
  box-shadow: 0 0 0 5px var(--accent-ring);
}

/* A page's title: the dashboard's "Workspaces" and the workspace's name (spec, "Type"). */
.pageTitle {
  margin: 0;
  font-size: 52px;
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1.02;
}

/*
  A tile: composes .surface for its white and hairline. Hover darkens the edge and does not
  lift (spec, "Hover"); the press stays.
*/
.tile {
  border-radius: var(--r);
  padding: 22px;
}

.tile:hover {
  border-color: var(--rule);
  text-decoration: none;
}

@media (prefers-reduced-motion: no-preference) {
  .tile {
    transition:
      border-color var(--dur-fast) var(--ease),
      transform 0.4s var(--ease);
  }
  .tile:active {
    transform: scale(0.98);
  }
}

/* The dashed "make a new one" tile at the end of a tile grid: white, a dashed edge. */
.tileCreate {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  padding: 22px;
  border: 1.5px dashed var(--dash);
  border-radius: var(--r);
  background: var(--paper);
}

/* Inputs on a create tile are white with the reference's literal edge. */
.tileCreate .pillInput {
  background: var(--paper);
  border: 1px solid rgba(40, 40, 60, 0.14);
}

/* Restore the focus border the rule above would otherwise out-rank. */
.tileCreate .pillInput:focus {
  border-color: var(--accent);
}

.chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: var(--r);
  background: rgba(0, 0, 0, 0.05);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

/* The Board and Page labels (spec: --accent-tint). */
.chipAccent {
  background: var(--accent-tint);
  color: var(--accent-text);
}

.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 3px;
  /* The reference's literal track colour. */
  background: var(--track);
  border-radius: var(--r);
}

.segment {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--r);
  background: transparent;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
}

/*
  A segment is a <label> around a real radio. The radio is invisible but stretched over
  the whole segment (not clipped to 1px), so it is still the pointer target as well as the
  focus target, and Playwright can click it. It shows no ring of its own, so draw one on
  the segment instead.
*/
.segmentInput {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.segment:has(input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* The chosen option: white on the grey track, no shadow. */
.segmentOn {
  background: var(--paper);
  color: var(--text);
}

/*
  Small text sitting on the canvas gets its own white pill: the workspace's meta line and
  "Nothing here yet." width: fit-content, not align-self alone: these land in grid
  containers too, where align-self is the block axis and would leave the pill full width.
*/
.metaPill {
  align-self: flex-start;
  width: fit-content;
  padding: 5px 14px;
  border-radius: var(--r);
  background: var(--paper);
  border: 1px solid var(--hairline);
  color: var(--text-2);
  font-size: 14px;
  font-weight: 500;
}

/* An error message: white with a hairline, the words in --danger. The only red is the text. */
.error {
  padding: 10px 14px;
  border: 1px solid var(--hairline);
  border-radius: var(--r);
  background: var(--paper);
  color: var(--danger);
  font-size: 13px;
}
```

- [ ] **Step 3: The overview's stylesheet and markup**

Replace `apps/web/src/app/workspaces/[id]/workspace.module.css` with:

```css
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 40px 16px 64px;
  display: grid;
  gap: 44px;
}

@media (prefers-reduced-motion: no-preference) {
  .page {
    animation: global(g-in) var(--dur-slow) var(--ease);
  }
}

.header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.section {
  display: grid;
  gap: 14px;
}

/* Documents, People (spec, "Section headings"): small capitals under a full-width dark rule. */
.sectionHeading {
  margin: 0;
  padding-top: 10px;
  border-top: 1px solid var(--rule);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 16px;
}

/* Groups the tiles for data-testid="document-list" without becoming a grid item itself. */
.docs {
  display: contents;
}

/* A document tile composes ui.surface and ui.tile for its material. */
.docTile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 40px;
  color: var(--text);
}

/* Titles run to 200 characters. overflow-wrap is inherited, so this covers title and time. */
.docText {
  display: grid;
  gap: 4px;
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
}

.docText > * {
  display: block;
}

.docTitle {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  text-wrap: pretty;
}

.docUpdated {
  font-size: 13.5px;
  line-height: 1.35;
  color: var(--text-faint);
}

.form {
  display: grid;
  gap: 12px;
}

.formRow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* The track grows to fill the row; the segments inside split it evenly. */
.typeGroup {
  flex: 1 1 140px;
}

.typeSegment {
  flex: 1;
}

/* The People card composes ui.surface for its white and hairline. */
.people {
  border-radius: var(--r);
  overflow: hidden;
}

.memberRow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.memberRow:last-child {
  border-bottom: none;
}

.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

.memberText {
  display: grid;
  flex: 1;
  min-width: 0;
  line-height: 1.3;
}

.memberName {
  font-weight: 500;
  overflow-wrap: anywhere;
}

.memberEmail {
  color: var(--text-faint);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.memberRole {
  color: var(--text-muted);
  font-size: 13px;
}

.peopleHeader {
  display: flex;
  justify-content: flex-end;
  padding: 12px 18px 0;
}

.manageLink {
  padding: 0;
  border: none;
  background: transparent;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--accent-text);
  cursor: pointer;
}

.manageLink:hover {
  text-decoration: underline;
}

/* The tile and its rename button. The button sits over the tile's top-right corner and
   shows on hover or keyboard focus; the tile underneath stays one link. */
.docTileWrap {
  position: relative;
  display: flex;
}

/* The wrapper is the grid item now; the tile fills it, so tiles in a row stay one height. */
.docTileWrap > .docTile {
  flex: 1;
  min-width: 0;
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
  border-radius: var(--r);
  background: var(--paper);
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
  border-radius: var(--r);
  background: var(--paper);
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

In `apps/web/src/app/workspaces/[id]/page.tsx`:
- `<h1>{name}</h1>` → `<h1 className={ui.pageTitle}>{name}</h1>`;
- both `className={ui.bgPill}` → `className={ui.metaPill}`;
- `<h2 id="documents-heading">Documents</h2>` → `<h2 id="documents-heading" className={styles.sectionHeading}>Documents</h2>`;
- `<h2 id="people-heading">People</h2>` → `<h2 id="people-heading" className={styles.sectionHeading}>People</h2>`;
- `` className={`${ui.glass} ${styles.people}`} `` → `` className={`${ui.surface} ${styles.people}`} ``.

In `apps/web/src/components/DocumentTile.tsx`, both `` `${ui.glass} ${ui.tile} ${classes.tile}` `` → `` `${ui.surface} ${ui.tile} ${classes.tile}` ``.

In `apps/web/src/app/page.tsx` (the dashboard; the rest of it moves in Task 9), `` `${ui.glass} ${ui.tile} ${styles.tile}` `` → `` `${ui.surface} ${ui.tile} ${styles.tile}` ``. Without this the dashboard tiles would lose their class, since `.glass` no longer exists.

- [ ] **Step 4: Run, guard, record**

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts e2e/glass-shell.spec.ts e2e/document-type.spec.ts e2e/renaming.spec.ts e2e/share-sheet.spec.ts` — Expected: PASS (the Page/Board radio group's focus ring, the rename pencil and field, and "a 200-character single-word document title wraps inside its tile" among them).

Add `'components/ui/ui.module.css',` and `'app/workspaces/[id]/workspace.module.css',` to `MIGRATED`; run `pnpm --filter @crdt/web exec vitest run test/gallery-material.test.ts test/no-red.test.ts` — Expected: PASS.

Append to `docs/design/gallery-handoff.md`:

```md
| T8.1 | Document tiles and People card | Reference `#fbfbf9`, hover `#fff` plus the floating shadow | `#ffffff`; hover darkens the edge to `#1c1d1b`; no lift, no shadow | They were .7 glass, and the spec maps 60%+ white to `#ffffff`; hover per the spec (decisions 2, 3). |
| T8.2 | Board/Page chip text | Reference `oklch(acc − 0.04)` = `oklch(0.46 0.17 290)` | `--accent-text` (`oklch(0.44 0.17 290)`) | One token for violet text; 0.02 darker, so contrast only improves. |
| T8.3 | Page/Board segment | Reference: white with `0 1px 3px` | White on the grey track, no shadow | Decision 10. |
| T8.4 | People "Manage" link | Reference: beside the People heading | Inside the People card, where it was | Layout is not in scope (decision 21). |
| T8.5 | `ui` class names | `.glass`, `.bgPill` | `.surface`, `.metaPill` | Names that say what they are now. |
```

- [ ] **Step 5: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add apps/web/src/components/ui/ui.module.css "apps/web/src/app/workspaces/[id]/workspace.module.css" \
  "apps/web/src/app/workspaces/[id]/page.tsx" apps/web/src/components/DocumentTile.tsx apps/web/src/app/page.tsx \
  apps/web/e2e/glass-shell.spec.ts apps/web/e2e/gallery.spec.ts \
  apps/web/test/gallery-material.test.ts docs/design/gallery-handoff.md
git commit -m "feat(gallery): the workspace overview's title, section rules and flat tiles"
```

---

### Task 9: Dashboard

**Files:**
- Replace: `apps/web/src/app/dashboard.module.css`
- Modify: `apps/web/src/app/page.tsx` (the `h1`)
- Modify: `apps/web/e2e/glass-shell.spec.ts`, `apps/web/e2e/gallery.spec.ts`, `apps/web/test/gallery-material.test.ts`, `docs/design/gallery-handoff.md`

**Interfaces:**
- Consumes: `ui.pageTitle`, `ui.surface`, `ui.tile`, `ui.tileCreate` (Task 8); `gallery.spec.ts` helpers; `MIGRATED`.
- Produces: nothing new.

- [ ] **Step 1: The failing dashboard checks**

Append to `apps/web/e2e/gallery.spec.ts`:

```ts
test.describe('dashboard', () => {
  test('"Workspaces" is a 52px title, tiles are white with a hairline, and the initial is a square', async ({
    page,
  }) => {
    const label = `${LABEL}-dashboard`
    const { owner, workspace } = await seedWorkspace(label)
    await signIn(page, owner.id)
    await page.goto('/')
    await settleAnimations(page)
    const title = page.getByRole('heading', { level: 1, name: 'Workspaces' })
    await expect(title).toHaveCSS('font-size', '52px')
    await expect(title).toHaveCSS('letter-spacing', '-2.08px')

    const tile = page.getByTestId(`workspace-${workspace.id}`)
    expect(await material(tile)).toEqual({
      background: WHITE,
      backdrop: 'none',
      shadow: 'none',
      radius: '2px',
      borderColor: HAIRLINE,
      borderWidth: '1px',
    })
    expect(await material(tile.locator('span').first())).toMatchObject({
      background: await resolveColour(page, 'var(--accent)'),
      radius: '2px',
      shadow: 'none',
    })
    await expect(page.locator('[class*="tileCreate"]')).toHaveCSS('border-top-style', 'dashed')

    await tile.hover()
    await expect.poll(() => tile.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(RULE)
    await settleAnimations(page)
    await expect(tile).toHaveCSS('transform', 'none')
    await cleanup(label)
  })
})
```

In `apps/web/e2e/glass-shell.spec.ts`, test `'the tiles and the People card are flat white surfaces'` (Task 8), replace the dashboard half

```ts
  // The dashboard tile still carries its own .7 override until the dashboard moves.
  await page.goto('/')
  await expect(page.getByTestId(`workspace-${workspace.id}`)).toHaveCSS(
    'background-color',
    'rgba(255, 255, 255, 0.7)',
  )
```

with

```ts
  await page.goto('/')
  await expect(page.getByTestId(`workspace-${workspace.id}`)).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.getByTestId(`workspace-${workspace.id}`)).toHaveCSS('backdrop-filter', 'none')
```

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts e2e/glass-shell.spec.ts -g "dashboard|flat white surfaces"` — Expected: FAIL (32px title, `.7` tile, 14px-radius initial).

- [ ] **Step 2: The dashboard's stylesheet and title**

Replace `apps/web/src/app/dashboard.module.css` with:

```css
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 40px 16px 64px;
  display: grid;
  gap: 28px;
}

@media (prefers-reduced-motion: no-preference) {
  .page {
    animation: global(g-in) var(--dur-slow) var(--ease);
  }
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 16px;
}

/* A workspace tile composes ui.surface and ui.tile for its material. */
.tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 32px;
  color: var(--text);
}

/* The workspace's initial on an accent square, 2px corners, nothing cast. */
.initial {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: var(--r);
  background: var(--accent);
  color: #fff;
  font-size: 18px;
  font-weight: 600;
}

/* Names run to 120 characters. overflow-wrap is inherited, so this covers the name and meta. */
.tileText {
  display: grid;
  gap: 4px;
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
}

.tileText > * {
  display: block;
}

.tileName {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  text-wrap: pretty;
}

.tileMeta {
  font-size: 13.5px;
  line-height: 1.35;
  color: var(--text-muted);
}

.createTitle {
  font-size: 18px;
  font-weight: 600;
}

.createForm {
  display: grid;
  gap: 12px;
}

.createButton {
  justify-self: start;
}
```

In `apps/web/src/app/page.tsx`, `<h1>Workspaces</h1>` → `<h1 className={ui.pageTitle}>Workspaces</h1>`.

- [ ] **Step 3: Run, guard, record**

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts e2e/glass-shell.spec.ts e2e/auth-flow.spec.ts` — Expected: PASS.

Add `'app/dashboard.module.css',` to `MIGRATED`; run `pnpm --filter @crdt/web exec vitest run test/gallery-material.test.ts` — Expected: PASS.

Append to `docs/design/gallery-handoff.md`:

```md
| T9.1 | Workspace tiles | Reference `#fbfbf9`, hover `#fff` plus the floating shadow | `#ffffff`; hover darkens the edge; no lift | Decisions 2 and 3, as the overview's. |
```

- [ ] **Step 4: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add apps/web/src/app/dashboard.module.css apps/web/src/app/page.tsx \
  apps/web/e2e/glass-shell.spec.ts apps/web/e2e/gallery.spec.ts \
  apps/web/test/gallery-material.test.ts docs/design/gallery-handoff.md
git commit -m "feat(gallery): the dashboard's title and flat workspace tiles"
```

---

### Task 10: Sign-in, and the invite and privacy pages that share its card

**Files:**
- Replace: `apps/web/src/app/(auth)/auth.module.css`, `apps/web/src/app/privacy/privacy.module.css`
- Modify: `apps/web/src/app/(auth)/layout.tsx` (two test ids), `apps/web/src/app/privacy/page.tsx` (one test id)
- Modify: `apps/web/src/app/(auth)/ProviderButtons.tsx`, `apps/web/src/app/(auth)/invite/[token]/InviteSignOut.tsx` (class rename)
- Modify: `apps/web/e2e/gallery.spec.ts`, `apps/web/test/gallery-material.test.ts`, `docs/design/gallery-handoff.md`

**Interfaces:**
- Consumes: Task 1 tokens; `ui.error` (Task 8); `gallery.spec.ts` helpers; `MIGRATED`.
- Produces: test ids `auth-card` and `auth-mark` (on the `(auth)` layout's card and mark) and `privacy-card` (the privacy page's `<article>`); class `.providerSecondary` (renamed from `.providerGlass`).

- [ ] **Step 1: The failing sign-in checks**

Append to `apps/web/e2e/gallery.spec.ts`:

```ts
test.describe('sign-in, invite and privacy', () => {
  const card = {
    background: PAPER_SOFT,
    backdrop: 'none',
    shadow: FLOAT,
    radius: '2px',
    borderColor: HAIRLINE,
    borderWidth: '1px',
  }

  test('the sign-in card is the softer white with a hairline and the floating shadow', async ({ page }) => {
    await page.goto('/login')
    await settleAnimations(page)
    expect(await material(page.getByTestId('auth-card'))).toEqual(card)
    expect(await material(page.getByTestId('auth-mark'))).toMatchObject({
      background: await resolveColour(page, 'var(--accent)'),
      radius: '2px',
      shadow: 'none',
    })
    expect(await material(page.getByTestId('signin-github'))).toMatchObject({ radius: '2px', shadow: 'none' })
    expect(await material(page.getByTestId('signin-google'))).toMatchObject({
      background: WHITE,
      radius: '2px',
      borderColor: HAIRLINE,
    })
  })

  test('the sign-in buttons do not lift on hover', async ({ page }) => {
    await page.goto('/login')
    await settleAnimations(page)
    for (const id of ['signin-github', 'signin-google']) {
      await page.getByTestId(id).hover()
      await settleAnimations(page)
      await expect(page.getByTestId(id)).toHaveCSS('transform', 'none')
      await expect(page.getByTestId(id)).toHaveCSS('box-shadow', 'none')
    }
  })

  test('the invite page and the privacy page wear the same card', async ({ page }) => {
    await page.goto('/invite/not-a-real-token')
    await expect(page.getByTestId('invite-invalid')).toBeVisible()
    await settleAnimations(page)
    expect(await material(page.getByTestId('auth-card'))).toEqual(card)

    await page.goto('/privacy')
    expect(await material(page.getByTestId('privacy-card'))).toEqual(card)
  })
})
```

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts -g "sign-in, invite"` — Expected: FAIL (no test ids yet; glass card; the GitHub button lifts 1px).

- [ ] **Step 2: The card's stylesheet and test ids**

Replace `apps/web/src/app/(auth)/auth.module.css` with:

```css
.shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}

/*
  The sign-in card (the reference's): the softer white, a hairline, 2px corners and the
  floating shadow a sheet has (decision 15). The invite page shares it.
*/
.card {
  width: 100%;
  max-width: 400px;
  display: grid;
  gap: 28px;
  padding: 44px 40px;
  border-radius: var(--r);
  text-align: center;
  background: var(--paper-soft);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-float);
}

@media (prefers-reduced-motion: no-preference) {
  .card {
    animation: global(g-sheet) var(--dur-slow) var(--ease);
  }
}

/* The logo's glyph on a 52px accent square: 2px corners, nothing cast. */
.mark {
  width: 52px;
  height: 52px;
  margin: 0 auto;
  /* The same glyph as the nav logo, with proportionally the same fill around it. */
  padding: 7px;
  box-sizing: border-box;
  border-radius: var(--r);
  background: var(--accent);
}

.intro {
  display: grid;
  gap: 8px;
}

.heading {
  font-size: 30px;
}

.lede {
  color: var(--text-muted);
}

.providers {
  display: grid;
  gap: 10px;
}

.provider {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 50px;
  border-radius: var(--r);
  font-weight: 500;
}

.provider:hover {
  text-decoration: none;
}

/* No hover lift (spec, "Hover"), and the GitHub colour stays as it is on hover (the owner's
   earlier rule); the press stays. */
@media (prefers-reduced-motion: no-preference) {
  .provider {
    transition: transform 0.4s var(--ease);
  }
  .provider:active:not(:disabled) {
    transform: scale(0.97);
  }
}

.providerAccent {
  background: var(--accent);
  color: #fff;
}

.providerSecondary {
  background: var(--paper);
  border: 1px solid var(--hairline);
  color: var(--text);
}

.alt {
  font-size: 13px;
  color: var(--text-faint);
}

/* A <button> wearing the provider look: undo the browser's button font, width and
   cursor. Used by the invite page's Sign out. */
.providerButton {
  width: 100%;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}

/* A disabled button must not react to the pointer: the press rule above skips
   :disabled, so only the dimmed look remains. */
.providerButton:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Workspace names, document titles, inviter names and emails are other people's text and
   can be one unbroken word. Let it break anywhere, and count that in the card's minimum
   width, so a long one wraps inside the card instead of pushing past it. */
.inviteText {
  overflow-wrap: anywhere;
}
```

In `apps/web/src/app/(auth)/layout.tsx`: `<div className={styles.card}>` → `<div className={styles.card} data-testid="auth-card">`, and `<div className={styles.mark} aria-hidden="true">` → `<div className={styles.mark} aria-hidden="true" data-testid="auth-mark">`.

In `apps/web/src/app/(auth)/ProviderButtons.tsx`, `styles.providerGlass` → `styles.providerSecondary`. In `apps/web/src/app/(auth)/invite/[token]/InviteSignOut.tsx`, `styles.providerGlass` → `styles.providerSecondary`.

Replace `apps/web/src/app/privacy/privacy.module.css` with:

```css
.shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
}

/* The sign-in card's look, widened for reading and left-aligned. */
.card {
  width: 100%;
  max-width: 640px;
  display: grid;
  gap: 14px;
  padding: 40px;
  border-radius: var(--r);
  background: var(--paper-soft);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-float);
}

.card h2 {
  margin-top: 12px;
  font-size: 18px;
}

.card ul {
  display: grid;
  gap: 10px;
  padding-left: 20px;
}

.heading {
  font-size: 30px;
}

.lede {
  color: var(--text-muted);
}

.back {
  margin-top: 12px;
  font-size: 13px;
}

@media (max-width: 520px) {
  .card {
    padding: 28px 22px;
  }
}
```

In `apps/web/src/app/privacy/page.tsx`, `<article className={styles.card}>` → `<article className={styles.card} data-testid="privacy-card">`.

- [ ] **Step 3: Run, guard, record**

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts e2e/auth-flow.spec.ts e2e/invitations.spec.ts e2e/glass-shell.spec.ts -g "sign-in|invite|privacy|canvas background never intercepts"` — Expected: PASS.

Add `'app/(auth)/auth.module.css',` and `'app/privacy/privacy.module.css',` to `MIGRATED`; run `pnpm --filter @crdt/web exec vitest run test/gallery-material.test.ts test/css-tokens.test.ts` — Expected: PASS.

Append to `docs/design/gallery-handoff.md`:

```md
| T10.1 | GitHub sign-in hover | Reference `translateY(-1px)` plus the floating shadow | No lift, no shadow, colour unchanged; the press stays | No hover lifts (decision 2); the owner's earlier "colour stays" rule. |
| T10.2 | Sign-in, invite and privacy card shadow | Spec lists "sheets" | The floating shadow, as the reference draws it | The card enters as a sheet does (decision 15, question 4). |
| T10.3 | Class name | `.providerGlass` | `.providerSecondary` | No glass. |
```

- [ ] **Step 4: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add "apps/web/src/app/(auth)/auth.module.css" "apps/web/src/app/(auth)/layout.tsx" \
  "apps/web/src/app/(auth)/ProviderButtons.tsx" "apps/web/src/app/(auth)/invite/[token]/InviteSignOut.tsx" \
  apps/web/src/app/privacy/privacy.module.css apps/web/src/app/privacy/page.tsx \
  apps/web/e2e/gallery.spec.ts apps/web/test/gallery-material.test.ts docs/design/gallery-handoff.md
git commit -m "feat(gallery): the sign-in, invite and privacy card"
```

---

### Task 11: The Share sheet, the ⌘K palette and toasts

**Files:**
- Replace: `apps/web/src/components/ui/sheet.module.css`, `apps/web/src/components/command-palette.module.css`
- Modify: `apps/web/src/components/share-sheet.module.css` (blocks listed in Step 2)
- Modify: `apps/web/e2e/gallery.spec.ts`, `apps/web/test/gallery-material.test.ts`, `docs/design/gallery-handoff.md`

**Interfaces:**
- Consumes: Task 1 tokens (`--ink`, `--toast-dot`, `--shadow-float`); Task 3's toast keyframes `up` (restated below); `gallery.spec.ts` helpers; `addMember` (imported in Task 4); `MIGRATED`.
- Produces: nothing new. Test ids used: `share`, `sheet`, `sheet-overlay`, `member-email`, `role-for-*`, `search`, `palette`, the `listbox` named "Results" and its `option`s, `toast`.

- [ ] **Step 1: The failing overlay checks**

Append to `apps/web/e2e/gallery.spec.ts`:

```ts
test.describe('share sheet, palette and toasts', () => {
  const floating = {
    background: WHITE,
    backdrop: 'none',
    shadow: FLOAT,
    radius: '2px',
    borderColor: HAIRLINE,
    borderWidth: '1px',
  }

  test('the share sheet is a white floating sheet over an unblurred veil, and a toast is flat and dark', async ({
    page,
  }) => {
    const label = `${LABEL}-share`
    const { owner, workspace } = await seedWorkspace(label)
    const member = await addMember(workspace.id, label, 'viewer')
    await signIn(page, owner.id)
    await page.goto(`/workspaces/${workspace.id}`)
    await page.getByTestId('share').click()
    await settleAnimations(page)
    expect(await material(page.getByTestId('sheet'))).toEqual(floating)
    const veil = page.getByTestId('sheet-overlay')
    await expect(veil).toHaveCSS('backdrop-filter', 'none')
    await expect(veil).toHaveCSS('background-color', 'rgba(30, 40, 35, 0.16)')
    const invite = page.getByTestId('member-email').locator('xpath=ancestor::form[1]')
    expect(await material(invite)).toMatchObject({ background: WHITE, radius: '2px', borderColor: HAIRLINE, shadow: 'none' })

    // A role change raises a toast.
    await page.getByTestId(`role-for-${member.id}`).selectOption('editor')
    const toast = page.getByTestId('toast').first()
    await expect(toast).toBeVisible()
    await settleAnimations(page)
    expect(await material(toast)).toMatchObject({ background: INK, backdrop: 'none', shadow: 'none', radius: '2px' })
    await expect(toast.locator('span').first()).toHaveCSS(
      'background-color',
      await resolveColour(page, 'oklch(0.64 0.17 290)'),
    )
    await cleanup(label)
  })

  test('the ⌘K palette is a white floating sheet and its chosen row is the accent', async ({ page }) => {
    const label = `${LABEL}-palette`
    const { owner, workspace } = await seedWorkspace(label)
    await createDocument(workspace.id, 'doc')
    await signIn(page, owner.id)
    await page.goto(`/workspaces/${workspace.id}`)
    await page.getByTestId('search').click()
    const results = page.getByRole('listbox', { name: 'Results' })
    await expect(results).toBeVisible()
    await settleAnimations(page)
    expect(await material(page.getByTestId('palette'))).toEqual(floating)
    const chosen = results.getByRole('option', { selected: true })
    await expect(chosen).toHaveCSS('background-color', await resolveColour(page, 'var(--accent)'))
    await expect(chosen).toHaveCSS('border-top-left-radius', '2px')
    await cleanup(label)
  })
})
```

(`palette` is the palette panel's own test id, on `.sheet`; the invite row is the `<form className={styles.invite}>` around `member-email` in `ShareSheet.tsx`.)

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts -g "share sheet, palette"` — Expected: FAIL (glass sheet with blur, a blurred veil, a pill toast with blur).

- [ ] **Step 2: The stylesheets**

Replace `apps/web/src/components/ui/sheet.module.css` with:

```css
/*
  Overlay and sheet, shared by the share sheet and the card sheet. The veil keeps the
  reference's rgba(30,40,35,.16) and loses its blur; the sheet is white with a hairline and
  the floating shadow.
*/
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: start center;
  padding: 72px 16px 16px;
  overflow-y: auto;
  background: rgba(30, 40, 35, 0.16);
}

.sheet {
  width: 100%;
  border-radius: var(--r);
  padding: 26px 26px 22px;
  background: var(--paper);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-float);
}

@media (prefers-reduced-motion: no-preference) {
  .overlay {
    animation: global(g-fade) 0.35s var(--ease);
  }
  .sheet {
    animation: global(g-sheet) var(--dur-slow) var(--ease);
  }
}

.title {
  margin: 0 0 18px;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.toastWrap {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 60;
  display: grid;
  gap: 8px;
  justify-items: center;
  transform: translateX(-50%);
  pointer-events: none;
}

/* A toast (spec, "Material"): solid #161616, 2px corners, no blur and no shadow. */
.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border-radius: var(--r);
  background: var(--ink);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
}

/* The accent 0.14 lighter (spec, "Toast dot"). */
.toastDot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--toast-dot);
}

/*
  The toast's rise. Not globals.css's g-up, which translates by -50% for a toast that centres
  itself; this one is centred by .toastWrap, so the shared keyframes would throw it sideways.
*/
@keyframes up {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .toast {
    animation: up 0.55s var(--ease);
  }
}
```

Replace `apps/web/src/components/command-palette.module.css` with:

```css
/* The palette's veil: the reference's lighter rgba(30,40,35,.1), never blurred. */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: grid;
  place-items: start center;
  padding: 110px 16px 16px;
  background: rgba(30, 40, 35, 0.1);
}

/* The palette (spec, "Shadows"): white, a hairline, 2px corners and the floating shadow. */
.sheet {
  width: 100%;
  max-width: 580px;
  border-radius: var(--r);
  overflow: hidden;
  background: var(--paper);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-float);
}

@media (prefers-reduced-motion: no-preference) {
  .overlay {
    animation: global(g-fade) 0.35s var(--ease);
  }
  .sheet {
    animation: global(g-sheet) var(--dur-slow) var(--ease);
  }
}

.input {
  width: 100%;
  height: 60px;
  padding: 0 22px;
  border: 0;
  border-bottom: 1px solid var(--field-border);
  background: transparent;
  font-size: 16px;
  color: var(--text);
}

.input:focus {
  outline: none;
}

.list {
  margin: 0;
  padding: 8px;
  list-style: none;
  max-height: 46vh;
  overflow-y: auto;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 14px;
  border-radius: var(--r);
  font-size: 14.5px;
  color: var(--text-2);
  cursor: pointer;
}

/* The chosen row: the accent with white text. */
.itemOn {
  background: var(--accent);
  color: #fff;
}

.kind {
  margin-left: auto;
  font-size: 12px;
  opacity: 0.7;
}

.empty {
  padding: 18px 22px;
  font-size: 14px;
  color: var(--text-muted);
}
```

In `apps/web/src/components/share-sheet.module.css`:
1. Replace `.invite { … }` with

```css
/* Invite row: one white container with a hairline, holding a borderless input, a select
   and Add. */
.invite {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 4px 14px;
  border-radius: var(--r);
  background: var(--paper);
  border: 1px solid var(--hairline);
}
```

2. In `.inviteRole`, `border-radius: var(--r-pill);` → `border-radius: var(--r);`.
3. In `.avatar`, delete `box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);`.
4. In `.linkPanel`, `border-radius: var(--r-card);` → `border-radius: var(--r);`.
5. In `.linkInput`, `border-radius: var(--r-pill);` → `border-radius: var(--r);` and `background: #fff;` → `background: var(--paper);`; change its comment to `/* A white field, as the invite row's. */`.

- [ ] **Step 3: Run, guard, record**

Run: `pnpm --filter @crdt/web exec playwright test e2e/gallery.spec.ts e2e/share-sheet.spec.ts e2e/command-palette.spec.ts e2e/invitations.spec.ts` — Expected: PASS (including "a backdrop click closes the sheet but a click inside does not", which clicks the veil and still works without blur).

Add `'components/ui/sheet.module.css',`, `'components/share-sheet.module.css',` and `'components/command-palette.module.css',` to `MIGRATED`; run `pnpm --filter @crdt/web exec vitest run test/gallery-material.test.ts test/css-motion.test.ts` — Expected: PASS.

Append to `docs/design/gallery-handoff.md`:

```md
| T11.1 | Toast | Reference: floating shadow | No shadow; padding kept at 10px 18px | The spec's shadow list excludes toasts (decision 4); sizes are not in scope. |
| T11.2 | Sheet veil | Code before `rgba(30,40,35,.16)` with `blur(8px)` | The same colour, no blur | No blur anywhere. |
| T11.3 | Palette entrance | Reference `g-pop .5s` | `g-sheet` over `--dur-slow`, as before | Existing motion is kept. |
```

- [ ] **Step 4: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add apps/web/src/components/ui/sheet.module.css apps/web/src/components/command-palette.module.css \
  apps/web/src/components/share-sheet.module.css apps/web/e2e/gallery.spec.ts \
  apps/web/test/gallery-material.test.ts docs/design/gallery-handoff.md
git commit -m "feat(gallery): flat share sheet, palette and toasts"
```

---

### Task 12: The History panel and the version pill

**Files:**
- Modify: `apps/web/src/components/history-panel.module.css` (blocks listed in Step 2)
- Replace: `apps/web/src/components/version-bar.module.css`
- Modify: `apps/web/src/components/version-preview.module.css` (`.notice`)
- Modify: `apps/web/e2e/history.spec.ts`, `apps/web/test/gallery-material.test.ts`, `docs/design/gallery-handoff.md`

**Interfaces:**
- Consumes: Task 1 tokens; `settleAnimations` (`e2e/fixtures.ts`); in `e2e/history.spec.ts` its own helpers `labelFor`, `seedThree`, `openPanel`, `sliderOf` and `pill` (defined near line 1478; put the new test after it, at the end of the file); `MIGRATED`.
- Produces: nothing new.

- [ ] **Step 1: The failing history check**

In `apps/web/e2e/history.spec.ts`, add `settleAnimations` to the `./fixtures.js` import, and append at the end of the file:

```ts
test('the panel is a white floating sheet, the chosen row is tinted violet, and the version pill is flat and dark', async ({
  page,
}) => {
  const { owner, document } = await seedThree(labelFor('gallery'))
  await signIn(page, owner.id)
  await page.goto(documentPath(document))

  const panel = await openPanel(page)
  await settleAnimations(page)
  const look = (el: Element) => {
    const style = getComputedStyle(el)
    return {
      background: style.backgroundColor,
      backdrop: style.backdropFilter,
      shadow: style.boxShadow,
      radius: style.borderTopLeftRadius,
      border: style.borderTopColor,
    }
  }
  expect(await panel.evaluate(look)).toEqual({
    background: 'rgb(255, 255, 255)',
    backdrop: 'none',
    shadow: 'rgba(0, 0, 0, 0.25) 0px 24px 48px -28px',
    radius: '2px',
    border: 'rgb(228, 228, 224)',
  })

  const tint = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent-tint)'
    document.body.append(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    return out
  })
  const rows = panel.getByTestId('history-row')
  await sliderOf(panel).fill('1')
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => rows.nth(1).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(tint)
  await expect(rows.nth(1)).toHaveCSS('border-top-left-radius', '2px')

  await rows.nth(2).click()
  await expect(pill(page)).toBeVisible()
  await settleAnimations(page)
  expect(await pill(page).evaluate(look)).toMatchObject({
    background: 'rgb(22, 22, 22)',
    backdrop: 'none',
    shadow: 'none',
    radius: '2px',
  })
})
```

Run: `pnpm --filter @crdt/web exec playwright test e2e/history.spec.ts -g "white floating sheet"` — Expected: FAIL (.66 glass, blur, 28px radius; dark glass pill).

- [ ] **Step 2: The stylesheets**

In `apps/web/src/components/history-panel.module.css`:

1. Replace the header comment, `.panel { … }` and the `@supports not (backdrop-filter: blur(1px)) { .panel { … } }` block with:

```css
/*
  The History panel: a white floating sheet with a hairline, 2px corners and the floating
  shadow (decision 15). Rendered through a portal into <body> (see HistoryButton), so
  --nav-bottom is copied onto it as an inline custom property.
*/
.panel {
  position: fixed;
  top: calc(var(--nav-bottom, 68px) + 16px);
  right: 16px;
  bottom: 16px;
  width: 330px;
  /* Above the content (1), below the nav (30), so the nav always stays on top of it. */
  z-index: 25;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: var(--r);
  background: var(--paper);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-float);
}
```

2. In `.slider:focus-visible`, `::-webkit-slider-runnable-track` and `::-moz-range-track`, `border-radius: var(--r-pill);` → `border-radius: var(--r);`.
3. In `.slider::-webkit-slider-thumb` and `.slider::-moz-range-thumb`, delete `box-shadow: 0 1px 4px var(--accent-shadow);` (the thumb stays round).
4. In `.row`, `border-radius: var(--r-card);` → `border-radius: var(--r);`.
5. Replace `.row:hover { … }` and `.row[aria-pressed='true'] { … }` with:

```css
.row:hover {
  background: var(--wash);
}

/* The chosen version. The slider moves this between rows, so it is a background the row's
   own transition can ease. The reference's #fff would not show on the white panel. */
.row[aria-pressed='true'] {
  background: var(--accent-tint);
}
```

6. In `.retry`, `border-radius: var(--r-pill);` → `border-radius: var(--r);`.

Replace `apps/web/src/components/version-bar.module.css` with:

```css
/*
  The pill that says a past version is on screen. Fixed just under the nav, centred, and
  read off the shell's --nav-bottom (68px, or 52px once the nav condenses). A dark pill
  (spec, "Material"): solid #161616, 2px corners, no blur and no shadow. Inset auto margins
  centre it instead of a transform, so the entrance below can use the transform alone.
*/
.bar {
  position: fixed;
  top: calc(var(--nav-bottom, 68px) + 8px);
  left: 0;
  right: 0;
  z-index: 26;
  width: fit-content;
  max-width: calc(100vw - 32px);
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px 6px 18px;
  border-radius: var(--r);
  background: var(--ink);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
}

.label {
  min-width: 0;
  margin-right: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.button {
  flex: none;
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--r);
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.button:hover {
  background: rgba(255, 255, 255, 0.22);
}

@media (prefers-reduced-motion: no-preference) {
  .button {
    transition: background var(--dur-fast) var(--ease);
  }
}

.primary {
  background: var(--paper);
  color: var(--text);
}

.primary:hover {
  background: rgba(255, 255, 255, 0.86);
}

.button[aria-disabled='true'] {
  opacity: 0.55;
  cursor: default;
}

/* The page's focus ring is the accent on a light page; on this pill it would vanish. */
.button:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

/* The pill's own keyframes, local to this module (its name is hashed with it). */
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .bar {
    animation: rise 0.55s var(--ease);
  }
}
```

In `apps/web/src/components/version-preview.module.css`, replace `.notice { … }` with:

```css
/* Shown above the live view when the chosen version cannot be previewed: a white note. */
.notice {
  max-width: 780px;
  margin: 20px auto 0;
  padding: 10px 16px;
  border-radius: var(--r);
  background: var(--paper);
  border: 1px solid var(--hairline);
  font-size: 13px;
  color: var(--text);
}
```

and update its header comment's second paragraph to: "Declared here rather than reusing globals.css's g-fade: a keyframes rule in the same module is hashed with it and runs. (Modules can also reach the shared ones through `global(g-fade)`; see css-motion.test.ts.)"

- [ ] **Step 3: Run, guard, record**

Run: `pnpm --filter @crdt/web exec playwright test e2e/history.spec.ts` — Expected: PASS, including "the chosen row is drawn differently from the others, and eases over 0.35s", "the slider is drawn in the accent colour but is still a native range input" and "the pill sits centred under the nav, and enters with a real animation that reduced motion removes".

Add `'components/history-panel.module.css',`, `'components/version-bar.module.css',` and `'components/version-preview.module.css',` to `MIGRATED`; run `pnpm --filter @crdt/web exec vitest run test/gallery-material.test.ts` — Expected: PASS.

Append to `docs/design/gallery-handoff.md`:

```md
| T12.1 | History rows | Reference: hover and selected `#fff` on the white panel | Hover `--wash`; selected `--accent-tint` | Invisible otherwise, and the chosen row must differ (decision 17). |
| T12.2 | History panel shadow | Spec lists "sheets" | The floating shadow, as the reference draws it | A floating side sheet (decision 15). |
| T12.3 | Version pill | Reference: floating shadow | No shadow | Dark pills take none (decision 4). |
| T12.4 | Slider thumb | Code before: accent glow | No glow, still round | No shadows. |
```

- [ ] **Step 4: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add apps/web/src/components/history-panel.module.css apps/web/src/components/version-bar.module.css \
  apps/web/src/components/version-preview.module.css apps/web/e2e/history.spec.ts \
  apps/web/test/gallery-material.test.ts docs/design/gallery-handoff.md
git commit -m "feat(gallery): the history panel and the version pill"
```

---

### Task 13: Leftovers — retire the glass tokens, guard every stylesheet

**Files:**
- Modify: `apps/web/src/app/globals.css` (delete the glass tokens, the Glass radii, `--accent-shadow` and the `@supports not (backdrop-filter …)` block; header comment)
- Modify: `apps/web/test/gallery-material.test.ts` (guard every stylesheet), `apps/web/test/gallery-tokens.test.ts` (the glass tokens are gone)
- Modify (comments only): `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/HistoryButton.tsx`, `apps/web/src/components/EditorMenu.tsx`, `apps/web/src/components/PaintSplatter.tsx`, `apps/web/src/lib/splatter/geometry.ts`
- Modify: any stylesheet Step 1 finds still on glass, and `docs/design/gallery-handoff.md`

**Interfaces:**
- Consumes: `sourceFiles`, `rel` (`test/css-walk.ts`); every earlier task.
- Produces: `globals.css` with only Gallery tokens; `MIGRATED` covering every stylesheet in `src`.

- [ ] **Step 1: Find anything still on glass**

Run from `apps/web`:

```bash
grep -rnE "var\(--(glass|blur)-|var\(--accent-shadow\)|var\(--r-[a-z]|backdrop-filter|rgba\(255, ?255, ?255, ?0?\.(4|5|6|7|8|9)" src --include='*.css' --include='*.tsx' --include='*.ts'
```

Expected: only `src/app/globals.css` (the token definitions and the `@supports` block) and the dark pill's translucent whites in `version-bar.module.css` (`.12`, `.22`, `.86`, on `--ink`, which stay). Anything else is a surface the plan missed: migrate it here by the spec's rules (60%+ white → `var(--paper)`, less → `var(--paper-soft)`; white borders → `1px solid var(--hairline)`; radius → `var(--r)` unless round; shadows → none, or `var(--shadow-float)` for a floating menu or sheet; no `backdrop-filter`), and list each in your report and as a `T13.n` deviation row if it differs from the reference.

- [ ] **Step 2: The failing guards**

In `apps/web/test/gallery-material.test.ts`, change the import to `import { declarations, rel, SRC, sourceFiles } from './css-walk.js'` and replace the `MIGRATED` constant with:

```ts
/** Every stylesheet in src: Gallery is the only material now. */
const MIGRATED: string[] = sourceFiles(['.css']).map(rel)
```

and add, inside the `describe`, before `it.each`:

```ts
  it('covers every stylesheet', () => {
    // 19 today: globals.css and 18 modules. A floor, so a broken walk cannot pass on nothing.
    expect(MIGRATED.length).toBeGreaterThanOrEqual(19)
    expect(MIGRATED).toContain('app/globals.css')
  })
```

In `apps/web/test/gallery-tokens.test.ts`, add inside the `describe`:

```ts
  it('the glass tokens are gone', () => {
    expect(globals).not.toMatch(/--(glass|blur)-[\w-]+\s*:/)
    expect(globals).not.toMatch(/--accent-shadow\s*:/)
    expect(globals).not.toMatch(/--r-[a-z]+\s*:/)
    expect(globals).not.toMatch(/backdrop-filter/)
  })
```

Run: `pnpm --filter @crdt/web exec vitest run test/gallery-material.test.ts test/gallery-tokens.test.ts`
Expected: FAIL: `globals.css` still defines the glass tokens and its `@supports` block reads `backdrop-filter`.

- [ ] **Step 3: Delete the glass tokens**

In `apps/web/src/app/globals.css`:
- delete the lines from `/* glass: read only by screens not yet moved to Gallery */` through `--blur-3: blur(30px) saturate(190%);`;
- delete the two lines `/* Glass only: nothing in Gallery casts an accent glow. Removed once no screen reads it. */` and `--accent-shadow: oklch(0.5 0.17 290 / 0.22);`;
- delete the lines from `/* radii: Glass. Each screen moves to --r; removed once none reads them. */` through `--r-sheet: 30px;`;
- delete the whole comment and block that starts `Browsers without backdrop-filter get opaque surfaces instead of transparent` and the `@supports not (backdrop-filter: blur(1px)) { :root { … } }` after it;
- in the header comment, replace "Gallery (2026-10-10; docs/design/gallery-handoff.md) replaces the Glass look of glass-handoff.md section 2. The glass tokens further down are still read by screens that have not moved to Gallery yet, and go once none does." with "Gallery (2026-10-10; docs/design/gallery-handoff.md) replaced the Glass look of glass-handoff.md section 2; no glass token remains."

Run: `pnpm --filter @crdt/web exec vitest run test/css-tokens.test.ts test/gallery-material.test.ts test/gallery-tokens.test.ts test/no-red.test.ts test/css-motion.test.ts`
Expected: PASS. `css-tokens` is the check that nothing still reads a deleted token; if it lists one, migrate that use (Step 1's rules) rather than restoring the token.

- [ ] **Step 4: Comments that still describe glass**

Rewrite these comments (code unchanged):

- `AppShell.tsx`, the comment above `{overlay === 'palette' && (`:

```tsx
        {/*
          Outside the nav on purpose. When the nav was glass its backdrop-filter made it the
          containing block for position:fixed descendants, which would have confined these
          overlays to the bar. Gallery's bar has no filter, but the overlays belong to the
          page, not to the bar, so they stay here.
        */}
```

- `HistoryButton.tsx`, in the doc comment, replace the sentences from "This button sits inside the nav, and the nav's backdrop-filter" through "instead of the page." with: "This button sits inside the nav; the panel belongs to the page. (When the nav was glass, its backdrop-filter also made it the containing block for position:fixed descendants, which is why this was first done.)"
- `EditorMenu.tsx`: "the design is a glass panel with styled previews" → "the design is a panel with styled previews".
- `PaintSplatter.tsx`: "behind translucent glass" → "behind the white surfaces"; and replace the exclusion comment's first two sentences with "Nothing is painted in the top 90px of the viewport, behind the nav (spec, "Painted background and splatter")."
- `geometry.ts`: nothing to change if Task 2's comment is in place; check that no comment still calls the palette "purple".

- [ ] **Step 5: Record, run the full gate, commit**

Append to `docs/design/gallery-handoff.md` any `T13.n` rows from Step 1 (or none).

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add apps/web/src/app/globals.css apps/web/test/gallery-material.test.ts apps/web/test/gallery-tokens.test.ts \
  apps/web/src/components/AppShell.tsx apps/web/src/components/HistoryButton.tsx \
  apps/web/src/components/EditorMenu.tsx apps/web/src/components/PaintSplatter.tsx \
  docs/design/gallery-handoff.md
# plus any file Step 1 migrated
git commit -m "chore(gallery): retire the glass tokens and guard every stylesheet"
```

---

### Task 14: Records — the Gallery handoff, and the pointer in the Glass one

**Files:**
- Modify: `docs/design/gallery-handoff.md` (write everything around the deviation table)
- Modify: `docs/design/glass-handoff.md` (a pointer at the top)

**Interfaces:**
- Consumes: the spec; this plan's Decisions and Questions; every task's deviation rows; the final stylesheets.
- Produces: `docs/design/gallery-handoff.md`, the binding visual spec from now on.

- [ ] **Step 1: Write the handoff**

Rewrite `docs/design/gallery-handoff.md` so it reads, top to bottom, as below. Every value comes from the code as built (read the stylesheets; do not copy from memory or from the Glass handoff), and the deviation table the tasks built is kept verbatim as its own section.

1. **Title and status.** "Handoff: CRDT Workspace, "Gallery"". Status: built on `gallery-redesign` from `docs/superpowers/plans/2026-10-10-gallery-redesign.md`; this file is the binding visual spec; `glass-handoff.md` is history. Source of truth: this file, then the spec, then the reference (built at its defaults), in that order.
2. **Codebase map.** The table of areas → files, updated (tokens and font in `globals.css` and `layout.tsx`; the guards `test/gallery-material.test.ts`, `test/no-red.test.ts`, `test/css-motion.test.ts`, `test/gallery-tokens.test.ts`; the e2e checks `e2e/gallery.spec.ts`).
3. **Tokens.** The `:root` block as built, each Gallery token with its role (copy it from `globals.css`), and the rules: one corner (`--r`), one shadow (`--shadow-float`) and which surfaces get it (decision 15), what stays round, rings that stay.
4. **Type.** Schibsted Grotesk 400/500/600/700 through `next/font/google` (`--font-schibsted`, `--font`); base 15px / 1.47 / −0.01em; page titles 52/600/−0.04em/1.02; section headings 12/600/uppercase/0.1em under `1px solid #1c1d1b` with 10px top padding; document H1 32/600/−0.025em, H2 21/600/−0.02em, H3 17/600, body 17/1.65; tile titles 18/600; small text 13–14px.
5. **Colour.** Violet accent family; text colours; status (green, amber, violet pulsing); toast dot; selection; "no red except `#c4372b` for error text and the delete action", with the three allowed content and identity reds and the six rules allowed to use `--danger` (from `test/no-red.test.ts`).
6. **Canvas and splatter.** `#f6f6f4`; the five blobs with sizes, positions, colours and loops; the weave; the splatter's palette, opacity 0.38, geometry numbers, 90px exclusion, 30fps, DPR cap 1, reduced motion.
7. **One section per screen, in the spec's order:** nav (bar, contents left to right, the width tween and its exact order, the underline and its order, the right-edge fade, condensed state 56→46 and 12→6, the narrow-screen menu, the account menu); board; document and toolbar (sheet, toolbar inside it, sticky top, stuck shadow, tabs, tools, the alignment dropdown, menus, typography table); workspace overview; dashboard; sign-in, invite and privacy; share sheet; ⌘K palette; History panel and version pill; toasts. For each: the surfaces' fill, edge, corner and shadow, hover and press, and anything specific (the values are in the tasks' code).
8. **Motion.** The shared keyframes in `globals.css`, the `global(name)` rule for CSS modules and why (the hashing bug, with the 17 dead animations it fixed), the toast's and version pill's local keyframes, durations, `--ease`, the reduced-motion rule and its guard.
9. **Deviations from the reference.** The table, as the tasks left it, renumbered only if a row was deleted.
10. **Decisions and open questions.** This plan's "Decisions made in this plan" (all 23, with the dead-animation and nav notes), and "Questions only Dhanush can answer" with the default each was built on.

- [ ] **Step 2: The pointer in the Glass handoff**

Insert at the very top of `docs/design/glass-handoff.md`, above its title:

```md
> **Superseded on 2026-10-10 by `docs/design/gallery-handoff.md`.** The app now uses the
> Gallery look (flat white surfaces, 2px corners, violet, Schibsted Grotesk). This file is
> kept as history: its Implementation status section still records why the nav, the toolbar,
> the history panel and the splatter work the way they do, and Gallery kept those behaviours.

```

- [ ] **Step 3: Check and commit**

Check: every value in the handoff's tables matches the stylesheets (spot-check at least the nav bar, the board card, the document sheet and the toast against their CSS); every task's deviation rows are present; no placeholder text remains.

```bash
git add docs/design/gallery-handoff.md docs/design/glass-handoff.md
git commit -m "docs(gallery): the Gallery handoff, and a pointer from the Glass one"
```

Report: the final Vitest and Playwright counts against Task 1's baseline, every flaky rerun, and whether Task 4's tween fallback was needed.
