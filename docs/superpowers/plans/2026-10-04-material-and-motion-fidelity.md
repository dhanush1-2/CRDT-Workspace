# Material and Motion Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps between the design owner's full material and motion spec and what is on screen, in the places that need no backend and no new feature: the nav's shape, the focus ring, text selection, presence detail, the glass light strength, the canvas wake-up, and the one missing confirmation message.

**Architecture:** Almost all of this is values in `globals.css` and the component stylesheets. Two items are not: the nav becomes a content-sized centred pill whose width is measured and transitioned (CSS cannot transition `fit-content`), and presence gains an awareness field plus a retention window so a peer who drops fades instead of vanishing.

**Tech Stack:** CSS Modules + custom properties, React 19, `ResizeObserver`, y-protocols awareness, Vitest 5, Playwright.

**Spec:** `docs/design/glass-handoff.md`, plus the design owner's colour/material/geometry/motion spec and interaction spec of 2026-10-04, whose values are quoted inline in each task below.

## Refreshed 2026-10-07 — read this first

Written at `cc14f20` (2026-10-02). Since then, and corrected below:

- **Task 1 is done.** The token migration of 2026-10-03 added `--blur-1: blur(20px) saturate(180%)` (handoff §2), which is exactly the light strength this task introduced as `--glass-blur-light`, and no stylesheet carries the literal any more. Skip it.
- **Task 4 was already marked done** (the content-sized nav, `12f785c`).
- **The "Already correct" list had two values superseded** by later owner decisions (handoff Precedence): the body base is 16px and the editor paragraph 18px. Corrected below; an implementer trusting the old list would have "restored" 15 and 17.
- **`--accent-ring` is `oklch(0.42 0.11 285 / 0.12)`**, not `/ 0.1`. **`--glass-blur` is now `--blur-2`.**
- **The document toolbar** (2026-10-03) added a ribbon of buttons, three list menus, swatch grids, a link popover with its own focused field, and the editor itself — none with a `:focus-visible` rule of its own. Task 2's new global halo reaches all of them; its collision sweep now names them, and the editor must be excluded.
- **Order:** run after `2026-10-03-shell-routing-and-nav.md` (Task 3 edits the document page at its moved path). The visual-corrections plan has run.

## Global Constraints

- **Execute after `2026-10-03-shell-routing-and-nav.md`.** The shell plan's Task 5 (scroll-condense) and Task 7 (760px dropdown) change the nav this plan's presence work renders into, and its Task 2 moves `DocumentClient.tsx`, which Task 3 here edits. The visual-corrections plan this also waited for has run.
- **No backend changes.** No Prisma schema, sync-server or API route edits. The one protocol-adjacent change is an added awareness field, which is CRDT state, not schema.
- **Never widen a shared token to fix one surface.** Add a token when three or more surfaces share a literal; otherwise set the value where it belongs.
- Every colour, radius, duration and easing from a token where one exists. Raw values only where the design gives that literal, with a comment saying so. Existing tokens: `--ease: cubic-bezier(0.32, 0.72, 0, 1)`, `--dur-fast: 0.3s`, `--dur: 0.55s`, `--dur-slow: 0.7s`, `--accent-ring: oklch(0.42 0.11 285 / 0.12)`, `--blur-1: blur(20px) saturate(180%)`, `--blur-2: blur(28px) saturate(190%)`, `--blur-3: blur(30px) saturate(190%)` (full list: handoff §2).
- Pair every `backdrop-filter` with `-webkit-backdrop-filter`. Every animation and transition inside `@media (prefers-reduced-motion: no-preference)`.
- `apps/web/test/css-tokens.test.ts` must keep passing — a `var(--x)` with no definition in `globals.css` fails silently in the browser and this is the only guard.
- Every test proven to discriminate. **Commit before mutating** — `git checkout --` silently does nothing on an untracked file, which has bitten this project.
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build`, `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. **Record the baseline first.** At `f7a5cac` (2026-10-03): Vitest 282 across 40 files, Playwright 157, typecheck clean, 14 routes. The shell plan moves it.
- Postgres on 5433 is shared across checkouts: never start, stop or restart it. Never touch `.env`, `docker-compose.yml` or `docker-compose.override.yml`. Never run any `fly` command. Never use bare `git stash` / `git stash pop`.

## Already correct — do not "fix" these

Checked against the code while writing this plan. Changing them would be a regression:

- All eight keyframes match the spec exactly: `g-in` (14px rise, 6px blur), `g-pop` (−6px, 96%, 4px blur), `g-sheet` (24px, 97%), `g-side` (28px from the right), `g-up` (16px, 96%), `g-pulse` (1.8s to 40% opacity and 80% scale), `g-paint` (50px drift, 12°, 1.08/0.95 scale).
- Typography: `h1` 32/600/−0.025em, `h2` 21/600/−0.02em, `h3` 18/600, body **16**/1.47/−0.01em, editor `h1` 32, `h2` 21, `h3` 18, `p` **18**/1.65. The `.initial` square is 44px at radius 14. (Body 16 and editor `p` 18 are later owner decisions that supersede the spec's 15 and 17; see the handoff's Precedence section.)
- Backdrops: sheets `rgba(30,40,35,.16)` + `blur(8px)`; palette `rgba(30,40,35,.1)` with no blur; dark glass `rgba(28,29,27,.82)` + `blur(24px)`.
- Hover lifts: tiles −2px, cards −3px + 1.01, presence avatars −3px + 1.06, logo −8° + 1.05. Board card entrance `g-in 0.5s`.
- Splat landing: grows from 35% with an overshoot over 0.65s (`easeOutBack`, `LANDING_MS = 650`).
- The six person colours in `lib/color.ts` are exactly the six the spec lists, assigned deterministically.
- The remote caret has **no** 0.7s glide, and that is deliberate, not missing: y-tiptap renders it as a keyed inline widget decoration that ProseMirror re-inserts at a new DOM position, so no `left`/`top` ever changes and a transition on them animates nothing. The long comment in `globals.css` explains it. A real glide needs an overlay positioned from `coordsAtPos`, which is out of scope here.

---

### Task 1: A token for the light glass strength — DONE, by the token migration

The token migration of 2026-10-03 added `--blur-1: blur(20px) saturate(180%)` from handoff §2, which is the light strength this task was going to add as `--glass-blur-light`. `grep -rn "blur(20px) saturate(180%)" apps/web/src` finds only that definition. Nothing to do; do not add a second token for the same value.

---

### Task 2: Focus ring, text selection and press depths

Three small reconciliations, batched: each is a value, none needs the others, and all three live in two files.

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/ui/ui.module.css`
- Modify: `apps/web/src/components/user-menu.module.css`
- Test: `apps/web/e2e/glass-shell.spec.ts`

**Interfaces:**
- Consumes: `--accent-ring` (already defined and already used by `TextField`).
- Produces: `--accent-ring-wide` in `globals.css`.

**The three gaps, with the spec's words:**

| Spec | Now |
|---|---|
| "Focus ring: a 1px violet line plus a 4–5px soft violet halo at 10–15%." | Global `:focus-visible` is `outline: 2px solid var(--accent)` with no halo. The halo exists, but only on `TextField` (`box-shadow: 0 0 0 5px var(--accent-ring)`). |
| "Selected text: a lavender highlight." | No `::selection` rule anywhere. |
| "Buttons … press down to 95%"; "Small round buttons (logo, avatar, ×) press deeper, to 92%." | `.button` presses to 0.96; the user-menu avatar to 0.94. The logo is already 0.92. |

- [ ] **Step 1: Write the failing test**

Add to `apps/web/e2e/glass-shell.spec.ts`:

```ts
test('a focused control carries the violet line and its halo', async ({ page }) => {
  const label = `${LABEL}-focusring`
  const { owner } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto('/')

  // Keyboard focus, not a click: :focus-visible does not match a mouse press on a
  // button, so a test that clicked would assert nothing.
  await page.getByTestId('search').focus()
  const ring = await page.getByTestId('search').evaluate((el) => {
    const style = getComputedStyle(el)
    return { width: style.outlineWidth, shadow: style.boxShadow }
  })

  expect(ring.width).toBe('1px')
  // The halo is a box-shadow spread, which is what makes the ring soft rather than
  // a hard second outline.
  expect(ring.shadow).toContain('5px')

  await cleanup(label)
})

test('selected text is highlighted in lavender, not the browser blue', async ({ page }) => {
  const label = `${LABEL}-selection`
  const { owner } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto('/')

  // ::selection cannot be read from an element's computed style, so read the rule
  // out of the stylesheets the page actually loaded.
  const found = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue // a cross-origin sheet; none of ours are
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText?.includes('::selection')) {
          return rule.style.background || rule.style.backgroundColor
        }
      }
    }
    return null
  })

  expect(found).not.toBeNull()
  expect(found).toContain('300')

  await cleanup(label)
})
```

The `'300'` assertion matches the lavender's hue in `oklch(… 300)`. It is loose on purpose: asserting the whole string would fail on a browser's own serialisation of `oklch`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts -g "focus|selected text"`
Expected: FAIL — outline is 2px, and there is no `::selection` rule.

- [ ] **Step 3: Rewrite the focus ring**

In `globals.css`, replace the `:focus-visible` rule:

```css
/*
  The design's ring: a 1px violet line with a soft violet halo behind it, rather
  than a hard 2px outline. The halo is a box-shadow spread because an outline
  cannot be soft. 10% is --accent-ring; 15% at 5px is the wider variant below.
*/
:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 5px var(--accent-ring-wide);
}
```

and add the token beside `--accent-ring`:

```css
  /* The focus halo. Wider and slightly stronger than --accent-ring, which is the
     resting ring on a focused field. */
  --accent-ring-wide: oklch(0.42 0.11 285 / 0.15);
```

**Watch for collisions.** Some surfaces already set their own `box-shadow`, and this rule would replace it on focus. Grep for `:focus-visible` across the stylesheets before committing: `nav-tabs.module.css` sets `outline-offset: -2px` on `.tab` (keep it — the strip clips its overflow, so an outside ring is cut off; on that element the halo will clip too, which is why the offset is negative and why it is left alone). Any element whose resting `box-shadow` carries meaning — the glass surfaces' shadows — needs its own `:focus-visible` rule that keeps both, written as `box-shadow: <resting>, 0 0 0 5px var(--accent-ring-wide)`. Find them, list them in the report, and fix each.

**The document editor and its toolbar (added after this plan was written):**

- **Exclude the editor.** `.editor .ProseMirror` sets `outline: none` (`globals.css`, ~line 300) because a ring around the whole page is not a focus indicator for text; the caret is. The new rule's `box-shadow` would put a 5px halo around the entire document whenever it takes keyboard focus. Add, beside that rule: `.editor .ProseMirror:focus-visible { box-shadow: none; }`, and a test in `editor-toolbar.spec.ts` that tabs into the editor and asserts its computed `box-shadow` is `none`.
- **Sweep `editor-toolbar.module.css`.** The tool buttons, the Style/Font/Size field triggers, the swatches, the menu rows, the link popover's Add/Remove buttons and its field (§12.6: "focus is accent + ring", which the field already draws itself) all take the global ring. Any that carries a resting `box-shadow` — the field triggers, the menu panel's rows if they have one — needs the two-shadow form above. The swatch grid is a dense 6-column grid; check that a 5px halo on one swatch does not cover its neighbours, and if it does, give swatches `box-shadow: 0 0 0 2px var(--accent-ring-wide)` instead and say so in the report.
- **The link bubble** (`LinkBubble.tsx`, if `2026-10-07-document-gaps.md` has run) has an accent Open button with no shadow; the global rule is fine there.

- [ ] **Step 4: Add text selection**

In `globals.css`, after the `body` rule:

```css
/* The design's lavender selection, the same hue as the message dot. */
::selection {
  background: oklch(0.78 0.12 300 / 0.35);
}
```

A raw value, not a token: it is used once. If the message dot's lavender lands in a later plan, both become `--lavender`.

- [ ] **Step 5: Correct the two press depths**

`ui.module.css`: `.button:active:not(:disabled)` → `transform: scale(0.95)`, with the comment that 0.95 is the design's figure for wide buttons.
`user-menu.module.css`: the avatar trigger's `:active` → `transform: scale(0.92)`, matching the logo, because the design groups small round controls together.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts`
Expected: PASS.

- [ ] **Step 7: Prove the tests discriminate**

Commit first. Then set the outline back to `2px` and re-run: the ring test fails on width. Delete the `::selection` rule and re-run: the selection test fails with `null`. Restore both.

Also check by eye, at the dev server, that a focused Share button, a focused tab and a focused text field each show one thin violet line with a soft halo and no doubled ring. Note what you saw.

- [ ] **Step 8: Run the full gate and commit**

```bash
git add apps/web
git commit -m "fix(a11y): the design's 1px focus line with a soft halo, lavender selection, two press depths"
```

---

### Task 3: Presence says what people are doing, and fades them when they go

Two spec lines, one mechanism: `Hover lifts an avatar and shows "Name · editing/viewing"`, and `people who drop offline fade to 35% instead of disappearing, so you know they were there`.

**Files:**
- Modify: `apps/web/src/hooks/use-presence.ts`
- Modify: `apps/web/src/lib/doc-state.ts`
- Modify: `apps/web/src/app/workspaces/[id]/documents/[docId]/DocumentClient.tsx` (its path after the shell plan; `app/documents/[id]/DocumentClient.tsx` before)
- Modify: `apps/web/src/components/NavPresence.tsx`
- Modify: `apps/web/src/components/app-shell.module.css`
- Test: `apps/web/test/doc-state.test.ts`, `apps/web/e2e/collaboration.spec.ts`

**Interfaces:**
- Consumes: `publishDocState`, `DocPeer` from `@/lib/doc-state`.
- Produces:
  - `PresenceUser` gains `mode: 'editing' | 'viewing'`
  - `DocPeer` gains `mode: 'editing' | 'viewing'` and `gone: boolean`
  - `useAnnouncePresence(provider, user, mode)` — third argument required
  - `PEER_LINGER_MS = 10_000`

**My decision, flagged:** the spec says a departed peer fades but does not say for how long. A peer retained forever turns the nav into a graveyard. **Ten seconds**, then removed. If that reads wrong on screen, the number is one constant.

- [ ] **Step 1: Write the failing store test**

Add to `apps/web/test/doc-state.test.ts`:

```ts
it('a change to a peer\'s mode alone notifies', () => {
  // The lesson from cardId: a field the equality gate does not compare is a field
  // that silently goes stale. mode is in DocPeer, so it must be in same().
  const peer = { clientId: 1, name: 'A', color: '#f00', gone: false }
  publishDocState({
    documentId: 'doc-1',
    status: 'connected',
    peers: [{ ...peer, mode: 'editing' as const }],
  })

  let notified = 0
  const unsubscribe = subscribeDocState(() => (notified += 1))
  publishDocState({
    documentId: 'doc-1',
    status: 'connected',
    peers: [{ ...peer, mode: 'viewing' as const }],
  })

  expect(notified).toBe(1)
  expect(getDocState().peers[0]!.mode).toBe('viewing')
  unsubscribe()
  clearDocState('doc-1')
})

it('a change to a peer\'s gone flag alone notifies', () => {
  const peer = { clientId: 1, name: 'A', color: '#f00', mode: 'editing' as const }
  publishDocState({ documentId: 'doc-2', status: 'connected', peers: [{ ...peer, gone: false }] })

  let notified = 0
  const unsubscribe = subscribeDocState(() => (notified += 1))
  publishDocState({ documentId: 'doc-2', status: 'connected', peers: [{ ...peer, gone: true }] })

  expect(notified).toBe(1)
  unsubscribe()
  clearDocState('doc-2')
})
```

Follow the file's existing import list and helper style rather than inventing one.

- [ ] **Step 2: Write the failing e2e test**

Add to `apps/web/e2e/collaboration.spec.ts`:

```ts
test('an avatar says what that person is doing, and lingers faded when they leave', async ({
  browser,
}) => {
  const label = `${LABEL}-presence-detail`
  const { owner, workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, documentPath(document))
  await openAs(contextB, viewer.id, documentPath(document))

  // The viewer is read-only, so the owner's nav must say "viewing", not "editing".
  const avatar = avatar(pageA, 'Vera')
  await expect(avatar).toBeVisible()
  await expect(avatar).toHaveAttribute('title', 'Vera · viewing')
  await expect(avatar).toHaveAccessibleName('Vera · viewing')

  await contextB.close()

  // Still there, dimmed. Disappearing outright loses the fact that they were here.
  await expect(avatar).toHaveAttribute('data-gone', 'true')
  await expect.poll(async () => Number(await avatar.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeLessThan(0.5)

  // And gone for good after the linger window.
  await expect(avatar).toHaveCount(0, { timeout: 15_000 })

  await contextA.close()
  await cleanup(label)
})
```

`documentPath` and the three-argument `openAs` come from the shell plan; before it runs, use `/documents/${document.id}`. Rename the local `avatar` constant — it shadows the file's `avatar()` helper.

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @crdt/web exec vitest run test/doc-state.test.ts` and the Playwright file.
Expected: FAIL — `mode` and `gone` are not on the types.

- [ ] **Step 4: Announce the mode**

In `use-presence.ts`:

```ts
export interface PresenceUser {
  clientId: number
  name: string
  color: string
  cardId: string | null
  mode: 'editing' | 'viewing'
}
```

In `read()`, alongside `cardId`:

```ts
      // Default 'editing': an older client that does not announce a mode is far
      // more likely to be an editor than a viewer, and the field is advisory.
      mode: (state as { mode?: 'editing' | 'viewing' }).mode === 'viewing' ? 'viewing' : 'editing',
```

and `useAnnouncePresence` takes the mode:

```ts
export function useAnnouncePresence(
  provider: WebsocketProvider | null,
  user: { name: string; color: string },
  mode: 'editing' | 'viewing',
): void {
  useEffect(() => {
    if (!provider) return
    provider.awareness.setLocalStateField('user', user)
    provider.awareness.setLocalStateField('mode', mode)
    return () => provider.awareness.setLocalState(null)
  }, [provider, user.name, user.color, mode])
}
```

`DocumentClient` passes `readOnly ? 'viewing' : 'editing'`.

- [ ] **Step 5: Retain departed peers**

`DocPeer` gains both fields, and `same()` compares both — otherwise the nav keeps a stale label or a stale fade:

```ts
export type DocPeer = {
  clientId: number
  name: string
  color: string
  mode: 'editing' | 'viewing'
  /** Announced as absent from awareness, still shown faded until the linger expires. */
  gone: boolean
}
```

```ts
    a.peers.every((peer, i) => {
      const other = b.peers[i]!
      return (
        peer.clientId === other.clientId &&
        peer.name === other.name &&
        peer.color === other.color &&
        peer.mode === other.mode &&
        peer.gone === other.gone
      )
    })
```

The retention itself belongs in `DocumentClient`, which is where awareness meets the store. Awareness removes a peer's state on disconnect, so the departed set has to be remembered outside it:

```ts
/**
 * How long a peer stays in the nav, faded, after awareness drops them. The design
 * fades them rather than removing them so you can see that someone was here; this is
 * how long "was here" lasts.
 */
const PEER_LINGER_MS = 10_000

// … inside DocumentClient

const lingering = useRef(new Map<number, { peer: DocPeer; until: number }>())
const [, bumpLinger] = useState(0)

// `presence` is the live set. Anything in `lingering` and not in it is shown faded.
const peers = useMemo(() => {
  const now = Date.now()
  const live = new Map(
    presence.map((peer) => [
      peer.clientId,
      { clientId: peer.clientId, name: peer.name, color: peer.color, mode: peer.mode, gone: false },
    ]),
  )

  for (const [clientId, entry] of lingering.current) {
    if (live.has(clientId)) {
      lingering.current.delete(clientId)
      continue
    }
    if (entry.until <= now) {
      lingering.current.delete(clientId)
      continue
    }
    live.set(clientId, { ...entry.peer, gone: true })
  }

  for (const [clientId, peer] of live) {
    if (!peer.gone) lingering.current.set(clientId, { peer, until: now + PEER_LINGER_MS })
  }

  return [...live.values()].sort((a, b) => a.clientId - b.clientId)
}, [presence])
```

The linger expiry needs a timer, or a peer stays faded until something else re-renders:

```ts
// One timer, only while someone is lingering. A permanent interval would re-render
// the nav every second forever on a page where nobody has left.
useEffect(() => {
  if (!peers.some((peer) => peer.gone)) return
  const timer = setTimeout(() => bumpLinger((n) => n + 1), 1000)
  return () => clearTimeout(timer)
}, [peers])
```

Export `PEER_LINGER_MS` so the test can reference it rather than hard-coding 10 seconds in two places.

- [ ] **Step 6: Render both**

`NavPresence.tsx`:

```tsx
        <span
          key={peer.clientId}
          className={`${styles.avatar} ${peer.gone ? styles.avatarGone : ''}`}
          style={{ background: peer.color }}
          // The design's hover text. The accessible name carries it too: a title
          // alone is unavailable to a screen reader and to touch.
          title={`${peer.name} · ${peer.mode}`}
          role="img"
          aria-label={`${peer.name} · ${peer.mode}`}
          data-gone={peer.gone}
          data-testid={`presence-${peer.clientId}`}
        >
```

`app-shell.module.css`:

```css
/* A peer who has dropped. The design's figure: faded to 35%, not removed. */
.avatarGone {
  opacity: 0.35;
}

@media (prefers-reduced-motion: no-preference) {
  .avatarGone {
    transition: opacity var(--dur) var(--ease);
  }
}
```

`collaboration.spec.ts` has existing assertions that find avatars by accessible name `'Eddie'` and `'Owner'`. Those names are now `'Eddie · editing'`. Update every one, in the same commit.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @crdt/web exec vitest run && pnpm --filter @crdt/web exec playwright test e2e/collaboration.spec.ts`
Expected: PASS.

- [ ] **Step 8: Prove the tests discriminate**

Commit first. Then:
1. Drop `peer.mode === other.mode` from `same()` and re-run the store tests. Expected: the mode test fails with `notified === 0` — the exact class of bug that kept `cardId` out of this type.
2. Drop `peer.gone === other.gone` and re-run. Expected: the gone test fails the same way.
3. Make the linger window `0` and re-run the e2e test. Expected: the `data-gone` assertion fails because the avatar vanishes immediately.

Restore each.

- [ ] **Step 9: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(presence): say whether a peer is editing or viewing, and fade them when they leave"
```

---

### Task 4: The nav becomes a content-sized centred pill — DONE, NOT AS PLANNED

**Landed on 2026-10-04 in `12f785c`, before this plan ran. Do not implement it.**

This task's premise was wrong. It asserted that "CSS cannot transition `fit-content`"
and built a JS measurement path — a `ResizeObserver` on an inner row, an explicit pixel
width, and a hold-the-transition-until-after-first-paint flag. The design owner then
supplied the native answer: **`interpolate-size: allow-keywords`** on `:root` plus
`transition: width .55s`, which interpolates against intrinsic keywords directly. No
JavaScript, no observer, no measurement.

What shipped, and what to know about it:

- `.navWrap` is a centred flex column, so the bar and the floating pills beneath it all
  centre. `.nav` is `width: fit-content; max-width: 100%`.
- `.strip` and `.tabsSlot` are `flex: 0 1 auto`. This is load-bearing: the bar sizes
  itself to that row, so a growing child makes the bar grow to the window.
- The dashboard's slot gained its "Workspaces" label here rather than in the shell
  plan, because a content-sized bar turns an unlabelled spacer into a visible hole.
  **The shell plan's Task 4 no longer needs to add it.**
- `interpolate-size` is Chrome 129+ and Edge; elsewhere the width jumps, which is still
  correct. Unverified in a browser that lacks it.
- The width animation only plays for changes *within* a page. Across a navigation the
  bar is a new node, so it cannot animate — the shared-layout restructure fixes that,
  exactly as it fixes the sliding indicator.

### Task 5: The canvas wakes up

The spec: `On a fresh load, the first three splats land 0.3s, 1.0s and 1.7s in, so the page wakes up gradually.`

Today every splat is born mid-life — `start: now - random.range(0, splat.life)` — so the canvas is fully painted at the first frame and nothing visibly lands.

**Files:**
- Modify: `apps/web/src/components/PaintSplatter.tsx`
- Test: `apps/web/test/splatter-wake.test.ts` (new)

**Interfaces:**
- Consumes: `makeSplat`, `splatCount` from `@/lib/splatter/geometry`.
- Produces: `WAKE_DELAYS_MS = [300, 1000, 1700]`.

**The trade-off, and my ruling.** Staggering *every* splat means an almost-empty canvas for the first several seconds — the page would look broken, not calm. The mid-life birth exists precisely to avoid that. So: **keep the mid-life birth for all but three**, and give exactly three a future start time so they land visibly at 0.3s, 1.0s and 1.7s. That satisfies "the page wakes up gradually" without the canvas ever looking unpainted. If the owner wants the whole field staggered, the constant is one array.

- [ ] **Step 1: Write the failing test**

The lifecycle is inside an effect with a canvas, so test the scheduling decision rather than the renderer. Extract it first as a pure function, then test that.

Create `apps/web/test/splatter-wake.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { WAKE_DELAYS_MS, startTimeFor } from '../src/components/splatter-wake.js'

describe('splat start times', () => {
  it('gives the first three a future start, so they land visibly', () => {
    const now = 1000
    expect(startTimeFor(0, now, 20_000)).toBe(now + WAKE_DELAYS_MS[0]!)
    expect(startTimeFor(1, now, 20_000)).toBe(now + WAKE_DELAYS_MS[1]!)
    expect(startTimeFor(2, now, 20_000)).toBe(now + WAKE_DELAYS_MS[2]!)
  })

  it('births the rest mid-life, so the canvas is never visibly empty', () => {
    const now = 1000
    // Deterministic stand-in for the seeded PRNG: always the midpoint.
    const start = startTimeFor(3, now, 20_000, () => 0.5)
    expect(start).toBe(now - 10_000)
    expect(start).toBeLessThan(now)
  })

  it('is exactly three, whatever the count', () => {
    const now = 0
    const future = [0, 1, 2, 3, 4, 5].filter((i) => startTimeFor(i, now, 20_000, () => 0.5) > now)
    expect(future).toEqual([0, 1, 2])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Extract and implement**

Create `apps/web/src/components/splatter-wake.ts`:

```ts
/**
 * When the first splats land on a fresh load. The design wants the page to wake up
 * gradually rather than arrive fully painted.
 */
export const WAKE_DELAYS_MS = [300, 1000, 1700] as const

/**
 * The `start` timestamp for the splat at `index`.
 *
 * Only the first three are given a future start. Staggering the whole field would
 * leave the canvas visibly empty for several seconds, which reads as a page that
 * failed to load rather than one waking up; every other splat is therefore born
 * somewhere inside its own life, as before, so the field is already there.
 */
export function startTimeFor(
  index: number,
  now: number,
  life: number,
  random: () => number = Math.random,
): number {
  const delay = WAKE_DELAYS_MS[index]
  if (delay !== undefined) return now + delay
  return now - random() * life
}
```

In `PaintSplatter.tsx`, replace the `start:` line in `build()` with `start: startTimeFor(i, now, splat.life, () => random.range(0, 1))`.

Check what the renderer does with a `start` in the future before committing: the landing progress is `(now - start) / LANDING_MS`, which goes negative. Clamp it so a not-yet-landed splat draws nothing rather than at a negative scale:

```ts
        const age = time - p.start
        if (age < 0) continue
```

Find the real variable names in the draw loop and use them; do not guess.

- [ ] **Step 4: Run the test and look at it**

Run the unit test, then open the dev server and hard-reload. You should see a painted field with three splats landing in the first two seconds. Confirm no flash of empty canvas and no splat drawn inside-out. Note what you saw.

- [ ] **Step 5: Prove it discriminates**

Commit first. Remove the `WAKE_DELAYS_MS` branch so every splat is mid-life, and re-run: the first test fails. Then remove the `age < 0` guard and reload the page: report whether anything visibly breaks, since that is the guard's whole purpose.

- [ ] **Step 6: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(canvas): the first three splats land after load, so the page wakes up"
```

---

### Task 6: "Created {workspace}"

The spec's dashboard: `Enter creates the workspace and shows a confirmation message.` The toast primitive exists and is used by the share sheet; this is the only other message in the spec that needs no backend work.

**Files:**
- Modify: `apps/web/src/app/CreateWorkspaceForm.tsx`
- Test: `apps/web/e2e/glass-shell.spec.ts`

**Interfaces:**
- Consumes: the toast hook from `@/components/ui/Toast` — read `ShareSheet.tsx` for how it is obtained and called.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```ts
test('creating a workspace confirms it by name', async ({ page }) => {
  const label = `${LABEL}-created`
  const { owner } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto('/')

  const name = `${label}-fresh`
  // Enter, not a button: the design's create tile is an input you press Enter in.
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-name').press('Enter')

  await expect(page.getByTestId('toast')).toHaveText(`Created ${name}`)

  await cleanup(label)
  await cleanup(name)
})
```

Read `CreateWorkspaceForm.tsx` and `share-sheet.spec.ts` for the actual input testid and the actual toast testid before writing them.

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — no toast appears.

- [ ] **Step 3: Raise the toast**

Call the toast with `` `Created ${name}` `` **after** the create request succeeds and before or alongside the navigation, capturing the name into a local first — the input is cleared or the component unmounts on success, and reading state afterwards gives an empty string. Match `ShareSheet`'s pattern for where the call sits relative to the await.

- [ ] **Step 4: Prove it discriminates**

Commit first. Move the toast call above the `await` so it fires before the request, then make the request fail (point it at a bad path temporarily) and confirm the toast still appears — that is the bug the ordering avoids. Restore, and verify a failed create raises no toast.

- [ ] **Step 5: Run the full gate and commit**

```bash
git add apps/web
git commit -m "feat(dashboard): confirm a created workspace by name"
```

---

### Task 7: Verify and reconcile the handoff

**Files:**
- Modify: `docs/design/glass-handoff.md`

- [ ] **Step 1: Look at all of it**

At the dev server, at 1600 / 1280 / 1000 / 800: dashboard, workspace, board, document. Keyboard-focus a button, a tab and a field. Select some text. Hard-reload and watch the canvas. Open two browsers and watch an avatar's title, then close one and watch it fade.

- [ ] **Step 2: Write it down**

Add to `## Implementation status`:

- The three glass strengths and their two blur tokens.
- The focus ring's real shape, and every surface that needed its own `:focus-visible` rule to keep its resting shadow.
- `::selection`, with its value.
- Presence: the awareness `mode` field, the hover and accessible-name format, and the 10-second linger with the note that the duration is mine, not the design's.
- The nav: content-sized, centred, width measured and transitioned; the `52vw` strip cap and what it costs; and that `.strip` and `.tabsSlot` must stay `flex: 0 1 auto` or the nav goes full width again. That last one is a trap worth naming, because `flex: 1 1 auto` is the obvious thing to write.
- The canvas wake-up: three staggered splats, the rest mid-life, and why.

Then **delete** from `### Deferred` or `### Known limitations` anything this plan fixed, and leave the remote-caret glide where it is, because it is still a deliberate deviation.

- [ ] **Step 3: Commit**

```bash
git add docs/design/glass-handoff.md
git commit -m "docs: record the material and motion fidelity pass"
```

---

## Self-Review

**1. Spec coverage.** Of the owner's material/motion spec, this plan covers every item that needs no backend and no new surface: glass strengths (Task 1), focus ring, selection, press depths (Task 2), presence detail and fade (Task 3), nav shape and breathing (Task 4, which landed early and by a better mechanism), canvas wake-up (Task 5), the created-workspace message (Task 6). The "Already correct" section above lists what was checked and found right, so nobody re-does it.

Deliberately **not** here, with their owners named: amber offline, the pulsing syncing dot, the under-nav offline and syncing pills, the status popover and the "Back online · N synced" message all belong to the connection-states plan, because each needs real connection telemetry rather than a colour. The card sheet, "Has notes" and the selected-card outline belong to the card-notes plan. The history panel, the old-version pill and "Restored version from …" belong to the history-panel plan. The remote caret's glide needs a different mechanism entirely and stays a documented deviation.

**2. Placeholder scan.** Four places defer to the codebase rather than guess, each saying what to do with what it finds: the stylesheet list in Task 1 Step 1; the `:focus-visible` collision survey in Task 2 Step 3; the create-document and create-workspace testids in Tasks 4 and 6; and the draw-loop variable names in Task 5 Step 3. Task 4's second test carries an explicit instruction to adjust the sampling order if the create navigates, and to report what was found.

**3. Type consistency.** `mode: 'editing' | 'viewing'` is the same union on `PresenceUser`, `DocPeer` and `useAnnouncePresence`'s third parameter. `gone: boolean` is on `DocPeer` only — it is derived in `DocumentClient`, not announced, which is why it is absent from `PresenceUser`. Both new `DocPeer` fields are added to `same()` in the same step they are added to the type.

**4. Greenness between tasks.** Every task ends on a green full gate. Task 3 changes existing accessible-name assertions in `collaboration.spec.ts` in the same commit as the names themselves. Task 4 moves the `height`/`background` transitions out of `.nav` and into `.navAnimated` in one commit, so the shell plan's condense behaviour is never left without its transition.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-04-material-and-motion-fidelity.md`. Run it after the visual-corrections and shell plans.
