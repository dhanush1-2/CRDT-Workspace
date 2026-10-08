# Document Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three gaps the document toolbar shipped with: font family and size controls, a way to follow a link without a mouse modifier (keyboard and touch), and zoom that is verified outside Chromium.

**Architecture:** Font family and size become two attributes on the existing `textStyle` mark, added by one project-owned extension whose `parseHTML` accepts only the curated values in `editor-type.ts`, so a paste can never write arbitrary type into a shared document. Two field-style menus join the Home row after Style. Links get Alt+Enter and a small bubble that appears under a link while the caret is in it. Zoom stops writing a `zoom` style at 100%, gains a cross-engine Playwright spec, and, only if that spec fails on an engine, falls back to a CSS transform there.

**Tech Stack:** Next.js 16.3.5 (forced `--webpack`), React 19.3, Tiptap 3.31.3 (`@tiptap/core`, `@tiptap/extension-text-style`), `@tiptap/y-tiptap` 3.0.9, prosemirror-view 1.42.4, Vitest 5 (node environment, no DOM), Playwright 1.63.

**Spec:** `docs/design/glass-handoff.md` §12 (toolbar), its **Precedence** section and the build record's deviation table (`### Document formatting toolbar`). This plan's **Decisions** section records the owner's 2026-10-07 request, which postdates §12 and, per Precedence, wins over it.

## Decisions (binding)

1. **Font controls are built, and curated.** The owner asked on 2026-10-07 for font family and font size controls; earlier answers chose "a curated list and scale". Families: System, Serif, Mono. Sizes: 14, 16, 18, 21, 26, 32 (px). No free-text field. This supersedes §12.2's Home table, which has no font controls; record it under Precedence.
2. **The document stores ids, not CSS.** `fontFamily` holds `'serif' | 'mono'`, `fontSize` holds a number from the scale. System and 18 are stored as *no attribute*, so plain text carries nothing, exactly as unaligned text carries no `textAlign`.
3. **Paste accepts only curated values.** A pasted span's family or size is kept only when it maps exactly to a curated entry (our own copy-paste between documents round-trips through `data-font-family` / `data-font-size`). Anything else, such as `Arial` or `11pt`, is dropped. The existing paste test (`editor-toolbar.spec.ts`, "pasting text styled with a font family and size writes neither…") must keep passing unchanged.
4. **Following a link:** Alt+Enter with the caret in a link opens it (Google Docs' binding). While an editor's caret sits in a link, a bubble under the link shows its address and an **Open** button, which is how touch and mouse users without a modifier follow it. Cmd/Ctrl-click stays. Viewers are unchanged: their anchors are followed by the browser.
5. **Only http(s) and mailto links are opened by our code.** All three paths (Cmd/Ctrl-click, Alt+Enter, Open) go through one `openHref`, which refuses anything else.
6. **Zoom:** at 100% no `zoom` style is written, so the default path is plain layout in every browser. Other zoom levels are verified in WebKit and Firefox by a dedicated spec. If an engine fails, that engine gets the Task 6 fallback; Chromium keeps CSS `zoom`.

## Global Constraints

- Never run `fly`, `render`, `neonctl` or any cloud CLI. Never modify `.env`, `docker-compose.yml` or `docker-compose.override.yml`.
- Postgres on 5433 is shared across checkouts: never start, stop or restart it. If Docker is down, stop and report BLOCKED.
- Never use bare `git stash` / `git stash pop` (the stash stack is shared).
- `textStyle`'s attributes after this plan are exactly `color`, `fontFamily`, `fontSize`. Nothing else may be registered on it.
- Do not register Tiptap's own `FontFamily` or `FontSize` extensions. Their `parseHTML` accepts any value.
- No new nodes or marks. Every task adds attributes or behaviour only (a new node is a one-way door for documents a stale tab opens; see `crdt-ops-constraints`).
- Toolbar controls use `aria-disabled`, never `disabled`. A button inside a menu or popover passes `roving={false}`. Test ids are namespaced `tb-*` inside the toolbar; the bubble's are `link-bubble*`.
- Relative imports inside `apps/web/src/lib/` carry `.js`; component imports through `./` do not; tests import `../src/components/<file>.js`.
- Every new test is proven to discriminate: break the property, watch it fail, restore, watch it pass. Report both runs. **Commit before mutating** (`git checkout --` does nothing on an untracked file).
- Gate before every commit: `pnpm typecheck`, `pnpm test`, and the Playwright specs the task touches. Full gate at the end: `pnpm --filter @crdt/web build` and the whole Playwright suite.
- Task 5 installs Playwright's WebKit and Firefox builds (a download of a few hundred MB from Playwright's CDN). The controller asks the owner before that step runs.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/components/editor-type.ts` | **Modify.** The curated families and sizes, and the pure functions that map CSS to them and step sizes. No longer parked. |
| `apps/web/src/components/curated-type.ts` | **Create.** The Tiptap extension: `fontFamily` / `fontSize` on `textStyle`, curated parse, commands, size shortcuts. |
| `apps/web/src/components/editor-schema.ts` | **Modify.** Registers `CuratedType`; comment updated. |
| `apps/web/src/components/TypeMenus.tsx` | **Create.** The Font and Size menus. |
| `apps/web/src/components/HomeTools.tsx` | **Modify.** Reads the type at the selection; renders the menus after Style. |
| `apps/web/src/components/EditorMenu.tsx`, `ToolButton.tsx` | **Modify.** Two menu names; two narrower field widths. |
| `apps/web/src/components/editor-toolbar.module.css` | **Modify.** Field widths, the bubble. |
| `apps/web/src/components/link-open.ts` | **Modify.** `isOpenableHref`, `openHref`, `linkHrefAt`, Alt+Enter. |
| `apps/web/src/components/LinkBubble.tsx` | **Create.** The bubble. |
| `apps/web/src/components/DocumentEditor.tsx` | **Modify.** Renders the bubble; no zoom style at 100%; Task 6 fallback if needed. |
| `apps/web/src/components/editor-zoom.ts` | **Create in Task 6 only.** Engine detection and the fallback's style. |
| `apps/web/src/app/documents/[id]/document.module.css` | **Modify.** `position: relative` on the sheet (the bubble's containing block). |
| `apps/web/playwright.config.ts` | **Modify.** WebKit and Firefox projects that run only `editor-zoom.spec.ts`. |
| `apps/web/e2e/editor-type.spec.ts`, `link-follow.spec.ts`, `editor-zoom.spec.ts` | **Create.** New e2e specs, kept out of the 2,500-line toolbar spec. |
| `apps/web/test/editor-type.test.ts`, `curated-type.test.ts`, `link-open.test.ts`, `editor-schema.test.ts` | Unit tests. |
| `docs/design/glass-handoff.md` | **Modify.** Precedence entry, deviation rows. |

---

### Task 1: Curated type in the schema

**Files:**
- Modify: `apps/web/src/components/editor-type.ts`
- Create: `apps/web/src/components/curated-type.ts`
- Modify: `apps/web/src/components/editor-schema.ts:35-47`
- Modify: `apps/web/test/editor-type.test.ts`, `apps/web/test/editor-schema.test.ts:38-47`
- Create: `apps/web/test/curated-type.test.ts`

**Interfaces:**
- Produces: `FONT_FAMILIES`, `FontFamilyId`, `FONT_SIZES`, `FontSize`, `DEFAULT_FONT_SIZE`, `familyFromCss(raw: string | null | undefined): 'serif' | 'mono' | null`, `sizeFromCss(raw): FontSize | null`, `stepFontSize(current: number, direction: 1 | -1): FontSize`, `familyCss(id: FontFamilyId): string | null` (all in `editor-type.ts`); `CuratedType` extension with commands `setTypeFamily(id: FontFamilyId)` and `setTypeSize(size: FontSize)` (in `curated-type.ts`).

- [ ] **Step 1: Rewrite `editor-type.ts`**

```ts
/**
 * The only font families and sizes a document may use (owner decision, 2026-10-07; see
 * the handoff's Precedence section).
 *
 * Curated on purpose. The design specifies the document's type, and an open list lets a
 * document stop looking like this product. The document stores the id, never the CSS,
 * so a family's stack can change here without rewriting a single document, and a paste
 * can only ever produce a value from this list (curated-type.ts).
 *
 * System is the design's own `var(--font)` and is stored as no attribute at all, like
 * the default size. Plain text carries nothing.
 */
export const FONT_FAMILIES = [
  { id: 'system', label: 'System', css: null },
  { id: 'serif', label: 'Serif', css: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' },
  { id: 'mono', label: 'Mono', css: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
] as const

export type FontFamilyId = (typeof FONT_FAMILIES)[number]['id']

/** The design's own type steps, in px. No free-text field: a 7px paragraph is not a feature. */
export const FONT_SIZES = [14, 16, 18, 21, 26, 32] as const
export type FontSize = (typeof FONT_SIZES)[number]

/** The document body's size (handoff Precedence: 18px, not §12.7's 17). Stored as no attribute. */
export const DEFAULT_FONT_SIZE: FontSize = 18

/** The CSS a stored family id renders as. System renders nothing: the editor's own font applies. */
export function familyCss(id: FontFamilyId): string | null {
  return FONT_FAMILIES.find((family) => family.id === id)?.css ?? null
}

/** Quotes and spacing differ between what we write and what a browser hands back. */
const normalise = (css: string) => css.replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim().toLowerCase()

/**
 * The curated family a CSS font-family value names, or null. Exact matches only, after
 * normalising quotes and spaces: "Arial" is null, and so is a stack that merely starts
 * with Georgia. System is never returned, because System is the absence of a family.
 */
export function familyFromCss(raw: string | null | undefined): 'serif' | 'mono' | null {
  if (!raw) return null
  const wanted = normalise(raw)
  for (const family of FONT_FAMILIES) {
    if (family.css !== null && normalise(family.css) === wanted) return family.id as 'serif' | 'mono'
  }
  return null
}

/**
 * The curated size a CSS font-size value names, or null. Only whole px values on the
 * scale: "11pt", "1.2em" and "17px" are null. The default size is null too, since it is
 * stored as no attribute.
 */
export function sizeFromCss(raw: string | null | undefined): FontSize | null {
  const match = raw?.trim().match(/^(\d+)px$/i)
  if (!match) return null
  const size = Number(match[1])
  if (size === DEFAULT_FONT_SIZE) return null
  return (FONT_SIZES as readonly number[]).includes(size) ? (size as FontSize) : null
}

/**
 * One step along the scale, held at the ends. A size that is not on the scale moves to
 * the nearest step in that direction.
 */
export function stepFontSize(current: number, direction: 1 | -1): FontSize {
  if (direction === 1) return FONT_SIZES.find((size) => size > current) ?? FONT_SIZES[FONT_SIZES.length - 1]!
  return [...FONT_SIZES].reverse().find((size) => size < current) ?? FONT_SIZES[0]
}
```

- [ ] **Step 2: Replace `apps/web/test/editor-type.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FONT_SIZE,
  FONT_FAMILIES,
  FONT_SIZES,
  familyCss,
  familyFromCss,
  sizeFromCss,
  stepFontSize,
} from '../src/components/editor-type.js'

describe('the curated type scale', () => {
  it('offers three families, System first and stored as nothing', () => {
    expect(FONT_FAMILIES.map((f) => f.id)).toEqual(['system', 'serif', 'mono'])
    expect(familyCss('system')).toBeNull()
    expect(familyCss('serif')).toContain('Georgia')
  })

  it("offers the design's own size steps, with the body size among them", () => {
    expect([...FONT_SIZES]).toEqual([14, 16, 18, 21, 26, 32])
    expect(DEFAULT_FONT_SIZE).toBe(18)
  })

  it('maps only an exact curated stack to a family, whatever its quoting', () => {
    expect(familyFromCss(familyCss('serif'))).toBe('serif')
    // How a browser hands the stack back: quotes changed, spaces after commas.
    expect(familyFromCss("ui-serif, Georgia, Cambria, 'Times New Roman', serif")).toBe('serif')
    expect(familyFromCss(familyCss('mono'))).toBe('mono')
    expect(familyFromCss('Arial')).toBeNull()
    expect(familyFromCss('Georgia, serif')).toBeNull()
    expect(familyFromCss('')).toBeNull()
    expect(familyFromCss(null)).toBeNull()
  })

  it('maps only whole px sizes on the scale, and not the default', () => {
    expect(sizeFromCss('21px')).toBe(21)
    expect(sizeFromCss(' 32PX ')).toBe(32)
    expect(sizeFromCss('18px')).toBeNull()
    expect(sizeFromCss('17px')).toBeNull()
    expect(sizeFromCss('11pt')).toBeNull()
    expect(sizeFromCss('1.2em')).toBeNull()
    expect(sizeFromCss(undefined)).toBeNull()
  })

  it('steps along the scale and holds at the ends', () => {
    expect(stepFontSize(18, 1)).toBe(21)
    expect(stepFontSize(18, -1)).toBe(16)
    expect(stepFontSize(32, 1)).toBe(32)
    expect(stepFontSize(14, -1)).toBe(14)
    // Off the scale: to the nearest step in that direction.
    expect(stepFontSize(17, 1)).toBe(18)
    expect(stepFontSize(17, -1)).toBe(16)
  })
})
```

- [ ] **Step 3: Run it, expect PASS** (Step 1 already has the code; this is a pure module).

Run: `pnpm --filter @crdt/web exec vitest run test/editor-type.test.ts`
Then prove discrimination: change `normalise` to drop the quote-stripping, watch the quoting test fail, restore.

- [ ] **Step 4: Write the failing extension test `apps/web/test/curated-type.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import { getEditorSchema } from '../src/components/editor-schema.js'

const styled = (attrs: Record<string, unknown>) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'typed', marks: [{ type: 'textStyle', attrs }] }],
    },
  ],
})

describe('curated type on textStyle', () => {
  it('textStyle carries colour, family and size, and nothing else', () => {
    const { marks } = getEditorSchema()
    expect(Object.keys(marks.textStyle?.spec.attrs ?? {}).sort()).toEqual(['color', 'fontFamily', 'fontSize'])
  })

  it('renders an id as its stack and a size as px, with data attributes to read back', () => {
    const { marks } = getEditorSchema()
    const out = JSON.stringify(
      marks.textStyle!.spec.toDOM!(marks.textStyle!.create({ fontFamily: 'serif', fontSize: 21 }), true),
    )
    expect(out).toContain('font-family: ui-serif')
    expect(out).toContain('font-size: 21px')
    expect(out).toContain('"data-font-family":"serif"')
    expect(out).toContain('"data-font-size":"21"')
  })

  it('renders nothing for plain text', () => {
    const { marks } = getEditorSchema()
    const out = JSON.stringify(marks.textStyle!.spec.toDOM!(marks.textStyle!.create({}), true))
    expect(out).not.toMatch(/font-family|font-size|data-font/)
  })

  it('survives the trip into a Y.Doc and back, which is how a second browser sees it', () => {
    const schema = getEditorSchema()
    const json = styled({ color: null, fontFamily: 'mono', fontSize: 26 })
    const back = yDocToProsemirrorJSON(prosemirrorJSONToYDoc(schema, json, 'default'), 'default')
    expect(schema.nodeFromJSON(back).eq(schema.nodeFromJSON(json))).toBe(true)
    expect(JSON.stringify(back)).toContain('"fontFamily":"mono"')
  })
})
```

- [ ] **Step 5: Run it, expect FAIL**

Run: `pnpm --filter @crdt/web exec vitest run test/curated-type.test.ts`
Expected: the first test fails, `['color']` instead of three keys.

- [ ] **Step 6: Create `apps/web/src/components/curated-type.ts`**

```ts
import { Extension, getStyleProperty } from '@tiptap/core'
import {
  DEFAULT_FONT_SIZE,
  familyCss,
  familyFromCss,
  sizeFromCss,
  stepFontSize,
  type FontFamilyId,
  type FontSize,
} from './editor-type'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    curatedType: {
      /** System clears the attribute: the editor's own font is System. */
      setTypeFamily: (id: FontFamilyId) => ReturnType
      /** The default size clears the attribute, so plain text carries nothing. */
      setTypeSize: (size: FontSize) => ReturnType
    }
  }
}

const FAMILY_IDS = new Set(['serif', 'mono'])

/**
 * Font family and size as two attributes on the textStyle mark, accepting only the
 * curated values in editor-type.ts.
 *
 * Not Tiptap's FontFamily and FontSize: their parseHTML keeps whatever font-family and
 * font-size a pasted span carries, so a paste from Word or a web page would write Arial
 * at 11pt into a shared document that no control can show or remove. Here a pasted value
 * survives only if it is exactly one of ours. Our own copy-paste between documents keeps
 * its type through the data attributes renderHTML writes.
 *
 * The document stores ids ('serif', 21), never CSS, and the defaults (System, 18px) as no
 * attribute at all.
 */
export const CuratedType = Extension.create({
  name: 'curatedType',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element) => {
              const tagged = element.getAttribute('data-font-family')
              if (tagged && FAMILY_IDS.has(tagged)) return tagged
              return familyFromCss(getStyleProperty(element, 'font-family') ?? element.style.fontFamily)
            },
            renderHTML: (attributes) => {
              const css = attributes.fontFamily ? familyCss(attributes.fontFamily as FontFamilyId) : null
              if (!css) return {}
              return { style: `font-family: ${css}`, 'data-font-family': attributes.fontFamily as string }
            },
          },
          fontSize: {
            default: null,
            parseHTML: (element) => {
              const tagged = element.getAttribute('data-font-size')
              if (tagged) return sizeFromCss(`${tagged}px`)
              return sizeFromCss(getStyleProperty(element, 'font-size') ?? element.style.fontSize)
            },
            renderHTML: (attributes) => {
              const size = attributes.fontSize as number | null
              if (!size) return {}
              return { style: `font-size: ${size}px`, 'data-font-size': String(size) }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setTypeFamily:
        (id) =>
        ({ chain }) =>
          id === 'system'
            ? chain().setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run()
            : chain().setMark('textStyle', { fontFamily: id }).run(),
      setTypeSize:
        (size) =>
        ({ chain }) =>
          size === DEFAULT_FONT_SIZE
            ? chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run()
            : chain().setMark('textStyle', { fontSize: size }).run(),
    }
  },

  // Google Docs' and Word's bindings: Cmd/Ctrl+Shift+. and +, step the size.
  addKeyboardShortcuts() {
    const step = (direction: 1 | -1) => () => {
      if (!this.editor.isEditable) return false
      const current = (this.editor.getAttributes('textStyle').fontSize as number | null) ?? DEFAULT_FONT_SIZE
      return this.editor.commands.setTypeSize(stepFontSize(current, direction))
    }
    return { 'Mod-Shift-.': step(1), 'Mod-Shift-,': step(-1) }
  },
})
```

- [ ] **Step 7: Register it in `editor-schema.ts`**

Add `import { CuratedType } from './curated-type'` and insert `CuratedType,` directly after `Color,` in `editorExtensions`. Replace the comment block above `TextStyle` (lines 35-41) with:

```ts
  // TextStyle is the mark colour, family and size hang off (Color and CuratedType below).
  // Tiptap's own FontFamily and FontSize are deliberately NOT registered: their parseHTML
  // keeps any font-family or font-size a pasted span carries. CuratedType accepts only
  // editor-type.ts's values. editor-schema.test.ts and the e2e paste test guard this.
```

- [ ] **Step 8: Update `editor-schema.test.ts`**

Replace the test `'keeps font family and size out of the schema'` (lines 38-47) with:

```ts
  it("registers curated type, never Tiptap's open FontFamily and FontSize", () => {
    // Tiptap's pair keeps any pasted family or size; CuratedType keeps only ours.
    const names = editorExtensions.map((extension) => extension.name)
    expect(names).toContain('curatedType')
    expect(names).not.toContain('fontFamily')
    expect(names).not.toContain('fontSize')
  })
```

- [ ] **Step 9: Run both test files, expect PASS; prove discrimination**

Run: `pnpm --filter @crdt/web exec vitest run test/curated-type.test.ts test/editor-schema.test.ts test/editor-type.test.ts`
Mutations, one at a time, each committed-before and reverted-after: remove `'data-font-family'` from renderHTML (render test fails); remove `CuratedType` from the list (attrs test fails).

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/editor-type.ts apps/web/src/components/curated-type.ts apps/web/src/components/editor-schema.ts apps/web/test/editor-type.test.ts apps/web/test/curated-type.test.ts apps/web/test/editor-schema.test.ts
git commit -m "feat(editor): curated font family and size on textStyle, ids not CSS, paste-safe"
```

---

### Task 2: The Font and Size menus

**Files:**
- Modify: `apps/web/src/components/ToolButton.tsx` (`field` prop)
- Modify: `apps/web/src/components/EditorMenu.tsx:43,88` (`MenuName`, `field` prop type)
- Create: `apps/web/src/components/TypeMenus.tsx`
- Modify: `apps/web/src/components/HomeTools.tsx`
- Modify: `apps/web/src/components/editor-toolbar.module.css`
- Create: `apps/web/e2e/editor-type.spec.ts`
- Modify: `docs/design/glass-handoff.md` (Precedence, deviation row)

**Interfaces:**
- Consumes: Task 1's `FONT_FAMILIES`, `FONT_SIZES`, `DEFAULT_FONT_SIZE`, `FontFamilyId`, `FontSize`, `setTypeFamily`, `setTypeSize`.
- Produces: `FontMenu`, `SizeMenu` (TypeMenus.tsx); test ids `tb-font-family`, `tb-font-family-current`, `tb-font-family-<id>`, `tb-font-size`, `tb-font-size-current`, `tb-font-size-<n>`.

- [ ] **Step 1: Write the failing e2e spec `apps/web/e2e/editor-type.spec.ts`**

```ts
import { test, expect, type Page } from '@playwright/test'
import { cleanup, createDocument, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-type'
test.afterAll(async () => {
  await cleanup(LABEL)
})

const prose = (page: Page) => page.locator('.editor .ProseMirror')
const tb = (page: Page, id: string) => page.getByTestId(`tb-${id}`)

async function openDocument(page: Page, label: string) {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(`/documents/${document.id}`)
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
}

async function typeAndSelect(page: Page, text: string) {
  await prose(page).click()
  await page.keyboard.type(text)
  await page.keyboard.press('ControlOrMeta+a')
}

test('Font and Size sit after Style and read System and 18 on plain text', async ({ page }) => {
  await openDocument(page, `${LABEL}-defaults`)
  await prose(page).click()
  const ids = await page
    .getByTestId('tb-row-home')
    .locator('[data-testid^="tb-"][aria-haspopup]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  expect(ids.slice(0, 3)).toEqual(['tb-style', 'tb-font-family', 'tb-font-size'])
  await expect(tb(page, 'font-family-current')).toHaveText('System')
  await expect(tb(page, 'font-size-current')).toHaveText('18')
})

test('choosing Serif and 26 styles the selection, and the triggers follow the caret', async ({ page }) => {
  await openDocument(page, `${LABEL}-apply`)
  await typeAndSelect(page, 'serif words')
  await tb(page, 'font-family').click()
  await tb(page, 'font-family-serif').click()
  await tb(page, 'font-size').click()
  await tb(page, 'font-size-26').click()

  const span = prose(page).locator('span[data-font-family="serif"][data-font-size="26"]')
  await expect(span).toHaveText('serif words')
  await expect(span).toHaveCSS('font-size', '26px')
  await expect(tb(page, 'font-family-current')).toHaveText('Serif')
  await expect(tb(page, 'font-size-current')).toHaveText('26')

  // Choosing the defaults writes no attribute, rather than an explicit System or 18.
  await page.keyboard.press('ControlOrMeta+a')
  await tb(page, 'font-family').click()
  await tb(page, 'font-family-system').click()
  await tb(page, 'font-size').click()
  await tb(page, 'font-size-18').click()
  expect(await prose(page).innerHTML()).not.toMatch(/data-font|font-family|font-size/)
})

test('Cmd/Ctrl+Shift+. and +, step the size along the scale', async ({ page }) => {
  await openDocument(page, `${LABEL}-keys`)
  await typeAndSelect(page, 'step me')
  await page.keyboard.press('ControlOrMeta+Shift+Period')
  await expect(tb(page, 'font-size-current')).toHaveText('21')
  await page.keyboard.press('ControlOrMeta+Shift+Period')
  await expect(tb(page, 'font-size-current')).toHaveText('26')
  await page.keyboard.press('ControlOrMeta+Shift+Comma')
  await page.keyboard.press('ControlOrMeta+Shift+Comma')
  await page.keyboard.press('ControlOrMeta+Shift+Comma')
  await expect(tb(page, 'font-size-current')).toHaveText('16')
})

test('Clear formatting removes family and size', async ({ page }) => {
  await openDocument(page, `${LABEL}-clear`)
  await typeAndSelect(page, 'plain again')
  await tb(page, 'font-family').click()
  await tb(page, 'font-family-mono').click()
  await expect(prose(page).locator('span[data-font-family="mono"]')).toHaveCount(1)
  await tb(page, 'clear').click()
  expect(await prose(page).innerHTML()).not.toMatch(/data-font|font-family/)
})

test('a paste keeps our own family and size, and still drops anyone else’s', async ({ page }) => {
  await openDocument(page, `${LABEL}-paste`)
  await prose(page).click()
  await prose(page).evaluate((el) => {
    const data = new DataTransfer()
    data.setData(
      'text/html',
      '<p><span data-font-family="serif" data-font-size="21" style="font-family: ui-serif, Georgia, Cambria, &quot;Times New Roman&quot;, serif; font-size: 21px">ours</span></p>' +
        '<p><span style="font-family:Arial;font-size:11pt">theirs</span></p>',
    )
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(prose(page).locator('span[data-font-family="serif"][data-font-size="21"]')).toHaveText('ours')
  const html = await prose(page).innerHTML()
  expect(html).not.toMatch(/Arial|11pt/)
})

test('the menus are keyboard operable and stay out of the row’s tab stops', async ({ page }) => {
  await openDocument(page, `${LABEL}-keyboard`)
  await typeAndSelect(page, 'keyboard type')
  await tb(page, 'font-family').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox', { name: 'Font' })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(tb(page, 'font-family-current')).not.toHaveText('System')
  expect(await page.locator('[data-menu-item][data-roving]').count()).toBe(0)
})
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @crdt/web exec playwright test e2e/editor-type.spec.ts`
Expected: every test fails, `tb-font-family` not found.

- [ ] **Step 3: Widen the field prop**

In `ToolButton.tsx` change the prop to `field?: boolean | 'family' | 'size'` (doc comment: "`true` is the 150px Style field; 'family' and 'size' are the narrower Font and Size fields") and the class list entry to:

```ts
    field ? styles.toolField : '',
    field === 'family' ? styles.toolFieldFamily : '',
    field === 'size' ? styles.toolFieldSize : '',
```

In `EditorMenu.tsx` change `field?: boolean` to `field?: boolean | 'family' | 'size'` and `MenuName` to `'style' | 'font-family' | 'font-size' | 'color' | 'highlight' | 'insert-link'`.

Append to `editor-toolbar.module.css` after `.toolField`'s rules:

```css
/* The Font and Size fields (owner decision 2026-10-07): the Style field's look, narrower.
   104px fits "System" and "Serif" with the caret; 64px fits "32". */
.toolFieldFamily {
  width: 104px;
}

.toolFieldSize {
  width: 64px;
}
```

- [ ] **Step 4: Create `apps/web/src/components/TypeMenus.tsx`**

```tsx
'use client'

import type { Editor } from '@tiptap/react'
import { EditorMenu, MenuItem, type MenuControl } from './EditorMenu'
import { FONT_FAMILIES, FONT_SIZES, familyCss, type FontFamilyId, type FontSize } from './editor-type'
import styles from './editor-toolbar.module.css'

function Caret() {
  return (
    <span className={styles.styleCaret} aria-hidden="true">
      ▼
    </span>
  )
}

/** The Font menu. Each row is drawn in its own family, like the Style menu's rows. */
export function FontMenu({ editor, control, current }: { editor: Editor; control: MenuControl; current: FontFamilyId }) {
  const label = FONT_FAMILIES.find((family) => family.id === current)?.label ?? 'System'
  return (
    <EditorMenu
      name="font-family"
      control={control}
      variant="list"
      field="family"
      label={`Font: ${label}`}
      title="Font"
      menuLabel="Font"
      trigger={
        <>
          <span className={styles.styleName} data-testid="tb-font-family-current">
            {label}
          </span>
          <Caret />
        </>
      }
    >
      {FONT_FAMILIES.map((family) => (
        <MenuItem
          key={family.id}
          role="option"
          selected={current === family.id}
          label={family.label}
          className={styles.styleRow}
          style={{ fontFamily: familyCss(family.id) ?? undefined }}
          data-testid={`tb-font-family-${family.id}`}
          onChoose={() => editor.chain().setTypeFamily(family.id).run()}
        >
          {family.label}
        </MenuItem>
      ))}
    </EditorMenu>
  )
}

/** The Size menu: the curated scale, the default marked by the trigger reading 18. */
export function SizeMenu({ editor, control, current }: { editor: Editor; control: MenuControl; current: FontSize }) {
  return (
    <EditorMenu
      name="font-size"
      control={control}
      variant="list"
      field="size"
      label={`Font size: ${current}`}
      title="Font size (⌘⇧. / ⌘⇧,)"
      menuLabel="Font size"
      trigger={
        <>
          <span className={styles.styleName} data-testid="tb-font-size-current">
            {current}
          </span>
          <Caret />
        </>
      }
    >
      {FONT_SIZES.map((size) => (
        <MenuItem
          key={size}
          role="option"
          selected={current === size}
          label={`${size} pixels`}
          className={styles.styleRow}
          data-testid={`tb-font-size-${size}`}
          onChoose={() => editor.chain().setTypeSize(size).run()}
        >
          {size}
        </MenuItem>
      ))}
    </EditorMenu>
  )
}
```

- [ ] **Step 5: Wire them into `HomeTools.tsx`**

Add to the imports:

```ts
import { FontMenu, SizeMenu } from './TypeMenus'
import { DEFAULT_FONT_SIZE, type FontFamilyId, type FontSize } from './editor-type'
```

Add two fields to `HomeFormat` (after `block`):

```ts
  /** The curated family and size at the selection; System and 18 when it has none. */
  fontFamily: FontFamilyId
  fontSize: FontSize
```

and to the object `readFormat` returns (after `block: readBlockStyle(editor),`):

```ts
    fontFamily: (editor.getAttributes('textStyle').fontFamily as FontFamilyId | null) ?? 'system',
    fontSize: (editor.getAttributes('textStyle').fontSize as FontSize | null) ?? DEFAULT_FONT_SIZE,
```

Directly after `<StyleMenu … />` and before its `<ToolSeparator />`, render:

```tsx
      <FontMenu editor={editor} control={menu('font-family')} current={format.fontFamily} />
      <SizeMenu editor={editor} control={menu('font-size')} current={format.fontSize} />
```

Update the component's doc comment: "history, the Style, Font and Size dropdowns, …".

- [ ] **Step 6: Run the new spec and the toolbar spec, expect PASS**

Run: `pnpm --filter @crdt/web exec playwright test e2e/editor-type.spec.ts e2e/editor-toolbar.spec.ts`
Expected: all pass, including the unchanged "pasting text styled with a font family and size writes neither…" test. If a toolbar test pinned the Home row's exact tool order or count, update that assertion to include `tb-font-family` and `tb-font-size` after `tb-style` and note it in the report.
Prove discrimination: make `setTypeSize` always set (no default-clears branch) and watch "writes no attribute" fail; restore.

- [ ] **Step 7: Record it in the handoff**

In `docs/design/glass-handoff.md`, add after the "Zoom and the document title" paragraph in the Precedence section:

```markdown
**Font family and size (decided 2026-10-07).** §12.2's Home table has no font controls;
the owner asked for them on 2026-10-07, after this file was generated. Built as two field
menus after Style: **Font** (System, Serif, Mono; 104px) and **Size** (14, 16, 18, 21, 26,
32; 64px), with Cmd/Ctrl+Shift+. and +, stepping the size. The document stores ids, not
CSS, and System and 18px as no attribute. `CuratedType` (`curated-type.ts`) owns the two
attributes and accepts a pasted value only when it is exactly one of these, so a paste from
Word or a web page still writes no foreign type.
```

Replace the deviation-table row that begins `| Font family and size controls |` with:

```markdown
| Font family and size controls | not in §12.2's Home table | **built**: Font (104px) and Size (64px) after Style; curated values only | Owner decision 2026-10-07, see Precedence. Tiptap's `FontFamily`/`FontSize` are still not registered (their `parseHTML` keeps any pasted value); `CuratedType` stores ids and drops anything off the list. Guarded by `curated-type.test.ts`, `editor-schema.test.ts`, `editor-type.spec.ts` and the paste test in `editor-toolbar.spec.ts`. Known limit: a tab still running a bundle from before this change does not render the attributes and may drop them from text it edits; force-refresh open tabs after deploying, as for every editor change. |
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/ToolButton.tsx apps/web/src/components/EditorMenu.tsx apps/web/src/components/TypeMenus.tsx apps/web/src/components/HomeTools.tsx apps/web/src/components/editor-toolbar.module.css apps/web/e2e/editor-type.spec.ts apps/web/e2e/editor-toolbar.spec.ts docs/design/glass-handoff.md
git commit -m "feat(editor): Font and Size menus after Style, with size-step shortcuts"
```

---

### Task 3: One safe way to open a link, and Alt+Enter

**Files:**
- Modify: `apps/web/src/components/link-open.ts`
- Create: `apps/web/test/link-open.test.ts`
- Create: `apps/web/e2e/link-follow.spec.ts`

**Interfaces:**
- Produces: `isOpenableHref(href: string | null | undefined): boolean`, `openHref(href: string): boolean`, `linkHrefAt(editor: Editor): string | null` (all exported from `link-open.ts`). Task 4 uses `openHref` and `linkHrefAt`.

- [ ] **Step 1: Write the failing unit test `apps/web/test/link-open.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { isOpenableHref } from '../src/components/link-open.js'

describe('which links our code will open', () => {
  it('opens web and mail addresses', () => {
    expect(isOpenableHref('https://example.com/a')).toBe(true)
    expect(isOpenableHref('http://example.com')).toBe(true)
    expect(isOpenableHref('MAILTO:someone@example.com')).toBe(true)
  })

  it('refuses script, data and relative addresses, and nothing at all', () => {
    expect(isOpenableHref('javascript:alert(1)')).toBe(false)
    expect(isOpenableHref(' javascript:alert(1)')).toBe(false)
    expect(isOpenableHref('data:text/html,<p>')).toBe(false)
    expect(isOpenableHref('/documents/x')).toBe(false)
    expect(isOpenableHref('')).toBe(false)
    expect(isOpenableHref(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, expect FAIL** (`isOpenableHref` is not exported).

Run: `pnpm --filter @crdt/web exec vitest run test/link-open.test.ts`

- [ ] **Step 3: Rewrite `link-open.ts`**

```ts
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * Whether our code will open this address. Web and mail only: a link's href is document
 * content, written by any collaborator or a paste, and window.open on a javascript: or
 * data: URL would run it. Leading whitespace is trimmed first, as browsers do.
 */
export function isOpenableHref(href: string | null | undefined): boolean {
  return typeof href === 'string' && /^(https?:|mailto:)/i.test(href.trim())
}

/** Opens a link in a new tab, with no handle back on this document. False if refused. */
export function openHref(href: string): boolean {
  if (!isOpenableHref(href)) return false
  window.open(href.trim(), '_blank', 'noopener,noreferrer')
  return true
}

/** The address of the link the caret is in, or null. A range selection is not "in" a link. */
export function linkHrefAt(editor: Editor): string | null {
  if (!editor.state.selection.empty || !editor.isActive('link')) return null
  return (editor.getAttributes('link').href as string | undefined) ?? null
}

/**
 * Following a link in an editable document: Cmd-click (macOS) or Ctrl-click, Alt+Enter
 * (Google Docs' binding) with the caret in it, or the bubble's Open (LinkBubble.tsx).
 * All three go through openHref.
 *
 * Link's own openOnClick is off (editor-schema.ts): left on, a plain click opens the link
 * and the caret can never be put inside one to edit or remove it. Chrome does not follow
 * an anchor inside a contenteditable either. A viewer's document is not editable, none of
 * this runs, and the browser follows the anchor itself.
 *
 * Behaviour only, no nodes or marks, so it sits with Collaboration in DocumentEditor and
 * not in the schema's extension list.
 */
export const LinkOpen = Extension.create({
  name: 'linkOpen',
  addKeyboardShortcuts() {
    return {
      'Alt-Enter': () => {
        if (!this.editor.isEditable) return false
        const href = linkHrefAt(this.editor)
        return href ? openHref(href) : false
      },
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('linkOpen'),
        props: {
          handleClick: (view, _pos, event) => {
            if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false
            if (!view.editable) return false
            const target = event.target
            if (!(target instanceof Element)) return false
            const anchor = target.closest('a')
            if (!anchor || !view.dom.contains(anchor)) return false
            const href = anchor.getAttribute('href')
            return href ? openHref(href) : false
          },
        },
      }),
    ]
  },
})
```

- [ ] **Step 4: Run the unit test, expect PASS.** Prove discrimination: add `javascript:` to the regex's alternatives, watch the two script cases fail; restore.

- [ ] **Step 5: Write `apps/web/e2e/link-follow.spec.ts` with the Alt+Enter test**

```ts
import { test, expect, type Page } from '@playwright/test'
import { addMember, cleanup, createDocument, seedWorkspace, sessionCookieFor, signIn } from './fixtures.js'

const LABEL = 'e2e-link-follow'
test.afterAll(async () => {
  await cleanup(LABEL)
})

const prose = (page: Page) => page.locator('.editor .ProseMirror')
const tb = (page: Page, id: string) => page.getByTestId(`tb-${id}`)

async function stubExample(page: Page) {
  await page.context().route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' }),
  )
}

/** Opens a fresh document as its owner and writes one linked line, "go here". */
async function documentWithLink(page: Page, label: string, address: string) {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(`/documents/${document.id}`)
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
  await stubExample(page)
  await prose(page).click()
  await page.keyboard.type('go here')
  await page.keyboard.press('ControlOrMeta+a')
  await tb(page, 'tab-insert').click()
  await tb(page, 'insert-link').click()
  await expect(tb(page, 'insert-link-input')).toBeFocused()
  await page.keyboard.type(address)
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveCount(1)
  return { owner, workspace, document }
}

test('Alt+Enter opens the link the caret is in, and does nothing outside one', async ({ page }) => {
  await documentWithLink(page, `${LABEL}-alt-enter`, 'example.com/alt')
  // Caret into the middle of the link with the keyboard only.
  await prose(page).press('ControlOrMeta+a')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')

  const popup = page.waitForEvent('popup')
  await page.keyboard.press('Alt+Enter')
  const opened = await popup
  await expect.poll(() => opened.url()).toBe('https://example.com/alt')
  expect(await opened.evaluate(() => window.opener)).toBeNull()
  await opened.close()

  // Outside the link: a new paragraph, no popup.
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  let popped = false
  page.once('popup', () => {
    popped = true
  })
  await page.keyboard.press('Alt+Enter')
  await page.waitForTimeout(500)
  expect(popped).toBe(false)
})
```

Keep the `addMember` and `sessionCookieFor` imports: Task 4 adds tests to this file that use them.

- [ ] **Step 6: Run it, expect PASS** (Step 3 shipped the binding, so watch it fail first by temporarily removing `addKeyboardShortcuts`, then restore).

Run: `pnpm --filter @crdt/web exec playwright test e2e/link-follow.spec.ts e2e/editor-toolbar.spec.ts -g "link"`
The existing Cmd/Ctrl-click and viewer tests in the toolbar spec must still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/link-open.ts apps/web/test/link-open.test.ts apps/web/e2e/link-follow.spec.ts
git commit -m "feat(editor): Alt+Enter follows a link; every open path refuses non-web addresses"
```

---

### Task 4: The link bubble (touch and mouse)

**Files:**
- Create: `apps/web/src/components/LinkBubble.tsx`
- Modify: `apps/web/src/components/DocumentEditor.tsx`
- Modify: `apps/web/src/app/documents/[id]/document.module.css` (`.page`)
- Modify: `apps/web/src/components/editor-toolbar.module.css`
- Modify: `apps/web/e2e/link-follow.spec.ts`
- Modify: `docs/design/glass-handoff.md` (deviation row)

**Interfaces:**
- Consumes: Task 3's `openHref(href)`, `linkHrefAt(editor)`; `keepEditorSelection` from `ToolButton.tsx`.
- Produces: `<LinkBubble editor={Editor | null} layoutKey={string} />`; test ids `link-bubble`, `link-bubble-href`, `link-bubble-open`.

- [ ] **Step 1: Add the failing tests to `link-follow.spec.ts`**

```ts
test('with the caret in a link, a bubble under it shows the address and Open follows it', async ({ page }) => {
  await documentWithLink(page, `${LABEL}-bubble`, 'example.com/bubble')
  await expect(page.getByTestId('link-bubble')).toHaveCount(0)

  // A plain click places the caret in the link; the bubble appears under it.
  await prose(page).locator('a').click()
  const bubble = page.getByTestId('link-bubble')
  await expect(bubble).toBeVisible()
  await expect(page.getByTestId('link-bubble-href')).toHaveText('example.com/bubble')
  const link = (await prose(page).locator('a').boundingBox())!
  const box = (await bubble.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(link.y + link.height)
  expect(box.y).toBeLessThan(link.y + link.height + 24)

  const popup = page.waitForEvent('popup')
  await page.getByTestId('link-bubble-open').click()
  const opened = await popup
  await expect.poll(() => opened.url()).toBe('https://example.com/bubble')
  await opened.close()
  // Open did not take the caret out of the document.
  await expect(prose(page)).toBeFocused()

  // Leaving the link hides it.
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(bubble).toHaveCount(0)
})

test('on a touch screen, a tap on a link then a tap on Open follows it', async ({ browser }) => {
  const label = `${LABEL}-touch`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  // Write the link from a desktop context first, then read it on a touch one.
  const desk = await browser.newContext()
  await desk.addCookies([await sessionCookieFor(owner.id)])
  const author = await desk.newPage()
  await author.goto(`/documents/${document.id}?nobc=1`)
  await expect(author.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  await prose(author).click()
  await author.keyboard.type('tap here')
  await author.keyboard.press('ControlOrMeta+a')
  await tb(author, 'tab-insert').click()
  await tb(author, 'insert-link').click()
  await author.keyboard.type('example.com/touch')
  await author.keyboard.press('Enter')
  await expect(prose(author).locator('a')).toHaveCount(1)

  const phone = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  await phone.addCookies([await sessionCookieFor(owner.id)])
  await phone.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' }),
  )
  const touch = await phone.newPage()
  await touch.goto(`/documents/${document.id}?nobc=1`)
  await expect(prose(touch)).toHaveAttribute('contenteditable', 'true')
  await prose(touch).locator('a').tap()
  await expect(touch.getByTestId('link-bubble')).toBeVisible()
  const popup = touch.waitForEvent('popup')
  await touch.getByTestId('link-bubble-open').tap()
  await expect.poll(async () => (await popup).url()).toBe('https://example.com/touch')

  await phone.close()
  await desk.close()
})

test('a viewer gets no bubble: the browser follows their links itself', async ({ browser }) => {
  const label = `${LABEL}-viewer`
  const { owner, workspace } = await seedWorkspace(label)
  const viewerUser = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')
  const ownerContext = await browser.newContext()
  await ownerContext.addCookies([await sessionCookieFor(owner.id)])
  const author = await ownerContext.newPage()
  await author.goto(`/documents/${document.id}?nobc=1`)
  await expect(author.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  await prose(author).click()
  await author.keyboard.type('viewer link')
  await author.keyboard.press('ControlOrMeta+a')
  await tb(author, 'tab-insert').click()
  await tb(author, 'insert-link').click()
  await author.keyboard.type('example.com/v')
  await author.keyboard.press('Enter')

  const viewerContext = await browser.newContext()
  await viewerContext.addCookies([await sessionCookieFor(viewerUser.id)])
  const viewer = await viewerContext.newPage()
  await viewer.goto(`/documents/${document.id}?nobc=1`)
  await expect(prose(viewer).locator('a')).toHaveText('viewer link')
  // Not a click on the link: that is the browser's to follow (toolbar spec covers it).
  // A regression guard only: a viewer's editor never takes focus, so readLink is null there
  // whether or not it checks isEditable, and no mutation of LinkBubble makes this fail.
  await viewer.getByTestId('document-heading').click()
  await expect(viewer.getByTestId('link-bubble')).toHaveCount(0)
  await viewerContext.close()
  await ownerContext.close()
})
```

- [ ] **Step 2: Run, expect FAIL** (`link-bubble` not found).

Run: `pnpm --filter @crdt/web exec playwright test e2e/link-follow.spec.ts`

- [ ] **Step 3: Make the sheet the bubble's containing block**

In `document.module.css`, add `position: relative;` to `.page` with the comment `/* The link bubble (LinkBubble.tsx) is placed against the sheet, outside the zoomed wrapper. */`.

- [ ] **Step 4: Create `apps/web/src/components/LinkBubble.tsx`**

```tsx
'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { keepEditorSelection } from './ToolButton'
import { linkHrefAt, openHref } from './link-open'
import styles from './editor-toolbar.module.css'

/** What the bubble reads from the editor: the link the caret is in, while the editor has focus. */
function readLink(editor: Editor | null): { href: string; pos: number } | null {
  if (!editor || !editor.isEditable || !editor.isFocused) return null
  const href = linkHrefAt(editor)
  return href ? { href, pos: editor.state.selection.from } : null
}

/**
 * A small chip under the link the caret is in: its address and an Open button.
 *
 * This is how a touch screen, or a mouse without a modifier, follows a link in an editable
 * document (openOnClick is off, see editor-schema.ts). The keyboard has Alt+Enter.
 *
 * It sits in the sheet, outside the zoomed wrapper, so it never scales with the text, and it
 * is placed from the anchor's own client rect against the sheet's, which are both in the
 * same (unzoomed) coordinates in every engine. `layoutKey` changes when zoom or page width
 * does, and a ResizeObserver on the sheet covers the width animation and window resizes.
 */
export function LinkBubble({ editor, layoutKey }: { editor: Editor | null; layoutKey: string }) {
  const link = useEditorState({ editor, selector: ({ editor: current }) => readLink(current) })
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const bubble = ref.current
    const sheet = bubble?.offsetParent
    if (!link || !editor || !bubble || !(sheet instanceof HTMLElement)) {
      setPlace(null)
      return
    }
    const measure = () => {
      const { node } = editor.view.domAtPos(link.pos)
      const element = node instanceof Element ? node : node.parentElement
      const anchor = element?.closest('a')
      if (!anchor) return setPlace(null)
      const a = anchor.getBoundingClientRect()
      const s = sheet.getBoundingClientRect()
      setPlace({ top: a.bottom - s.top + 6, left: Math.max(8, a.left - s.left) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(sheet)
    return () => observer.disconnect()
  }, [editor, link?.pos, link?.href, layoutKey])

  if (!link) return null
  return (
    <div
      ref={ref}
      className={styles.linkBubble}
      role="group"
      aria-label="Link"
      data-testid="link-bubble"
      style={place ? { top: place.top, left: place.left } : { visibility: 'hidden' }}
    >
      <span className={styles.linkBubbleHref} data-testid="link-bubble-href">
        {link.href.replace(/^https?:\/\//i, '')}
      </span>
      <button
        type="button"
        className={styles.linkBubbleOpen}
        title="Open link (⌥↵)"
        aria-keyshortcuts="Alt+Enter"
        data-testid="link-bubble-open"
        // Keeps the caret in the document, which also keeps the bubble up.
        onMouseDown={keepEditorSelection}
        onClick={() => openHref(link.href)}
      >
        Open
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Style it** — append to `editor-toolbar.module.css`:

```css
/* The link bubble (LinkBubble.tsx): a small menu-glass chip under the link with the caret.
   Not part of §12; see the handoff's deviation table. */
.linkBubble {
  position: absolute;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 340px;
  padding: 4px 4px 4px 12px;
  border-radius: var(--r-pill);
  background: var(--glass-menu);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-hl), 0 8px 24px rgba(30, 30, 50, 0.12);
  font-size: 13px;
}

.linkBubbleHref {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.linkBubbleOpen {
  flex: none;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--r-pill);
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
```

- [ ] **Step 6: Render it in `DocumentEditor.tsx`**

Import `LinkBubble` and render it as the last child of the sheet `div` (after the `document-zoom` wrapper):

```tsx
        {/* Outside the zoom wrapper on purpose: the chip stays one size at every zoom. */}
        <LinkBubble editor={editor} layoutKey={`${zoom}-${pageWidth}`} />
```

- [ ] **Step 7: Run, expect PASS; prove discrimination**

Run: `pnpm --filter @crdt/web exec playwright test e2e/link-follow.spec.ts e2e/editor-toolbar.spec.ts`
Mutations: remove `onMouseDown={keepEditorSelection}` (the "caret stays in the document" assertion fails, or the bubble vanishes before the click lands); place the bubble from `a.top` instead of `a.bottom` (the position assertion fails).

- [ ] **Step 8: Record it** — add a row to the handoff's deviation table:

```markdown
| Following a link (§12.6) | silent | Cmd/Ctrl-click, Alt+Enter, or the bubble's **Open** | A bubble under the link with the caret in it shows the address and Open, which is how touch follows a link. Every path opens http(s) and mailto only (`isOpenableHref`). Viewers are unchanged. |
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/LinkBubble.tsx apps/web/src/components/DocumentEditor.tsx "apps/web/src/app/documents/[id]/document.module.css" apps/web/src/components/editor-toolbar.module.css apps/web/e2e/link-follow.spec.ts docs/design/glass-handoff.md
git commit -m "feat(editor): a link bubble with Open, for touch and mouse"
```

---

### Task 5: Zoom outside Chromium — the hedge and the measurement

**Files:**
- Modify: `apps/web/src/components/DocumentEditor.tsx:99`
- Modify: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/editor-zoom.spec.ts`

**Interfaces:**
- Produces: the result Task 6 branches on: for each of `webkit` and `firefox`, `editor-zoom.spec.ts` PASS or FAIL, recorded in the report with the failing assertion's output.

- [ ] **Step 1: Write `apps/web/e2e/editor-zoom.spec.ts`**

```ts
import { test, expect, type Page } from '@playwright/test'
import { cleanup, createDocument, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-zoom'
test.afterAll(async () => {
  await cleanup(LABEL)
})

const prose = (page: Page) => page.locator('.editor .ProseMirror')
const tb = (page: Page, id: string) => page.getByTestId(`tb-${id}`)

async function openDocument(page: Page, label: string) {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(`/documents/${document.id}`)
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
}

async function zoomTo(page: Page, target: number) {
  await tb(page, 'tab-view').click()
  await tb(page, 'view-zoom-value').click()
  const steps = (target - 100) / 10
  for (let i = 0; i < Math.abs(steps); i += 1) await tb(page, steps > 0 ? 'view-zoom-in' : 'view-zoom-out').click()
  await expect(tb(page, 'view-zoom-value')).toHaveText(`${target}%`)
}

/** Client rect of the `index`th character of the first paragraph's text. */
async function charRect(page: Page, index: number) {
  return prose(page).locator('p').first().evaluate((p, i) => {
    const text = p.firstChild!
    const range = document.createRange()
    range.setStart(text, i)
    range.setEnd(text, i + 1)
    const r = range.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, index)
}

/** The caret's offset in the first paragraph, as ProseMirror resolved it. */
const caretOffset = (page: Page) => page.evaluate(() => window.getSelection()!.focusOffset)

test('at 100% no zoom style is written', async ({ page }) => {
  await openDocument(page, `${LABEL}-default`)
  expect(await page.getByTestId('document-zoom').getAttribute('style')).toBeNull()
})

for (const zoom of [70, 150]) {
  test(`at ${zoom}% a click lands the caret on the character under the pointer`, async ({ page }) => {
    await openDocument(page, `${LABEL}-click-${zoom}`)
    await prose(page).click()
    await page.keyboard.type('abcdefghijklmnopqrstuvwxyz')
    await zoomTo(page, zoom)
    // Click the left half of "p" (index 15): the caret goes before it, offset 15.
    const p = await charRect(page, 15)
    await page.mouse.click(p.x - 2, p.y)
    await expect.poll(() => caretOffset(page)).toBe(15)
    // And typing goes there.
    await page.keyboard.type('X')
    await expect(prose(page).locator('p').first()).toHaveText('abcdefghijklmnoXpqrstuvwxyz')
  })

  test(`at ${zoom}% a drag selects exactly the characters it crosses`, async ({ page }) => {
    await openDocument(page, `${LABEL}-drag-${zoom}`)
    await prose(page).click()
    await page.keyboard.type('abcdefghijklmnopqrstuvwxyz')
    await zoomTo(page, zoom)
    const from = await charRect(page, 4)
    const to = await charRect(page, 9)
    await page.mouse.move(from.x - 2, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x - 2, to.y, { steps: 8 })
    await page.mouse.up()
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe('efghi')
  })
}
```

- [ ] **Step 2: Run it in Chromium, expect the first test to FAIL and the rest to PASS**

Run: `pnpm --filter @crdt/web exec playwright test e2e/editor-zoom.spec.ts`
Expected: "at 100% no zoom style is written" fails (the style is `zoom: 100%`); the click and drag tests pass, which proves they pass where zoom is known to work.

- [ ] **Step 3: The hedge** — in `DocumentEditor.tsx` replace the wrapper's `style={{ zoom: `${zoom}%` }}` with:

```tsx
          // No style at 100%: the default path is plain layout in every engine, whatever
          // that engine does with zoom.
          style={zoom === ZOOM_DEFAULT ? undefined : { zoom: `${zoom}%` }}
```

Re-run Step 2's command: all pass. Also run `pnpm --filter @crdt/web exec playwright test e2e/editor-toolbar.spec.ts -g "zoom"`. The `appliedZoom` helper reads computed `zoom`, which is `1` with no style, so those tests are unaffected; if one reads the inline style at 100%, update it to expect none and say so in the report.

- [ ] **Step 4: Add the engine projects to `playwright.config.ts`**

Add `devices` to the import (`import { defineConfig, devices } from '@playwright/test'`) and, after `webServer`, add:

```ts
  // Chromium runs every spec. WebKit (Safari's engine) and Firefox run only the zoom spec:
  // CSS zoom's coordinates are the one engine-dependent thing the editor relies on
  // (DocumentEditor.tsx), and the whole suite three times over is not worth its runtime.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /editor-zoom\.spec\.ts$/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /editor-zoom\.spec\.ts$/ },
  ],
```

Keep `use: { baseURL: 'http://localhost:3000' }` at the top level; the devices do not set `baseURL`.

- [ ] **Step 5: Install the two engines (OWNER APPROVAL REQUIRED)**

The controller asks the owner first: "Playwright needs to download WebKit and Firefox builds (a few hundred MB, from Playwright's CDN) to run the zoom spec. OK?" Only on a yes:

```bash
pnpm --filter @crdt/web exec playwright install webkit firefox
```

- [ ] **Step 6: Measure**

Run: `pnpm --filter @crdt/web exec playwright test e2e/editor-zoom.spec.ts --project=webkit --project=firefox`
Record in the report, per engine: PASS, or FAIL with the failing test names and the actual caret offset or selected text. **This result decides Task 6.** Run the default `chromium` project too and confirm the whole suite still passes (`pnpm --filter @crdt/web exec playwright test --project=chromium`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/DocumentEditor.tsx apps/web/playwright.config.ts apps/web/e2e/editor-zoom.spec.ts
git commit -m "test(editor): zoom measured in WebKit and Firefox; no zoom style at 100%"
```

If an engine failed, mark its failing tests `test.fixme` for that project only (`test.fixme(({ browserName }) => browserName === 'webkit', 'CSS zoom coordinates; fixed in Task 6')`) before committing, so the suite stays green between tasks, and say so in the report.

---

### Task 6: The fallback for engines without standard zoom (conditional)

**Run this task only if Task 5 Step 6 recorded a FAIL for any engine.** If both engines passed, skip it: record "Task 6 skipped: WebKit and Firefox pass" in the ledger, and in the handoff's zoom row replace "Verified in Chromium 153 only" with the engines and versions Playwright ran.

**Files:**
- Create: `apps/web/src/components/editor-zoom.ts`
- Create: `apps/web/test/editor-zoom.test.ts`
- Modify: `apps/web/src/components/DocumentEditor.tsx`
- Modify: `apps/web/e2e/editor-zoom.spec.ts` (remove the `test.fixme` lines)
- Modify: `docs/design/glass-handoff.md`

**Interfaces:**
- Produces: `hasStandardZoom(): boolean`, `zoomStyle(zoom: number, standard: boolean): CSSProperties | undefined`.

Why this fallback: engines that implement the standardised CSS `zoom` (Chrome 128+, Firefox 126+) expose `Element.prototype.currentCSSZoom`; engines that do not are the ones whose reported coordinates disagree with layout. prosemirror-view 1.42 measures a scaled editor itself (it divides the element's client rect by its `offsetWidth`), which is what a CSS transform produces. So those engines scale the wrapper with `transform: scale()` instead, with its layout width divided by the scale so the text still fills the sheet, and its bottom margin corrected so the sheet's height follows the scaled content.

- [ ] **Step 1: Write the failing unit test `apps/web/test/editor-zoom.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { zoomStyle } from '../src/components/editor-zoom.js'

describe('the zoom wrapper style', () => {
  it('writes nothing at 100%, in either engine kind', () => {
    expect(zoomStyle(100, true)).toBeUndefined()
    expect(zoomStyle(100, false)).toBeUndefined()
  })

  it('uses CSS zoom where zoom is standard', () => {
    expect(zoomStyle(150, true)).toEqual({ zoom: '150%' })
  })

  it('uses a transform elsewhere, widened so the scaled text still fills the sheet', () => {
    expect(zoomStyle(150, false)).toEqual({
      transform: 'scale(1.5)',
      transformOrigin: '0 0',
      width: 'calc(100% / 1.5)',
    })
    expect(zoomStyle(70, false)).toMatchObject({ transform: 'scale(0.7)', width: 'calc(100% / 0.7)' })
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

Run: `pnpm --filter @crdt/web exec vitest run test/editor-zoom.test.ts`

- [ ] **Step 3: Create `apps/web/src/components/editor-zoom.ts`**

```ts
import type { CSSProperties } from 'react'

/**
 * Whether this engine implements standardised CSS zoom, under which client rects and
 * layout agree and ProseMirror's posAtCoords/coordsAtPos are right. currentCSSZoom shipped
 * with the standard (Chrome 128, Firefox 126); its absence marks the legacy behaviour.
 * Server rendering has no Element and reports standard, which writes the same markup the
 * client's first render does.
 */
export function hasStandardZoom(): boolean {
  return typeof Element === 'undefined' || 'currentCSSZoom' in Element.prototype
}

/** The wrapper's style at a zoom percentage. Nothing at 100%. */
export function zoomStyle(zoom: number, standard: boolean): CSSProperties | undefined {
  if (zoom === 100) return undefined
  if (standard) return { zoom: `${zoom}%` }
  const scale = zoom / 100
  return { transform: `scale(${scale})`, transformOrigin: '0 0', width: `calc(100% / ${scale})` }
}
```

- [ ] **Step 4: Use it in `DocumentEditor.tsx`**

Import `hasStandardZoom, zoomStyle` from `./editor-zoom`, and extend the React import to `useEffect, useLayoutEffect, useRef, useState`. Hold the engine kind in state set after mount, so server and first client render agree:

```tsx
  const [standardZoom, setStandardZoom] = useState(true)
  useEffect(() => setStandardZoom(hasStandardZoom()), [])
```

A transform does not change layout height, so in the fallback the sheet would keep the unscaled height. Correct it with a negative bottom margin measured from the wrapper:

```tsx
  const zoomRef = useRef<HTMLDivElement>(null)
  const [heightFix, setHeightFix] = useState(0)
  useLayoutEffect(() => {
    const wrapper = zoomRef.current
    if (standardZoom || zoom === ZOOM_DEFAULT || !wrapper) {
      setHeightFix(0)
      return
    }
    const measure = () => setHeightFix(wrapper.offsetHeight * (zoom / 100 - 1))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [standardZoom, zoom])
```

and render the wrapper as:

```tsx
        <div
          ref={zoomRef}
          data-testid="document-zoom"
          style={{ ...zoomStyle(zoom, standardZoom), ...(heightFix ? { marginBottom: heightFix } : null) }}
        >
```

(`{...undefined}` spreads nothing, so at 100% the `style` attribute is empty; if `getAttribute('style')` then returns `""` rather than `null`, pass `style={Object.keys(merged).length ? merged : undefined}` so Task 5's "no zoom style at 100%" test keeps passing.) Update the comment above the wrapper: "Verified in Chromium, WebKit and Firefox by editor-zoom.spec.ts; engines without standard zoom get a transform (editor-zoom.ts)."

- [ ] **Step 5: Remove the `test.fixme` lines from `editor-zoom.spec.ts` and run all three engines, expect PASS**

Run: `pnpm --filter @crdt/web exec playwright test e2e/editor-zoom.spec.ts --project=chromium --project=webkit --project=firefox`
Then: `pnpm --filter @crdt/web exec playwright test e2e/editor-toolbar.spec.ts -g "zoom"` (Chromium path unchanged).
Prove discrimination: force `hasStandardZoom` to return `true` and re-run the failing engine; its tests fail again; restore.

- [ ] **Step 6: Record it** — in the handoff's deviation table replace the `Zoom target (§12.4)` row's last cell with: "The prototype wins, see Precedence. Engines with standard CSS zoom (`currentCSSZoom`) use `zoom`; others use `transform: scale()` with the width and height corrected (`editor-zoom.ts`). No style at 100%. Verified in Chromium, WebKit and Firefox by `editor-zoom.spec.ts`."

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor-zoom.ts apps/web/test/editor-zoom.test.ts apps/web/src/components/DocumentEditor.tsx apps/web/e2e/editor-zoom.spec.ts docs/design/glass-handoff.md
git commit -m "fix(editor): zoom by transform where CSS zoom is not standard"
```

---

## Final verification (controller)

- `pnpm typecheck`, `pnpm test`, `pnpm --filter @crdt/web build`, `pnpm --filter @crdt/web exec playwright test` (all projects).
- Remove the `// PARKED` line from `editor-type.ts` if it survived Task 1, and grep for stale comments: `grep -rn "PARKED\|not built\|Cmd/Ctrl-click only\|Chromium 153 only" apps/web/src docs/design/glass-handoff.md`.
- Deploying: these are attributes and behaviour, not nodes, so a stale tab cannot delete content; it can drop font attributes from text it edits. Force-refresh open tabs after the deploy, as for every editor change.
