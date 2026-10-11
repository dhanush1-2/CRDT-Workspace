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
