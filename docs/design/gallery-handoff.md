# Handoff: CRDT Workspace, "Gallery"

**Status: built.** On branch `gallery-redesign`, from
`docs/superpowers/plans/2026-10-10-gallery-redesign.md`. This file is the binding visual spec
from now on. `docs/design/glass-handoff.md` is history.

Where two sources disagree, the order is: this file, then the spec
(`docs/superpowers/specs/2026-10-10-gallery-redesign-design.md`), then the reference
(`docs/design/Workspace F - Gallery.dc.html`, built at its defaults: violet, canvas "gallery",
splashes "subtle", splash colour "gallery", toolbar placement "sheet"). Every place the build
differs from the reference is in the deviation table (section 9), with its reason.

Gallery is the only material. Flat white surfaces, 1px hairlines, 2px corners, one shadow,
violet, Schibsted Grotesk. No blur, no glass, no red except error and delete text.

Every value below was read from the stylesheets at commit `db4bf4e`. If a stylesheet and this
file disagree later, the stylesheet is what shipped; fix the file.

---

## 2. Codebase map

All paths are under `apps/web/` unless they start with `docs/`.

| Area | Files |
|---|---|
| Tokens, base type, selection, shared keyframes, editor typography, remote caret | `src/app/globals.css` |
| Font (Schibsted Grotesk through `next/font/google`, `--font-schibsted` on `<html>`) | `src/app/layout.tsx` |
| Favicon (violet disc, three-dot glyph) | `src/app/icon.svg` |
| Painted canvas: blobs, weave, splatter layer | `src/components/CanvasBackground.tsx`, `canvas-background.module.css` |
| Splatter: palette, geometry, painter | `src/components/PaintSplatter.tsx`, `src/lib/splatter/geometry.ts`, `src/lib/splatter/paint.ts` |
| Nav bar, width tween, condensed state, status pill, search, account menu | `src/components/AppShell.tsx`, `app-shell.module.css`, `NavTabs.tsx`, `nav-tabs.module.css`, `NavMenu.tsx`, `NavPresence.tsx`, `SyncStatus.tsx`, `status-display.ts`, `UserMenu.tsx`, `user-menu.module.css`, `LogoMark.tsx` |
| Shared primitives (surface, tile, button, field, chip, segment, pills) | `src/components/ui/ui.module.css`, `ui/Button.tsx`, `ui/TextField.tsx` |
| Sheets and toasts | `src/components/ui/Sheet.tsx`, `ui/sheet.module.css`, `ui/Toast.tsx` |
| Board | `src/components/Board.tsx`, `ColumnHead.tsx`, `board.module.css` |
| Document page and sheet | `src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx`, `document.module.css`, `src/components/DocumentEditor.tsx`, `VersionPreview.tsx`, `version-preview.module.css` |
| Document toolbar | `src/components/EditorToolbar.tsx`, `HomeTools.tsx`, `HomeMenus.tsx`, `InsertTools.tsx`, `ViewTools.tsx`, `EditorMenu.tsx`, `EditorLinkPopover.tsx`, `ToolButton.tsx`, `editor-toolbar.module.css` |
| Workspace overview and People | `src/app/workspaces/[id]/page.tsx`, `workspace.module.css`, `src/components/DocumentTile.tsx` |
| Dashboard (Workspaces) | `src/app/page.tsx`, `src/app/dashboard.module.css` |
| Sign-in, sign-up, invite | `src/app/(auth)/layout.tsx`, `auth.module.css`, `login/`, `signup/`, `invite/[token]/` |
| Privacy | `src/app/privacy/page.tsx`, `privacy.module.css` |
| Share sheet | `src/components/ShareSheet.tsx`, `share-sheet.module.css` |
| ⌘K palette | `src/components/CommandPalette.tsx`, `command-palette.module.css` |
| History panel and version pill | `src/components/HistoryButton.tsx`, `HistoryPanel.tsx`, `history-panel.module.css`, `VersionBar.tsx`, `version-bar.module.css` |
| Person colour (indigo `#4f46e5` at index 0) | `src/lib/color.ts` |

Guards (Vitest, in `test/`):

| Guard | What it enforces |
|---|---|
| `gallery-tokens.test.ts` | The token values in `globals.css`, the font variable, the 15px base, the glass tokens gone, the favicon |
| `gallery-material.test.ts` | Every stylesheet: no `backdrop-filter`, no text or drop shadow, no `filter: blur` (except the canvas blobs and the named entrance keyframes), only `var(--r)`, `50%`, `0` or `inherit` as a radius, only `var(--shadow-float)`, `none` or a `0 0 0 Npx` ring as a shadow |
| `no-red.test.ts` | No red literal in `src` except the three allowed, and `var(--danger)` only in the six allowed rules (section 5) |
| `css-motion.test.ts` | Shared keyframes live in `globals.css`; modules reach them with `global(name)`; every transition and animation sits inside `prefers-reduced-motion: no-preference`; infinite animations animate only `transform` and `opacity` |
| `css-tokens.test.ts` | Every `var(--x)` has a definition, and `--font-schibsted` is known to come from `layout.tsx` |
| `css-walk.ts` | The declaration walker the guards share |

Browser checks: `e2e/gallery.spec.ts` (computed styles per screen, the nav tween, the dead
animation fix, reduced motion). `e2e/glass-shell.spec.ts` keeps the older shell and layout
checks under their Glass-era file name.

---

## 3. Tokens

The `:root` block of `src/app/globals.css`, as built.

| Token | Value | Role |
|---|---|---|
| `--text` | `#1c1d1b` | Main text |
| `--text-2` | `#3d403b` | Body text |
| `--text-muted` | `#5f625d` | Secondary text, inactive tabs |
| `--text-faint` | `#6c6f6a` | Faint text (passes AA) |
| `--icon-faint` | `#a3a6a0` | Menu carets |
| `--danger` | `#c4372b` | The one red: error text and the delete action |
| `--accent` | `oklch(0.5 0.17 290)` | Buttons, logo, focus, underline, links in documents |
| `--accent-hover` | `oklch(0.45 0.17 290)` | Button hover |
| `--accent-text` | `oklch(0.44 0.17 290)` | Links, the active tab, chip text |
| `--accent-tint` | `oklch(0.95 0.027 290)` | Board and Page chips, the invite link panel, the chosen history row |
| `--accent-soft` | `oklch(0.5 0.17 290 / 0.12)` | The toolbar's pressed fill |
| `--accent-ring` | `oklch(0.5 0.17 290 / 0.12)` | Focus halos |
| `--ok` | `oklch(0.62 0.13 150)` | Connected dot |
| `--warn` | `oklch(0.72 0.15 65)` | Offline dot |
| `--sync` | `var(--accent)` | Syncing dot |
| `--toast-dot` | `oklch(0.64 0.17 290)` | The toast's dot: the accent 0.14 lighter |
| `--selection` | `oklch(0.9 0.027 290 / 0.6)` | `::selection` |
| `--canvas-base` | `#f6f6f4` | The page behind everything |
| `--paper` | `#ffffff` | Anything that was 60% or more opaque white |
| `--paper-soft` | `#fbfbf9` | Board columns, the sign-in and privacy cards |
| `--ink` | `#161616` | Toasts and the version pill |
| `--hairline` | `#e4e4e0` | Every surface edge |
| `--rule` | `#1c1d1b` | Section rules, and the edge a tile or card takes on hover |
| `--wash` | `rgba(40, 40, 60, 0.06)` | Hover fill for a row or tool on a white surface |
| `--shadow-float` | `0 24px 48px -28px rgba(0, 0, 0, 0.25)` | The one shadow |
| `--r` | `2px` | The one corner |
| `--field-bg` | `rgba(240, 240, 244, 0.9)` | Field fill |
| `--field-border` | `rgba(40, 40, 60, 0.12)` | Field edge |
| `--line` | `rgba(40, 40, 60, 0.07)` | Quiet dividers |
| `--sep` | `rgba(40, 40, 60, 0.12)` | Toolbar group separators |
| `--dash` | `rgba(40, 40, 60, 0.22)` | Dashed "make a new one" edges, hover borders on fields |
| `--track` | `rgba(40, 40, 60, 0.08)` | Segment tracks, slider track |
| `--ease` | `cubic-bezier(0.32, 0.72, 0, 1)` | The one easing |
| `--dur-fast` / `--dur` / `--dur-slow` | `0.3s` / `0.55s` / `0.7s` | Durations (ours; the designs write literals) |
| `--font` | `var(--font-schibsted), system-ui, sans-serif` | The family; documents store `var(--font)` |

The hex fallback for the accent is `#6d3fd6`. It is used where a CSS colour cannot go: the
favicon and the splatter palette.

Rules:

- **One corner.** `border-radius: var(--r)` (2px) on everything. Round (`50%`) stays on avatars,
  status and presence dots, the nav logo, colour swatches, the history slider thumb and the
  round close and delete buttons (the card ×, the history close). The canvas blobs keep their
  organic radius; they are paint.
- **One shadow.** `var(--shadow-float)` on floating menus, sheets and the palette, and
  nowhere else. Decision 15 lists the surfaces: the share sheet, a future card sheet, the ⌘K
  palette, the History panel, the sign-in card (and the invite and privacy cards that share
  its look), the document's page sheet, the document toolbar while stuck, every popover and
  dropdown. These get none: the nav bar, tiles, columns, board cards, the People card, toasts,
  the version pill, the meta pill.
- **Rings stay.** `0 0 0 Npx` rings are not shadows: focus halos, the drag-over inset ring, a
  peer's card ring, the selected card ring, the board card's 1px hairline ring, the toolbar's
  open-tab ring, the avatars' white ring.
- **No blur.** No `backdrop-filter` anywhere. The only `filter: blur` is the canvas blobs'
  `blur(90px)` and the entrance blur inside `@keyframes g-in` and `g-pop` (T13.4).
- **No hover lifts.** Tiles and cards turn their edge `--rule` and do not lift. The logo and the swatches do scale on hover. Presses
  (`scale(.92 to .98)`) stay.

---

## 4. Type

Schibsted Grotesk 400, 500, 600, 700, loaded with `next/font/google` in `layout.tsx` with
`display: 'swap'`. It is self-hosted at build time, and next/font's metric-matched fallback
face keeps the swap from moving text. The variable is `--font-schibsted`, set on `<html>`.
`--font` wraps it with `system-ui, sans-serif`.

| Element | Size, weight, spacing |
|---|---|
| Base (`body`) | 15px, line-height 1.47, letter-spacing -0.01em, antialiased |
| Page titles (Workspaces, the workspace name) | 52px, weight 600, letter-spacing -0.04em, line-height 1.02 (`.pageTitle`) |
| Section headings (Documents, People) | 12px, weight 600, uppercase, letter-spacing 0.1em, `1px solid #1c1d1b` above, 10px top padding |
| Global `h1` / `h2` / `h3` | 32px / 21px / 18px, weight 600; h1 -0.025em, h2 -0.02em |
| Document H1 | 32px, weight 600, line-height 1.2, -0.025em, margin 0 0 20px |
| Document H2 | 21px, weight 600, line-height 1.3, -0.02em, margin 30px 0 10px |
| Document H3 | 17px, weight 600, line-height 1.35, margin 22px 0 8px |
| Document body | 17px, line-height 1.65, `--text-2`, paragraph margin 0 0 14px |
| Tile titles | 18px, weight 600, line-height 1.3 |
| Small text | 13 to 14px (meta lines 13.5px, chips 12px, kbd 11px) |
| Sign-in and privacy headings | 30px |
| Sheet titles | 21px, weight 600, -0.02em |

The document's body and base sizes are owner ruling Q1 (section 10): 15px and 17px.

---

## 5. Colour

- **Accent: violet**, hue 290. Tokens in section 3. Text that is violet (links, the active
  tab, chip text, "Manage") uses `--accent-text`. Fills (buttons, logo, underline, selected
  palette row) use `--accent`. A document link uses `--accent` underlined.
- **Text:** main `#1c1d1b`, body `#3d403b`, secondary `#5f625d`, faint `#6c6f6a`. Two literals
  the reference uses and no token holds: `#55585f` (the search and History button labels in
  the nav) and `#0b6e99` (a peer chip's text).
- **Status:** connected green `oklch(0.62 0.13 150)`; offline amber `oklch(0.72 0.15 65)`;
  syncing the accent, pulsing (`g-pulse 1s`, infinite). The label carries the meaning in words
  as well, so the state is never colour alone. `status-display.ts` holds the mapping.
- **Toast dot:** `oklch(0.64 0.17 290)`.
- **Selection:** `oklch(0.9 0.027 290 / 0.6)`.
- **Peer ring and chip:** sky `#0ea5e9`, chip fill `rgba(14, 165, 233, 0.1)`. These are
  collaboration colours, not chrome.
- **Person colours** (`lib/color.ts`): `#4f46e5`, `#0ea5e9`, `#16a34a`, `#f59e0b`, `#8b5cf6`,
  `#14b8a6`, chosen by a hash of the user id. Index 0 was `#e11d48`; owner ruling Q3 made it
  indigo.
- **No red except `#c4372b`**, for error text and the delete action. `no-red.test.ts` allows
  exactly three red literals in `src`:
  1. `--danger` itself in `globals.css`;
  2. the editor's "Red" text colour in `editor-palettes.ts` (document content);
  3. the stroke across the "None" highlight swatch in `editor-toolbar.module.css`.

  The person colour is no longer red, so it is not on the list. `var(--danger)` may colour only
  `color`, and only in these six rules:
  `ui.module.css .danger`, `ui.module.css .error`, `history-panel.module.css .error`,
  `editor-toolbar.module.css .linkNote`, `board.module.css .columnDelete:hover`,
  `board.module.css .columnConfirmDelete`.

  Sign out, in the account menu and on the invite page, is plain `--text` (owner ruling Q5).

---

## 6. Canvas and splatter

**Canvas.** `position: fixed; inset: 0; z-index: 0`, base `#f6f6f4` (`--canvas-base`),
`pointer-events: none`. From back to front: five blobs, the splatter layer, the weave.

**Blobs.** `filter: blur(90px)`, opacity 0.55, radius `42% 58% 63% 37% / 41% 44% 56% 59%`,
colours almost neutral. Each drifts with `g-paint`, `ease-in-out`, infinite.

| Blob | Size | Position | Colour | Loop |
|---|---|---|---|---|
| `.b1` | 620 x 520 | left -140, top -160 | `oklch(0.93 0.004 90)` | 52s |
| `.b2` | 520 x 460 | right -120, top -60 | `oklch(0.94 0.004 250)` | 60s, reverse |
| `.b3` | 480 x 420 | right 18%, bottom -180 | `oklch(0.92 0.003 60)` | 68s |
| `.b4` | 520 x 440 | left 12%, bottom -200 | `oklch(0.95 0.003 200)` | 76s, reverse |
| `.b5` | 360 x 320 | left 44%, top 22% | `oklch(0.93 0.004 120)` | 84s |

The drift animates `transform` only, with no radius morph and no `will-change` (T3.3).

**Weave.** `mix-blend-mode: multiply`, two repeating gradients:
`0deg rgba(60,50,30,.018) 0 1px, transparent 1px 3px` and
`90deg rgba(60,50,30,.015) 0 1px, transparent 1px 4px`. Unchanged from Glass.

**Splatter** (`PaintSplatter.tsx`, `lib/splatter/geometry.ts`):

- Palette: `#6d3fd6` three times, `#1c1c1c`, `#454545`, `#9a9a9a`, `#e9a21f`. No red.
- Layer opacity 0.38 (`subtle`), set inline on the canvas.
- Splat scale `range(0.7, 1.4)` (owner ruling Q2).
- Geometry, unchanged from before Gallery: `BASE_CORE_RADIUS` 11; nine core circles within
  0.45 of a core radius; 10 to 23 rays with width `scale * range(1.5, 4)`, length
  `coreR * range(1.5, 5)`, tip `scale * range(1, 2.5)`, a drip on about 35%; 40 to 90 droplets
  out to about five core radii, shrinking along the list; 0 to 3 drips; `splatCount` is
  `10 + round(8 * sqrt(W * H) / 1100)`; life 16 to 32 seconds.
- Nothing is painted in the top 90px (behind the nav), splats and specks both.
- Redrawn at about 30fps (`MIN_FRAME_MS` 32), device pixel ratio capped at 1, one frame under
  reduced motion, paused on a hidden tab.

---

## 7. Screens

The surface, edge, corner and shadow of each piece, then anything specific. "White" is
`--paper`; "hairline" is `1px solid var(--hairline)`; "float" is `var(--shadow-float)`.

### Nav

**Wrapper** (`.navWrap`): sticky at the top, z-index 30, padding `12px 16px 0`, a constant
in-flow height of 68px (12 + 56). Its children sit in a centred column.

**Bar** (`.nav`): white, `1px solid rgba(40, 40, 60, 0.1)` (the spec's own edge, a shade
darker than the hairline), 2px corners, no blur, no shadow. Height 56px, gap 10px, padding
`0 8px 0 10px`, `width: fit-content`, `max-width: 100%`. The bar is as wide as its contents
and centred. Entrance `g-pop 0.6s`.

**Contents, left to right:**

1. Logo: a 36px round `--accent` disc, 5px padding around the LogoMark glyph. Hover rotates
   -8deg and scales 1.05; press scales 0.92.
2. "Workspaces" link: 32px high, `0 14px`, 14px/500 `--text-muted`. On the dashboard it is the
   current page: 600 and `--accent-text`.
3. Workspace name (workspace pages only): 36px high, `0 12px`, 15px/600, `max-width: 240px`
   with an ellipsis. Hover fills `--wash`.
4. A 1px by 22px divider, `rgba(0, 0, 0, 0.08)`.
5. The tab strip (below).
6. "View only" chip, for viewers.
7. Search button: 36px high, min-width 170px, field fill and field edge, 14px `#55585f`, with a
   `⌘K` chip (11px, white, field edge). Hover turns white with a `--dash` edge.
8. Presence avatars, on a document: 28px circles, a `0 0 0 2px #fff` ring, 12px/600 white
   initials, overlapping by 7px. Hover scales 1.06; no lift.
9. History button, on a document: 36px high, `0 14px`, field style, 14px `#55585f`; white while
   open.
10. Status pill: 36px high, `0 14px`, field style, 14px `--text-2`, an 8px dot, then the label.
11. Share button (workspace pages): the accent `Button`, 36px high.
12. Account avatar: a 36px white circle with an inset 1px field edge, the initial in your
    colour at 14px/700.

**Tab strip** (`.strip`): `flex: 0 1 auto`, `min-width: 120px`, padding 3px, gap 2px,
scrolls sideways when full, scrollbar hidden. A tab is 32px high, `0 14px`, 14px/500
`--text-muted`; hover `--text`; the open tab is 600 and `--accent-text`. A 6px `--ok` dot marks
a tab that others have open. The strip must stay `flex: 0 1 auto` and the Workspaces link
`flex: none`; a growing child makes the bar fill the window and the centring is lost.

**Underline** (`.indicator`): 2px `--accent` at the bottom of the strip. `NavTabs` places it with
`transform: translateX(offsetLeft)` and `width: offsetWidth`, both measured from the open tab,
and keeps the last position at module level (`lastMetrics`), so it slides across page changes.
It transitions `transform` and `width` over `--dur` with `--ease`, and `opacity` over
`--dur-fast`. Order of a tab change:

1. The strip renders with the remembered metrics and, when there were some, the transition
   class already on.
2. `useLayoutEffect` reads `offsetLeft` and `offsetWidth`, which forces style and layout with
   the old transform committed.
3. `setMetrics` re-renders synchronously with the new transform and width, which the browser
   transitions.

On the very first mount there is no remembered position: the underline is placed at opacity 0
then 1 with no transition, and the transition class is added two frames later, so it never
grows from nothing. `NavTabs` also re-measures when fonts are ready (a font swap can change tab
widths without resizing a clamped strip). Under reduced motion the transition rules do not
apply and `scrollTo` uses `behavior: 'auto'`.

**Right-edge fade.** `mask-image: linear-gradient(90deg, #000 82%, transparent)`, set inline
only while `scrollWidth > clientWidth + 2` and the strip is not scrolled to its end; re-read
on scroll and resize. A two-tab strip never fades.

**Width tween** (`AppShell.tsx`). `lastNavWidth` is a module-level variable. When the nav
mounts or its contents change, the layout effect:

1. sets `transition: none` and the bar's width to the old width;
2. forces layout (`void bar.offsetWidth`);
3. sets `transition: width var(--dur) var(--ease)` and the new width, in the same task.

The inline width and transition are cleared on the bar's own `transitionend` for `width` (a
child's colour or height ending is ignored), with a 1000ms timeout as a backstop. It is skipped
under reduced motion, on a hard load (nothing to start from), and when the width moved less
than 1px. While a document is still connecting, the bar is held at its old width rather than
shrinking to placeholders; the hold ends when the document has connected (plus a 300ms grace
for people to arrive) or after 3 seconds. A `ResizeObserver` keeps `lastNavWidth` equal to what
is on screen. The first-mount fallback the plan allowed for was not needed.

**Condensed state.** After 24px of scroll the bar goes 56px to 46px and the wrapper's top
padding goes 12px to 6px, over 0.4s with `--ease`. It un-condenses at 12px or less (a dead
band, so a one-pixel wobble does not flip it). The wrapper's own height does not change.
`--nav-bottom` on the shell is 68px, or 52px condensed; the toolbar, the History panel and the
version pill read it. The decision-13 note: 68 and 52 are these wrapper totals; the spec's
"68 to 52" needed no change.

**Narrow screens.**
- Below 1100px the search label hides (the `⌘K` chip stays), and the status label and the
  presence avatars are clipped to 1px, not `display: none`, so they stay in the accessibility
  tree. The status pill pads `0 13px`.
- Below 760px the tab strip becomes one dropdown (`NavMenu`), and the workspace name, the
  divider and the Workspaces link hide. The trigger is 32px high, field style, 14px/600, with a
  caret. Its list opens 10px under the trigger: 220 to 280px wide, padding 6px, white, hairline,
  float, `g-pop 0.45s`; items are `8px 12px`, 14px, hover `--wash`, the current one 600 and
  `--accent-text`.

**Account menu** (`.popover`): `top: 48px; right: 0`, 220px wide, padding 6px, white,
hairline, float, `g-pop 0.45s`. Name 14px/600, email 13px `--text-faint`. Items are 38px high,
`0 12px`, 14px `--text`, hover `--wash`. "Sign out" is plain text.

### Board

- **Scroller:** `padding: 20px 16px 16px`, gap 16px, centred when the columns fit and
  scrolling when they do not (`width: fit-content; max-width: 100%`).
- **Title** (`.boardHeading`): 21px/600, -0.02em, max-width 1000px, `margin: 24px auto 0`,
  padding `0 18px`.
- **Column:** 290px wide, padding 14px, `--paper-soft`, hairline, 2px corners. Dragged over:
  white with an inset `0 0 0 2px var(--accent)` ring. No transition (the held-drag test reads
  the ring mid-drag, and the column never animated). Title 15px/600. Count chip: 22px high,
  `rgba(0,0,0,.05)`, 12.5px/600.
- **Card:** white, padding `14px 16px`, `box-shadow: 0 0 0 1px var(--hairline)` instead of a
  border, 2px corners, `cursor: grab`. Title 14.5px/1.35. Hover (no peer, not selected): the
  ring turns `--rule`; no lift (T5.2, T5.7). A peer's ring is `0 0 0 2px #0ea5e9` with no glow,
  the selected ring is `0 0 0 2px var(--accent)`, and hover keeps both. Press scales 0.98.
  Entrance `g-in 0.5s`; transitions on `transform` and `box-shadow` over `--dur-fast`. Dragging
  drops the card to opacity 0.4.
- **Card delete ×:** a 24px round, `rgba(0,0,0,.05)`, hover `rgba(0,0,0,.1)`.
- **Peer chip:** `rgba(14,165,233,.1)` fill, `#0b6e99` text, 12px/500, 2px corners; a 18px
  round avatar inside.
- **"+ Add a card":** 36px high, white, hairline, 14px/500 `--text-2`; hover turns the edge
  `--rule`. **"+ Add a list":** 230 by 54px, white, `1.5px dashed var(--dash)`, same hover.
  Press scales 0.97.
- **Column title field:** reads as the heading; hover `--wash`; focus white with a 1px accent
  ring and a 4px `--accent-ring` halo.
- **Column delete ×:** 24px, square (2px corners), transparent; hover `rgba(0,0,0,.06)` with the
  glyph in `--danger`. See Known limitations: it is square where the card × is round.
- **Delete confirmation:** 13px `--text-2`; the Delete button is `--danger` text on
  `rgba(0,0,0,.05)`, Cancel is `--text` on the same grey, both 28px high, 2px corners.

### Document and toolbar

**Page sheet** (`.page`): max-width 780px (1040px for Wide, tweened over `--dur`), margin
`28px auto 64px`, white, hairline, 2px corners, **float** (decision 15, ruling Q4). Text
padding is on `.body`: `56px 56px 96px`, with 40px on top when the toolbar is inside the sheet.
The document's title is the first thing in the sheet (margin 0 0 20px, line-height 1.2); its
input inherits the heading's type exactly, so editing does not move text. A board does not sit
on this sheet.

**Toolbar** (`.root`): inside the sheet at its top, `position: sticky`, `top: calc(var(--nav-bottom,
68px) + 12px)` (80px at rest, 64px when the nav condenses, T6.4), z-index 20, padding
`10px 10px 0` (inset 10px). The `.panel` is white with a hairline and 2px corners, and takes
float only while stuck (`data-stuck`, re-read after the nav condenses); the shadow transitions
over `--dur-fast`. Entrance `g-fade 0.4s`; `top` transitions over 0.4s. The floating placement
above the sheet is not built.

- **Tabs row:** padding `7px 10px 0`, gap 4px. Home, Insert, View. A tab is 28px high, `0 13px`,
  13px/500 `--text-muted`. The open tab is a white chip with a `0 0 0 1px var(--hairline)` ring,
  `--accent` text, 600. A "View only" chip (22px high, `rgba(40,40,60,.06)`) and the word count
  (12.5px, faint, tabular numbers, pushed right) sit on this row. A 1px `--line` divider
  (`margin: 7px 12px 0`) separates it from the tools.
- **Tools:** padding `7px 8px`, gap 2px, min-height 48px. A tool is 32px high, min-width 32px,
  padding `0 7px`, 13.5px `--text-2`, icons 16px with stroke 1.6. Hover fills `--wash` (not on an
  active, expanded or disabled tool). Active or expanded: `--accent-soft` fill, `--accent`
  text. Press scales 0.92. Groups are separated by a 1px by 20px `--sep` rule with 6px margins.
  A spent limit (zoom at its end) is `aria-disabled`, `--text-faint`, with no hover.
- **Style field:** a 150px tool with a field edge and a white fill that stays white under the
  pointer; expanded, the edge is `--accent`.
- **Alignment:** one dropdown (`tb-align`): the trigger shows the current alignment's icon and a
  small caret; the list is 170px wide, padding 6px, with four 36px rows (icon, label); the
  current row reads as pressed (`--accent-soft`, `--accent`).
- **Menus** (every dropdown and popover): absolute, `top: 40px; left: 0`, z-index 5, padding 8px,
  white, hairline, 2px corners, float, `g-pop 0.4s`. Style list 240px wide, rows min-height
  38px with padding `4px 12px`, drawn in their own style, shortcut at the right. Colour menus
  170px wide: a 12px/600 title, then two rows of four 28px round swatches with 8px gaps, hover
  scales 1.12. The "None" swatch is white with a `#c4372b` diagonal.
- **Link popover:** 330px wide, padding 6px, gap 6px. Input 34px high, field edge, white, focus
  `--accent` edge plus a 4px `--accent-ring` halo, invalid edge `--rule`. "Add" is the accent
  button, "Remove" is `--wash`. The error line under it is `--danger`, 12.5px.
- **View tab:** "Zoom" and "Page width" are plain 12.5px faint labels. The current zoom is a
  58px-minimum button. Narrow | Wide is a segmented control: a `--track` of padding 3px, 26px
  segments, the chosen one white with no shadow.

**Editor typography** (`.editor .ProseMirror` in `globals.css`): see section 4 for headings
and body. Also: blockquote `3px solid oklch(0.5 0.17 290 / 0.35)` on the left, padding
`2px 0 2px 18px`, margin 18px 0, `--text-muted`; code block 14px monospace, padding
`14px 16px`, `rgba(40,40,60,.05)` fill, 2px corners; lists indent 24px, items 4px apart;
rule `1px rgba(40,40,60,.14)`, margin 28px; table with a `1px rgba(40,40,60,.14)` edge, 2px
corners, 15px text, cells `8px 12px` with `rgba(40,40,60,.1)` rules; links `--accent`,
underlined, offset 2px; the caret colour is `--accent`. A remote caret's label is 11px/500
white on the person's colour, 2px corners, no shadow.

### Workspace overview

- **Page:** max-width 960px, padding `40px 16px 64px`, gap 44px, entrance `g-in --dur-slow`.
- **Header:** the 52px page title, then the meta pill. The meta pill (`.metaPill`) is white
  with a hairline, 2px corners, padding `5px 14px`, 14px/500 `--text-2`, `width: fit-content`.
- **Section headings:** Documents and People, as in section 4.
- **Document grid:** `repeat(auto-fill, minmax(230px, 1fr))`, gap 16px.
- **Document tile:** `.surface` plus `.tile`: white, hairline, 2px corners, padding 22px,
  inner gap 40px. Hover turns the edge `--rule` with no lift and no shadow; press scales 0.98.
  Title 18px/600/1.3; updated time 13.5px faint. A chip (Board or Page) is 22px high,
  `rgba(0,0,0,.05)`, 12px/500; the accent chip is `--accent-tint` with `--accent-text`.
- **Rename pencil:** 28px square at top 10, right 10, white with a field edge, shown on hover
  or keyboard focus (always on touch). The wrapper's `:hover` keeps the tile's dark edge while
  the pointer is on the pencil (T13.1). The rename field is 18px/600/1.3 with a 1px accent
  ring and a 4px halo (T13.2).
- **Create tile:** `.tileCreate`, white, `1.5px dashed var(--dash)`, padding 22px; its inputs
  are white with `rgba(40,40,60,.14)` edges. The Page | Board choice is a segmented control.
- **People card:** `.surface`, `overflow: hidden`. Rows padding `14px 18px`, a
  `rgba(0,0,0,.05)` rule between them, a 34px round avatar, name weight 500, email 13px faint,
  role 13px muted. "Manage" is 13.5px/500 `--accent-text`, inside the card.
- **Fields:** `.pillInput` is 40px high, padding `0 16px`, `--field-bg` with a field edge,
  14.5px; focus turns it white with an `--accent` edge and a 5px `--accent-ring` halo.

### Dashboard (Workspaces)

- **Page:** the same shell as the overview, gap 28px; the 52px title.
- **Grid:** `repeat(auto-fill, minmax(250px, 1fr))`, gap 16px.
- **Workspace tile:** `.surface` plus `.tile` (white, hairline, padding 22px, gap 32px, hover
  edge `--rule`). The initial is a 44px `--accent` square with 2px corners, `--paper` text,
  18px/600. Name 18px/600; meta 13.5px `--text-muted`.
- **Create tile:** dashed, as the overview's; the create button is the accent `Button`.

### Sign-in, invite and privacy

- **Sign-in card:** `max-width: 400px`, padding `44px 40px`, gap 28px, centred text,
  `--paper-soft`, hairline, 2px corners, **float** (decision 15, ruling Q4). Entrance
  `g-sheet --dur-slow`. The invite page uses the same card.
- **Mark:** a 52px `--accent` square with 2px corners and 7px padding that keeps the LogoMark
  three-dot glyph inside it (T10.4).
- **Heading** 30px; the lede is `--text-muted`; the small print is 13px faint.
- **Provider buttons:** 50px high, 2px corners, 500 weight, gap 10px. The accent one is
  `--accent` with white text; the secondary is white with a hairline. No hover lift, no
  shadow, colour unchanged on hover; the press scales 0.97 (T10.1). A disabled one is 0.5
  opacity.
- **Errors:** `.error`, white with a hairline, text in `--danger`.
- **Privacy card:** the same look, `max-width: 640px`, padding 40px (28px 22px below 520px),
  gap 14px, left-aligned; the `h2` is 18px.

### Share sheet

- **Overlay:** `position: fixed; inset: 0`, z-index 50, padding `72px 16px 16px`, veil
  `rgba(30, 40, 35, 0.16)` with no blur (T11.2); entrance `g-fade 0.35s`.
- **Sheet:** white, hairline, 2px corners, **float**, padding `26px 26px 22px`; entrance
  `g-sheet --dur-slow`. Title 21px/600/-0.02em, margin 0 0 18px.
- **Invite row:** one white container with a **`--hairline`** edge (as the reference), padding
  `4px 4px 4px 14px`, gap 6px. Inside: a borderless 34px input at 14.5px, a role select (30px
  high, `rgba(0,0,0,.05)`, 13.5px) and the Add button. Fields elsewhere in the sheet, such as
  the invite link input, keep **`--field-border`**: the container is a surface, the link input
  is a field (T11.4). While its input has focus the row's edge turns `--accent` with a 4px
  `--accent-ring` halo (T14.1); the input draws no outline of its own. The link input is 36px high, white, 13px; focus turns the edge `--accent`
  with a 4px `--accent-ring` halo.
- **Link panel:** `--accent-tint` fill, 2px corners, padding 12px, shown after inviting or
  after Copy link. The note is 13px `--text-2`.
- **People list:** rows padding `8px 4px`, a 36px round avatar, name weight 500, email 13px
  faint, role 13px muted. A pending invitation has a transparent avatar with a
  `1.5px dashed var(--dash)` edge. The invited list has a `--line` rule above it.

### ⌘K palette

- **Overlay:** z-index 55, padding `110px 16px 16px`, veil `rgba(30, 40, 35, 0.1)`, no blur,
  `g-fade 0.35s`.
- **Sheet:** `max-width: 580px`, white, hairline, 2px corners, `overflow: hidden`, **float**;
  entrance `g-sheet --dur-slow` (T11.3).
- **Input:** 60px high, padding `0 22px`, 16px, a field-edge rule below. On focus (it opens
  focused) the rule turns `--accent` and an inset 3px `--accent-ring` washes the edge (T14.2). List padding 8px, max
  height 46vh. Rows are 46px high, padding `0 14px`, 14.5px `--text-2`. The chosen row is
  `--accent` with white text. The kind label is 12px at opacity 0.7.

### History panel and version pill

- **Panel:** fixed, `top: calc(var(--nav-bottom, 68px) + 16px)`, `right: 16px`, `bottom: 16px`,
  330px wide, z-index 25 (above content, below the nav at 30). White, hairline, 2px corners,
  **float** (T12.2). Entrance `g-side 0.6s`; `top` follows the nav over 0.4s. It is portalled to
  `<body>`, with `--nav-bottom` copied on as an inline property.
- **Header:** padding `20px 20px 10px`, title 18px/600, a 30px round close button
  (`rgba(0,0,0,.05)`).
- **Slider:** the native range input with its track and thumb drawn: track 4px `--track`, thumb
  18px round `--accent` with a 2px white border and no glow; hover `--accent-hover`; end labels
  12px faint.
- **Rows:** padding `10px 12px`, 2px corners; hover `--wash`; the chosen row
  (`aria-pressed`) `--accent-tint` (T12.1). A 32px round avatar, description 14px/500, meta
  12.5px faint (`--text-muted` on the chosen row, T14.3). Notes 14px `--text-muted`; errors 14px `--danger`; Retry `rgba(0,0,0,.05)`.
- **Version pill** (`.bar`): fixed at `calc(var(--nav-bottom, 68px) + 8px)`, centred with auto
  margins, z-index 26. `--ink` fill, white 14px/500 text, padding `6px 6px 6px 18px`, 2px
  corners, **no shadow** (T12.3). Its buttons are 30px high, `rgba(255,255,255,.12)`; the primary
  one is white with `--text`. Entrance: its own `rise 0.55s`.
- **Preview:** the incoming view fades in over 0.4s (`g-fade`, through `global()`). If a version cannot be previewed, a white
  note with a hairline sits above the live view (max-width 780px, 13px).

### Toasts

Fixed, `bottom: 28px`, centred by `.toastWrap` (not by the toast), z-index 60. A toast is
`--ink` with white 14px/500 text, padding `10px 18px`, 2px corners, **no shadow** (T11.1), with
an 8px round `--toast-dot` before the words. It rises with its own `up 0.55s` (T3.2) and
leaves after 3200ms.

---

## 8. Motion

Existing motion is kept except the hover lifts, which are gone.

**Durations and easing.** `--ease` is `cubic-bezier(0.32, 0.72, 0, 1)` everywhere. `--dur-fast`
0.3s for colour, border and background changes; `--dur` 0.55s for the nav width, the underline
and the sheet's width; `--dur-slow` 0.7s for page and sheet entrances. A few literal times stay
where the designs write them: 0.4s (nav height, wrapper gap, sticky `top`, press transforms),
0.45s (small menus), 0.35s (overlay fades), 0.6s (nav and History entrances).

**Shared keyframes** (only in `globals.css`):

| Name | Does |
|---|---|
| `g-in` | Fade, rise 14px, blur 6px to none (pages, board cards) |
| `g-pop` | Fade, drop 6px, scale 0.96, blur 4px to none (nav, menus, popovers) |
| `g-sheet` | Fade, rise 24px, scale 0.97 (sheets, the palette, the auth card) |
| `g-side` | Fade, slide in 28px from the right (History panel) |
| `g-fade` | Opacity only (overlays, the toolbar, tool rows) |
| `g-up` | Fade, rise 16px, scale 0.96, with `translate(-50%)` for a self-centring element. Defined and unused here, because the toast has its own `up` |
| `g-pulse` | Opacity 1 to 0.4 and scale 1 to 0.8 (syncing dot) |
| `g-paint` | Translate, rotate, scale drift (canvas blobs); transform only |

The entrance blur in `g-in` and `g-pop` is motion, and the material guard exempts those two
keyframes by name (T13.4).

**Local keyframes.** `up` in `ui/sheet.module.css` (the toast, without the -50%), `rise` in
`version-bar.module.css` (the pill), `fade` in `version-preview.module.css`.

**The `global(name)` rule and why.** The CSS-module build hashes every animation name inside a
module (`app-shell_g-pop__eL_lj` in the built CSS), while the shared keyframes live unhashed in
`globals.css`. So 17 module animation declarations in 12 files pointed at keyframes that did not
exist, and every module entrance was dead, the canvas blobs' `g-paint` included. Next's bundled
`postcss-modules-local-by-default` honours a `global(name)` function inside `animation` and
`animation-name` and emits the bare name (`animation: global(g-pop) .6s` compiles to
`animation: g-pop .6s`). So every module writes `global(g-...)` for a shared keyframes and keeps
one set in `globals.css`. Rejected: per-module copies (eight keyframe sets across twelve files,
drifting apart) and a utility class (it needs `:global` selectors or class changes in every
component). A module may still use a bare name for keyframes it defines itself (`up`, `rise`,
`fade`). `css-motion.test.ts` fails on a bare shared name in a module, and `gallery.spec.ts`
proves the animations run. `globals.css` itself must not use `global()`.

**Reduced motion.** Every transition and animation sits inside
`@media (prefers-reduced-motion: no-preference)`; `css-motion.test.ts` enforces it for every
stylesheet. JavaScript motion checks `matchMedia('(prefers-reduced-motion: reduce)')` and skips:
the nav width tween, the splatter loop (one still frame), and smooth scrolling in the tab strip.
Under reduced motion the nav bar never sets a width transition, and the underline's transition
is 0s.

**Performance rule.** Endless animations may animate only `transform` and `opacity`
(`css-motion.test.ts`). See T3.3 for the measurement behind it.

---

## 9. Deviations from the reference

The reference is `docs/design/Workspace F - Gallery.dc.html`, built at its defaults (violet,
canvas "gallery", splashes "subtle", splash colour "gallery", toolbar placement "sheet").
Each row is a place the build differs from it, or from the code before Gallery, and why.
Rows were added by the task that made the decision, numbered `T<task>.<n>`. Three were added
when the records were written, from review findings: T5.7, T10.4 and T11.4. T14.1 to T14.3 came
from the final review.

| # | Where | Reference or before | Built | Why |
|---|---|---|---|---|
| T1.1 | Font loading | A `<link>` to fonts.googleapis.com | `next/font/google`, self-hosted, with a metric-matched fallback face | The spec ("Type") asks for Next's font mechanism and no layout shift; no request goes to Google from the browser. |
| T1.2 | Base and document body size | Code before: 16px base, 18px body (Dhanush, 2026-10-03) | 15px base, 17px body | The spec's "Type" tables. Open question 1 in the plan. |
| T1.3 | `--accent-soft` | The reference writes the accent at 12% inline | A token, equal to `--accent-ring` | One name for the toolbar's pressed fill. |
| T1.4 | Test premise: character height in the peer-caret zoom test (`e2e/editor-toolbar.spec.ts`) | A character box about 21px tall at 100% (system font, 18px) | `GLYPH_HEIGHT = 22`, band unchanged (+-1.5) | Schibsted Grotesk's box is taller (measures 15, 23 and 33 at 70, 100 and 150%). The font moved the premise, not the behaviour. Task 6 changes the body to 17px and must recheck it. |
| T2.1 | Splatter palette | Reference "gallery": eight entries, `#1c1c1c` twice, reds mapped to violet | `#6d3fd6` ×3, `#1c1c1c`, `#454545`, `#9a9a9a`, `#e9a21f` | The spec's list (decision 6). |
| T2.2 | Splatter geometry | Reference: its own generator (sizes 14–40px) | `lib/splatter/geometry.ts` unchanged: core 11px, rays `scale × range(1.5, 4)` wide and `coreR × range(1.5, 5)` long, tip `scale × range(1, 2.5)`, droplets out to about ×5 and shrinking (`coreR * (1 + t*4 + range(0, 0.2))`, so the spec's "×4" understates the code; section 6 has the real figure), `10 + 8·√(W·H)/1100` splats | The spec keeps the agreed numbers (decision 7); the code is the record, and the spec's "×4" is the one that is off. |
| T2.3 | Splat scale | Spec table `range(0.6, 1.2)` | `range(0.7, 1.4)`, as shipped | Dhanush's 2026-10-03 decision; the spec asks for the choice to be recorded (decision 11, question 2). |
| T2.4 | Offline status dot | Code before: `--danger` (red) | `--warn` (amber) | The spec's status table (decision 14). |
| T2.5 | Sign out | Reference `#c4372b` | `--text` | Red is for errors and delete only (decision 8, question 5). |
| T2.6 | Error box, invalid field, column delete confirm | Code before: red tint and border; red field border; red fill | White box with a hairline; `--rule` field edge; `--danger` text on grey | Only error and delete *text* is red (decision 20). |
| T2.7 | Red that stays | None | Editor "Red" text colour and the "None" highlight swatch's stroke | Content colours, not chrome (decision 16). Named in `test/no-red.test.ts`. |
| T2.8 | Person colour `#e11d48` | Plan decision 16 and the reference (`Margaret: #e11d48`): kept | Indigo `#4f46e5`, same palette index (`lib/color.ts`) | Dhanush's ruling on question 3: no red anywhere but error and delete text. People whose hash lands on index 0 change colour; the colour is derived per session from the user id, nothing stored. `no-red.test.ts` does not allow `#e11d48`. |
| T3.1 | Entrance animations | Reference: inline `animation: g-pop …` | `global(g-pop)` and friends in every CSS module; one set of keyframes in `globals.css` | CSS modules hashed the names, so 16 module animations (the canvas blobs among them) never ran; the toast's own `up` makes 17 declarations (T3.2). Guarded by `test/css-motion.test.ts`. |
| T3.2 | Toast entrance | Reference `g-up` (translate −50%) | A module-local `up` without the −50% | The toast here is centred by its wrapper (decision 23). |
| T3.3 | Canvas blob drift (`g-paint`) | Reference: translate/rotate/scale plus a `border-radius` morph | Translate/rotate/scale only; no `will-change` | With the animation finally running, the radius morph repainted five `blur(90px)` layers on the main thread every frame (134fps vs 144 static on a GPU Mac, about 15fps headless) and is invisible at these colours. `css-motion.test.ts` limits infinite animations to `transform` and `opacity`. No `will-change: transform` hint: a running transform animation is promoted to its own layer anyway, and on the permanent blurred layers the hint made headless frames about twice as slow (about 130ms against 65ms). Real-GPU measurement from review: transform-only matched a static page at 144fps; the radius morph gave 134fps. |
| T4.1 | Nav bar | Reference: floating shadow under the bar | No shadow | The spec: "No blur, no shadow" (decision 1). |
| T4.2 | Workspace name hover | Reference `#fff` on the white bar | `--wash` | Invisible otherwise (decision 17). |
| T4.3 | Presence avatars hover | Code before: `translateY(-3px) scale(1.06)` | `scale(1.06)` | No hover lifts (decision 2). |
| T4.4 | Status pill text | Code before `#55585f` | `--text-2`, as the reference; the search label keeps `#55585f` | The reference's values per control. |
| T4.5 | Syncing dot | Reference `c-pulse 1s` (undefined in the reference) | `g-pulse 1s` infinite, reduced-motion guarded | Decision 22. |
| T4.6 | `Button` variant | `glass` | `plain` | No glass; no caller used it. |
| T4.7 | Test premise: reduced-motion nav test (`e2e/gallery.spec.ts`) | The brief samples the bar's inline `width` and expects `''` throughout | Samples the inline `transition` and expects no `width` in it | While a document is still connecting, the bar is held at its old width (an inline width with `transition: none`) whether or not motion is reduced; whether a hold happens depends on how warm the dev server is, so the test passed alone and failed after other nav tests. A tween is what sets an inline width transition, so that is what the test now forbids. Behaviour unchanged. |
| T5.1 | Card peer ring | Reference `0 0 0 2px #0ea5e9, 0 4px 14px rgba(14,165,233,.18)` | `0 0 0 2px #0ea5e9` | No shadows but the float (decision 5). |
| T5.2 | Card hover | Reference: white ring plus the floating shadow | `0 0 0 1px #1c1d1b`, no lift | Spec, "Hover" (decision 2). |
| T5.3 | "+ Add a card" | Reference `#fbfbf9` on the `#fbfbf9` column | White with a hairline; hover darkens the edge | The reference's fill is invisible on its column. |
| T5.4 | Column transitions | Reference: `background .4s, box-shadow .4s` | None, as before | The held-drag test reads the drag-over ring mid-drag; the column never animated. |
| T5.5 | Column delete confirm | Code before: red fill | `--danger` text on the Cancel grey | Decision 20 (made in Task 2). |
| T5.6 | Test premise: board material test (`e2e/gallery.spec.ts`) | The brief reads the card straight after adding it | Parks the pointer at (0, 0) first | The new card lands under the pointer (it takes the "+ Add a card" button's place), so the resting-state test read the hover ring. Behaviour unchanged. |
| T5.7 | Card hover while a peer or the selection is on the card | Code before and the first Gallery build: `.card:hover` replaced any ring | `.card:hover:not(.cardPeer):not(.cardSelected)` takes the dark `0 0 0 1px var(--rule)` edge; a peer's `0 0 0 2px #0ea5e9` and the selected `0 0 0 2px var(--accent)` ring stay under the pointer | The spec says rings stay. They are collaboration state, and hovering must not hide who else is on a card. A controller fix after the Task 5 review (commit 6c3b12d), with a test. |
| T6.1 | Toolbar when stuck | Reference `inset 0 1px 0 #fff, 0 1px 2px rgba(30,30,50,.05), 0 8px 22px rgba(30,30,50,.12)`; border `rgba(40,40,60,.08)` | `var(--shadow-float)`; `1px solid var(--hairline)` | The spec: "hairline border", "the floating shadow" (decision 9). |
| T6.2 | Toolbar's open tab | Reference: white chip, `0 1px 3px rgba(30,30,50,.12)` | White chip with a `0 0 0 1px` hairline ring | No small shadows; a white chip on a white bar needs an edge (decision 10). |
| T6.3 | Tool hover | Reference `#fff` on the white bar | `--wash` | Invisible otherwise (decision 17). |
| T6.4 | Sticky top | Reference `top:80px` fixed | `calc(var(--nav-bottom) + 12px)`: 80px at rest, 64px when the nav condenses | Existing motion is kept (decision 18). |
| T6.5 | Toolbar entrance | Code before `g-pop .6s` (floating) | `g-fade .4s`, the reference's for the in-sheet bar | Decision 19. |
| T6.6 | Page sheet shadow | Spec lists "sheets" | The page sheet has the floating shadow, as the reference draws it | The spec calls it "the page sheet" (decision 15, question 4). |
| T6.7 | Narrow/Wide segment | Reference: white with `0 1px 3px` | White on the grey track, no shadow | Decision 10. |
| T6.8 | Remote caret label | Code before `0 4px 10px` shadow, pill | No shadow, 2px corners | No shadows; the reference's label has none. |
| T6.9 | Document h3 | Code before 18px (level with the 18px body) | 17px | Moves with the 17px body; the reference's 17px. |
| T6.10 | Test premise: caret test glyph height (`e2e/editor-toolbar.spec.ts`) | A hard-coded `GLYPH_HEIGHT = 22`, measured at 18px text, with a band of ±1.5 | The character box is measured once at 100% and every zoom's band is scaled from it, with the band `1.5 + 0.5 * scale` | The constant moved with the font (17px reads 21, not 22). The band is wider by half a pixel of the scale because the 100% reading is itself snapped to whole pixels and the scale carries that along (at 18px a box read 23 and 33 at 150%, not 34.5). Zoom that does not apply still misses by 6 to 10px; every drift assertion is unchanged. |
| T7.1 | Alignment | Code before: four buttons in the Home row | One dropdown (`tb-align`), a 170px listbox of the four; the four test ids move into it | The spec: "grouped into one dropdown"; values from the reference's align menu. |
| T7.2 | Test premise: tool row stop count (`e2e/editor-toolbar.spec.ts`, "a menu's items are not stops of the tool row") | More than 14 stops (four alignment buttons in the row) | More than 12 (13 stops: the four buttons became one trigger); Alignment joins the menus checked, and the order check gains Numbered list, Alignment, Clear | Not in the plan's "Tests that change" table; the stop count fell by three with the grouping. Behaviour unchanged. |
| T8.1 | Document tiles and People card | Reference `#fbfbf9`, hover `#fff` plus the floating shadow | `#ffffff`; hover darkens the edge to `#1c1d1b`; no lift, no shadow | They were .7 glass, and the spec maps 60%+ white to `#ffffff`; hover per the spec (decisions 2, 3). |
| T8.2 | Board/Page chip text | Reference `oklch(acc − 0.04)` = `oklch(0.46 0.17 290)` | `--accent-text` (`oklch(0.44 0.17 290)`) | One token for violet text; 0.02 darker, so contrast only improves. |
| T8.3 | Page/Board segment | Reference: white with `0 1px 3px` | White on the grey track, no shadow | Decision 10. |
| T8.4 | People "Manage" link | Reference: beside the People heading | Inside the People card, where it was | Layout is not in scope (decision 21). |
| T8.5 | `ui` class names | `.glass`, `.bgPill` | `.surface`, `.metaPill` | Names that say what they are now. |
| T9.1 | Workspace tiles | Reference `#fbfbf9`, hover `#fff` plus the floating shadow | `#ffffff`; hover darkens the edge; no lift | Decisions 2 and 3, as the overview's. |
| T10.1 | GitHub sign-in hover | Reference `translateY(-1px)` plus the floating shadow | No lift, no shadow, colour unchanged; the press stays | No hover lifts (decision 2); the owner's earlier "colour stays" rule. |
| T10.2 | Sign-in, invite and privacy card shadow | Spec lists "sheets" | The floating shadow, as the reference draws it | The card enters as a sheet does (decision 15, question 4). |
| T10.3 | Class name | `.providerGlass` | `.providerSecondary` | No glass. |
| T10.4 | Sign-in, invite and privacy mark | Reference: a bare violet square | A 52px violet square with 2px corners that keeps the LogoMark three-dot glyph inside it (7px padding) | Dhanush chose logo B (the three-dot glyph) on 2026-10-09; the nav logo, the favicon and this mark stay the same glyph. Only the shape around it follows the reference. |
| T11.1 | Toast | Reference: floating shadow | No shadow; padding kept at 10px 18px | The spec's shadow list excludes toasts (decision 4); sizes are not in scope. |
| T11.2 | Sheet veil | Code before `rgba(30,40,35,.16)` with `blur(8px)` | The same colour, no blur | No blur anywhere. |
| T11.3 | Palette entrance | Reference `g-pop .5s` | `g-sheet` over `--dur-slow`, as before | Existing motion is kept. |
| T11.4 | Share sheet borders | Reference: the invite row's container border is the hairline; its fields are not mentioned | The invite row's container uses `var(--hairline)` (`#e4e4e0`). Fields, such as the invite link input, keep `var(--field-border)` (`rgba(40,40,60,.12)`) | The spec: hairlines replace the white glass borders, and fields keep their own edge. The container is a surface; the link input is a field. Both are intended. |
| T12.1 | History rows | Reference: hover and selected `#fff` on the white panel | Hover `--wash`; selected `--accent-tint` | Invisible otherwise, and the chosen row must differ (decision 17). |
| T12.2 | History panel shadow | Spec lists "sheets" | The floating shadow, as the reference draws it | A floating side sheet (decision 15). |
| T12.3 | Version pill | Reference: floating shadow | No shadow | Dark pills take none (decision 4). |
| T12.4 | Slider thumb | Code before: accent glow | No glow, still round | No shadows. |
| T13.1 | Document tile while the pointer is on its rename pencil | Reference: the tile's own `:hover` only | The wrapper's `:hover` keeps the tile's dark edge | The pencil is a sibling over the tile, so the tile lost its `:hover` under it and the edge flickered back to the hairline. |
| T13.2 | Document tile rename field | Code before: the tile's 15px/400 (`font: inherit`) | 18px, weight 600, line-height 1.3, the family inherited | It replaces an 18px/600 title; the text jumped when the field opened. |
| T13.3 | Glass tokens | Plan: `--glass-*`, `--blur-*`, `--r-*`, `--accent-shadow`, the `@supports` fallback | All deleted; nothing in src, test or e2e read them | Gallery is the only material. |
| T13.4 | Entrance blur in `g-in` and `g-pop` | Spec: "Blur. None anywhere." | Kept; the material guard exempts exactly `@keyframes g-in` and `@keyframes g-pop` in `globals.css`, by keyframes name, and only up to `blur(6px)` | The reference's own short entrance animations fade from `filter: blur()` to `none`: motion, not a blurred backdrop, and the owner kept existing motion. A blur in any other keyframes or rule still fails the guard. |
| T14.1 | Invite input focus | Reference: no focus style (the input has `outline: none` inside a hairline row) | `.invite:focus-within`: border `--accent`, `0 0 0 4px var(--accent-ring)`; the colour and ring ease over `--dur-fast`, motion-guarded | The hairline is about 1.3:1 on white, so keyboard focus was invisible. Found in the final review. `e2e/gallery.spec.ts` reads it focused and blurred. |
| T14.2 | ⌘K palette input focus | Reference: no focus style | On focus the rule under the input turns `--accent` and an inset `0 0 0 3px var(--accent-ring)` is drawn | The sheet is `overflow: hidden`, so an outer ring would be clipped; the indicator is drawn from inside. Final review. Tested focused and blurred. |
| T14.3 | Chosen history row's meta line | Reference: `--text-faint` throughout | `--text-muted` on `.row[aria-pressed='true'] .meta` | `--text-faint` on `--accent-tint` is 4.39:1, below AA; `--text-muted` is about 5.3:1. Final review. The history test asserts both colours and a computed ratio of at least 4.5. |

---

## 10. Decisions and open questions

### Decisions made in the plan

The spec left some things open, and the spec, the reference and the code disagreed in places.
Each decision below was binding on the build. Most are also deviation rows (the row numbers are
in brackets).

**Where the spec and the reference disagree (the spec wins):**

1. **Nav bar shadow.** The reference gives the bar `0 24px 48px -28px rgba(0,0,0,.25)`. The
   spec says "No blur, no shadow". Built: no shadow. (T4.1)
2. **Hover lifts.** The reference keeps `translateY(-1px)` plus the floating shadow on the
   GitHub sign-in button, and a shadow on tile and card hover. The spec removes hover lifts and
   says only the border changes. Built: tiles and cards turn their border `#1c1d1b` on hover; no
   button lifts; presses (`scale(.92 to .98)`) stay. The nav avatars' `translateY(-3px)` hover
   goes; their `scale(1.06)` stays. (T4.3, T5.2, T8.1, T9.1, T10.1)
3. **Tile fill.** The reference fills workspace and document tiles and the People card
   `#fbfbf9`, turning `#fff` on hover. The spec maps anything that was 60% or more white to
   `#ffffff`. Built: `#ffffff`, and hover changes only the border. (T8.1, T9.1)
4. **Toasts and dark pills.** The reference gives the toast and the version pill the floating
   shadow. The spec lists only floating menus, sheets and the palette. Built: no shadow. (T11.1,
   T12.3)
5. **Board card peer ring.** The reference keeps `0 4px 14px rgba(14,165,233,.18)` under the 2px
   peer ring. Built: the ring only. (T5.1)
6. **Splatter palette.** The reference's "gallery" palette, with its reds mapped to violet, is
   eight entries with `#1c1c1c` twice. The spec lists seven: violet `#6d3fd6` three times,
   `#1c1c1c`, `#454545`, `#9a9a9a`, ochre `#e9a21f`. Built: the spec's seven. (T2.1)
7. **Splatter geometry.** The reference draws splats with a different generator (sizes 14 to
   40px, its own ray and drop counts). The spec keeps "the agreed numbers". Built: the existing
   `lib/splatter/geometry.ts`, unchanged. (T2.2)
8. **Sign out.** The reference colours it `#c4372b`. The spec allows red only for errors and the
   delete action. Built: `--text`. (T2.5)
9. **Document toolbar when stuck.** The reference uses `inset 0 1px 0 #fff, 0 1px 2px ...,
   0 8px 22px rgba(30,30,50,.12)` and a `rgba(40,40,60,.08)` border. The spec says "hairline
   border" and "the floating shadow". Built: `1px solid var(--hairline)` and `var(--shadow-float)`
   when stuck. (T6.1)
10. **Chips that rely on a shadow.** The reference draws the active toolbar tab and the selected
    Narrow/Wide and Page/Board segment as white with `0 1px 3px` shadows. Built: the toolbar tab
    is white with a `0 0 0 1px var(--hairline)` ring (a white chip on a white bar needs an
    edge); the segments are white on their grey track with no shadow. (T6.2, T6.7, T8.3)

**Where the spec and the code disagreed:**

11. **Splat scale.** The spec's table says `range(0.6, 1.2)`. The code ships `range(0.7, 1.4)`,
    Dhanush's own decision of 2026-10-03, and the spec says sizing "keeps the agreed numbers".
    Built: `range(0.7, 1.4)` kept. Owner ruling Q2. (T2.3)
12. **Base and body size.** The code's base was 16px and the document body 18px (Dhanush,
    2026-10-03). The spec's tables say 15px and 17px. Built: the spec's, and the document h3
    returns to 17px with the body, as in the reference. Owner ruling Q1. (T1.2, T6.9)
13. **"These replace the current 68 to 52."** In the code, 68 and 52 are the nav wrapper's
    totals (12px gap + 56px bar, 6px + 46px), and the bar already goes 56 to 46 with the gap 12
    to 6. Nothing changed; the tests asserting 56, 46, 12, 6 and 68 stay as they are.
14. **The offline status dot** was `--danger` (red). The spec says amber. Built: `--warn`.
    (T2.4)

**Where the spec was silent or ambiguous:**

15. **Which panels are "sheets".** The share sheet (and a future card sheet), the ⌘K palette, the History
    panel, the sign-in card (and the invite and privacy cards that share its look), the
    document's page sheet (the spec itself calls it "the page sheet") and every popover or
    dropdown get `var(--shadow-float)`, as the reference draws them. The nav bar, tiles,
    columns, board cards, the People card, toasts, the version pill and the meta pill get none.
    Owner ruling Q4. (T6.6, T10.2, T12.2)
16. **Content and identity colours are not chrome.** *Amended by owner ruling Q3.* The plan kept
    three: the editor's "Red" text colour (`#c4372b`), the red diagonal on the highlight menu's
    "None" swatch, and the person colour `#e11d48`. Dhanush then ruled that the person colour
    becomes indigo `#4f46e5`, so two remain. `test/no-red.test.ts` names them. (T2.7, T2.8)
17. **White-on-white hover and selection.** The reference uses `#fff` for the hover of toolbar
    tools, the workspace name and history rows, and for the selected history row, all on white
    surfaces, where it is invisible. Built: hover is `--wash` (`rgba(40,40,60,.06)`, the
    reference's own menu-row hover); the selected history row is `--accent-tint`. (T4.2, T6.3,
    T12.1)
18. **Sticky toolbar top.** The reference pins it at `top:80px`. The code follows the nav as it
    condenses (`calc(var(--nav-bottom) + 12px)`: 80px at rest, 64px condensed), and the spec
    keeps existing motion. Built: it keeps following. (T6.4)
19. **Toolbar entrance.** The floating toolbar entered with `g-pop .6s`; inside the sheet the
    reference uses `g-fade .4s`. Built: `g-fade .4s`. (T6.5)
20. **Error boxes and fields.** `ui.error` was a red-tinted box; it is now white with a
    hairline and the text in `--danger`. The link field's invalid border was red; it is now
    `--rule`. The column delete confirmation's red fill is now `--danger` text on the grey of
    its Cancel neighbour. (T2.6, T5.5)
21. **People "Manage" link** stays inside the People card, where it was; the reference moves it
    beside the heading. Layout is not in scope. (T8.4)
22. **The syncing dot pulses.** The reference names an animation `c-pulse` that it never defines
    (dead in the reference itself). Built: `g-pulse 1s` infinite, inside the reduced-motion
    guard. (T4.5)
23. **The toast's entrance.** `globals.css`'s `g-up` translates by -50% because the reference
    centres the toast itself; here the wrapper centres it, so a live `g-up` would throw the
    toast sideways for half a second. The toast has a module-local `up` with the same rise and
    scale and no -50%. (T3.2)

**The dead-animation fix** (spec, "Known app-wide bug"): see section 8 for the cause, the
`global(name)` rule and what was rejected.

**The nav, replaced versus reused.**

- Reused unchanged: `lastNavWidth` (module-level in `AppShell.tsx`), `naturalWidth()`, the
  `ResizeObserver` that keeps `lastNavWidth` equal to the bar on screen, the whole
  settling-and-hold logic for documents that are still connecting (except that the take-over reads
  `offsetWidth`, not the bounding box, because the `g-pop` entrance scales the bar), the `transitionend` handler
  that accepts only the bar's own `width`, its 1000ms timeout fallback, the reduced-motion
  early return, and the condensed state. In `NavTabs.tsx`: `lastMetrics`, `measureIndicator`,
  the two-frame `animated` gate, the `scrollTo` that keeps the open tab in view, the
  `ResizeObserver`, and the overflow-driven right-edge fade.
- Replaced: the tween's start. It used to pin the old width, wait one `requestAnimationFrame`,
  then set the target. The spec's order is: pin the old width with `transition: none`, force a
  layout, then set the transition and the target in the same task. It works for a brand-new nav
  (dashboard to workspace); the one-frame-later fallback the plan allowed for was not needed.
- Replaced: the indicator's look. The liquid-glass pill became a 2px `--accent` underline;
  its positioning and transitions are untouched.

### Questions only Dhanush could answer, and his answers (2026-10-10)

| # | Question | Default the plan built on | Ruling |
|---|---|---|---|
| Q1 | Base 15px and document body 17px, as the spec's tables say, undoing the 2026-10-03 move to 16px and 18px? | 15 and 17 | **15px base, 17px body** |
| Q2 | Splat scale `range(0.6, 1.2)` from the spec's table, or the later `range(0.7, 1.4)`? | Keep 0.7 to 1.4 | **0.7 to 1.4** |
| Q3 | Keep the editor's Red text colour, the red stroke on the "None" highlight swatch, and the `#e11d48` person colour? | Keep all three | **Keep the first two; the person colour `#e11d48` becomes `#4f46e5`** (same palette index). People whose hash lands on index 0 change colour; it is derived per session from the user id and nothing is stored. |
| Q4 | Floating shadow on the document page and the sign-in card? | Yes | **Yes**, both get `--shadow-float` |
| Q5 | Sign out in plain text, not red? | Plain text | **Plain text** |

### Still open

- **The column delete × and the card ×.** The column's × is square (2px corners, 24px) where
  the card's × is a round 24px button. Every other close or delete button is round. Reviewers
  parked it as a judgement call. Choice for Dhanush: make the column × round to match, or keep
  it square because it sits flush in the column header. Nothing else depends on it.

---

## 11. Known limitations

- **The "material and motion fidelity" plan was set aside**
  (`docs/superpowers/plans/2026-10-04-material-and-motion-fidelity.md`). The spec replaces its
  goal. It must not be executed.
- **Dark mode is not built.** The spec puts it out of scope. The tokens are single-valued; a
  dark theme would redefine them under `prefers-color-scheme` or a data attribute, and the
  splatter palette, the blobs and the hard-coded white rings (`#fff` on the avatars) would need
  a pass.
- **The floating toolbar placement is not built.** The reference offers a wider bar above the
  sheet. Only the in-sheet placement exists.
- **Desktop first.** The existing responsive rules (1100px and 760px in the nav, the privacy
  card at 520px) keep working; there is no phone-first layout.
- **The reference's other settings are not built:** its alternative canvases, splash colours
  and strengths.
- **`interpolate-size: allow-keywords`** lets the nav's CSS width backstop animate in Chrome and
  Edge only. The JS tween covers navigation and other browsers; the CSS part just does not
  animate elsewhere.
- **Headless frame rate is not a product signal.** Headless Chromium rasterises in software, so
  the blurred blobs run far slower there than on a GPU (about 15fps). The real-GPU figures in
  T3.3 are the evidence for the canvas performance rule, not any headless frame count.
