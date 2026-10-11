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
