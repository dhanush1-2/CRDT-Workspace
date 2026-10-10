# Gallery redesign

Approved by Dhanush on 2026-10-10, in chat. This replaces the Glass look with a flat
editorial one. **Every feature, the layout, the nav structure and the motion stay as they are
now.** Only the material, colour and type change, plus the nav and toolbar details listed
below.

## Reference

`docs/design/Workspace F - Gallery.dc.html`. Open it in a browser with `support.js` beside it.
- The file is final, and its accent defaults to violet.
- Its settings panel has options (canvas, splashColor, toolbarPlacement "floating"). Build only
  the defaults and ignore the others.
- Where this document and the file disagree, this document wins. Record each such case in
  the new handoff (see Records).

## Scope and order

All screens, built in this order:
1. nav
2. board
3. document and its toolbar
4. workspace overview
5. dashboard (Workspaces)
6. sign-in; also the invite and privacy pages, which share its card
7. the Share sheet, the ⌘K palette and the History panel

Everything goes on one branch (`gallery-redesign`), with one plan, and is merged once all of
it is done. The "material and motion fidelity" plan
(`docs/superpowers/plans/2026-10-05-material-and-motion-fidelity.md` or its current name) is
set aside: do not execute it. Keep any existing motion except the hover lifts.

Not in scope:
- dark mode;
- phone-first layout (desktop first; existing responsive rules keep working);
- the reference's alternative settings, including the floating toolbar placement.

## Nav bar

The bar stays centred and sized to its contents, with a smooth width change. Dhanush chose
this over a fixed-size bar on 2026-10-10.

**Width.** Animate it with a JS tween.
- Keep the last width in a module-level variable, outside the component.
- When the nav mounts or its contents change:
  1. set the new bar to the old width;
  2. force a layout;
  3. animate to the new width over 0.55s with `cubic-bezier(.32,.72,0,1)`.
- Clear the inline width on `transitionend`.
- Skip the animation when reduced motion is set.

**Height and gap.**
- Height is 56px. It shrinks to 46px after 24px of scroll.
- The top gap shrinks from 12px to 6px at the same moment.
- These replace the current 68 → 52.

**Tabs.**
- Tabs scroll inside the bar when there are many: `max-width:100%` on the nav, and
  `flex:0 1 auto; min-width:120px` on the strip.
- Show a right-edge fade when more tabs are off to the right.

**Active tab.**
- There is no pill. A 2px violet underline sits at the bottom of the tab strip.
- It slides between tabs using `transform: translateX()` and `width`, over 0.55s with the same
  easing.
- Its last position is kept in a module-level variable, so it slides across page changes too.
- The active tab's text is violet, weight 600. Inactive tabs are `#5f625d`, weight 500.

**Bar.**
- Solid white `#ffffff`.
- Border `1px solid rgba(40,40,60,.1)`.
- 2px corners.
- No blur, no shadow.

## Material

**Blur.** None anywhere. Remove every `backdrop-filter`.

**Surfaces.**
- Anything that was 60% or more opaque white becomes solid `#ffffff`.
- More see-through surfaces, such as board columns, become `#fbfbf9`.
- Dark pills and toasts become solid `#161616`.

**Borders.**
- `1px solid #e4e4e0` hairlines replace all white glass borders.
- Fields keep `rgba(40,40,60,.12)`.

**Shadows.**
- None, except floating menus, sheets and the palette, which get
  `0 24px 48px -28px rgba(0,0,0,.25)`.
- Focus and selection rings (`0 0 0 Npx`) stay.
- Board cards use `0 0 0 1px #e4e4e0`.

**Corners.** 2px on everything. Avatars, status dots and the logo stay round.

**Hover.**
- Tiles and cards do not lift; their border turns `#1c1d1b` instead.
- Buttons keep the press effect, `scale(.92–.97)`.

## Colour

**Accent** is violet, with these tokens:

```css
--accent: oklch(0.5 0.17 290);        /* buttons, logo, focus, underline */
--accent-hover: oklch(0.45 0.17 290);
--accent-text: oklch(0.44 0.17 290);  /* links, active tab */
--accent-tint: oklch(0.95 0.027 290); /* Board/Page labels */
--accent-ring: oklch(0.5 0.17 290 / .12);
```

The hex fallback is `#6d3fd6`. There is no red anywhere in the UI. The one exception is the
error and delete text, which stays `#c4372b` and is used only for errors and the delete
action.

The favicon (`apps/web/src/app/icon.svg`) and the logo's fill follow the new accent; the
glyph is unchanged.

**Text.**

| Role | Value |
|---|---|
| Main | `#1c1d1b` |
| Body | `#3d403b` |
| Secondary | `#5f625d` |
| Faint | `#6c6f6a` (passes AA) |

**Status.**

| State | Colour |
|---|---|
| Connected | green `oklch(0.62 0.13 150)` |
| Offline | amber `oklch(0.72 0.15 65)` |
| Syncing | accent violet, pulsing |

**Toast dot.** Accent lightness + 0.14 at the accent's chroma and hue, about
`oklch(0.64 0.17 290)`.

**Text selection.** `oklch(0.9 0.027 290 / .6)`.

## Painted background and splatter

**Canvas.** The base is `#f6f6f4`.

**Blobs.** Almost colourless, with the same sizes and drift as before:
- `oklch(0.93 0.004 90)`
- `oklch(0.94 0.004 250)`
- `oklch(0.92 0.003 60)`
- `oklch(0.95 0.003 200)`
- `oklch(0.93 0.004 120)`

**Weave texture.** Unchanged.

**Splatter.**
- Palette:
  - violet `#6d3fd6`, listed three times so it is picked most often;
  - `#1c1c1c`;
  - `#454545`;
  - `#9a9a9a`;
  - ochre `#e9a21f`.

  There is no red. This settles the earlier open question about whether violet is duplicated.
- Layer opacity is 0.38.
- Sizing keeps the agreed numbers:

  | Parameter | Value |
  |---|---|
  | `BASE_CORE_RADIUS` | 11 |
  | scale | `range(0.6, 1.2)` |
  | ray width | `scale * range(1.5, 4)` |
  | tip blob | `scale * range(1, 2.5)` |
  | ray length | `coreR * range(1.5, 5)` |
  | droplets | spread ×4, and smaller |
  | `splatCount` | 10 + 8·√ |

  Verify these against the current code and the reference. If they disagree, record which
  one was used.
- No splatter in the top 90px, behind the nav.

## Type

**Font.** Schibsted Grotesk 400/500/600/700 from Google Fonts. Use it throughout, replacing
the system font. Load it through Next's font mechanism (read the Next docs in
`apps/web/node_modules/next/dist/docs/`) so there is no layout shift.

**Page titles** (Workspaces, the workspace name): 52px, weight 600, letter-spacing −0.04em,
line-height 1.02.

**Section headings** (Documents, People):
- 12px, weight 600, uppercase, letter-spacing 0.1em;
- a full-width `1px solid #1c1d1b` line above, with 10px top padding.

**Document headings and body.**

| Element | Size and style |
|---|---|
| H1 | 32px, weight 600, letter-spacing −0.025em |
| H2 | 21px, weight 600 |
| Body | 17px, line-height 1.65 |

**Everything else** keeps its current size:

| Element | Size |
|---|---|
| Base | 15px |
| Tile titles | 18px, weight 600 |
| Small text | 13–14px |

## Document toolbar

- **Placement.** By default, the bar sits inside the page sheet, sticky at `top:80px`, inset
  10px. It is solid white with a hairline border.
- **Tabs.** Home, Insert and View. The active tab is a white chip in the accent colour.
- **Alignment.** The alignment controls are grouped into one dropdown.
- **When stuck.** It gets the floating shadow.
- **Floating placement.** A wider bar above the sheet. It stays in the design as an
  alternative, but is not built.

## What must not change

- Every feature and every `data-testid`.
- Keyboard and screen-reader behaviour, and the existing ARIA.
- Routes and APIs.
- Reduced-motion handling: every new transition and animation sits inside
  `prefers-reduced-motion: no-preference`.

Existing tests that assert old visual values, for example blur, the 68/52 heights, the pill
indicator, glass colours, hover lifts or the system font, are updated to the new values. They
are not deleted. A test may only change because the spec changed it, and the plan must say
which tests change and why.

## Known app-wide bug to fix along the way

CSS-module `animation: g-*` names are localised to hashed names that have no keyframes, so
every module entrance animation is dead. The redesign touches all these modules, so the plan
must fix this: either make the keyframes reachable from modules or define them per module.
Do not ship new dead animations.

## Records

- Write a new `docs/design/gallery-handoff.md`. It is the binding visual spec from now on.
  It covers each screen, every value above, and each deviation from the reference file with
  its reason.
- `glass-handoff.md` is kept as history. Add a pointer at its top saying Gallery supersedes it.

## Deployment

The redesign is frontend only, with no schema change, so no migration is needed. Merge and
push only after the full gate passes and Dhanush has seen it.
