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
| T1.4 | Test premise: character height in the peer-caret zoom test (`e2e/editor-toolbar.spec.ts`) | A character box about 21px tall at 100% (system font, 18px) | `GLYPH_HEIGHT = 22`, band unchanged (+-1.5) | Schibsted Grotesk's box is taller (measures 15, 23 and 33 at 70, 100 and 150%). The font moved the premise, not the behaviour. Task 6 changes the body to 17px and must recheck it. |
| T2.1 | Splatter palette | Reference "gallery": eight entries, `#1c1c1c` twice, reds mapped to violet | `#6d3fd6` ×3, `#1c1c1c`, `#454545`, `#9a9a9a`, `#e9a21f` | The spec's list (decision 6). |
| T2.2 | Splatter geometry | Reference: its own generator (sizes 14–40px) | `lib/splatter/geometry.ts` unchanged: core 11px, rays `scale × range(1.5, 4)` wide and `coreR × range(1.5, 5)` long, tip `scale × range(1, 2.5)`, droplets out to ×4 and shrinking, `10 + 8·√(W·H)/1100` splats | The spec keeps the agreed numbers (decision 7). |
| T2.3 | Splat scale | Spec table `range(0.6, 1.2)` | `range(0.7, 1.4)`, as shipped | Dhanush's 2026-10-03 decision; the spec asks for the choice to be recorded (decision 11, question 2). |
| T2.4 | Offline status dot | Code before: `--danger` (red) | `--warn` (amber) | The spec's status table (decision 14). |
| T2.5 | Sign out | Reference `#c4372b` | `--text` | Red is for errors and delete only (decision 8, question 5). |
| T2.6 | Error box, invalid field, column delete confirm | Code before: red tint and border; red field border; red fill | White box with a hairline; `--rule` field edge; `--danger` text on grey | Only error and delete *text* is red (decision 20). |
| T2.7 | Red that stays | — | Editor "Red" text colour and the "None" highlight swatch's stroke | Content colours, not chrome (decision 16). Named in `test/no-red.test.ts`. |
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
| T11.1 | Toast | Reference: floating shadow | No shadow; padding kept at 10px 18px | The spec's shadow list excludes toasts (decision 4); sizes are not in scope. |
| T11.2 | Sheet veil | Code before `rgba(30,40,35,.16)` with `blur(8px)` | The same colour, no blur | No blur anywhere. |
| T11.3 | Palette entrance | Reference `g-pop .5s` | `g-sheet` over `--dur-slow`, as before | Existing motion is kept. |
