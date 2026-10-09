# Handoff: CRDT Workspace, "Glass" redesign (Direction D)

**Source of truth:** `Workspace D - Glass.dc.html` in this folder. Open it in a browser with `support.js` next to it. Every value below is taken from that file; if this README and the prototype disagree, the prototype wins.

---

## 0. How to use this document
- **Prototype only:** the HTML file is a **design reference**. Its data is mocked, the collaborator "Grace" is simulated, and the version number, latency and history are fake.
- **Target stack:** Next.js App Router + React + CSS Modules + `globals.css` custom properties + Yjs / y-websocket / y-prosemirror. Recreate the design in that stack, following the repo's patterns (server components for data, `'use client'` islands, `components/ui/*`).
- **Fidelity:** high. Match colours, radii, blur, spacing and easing exactly.
- **Prototype settings:** the props `canvas`, `splashes`, `splashColor`, `splashMotion`, `role`, `startScreen` and `peers` are for previewing only. In production, fix them to **neutral, subtle, purple, live**, and take role from the session.

---

## 1. Codebase map

| Area | Files |
|---|---|
| Tokens, fonts, keyframes, body | `app/globals.css`, `app/layout.tsx` |
| Painted canvas (blobs + weave) | `components/CanvasBackground.tsx`, `canvas-background.module.css` |
| Paint splatter | `components/PaintSplatter.tsx`, `lib/splatter/geometry.ts`, `lib/splatter/paint.ts`, `lib/splatter/random.ts` |
| Sticky glass nav | `components/AppShell.tsx`, `app-shell.module.css`, rendered by `app/workspaces/[id]/layout.tsx` (the dashboard renders its own) |
| Doc tabs + sliding indicator | `components/NavTabs.tsx`, `nav-tabs.module.css` |
| Status pill + popover | `components/SyncStatus.tsx` |
| Presence avatars | `components/NavPresence.tsx` (replaces the pill-style `Presence.tsx`) |
| ⌘K palette | new `components/CommandPalette.tsx` |
| Share sheet | new `components/ShareSheet.tsx`, wired to the members server actions |
| Sheet primitive | `components/ui/Sheet.tsx` |
| Sign-in | `app/(auth)/login/page.tsx`, `signup/page.tsx`, `auth.module.css` |
| Dashboard | `app/page.tsx` (+ CSS) |
| Workspace | `app/workspaces/[id]/layout.tsx`, `page.tsx`, `workspace.module.css`, `CreateDocumentForm.tsx`, `MembersPanel.tsx` |
| Board + card sheet | `components/Board.tsx`, `board.module.css`, new `CardSheet.tsx` |
| Document page + toolbar | `app/workspaces/[id]/documents/[docId]/DocumentClient.tsx`, `document.module.css`, new `EditorToolbar.tsx` |
| History | new `HistoryPanel.tsx` + API (see §16) |

**Architecture decision (built):** the nav lives in `app/workspaces/[id]/layout.tsx`, so it is not rebuilt when you move inside a workspace, and documents are at `/workspaces/[id]/documents/[docId]`. See Implementation status, Built. The module-level memory of §5.4 stays for navigations to and from the dashboard.

---

## 2. Design tokens (`:root`)

```css
/* text */
--text: #1c1d1b;          /* headings, strong */
--text-2: #3d403b;        /* body, toolbar icons */
--text-muted: #5f625d;    /* secondary  — 6.2:1 on white */
--text-faint: #6c6f6a;    /* meta       — 5.1:1 white, 4.5:1 canvas */
--icon-faint: #a3a6a0;    /* × glyphs only, never text */
--danger: #c4372b;

/* accent (indigo-violet, hue 285) */
--accent: oklch(0.42 0.11 285);
--accent-hover: oklch(0.37 0.11 285);
--accent-text: oklch(0.36 0.11 285);
--accent-tint: oklch(0.95 0.02 285);
--accent-soft: oklch(0.42 0.11 285 / .12);   /* toolbar active bg */
--accent-ring: oklch(0.42 0.11 285 / .12);   /* focus halo */
--accent-shadow: oklch(0.42 0.11 285 / .22);

/* status */
--ok: oklch(0.62 0.13 150);
--warn: oklch(0.72 0.15 65);
--sync: var(--accent);
--toast-dot: oklch(0.78 0.12 300);

/* canvas */
--canvas-base: #f1f1ef;

/* glass */
--glass-light: rgba(255,255,255,.55);     /* tiles, People card */
--glass-col: rgba(255,255,255,.42);       /* board columns */
--glass-mid: rgba(255,255,255,.72);       /* nav, popovers */
--glass-tool: rgba(255,255,255,.76);      /* editor toolbar */
--glass-page: rgba(255,255,255,.78);      /* document page */
--glass-sheet: rgba(255,255,255,.82);     /* sheets */
--glass-menu: rgba(255,255,255,.88);      /* toolbar dropdowns */
--glass-border: rgba(255,255,255,.85);
--glass-hl: inset 0 1px 0 rgba(255,255,255,.95);
--blur-1: blur(20px) saturate(180%);
--blur-2: blur(28px) saturate(190%);
--blur-3: blur(30px) saturate(190%);

/* fields & lines */
--field-bg: rgba(240,240,244,.9);
--field-border: rgba(40,40,60,.12);
--line: rgba(40,40,60,.07);
--sep: rgba(40,40,60,.12);
--dash: rgba(40,40,60,.22);
--track: rgba(40,40,60,.08);

/* motion */
--ease: cubic-bezier(.32,.72,0,1);

/* radii */
--r-pill: 999px; --r-tool: 10px; --r-item: 12px; --r-card: 18px;
--r-menu: 18px; --r-pop: 22px; --r-tile: 24px; --r-col: 26px;
--r-panel: 28px; --r-sheet: 30px;
```

**User colours** (`lib/color.ts`, unchanged): `#e11d48 #0ea5e9 #16a34a #f59e0b #8b5cf6 #14b8a6`.

**Font:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`. Base 15px / 1.47, letter-spacing −0.01em, antialiased. Use `text-wrap: pretty` on titles and body text.

| Role | Size / weight / line-height | Tracking |
|---|---|---|
| Page H1 | 32 / 600 | −0.025em |
| Sign-in H1 | 30 / 600 | −0.025em |
| Card sheet title | 26 / 600 / 1.22 | −0.025em |
| Section H2 | 21 / 600 | −0.02em |
| Panel title | 18 / 600 | −0.02em |
| Tile title | 18 / 600 / 1.3 | |
| Doc H1 / H2 / H3 | 32/600/1.2 · 21/600/1.3 · 17/600/1.35 | −0.025 · −0.02 · 0 |
| Doc body | 17 / 400 / 1.65 | |
| UI | 14–15 / 500 | |
| Small / meta | 12.5–13.5 | |

---

## 3. Glass recipe

```css
.glass {
  background: var(--glass-mid);
  backdrop-filter: var(--blur-2); -webkit-backdrop-filter: var(--blur-2);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-hl), 0 10px 30px rgba(30,45,40,.08);
}
@supports not (backdrop-filter: blur(1px)) { .glass { background: rgba(255,255,255,.92); } }
```
- **Dark glass** (version pill, toasts): `rgba(28,29,27,.82)` with `blur(24px)` and white text.
- **Overlay behind sheets:** `rgba(30,40,35,.16)` with `blur(8px)`. Behind the palette: `rgba(30,40,35,.1)`, no blur.
- **Small text on the canvas:** any small text sitting directly on the painted background goes on a frosted pill, e.g. the workspace meta line (§9). Big headings (32px) may sit directly on the canvas.

---

## 4. Background

### 4.1 Canvas (`CanvasBackground`)
`position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden; background: var(--canvas-base)`.

**Blobs:** five absolutely positioned blobs, `filter: blur(90px); opacity:.55`, with organic radii `42% 58% 63% 37% / 41% 44% 56% 59%`.

| # | Size | Position | Colour | Loop |
|---|---|---|---|---|
| 1 | 620×520 | left −140, top −160 | `oklch(0.86 0.012 260)` | 52s |
| 2 | 520×460 | right −120, top −60 | `oklch(0.9 0.015 80)` | 60s reverse |
| 3 | 480×420 | right 18%, bottom −180 | `oklch(0.83 0.01 240)` | 68s |
| 4 | 520×440 | left 12%, bottom −200 | `oklch(0.92 0.012 60)` | 76s reverse |
| 5 | 360×320 | left 44%, top 22% | `oklch(0.88 0.008 200)` | 84s |

```css
@keyframes g-paint{
 0%,100%{transform:translate(0,0) rotate(0) scale(1);border-radius:42% 58% 63% 37%/41% 44% 56% 59%}
 33%{transform:translate(50px,-30px) rotate(12deg) scale(1.08);border-radius:63% 37% 44% 56%/55% 62% 38% 45%}
 66%{transform:translate(-30px,40px) rotate(-8deg) scale(.95);border-radius:38% 62% 56% 44%/48% 36% 64% 52%}}
```
**Weave overlay** (`mix-blend-mode:multiply`):
`repeating-linear-gradient(0deg,rgba(60,50,30,.018) 0 1px,transparent 1px 3px), repeating-linear-gradient(90deg,rgba(60,50,30,.015) 0 1px,transparent 1px 4px)`.

### 4.2 Paint splatter (`PaintSplatter`), agreed live values
- **Placement:** a `<canvas>` above the blobs and below the weave. **Exclude the top 90px** so nothing shows through the nav.
- **Opacity:** layer opacity **0.32**.
- **Purple palette:** `#7b3fe4` ×2, `#5b4ee8 #9d5cf0 #c13ea6 #e8559b #3d8fdc #22b8c9 #f0b429 #f2843a #4cc38a #b794f6`.
- **Seed:** use a seeded random generator, so the pattern is the same on every load.
- **Geometry** (`geometry.ts`):

| Constant | Value |
|---|---|
| `BASE_CORE_RADIUS` | 11 |
| per-splat scale | `range(0.6, 1.2)` |
| core | 9 overlapping circles around the centre |
| rays | 10–23; `length = coreR × range(1.5, 5)`; `width = scale × range(1.5, 4)`, **tapering to 15%** at the tip |
| ray tip blob | `scale × range(1, 2.5)` |
| drips | on 35% of rays, plus 0–3 from the core; `width = scale × range(1, 2.5)` |
| droplets | 40–90; distance `coreR × (1 + t×4 …)`; radius `scale × (2.5 − 2.1t)` (mostly tiny) |
| count | `splatCount = 10 + 8 × √(W·H)/1100` |
| min spacing | 120px between centres |
| specks | ~320, 0.5–3.5px, opacity shimmer .55–.9 on a sine wave |

- **Life cycle:**
  - Landing: scales from 0.35 to 1 over 650ms with an ease-out-back, fading in.
  - Life: 16–32s, drifting up to ±3px, with a fixed rotation of ±0.25 rad.
  - End: a 2.4s fade-out, then a new splat lands somewhere else.
  - First load: three splats land at +0.3s, +1.0s and +1.7s.
- **Performance:**
  - Pre-render each splat once to an offscreen canvas, then `drawImage` it inside one rAF loop.
  - Device pixel ratio is capped at 2.
  - Rebuild on resize with a 150ms debounce.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, draw one frame and stop the loop.

---

## 5. Nav

### 5.1 Wrapper
```css
.navWrap { position:sticky; top:0; z-index:30; padding:12px 16px 0;
           display:flex; flex-direction:column; align-items:center; }
```

### 5.2 Bar
```css
.nav {
  display:flex; align-items:center; gap:10px; height:56px; padding:0 8px 0 10px;
  width:fit-content; max-width:100%; min-width:0;
  interpolate-size: allow-keywords; transition: width .55s var(--ease);
  border-radius:999px; background:var(--glass-mid);
  backdrop-filter:var(--blur-2); -webkit-backdrop-filter:var(--blur-2);
  border:1px solid rgba(40,40,60,.1);
  box-shadow: inset 0 1px 0 #fff, 0 12px 32px rgba(30,30,50,.12), 0 2px 6px rgba(30,30,50,.08);
  animation: g-pop .6s var(--ease);
}
```
The bar is centred and only as wide as its contents, with **no flexible spacer** in it.

### 5.3 Contents, left to right

| # | Element | Spec | Action |
|---|---|---|---|
| 1 | Logo | 36px circle, `--accent`, `inset 0 1px 0 rgba(255,255,255,.4), 0 4px 10px var(--accent-shadow)`; `aria-label="All workspaces"`. Hover `rotate(-8deg) scale(1.05)`; pressed `scale(.92)` | → dashboard |
| 2 | Workspace name | 36px high, pill, padding 0 12px, 600 weight; hover `rgba(255,255,255,.7)`. On the dashboard, show a plain "Workspaces" label instead | → Overview |
| — | Divider | 1×22px, `rgba(0,0,0,.08)` | |
| 3 | Tabs strip | `position:relative; display:flex; gap:2px; flex:0 1 auto; min-width:120px; overflow-x:auto; scrollbar-width:none; padding:3px; border-radius:999px`. When it overflows: `mask-image: linear-gradient(90deg,#000 82%,transparent)` | |
| 3a | Tab | 32px high, padding 0 14px, pill, 14px text. Active: 600 weight in `--accent-text`. Inactive: 500 weight in `--text-muted`; `transition: color .3s`. **No background of its own** | opens the page |
| 3b | Presence dot | 6px circle, `--ok`, 7px after the label. Shown only when connected and others are in that doc; never on Overview | |
| 4 | Search | 36px high, `min-width:170px` (0 below 1100px, where the label hides), padding 0 10px 0 14px, `--field-bg`, 1px `--field-border`, `inset 0 1px 2px rgba(30,30,50,.06)`, text `#55585f`. ⌘K chip: white, 1px border, 6px radius, 11.5px. Hover: white fill and a darker border | opens the palette |
| 5 | Presence avatars | document pages only. 28px circles at −7px overlap with a 2px white ring. Hover `translateY(-3px) scale(1.06)`. Offline peers at opacity .35. Hidden below 1100px | tooltip "Name · editing" |
| 6 | History | document pages only. Field style; white while open | toggles the panel |
| 7 | Status pill | field style, 8px dot + label: `{n} here` (**you included**) / `Offline` / `Syncing` (the syncing dot pulses). Label hidden below 1100px | opens the status popover |
| 8 | Share | accent pill, 36px high, padding 0 18px, `inset 0 1px 0 rgba(255,255,255,.3), 0 4px 12px var(--accent-shadow)`. Hidden on the dashboard | opens the Share sheet |
| 9 | Avatar | 36px, 2px white ring | opens the user menu |
| — | "View only" pill | viewers only, beside the tabs | |

### 5.4 Sliding tab indicator
An absolute pill inside the strip, `top:3px; bottom:3px; left:0`. Set `transform: translateX(offsetLeft)` and `width: offsetWidth` from the active tab.
```css
background: linear-gradient(180deg,rgba(255,255,255,.55) 0%,rgba(255,255,255,.08) 50%,rgba(255,255,255,.3) 100%),
            oklch(0.42 0.11 285 / .14);
backdrop-filter: blur(8px) saturate(220%);
border: 1px solid oklch(0.42 0.11 285 / .28);
box-shadow: inset 0 1px 0 rgba(255,255,255,.95), inset 0 -2px 6px rgba(255,255,255,.4),
  inset 0 2px 5px oklch(0.42 0.11 285 / .12), 0 2px 6px oklch(0.42 0.11 285 / .16), 0 6px 16px oklch(0.42 0.11 285 / .12);
pointer-events:none;
transition: transform .55s var(--ease), width .55s var(--ease), opacity .3s;
```
- **Re-measuring:** on route change, tab resize (`ResizeObserver`) and strip scroll.
- **Keeping the tab visible:** use `scrollTo({behavior:'smooth'})`, never `scrollIntoView`.
- **No active tab:** opacity 0.
- **Surviving remounts:** remember the last position at module level, so the highlight still slides even though the nav is rebuilt per page:
```ts
let lastMetrics: Metrics | null = null
const [metrics, setMetrics] = useState(lastMetrics)
const [animated, setAnimated] = useState(lastMetrics !== null)
// in measureIndicator: lastMetrics = next
```
- **Nav width across remounts:** do the same with `lastNavWidth`. Set the old width inline, force a reflow, transition to `scrollWidth`, and clear the inline styles on `transitionend`.

### 5.5 Responsive & scroll
- **< 1100px:** Search shows only ⌘K, the status pill shows only its dot, and the avatars hide.
- **< 760px:** the tabs collapse into one pill ("{current} ▾") that opens a glass dropdown of all tabs, and the workspace name hides.
- **Scroll > 24px:** add `data-compact`. Height 56 → 46, wrapper top padding 12 → 6, fill .72 → .85, animated over .4s with `--ease`.

### 5.6 Under-nav floating pills (centred, 10px below the nav)
- **Offline / syncing:** glass `rgba(255,255,255,.62)` with blur 24, pill, padding 6/6/6/16, 8px status dot, text `--text-2`, and a dark **Reconnect** pill (30px) when offline.
  - Offline copy: "You're offline. Keep working, your changes are saved on this device." With a count: "You're offline. {n} changes saved on this device will sync when you're back."
  - Syncing copy: "Back online. Syncing your changes…"
- **Version preview:** dark glass, `max-width:100%; min-width:0`. Label "{Author} · {Mon D, HH:MM}" with ellipsis, **Restore** (white pill, editors only) and **Back to now** (`rgba(255,255,255,.16)` pill).

### 5.7 Popovers
- **Status:** 270px wide, radius 22, `rgba(255,255,255,.72)` with blur 30, origin top-right, `g-pop .45s`.
  - Title: "Everything is up to date" / "Working offline" / "Catching up".
  - Rows: People here · Response time · Waiting to sync · Version.
  - A dev-only button: "Go offline (simulate)" / "Reconnect now".
- **User menu:** 220px wide, radius 20. Name and email, "All workspaces", and "Sign out" in `--danger`. Rows are 38px with radius 14.
- **Behaviour:** opening one popover closes the other. Esc or a click outside closes both.

---

## 6. Layout & spacing
- **Scrolling:** the page itself scrolls (`height:100vh; overflow:auto`). There is no sidebar.
- **Content widths:** dashboard and workspace 960; document 780 (narrow) or 1040 (wide); board columns centred.
- **Top spacing:** dashboard and workspace pages `padding:40px 16px 64px`. Board 44px top. Document: toolbar 24px top, then the page 16px below it.
- **Spacing steps:** 2/4/6/8/10/12/14/16/18/20/22/26/28/32/40/44/56.
- **Radius nesting:** inner radius ≈ outer radius − 8.

---

## 7. Sign-in
- **Card:** a centred glass card, `max-width:400px; padding:44px 40px; border-radius:28px; gap:28px; text-align:center`; `rgba(255,255,255,.55)`, blur 30, shadow `inset 0 1px 0 rgba(255,255,255,.95), 0 24px 60px rgba(30,45,40,.12)`; entrance `g-sheet .7s`.
- **Mark:** a 52px accent square with radius 16 and an accent glow.
- **Text:** H1 "Sign in", then "Sign in to your workspaces." in `--text-muted`.
- **Continue with GitHub:** 50px, pill, accent. Hover `translateY(-1px)` with a bigger accent shadow; **the colour stays the same**. Pressed `scale(.97)`; `transition .4s var(--ease)`.
- **Continue with Google:** 50px, pill, `rgba(255,255,255,.6)` with a white border; hover `.9`.
- **Footnote:** 13px, `--text-faint`: "New here? Signing in creates your account and a workspace of your own."

---

## 8. Dashboard
- **Heading:** H1 "Workspaces".
- **Grid:** `repeat(auto-fill,minmax(250px,1fr))`, gap 16.
- **Workspace tile:** glass `rgba(255,255,255,.7)` (raised from .55 for legibility over the splatter), 1px white border, radius 24, padding 22, gap 32. It contains:
  - A 44px accent square (radius 14) with the initial at 18px/600.
  - A text column: `gap:4px; width:100%; min-width:0`. Name 18/600/1.3 with `display:block`; "N documents · N people" at 13.5 in `--text-muted`.
  - Hover `translateY(-2px)` + `0 10px 28px rgba(30,45,40,.08)`, over .55s `--ease`. Pressed `scale(.98)`.
- **New workspace tile:** `1.5px dashed var(--dash)`, `rgba(255,255,255,.7)` with blur 20, `inset 0 1px 0 rgba(255,255,255,.9), 0 4px 16px rgba(30,45,40,.06)`. Contains the title "New workspace" and a 42px white pill input "Name it, then press Enter".
- **Input focus:** border `--accent` + `0 0 0 4px var(--accent-ring)`.

---

## 9. Workspace (Overview)
- **Header:** H1 = workspace name.
- **Meta pill** (directly on the canvas):
```css
align-self:flex-start; padding:5px 14px; border-radius:999px;
background:rgba(255,255,255,.75); backdrop-filter:blur(16px) saturate(180%);
border:1px solid rgba(255,255,255,.9); box-shadow:0 2px 8px rgba(30,45,40,.06);
color:#3d403b; font-size:14px; font-weight:500;
```
  Text: "{n} documents · {m} people".

**Documents (H2 21/600)**
- **Grid:** `minmax(230px,1fr)`, gap 16.
- **Document tile:** same as the workspace tile, but with gap 40.
  - Kind chip: "Board" / "Page", 12.5/600, padding 3px 10px, pill, `--accent-tint` background, `oklch(0.38 0.1 285)` text.
  - Title + "Author · 2 min ago" (13.5, `--text-faint`).
- **Create tile** (editors only), same style as the new-workspace tile:
  - Input "New document name" (white pill, maxLength 200).
  - **Page / Board** segmented control: `--track` with 3px padding; the selected option is white + `0 1px 3px rgba(30,45,40,.14)`, buttons 32px at 13.5/500.
  - **Create** (accent pill, 38px). Enter also creates.

**People (H2)**
- **Header link:** "Manage" (owner) or "See who has access" (others), `--accent-text`, 15/500. Opens the Share sheet.
- **List:** glass `rgba(255,255,255,.7)`, radius 22. Rows: padding 14×18, a bottom line `rgba(0,0,0,.05)`, a 34px avatar, name 500, email 13 `--text-faint`, and the role on the right ("Owner / Can edit / Can view", 13, `--text-muted`).
- **Owner alone:** show the empty state "Just you so far. **Invite people**", where the link opens Share.
- **No inline invite form:** inviting happens only in the Share sheet.

---

## 10. Board
- **Container:** `overflow-x:auto; padding:44px 0 48px`. The inner row is `display:flex; gap:16px; width:max-content; margin:0 auto; padding:0 16px`, so it's centred.

**Column**
- 290px wide, radius 26, `--glass-col` with blur 20 saturate 170, 1px white border.
- Drag-over: background `rgba(255,255,255,.75)` + `inset 0 0 0 2px var(--accent)`, transition .4s.
- Header (padding 16/18/10): title 15/600 + count chip (22px pill, `rgba(0,0,0,.05)`, 12.5, `--text-muted`).
- Body: padding 0 10 10, gap 8.

**Card**
- `rgba(255,255,255,.92)`, radius 18, padding 14×16, gap 8. Title 14.5/1.4 with `text-wrap:pretty`.
- Shadow:
  - Default: `0 0 0 1px #fff, 0 2px 8px rgba(30,45,40,.06)`.
  - Selected: `0 0 0 2px var(--accent)`.
  - Peer on the card: `0 0 0 2px #0ea5e9, 0 4px 14px rgba(14,165,233,.18)`.
- Hover `translateY(-3px) scale(1.01)` + `0 0 0 1px #fff, 0 14px 30px rgba(30,45,40,.12)`, .5s. Pressed `scale(.98)`. Entrance `g-in .5s`.
- Dragging: opacity .4.
- Meta row (12.5, `--text-faint`):
  - "Has notes" when there is a description.
  - Peer chip on the right: an 18px avatar inside a pill, `rgba(14,165,233,.1)`, text `#0b6e99`, `g-pop .4s`.
- Delete × (editors): 24px circle in `--icon-faint`; hover `rgba(0,0,0,.05)` with `--text`.

**Add buttons**
- **+ Add a card:** 40px pill, `rgba(255,255,255,.55)`, `inset 0 0 0 1px rgba(40,40,60,.08)`, `--text-2` at 14/500, left-aligned with padding 0 14. Hover `.9`. Adds a "New card" and opens the sheet.
- **+ Add a list:** 230×54 pill, `1.5px dashed var(--dash)`, `rgba(255,255,255,.7)` with blur 20, the create-tile shadow, `--text-2` at 14/500. Hover `.92`; pressed `scale(.97)`.

**Drag & drop**
- Dropping on a card inserts the dragged card before it; dropping on the column body appends it.
- Each move is **one Yjs transaction**.
- Viewers can't drag and have no × or add buttons.

---

## 11. Card sheet
- **Overlay:** see §3. `g-fade .35s`.
- **Sheet:** max-width 580, radius 30, `--glass-sheet` with blur 30, shadow `inset 0 1px 0 #fff, 0 40px 90px rgba(30,45,40,.22)`, `g-sheet .6s`.
- **Top row** (padding 22/26/0, gap 10):
  - Column `<select>`: 32px pill, `rgba(0,0,0,.05)`, 13.5/500.
  - "Grace is here too", with an 8px `#0ea5e9` dot running `g-pulse 1.8s`.
  - Close: 30px circle, `rgba(0,0,0,.06)`.
- **Body** (padding 16/26/26, gap 20):
  - Title textarea: 26/600, transparent, no border.
  - Notes textarea "Add notes": radius 20, `rgba(255,255,255,.6)` with a 1px white border, padding 16×18. Focus: white + `0 0 0 1px var(--accent), 0 0 0 5px var(--accent-ring)`.
  - Activity: label "Activity" (13/600, `--text-faint`); rows of a 24px avatar, **Who** what, and the time on the right (12.5).
- **Footer** (editors, padding 14/26/20): "Delete card" (danger text link) and **Done** (38px accent pill).
- **Closing:** Esc or a backdrop click. Viewers get read-only fields.
- **Data:** title, column and description live on the card's Y.Map. Activity is a Y.Array per card.

---

## 12. Document page + Word-style toolbar

### 12.1 Toolbar container
```css
position:sticky; top:80px; z-index:20;           /* 12px under the nav */
max-width:1000px; margin:24px auto 0; padding:0 16px;
animation: g-pop .6s var(--ease);
```
Inner panel: radius 22, `--glass-tool` with `--blur-2`, `1px solid rgba(40,40,60,.1)`, shadow `inset 0 1px 0 #fff, 0 10px 28px rgba(30,30,50,.1), 0 1px 3px rgba(30,30,50,.06)`.

**Row 1: tabs** (padding 7/10/0, gap 4)
- **Home · Insert · View:** 28px pills, padding 0 13, 13px.
  - Active: `rgba(255,255,255,.95)` + `0 1px 3px rgba(30,30,50,.12)`, `--accent` text at 600.
  - Inactive: transparent, `--text-muted` at 500.
  - Transitions: background, colour and shadow over .3s.
- Viewers see **View** only, plus a "View only" chip (12.5, `rgba(40,40,60,.06)`).
- **Right side:** word count "{n} words" (12.5, `--text-faint`, tabular numbers), updated live.

**Divider:** 1px `--line`, margin 7px 12px 0.

**Row 2: tools** (min-height 48, padding 7/8, gap 2, wraps). Switching tabs fades the row in over .3s.

**Tool button** (shared)
```css
height:32px; min-width:32px; padding:0 7px; border:none; border-radius:10px;
display:flex; align-items:center; justify-content:center; gap:6px; font-size:13.5px;
background: transparent | var(--accent-soft) when active;
color: var(--text-2) | var(--accent) when active;
transition: background .25s, color .25s, transform .3s var(--ease);
:hover  { background: rgba(255,255,255,.9) }
:active { transform: scale(.92) }
```
- **Keep the selection:** every tool calls `preventDefault()` on **mousedown**, so the editor keeps its selection.
- **Labelled buttons** (Insert tab): padding 0 11 0 9, with the icon and text.
- **Group separator:** 1×20px, `--sep`, margin 0 6px.
- **Icons:** 16×16, `stroke: currentColor`, stroke-width 1.6, round caps and joins.

### 12.2 Home tab, left to right
| Group | Tool | Tooltip | Command |
|---|---|---|---|
| History | Undo · Redo | "Undo (⌘Z)" · "Redo (⌘⇧Z)" | editor undo/redo (`y-prosemirror` undo manager) |
| Style | **Style dropdown** (150px, §12.4) | "Text style" | block type |
| Inline | **B** (700) · *I* (Georgia italic) · U (underlined) · S (struck) | "Bold (⌘B)" · "Italic (⌘I)" · "Underline (⌘U)" · "Strikethrough" | toggle marks |
| Colour | **A** with a 15×3px bar in the last colour used | "Text color" | opens the colour menu (§12.5) |
| | Marker icon with a bar in the last highlight used | "Highlight" | opens the highlight menu |
| Lists | Bulleted · Numbered | | toggle the list |
| Align | Left · Center · Right · Justify | | paragraph alignment |
| Clear | T with an × | "Clear formatting" | remove marks + set paragraph |

**Active states:** B, I, U, S, the lists, the alignments and Quote/Code are highlighted (`--accent-soft` with `--accent` text) whenever the selection has that format. Re-read the format on `selectionchange` and after every command.

### 12.3 Insert tab
| Tool | Label | Inserts |
|---|---|---|
| Link | "Link" | opens the link popover (§12.6) |
| Table | "Table" | a 3×3 table + an empty paragraph after it |
| Divider | "Divider" | a horizontal rule |
| Code block | "Code block" | toggles a `pre`/code block |
| Quote | "Quote" | toggles a blockquote |
| Date | "Date" | today's date as text, e.g. "Oct 3, 2026" |

### 12.4 View tab
- **Zoom:** label "Zoom", then **−**, the current value (a 58px field-style button, tabular numbers, click resets to 100%), then **+**. Steps of 10%, range 70–150%. Applied as `zoom` on the editor container; remote cursors stay correct.
- **Page width:** label "Page width", then the **Narrow | Wide** segmented control (`--track`; the selected option is white + shadow, 26px). Narrow = 780px, Wide = 1040px; the page animates `max-width` over .55s.

### 12.5 Dropdowns (shared shell)
```css
position:absolute; left:0; top:40px; padding:8px; border-radius:18px;
background: var(--glass-menu); backdrop-filter: var(--blur-3);
border:1px solid rgba(255,255,255,.95);
box-shadow: inset 0 1px 0 #fff, 0 18px 44px rgba(30,30,50,.16);
transform-origin: top left; animation: g-pop .4s var(--ease); z-index:5;
```
- **Closing:** clicking outside the toolbar, Esc, or choosing an item.
- **Style menu** (240px, padding 6, rows 38px with radius 12, hover `rgba(40,40,60,.06)`). Each option is shown in its own style, with its shortcut on the right (11.5, `--text-faint`):

| Option | Preview | Shortcut |
|---|---|---|
| Title (H1) | 22/600 | ⌘⌥1 |
| Heading (H2) | 17/600 | ⌘⌥2 |
| Subheading (H3) | 15/600 | ⌘⌥3 |
| Normal text | 14.5 | ⌘⌥0 |
| Quote | 14.5, muted, 2px violet left rule | — |
| Code | monospace 13 | — |

  The trigger button: 150×32, field style, current style name + a 9px ▼.
- **Colour menu** (170px): title "Text color" (12/600, `--text-faint`), then a 4-column grid of 28px swatches (gap 8). Hover `scale(1.12)`. The selected swatch gets `0 0 0 2px #fff, 0 0 0 4px <colour>`.
  - Default `#1c1d1b`, Grey `#6c6f6a`, Violet `--accent`, Red `#c4372b`, Orange `#c9661a`, Green `#2f8a4f`, Blue `#2f6fd0`, Pink `#c2417f`.
- **Highlight menu:** same layout.
  - None (white swatch with a red diagonal), Yellow `#fde68a`, Green `#c9f0d3`, Blue `#d3e4ff`, Pink `#ffd6e8`, Violet `#e4d8fb`, Orange `#ffe0c2`, Grey `#e6e6ea`.

### 12.6 Link popover
- **Size:** 330px, padding 6, gap 6.
- **Input:** "Paste a link", 34px white pill; focus is accent + ring. Opens focused.
- **Add:** accent pill, 34px. Enter also applies.
- **Remove:** 34px pill, `rgba(40,40,60,.06)`.
- **Behaviour:**
  - Save the editor selection when the popover opens and restore it before applying.
  - URLs without a scheme get `https://`.
  - Esc closes.

### 12.7 Page
- **Container:** `max-width: 780px | 1040px; margin:16px auto 64px; padding:0 16px`.
- **Sheet:** radius 30, padding 56/56/96, `--glass-page` with blur 24 saturate 170, 1px border `rgba(255,255,255,.9)`, shadow `inset 0 1px 0 #fff, 0 10px 40px rgba(30,45,40,.06)`.
- **Document title:** shown as the first H1.
- **Editor:** 17px / 1.65, `--text-2`, caret colour `--accent`. `contentEditable` only for editors.

**Element styles inside the editor** (ProseMirror node views / CSS):

| Node | Style |
|---|---|
| h1 | 32/600/1.2, −0.025em, margin 0 0 20, `--text` |
| h2 | 21/600/1.3, −0.02em, margin 30 0 10 |
| h3 | 17/600/1.35, margin 22 0 8 |
| p | margin 0 0 14 |
| blockquote | margin 18 0, padding 2 0 2 18, `border-left:3px solid oklch(0.42 0.11 285 / .35)`, `--text-muted` |
| pre / code block | radius 14, padding 14×16, `rgba(40,40,60,.05)`, `ui-monospace` 14/1.55, `white-space:pre-wrap` |
| ul / ol | margin 0 0 14, padding-left 24; li margin 0 0 4 |
| hr | no border, 1px `rgba(40,40,60,.14)`, margin 28 0 |
| table | width 100%, `border-collapse:separate`, 1px `rgba(40,40,60,.14)` outer border, radius 12, overflow hidden, 15px |
| td | right/bottom 1px `rgba(40,40,60,.1)`, padding 8×12, min-width 60, top-aligned |
| a | `--accent`, underline, offset 2px |
| text colour / highlight | inline marks (`textStyle` colour, `highlight`) |

**Implementation notes**
- Build the toolbar on ProseMirror commands (`toggleMark`, `setBlockType`, `wrapIn`, list commands, a table plugin), not `document.execCommand`. The prototype uses `execCommand` only for convenience.
- Shortcuts:
  - ⌘B/I/U through the keymap.
  - ⌘⌥0–3 for block types, matched on `event.code` (`Digit0–3`) so they work on macOS.
  - Don't bind ⌘K in the editor; it's the global palette shortcut.
- **New schema marks/nodes needed:** underline, strike, text colour, highlight, alignment attribute, table, horizontal rule, code block.
- **Word count:** count whitespace-separated tokens of `doc.textContent`, debounced to about 150ms.

**Remote cursors:** a 2px bar in the peer's colour, radius 1. The label pill sits above it (11/500, white text, padding 4×8, `0 4px 10px` shadow in the peer's colour at 30%). Position changes animate `left/top .7s var(--ease)`.

---

## 13. History panel
- **Panel:** `position:fixed; top:84px; right:16px; bottom:16px; width:330px; z-index:25`, radius 28, `rgba(255,255,255,.66)` with blur 30, entrance `g-side .6s`.
- **Header** (padding 20/20/10): "History" (18/600) + a 30px close circle.
- **Slider:** range input with `accent-color: var(--accent)`, labelled "Earliest … Now" (12, `--text-faint`).
- **List,** newest first. Rows 10×12 with radius 18: a 32px author avatar, the description (14/500) and "Author · time" (12.5, faint).
  - Selected row: `rgba(255,255,255,.85)`. Hover `.75`. Transition .35s.
- **Selecting an older entry:** the content becomes a read-only preview (fade .4s) and the version pill appears (§5.6).
- **Restore:** writes the old state as a **new** update, then toasts "Restored version from {date}".

---

## 14. Share sheet
- **Shell:** same overlay and sheet as §11, max-width 510.
- **Title:** Share "{workspace}" (21/600) + close.
- **Invite bar** (owner only): a container pill (`rgba(255,255,255,.7)`, white border, `inset 0 1px 2px rgba(0,0,0,.04)`, padding 5) holding:
  - A borderless email input, "Add people by email".
  - A role `<select>` (Can view / Can edit / Owner), 36px pill, `rgba(0,0,0,.05)`.
  - An **Add** accent pill.
  - Enter submits.
- **Errors** (13px, `--danger`, `g-pop .4s`):
  - "We couldn't find {email}. Ask them to sign in once, then try again."
  - "{email} already has access."
- **Members:** 36px avatar, name, email. The owner sees a role select for everyone except themselves; others see the role as text.
- **Footnote** (12.5, faint): "People need to have signed in once before you can add them. Role changes apply the next time they connect."
- **Toasts:** "{name} added", "{name} can edit now".

---

## 15. ⌘K palette
- **Overlay:** see §3. `g-fade .3s`.
- **Panel:** `padding-top:110px`; max-width 580, radius 28, `rgba(255,255,255,.72)` with `blur(36px) saturate(200%)`, `g-pop .5s`.
- **Input:** 60px, 18px text, "Search documents and actions", with a bottom line `rgba(0,0,0,.06)`. Focused on open.
- **Results:** max-height 340, padding 8. Each row is a 46px pill: label (15) + hint (12.5, .7 opacity).
  - Selected row: `--accent` background with white text; transitions .25s.
  - Items: the workspace's documents, Overview, All workspaces, Share, Go offline / Reconnect.
  - Empty: "No matches."
- **Keyboard:** ↑/↓, Enter runs, Esc closes.
- **Open:** Meta/Ctrl + K, globally.

---

## 16. Toasts
- **Look:** fixed, bottom-centre 28px, dark glass, pill, padding 12×20, 14px white text, an 8px `--toast-dot`.
- **Motion:** enter `g-up .55s`; auto-hide after 3.2s. A new toast replaces the current one.
- **Messages:**
  - "Back online · {n} changes synced"
  - "Restored version from …"
  - "{name} added"
  - "{name} can edit now"
  - "Created {workspace}"

---

## 17. Motion

```css
@keyframes g-in   {from{opacity:0;transform:translateY(14px);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
@keyframes g-pop  {from{opacity:0;transform:translateY(-6px) scale(.96);filter:blur(4px)}to{opacity:1;transform:none;filter:none}}
@keyframes g-sheet{from{opacity:0;transform:translateY(24px) scale(.97)}to{opacity:1;transform:none}}
@keyframes g-side {from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
@keyframes g-fade {from{opacity:0}to{opacity:1}}
@keyframes g-up   {from{opacity:0;transform:translate(-50%,16px) scale(.96)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes g-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
```

| Duration | Used for |
|---|---|
| .2–.3s | colour and background changes, toolbar tab fade, palette selection |
| .4s | button press, popovers, dropdowns, splat landing (.65s) |
| .55s | tab indicator, nav width, card and tile hover, page width |
| .6–.7s | screen entrance, sheets, history panel, remote cursor |

- **Easing:** `--ease` everywhere. Nothing bounces except the splat landing.
- **Closing is instant:** popovers, menus and sheets close without an exit animation.
- **Press depth:** small round buttons `scale(.92)`, toolbar tools `.92`, pills `.95`, cards and tiles `.98`, sign-in buttons `.97`.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, all keyframes become instant, the splatter freezes and transitions become 0s.

**Overview → Launch board, in order**
1. On click, any open popovers close and the old page is removed instantly.
2. 0–.55s: the indicator slides and resizes to the new tab, the tab text cross-fades colour over .3s, and the nav grows evenly from the centre as the avatars and History appear.
3. 0–.7s: the board rises 14px into focus; each card enters over .5s.
4. Peer presence rings start showing.

---

## 18. States & roles

| State | UI |
|---|---|
| Connected | green dot, "{n} here" (you included) |
| Offline | amber dot, offline pill, queued count rising, tab presence dots hidden, peers faded to .35 |
| Syncing | violet pulsing dot, "Back online. Syncing your changes…" |
| Viewer | "View only" pills (nav + toolbar), toolbar shows the View tab only, no create/add/delete/drag/restore, editor not editable, card fields read-only |
| Preview (history) | content read-only, toolbar hidden, version pill shown |

---

## 19. Production wiring

| UI | Source |
|---|---|
| Connection | y-websocket `status`: connected / disconnected / connecting |
| Queued count | local `doc.on('update')` while disconnected; reset on `sync` |
| Response time | awareness / ping round-trip |
| Presence, card focus, cursors | `provider.awareness` `{ user:{name,color}, cardId?, mode }`, driving the avatars, card rings and the tab dot (open doc only until per-doc presence exists) |
| Version | server update sequence (needs exposing) |
| History | new API: snapshot/session list + state at an update id (see backend plan) |
| Card notes / activity | `description` on the card Y.Map + a per-card activity Y.Array |
| Roles | session / JWT. The UI hides affordances; the sync server enforces them |

**Agreed backend order:** (1) card notes + activity → (2) offline metrics (client side) → (3) `userId` on updates + version number → (4) history API + restore.

---

## 20. Accessibility checklist
- Text contrast is at least 4.5:1. `--text-faint` passes on white and on the canvas. Any small text over the canvas sits on a frosted pill.
- Every icon-only button has an `aria-label` and a `title` with its shortcut.
- Visible focus rings everywhere (accent + 4–5px halo).
- Sheets trap focus and return it to whatever opened them. Esc closes all overlays.
- Clickable targets are at least 32px in the toolbar and 36px elsewhere.
- Reduced-motion support as in §17.

---

## Files
- `Workspace D - Glass.dc.html`: interactive prototype (source of truth)
- `support.js`: runtime needed to open it

---

## Precedence, and where this file disagrees with itself

**Sections 1–20 above are the design authority**, regenerated from the design tool on
2026-10-03. They replaced a narrative handoff roughly a third of this length.

**The Implementation status section below is the build record** — what exists, what was
measured, every deliberate deviation and why. The regenerated design sections carry none
of that, and it is not recoverable, so it travels with them rather than being replaced
by them.

**Where a decision made in conversation postdates this file, the decision wins.** The
design tool regenerates from its own prototype and cannot know what was agreed
afterwards. The three below were all decided on 2026-10-03, after the state this file
describes:

| Item | This file says | Decided later, and shipped |
|---|---|---|
| Splat scale | `range(0.6, 1.2)` (§4.2) | **`range(0.7, 1.4)`** — the owner asked for "a little" bigger and chose +17% from measured options, median span 116 → 134px |
| Document body | 17px (§12.7) | **18px** — the owner asked for reading text a size up; the 15px base went to 16px with it |
| Document page margin | `16px auto 64px` (§12.7) | **`28px auto 64px`** — from the screenshot review, where the sheet was touching the nav |

**Decisions of 2026-10-08 (nav polish and renaming).** Made by the owner after this
file was generated, so they win over §5.3 and §10 where they differ. Plan:
`2026-10-08-nav-polish-and-renaming.md`.

1. The nav moves smoothly: it grows or shrinks once to fit its contents and never
   collapses and reopens between pages.
2. Everyone in the open document, you included, is one avatar group before History and
   the status pill; the account button stays at the far right and must not look like a
   second person.
3. Documents and boards can be renamed from the workspace overview and from inside the
   open document or board; the nav tab follows.
4. Columns can be renamed inline and deleted; deleting one that still has cards asks
   first and says how many cards go, and an empty column deletes straight away.
5. A rename is saved to Postgres, the person renaming sees it everywhere at once, and
   everyone else sees it on their next data load. Titles are not live-synced through the
   CRDT.

**Zoom and the document title (decided 2026-10-03, while closing the toolbar).** §12.4's
prose says zoom is "applied as `zoom` on the editor container". Built to the letter, that
leaves the document title outside the zoomed element, so at 70% a 32px title sits over
12.6px body text and at 150% the title is smaller than a body line. The prototype zooms a
`div` that *contains* the editor, and the document's `h1` is the first block inside it
(`glass-prototype.html` line 276 is the zoomed wrapper, line 456 builds the `h1` as part of
the editor's own content), so there the title scales with the body. §0 says the prototype wins where it and the prose disagree, and it
is also the coherent reading, so the title scales: `DocumentEditor` puts `zoom` on a
wrapper (`data-testid="document-zoom"`) around the heading and the editor, and not on
`.editor` alone. The sheet's padding is outside the wrapper and does not scale, as in the
prototype.

**The prototype it names as source of truth is in this repository**, as
`docs/design/glass-prototype.html` with `docs/design/support.js` beside it — the
runtime it loads by that exact name, which is why the file is not prefixed like its
neighbour. Open the HTML in a browser to use it. Both were committed on 2026-10-03
from `CRDT workspace design.zip`; the previous prototype in this folder was the older,
smaller one and had no runtime at all, which is why earlier notes call it stale.

**Token migration, 2026-10-03.** `globals.css` now carries section 2's names and
values. Renames: `--glass-bg` → `--glass-light`, `--glass-bg-strong` → `--glass-mid`,
`--glass-bg-sheet` → `--glass-sheet`, `--glass-blur` → `--blur-2`, `--glass-highlight`
→ `--glass-hl`, `--r-column` → `--r-col` — 30 references across 16 stylesheets. Added:
`--glass-col/-tool/-page/-menu`, `--blur-1/-3`, `--accent-soft`, `--toast-dot`,
`--line`, `--sep`, `--dash`, `--track`, `--r-tool/-item/-menu/-pop`. Several are unused
until the editor toolbar lands; they are defined because this block is the design
system, not only the set of values currently referenced.

Two values changed with the names: `--accent-text` from `oklch(0.38 0.1 285)` to
`oklch(0.36 0.11 285)` and `--accent-ring` from `/ .1` to `/ .12`. The accent-text
change lowers lightness at a fixed hue, so contrast against a light background can
only improve — reasoned, not measured.

Four tokens are ours and deliberately not in section 2: `--dur`, `--dur-fast` and
`--dur-slow`, because section 2 writes durations as literals and three tokens beat
scattering them through 16 stylesheets; `--font`, because section 2 gives the stack in
prose while the parked `editor-type.ts` stores `var(--font)` for a document's font family; and `--ok-text`,
a contrast-safe variant of `--ok`, which is a dot colour that fails 4.5:1 as text.

**One literal was deliberately not tokenised.** The "+ Add a card" ghost pill's inset
border is `rgba(40,40,60,.08)`, the same value as `--track`, and a different thing. The
`@supports not (backdrop-filter)` fallback now raises all seven glass levels to `.92`.

**Two more disagreements, both still open:**

- **Device pixel ratio.** §4.2 caps it at 2; the code caps at 1, in one named constant,
  with the measurements that justified it recorded below. Raising it roughly quadruples
  the layer's memory. Not changed on the strength of a regenerated document.
- **Minimum splat spacing.** §4.2 requires 120px between centres. Not implemented, and
  not currently measured. It would change the seeded pattern.

**One disagreement this file resolves.** §4.2 states the purple palette as `#7b3fe4`
**×2** — an actual duplicate entry. The build record below documents the opposite
reading ("eleven entries, all distinct — do not add a duplicate"), which was flagged as
an open question rather than guessed at. §4.2 is newer and is the design authority, so
the duplicate is the intended behaviour. **Applying it changes the seeded splatter
pattern on every screen**, so it is a deliberate change with a visible result, not a
tidy-up.


## Implementation status

Six plans are complete:
`2026-10-01-glass-foundation-and-shell.md`, `2026-10-02-board-and-cards.md`,
`2026-10-02-paint-splatter.md`,
`2026-10-02-command-palette-and-share-sheet.md`,
`2026-10-02-document-page-and-nav-consolidation.md` and
`2026-10-02-glass-visual-corrections.md` (all under `docs/superpowers/plans/`).
A seventh, `2026-10-03-document-formatting-toolbar.md`, is recorded in its own
section below; it also changed no schema, sync-server code or API route.

**None of them changed the schema, the sync server, or any API route** (the history and
authorship backend, recorded under "History and authorship backend", did all three). The first
three were visual only. The palette and share sheet plan added real behaviour —
two overlays, keyboard shortcuts, toasts, and moving invite and role editing out
of the People panel — but still reached for no new endpoint: it reuses the
existing members route, which already upserts, so a role change needs no new
backend. The document page and nav consolidation plan (below) likewise changed no
schema, route or sync-server code.

**Superseded on 2026-10-03.** This paragraph described the previous prototype, which
was stale — it used the old `--text-faint` value `#7b7e78` and predated the owner's
deltas. Both the prototype and this document have since been replaced; see the
Precedence section above for what now wins over what.

### Built

Design tokens and keyframes, the painted canvas background, the glass UI
primitives, the sticky glass nav, document tabs with a measured sliding
indicator, and the sign-in, dashboard and workspace screens. Plus the owner's
post-handoff deltas: tab indicator, create tiles, tile text, the faint-text
token and the background pill.

**Board restyle and card peer ring** (board plan). Glass columns, cards, delete
buttons, and the "+ Add a card" and "+ Add a list" controls, with the owner's
add-button values verified character by character against the stylesheet (no
drift). A remote peer on a card gets a ring and a named chip. Two small polish
fixes from the owner's audit:

- The GitHub sign-in button no longer darkens on hover; it lifts 1px
  (`translateY(-1px)`, inside the `prefers-reduced-motion: no-preference` block)
  with the fill unchanged. The Google button lifts the same way and keeps its
  existing fill brightening. A pressed button wins over the lift, so it still
  presses in under the pointer.
- Buttons press in over `0.4s`, as designed, not `0.3s`. `.button`, `.tile`,
  the sign-in provider buttons and the board add controls now all use the same
  duration. There is no `0.4s` token (`--dur` is `0.55s`, `--dur-fast` is
  `0.3s`), so it is a literal `0.4s`, matching the existing uses in
  `ui.module.css`.

**Test coverage note.** Card drag-and-drop had no test coverage before the board
plan. It now has three committed Playwright tests in `e2e/board.spec.ts`: a card
moves across columns, a card dropped on a sibling reorders within its column,
and a card is not left dimmed after a completed drop.

**Visual corrections** (`2026-10-02-glass-visual-corrections.md`), from the owner's
screenshot review:

- **Splats resized and the rays re-tapered.** Values and re-measured memory are in
  the Paint splatter section above; the taper was a real defect, not just a size.
- **Nav exclusion zone**, also in that section. Measured before the fix: 7,874 opaque
  pixels inside the top 90px. After: zero, with paint still present below — the half
  of the test that stops a canvas which never drew from passing.
- **Document page gap and title.** `.page` carries `margin: 28px auto 64px`; the
  board needed nothing, because it is not wrapped in `.page` and its scroller already
  has 28px of top padding, and the dashboard and workspace pages already had the
  review's 40px. The title is the **same** `<h1>` that was screen-reader-only, moved
  from `page.tsx` into `DocumentClient` so it sits inside `.page`, and styled by
  document type: visible on a document, still clipped on a board, where the design has
  no title slot but the page still needs an accessible name. `data-testid`
  `document-heading`; the sheet itself is `document-page`. Size, weight and
  letter-spacing come from the global `h1` rule, which already carries 32px / 600 /
  −0.025em — only the bottom margin, line-height and wrapping are local.
- **Tile and People-card glass raised to .7.** The `.55` the owner saw was never on
  `.tile`, which sets only radius and padding: it came from `--glass-bg` through
  `ui.glass`. **`--glass-bg` is deliberately unchanged at .55**, because the nav, the
  sign-in card, the sheets and the popovers all read it and none of them was asked to
  change; a test asserts the token's value for exactly that reason. The three surfaces
  named in the review carry their own fill instead: `.tile` (dashboard), `.docTile` and
  `.people` (workspace). The selectors are doubled (`.tile.tile`) to beat `ui.glass`
  deterministically — measured, a single class does win today, but the import graph
  decides that order and moving a route file is enough to change it. Contrast over the
  composited result: `--text-faint` 4.827 → 4.916:1, `--text-muted` 5.862 → 5.971:1.
- **The column drag-over outline was never broken.** The owner reported no violet
  outline when dragging over a column. Probed with a held mid-drag, the target column
  gains `oklch(0.42 0.11 285) 0px 0px 0px 2px inset` and the `columnOver` class, and
  loses both after the drop. None of the suspected causes applies: `.columnOver` is
  declared after `.column` in the same stylesheet so it wins on source order, and
  `dragover` bubbles from the cards so crossing a child does not strip the state. No
  code changed. It is now covered by a test, which it never was — `dragTo()` completes
  atomically and never exposes the state, which is why the report could stand
  unanswered.

**Centred nav and board** (owner's 2026-10-04 nav spec, items 1–5). The wrapper is a
centred flex column; the bar is `fit-content` with `max-width:100%`; its width
transitions over `--dur` with `interpolate-size: allow-keywords` on `:root`; the tabs
strip and the dashboard's label slot both dropped from `flex:1 1 auto` to `0 1 auto`;
and the board's column row is centred. (It was 44px below the nav; since 2026-10-08 the
scroller's top padding is 20px under the board's title, which sits 24px below the nav.
See the deviation table under "Shell routing and nav".)

- **`flex: 0 1 auto` on the strip and the slot is load-bearing, not tidying.** The bar
  sizes itself to that row, so a child that grows to fill the bar makes the bar grow to
  fill the window — each waiting on the other — and the centring is lost. A test
  asserts the bar is under 1200px wide at a 1600px viewport, which is what catches a
  revert to `1 1 auto`.
- **The dashboard's slot now carries a "Workspaces" label.** With a content-sized bar
  an unlabelled 120px spacer is a visible hole rather than slack, so this had to land
  with the pill rather than later.
- **`interpolate-size` is Chrome 129+ and Edge.** Elsewhere the width jumps to its new
  value, which is still correct and usable; only the animation is lost. Not verified in
  a browser that lacks it.
- **The width animation only plays for changes within a page** — the green dot
  appearing, the View only pill, the status label hiding below 1100px. Inside a
  workspace it also plays across a navigation, because the bar is the same node (see
  "Shell routing and nav" below). Between the dashboard and a workspace the bar is still
  a new node, and `lastNavWidth` carries the width across.
- **The board's `margin: 0 auto` needs `width: fit-content` to do anything**, since the
  scroller is otherwise full width. `justify-content: center` is the obvious
  alternative and is wrong: with overflow it leaves the first column unreachable.

**Motion continuity across a navigation** (2026-10-03). Both the sliding pill and the
bar's width used to start from nothing on every navigation, because every page renders
its own `AppShell` and the nav is therefore a new node. Each now remembers its previous
value in module scope and animates from it: `lastMetrics` in `NavTabs`, `lastNavWidth`
in `AppShell`. The shared workspace layout removed the need inside a workspace; both are
kept for navigations to and from the dashboard, which renders its own shell.

- **Set-the-start-then-force-a-reflow does not work on a freshly inserted node.** A
  property's first resolved value on a new element is its initial value, not something
  to transition from, so the transition was swallowed and the width jumped — measured,
  not assumed. The start width is pinned with `transition: none`, painted for one
  frame, and changed inside a `requestAnimationFrame`.
- **The width effect needs its `animating` guard.** It has no dependency array, so it
  runs after every render; clearing the inline width to measure would snap the bar to
  its destination, and `scrollWidth` reports the inline width rather than the natural
  one while shrinking.
- **`AppShell` subscribes to the doc store for the re-render, not the values.** The
  green dot, the status label and the presence avatars all change the bar's width
  without changing a prop of `AppShell`.
- **Module scope is safe here**: both values are written only from layout effects,
  which do not run during SSR, so they are null on the server and every render agrees.
  `lastMetrics` can be stale across workspaces, in which case the pill slides from a
  slightly wrong place — still better than materialising from nothing.
- **Both tests had to be rewritten to discriminate.** The first version measured the
  pill's viewport x, which drifts as the centred bar resizes whether or not the pill is
  animating; the second asserted the first sample, which is the *old* page's pill. The
  property that actually distinguishes the fix is that the pill never leaves the span
  between the two tabs.

**Green dot, offline.** The dot now requires `status === 'connected'`, because it
asserts that other people are in this document right now and a disconnected tab cannot
know that — awareness goes stale rather than empty. **Not covered by a test, and the
reason matters:** y-websocket has no active close-on-offline behaviour, so `status` only
becomes `disconnected` when its dead-peer timer fires about thirty seconds later. A
test would have to wait that long and would be racing the retry. The prompt signal is
`navigator.onLine`, which arrives with
`2026-10-04-connection-states-and-telemetry.md`; the dot becomes promptly correct then.

**Nav polish and renaming** (`2026-10-08-nav-polish-and-renaming.md`). No schema or
sync-server change; one new API route.

- **Column rename and delete.** `renameColumn` and `removeColumn` in
  `packages/shared/src/board.ts`, both CRDT operations that are live for everyone.
  `ColumnHead.tsx` has the inline title (it saves only what the user typed, so a
  peer's rename survives a blur with no change) and the delete button. An empty column
  deletes at once; otherwise an in-place confirm names the card count. Focus returns to
  the delete button after Cancel or Escape, and after a delete moves to the next
  column's delete button, else the previous one's, else Add list. Test ids use the `col-` prefix so the
  `column-` and `card-` prefix selectors in `e2e/board.spec.ts` keep counting correctly.
- **Renaming documents and boards.** `PATCH /api/documents/[id]` (editor or owner;
  title trimmed, 1 to 200 characters; viewer gets 403, non-member 404), called through
  `lib/rename-document.ts`. `InlineTitle.tsx` saves only typed changes, and on failure
  reverts and toasts "Could not rename. Try again." `DocumentTile.tsx` has the pencil on
  the overview tile, and shows the just-saved title (`shown`, cleared when the `title`
  prop changes) until the refresh returns, so the old name never flashes back.
  Viewers see plain text and no controls.
- **The people group.** `NavPresence` shows you first ("<name> (you)", `presence-self`),
  then peers, on every document page from the route, before History and the status
  pill. `SyncStatus` and `NavPresence` ignore store data that belongs to a different
  document.
- **Steady nav width.** While the document on screen is still connecting, plus a 300ms
  grace for people to arrive after it connects, the bar does not shrink. It holds its
  width, also when a width animation is already running (it stops that one where it
  stands), then animates once when the document connects or after 3s at most (a production
  connect can take longer than 1.5s), restarted per document. A `ResizeObserver` keeps `lastNavWidth` equal to the on-screen
  width, except while the bar is animating or holding, when it deliberately skips; widths include the 1px border. Under reduced motion the hold still applies and
  the bar changes size at most once, without animation. The width animation ends on the bar's own `width` `transitionend` only
  (`event.target === bar`, `propertyName === 'width'`): the event bubbles, and a tab's
  colour transition would otherwise cut it short.

### Shell routing and nav

`2026-10-03-shell-routing-and-nav.md`. No schema, sync-server or API change.

- **One nav per workspace.** `AppShell` is rendered by `app/workspaces/[id]/layout.tsx`
  and is not rebuilt inside a workspace (`glass-shell.spec.ts`, "moving between the
  overview and documents keeps the same nav element"). The dashboard still renders its
  own. Documents are at `/workspaces/[id]/documents/[docId]`; links come from
  `documentHref` and `activeDocumentIdFrom` in `lib/routes.ts`. The old flat
  `/documents/[id]` redirects. `lastMetrics` (`NavTabs`) and `lastNavWidth`
  (`AppShell`) remain, for navigations to and from the dashboard.
- **A layout is not an access gate here, and every page under it checks for itself.**
  Do not delete the per-page checks as duplication. A layout does not re-render on a
  client navigation between its children, so a check there would run once and then let
  later navigations through. A page can also be fetched without its layout (a client
  navigation can request a page's RSC payload on its own), so the page has to check
  for itself. The canonical document page checks both ids. The old `/documents/[id]`
  route checks the role before it redirects, so a document id never reveals its
  workspace id: a non-member gets a 404 with no `location` header (`e2e/routing.spec.ts`).
  It forwards the query string too, repeated keys included.
- **Condensed nav (§5.5).** Past 24px of scroll: bar 56 to 46, top gap 12 to 6, fill
  .72 to .85, over 0.4s with `--ease`. It expands again at or below 12px; the 12px dead
  band is there because a single threshold flickered. The duration is a literal because
  no token is 0.4s. The attribute is `data-condensed` where §5.5 says `data-compact`.
  `.navWrap` has a fixed in-flow height of 68px so condensing never moves page content;
  without it the 16px layout shift and scroll anchoring made the nav flip ten times in
  1.5s at scrollY 25 to 28. Anything floating under the nav must therefore be
  absolutely positioned, because the wrapper does not grow. `--nav-bottom` (68px, 52px
  condensed) is set on `.shell`.
- **Breakpoints.** Beside the 1100px rules, below 760px the tab strip becomes a dropdown
  (`NavMenu`, testids `nav-menu*`) and the workspace name and its divider hide. The
  dropdown is a disclosure of links, not an ARIA menu, on purpose: its items are
  navigation, and the menu pattern would promise arrow-key behaviour and a roving focus
  that links do not need. It uses `--glass-menu` and `--r-menu`. The presence dot is
  derived once (`hasOthersHere` in `lib/doc-state.ts`).
- **Presence count.** The status pill reads `{peers + 1} here` when anyone else is
  present, and the connection label ("Synced") when alone.
- **History button.** On documents only, before the status pill, as §5.3 orders it. It
  opens the History panel (see "History panel, version preview and restore" below). It
  first opened a placeholder panel that said history was not available yet.

| Where | §5.3 says | Built | Why |
|---|---|---|---|
| Condensed attribute (§5.5) | `data-compact` | `data-condensed` | Matches the state's name in `AppShell`. |
| Condensed duration | `.4s` | `0.4s` literal | No token matches. |
| Account button (§5.3 row 9) | 36px avatar, 2px white ring, filled | White button with your initial in your colour (`account-trigger`) | A filled avatar next to the people group read as a second person (Decision 2). |
| Board title (§10) | No title slot; the board starts at its columns | The board's title sits above the columns and is editable; the scroller's top padding went 44px to 20px | Boards need a place to be renamed from inside (Decision 3). |
| Document and board titles | Not specified | Not live-synced: others see a rename on their next data load | Decision 5. Titles live in Postgres, not the CRDT. |
| Column rename and delete (§10) | Not specified | Inline title, delete with an in-place confirm that names the card count (`ColumnHead.tsx`) | Decision 4. |

### Paint splatter

Built, on branch `glass-features`: `components/PaintSplatter.tsx` (client island),
`lib/splatter/{random,geometry,paint}.ts`, tests in `test/splatter-*.test.ts` and
`e2e/glass-shell.spec.ts`. **This subsection is now the specification.** It was
written by the owner in a chat message on 2026-10-02 that is not in the repository;
what follows is that specification as built, plus the places the build differs from
it. Where this subsection and the code disagree, that is a defect in one of them.

**Placement and stacking.** One `<canvas data-testid="paint-splatter">`, `aria-hidden`,
absolutely positioned (`inset: 0`, 100% by 100%) inside the fixed, full-viewport
`.canvas` layer of `CanvasBackground` (`z-index: 0`, `pointer-events: none`,
`overflow: hidden`). Back to front: the five blobs, **the splatter**, the canvas weave
(`mix-blend-mode: multiply`), so the texture reads over the paint. It inherits
`pointer-events: none`, and a test reads it on the element itself. `CanvasBackground`
stays a server component; `PaintSplatter` is its only client child.

**Strength.** Layer opacity, set inline from one prop: `subtle` 0.32, `bold` 0.9,
`off` renders nothing. Production ships `subtle`. The owner lowered `subtle` from 0.5
to 0.32 in the 2026-10-02 review, in the same pass that resized the splats.

**Palettes** (raw hex, artwork rather than tokens, one exported constant `PALETTES` in
`lib/splatter/geometry.ts`). Each splat takes one colour from the chosen palette with
`random.pick`, and so does each speck.

```ts
purple: [
  '#7b3fe4', '#5b4ee8', '#9d5cf0', '#c13ea6', '#e8559b', '#3d8fdc',
  '#22b8c9', '#f0b429', '#f2843a', '#4cc38a', '#b794f6',
],
orange: [
  '#f2762e', '#f0b429', '#e2453c', '#f59e0b', '#2e8bd6', '#2aa58a',
  '#e8559b', '#7b3fe4', '#22b8c9',
],
```

The purple array is as supplied: eleven entries, all distinct. Violet is
over-represented by having three family members in it (`#7b3fe4`, `#9d5cf0`,
`#b794f6`, hues 262, 266 and 261), not by a repeated entry. The owner's note "violet
appears twice" describes that over-representation. Do not add a duplicate and do not
remove any of the three.

**OPEN QUESTION for the design owner.** The 2026-10-04 spec restates this as
"`#7b3fe4` (twice, so it appears more often)", which reads as an actual duplicate
entry rather than the family over-representation above. The two readings disagree and
only the owner can settle it. Nothing has been changed on a guess: duplicating the
entry would shift every `random.pick` after it and therefore change the seeded pattern
on every screen. A code comment in `geometry.ts` did claim violet appeared twice, which
was false of the array; it now describes what is actually there and points here.

**Per splat** (drawn once onto its own offscreen canvas, in splat-local coordinates,
origin at the centre, scale 0.7 to 1.4). **These magnitudes are the 2026-10-02
review's; the structure is unchanged from the original spec.**

- **Core:** 9 overlapping circles, radius 0.55 to 1.0 of an 11px base (times scale),
  centres within 0.45 of that base radius of the origin so they merge into one mass.
- **Rays:** 10 to 23, at random angles over the full circle. Each is a tapered streak
  of 1.5 to 5 core radii, **1.5 to 4px wide at the base and narrowing to 15% of that
  at the tip**, ending in a **tip blob** of 1 to 2.5px radius. **35%** of rays also
  carry a **drip** hanging straight down from the tip, 0.4 to 1.4 core radii long,
  drawn no wider than the tip blob and ending in a bulb of 0.75 of the tip radius.
  - The 15% taper is load-bearing and was a defect, not just a number. The tip
    half-width used to be derived from the tip blob's radius (`tipR * 0.6`), which
    left the tip at roughly 60% of the base with a blob as wide as the base on the
    end. That is the "spider legs" the owner reported, and resizing alone preserved
    the ratio. It is now derived from the ray's own width.
- **Droplets:** 40 to 90, scattered from one core radius out to about 5.2, **decreasing
  in size** along the list (radius from about 2.5px to 0.4px, times scale) and fading
  from alpha 1 to 0.7 so the spray thins at its edge.
- **Core drips:** 0 to 3, vertical, straight down from the core, 0.8 to 2.2 core radii
  long, 1 to 2.5px wide, with an end blob.

**Count and specks.** Splats on screen: `10 + 8 × √(W·H) / 1100`, rounded (18 at
1440×900, 20 at 1920×1080, 24 at 2560×1440). Plus **320 specks** scattered over the
viewport, each a small square (half-side 0.6 to 1.8px) in a palette colour, drawn
straight onto the visible canvas rather than through an offscreen canvas.

**Nav exclusion zone.** Nothing is painted in the **top 90px** of the viewport —
neither splats nor specks. Added in the 2026-10-02 review: splat colour read straight
through the nav's `backdrop-filter` as coloured streaks inside the bar. The zone is
viewport space, not document space, which is sound because the canvas is absolutely
positioned inside a fixed, full-viewport parent, so canvas y is viewport y. It is
sized for the **unshrunk** nav (12px gap + 56px bar = 68px, plus margin); a condensed
nav occupies less and is still inside it, and the splatter does not react to scroll.
A splat's y is drawn uniformly over the band below `90 + radius` rather than
rejection-sampled or clamped: it consumes one PRNG value as the unconstrained
placement did, cannot loop, and does not pile splats along the boundary. One constant,
`NAV_EXCLUSION_PX`.

**Animation.**

- **Frame rate:** about 30 fps (see deviations); every time below is wall-clock,
  derived from `performance.now()`, never from a frame count.
- **Landing:** 650ms. Scale runs from 0.35 to 1 along an **ease-out-back** curve
  (overshoots, then settles) while alpha ramps from 0 to 1.
- **Life:** 16 to 32 seconds per splat, chosen per splat. Start times are staggered
  inside each splat's own life so they do not all land together.
- **Drift:** linear over the splat's life, up to **±3px** on each axis.
- **Rotation:** a **fixed** rotation per splat, **±0.25 rad**, not animated.
- **Fade-out:** the last **2400ms** of life, alpha falling to 0. At the end of its life
  a splat is re-placed at a new random position and lands again, reusing the same
  offscreen canvas; nothing is rasterised again.
- **Speck shimmer:** alpha oscillates between **0.55 and 0.9** (a sine, 700ms per
  radian, so one cycle is about 4.4 seconds), with a random phase per speck.

**Seed.** A fixed constant, `0x5ca77e5`, never `Date.now()`. The initial pattern is
the same on every load.

**Device pixel ratio.** `min(devicePixelRatio, 1)`: an addition, see deviations. The
spec names a cap of 2. Offscreen canvases are painted at that ratio, so they are never
upscaled. A resize rebuilds everything, **debounced 150ms**, and only when the layer's
size or the device pixel ratio actually changed.

**Reduced motion.** With `prefers-reduced-motion: reduce`, or `motion="still"`, the
component draws **one static frame** (every splat landed and fully opaque, specks at
the middle of their shimmer) and **never calls `requestAnimationFrame`** or registers
a visibility listener. Verified by counting calls, below.

**Loop.** One `requestAnimationFrame` loop, redrawing at most about every 32ms
(about 30 fps). Per draw it clears, then does one `drawImage` per visible splat and one
`fillRect` per speck. No path construction, no gradients, no `shadowBlur` in the loop;
all of that happens once, at build time. Specks are `fillRect` squares for that reason:
an arc is path construction.

**Parameters.** `PaintSplatter` takes `strength` (`off | subtle | bold`), `palette`
(`purple | orange`) and `motion` (`live | still`).

#### Deviations from the owner's specification

1. **The three settings ship as parameters with fixed production defaults and no UI.**
   The design has them as three user settings. Production is fixed at `subtle`,
   `purple`, `live`. A toggle nobody can reach is dead weight; a parameterised
   component keeps the door open and costs nothing.
2. **The loop pauses on a hidden tab.** Not in the spec. A loop burning CPU on a tab
   nobody is looking at is a defect in anything shipped. On hide it cancels its frame;
   on show it shifts every splat's start time by the time spent away, so returning does
   not make every splat expire and land at the same instant.
3. **`splat.radius` carries 1px of margin.** The painter sizes each offscreen canvas
   from it. Without the margin the outermost blob is tangent to the canvas edge, so
   faint antialiased pixels touched the border on 7 of 200 splats at DPR 1 (1 of 200
   at DPR 2). Nothing visible was clipped, but a hard cut on a paint edge reads as a
   rendering bug and this sits behind every screen. Costs about 1.5% more memory.
4. **Splat scale is 0.7 to 1.4.** The 2026-10-02 review cut it to 0.6–1.2; the owner
   then asked on 2026-10-04 for the splats to be "a little" bigger and chose +17% from
   measured options, which returns the range to 0.7–1.4 — now sitting on the review's
   11px core rather than the original 30px one. It sets the memory figure below: the
   bounding radius runs from 45 to 91px, against 39–84 at 0.6–1.2 and 77–194 originally.
5. **Re-placed splat positions after the first cycle are not reproducible across
   loads.** The first placement is a pure function of the seed, which is what the spec
   asks for. After a splat's first life it is re-placed from a random stream that has
   consumed in the order splats happen to expire, which depends on when frames ran
   (and on time spent on a hidden tab), so the second pattern can differ between loads
   and between machines.
6. **Device pixel ratio is capped at 1, not 2.** The spec names 2. The splats sit at
   half opacity under the weave and behind translucent glass, so the sharpness is not
   visible; the memory and raster cost are. Measured at 1440×900 and DPR 2, **at the
   pre-2026-10-02 splat sizes**: splat canvases 29.0 to 16.3 MiB, visible canvas 19.8
   to 11.1 MiB, and the raster cost per draw in software fell from about 22 to about
   12 ms. The resize has since cut the splat side of that by roughly 85%, so these
   figures now overstate the cost of raising the cap — but not the conclusion. The cap lives in one named
   constant, `MAX_DPR`, with that reasoning beside it. Re-measure before raising it.
7. **The loop redraws at about 30 fps.** The spec names no frame rate. `requestAnimationFrame`
   is still the clock, so the browser's throttling and the hidden-tab pause still
   apply; a frame arriving less than 32ms after the last draw only reschedules. The
   fastest motion is the 650ms landing, which still gets about 20 frames, and drift
   and shimmer are slow. Unthrottled, the loop redrew at the display rate (60 to 145
   Hz). Without this and the DPR cap, software raster dropped 39% of frames at 60 Hz.

#### What it costs

Measured 2026-10-02 in Playwright Chromium 153 at 1440×900, with a device pixel ratio
of 2 on the device (so the 1.5 cap is what is exercised), on `/login`. The page-side
`requestAnimationFrame`, `drawImage`, `fillRect` and `clearRect` were instrumented from
a temporary spec (deleted; no component code was touched). Run twice: headed on an
Apple M4 Pro (Metal GPU raster), and headless (SwiftShader, **software raster**, which
is also what a machine with no hardware acceleration gets). "Before" is the same
measurement with a DPR cap of 2 and no throttle.

| | Headed, GPU | Headless, software |
|---|---|---|
| `drawImage` per draw | 28 (min 27) | 28 (min 26) |
| Speck `fillRect` per draw | 320 | 320 |
| Draws per second | 28.8 (display ticks at 144 Hz) | 30.0 (display ticks at 60 Hz) |
| JS in the callback on a draw, median / worst | 0.5 / 0.7 ms | 0.1 / 0.3 ms |
| JS in the callback on a skipped tick | 0.1 / 0.2 ms | 0.0 / 0.2 ms |
| Interval between draws, median / worst | 34.7 / 36.5 ms | 33.3 / 33.5 ms |
| Display ticks over 20ms (1800 ticks) | 0 (0%) | 0 (0%) |
| Draw intervals over 40ms | 0 | 0 |
| Same page, draw calls suppressed | 0 over 20ms | 0 over 20ms |
| Before: ticks over 20ms | 0 of 1500 | 581 of 1500 (39%), about 43 fps |

Software raster cost per draw, measured by forcing a readback after each draw (an
upper bound, since it includes the readback; an empty canvas reads back in 0.4ms):
median **12.3ms**, worst 13.2, against 21.9 before. At 30 draws a second that is about
370ms of raster work per second, **37% of the wall clock, on a machine with no GPU**.
Before it was about 22ms at 43 draws a second, which is the whole budget. On the GPU
the same readback reads 5.8ms, and the page holds a 144 Hz display with nothing dropped.

Read that as follows. The work per draw is a constant 28 composites and 320 fills; it
does not spike when a splat lands or is re-placed (before the levers, slow frames were
38% of landing-or-re-place frames and 40% of quiet frames headless, and 0 headed). The
JavaScript is negligible. The cost is raster. With both levers the layer no longer
makes the page miss a frame in software, but it is not free there: about a third of
the wall clock is raster for a background. If that matters on no-GPU machines, the
remaining levers are 20 fps, a smaller splat scale, or dropping the layer.

**Canvas memory** (`width × height × 4`, summed over every splat canvas). The design
owner later chose a DPR cap of **1** over 1.5, so these are the figures at cap 1,
obtained by replaying the real generator with the real fixed seed in Node — the geometry
is deterministic, so these are exact rather than sampled:

Re-measured after the 2026-10-02 resize, by the same method:

| Viewport | Splats | Splat canvases | Visible canvas | Layer total | At cap 1.5 | At cap 2 |
|---|---|---|---|---|---|---|
| 1440×900 | 18 | 1.3 MiB | 4.9 MiB | **6.3 MiB** | 14.1 MiB | 25.0 MiB |
| 1920×1080 | 20 | 1.4 | 7.9 | 9.3 | 21.0 | 37.3 |
| 2560×1440 | 24 | 1.7 | 14.1 | 15.7 | 35.4 | 62.9 |
| 3440×1440 | 26 | 1.8 | 18.9 | 20.7 | 46.5 | 82.7 |
| 3840×2160 | 31 | 2.1 | 31.6 | **33.8 MiB** | 76.0 | 135.1 |

Three figures for the same viewport, for scale: 1440×900 was 11.4 MiB originally, 5.9
after the 2026-10-02 resize, and 6.3 after the 2026-10-04 +17%. The splat canvases
alone went 6.4 → 1.0 → 1.3 MiB.

Canvas sides at cap 1, min / median / max: 90 / 134 / 182 CSS px at 1440×900 and
86 / 128 / 194 at 4K. **The median span is 134px**, which is above the "at most about
120px across" of the first review — that sentence described the 0.6–1.2 scale, and the
owner has since chosen +17% from measured options with these numbers in front of them,
so 134 is the figure that now stands. Budget was about 40 MB and **every size is still
inside it, including 4K** at 33.8 MiB. The splat canvases never exceed 2.1 MiB, so the
layer is dominated entirely by the **visible canvas**, which is unavoidable for any
viewport-sized layer. Anyone adding splats, widening the scale range or lifting the cap
is spending from this.

**Raster cost is projected, not measured, and the projection is now two steps old.**
Raster scales with pixel count, so the 12.3 ms per draw measured at cap 1.5 was
projected to roughly 5.5 ms at cap 1 — taking a no-GPU machine from about 37% of a
core to about 16%. The 2026-10-02 resize then cut the splat canvas area by about 80%
and the splat count by a third, and the 2026-10-04 +17% gave back a fifth of the area,
so the real figure should still be well below that.
**None of this has been verified in a browser**; the memory figures above have. Treat
the 5.5 ms as an upper bound at best and re-measure before relying on any of it.

**The loop stops.** Counted on a patched `window.requestAnimationFrame`, with the
caller of each call identified from its stack:

- **Reduced motion:** **0** calls to `requestAnimationFrame` from any caller in the 4
  seconds after load, none pending, and the canvas was not blank (24% of its pixels
  painted). The same instrumentation without reduced motion counted 125 calls in 2
  seconds headless (293 headed), every one from `PaintSplatter`.
- **Hidden tab:** after the visibility change, 0 pending frames, one cancel, and 0
  calls over the next 3 seconds. On return the loop resumed (50 calls in 0.8s
  headless, 118 headed). A tab that is hidden at load starts no loop: 0 calls over 2
  seconds. Caveat: the tab was hidden by overriding `document.hidden` and
  `document.visibilityState` and dispatching `visibilitychange`, because neither a
  second window nor minimising made Playwright's Chromium report hidden. That proves
  the component's handler; it does not test the browser's own background throttling.
- A Playwright test, `the splatter loop redraws at about 30 fps`, pins the throttle: it
  counts draws of the canvas over 2 seconds and requires more than 10 and fewer than
  36 a second. With the throttle removed it read 60.

### Command palette, share sheet and viewer pill

Built, on branch `glass-features` (the command palette and share sheet plan). No
schema, route or API change: the share sheet reuses the existing members routes.

- **⌘K palette.** Opens from Cmd or Ctrl+K and from the nav's search field, which is
  now a real `<button data-testid="search">`. Lists the workspace's documents, the
  user's workspaces (passed from the dashboard, where there is no current
  workspace), Overview, All workspaces and Share. Arrow keys, Enter and Escape work;
  it is a `combobox` over a `listbox` in a `dialog`, and never `role="menu"`. Focus
  returns to whatever held it before, or to the search button when that was `<body>`
  (the usual case after the shortcut), so a keyboard user's next Tab continues from
  the nav instead of restarting at the top of the document.
- **Share sheet.** The nav's Share button opens it, on the workspace and document
  pages. Invite by email and role, change roles (owner only), and the member list.
  **Invite and role editing live in the sheet only.**
- **People panel.** `MembersPanel` is now a read-only list. Its link ("Manage" for
  owners, "See who has access" for everyone else) opens the sheet. It no longer has
  any editing controls.
- **Toasts exist as a primitive** (`components/ui/Toast.tsx`: `ToastProvider` and
  `useToast()`). The offline and syncing pills in the status-pill plan can reuse it
  rather than building their own.
- **Viewer pill.** `AppShell` takes a `role` prop; when it is `viewer` a "View only"
  pill (`ui.chip`, `data-testid="view-only"`) renders after the tab strip. The
  workspace and document pages pass it; the dashboard does not, having no single
  role.

**Both overlays must render outside `<nav>`.** The nav has a `backdrop-filter`, and
that makes it the containing block for any `position: fixed` descendant. An overlay
rendered inside the nav is clipped to the nav's 56px bar instead of covering the
viewport. This cost real debugging time. `AppShell` renders the palette and the
sheet as siblings of `<main>`, with a comment saying why; anyone adding a third
overlay must do the same.

### Document page and nav consolidation

Built, on branch `glass-features`. No backend, route or schema change.

- **Document glass sheet.** The page is a 780px centred sheet: radius 30
  (`--r-sheet`), padding 56/56/96, `rgba(255,255,255,.78)`, with the glass blur,
  `--glass-border` and the `--glass-highlight` inset. It lives in
  `app/workspaces/[id]/documents/[docId]/document.module.css` and is applied **only when `type ===
  'doc'`**: the board is a horizontal scroller with its own gutters and would be
  crushed into a 780px column. A test asserts both halves. The editor's temporary 24px
  padding (`.editor .ProseMirror` in `globals.css`) was removed, since the sheet owns
  the padding now.
- **Remote cursor pill.** The label is a pill (`--r-pill`); 11px/500 and the
  `0 4px 10px` shadow already matched. **There is no 0.7s glide**, and that is a
  finding, not an omission: `y-tiptap` renders a remote caret as an inline widget
  decoration (a `<span>` with `position: relative` and no offsets, label absolute
  inside it). When a peer moves, ProseMirror re-inserts the node elsewhere in the
  text flow; no `left` or `top` ever changes, so a transition on them would animate
  nothing. A real glide needs an overlay positioned from `coordsAtPos`.
- **Connection status pill** (`SyncStatus`), **nav presence avatars**
  (`NavPresence`) and the **tab presence dot** (`NavTabs`), all reading the
  document-state store (`lib/doc-state.ts`) that `DocumentClient` publishes to. The
  transitional header row is gone. `Presence.tsx`'s `Presence` export was deleted;
  **`CardPresence` remains** for the board's card rings.

**The document-state store is a module singleton.** It is valid while one document is
open at a time, which is how the app works today. Alternatives rejected:

- *Move the provider into `AppShell`.* It relocates working sync code onto a new
  path, and couples the nav to Yjs on every page, including pages with no document.
- *A shared client layout above the document.* It is the same restructure as making
  the tab indicator glide across navigations. That was decided later: the layout is
  built (see "Shell routing and nav"), and the store stays a singleton because one
  document is still open at a time.

**Three assertions were deliberately retargeted** because their subjects were removed
by design. This was intent-preserving, not an accommodation to make tests pass:

- `read-only` text became the `view-only` pill (the viewer is still told they cannot
  edit, now in the nav).
- The owner's `role` badge became an assertion that **no** `view-only` pill exists
  (the design has no role indicator for owners).
- The `role` chip style guard (a CSS-module class that no longer resolves renders as
  bare text) now guards the document tile's type chip instead.

**Below 1100px the status label and the presence avatars are clipped, not
`display: none`**, so they stay in the accessibility tree. A test proves it by
asserting a bounding box of width <= 1: a `display: none` element has no box at all,
so a non-null box that is also that narrow can only be clipped.

**Known limitations of this plan:**

- **The tab dot appears only on the active tab.** The store holds state for the open
  document only, and the client subscribes to awareness for that document alone.
  Showing the dot on other tabs needs per-document awareness the client does not
  have. This is not a finished feature; it is the part the current data supports.
- **Avatar initials are white on the peer's awareness colour**, which is not
  guaranteed to have contrast for lighter palette entries (white on `#f59e0b` is
  roughly 2:1). The name is carried by `title` and `aria-label`, so the initials are
  decorative, but it is a real contrast shortfall.
- **The tab dot widens its tab**, and the strip's `ResizeObserver` does not fire for
  that (the strip does not change size, one tab inside it does). A layout effect in
  `NavTabs` therefore re-measures the sliding indicator when the dot appears or
  goes. Anyone touching the indicator must keep it, or the pill drifts off its tab.

### Document formatting toolbar

`2026-10-03-document-formatting-toolbar.md`, built against §12 on the branch
`document-formatting-toolbar`. **No Prisma schema change, no sync-server change, no new API
route.** The toolbar's only server-visible effect is that documents can now carry more
marks and nodes, all of which the Y.Doc already represents as ordinary XML.

**Built**

- **One definition of the document's shape** (Tasks 1-2). `editor-schema.ts` holds
  `editorExtensions` and `getEditorSchema()`; the editor and anything that reads a
  stored document use the same list. `editor-type.ts` holds the curated font
  families and the design's size steps (14/16/18/21/26/32), with System stored as
  `var(--font)`. It is a parked design reserve: nothing imports it, and neither
  `FontFamily` nor `FontSize` is in the schema (see the deviation table).
- **Shell** (Task 3, §12.1). `EditorToolbar`, in its own glass panel above the sheet, sticky
  at `top: 80px`. Home / Insert / View as an ARIA tablist, a "View only" chip and a live
  word count. `useEditor` now lives in `DocumentEditor.tsx`, which renders the toolbar and
  the sheet; `Editor.tsx` was absorbed into it and deleted. Viewers get View only.
  Every tool keeps the editor's selection by calling `preventDefault` on mousedown
  (`ToolButton`).
- **Home** (Tasks 4-5, §12.2 and §12.5). Undo/redo, the Style menu (Title, Heading,
  Subheading, Normal, Quote, Code), bold/italic/underline/strike, text colour and
  highlight menus with a last-used bar, bulleted and numbered lists, four alignments, Clear
  formatting. The three menus share one shell (`EditorMenu`); opening one closes the other.
- **Insert** (Task 6, §12.3 and §12.6). Link with its popover, Table (3x3 plus a paragraph
  after it), Divider, Code block, Quote, Date.
- **View** (Task 7, §12.4). Zoom 70-150% in steps of 10, the value resets to 100%; page
  width Narrow (780) and Wide (1040), animating `max-width` over .55s. Per page load, not
  persisted, as in the design.
- **Element styles** (Task 8, §12.7's table). In `globals.css` under `.editor .ProseMirror`:
  h1, h2, h3, p, blockquote, pre, ul/ol/li, hr, table, td/th and a, with colour and
  highlight left as inline marks that none of those rules override. Three
  computed-style tests in `e2e/editor-toolbar.spec.ts` read back from the browser the sizes,
  weights, margins, borders, radii and colours of h1-h3, p, blockquote, pre, lists, hr, table,
  td and a, and that colour and highlight survive; a fourth pins the sheet's 28px margin and
  18px body, and a fifth that the title's painted size follows zoom. Not asserted: `th`, the
  `td p + p` and `blockquote > :last-child` rules, and a cell's line-height.
- **Schema additions**, all in `editorExtensions` so a document carrying any of them reads back whole: underline,
  strike, `textStyle` (carrying colour only: `FontFamily` and `FontSize` are deliberately not
  registered, because they would accept any pasted `font-family` or `font-size`), highlight (multicolor), `textAlign` on headings and paragraphs,
  table / row / cell / header, code block, horizontal rule.

**Deviations from §12, and why**

| Where | §12 says | Built | Why |
|---|---|---|---|
| Document body (§12.7) | 17px | 18px | Later owner decision, see Precedence. Kept. |
| Page margin (§12.7) | `16px auto 64px` | `28px auto 64px` | Later owner decision, see Precedence. Kept. |
| Zoom target (§12.4) | on the editor container | on a wrapper that includes the title | The prototype wins, see Precedence. |
| h3 in the document | 17/600/1.35 | **18**/600/1.35, margin 22 0 8 | §12.7's 17px was superseded when the body moved to 18px. In the prototype the body and the h3 are both 17px (`glass-prototype.html` lines 604 (h3) and 267/277 (body)), so the design never used size to mark a subheading: it used weight, `--text` against `--text-2`, and the 22px top margin. The later 18px body would have turned that parity into a subheading smaller than the text beneath it, which nobody chose. A subheading larger than the body (19-20px) would be a further owner decision, not built. |
| Font family and size controls | not in §12.2's Home table; the toolbar plan and the owner's earlier answers asked for family and size selects | **not built** | §12.2 replaced them with the Style menu. `editor-type.ts` (curated families, the size steps) and its test have no UI consumer and are kept as a parked design reserve. The `FontFamily` and `FontSize` extensions are **not** in `editorExtensions`: their `parseHTML` reads `font-family` and `font-size` off any span, so registering them would let a paste from Word, Google Docs or a web page write arbitrary type into the shared document, which no control could show or remove. No existing document can carry the attributes (`textStyle` was not in the schema before this branch), so leaving them out costs nothing now; adding them later and removing them after documents carry them would make a history restore drop them silently. If font controls are built, register extensions that accept only `editor-type.ts`'s values. Guarded by `editor-schema.test.ts` and a paste test in `editor-toolbar.spec.ts`. |
| Link colour (§12.7) | `--accent` | `--accent`, in the editor only | The global `a` rule uses `--accent-text`; the editor's rule is scoped, so the rest of the app is unchanged. |
| Text in a list item, quote, cell | not specified (the spec's items are bare text) | paragraphs inside them are reset (no 14px tail, and a cell's text is the table's 15px, not 18px) | ProseMirror wraps all of them in `<p>`; the spec's margins describe the block, not a paragraph inside it. |
| `th` | not in the table | same as `td`, weight 600, left | The schema carries a header node, so a document that has one reads back whole. The toolbar cannot make one. |
| Word count (§12.7) | tokens of `doc.textContent` | `textBetween` joined with spaces, 150ms debounce, "1 word" singular | `textContent` fuses paragraphs ("three" + "four" counts once). Counts the body, not the title. |
| Tabs (§12.1) | "every tool" keeps the selection | tabs do too | Clicking Insert would otherwise drop the selection before an Insert tool was reached. |
| Tool row keyboard | silent | one Tab stop, arrows move within the row (`useRovingToolRow`) | The ARIA toolbar pattern; fourteen tab stops in front of the page was worse. Tools use `aria-disabled`, never `disabled`. |
| Selected swatch (§12.5) | silent | follows the selection, not the last choice | What Word does and what clicking into red text expects. The bar still shows the last colour used. |
| Default / None swatch | silent | removes the mark | Rather than writing `#1c1d1b`, which would hold the colour fixed if `--text` changes. |
| Highlight ring | silent | `rgba(40,40,60,.35)`, the prototype's | A pale yellow ring does not show on white. |
| Menu row height | 38px | `min-height: 38px` | The prototype's; the 22px Title row grows to about 40px. |
| Menu glass | blur on the panel | blur on a `::before` layer of the panel | A `backdrop-filter` ancestor stops a descendant blurring the page (it blurs the panel instead). The page's overlay rule applies here too. |
| Link popover | "Add" and "Remove" | also prefills an existing link and disables Remove when there is none; saves the selection as Yjs **relative positions**; refuses with a visible message if a peer deleted the text | Offsets linked the wrong span when a peer typed with the popover open (found by a two-browser test). |
| Opening a link | silent | `openOnClick: false`, and **Cmd/Ctrl-click** follows a link in an editable document | A plain click has to place the caret or an existing link cannot be edited. A viewer's click is untouched. |
| Table | "a table plugin" | `@tiptap/extension-table`, `resizable: false` | No column-resize handles; nothing in the toolbar drives them. |
| Sticky offset (§12.1) | "12px under the nav" | `top: calc(var(--nav-bottom) + 12px)`: 80px, and 64px once the nav condenses | `--nav-bottom` is set on the shell from the nav's state (68px, condensed 52px); the toolbar's `top` animates with the nav over .4s. |

**Asked for by §12 and not built at the time**

- **The history preview's "toolbar hidden" state.** Built later, by
  `2026-10-04-history-panel-and-preview.md`: `DocumentEditor` takes `toolbar={false}` and a
  `content` prop, and there is no separate read-only editor (see "History panel, version
  preview and restore" below).
- **A way for keyboard-only and touch editors to follow a link.** Not a regression, since
  nobody could before; §12.6 lists no Open control, so Cmd/Ctrl-click is the only route.
  A rendered-only `title` on anchors in editable mode is the cheap partial fix.
- **Pinned tests for the ⌘⌥0-3 shortcuts.** The Style menu shows them and Tiptap's own
  heading and paragraph bindings supply them. No test presses them, so the §12.7 note to
  match on `event.code` is **unverified on macOS**.
- **Per-document `zoom` / width persistence.** The design does not ask for it.

**CSS `zoom`: verified in Chromium 153 only.** Remote carets were measured against
`view.coordsAtPos` at 70, 100 and 150%, and in mixed pairs (one browser at 150%, the other
at 70%): no drift. That is not the exposure. Carets here are inline widget spans in the
text flow, so they scale with the text in any browser. The exposure is **ProseMirror's own
`posAtCoords` and `coordsAtPos`**, which drive local clicks, drag selection and
scroll-into-view, and which Chrome older than 128, and possibly Safari, report unzoomed
under `zoom`. Not tested in Safari, Firefox or old Chrome, and no `transform: scale()`
fallback was built. The same caveat sits as a comment on the `zoom` style in
`DocumentEditor.tsx`. Cost, not drift: the caret's name label lives inside the zoomed
wrapper, so its 11px type is 7.7px at 70%.

**Known gaps found while looking at the finished page** (Task 8; none changes the design):

- **The inline `code` mark is unstyled.** §12.7 lists "pre / code block" only, so a
  backtick span renders in the browser's monospace with no background.
- **A table's right and bottom edges are about 2px**: the outer 1px border plus the last
  column's and row's 1px cell borders. That is §12.7's table taken literally (and the
  prototype's).
- **At a 760px window the sheet is edge to edge**, with no side gutter: `.page` is the sheet
  and the 16px container padding §12.7 puts around it does not exist.
- **Home's last control wraps alone at 760px**: Clear formatting drops to a second row
  with its separator in front of it.

### History and authorship backend

Plan: `2026-10-03-history-and-authorship-backend.md`. Backend only; no UI changed. Unlike
the plans above, this one did change the schema, the sync server and the API routes.
Design record: `docs/superpowers/specs/2026-10-02-history-and-telemetry-design.md`.

- **Authorship.** A nullable `DocumentUpdate.userId` (foreign key to `User`, `ON DELETE
  SET NULL`, indexed), migration `20261003000000_update_authorship`, additive. The sync
  server records the sending connection's user on every persisted update; updates the
  server originates persist with null. If the author's user row no longer exists, the
  batch is written again with null authors rather than dropped. Rows from before the
  migration have no author and show as unknown, permanently.
- **Version list.** `GET /api/documents/[id]/history?limit=` (1 to 200, default 50) returns
  `{ versions }`, each `{ id, startedAt, endedAt, author, updateCount }` with a string id.
  Consecutive updates by the same author with no gap over 5 minutes are one version.
  Only the newest 5,000 update rows are scanned, so older history is not listed.
- **Version content.** `GET /api/documents/[id]/history/[version]` returns the document's
  state at that version as raw bytes (`application/octet-stream`). A non-digit id
  returns 400; an id that is not a row of this document, or is out of range, returns 404. Non-members get 404; viewers may read.
  Rebuilt from update rows only, never snapshots, so cost grows with history; a version
  that would replay more than 20,000 rows returns 413 `{ error: 'too large to preview' }`.
- **Restore.** No route. `restoreBoard(live, from)` in `@crdt/shared/board` and
  `restoreEditor(live, from)` in `apps/web/src/lib/restore-editor.ts` write the past state
  into the live doc on the client, through the existing socket. Viewers cannot restore:
  the sync server's per-frame guard rejects their update frames.
- **Deployment.** Run `prisma migrate deploy` against the production database **before**
  deploying the sync server that writes `userId`.

### History panel, version preview and restore

Plan: `2026-10-04-history-panel-and-preview.md`. The UI over the backend recorded above.
No schema, sync-server or route change. Design record for the merge wording: Decision 2 in
`docs/superpowers/specs/2026-10-02-history-and-telemetry-design.md`.

**What was built**

- **The History button and panel** (`HistoryButton.tsx`, `HistoryPanel.tsx`,
  `history-panel.module.css`). A fixed column at the right: 330px wide, 16px from the right and
  bottom, radius `--r-panel`, `rgba(255,255,255,.66)` with `--blur-3`, `z-index` 25 (above the
  content, below the nav's 30). Header "History" with a close circle, the slider, then the list,
  newest first. A row is a 32px avatar in the author's colour, a sentence, and "Author · Mon D,
  HH:MM". A version with no author reads "Unknown". The chosen row is `rgba(255,255,255,.85)`
  and eases over 0.35s. The list asks for the newest 50 versions.
- **The panel is portalled to `document.body`.** The nav's `backdrop-filter` makes the nav the
  containing block for fixed descendants, so a panel inside it would sit in the 68px bar, and
  its blur would sample the nav instead of the page. The React tree is unchanged, so state and
  props still flow from `HistoryButton`; open, Escape and outside-click stay there. Because the
  portal leaves the shell, `--nav-bottom` no longer cascades to it, so the button reads it
  from the shell and sets it on the panel as an inline custom property.
- **Focus.** On open, focus moves to the panel heading (`tabIndex -1`, no ring for the
  mouse). Without that, a keyboard user would have to Tab through the rest of the page to
  reach a panel that sits last in the DOM. The first Tab lands on Close, then the slider,
  then the rows. Escape and Close return focus to the History button. Rows are
  `aria-pressed` buttons.
- **Descriptions are derived by diffing two states** (`version-description.ts`). An update
  is opaque Yjs bytes, so a row's sentence is made by building the state before and after
  and comparing. A single recognisable change gets a sentence ("Added 'New card'", "Renamed
  the list 'New column' to 'Backlog'", "Moved 'New card' to Doing", "Deleted the list 'X' and
  its 2 cards", "Added 33 characters", "Removed 3 characters"). On a board anything else gets
  a count ("2 changes"); in a document, a text change that involves structure or formatting
  says "Edited the text", and a count appears only when a state is missing or fails to load.
  A wrong sentence about someone's document is worse than a vague one, so the count is the
  floor, not a bug. The first version is "Created the board" or "Created the document", and
  only when the list reaches the document's first version.
- **The ratio, measured** with two browsers (Owner and Eddie) taking turns. Board, 16 scripted
  changes: 17 update rows grouped into 15 versions, 13 sentences and 2 counts (13:2, 87%).
  Both counts were versions where the same author had made two changes in a row; every
  version holding one change got a sentence. Document, 12 scripted turns: 10 versions, 10
  sentences and 0 counts, but only 4 are specific (Created, Added 33 characters, Removed 3
  characters, Added 2 characters); the other 6 say "Edited the text". With two people typing
  together: 49 sentences and 1 count in 50 rows, all small additions of one to three
  characters. In the board and document runs, all 25 rows named the right author, in the
  order the database recorded them. Cards cannot be renamed in the UI yet, so every card is 'New card' and every list starts as 'New column'; the sentences
  are true but do not tell cards apart.
- **What the list fetches.** The version list is one request: 2,519 bytes for 15 versions,
  1,690 for 10, 8,364 for 50. No state is fetched for a row until it is on screen: an
  `IntersectionObserver` with an 80px margin asks for the row's sentence, and the selected row
  is always described. A sentence needs the row's own state and its older neighbour's, so a
  panel showing N rows fetches about N+1 states. Measured on open: 13 states and 10,804 bytes
  for a 15-version board in an 800px panel (222 to 1,455 bytes each, all issued in 81 ms); 10
  states and 14,346 bytes for the 10-version document; 13 states and 6,838 bytes on a 50-row
  list, so not one per version. Scrolling the 15-row board to its end brought it to 15 states
  and 11,102 bytes. Background state requests run two at a time (the chosen version's
  fetch jumps the queue and is not capped), cached for the session by (document,
  version) with 64 kept, and a failure falls back to the count. A state is the whole
  document, so its size follows the document, and the server cost of each follows its
  history (see Known limitations).
- **The slider** (`HistoryPanel.tsx`) is a native `<input type="range">`, kept for the
  keyboard, screen readers and touch, restyled with the accent colour. It has one stop per
  listed version plus a last stop, Now, which is the live document and has no row (the live
  document can hold edits newer than the newest version). The thumb and the highlighted row
  move at once; the choice is made only when it settles: 200 ms after the last input, on
  window `pointerup` or `pointercancel`, or on window blur. A row click cancels a pending
  choice and closing the panel discards it. A scrub therefore makes one preview, not one
  per stop; see Known limitations for what the highlight still fetches. `aria-valuetext`
  reads "Sep 30, 16:40, by Grace" or "Now". Checked on both documents: one ArrowLeft at a time,
  every stop's row, pill and previewed content matched its version.
- **The version preview** (`VersionPreview.tsx`, `version-selection.ts`). Choosing a version
  builds a throwaway `Y.Doc` from its bytes, with no provider, socket or persistence, and
  renders it read-only: `Board` with `readOnly` and `provider={null}`, or `DocumentEditor` with
  its `content` and `toolbar={false}` props. There is no separate read-only editor. The title
  is a plain heading. The live view is unmounted while a preview shows, so the two never
  exist together, and **the live document is never written to**. Checked: while previewing, a
  peer added a card, the preview did not change, the Owner's update rows stayed at 10 (the
  total rose by the peer's one), and Back to now showed the board with the peer's card; typing
  into a document preview changed nothing and the peer's copy was untouched. If a preview
  fails to load or is too large (413), the live view stays up with a notice, and there is no
  pill. The selection is a small module store keyed by document id; the panel writes it and
  the page reads it. A repeat pick of the same row means "retry". The region is labelled
  "Earlier version of this board/document", with a status line naming the version.
- **The fade is one-sided.** The incoming view fades in over 0.4s (the preview, and the live
  view when it returns); the outgoing one just goes. A true cross-fade needs both mounted at
  once, and the preview exists so that they never are: with both in the page there would be a
  moment when the live, writable view and a preview sat together. It is off under reduced
  motion.
- **The pill** (`VersionBar.tsx`, `version-bar.module.css`) is rendered by `DocumentClient`,
  not `AppShell`, because Restore needs the live `Y.Doc`. Dark glass, fixed, centred, `z-index`
  26, "Author · time", **Restore** (white) and **Back to now**. It is shown only while a
  preview is actually on screen. **Restore is absent, not disabled, for viewers, and absent
  until the document has synced with the server at least once**: before that the local doc
  is empty, and a diff-based restore would write the whole old content as new inserts for
  the server's copy to land on top of, duplicating it. A later disconnect is fine. The
  connection-states plan has not run, so the pill stacks with no connection band.
- **Restore goes out through the normal socket** (`restore-version.ts`, `restoreEditor`,
  `restoreBoard`) and is attributed to whoever restored: the newest row after a restore was the
  Owner's. A viewer's frames are refused by the sync server's role check. Focus returns to the
  live editor, or the heading on a board. The toast is "Restored version from Mon D, HH:MM",
  and adds " · merged with changes made since" when anyone else is present (connected and
  at least one peer, `hasOthersHere`).

**What a restore does to other people's edits, as measured**

A restore is a diff from the restorer's current copy to the old state. It is not a merge of
the old version with what has happened since. Everything that had already reached the
restorer after that version is undone, along with the restorer's own later edits. Only edits
still in flight when the restore lands survive. Observed:

- Board, peer idle: Eddie had added a card after the chosen version and the Owner already had
  it. After Restore both boards were exactly the chosen version, and Eddie's card was gone.
  The toast still said "merged with changes made since".
- Document, peer typing a 70-character run at 60 ms a key: the 13 characters already sent
  when Restore landed were removed with everything else after the version, and the other 57
  survived, appended after the restored text. Both browsers ended identical.

So the toast is true that the result is not a clean revert, but "merged" suggests the other
person's work was kept, and most of it was not. Whether the wording overclaims is an open
question for the owner (Decision 2 of the design record); the copy was not changed.

**Deviations from §13 and §5.6, and why**

| Where | Design says | Built | Why |
|---|---|---|---|
| Panel `top` (§13) | `84px` | `calc(var(--nav-bottom, 68px) + 16px)`: 84px, and 68px once the nav condenses | `--nav-bottom` is 68px, or 52px condensed. The shell's bar shrinks on scroll; a fixed 84px would leave a 32px gap under it. `top` transitions over 0.4s with the nav, and a panel opened while condensed lands at 68 without starting from 84. |
| Entrance (§13) | `g-side .6s` | None runs | The animation name is localised in the module and has no keyframes (Known limitations). Not worked around, since the fix is app-wide. `g-side` stays defined in `globals.css` and the panel is its only user, so it is still effectively unused. |
| Pill offset (§5.6) | 10px below the nav | `--nav-bottom + 8px` | Read from the same variable, so it follows a condensing nav, but it has no transition of its own (the panel does). |
| Pill home (§5.6) | in the under-nav pill family | `DocumentClient` | Needs the live doc for Restore. |
| Fade (§13) | .4s fade | one-sided | See above. |
| Slider (§13) | range input, "Earliest … Now" | native range with n+1 stops, committing on settle | Keyboard first; one preview per scrub. |
| Restore copy (§13) | "Restored version from {date}" | plus " · merged with changes made since" when others are present | Decision 2: the UI must not imply an exact revert. |

**Not done**

- The open panel's list does not refetch after a restore, so the restore's own new version
  appears only on reopening (the sync server writes updates on a 500 ms timer).
- No connection band, offline pill or status popover (connection-states plan).

### Deferred, each needing its own plan

- **Status popover, offline and syncing pills.** The status pill itself is built (see
  above). The **popover** is still deferred: its version sequence, queued-edit count
  and latency ping are not exposed by the sync server. The offline and syncing pills
  can reuse the toast primitive.
- **The palette's "Go offline" and "Reconnect" items.** Deliberately left out, not
  forgotten. They need the Yjs provider, which lives in `DocumentClient` and is not
  reachable from the nav: the store publishes status and peers, not the provider.
  They belong to a plan that exposes provider controls, likely with the popover.
- **Card detail sheet.** Blocked on `description` and an activity log on the
  card's `Y.Map`; neither exists in the CRDT shape today, and adding them is a
  schema change this work barred. Two things were left ready or left out on
  purpose: `.cardSelected` exists in `board.module.css` but is unused, waiting for
  this sheet to give a card a selected state; and the "has notes" card meta was
  deliberately not added, because there is no `description` field to drive it.

### Known limitations

- **Phone layout is still broken at 375px.** The 760px dropdown (below) fixed the
  tab strip and the workspace name, and at 760px the nav no longer overflows. At
  375px it still overflows by 28px: the account avatar's right edge is at about
  402.8px, off screen, so the account menu, and therefore sign-out, is unreachable on
  a phone, and the dropdown trigger is squeezed to 26px. Measured, not looked at in a
  browser. The owner has decided to ship desktop-first. Candidate fixes: shed the
  search field and the status pill below about 500px, or let the nav scroll
  horizontally.
- **The "updated" line on document tiles shows time only, with no author.** The
  prototype's mock reads "Grace · 2 min ago". The schema is no longer the blocker:
  `DocumentUpdate.userId` exists and the sync server fills it. What is missing is the
  tile's last-activity query returning the newest update's author, and the tile showing
  it. Documents whose newest update predates the migration will have no author to show.
- **Last-activity query efficiency is planner-dependent.** It is a lateral join.
  Its normal plan is one index seek per document (EXPLAIN: Index Scan Backward on
  `DocumentUpdate_documentId_id_idx` inside the Limit, 0.040 ms). On heavily
  skewed data Postgres may instead pick a backward primary-key scan with a filter,
  measured at 11.9 ms per loop. Postgres has no query hints, so this cannot be
  forced. Durable fixes are a `(documentId, id DESC)` index or a denormalised
  `updatedAt` column on `Document`; both need schema changes this plan barred.
- **`@supports not (backdrop-filter)` fallbacks compile but have never been
  exercised** in a browser lacking backdrop-filter support.
- **Workspace-layout data is not re-fetched on a soft navigation.** What the
  workspace layout owns (the role-derived controls such as the "View only" chip and
  Share permissions, the member list, and the tab list) is fetched when the layout
  renders. Moving between pages in the same workspace does not fetch it again; it
  updates on `router.refresh()` (which the local create, share and sign-out flows
  call) or a full load. A role change or a document created by someone else shows
  only then. UI only: APIs and pages enforce the real role.
- **The tab dropdown blurs the nav, not the page.** It is a descendant of the nav, whose
  `backdrop-filter` makes it a backdrop root, so its own `backdrop-filter` samples the
  nav rather than the page behind it. It reads as more opaque glass (`--glass-menu`
  .88). It is the same issue the toolbar's stylesheet documents. The History panel used
  to be in this state and no longer is: it is portalled to `<body>`.
- **Renames reach other people on their next data load, not live.** A new document or
  board title is saved to Postgres and the person renaming sees it at once, but others
  see it only after a navigation that refetches, `router.refresh()` or a reload (Decision
  5). Moving titles into the CRDT would make them live; that is a separate change.
- **Version content bytes stay cached after logout (Low).** The version route sends
  `Cache-Control: private, max-age=31536000, immutable`, so on a shared browser profile
  a previously fetched version can be read again after the first user signs out.
- **Fetching a version gets slower as a document's history grows.** It replays every
  update row up to that version. Starting from a snapshot would fix it, but needs exact
  snapshots and a way to tell them from the legacy ones. The panel multiplies this: each
  row's sentence needs two of these replays (its own state and its neighbour's).
- **Scrubbing the slider over rows that have no sentence yet fetches a state for each
  row it passes.** The preview itself is chosen once, when the thumb settles, but a row
  that is highlighted is also described, and describing needs its state. Measured on a
  50-row list with 13 rows already described: 25 fast ArrowLeft presses (247 ms) made 13
  state requests, about 5.3 KB, all within 90 ms of the last press and none from the
  settle. They go two at a time and are cached, so a second pass costs nothing. Fix, if
  it matters: describe a row only once the thumb has rested on it.
- **Two people typing together make a very noisy list.** Any change of author starts a
  new version, so the grouping that works for one writer does not for two. Measured:
  two browsers typing 40 characters each for 4.2 s wrote 80 update rows that became 66
  versions, each a small addition (inferred from one update per keystroke; the panel
  text for that run was not read); ten rounds of taking turns (20 turns, 60 rows)
  made 19. The panel lists the newest 50, so after a minute of co-editing it shows only
  the last couple of minutes of work, and the oldest listed row reads "1 change" because
  nothing is known to precede it. The 5-minute window and the alternation rule are the
  backend's, not the panel's. Left for the owner to decide (coalescing across authors
  would give up per-author attribution).
- **The CSS-module entrance animations do not run, here or elsewhere.** A name in an
  `animation:` declaration inside a CSS module is localised to a hashed name that has no
  keyframes, so `g-side` on the History panel, and every other `g-*` used from a module
  (nav, toolbar, sheets, palette, board, user menu), does nothing. Measured on the open
  panel: `getAnimations()` returns none and the computed name is
  `history-panel_g-side__5r4_Z`. The panel therefore appears at once. The panel's `top`
  transition does run, and the preview's fade and the pill's rise define their own
  keyframes in their own modules, which are hashed with them and do run. This predates
  the plan; the fix is app-wide and is its own task.
- **The account button's initial has low contrast for some colours.** It is your colour
  on white, about 2.1 to 2.8:1 for amber, teal and sky, the same ratios the old filled
  avatar had. Not fixed.

### Deliberate deviation from the design

The nav's workspace name is capped at `max-width: 240px` with an ellipsis and a
`title` attribute. The design caps nothing, but without the cap a 120-character
workspace name forces the whole document to scroll horizontally.
