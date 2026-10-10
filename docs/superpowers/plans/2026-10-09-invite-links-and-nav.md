# Invite Links and a Workspaces Nav Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visible "Workspaces" link in the nav, and owners can invite an email that has no account yet: they get a link to send themselves, the link works only for that email, and it lands the invitee in the document (or workspace) it was sent from.

**Architecture:** A new `Invitation` table (additive migration) holds pending invitations by SHA-256 token hash only. The existing members route creates one when the email has no user; three new owner-only routes list, re-issue and revoke. A pure module handles tokens and emails; a server module does every database step, including the single `resolveInvite` decision the public `/invite/[token]` page renders from. The OAuth callback accepts a user's pending invitations as they sign in. The share sheet shows the new link, a Copy link control and an owner-only Invited list.

**Tech Stack:** Next.js 16.3.5 App Router (forced `--webpack`), React 19.3, Prisma 7.10 with `@prisma/adapter-pg`, Zod 4.6, Node `crypto`, Vitest 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-09-invite-links-and-nav-design.md` (approved by Dhanush, 2026-10-09). Visual authority: `docs/design/glass-handoff.md` §5.3, §5.5, §7, §14, §16, and its Precedence section. Read both before your task.

## Global Constraints

- **Never edit `.env`, `docker-compose.yml` or `docker-compose.override.yml`.**
- **Never start, stop or restart the Postgres on port 5433** (it is shared across checkouts) **and never touch the Postgres on 5432** (it is not ours; never guess its credentials). Never start, stop or restart Docker.
- **Never run any `fly` command.**
- **Never use bare `git stash` / `git stash pop`.** The stash stack is shared with other worktrees and sessions.
- **Never stage `README.md`** (the owner's uncommitted edit) **or `CRDT workspace design.zip`.** Stage files by explicit path only; never `git add -A`, `git add .` or `git commit -a`. If a dev server or build modifies `apps/web/next-env.d.ts` or `apps/web/AGENTS.md`, restore it with `git checkout -- <file>` and never stage it.
- **Each route under `workspaces/[id]` does its own auth check**: `requireUser()` then `requireWorkspaceRole(...)` inside that route's own handler, API routes and pages alike. A layout is never a gate, and no route relies on another route's check.
- **Every test must be shown to discriminate**: run it against the unchanged code and watch it fail, or mutate the fix and watch it fail. **Commit before mutating**, and restore with `git checkout -- <file>` (tracked files only; it silently does nothing to an untracked file). Say in the task report which way each test was proven.
- **e2e cleanup is per label**: each Playwright test seeds under its own `label` (`${LABEL}-something`), calls `cleanup(label)` (and `cleanup()` for every other label it seeded) at its end, and the file calls `cleanup(LABEL)` in `test.afterAll`. Invitations are removed by the workspace cascade; any user a test creates must have an email containing `${label}-` so `cleanup` finds it.
- **Deployment: the production Neon migration must be run before pushing.** Render deploys do not run migrations, so code that queries `Invitation` must never reach Render before the table exists. **Do not push.** The owner runs `prisma migrate deploy` against Neon's direct connection string himself, then pushes. No task applies a migration anywhere except the local database on 5433.
- **Applying the migration locally is a side effect on a shared database.** It is additive (one new table), so other checkouts on older code are unaffected, but say so in the Task 2 report. Use `prisma migrate deploy` locally, never `migrate dev` or `migrate reset`: `deploy` never prompts and never resets. If anything offers to reset, stop and report.
- **The token never appears in logs, analytics, or any URL other than the invite link.** Never `console.log` a token, a link, or a request body that holds one. Never put a token in a query string. Responses that carry a token send `cache-control: no-store`. The one place the invite path travels is `next=/invite/<token>` on our own OAuth start route, which stores it in the signed flow cookie and never sends it to a provider (see Decisions). The invite page sends `Referrer-Policy: no-referrer`.
- **Emails are compared and stored trimmed and lowercased**, through `normalizeEmail` from `apps/web/src/lib/invite-token.ts`.
- **An invitation never changes an existing member's role**, up or down.
- **`apps/web/src/lib/invite-token.ts` and `apps/web/src/lib/invitations.ts` use relative `.js` imports only, never the `@/` alias, and import types with `import type`.** `e2e/fixtures.ts` imports them, and Playwright does not resolve the app's alias.
- **Next.js here is not the one you know.** Read `apps/web/AGENTS.md`, and the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing page, metadata or route-handler code. `params` is a `Promise`; `redirect()` throws and stays outside any `try/catch`.
- **Tokens:** every colour, radius, duration and easing from `apps/web/src/app/globals.css` where one exists (`--text`, `--text-2`, `--text-muted`, `--text-faint`, `--accent`, `--accent-text`, `--accent-tint`, `--accent-ring`, `--field-border`, `--line`, `--dash`, `--r-pill`, `--r-card`, `--dur-fast`, `--ease`, ...). A raw value only where the design gives a literal, with a comment. Every transition inside `@media (prefers-reduced-motion: no-preference)`. `apps/web/test/css-tokens.test.ts` must keep passing. Record every deviation from `docs/design/glass-handoff.md` in that file, as the task says.
- **Full gate per task:** `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`. **Task 1 records the baseline first** (Vitest test count, Playwright test count, and the route count `next build` prints) and every later report compares against it. Task 5 adds three API routes and Task 7 one page, so the route count rises by 3 and then 1. Known flake: collaboration "formatting made in one browser appears in the other" may fail once; rerun it alone 3 times and report.
- Integration tests are named `*.integration.test.ts`, talk to the real database, and never mock Prisma. Unit tests do not touch the database.

## Decisions made in this plan

The spec left one choice open and was silent or self-contradictory in a few places. Each decision below is binding on the tasks.

**Copy link: option 1, re-issue.** Only a token's hash is stored, so a link cannot be rebuilt from the database. Copy link in the Invited list asks the server for a fresh token (`POST .../invitations/[invitationId]/link`): the new hash replaces the old one and the expiry resets to 14 days. The sheet puts the new link in its link field, copies it, and the toast says "New link copied for {email}. The old link no longer works." A standing note under the list says the same before anyone clicks. Reasons: the spec prefers option 1 unless it misleads, and the labelling keeps it honest; it needs no new secret (option 2 would need an encryption key on Render and in every checkout, a rotation story, and would turn a database leak plus a key leak into working links); and the one cost, an earlier copy of the link dying, is softened because a sign-in with the invited email accepts the invitation even without a link. Immediately after inviting, the browser still holds the link it was just given, so the link panel's own Copy link copies that same link and re-issues nothing.

**The sign-in path accepts first, so the invite page must honour a used link for its own person.** Signing in through the link runs the callback's sweep, which accepts the invitation before the browser returns to `/invite/<token>`. Read literally, that page would then say "no longer valid" to the person who just accepted. So a used token, opened by a signed-in user whose email is the invitation's, redirects to the destination. Anyone else gets the plain invalid message; nothing reveals that the link was used.

**`next` on the invite page's sign-in buttons is the invite path.** The spec says both "with `next` set back to this page" and "never placed in a URL other than the invite link itself". The value of `next` is the invite link itself, on our own origin: `/api/auth/oauth/<provider>?next=%2Finvite%2F<token>`. The start route stores it in the HMAC-signed flow cookie; the provider never sees it (only `state`, the PKCE challenge and the callback URL go to the provider). On a failed sign-in, `/login?error=...&next=/invite/<token>` is also our own origin. The invite page sets `referrer: 'no-referrer'` so no `Referer` carries the path anywhere.

**The sweep uses the user's stored email.** "Their verified email" is `User.email`, verified by the provider when the account was created, and the same address the invite page compares. For an identity linked earlier whose provider email has since changed, the new provider email is not used: that keeps the sweep and the page in agreement.

**A sweep failure never fails the sign-in.** It is logged with the error's name and code only (a Prisma message can quote the query, which carries the email); the invitations stay pending, and the next sign-in or the link accepts them.

**The members panel needs no change.** The spec says the workspace page's members panel "posts to the same route". It does not: `MembersPanel.tsx` is read-only and its Manage link opens this same share sheet (`useShare()`), so it inherits everything Task 8 builds.

**The dashboard's "Workspaces" label becomes the link.** Handoff §5.3 row 2 shows a plain "Workspaces" label on the dashboard where the workspace name goes. With the new link directly after the logo, keeping the label would put two "Workspaces" side by side. On `/`, the link is the current page and the label is removed.

**"Current-page styling" is the active tab's text style.** 600 weight in `--accent-text`, with no background. The sliding glass pill (§5.4) belongs to the tab strip and is not drawn on this link. Below 760px the link hides with the workspace name (§5.5); the logo still goes to the dashboard.

**Sentence without a document.** The spec's "<inviter> invited you to <verb> <document title, or the workspace name> in <workspace name>" reads "edit Acme in Acme" when there is no document. Without a document it is "<inviter> invited you to <verb> <workspace name>." If the inviter has deleted their account (`invitedById` is `SetNull`), the inviter is "Someone".

**Expired invitations stay in the Invited list, marked "link expired".** Copy link re-issues and so revives them. Accepted invitations are kept, marked used, and not listed.

**The invalid page is 200 with the same body for every case.** A 404 for unknown tokens and a 200 for revoked ones would say which case applies.

**Two extra indexes.** `Invitation_documentId_idx` and `Invitation_invitedById_idx`, beside the spec's two. Postgres does not index foreign keys, and this repo indexes every one (`Account_userId_idx`, `DocumentUpdate_userId_idx`); without them, deleting a document or a user scans the table.

**The members route keeps its status and adds a discriminant.** Both outcomes are `201`. The body gains `kind: 'member' | 'invitation'`; the member body is otherwise unchanged (`{ kind, userId, role }`).

**Some spec "e2e" items are proven at the route level.** Playwright cannot complete a real GitHub or Google sign-in (`e2e/fixtures.ts` says so; e2e signs in by setting the session cookie). "A new user signs in as that email through the link" and "signing in without the link accepts the pending invite" are proven against the real callback route with a stubbed provider in `oauth-routes.integration.test.ts` (Task 6), exactly as the OAuth flow already is. Playwright covers everything after the session exists: landing in the document with the right role (Task 7).

**The privacy page changes.** It says "change the page when the data changes", and invitations store an email address that may belong to someone with no account. Task 5 adds one bullet.

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/components/AppShell.tsx` | **Modify.** The Workspaces link (Task 1); pass the open document to the sheet (Task 8). |
| `apps/web/src/components/app-shell.module.css` | **Modify.** `.navLink`, `.navLinkCurrent`; remove `.tabsSlot`, `.navContext`. |
| `apps/web/e2e/glass-shell.spec.ts` | **Modify.** Replace the dashboard-label test with the Workspaces-link test. |
| `packages/db/prisma/schema.prisma` | **Modify.** `Invitation` model and back-relations. |
| `packages/db/prisma/migrations/20261009000000_invitations/migration.sql` | **Create.** The additive migration. |
| `packages/db/test/invitation.test.ts` | **Create.** Constraints and referential actions. |
| `apps/web/src/lib/invite-token.ts` | **Create.** Pure: token, hash, shape check, link path, TTL, `normalizeEmail`. |
| `apps/web/src/lib/invite-text.ts` | **Create.** Pure: the invite page's sentence. |
| `apps/web/test/invite-token.test.ts`, `apps/web/test/invite-text.test.ts` | **Create.** Unit tests. |
| `apps/web/src/lib/members.ts` | **Modify.** Client-safe `InvitationView`, `InvitationLinkResult`, `MemberPostResult`. |
| `apps/web/src/lib/invitations.ts` | **Create.** Every database step for invitations, and `resolveInvite`. |
| `apps/web/test/invitations.integration.test.ts` | **Create.** The library against the real database. |
| `apps/web/src/app/api/workspaces/[id]/members/route.ts` | **Modify.** Unknown email: create an invitation. |
| `apps/web/src/app/api/workspaces/[id]/invitations/route.ts` | **Create.** `GET`: pending list. |
| `apps/web/src/app/api/workspaces/[id]/invitations/[invitationId]/route.ts` | **Create.** `DELETE`: revoke. |
| `apps/web/src/app/api/workspaces/[id]/invitations/[invitationId]/link/route.ts` | **Create.** `POST`: re-issue. |
| `apps/web/test/invitation-routes.integration.test.ts` | **Create.** Route tests. |
| `apps/web/src/app/privacy/page.tsx` | **Modify.** One bullet. |
| `apps/web/e2e/auth-flow.spec.ts` | **Modify.** Remove the retired "no account" test (Task 5); assert the existing-user path is unchanged (Task 8). |
| `apps/web/src/app/api/auth/oauth/[provider]/callback/route.ts` | **Modify.** Accept pending invitations on sign-in. |
| `apps/web/test/oauth-routes.integration.test.ts` | **Modify.** Sign-in-accepts tests. |
| `apps/web/src/app/(auth)/ProviderButtons.tsx` | **Create.** The sign-in buttons, shared by `/login` and the invite page. |
| `apps/web/src/app/(auth)/login/page.tsx` | **Modify.** Use `ProviderButtons`. |
| `apps/web/src/app/(auth)/auth.module.css` | **Modify.** `.providerButton`. |
| `apps/web/src/app/(auth)/invite/[token]/page.tsx` | **Create.** The public invite page. |
| `apps/web/src/app/(auth)/invite/[token]/InviteSignOut.tsx` | **Create.** Sign out and stay on the page. |
| `apps/web/src/lib/sign-out.ts` | **Create.** One sign-out call, shared with `UserMenu`. |
| `apps/web/src/components/UserMenu.tsx` | **Modify.** Use `signOut()`. |
| `apps/web/e2e/fixtures.ts` | **Modify.** `invite()` fixture. |
| `apps/web/e2e/invitations.spec.ts` | **Create.** Invite page (Task 7) and share sheet (Task 8) e2e. |
| `apps/web/src/lib/invitations-client.ts` | **Create.** The sheet's fetch calls. |
| `apps/web/src/components/ShareSheet.tsx`, `share-sheet.module.css` | **Modify.** Link panel, Invited list, Copy link, Revoke. |
| `docs/design/glass-handoff.md` | **Modify.** Decisions and deviations (Tasks 1, 7, 8). |

---

### Task 1: The Workspaces link in the nav

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx:77-81` (path reading) and `:313-341` (logo through the tabs slot)
- Modify: `apps/web/src/components/app-shell.module.css:166-186` (`.tabsSlot`, `.navContext`) and `:356-363` (the 760px rule)
- Test: `apps/web/e2e/glass-shell.spec.ts:182-194` (the test "the dashboard nav labels the slot where tabs would be")
- Modify: `docs/design/glass-handoff.md`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a link `data-testid="nav-workspaces"`, text `Workspaces`, `href="/"`, the second child of `<nav data-testid="nav-bar">`, with `aria-current="page"` only when `usePathname() === '/'`. CSS classes `.navLink` and `.navLinkCurrent` in `app-shell.module.css`. Removes `data-testid="nav-context"`, `.tabsSlot` and `.navContext`. Creates the handoff subsection `### Invite links and the Workspaces nav link` that Tasks 7 and 8 append to.

- [ ] **Step 1: Record the baseline**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Record in your report: the Vitest test count, the Playwright test count, and how many routes `next build` lists. Every later task compares against these.

- [ ] **Step 2: Write the failing test**

In `apps/web/e2e/glass-shell.spec.ts`, replace the whole test `'the dashboard nav labels the slot where tabs would be'` (lines 182-194) with:

```ts
test('the Workspaces link follows the logo and marks the dashboard as the current page', async ({
  page,
}) => {
  const label = `${LABEL}-navworkspaces`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.goto(documentPath(document))
  const link = page.getByTestId('nav-workspaces')
  await expect(link).toHaveText('Workspaces')
  await expect(link).toHaveAttribute('href', '/')
  // Away from the dashboard it is an ordinary link. Asserted first: a link that always
  // carried aria-current, or always wore the current style, would pass the checks below.
  await expect(link).not.toHaveAttribute('aria-current')
  await expect(link).toHaveCSS('font-weight', '500')
  // Directly after the logo.
  const firstTwo = await page
    .getByTestId('nav-bar')
    .evaluate((nav) =>
      Array.from(nav.children)
        .slice(0, 2)
        .map((el) => el.getAttribute('aria-label') ?? el.getAttribute('data-testid')),
    )
  expect(firstTwo).toEqual(['All workspaces', 'nav-workspaces'])

  await link.click()
  await expect(page).toHaveURL('/')
  const current = page.getByTestId('nav-workspaces')
  await expect(current).toHaveAttribute('aria-current', 'page')
  await expect(current).toHaveCSS('font-weight', '600')
  // It replaces the plain label the dashboard used to show in that place, rather than
  // doubling it, and there are still no tabs here.
  await expect(page.getByTestId('nav-context')).toHaveCount(0)
  await expect(page.getByTestId('tab-overview')).toHaveCount(0)

  // The logo keeps working.
  await page.goto(documentPath(document))
  await page.getByRole('link', { name: 'All workspaces' }).click()
  await expect(page).toHaveURL('/')

  // Below 760px it hides with the workspace name; the logo is the way home there.
  await page.setViewportSize({ width: 700, height: 800 })
  await expect(page.getByTestId('nav-workspaces')).toBeHidden()

  await cleanup(label)
})
```

`createDocument`, `documentPath`, `seedWorkspace`, `signIn` and `cleanup` are already imported at the top of this file from `./fixtures.js`.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts -g "Workspaces link follows the logo"`
Expected: FAIL, `nav-workspaces` not found.

- [ ] **Step 4: Add the link to AppShell**

In `apps/web/src/components/AppShell.tsx`, replace lines 77-81:

```tsx
  // Read from the path rather than from the doc-state store: the store is populated
  // by the page after it mounts, so the button would pop into the nav a beat after
  // the rest of it.
  const activeDocumentId = activeDocumentIdFrom(usePathname())
  const onDocument = activeDocumentId !== undefined
```

with:

```tsx
  // Read from the path rather than from the doc-state store: the store is populated
  // by the page after it mounts, so the button would pop into the nav a beat after
  // the rest of it. usePathname resolves during the server render too, so the
  // Workspaces link's aria-current is already right in the HTML.
  const pathname = usePathname()
  const activeDocumentId = activeDocumentIdFrom(pathname)
  const onDocument = activeDocumentId !== undefined
  // The dashboard is the one page the Workspaces link points at.
  const onDashboard = pathname === '/'
```

Then replace lines 313-341, from the logo `<Link>` through the end of the tabs/label conditional:

```tsx
            <Link href="/" aria-label="All workspaces">
              <span className={styles.logo} />
            </Link>

            {workspace && (
              <>
                <Link
                  className={styles.workspaceName}
                  href={`/workspaces/${workspace.id}`}
                  title={workspace.name}
                  data-testid="workspace-link"
                >
                  {workspace.name}
                </Link>
                <span className={styles.divider} />
              </>
            )}

            {workspace && documents ? (
              <NavTabs workspaceId={workspace.id} documents={documents} />
            ) : (
              /* No workspace in context, so there are no tabs. The bar is now sized to
                 its contents, so an unlabelled slot here would be a visible hole. */
              <div className={styles.tabsSlot}>
                <span className={styles.navContext} data-testid="nav-context">
                  Workspaces
                </span>
              </div>
            )}
```

with:

```tsx
            <Link href="/" aria-label="All workspaces">
              <span className={styles.logo} />
            </Link>

            {/* The logo was the only way back to the dashboard, and nothing said so. On
                the dashboard this is the current page, and it takes the place of the
                plain "Workspaces" label the bar used to show there. */}
            <Link
              className={`${styles.navLink} ${onDashboard ? styles.navLinkCurrent : ''}`}
              href="/"
              aria-current={onDashboard ? 'page' : undefined}
              data-testid="nav-workspaces"
            >
              Workspaces
            </Link>

            {workspace && (
              <>
                <Link
                  className={styles.workspaceName}
                  href={`/workspaces/${workspace.id}`}
                  title={workspace.name}
                  data-testid="workspace-link"
                >
                  {workspace.name}
                </Link>
                <span className={styles.divider} />
              </>
            )}

            {workspace && documents && <NavTabs workspaceId={workspace.id} documents={documents} />}
```

- [ ] **Step 5: Style it**

In `apps/web/src/components/app-shell.module.css`, replace the `.tabsSlot` and `.navContext` rules and their comments (lines 166-186) with:

```css
/*
  The Workspaces link. Styled as an inactive tab (handoff §5.3 row 3a): 32px high,
  0 14px, 14px/500 in --text-muted, no background of its own. `flex: none` so a tight
  bar shrinks the workspace name and the tab strip, never this label.
*/
.navLink {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--r-pill);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  white-space: nowrap;
}

.navLink:hover {
  color: var(--text);
  text-decoration: none;
}

/* The current page: the active tab's text style. The sliding glass pill (§5.4) belongs
   to the tab strip and is not drawn here. */
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
```

Then replace the last rule in the file (the 760px block, lines 356-363):

```css
/* Below 760px the tabs become one dropdown and the workspace name hides (handoff 5.5).
   The logo still links to the dashboard; the dropdown's Overview entry replaces the name. */
@media (max-width: 760px) {
  .workspaceName,
  .divider {
    display: none;
  }
}
```

with:

```css
/* Below 760px the tabs become one dropdown and the workspace name hides (handoff 5.5).
   The Workspaces link hides with it: the logo still links to the dashboard, and the
   dropdown's Overview entry replaces the name. */
@media (max-width: 760px) {
  .workspaceName,
  .divider,
  .navLink {
    display: none;
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @crdt/web exec playwright test e2e/glass-shell.spec.ts`
Expected: PASS, including "at 760px the nav does not force the page to scroll sideways" and "the nav is a pill sized to its contents and centred". If either of those two fails, report it with the measured numbers; do not loosen their thresholds.

- [ ] **Step 7: Prove the test discriminates**

Commit first (do Step 8, then Step 9's `git add` and `git commit`), then mutate one at a time, rerun the test, watch it fail, and restore with `git checkout -- <file>`:
- In `AppShell.tsx`, `aria-current={onDashboard ? 'page' : undefined}` to `aria-current="page"`: fails at `not.toHaveAttribute('aria-current')`.
- In `app-shell.module.css`, remove `.navLink` from the 760px rule: fails at `toBeHidden`.
- In `app-shell.module.css`, delete the `.navLinkCurrent` rule: fails at `toHaveCSS('font-weight', '600')`.

Then run Step 9's gate on the restored tree.

- [ ] **Step 8: Record the decisions and deviations in the handoff**

In `docs/design/glass-handoff.md`, in the Precedence section, directly after the numbered list of "**Decisions of 2026-10-08 (nav polish and renaming).**" (after its item 5), insert:

```markdown
**Decisions of 2026-10-09 (invite links and a Workspaces nav link).** Made by the owner
after this file was generated, so they win over §5.3 and §14 where they differ. Spec:
`docs/superpowers/specs/2026-10-09-invite-links-and-nav-design.md`; plan:
`docs/superpowers/plans/2026-10-09-invite-links-and-nav.md`.

1. A visible **Workspaces** link follows the logo on every page and goes to the
   dashboard. On the dashboard it is the current page (`aria-current="page"`). The logo
   keeps working.
2. There is no email service. Inviting an email with no account makes a link the owner
   copies and sends themselves.
3. A link works only for the email it was made for. Anyone signed in under another email
   is told who the invite is for.
```

Then, directly before the heading `### Deferred, each needing its own plan`, insert:

```markdown
### Invite links and the Workspaces nav link

`2026-10-09-invite-links-and-nav.md`. One additive migration (`Invitation`), three API
routes and one public page. Decisions 1-3 of 2026-10-09 (Precedence, above).

- **Workspaces link.** `AppShell` renders it directly after the logo
  (`data-testid="nav-workspaces"`), on the dashboard and inside workspaces. On `/` it
  carries `aria-current="page"`, computed from `usePathname()` so it is right in the
  server HTML. The dashboard's old "Workspaces" label (`nav-context`) is gone.

| Where | The design says | Built | Why |
|---|---|---|---|
| §5.3 row 2, on the dashboard | A plain "Workspaces" label where the workspace name goes | The Workspaces link, current, in that place; the label is removed | Decision 1. Two "Workspaces" side by side would read as a fault. |
| Workspaces link position | Not in §5.3 | Directly after the logo, before the workspace name, on every page | Decision 1. |
| Workspaces link style | Not in §5.3 | An inactive tab (row 3a): 32px, `0 14px`, 14px/500 in `--text-muted`. Current: 600 in `--accent-text`, no background | "Styled like the nav's other text items". The sliding glass pill (§5.4) belongs to the tab strip and is not drawn on this link. |
| §5.5 below 760px | The workspace name hides | The Workspaces link hides with it | The logo still goes to the dashboard, and the bar must stay inside the 760px no-overflow test. |
```

- [ ] **Step 9: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: PASS, counts equal to the baseline (one Playwright test replaced, none added). If Step 7 already committed, this gate runs on that commit and nothing more is committed.

```bash
git add apps/web/src/components/AppShell.tsx apps/web/src/components/app-shell.module.css apps/web/e2e/glass-shell.spec.ts docs/design/glass-handoff.md
git commit -m "feat(nav): a Workspaces link after the logo, current on the dashboard

The logo was the only way back to the dashboard and nothing said so. The link
replaces the dashboard's plain Workspaces label rather than doubling it, and hides
below 760px with the workspace name."
```

---

### Task 2: The Invitation table

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261009000000_invitations/migration.sql`
- Test: `packages/db/test/invitation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `prisma.invitation` with fields `id: string` (cuid), `workspaceId: string`, `email: string`, `role: Role`, `documentId: string | null`, `invitedById: string | null`, `tokenHash: string` (unique), `expiresAt: Date`, `acceptedAt: Date | null`, `createdAt: Date`; relations `workspace`, `document` (nullable), `invitedBy` (nullable `User`); compound unique `workspaceId_email`. Back-relations `Workspace.invitations`, `Document.invitations`, `User.invitationsSent`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/invitation.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '../src/index.js'

// A per-run suffix keeps emails, hashes and names unique, so a crashed earlier run
// that skipped cleanup cannot make this one fail on a unique constraint.
const RUN = Date.now().toString(36)
const email = (label: string) => `invitation-schema-${label}-${RUN}@example.com`
const hash = (label: string) => `hash-${label}-${RUN}`
const later = () => new Date(Date.now() + 60_000)

let inviterId: string
let workspaceId: string

beforeAll(async () => {
  inviterId = (await prisma.user.create({ data: { email: email('inviter'), name: 'Inviter' } })).id
  workspaceId = (
    await prisma.workspace.create({ data: { name: `invitation-schema-${RUN}`, ownerId: inviterId } })
  ).id
})

afterAll(async () => {
  // Workspace.ownerId has no foreign key, so deleting users does not remove workspaces.
  await prisma.workspace.deleteMany({
    where: { name: { startsWith: 'invitation-schema-', endsWith: RUN } },
  })
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${RUN}@example.com` } } })
  await prisma.$disconnect()
})

describe('Invitation', () => {
  it('stores a pending invitation with a role and an optional document', async () => {
    const document = await prisma.document.create({
      data: { workspaceId, type: 'doc', title: 'Invited' },
    })
    const row = await prisma.invitation.create({
      data: {
        workspaceId,
        email: email('pending'),
        role: 'viewer',
        documentId: document.id,
        invitedById: inviterId,
        tokenHash: hash('pending'),
        expiresAt: later(),
      },
    })
    expect(row.acceptedAt).toBeNull()
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.role).toBe('viewer')
  })

  it('allows one invitation per email per workspace', async () => {
    await prisma.invitation.create({
      data: { workspaceId, email: email('once'), role: 'editor', tokenHash: hash('once-a'), expiresAt: later() },
    })
    await expect(
      prisma.invitation.create({
        data: { workspaceId, email: email('once'), role: 'viewer', tokenHash: hash('once-b'), expiresAt: later() },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('never lets two invitations share a token hash, even across workspaces', async () => {
    const other = await prisma.workspace.create({
      data: { name: `invitation-schema-other-${RUN}`, ownerId: inviterId },
    })
    await prisma.invitation.create({
      data: { workspaceId, email: email('hash-a'), role: 'editor', tokenHash: hash('shared'), expiresAt: later() },
    })
    await expect(
      prisma.invitation.create({
        data: {
          workspaceId: other.id,
          email: email('hash-b'),
          role: 'editor',
          tokenHash: hash('shared'),
          expiresAt: later(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('outlives its document and its inviter, and goes with its workspace', async () => {
    const inviter = await prisma.user.create({ data: { email: email('leaver'), name: 'Leaver' } })
    const ws = await prisma.workspace.create({
      data: { name: `invitation-schema-cascade-${RUN}`, ownerId: inviter.id },
    })
    const document = await prisma.document.create({
      data: { workspaceId: ws.id, type: 'board', title: 'Doomed' },
    })
    const row = await prisma.invitation.create({
      data: {
        workspaceId: ws.id,
        email: email('orphan'),
        role: 'viewer',
        documentId: document.id,
        invitedById: inviter.id,
        tokenHash: hash('orphan'),
        expiresAt: later(),
      },
    })

    // SetNull, not Cascade: the invitation still works, landing on the workspace and
    // naming no inviter.
    await prisma.document.delete({ where: { id: document.id } })
    await prisma.user.delete({ where: { id: inviter.id } })
    const after = await prisma.invitation.findUnique({ where: { id: row.id } })
    expect(after).not.toBeNull()
    expect(after!.documentId).toBeNull()
    expect(after!.invitedById).toBeNull()

    await prisma.workspace.delete({ where: { id: ws.id } })
    expect(await prisma.invitation.findUnique({ where: { id: row.id } })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @crdt/db exec vitest run test/invitation.test.ts`
Expected: FAIL, `prisma.invitation` is undefined (`Cannot read properties of undefined (reading 'create')`).

- [ ] **Step 3: Change the schema**

In `packages/db/prisma/schema.prisma`, add the back-relation lines to three existing models and append the new model. `User` becomes:

```prisma
model User {
  id              String            @id @default(cuid())
  email           String            @unique
  name            String
  passwordHash    String?
  createdAt       DateTime          @default(now())
  memberships     WorkspaceMember[]
  accounts        Account[]
  updates         DocumentUpdate[]
  invitationsSent Invitation[]
}
```

`Workspace` gains `invitations Invitation[]` after `documents Document[]`. `Document` gains `invitations Invitation[]` after `snapshots DocumentSnapshot[]`. Append at the end of the file:

```prisma
/// A pending invitation to a workspace for an email that has no account yet. Only a
/// SHA-256 hash of the link's token is stored, so a copy of this table opens nothing.
model Invitation {
  id          String    @id @default(cuid())
  workspaceId String
  /// Trimmed and lowercased, as sign-in stores User.email.
  email       String
  role        Role
  /// The document the share sheet was opened from. Accepting lands there.
  documentId  String?
  invitedById String?
  tokenHash   String    @unique
  expiresAt   DateTime
  /// Set when accepted. Accepted rows are kept, marked used.
  acceptedAt  DateTime?
  createdAt   DateTime  @default(now())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  document    Document? @relation(fields: [documentId], references: [id], onDelete: SetNull)
  invitedBy   User?     @relation(fields: [invitedById], references: [id], onDelete: SetNull)

  @@unique([workspaceId, email])
  // The sign-in sweep looks invitations up by email.
  @@index([email])
  // Foreign keys, which Postgres does not index on its own.
  @@index([documentId])
  @@index([invitedById])
}
```

`//` lines are plain comments and may sit between attributes; `///` lines are doc comments and attach to the field below them.

- [ ] **Step 4: Write the migration by hand**

This repo's migrations are hand-named. Create `packages/db/prisma/migrations/20261009000000_invitations/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "documentId" TEXT,
    "invitedById" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE INDEX "Invitation_documentId_idx" ON "Invitation"("documentId");

-- CreateIndex
CREATE INDEX "Invitation_invitedById_idx" ON "Invitation"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_workspaceId_email_key" ON "Invitation"("workspaceId", "email");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

A new table only: no existing table is rewritten or locked beyond the brief foreign-key validation on empty data.

- [ ] **Step 5: Check the SQL against the schema before applying it (read-only)**

Run: `pnpm --filter @crdt/db exec prisma validate`
Run: `pnpm --filter @crdt/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
This reads the local database and prints the SQL Prisma would write to reach the new schema. It must be the statements above (order may differ). If it also prints statements unrelated to `Invitation`, the shared database holds another checkout's changes: stop and report, do not apply.

- [ ] **Step 6: Apply it locally and regenerate the client**

Run: `pnpm --filter @crdt/db exec prisma migrate deploy` then `pnpm --filter @crdt/db run generate`
Then: `pnpm --filter @crdt/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
Expected: exit code 0 (no difference), which proves the hand-written SQL builds exactly the schema. Report that the migration was applied to the shared database on 5433. It is additive, so other checkouts' code is unaffected, but a checkout without this migration folder that later runs `prisma migrate dev` will see an applied migration it does not have and may offer a reset: say so in the report, so nobody accepts one.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @crdt/db exec vitest run test/invitation.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Prove the referential actions discriminate**

The schema's `onDelete` and the SQL's `ON DELETE` must agree, and the test observes the applied SQL. Note in the report that the SQL says `ON DELETE SET NULL` for `documentId` and `invitedById` and `ON DELETE CASCADE` for `workspaceId`, and that the last test observes the row surviving the first two deletes and disappearing with the third. The unique tests fail by construction if either unique index is missing (Step 2 already saw them fail with no table).

- [ ] **Step 9: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: PASS, Vitest count up by 4.

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261009000000_invitations/migration.sql packages/db/test/invitation.test.ts
git commit -m "feat(db): an Invitation table for emails with no account yet

Additive. Only a hash of each link's token is stored. One invitation per email per
workspace; it outlives its document and its inviter (SetNull) and goes with its
workspace. Production needs prisma migrate deploy on Neon before this is pushed."
```

---

### Task 3: Token, email and wording helpers

**Files:**
- Create: `apps/web/src/lib/invite-token.ts`
- Create: `apps/web/src/lib/invite-text.ts`
- Test: `apps/web/test/invite-token.test.ts`, `apps/web/test/invite-text.test.ts`

**Interfaces:**
- Consumes: `Role` from `@crdt/shared/types`.
- Produces, in `apps/web/src/lib/invite-token.ts`:
  - `INVITE_TTL_MS: number` (1_209_600_000, 14 days)
  - `newInviteToken(): { token: string; tokenHash: string }`
  - `hashInviteToken(token: string): string` (SHA-256, lowercase hex, 64 chars)
  - `isWellFormedInviteToken(token: string): boolean` (exactly 43 base64url characters)
  - `inviteLink(token: string): string` (returns `/invite/${token}`)
  - `normalizeEmail(raw: string): string` (trim, lowercase)
- Produces, in `apps/web/src/lib/invite-text.ts`:
  - `describeInvite(invite: { inviterName: string | null; role: Role; documentTitle: string | null; workspaceName: string }): string`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/invite-token.test.ts`:

```ts
import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import {
  INVITE_TTL_MS,
  hashInviteToken,
  inviteLink,
  isWellFormedInviteToken,
  newInviteToken,
  normalizeEmail,
} from '../src/lib/invite-token.js'

describe('invite tokens', () => {
  it('are 32 random bytes as 43 base64url characters, different every time', () => {
    const a = newInviteToken()
    const b = newInviteToken()
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32)
    expect(a.token).not.toBe(b.token)
  })

  it('are stored only as their SHA-256 hash, which is not the token', () => {
    const { token, tokenHash } = newInviteToken()
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(hashInviteToken(token)).toBe(tokenHash)
    expect(tokenHash).not.toContain(token)
  })

  it('hash differently when they differ by one character', () => {
    const { token } = newInviteToken()
    const flipped = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
    expect(hashInviteToken(flipped)).not.toBe(hashInviteToken(token))
  })

  it('pass the shape check only in the shape newInviteToken makes', () => {
    expect(isWellFormedInviteToken(newInviteToken().token)).toBe(true)
    const bad = [
      '',
      'a'.repeat(42),
      'a'.repeat(44),
      `${'a'.repeat(42)}=`,
      `${'a'.repeat(42)}+`,
      `${'a'.repeat(42)}/`,
      `${'a'.repeat(42)}.`,
      ' '.repeat(43),
      '../../etc/passwd',
    ]
    for (const token of bad) expect(isWellFormedInviteToken(token), JSON.stringify(token)).toBe(false)
  })

  it('last 14 days', () => {
    expect(INVITE_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000)
  })

  it('travel only in the invite path', () => {
    expect(inviteLink('abc')).toBe('/invite/abc')
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases, so any capitalisation finds the same invitation', () => {
    expect(normalizeEmail('  Ada@Example.COM \n')).toBe('ada@example.com')
    expect(normalizeEmail('ADA@EXAMPLE.COM')).toBe(normalizeEmail('ada@example.com'))
  })
})
```

Create `apps/web/test/invite-text.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { describeInvite } from '../src/lib/invite-text.js'

const base = { inviterName: 'Ada', documentTitle: 'Launch plan', workspaceName: 'Acme' }

describe('describeInvite', () => {
  it('names the inviter, the role as a verb, the document and its workspace', () => {
    expect(describeInvite({ ...base, role: 'editor' })).toBe('Ada invited you to edit Launch plan in Acme.')
  })

  it('says view and own for the other two roles', () => {
    expect(describeInvite({ ...base, role: 'viewer' })).toBe('Ada invited you to view Launch plan in Acme.')
    expect(describeInvite({ ...base, role: 'owner' })).toBe('Ada invited you to own Launch plan in Acme.')
  })

  it('names the workspace once when the invitation names no document', () => {
    expect(describeInvite({ ...base, documentTitle: null, role: 'editor' })).toBe(
      'Ada invited you to edit Acme.',
    )
  })

  it('says Someone when the inviter has since deleted their account', () => {
    expect(describeInvite({ ...base, inviterName: null, role: 'viewer' })).toBe(
      'Someone invited you to view Launch plan in Acme.',
    )
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @crdt/web exec vitest run test/invite-token.test.ts test/invite-text.test.ts`
Expected: FAIL, cannot resolve `../src/lib/invite-token.js` / `invite-text.js`.

- [ ] **Step 3: Write the token module**

Create `apps/web/src/lib/invite-token.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'

// Pure: no database, no Next. Relative imports only (e2e/fixtures.ts reaches this file
// through invitations.ts, and Playwright does not resolve the '@/' alias).

/** How long an invite link works: 14 days from when it was made, or last re-issued. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000

// 32 random bytes are exactly 43 base64url characters; Node's base64url has no padding.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

/**
 * A new invite token and the hash that is stored for it. The token goes to the owner
 * once, inside the link, and is never stored: the database holds only the hash, so a
 * copy of the database opens no invitation.
 */
export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInviteToken(token) }
}

/**
 * SHA-256, lowercase hex. Unsalted on purpose: the token is 256 random bits, so there is
 * nothing to precompute, and a salt would make lookup by hash impossible.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Rejects anything newInviteToken could not have made, before it reaches the database. */
export function isWellFormedInviteToken(token: string): boolean {
  return TOKEN_SHAPE.test(token)
}

/** An invite link's path. The share sheet makes it absolute on the browser's own origin. */
export function inviteLink(token: string): string {
  return `/invite/${token}`
}

/** How invitations store and compare emails: trimmed and lowercased, as sign-in stores them. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}
```

- [ ] **Step 4: Write the wording module**

Create `apps/web/src/lib/invite-text.ts`:

```ts
import type { Role } from '@crdt/shared/types'

const VERB: Record<Role, string> = { owner: 'own', editor: 'edit', viewer: 'view' }

/**
 * The invite page's first sentence. Without a document it names the workspace once:
 * the spec's "<document title, or the workspace name> in <workspace name>" would read
 * "edit Acme in Acme". An inviter who has deleted their account is "Someone".
 */
export function describeInvite(invite: {
  inviterName: string | null
  role: Role
  documentTitle: string | null
  workspaceName: string
}): string {
  const who = invite.inviterName ?? 'Someone'
  const what =
    invite.documentTitle === null
      ? invite.workspaceName
      : `${invite.documentTitle} in ${invite.workspaceName}`
  return `${who} invited you to ${VERB[invite.role]} ${what}.`
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @crdt/web exec vitest run test/invite-token.test.ts test/invite-text.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Prove they discriminate**

Commit (Step 7), then mutate one at a time, rerun, watch the named test fail, and restore with `git checkout -- <file>`:
- `TOKEN_SHAPE` to `/^[A-Za-z0-9_-]{42,44}$/`: "pass the shape check only..." fails.
- `hashInviteToken` returning `token`: "are stored only as their SHA-256 hash" fails.
- `normalizeEmail` returning `raw.trim()`: the normalizeEmail test fails.
- `describeInvite` always using `${documentTitle} in ${workspaceName}`: "names the workspace once" fails.

- [ ] **Step 7: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add apps/web/src/lib/invite-token.ts apps/web/src/lib/invite-text.ts apps/web/test/invite-token.test.ts apps/web/test/invite-text.test.ts
git commit -m "feat(invites): token, email and wording helpers

A token is 32 random bytes, base64url; only its SHA-256 is ever stored. Emails are
trimmed and lowercased everywhere invitations compare them."
```

---

### Task 4: The invitations library

**Files:**
- Modify: `apps/web/src/lib/members.ts`
- Create: `apps/web/src/lib/invitations.ts`
- Test: `apps/web/test/invitations.integration.test.ts`

**Interfaces:**
- Consumes: Task 2's `prisma.invitation`; Task 3's `INVITE_TTL_MS`, `newInviteToken`, `hashInviteToken`, `isWellFormedInviteToken`, `inviteLink`, `normalizeEmail`; `documentHref(workspaceId: string, documentId: string): string` from `apps/web/src/lib/routes.ts`.
- Produces, in `apps/web/src/lib/members.ts` (client-safe types):
  - `type InvitationView = { id: string; email: string; role: Role; expiresAt: string; expired: boolean }` (`expiresAt` ISO 8601; no token, no hash)
  - `type InvitationLinkResult = { invitation: InvitationView; link: string }` (`link` is the path `/invite/<token>`)
  - `type MemberPostResult = { kind: 'member'; userId: string; role: Role } | ({ kind: 'invitation' } & InvitationLinkResult)`
- Produces, in `apps/web/src/lib/invitations.ts`:
  - `NO_STORE: { readonly 'cache-control': 'no-store' }`
  - `createOrReplaceInvitation(input: { workspaceId: string; email: string; role: Role; documentId: string | null; invitedById: string; now?: Date }): Promise<InvitationLinkResult>`
  - `reissueInvitation(workspaceId: string, invitationId: string, now?: Date): Promise<InvitationLinkResult | null>`
  - `revokeInvitation(workspaceId: string, invitationId: string): Promise<boolean>`
  - `listPendingInvitations(workspaceId: string, now?: Date): Promise<InvitationView[]>`
  - `acceptPendingInvitations(userId: string, now?: Date): Promise<number>`
  - `type InviteSummary = { email: string; role: Role; inviterName: string | null; workspaceName: string; documentTitle: string | null }`
  - `type InviteOutcome = { kind: 'invalid' } | { kind: 'sign-in'; invite: InviteSummary } | { kind: 'mismatch'; invitedEmail: string; signedInEmail: string } | { kind: 'redirect'; to: string }`
  - `resolveInvite(token: string, user: { id: string; email: string } | null, now?: Date): Promise<InviteOutcome>`

- [ ] **Step 1: Add the client-safe types**

Append to `apps/web/src/lib/members.ts`:

```ts
/**
 * A pending invitation as the owner's share sheet sees it. No token and no hash: a link
 * is only ever in the response of the call that made it.
 */
export type InvitationView = {
  id: string
  email: string
  role: Role
  /** ISO 8601. */
  expiresAt: string
  /** Past its expiry when the server answered. Copy link makes a new link and revives it. */
  expired: boolean
}

/** What making a link returns, by inviting someone new or by Copy link. `link` is a path: /invite/<token>. */
export type InvitationLinkResult = { invitation: InvitationView; link: string }

/** POST /api/workspaces/[id]/members: an existing user is added at once; anyone else gets a pending invitation. */
export type MemberPostResult =
  | { kind: 'member'; userId: string; role: Role }
  | ({ kind: 'invitation' } & InvitationLinkResult)
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/test/invitations.integration.test.ts`:

```ts
import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import {
  acceptPendingInvitations,
  createOrReplaceInvitation,
  listPendingInvitations,
  reissueInvitation,
  resolveInvite,
  revokeInvitation,
} from '../src/lib/invitations.js'
import { INVITE_TTL_MS } from '../src/lib/invite-token.js'

const RUN = Date.now().toString(36)
const email = (label: string) => `invite-${label}-${RUN}@example.com`
const tokenOf = (link: string) => link.slice('/invite/'.length)
const longAgo = () => new Date(Date.now() - INVITE_TTL_MS - 60_000)

let owner: { id: string }
let workspaceId: string
let otherWorkspaceId: string
let documentId: string
let documentPath: string

beforeAll(async () => {
  owner = await prisma.user.create({ data: { email: email('owner'), name: 'Olive' }, select: { id: true } })
  workspaceId = (await prisma.workspace.create({ data: { name: `invite-ws-${RUN}`, ownerId: owner.id } })).id
  otherWorkspaceId = (
    await prisma.workspace.create({ data: { name: `invite-other-${RUN}`, ownerId: owner.id } })
  ).id
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId, userId: owner.id, role: 'owner' },
      { workspaceId: otherWorkspaceId, userId: owner.id, role: 'owner' },
    ],
  })
  documentId = (await prisma.document.create({ data: { workspaceId, type: 'doc', title: 'Launch plan' } })).id
  documentPath = `/workspaces/${workspaceId}/documents/${documentId}`
})

afterAll(async () => {
  // Workspace.ownerId has no foreign key; workspaces go first, invitations with them.
  await prisma.workspace.deleteMany({ where: { name: { endsWith: `-${RUN}` } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${RUN}@example.com` } } })
  await prisma.$disconnect()
})

function makeUser(label: string) {
  return prisma.user.create({ data: { email: email(label), name: 'Invitee' }, select: { id: true, email: true } })
}

function invite(
  label: string,
  options: { role?: Role; documentId?: string | null; workspaceId?: string; now?: Date } = {},
) {
  return createOrReplaceInvitation({
    workspaceId: options.workspaceId ?? workspaceId,
    email: email(label),
    role: options.role ?? 'editor',
    documentId: options.documentId === undefined ? documentId : options.documentId,
    invitedById: owner.id,
    now: options.now,
  })
}

async function roleOf(userId: string, inWorkspace = workspaceId) {
  const row = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: inWorkspace, userId } },
    select: { role: true },
  })
  return row?.role ?? null
}

describe('createOrReplaceInvitation', () => {
  it('stores the email trimmed and lowercased, and only a hash of the token', async () => {
    const { invitation, link } = await createOrReplaceInvitation({
      workspaceId,
      email: `  ${email('case').toUpperCase()} `,
      role: 'viewer',
      documentId: null,
      invitedById: owner.id,
    })
    expect(invitation.email).toBe(email('case'))
    expect(link).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/)

    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })
    expect(row.email).toBe(email('case'))
    expect(row.tokenHash).toBe(createHash('sha256').update(tokenOf(link)).digest('hex'))
    // The token itself is nowhere in the row.
    expect(JSON.stringify(row)).not.toContain(tokenOf(link))
  })

  it('expires 14 days after it is made', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z')
    const { invitation } = await invite('ttl', { now })
    expect(invitation.expiresAt).toBe('2026-10-23T12:00:00.000Z')
    expect(invitation.expired).toBe(false)
  })

  it('replaces an earlier invitation for the same email: new link, role and expiry, old link dead', async () => {
    const first = await invite('again', { role: 'viewer' })
    const second = await createOrReplaceInvitation({
      workspaceId,
      email: email('again').toUpperCase(),
      role: 'owner',
      documentId: null,
      invitedById: owner.id,
    })

    expect(second.invitation.id).toBe(first.invitation.id)
    expect(second.link).not.toBe(first.link)
    expect(second.invitation.role).toBe('owner')
    expect(await prisma.invitation.count({ where: { workspaceId, email: email('again') } })).toBe(1)
    expect(await resolveInvite(tokenOf(first.link), null)).toEqual({ kind: 'invalid' })
    expect((await resolveInvite(tokenOf(second.link), null)).kind).toBe('sign-in')
  })
})

describe('resolveInvite', () => {
  it('treats malformed, unknown, expired and revoked tokens exactly alike', async () => {
    const expired = await invite('expired', { now: longAgo() })
    const revoked = await invite('revoked')
    expect(await revokeInvitation(workspaceId, revoked.invitation.id)).toBe(true)

    const tokens = ['', 'not-a-token', '../etc/passwd', 'A'.repeat(43), tokenOf(expired.link), tokenOf(revoked.link)]
    for (const token of tokens) {
      expect(await resolveInvite(token, null), token).toEqual({ kind: 'invalid' })
    }
  })

  it('shows a signed-out visitor who invited them, to what, and as whom', async () => {
    const { link } = await invite('summary', { role: 'viewer' })
    expect(await resolveInvite(tokenOf(link), null)).toEqual({
      kind: 'sign-in',
      invite: {
        email: email('summary'),
        role: 'viewer',
        inviterName: 'Olive',
        workspaceName: `invite-ws-${RUN}`,
        documentTitle: 'Launch plan',
      },
    })
  })

  it('tells someone signed in under another email who it is for, and accepts nothing', async () => {
    const { link, invitation } = await invite('mismatch')
    const other = await makeUser('someone-else')

    expect(await resolveInvite(tokenOf(link), other)).toEqual({
      kind: 'mismatch',
      invitedEmail: email('mismatch'),
      signedInEmail: other.email,
    })
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).acceptedAt).toBeNull()
    expect(await roleOf(other.id)).toBeNull()
  })

  it('accepts for the invited person and sends them to the document, with the invited role', async () => {
    const { link, invitation } = await invite('accept', { role: 'viewer' })
    const invitee = await makeUser('accept')

    expect(await resolveInvite(tokenOf(link), invitee)).toEqual({ kind: 'redirect', to: documentPath })
    expect(await roleOf(invitee.id)).toBe('viewer')
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).acceptedAt).not.toBeNull()

    // The same person opening it again is sent on, not told it is spent...
    expect(await resolveInvite(tokenOf(link), invitee)).toEqual({ kind: 'redirect', to: documentPath })
    // ...and nobody else learns it was ever used.
    expect(await resolveInvite(tokenOf(link), null)).toEqual({ kind: 'invalid' })
    expect(await resolveInvite(tokenOf(link), await makeUser('bystander'))).toEqual({ kind: 'invalid' })
  })

  it('matches the invited email whatever its capitalisation', async () => {
    const { link } = await invite('caps', { role: 'editor' })
    const invitee = await makeUser('caps')
    expect(
      await resolveInvite(tokenOf(link), { id: invitee.id, email: invitee.email.toUpperCase() }),
    ).toEqual({ kind: 'redirect', to: documentPath })
    expect(await roleOf(invitee.id)).toBe('editor')
  })

  it('never changes an existing member role, down or up', async () => {
    const editor = await makeUser('member-editor')
    const viewer = await makeUser('member-viewer')
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: editor.id, role: 'editor' },
        { workspaceId, userId: viewer.id, role: 'viewer' },
      ],
    })
    const down = await invite('member-editor', { role: 'viewer' })
    const up = await invite('member-viewer', { role: 'owner' })

    expect((await resolveInvite(tokenOf(down.link), editor)).kind).toBe('redirect')
    expect((await resolveInvite(tokenOf(up.link), viewer)).kind).toBe('redirect')
    expect(await roleOf(editor.id)).toBe('editor')
    expect(await roleOf(viewer.id)).toBe('viewer')
  })

  it('lands on the workspace when there is no document, or the document was deleted', async () => {
    const plain = await invite('nodoc', { documentId: null })
    expect(await resolveInvite(tokenOf(plain.link), await makeUser('nodoc'))).toEqual({
      kind: 'redirect',
      to: `/workspaces/${workspaceId}`,
    })

    const doomed = await prisma.document.create({ data: { workspaceId, type: 'board', title: 'Doomed' } })
    const gone = await invite('gone', { documentId: doomed.id })
    await prisma.document.delete({ where: { id: doomed.id } })
    expect(await resolveInvite(tokenOf(gone.link), await makeUser('gone'))).toEqual({
      kind: 'redirect',
      to: `/workspaces/${workspaceId}`,
    })
  })

  it('does not accept an expired invitation even for the person it was for', async () => {
    const late = await invite('late', { now: longAgo() })
    const invitee = await makeUser('late')
    expect(await resolveInvite(tokenOf(late.link), invitee)).toEqual({ kind: 'invalid' })
    expect(await roleOf(invitee.id)).toBeNull()
  })
})

describe('reissueInvitation', () => {
  it('makes a new link, resets the expiry, and retires the old link', async () => {
    const now = new Date()
    const first = await invite('reissue', { now: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) })
    const again = await reissueInvitation(workspaceId, first.invitation.id, now)

    expect(again).not.toBeNull()
    expect(again!.link).not.toBe(first.link)
    expect(again!.invitation.id).toBe(first.invitation.id)
    expect(again!.invitation.expiresAt).toBe(new Date(now.getTime() + INVITE_TTL_MS).toISOString())
    expect(await resolveInvite(tokenOf(first.link), null)).toEqual({ kind: 'invalid' })
    expect((await resolveInvite(tokenOf(again!.link), null)).kind).toBe('sign-in')
  })

  it('refuses an invitation from another workspace, and one already accepted', async () => {
    const mine = await invite('reissue-scope')
    expect(await reissueInvitation(otherWorkspaceId, mine.invitation.id)).toBeNull()
    expect((await resolveInvite(tokenOf(mine.link), null)).kind).toBe('sign-in')

    const used = await invite('reissue-used')
    await resolveInvite(tokenOf(used.link), await makeUser('reissue-used'))
    expect(await reissueInvitation(workspaceId, used.invitation.id)).toBeNull()
  })
})

describe('revokeInvitation', () => {
  it('deletes the invitation so its link finds nothing; another workspace cannot', async () => {
    const target = await invite('revoke-scope')
    expect(await revokeInvitation(otherWorkspaceId, target.invitation.id)).toBe(false)
    expect((await resolveInvite(tokenOf(target.link), null)).kind).toBe('sign-in')

    expect(await revokeInvitation(workspaceId, target.invitation.id)).toBe(true)
    expect(await prisma.invitation.findUnique({ where: { id: target.invitation.id } })).toBeNull()
    expect(await resolveInvite(tokenOf(target.link), null)).toEqual({ kind: 'invalid' })
  })
})

describe('listPendingInvitations', () => {
  it('lists pending invitations oldest first, marks expired ones, leaves out accepted ones, and carries no token', async () => {
    // A workspace of its own, so other tests' invitations cannot appear here.
    const listWorkspaceId = (
      await prisma.workspace.create({ data: { name: `invite-list-${RUN}`, ownerId: owner.id } })
    ).id
    await invite('list-pending', { workspaceId: listWorkspaceId, documentId: null })
    await invite('list-stale', { workspaceId: listWorkspaceId, documentId: null, now: longAgo() })
    const used = await invite('list-used', { workspaceId: listWorkspaceId, documentId: null })
    await resolveInvite(tokenOf(used.link), await makeUser('list-used'))

    const list = await listPendingInvitations(listWorkspaceId)
    expect(list.map((i) => [i.email, i.expired])).toEqual([
      [email('list-pending'), false],
      [email('list-stale'), true],
    ])
    expect(Object.keys(list[0]!).sort()).toEqual(['email', 'expired', 'expiresAt', 'id', 'role'])
  })
})

describe('acceptPendingInvitations', () => {
  it('accepts every pending invitation for the email, skips expired ones, and keeps existing roles', async () => {
    const person = await makeUser('sweep')
    const make = async (suffix: string) =>
      (await prisma.workspace.create({ data: { name: `invite-sweep-${suffix}-${RUN}`, ownerId: owner.id } })).id
    const a = await make('a')
    const b = await make('b')
    const c = await make('c')
    await prisma.workspaceMember.create({ data: { workspaceId: a, userId: person.id, role: 'owner' } })
    const base = { email: person.email.toUpperCase(), documentId: null, invitedById: owner.id }
    await createOrReplaceInvitation({ ...base, workspaceId: a, role: 'viewer' })
    await createOrReplaceInvitation({ ...base, workspaceId: b, role: 'editor' })
    const stale = await createOrReplaceInvitation({ ...base, workspaceId: c, role: 'editor', now: longAgo() })

    expect(await acceptPendingInvitations(person.id)).toBe(2)
    expect(await roleOf(person.id, a)).toBe('owner')
    expect(await roleOf(person.id, b)).toBe('editor')
    expect(await roleOf(person.id, c)).toBeNull()
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: stale.invitation.id } })).acceptedAt).toBeNull()

    // Nothing left to accept.
    expect(await acceptPendingInvitations(person.id)).toBe(0)
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @crdt/web exec vitest run test/invitations.integration.test.ts`
Expected: FAIL, cannot resolve `../src/lib/invitations.js`.

- [ ] **Step 4: Write the library**

Create `apps/web/src/lib/invitations.ts`:

```ts
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import {
  INVITE_TTL_MS,
  hashInviteToken,
  inviteLink,
  isWellFormedInviteToken,
  newInviteToken,
  normalizeEmail,
} from './invite-token.js'
import type { InvitationLinkResult, InvitationView } from './members.js'
import { documentHref } from './routes.js'

// Relative imports only, never the '@/' alias: e2e/fixtures.ts imports this file, and
// Playwright does not resolve the app's alias.

/** For any response that carries a token or lists invitations. */
export const NO_STORE = { 'cache-control': 'no-store' } as const

const VIEW_SELECT = { id: true, email: true, role: true, expiresAt: true } as const

function toView(
  row: { id: string; email: string; role: Role; expiresAt: Date },
  now: Date,
): InvitationView {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() <= now.getTime(),
  }
}

const expiryFrom = (now: Date) => new Date(now.getTime() + INVITE_TTL_MS)

/**
 * Stores a pending invitation for an email with no account, or replaces the one that
 * email already has in this workspace: new token, role, document, inviter and expiry,
 * and not accepted. The token's hash changes, so the old link stops working.
 */
export async function createOrReplaceInvitation(input: {
  workspaceId: string
  email: string
  role: Role
  documentId: string | null
  invitedById: string
  now?: Date
}): Promise<InvitationLinkResult> {
  const now = input.now ?? new Date()
  const email = normalizeEmail(input.email)
  const { token, tokenHash } = newInviteToken()
  const fields = {
    role: input.role,
    documentId: input.documentId,
    invitedById: input.invitedById,
    tokenHash,
    expiresAt: expiryFrom(now),
    acceptedAt: null,
  }
  const row = await prisma.invitation.upsert({
    where: { workspaceId_email: { workspaceId: input.workspaceId, email } },
    create: { workspaceId: input.workspaceId, email, ...fields },
    update: fields,
    select: VIEW_SELECT,
  })
  return { invitation: toView(row, now), link: inviteLink(token) }
}

/**
 * Copy link: a fresh token for a pending invitation, with the expiry reset. Only a hash
 * is stored, so the old link cannot be shown again; it stops working instead (the plan's
 * Copy-link decision). Null when this is not a pending invitation of this workspace.
 */
export async function reissueInvitation(
  workspaceId: string,
  invitationId: string,
  now = new Date(),
): Promise<InvitationLinkResult | null> {
  const { token, tokenHash } = newInviteToken()
  const [row] = await prisma.invitation.updateManyAndReturn({
    // Scoped by workspace, so an owner elsewhere cannot re-issue it by id.
    where: { id: invitationId, workspaceId, acceptedAt: null },
    data: { tokenHash, expiresAt: expiryFrom(now) },
    select: VIEW_SELECT,
  })
  return row ? { invitation: toView(row, now), link: inviteLink(token) } : null
}

/** Revoke: delete it, so its link finds nothing. False when there was no such pending invitation here. */
export async function revokeInvitation(workspaceId: string, invitationId: string): Promise<boolean> {
  const { count } = await prisma.invitation.deleteMany({
    where: { id: invitationId, workspaceId, acceptedAt: null },
  })
  return count > 0
}

/** Pending invitations, oldest first. Expired ones are included and marked: Copy link revives them. */
export async function listPendingInvitations(workspaceId: string, now = new Date()): Promise<InvitationView[]> {
  const rows = await prisma.invitation.findMany({
    where: { workspaceId, acceptedAt: null },
    orderBy: { createdAt: 'asc' },
    select: VIEW_SELECT,
  })
  return rows.map((row) => toView(row, now))
}

/**
 * Accepts one invitation for `userId`, atomically. It is marked used only if it is
 * still pending and unexpired (and, from the invite page, still carries this token: a
 * re-issue or a revoke in between wins). Then the membership is inserted with ON
 * CONFLICT DO NOTHING, so someone who is already a member keeps their role. An invite
 * never changes a role, up or down.
 */
async function acceptOne(
  match: { id: string; tokenHash?: string },
  userId: string,
  now: Date,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.invitation.updateManyAndReturn({
      where: { ...match, acceptedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
      select: { workspaceId: true, role: true },
    })
    if (!row) return false
    await tx.workspaceMember.createMany({
      data: [{ workspaceId: row.workspaceId, userId, role: row.role }],
      skipDuplicates: true,
    })
    return true
  })
}

/**
 * Accepts every pending, unexpired invitation for the user's email, on sign-in. The
 * email is the one stored on the user, which a provider verified when the account was
 * made, and the same one the invite page compares. Returns how many were accepted.
 */
export async function acceptPendingInvitations(userId: string, now = new Date()): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user) return 0
  const pending = await prisma.invitation.findMany({
    where: { email: normalizeEmail(user.email), acceptedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  })
  let accepted = 0
  for (const { id } of pending) {
    if (await acceptOne({ id }, userId, now)) accepted += 1
  }
  return accepted
}

export type InviteSummary = {
  email: string
  role: Role
  inviterName: string | null
  workspaceName: string
  documentTitle: string | null
}

export type InviteOutcome =
  | { kind: 'invalid' }
  | { kind: 'sign-in'; invite: InviteSummary }
  | { kind: 'mismatch'; invitedEmail: string; signedInEmail: string }
  | { kind: 'redirect'; to: string }

/**
 * What the invite page shows for a token and the person viewing it, accepting the
 * invitation when that person is the one it is for.
 *
 * Expired, revoked, used and unknown tokens are all `invalid`, carrying nothing about
 * the workspace: the page must not say which case applies, or whether the token ever
 * existed. One exception: a used link opened by the person it was for sends them on.
 * Signing in through the link accepts it (the sign-in sweep) before the browser comes
 * back here, and that person must land in the document, not on "no longer valid".
 */
export async function resolveInvite(
  token: string,
  user: { id: string; email: string } | null,
  now = new Date(),
): Promise<InviteOutcome> {
  if (!isWellFormedInviteToken(token)) return { kind: 'invalid' }
  const tokenHash = hashInviteToken(token)
  const row = await prisma.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      role: true,
      workspaceId: true,
      documentId: true,
      expiresAt: true,
      acceptedAt: true,
      workspace: { select: { name: true } },
      document: { select: { title: true } },
      invitedBy: { select: { name: true } },
    },
  })
  if (!row) return { kind: 'invalid' }

  const destination = row.documentId
    ? documentHref(row.workspaceId, row.documentId)
    : `/workspaces/${row.workspaceId}`
  const isInvitee = user !== null && normalizeEmail(user.email) === row.email

  if (row.acceptedAt !== null) return isInvitee ? { kind: 'redirect', to: destination } : { kind: 'invalid' }
  if (row.expiresAt.getTime() <= now.getTime()) return { kind: 'invalid' }
  if (user === null) {
    return {
      kind: 'sign-in',
      invite: {
        email: row.email,
        role: row.role,
        inviterName: row.invitedBy?.name ?? null,
        workspaceName: row.workspace.name,
        documentTitle: row.document?.title ?? null,
      },
    }
  }
  if (!isInvitee) return { kind: 'mismatch', invitedEmail: row.email, signedInEmail: user.email }

  const accepted = await acceptOne({ id: row.id, tokenHash }, user.id, now)
  return accepted ? { kind: 'redirect', to: destination } : { kind: 'invalid' }
}
```

`updateManyAndReturn` is Prisma 6.2+ on PostgreSQL and accepts `select`. If the generated client's types reject `select` there, read `node_modules/.prisma/client/index.d.ts` for `InvitationUpdateManyAndReturnArgs` and report before changing the approach; do not fall back to `updateMany` plus a separate read, which reopens the race this exists to close.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @crdt/web exec vitest run test/invitations.integration.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Prove they discriminate**

Commit (Step 7), then mutate one at a time, rerun, watch the named test fail, restore with `git checkout -- apps/web/src/lib/invitations.ts`:
- `skipDuplicates: true` removed and `createMany` replaced with an `upsert` whose `update` is `{ role: row.role }`: "never changes an existing member role" fails.
- The `if (row.acceptedAt !== null)` line changed to always return `{ kind: 'invalid' }`: "accepts for the invited person..." fails at the second `resolveInvite`.
- `isInvitee` changed to compare `user.email === row.email` (no normalising): "matches the invited email whatever its capitalisation" fails.
- `acceptedAt: null` removed from the `reissueInvitation` where: "refuses ... one already accepted" fails.
- `workspaceId` removed from the `revokeInvitation` where: "another workspace cannot" fails.

- [ ] **Step 7: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add apps/web/src/lib/members.ts apps/web/src/lib/invitations.ts apps/web/test/invitations.integration.test.ts
git commit -m "feat(invites): create, re-issue, revoke, list and accept invitations

resolveInvite is the invite page's one decision. Every dead link reads the same; a
used link sends its own person on. Accepting never changes an existing role."
```

---

### Task 5: The API: invite by email, list, re-issue, revoke

**Files:**
- Modify: `apps/web/src/app/api/workspaces/[id]/members/route.ts`
- Create: `apps/web/src/app/api/workspaces/[id]/invitations/route.ts`
- Create: `apps/web/src/app/api/workspaces/[id]/invitations/[invitationId]/route.ts`
- Create: `apps/web/src/app/api/workspaces/[id]/invitations/[invitationId]/link/route.ts`
- Test: `apps/web/test/invitation-routes.integration.test.ts`
- Modify: `apps/web/src/app/privacy/page.tsx`
- Modify: `apps/web/e2e/auth-flow.spec.ts:230-243` (remove the retired test)

**Interfaces:**
- Consumes: Task 4's `createOrReplaceInvitation`, `reissueInvitation`, `revokeInvitation`, `listPendingInvitations`, `NO_STORE`, `resolveInvite`; `MemberPostResult`, `InvitationView`, `InvitationLinkResult` from `@/lib/members`; `requireUser`, `requireWorkspaceRole`, `toResponse`, `HttpError` from `@/lib/auth-guard`.
- Produces (HTTP):
  - `POST /api/workspaces/[id]/members` body `{ email: string; role: 'owner'|'editor'|'viewer'; documentId?: string }`. Owner only. Existing user: `201 { kind: 'member', userId, role }` (unchanged apart from `kind`). Unknown email: `201 { kind: 'invitation', invitation: InvitationView, link: string }` with `cache-control: no-store`. A `documentId` not in this workspace: `400 { error: 'invalid document' }`.
  - `GET /api/workspaces/[id]/invitations` → `200 { invitations: InvitationView[] }`, `no-store`. Owner only.
  - `POST /api/workspaces/[id]/invitations/[invitationId]/link` → `200 InvitationLinkResult`, `no-store`; `404` if not a pending invitation of this workspace. Owner only.
  - `DELETE /api/workspaces/[id]/invitations/[invitationId]` → `204`; `404` as above. Owner only.
  - Non-owner member `403`, non-member `404`, signed out `401`, as `requireWorkspaceRole` and `requireUser` already answer.

- [ ] **Step 1: Write the failing route tests**

Create `apps/web/test/invitation-routes.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { cookies } from 'next/headers'
import { prisma } from '@crdt/db'
import { POST as postMember } from '../src/app/api/workspaces/[id]/members/route.js'
import { GET as listRoute } from '../src/app/api/workspaces/[id]/invitations/route.js'
import { DELETE as revokeRoute } from '../src/app/api/workspaces/[id]/invitations/[invitationId]/route.js'
import { POST as linkRoute } from '../src/app/api/workspaces/[id]/invitations/[invitationId]/link/route.js'
import { resolveInvite } from '../src/lib/invitations.js'
import type { InvitationLinkResult, InvitationView, MemberPostResult } from '../src/lib/members.js'
import { signSession, SESSION_COOKIE } from '../src/lib/session.js'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

const RUN = Date.now().toString(36)
const email = (label: string) => `invroute-${label}-${RUN}@example.com`
const tokenOf = (link: string) => link.slice('/invite/'.length)

let owner: { id: string }
let editor: { id: string }
let viewer: { id: string }
let stranger: { id: string }
let workspaceId: string
let strangerWorkspaceId: string
let documentId: string
let strangerDocumentId: string

beforeAll(async () => {
  process.env.SESSION_SECRET = 'session-secret-long-enough-for-invitation-routes!!'
  const make = (label: string) =>
    prisma.user.create({ data: { email: email(label), name: label }, select: { id: true } })
  owner = await make('owner')
  editor = await make('editor')
  viewer = await make('viewer')
  stranger = await make('stranger')

  workspaceId = (await prisma.workspace.create({ data: { name: `invroute-${RUN}`, ownerId: owner.id } })).id
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId, userId: owner.id, role: 'owner' },
      { workspaceId, userId: editor.id, role: 'editor' },
      { workspaceId, userId: viewer.id, role: 'viewer' },
    ],
  })
  documentId = (await prisma.document.create({ data: { workspaceId, type: 'doc', title: 'Plan' } })).id

  // The stranger owns a workspace of their own, so they pass an owner check there.
  strangerWorkspaceId = (
    await prisma.workspace.create({ data: { name: `invroute-stranger-${RUN}`, ownerId: stranger.id } })
  ).id
  await prisma.workspaceMember.create({
    data: { workspaceId: strangerWorkspaceId, userId: stranger.id, role: 'owner' },
  })
  strangerDocumentId = (
    await prisma.document.create({ data: { workspaceId: strangerWorkspaceId, type: 'doc', title: 'Theirs' } })
  ).id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: { endsWith: `-${RUN}` } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${RUN}@example.com` } } })
  await prisma.$disconnect()
})

/** Signs the next route call in as `userId`, or out when null. */
async function as(userId: string | null) {
  const token = userId === null ? null : await signSession(userId, process.env.SESSION_SECRET!)
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (token !== null && name === SESSION_COOKIE ? { value: token } : undefined),
  } as never)
}

function request(method: string, body?: unknown) {
  return new Request('http://localhost/api', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const inWorkspace = (id: string) => ({ params: Promise.resolve({ id }) })
const onInvitation = (id: string, invitationId: string) => ({ params: Promise.resolve({ id, invitationId }) })

async function inviteAsOwner(label: string, role: 'owner' | 'editor' | 'viewer' = 'viewer') {
  await as(owner.id)
  const response = await postMember(request('POST', { email: email(label), role }), inWorkspace(workspaceId))
  const body = (await response.json()) as MemberPostResult
  if (body.kind !== 'invitation') throw new Error(`expected an invitation, got ${JSON.stringify(body)}`)
  return body
}

const NON_OWNERS = () =>
  [
    ['editor', editor.id, 403],
    ['viewer', viewer.id, 403],
    ['stranger', stranger.id, 404],
    ['signed out', null, 401],
  ] as const

describe('POST /api/workspaces/[id]/members', () => {
  it('invites an email with no account: a pending invitation and its link, never cached', async () => {
    await as(owner.id)
    const response = await postMember(
      request('POST', { email: `  ${email('newcomer').toUpperCase()} `, role: 'viewer', documentId }),
      inWorkspace(workspaceId),
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as MemberPostResult
    if (body.kind !== 'invitation') throw new Error('expected an invitation')
    expect(body.link).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/)
    expect(body.invitation).toMatchObject({ email: email('newcomer'), role: 'viewer', expired: false })

    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: body.invitation.id } })
    expect(row).toMatchObject({ workspaceId, documentId, invitedById: owner.id, acceptedAt: null })
  })

  it('refuses a document from another workspace and stores nothing', async () => {
    await as(owner.id)
    const response = await postMember(
      request('POST', { email: email('crossdoc'), role: 'viewer', documentId: strangerDocumentId }),
      inWorkspace(workspaceId),
    )
    expect(response.status).toBe(400)
    expect(await prisma.invitation.count({ where: { email: email('crossdoc') } })).toBe(0)
  })

  it('adds an existing user at once, exactly as before, and stores no invitation', async () => {
    const existing = await prisma.user.create({ data: { email: email('existing'), name: 'Existing' } })
    await as(owner.id)
    const response = await postMember(
      request('POST', { email: existing.email, role: 'editor', documentId }),
      inWorkspace(workspaceId),
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ kind: 'member', userId: existing.id, role: 'editor' })
    expect(await prisma.invitation.count({ where: { email: existing.email } })).toBe(0)
  })

  it('lets only owners invite, and stores nothing for anyone else', async () => {
    for (const [who, userId, status] of NON_OWNERS()) {
      await as(userId)
      const response = await postMember(
        request('POST', { email: email('forbidden'), role: 'owner' }),
        inWorkspace(workspaceId),
      )
      expect(response.status, who).toBe(status)
    }
    expect(await prisma.invitation.count({ where: { email: email('forbidden') } })).toBe(0)
  })
})

describe('GET /api/workspaces/[id]/invitations', () => {
  it('lists pending invitations for owners, with no token or hash in sight', async () => {
    await inviteAsOwner('listed')
    await as(owner.id)
    const response = await listRoute(request('GET'), inWorkspace(workspaceId))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const { invitations } = (await response.json()) as { invitations: InvitationView[] }
    expect(invitations.map((i) => i.email)).toContain(email('listed'))
    expect(JSON.stringify(invitations)).not.toMatch(/tokenHash|\/invite\//)
  })

  it('refuses everyone but owners', async () => {
    for (const [who, userId, status] of NON_OWNERS()) {
      await as(userId)
      expect((await listRoute(request('GET'), inWorkspace(workspaceId))).status, who).toBe(status)
    }
  })
})

describe('POST /api/workspaces/[id]/invitations/[invitationId]/link', () => {
  it('gives an owner a new link and retires the old one', async () => {
    const created = await inviteAsOwner('reissue')
    await as(owner.id)
    const response = await linkRoute(request('POST'), onInvitation(workspaceId, created.invitation.id))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const fresh = (await response.json()) as InvitationLinkResult
    expect(fresh.link).not.toBe(created.link)
    expect(await resolveInvite(tokenOf(created.link), null)).toEqual({ kind: 'invalid' })
    expect((await resolveInvite(tokenOf(fresh.link), null)).kind).toBe('sign-in')
  })

  it('refuses non-owners, and an owner of another workspace naming this invitation', async () => {
    const created = await inviteAsOwner('reissue-refused')
    for (const [who, userId, status] of NON_OWNERS()) {
      await as(userId)
      const response = await linkRoute(request('POST'), onInvitation(workspaceId, created.invitation.id))
      expect(response.status, who).toBe(status)
    }
    await as(stranger.id)
    const sideways = await linkRoute(request('POST'), onInvitation(strangerWorkspaceId, created.invitation.id))
    expect(sideways.status).toBe(404)
    // None of that touched the link.
    expect((await resolveInvite(tokenOf(created.link), null)).kind).toBe('sign-in')
  })
})

describe('DELETE /api/workspaces/[id]/invitations/[invitationId]', () => {
  it('lets an owner revoke, and the link stops working', async () => {
    const created = await inviteAsOwner('revoke')
    await as(owner.id)
    const response = await revokeRoute(request('DELETE'), onInvitation(workspaceId, created.invitation.id))
    expect(response.status).toBe(204)
    expect(await prisma.invitation.findUnique({ where: { id: created.invitation.id } })).toBeNull()
    expect(await resolveInvite(tokenOf(created.link), null)).toEqual({ kind: 'invalid' })
  })

  it('refuses non-owners, and an owner of another workspace naming this invitation', async () => {
    const created = await inviteAsOwner('revoke-refused')
    for (const [who, userId, status] of NON_OWNERS()) {
      await as(userId)
      const response = await revokeRoute(request('DELETE'), onInvitation(workspaceId, created.invitation.id))
      expect(response.status, who).toBe(status)
    }
    await as(stranger.id)
    const sideways = await revokeRoute(request('DELETE'), onInvitation(strangerWorkspaceId, created.invitation.id))
    expect(sideways.status).toBe(404)
    expect(await prisma.invitation.findUnique({ where: { id: created.invitation.id } })).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @crdt/web exec vitest run test/invitation-routes.integration.test.ts`
Expected: FAIL, the three new route modules cannot be resolved.

- [ ] **Step 3: Make the members route invite unknown emails**

Replace the whole of `apps/web/src/app/api/workspaces/[id]/members/route.ts` with:

```ts
import { z } from 'zod'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { requireUser, requireWorkspaceRole, toResponse } from '@/lib/auth-guard'
import { NO_STORE, createOrReplaceInvitation } from '@/lib/invitations'
import type { MemberPostResult } from '@/lib/members'

const Body = z.object({
  // Sign-in stores emails trimmed and lowercased, so the lookup must match that,
  // or inviting "Ada@Example.com" would never find ada@example.com.
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['owner', 'editor', 'viewer']),
  // The document the share sheet was opened from, if any. Only an invitation uses it:
  // accepting one lands there. Ignored when the email already has an account.
  documentId: z.string().min(1).max(64).optional(),
})

/**
 * True if changing `targetUserId`'s role to `nextRole` would leave the workspace with
 * zero owners — i.e. the target is currently the workspace's last remaining owner and
 * `nextRole` is not `owner`. Narrow, partial fix for a workspace being left permanently
 * ownerless: it only blocks this specific self-lockout path. There is deliberately no
 * member-removal route and no confirmation-flag mechanism here — both are tracked
 * separately and out of scope for this change.
 */
export async function wouldLeaveWorkspaceOwnerless(
  workspaceId: string,
  targetUserId: string,
  nextRole: Role,
): Promise<boolean> {
  if (nextRole === 'owner') return false

  const current = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    select: { role: true },
  })
  if (current?.role !== 'owner') return false

  const ownerCount = await prisma.workspaceMember.count({ where: { workspaceId, role: 'owner' } })
  return ownerCount <= 1
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId } = await params
    await requireWorkspaceRole(user.id, workspaceId, 'owner')

    const body = await request.json().catch(() => null)
    const parsed = Body.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const invitee = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    })

    if (!invitee) {
      // Nobody has signed in with this email yet. Store a pending invitation and hand
      // the owner its link to send; inviting the same email again replaces it.
      const documentId = parsed.data.documentId ?? null
      if (documentId !== null) {
        // Both ids, so an invitation can never point into another workspace.
        const document = await prisma.document.findFirst({
          where: { id: documentId, workspaceId },
          select: { id: true },
        })
        if (!document) return Response.json({ error: 'invalid document' }, { status: 400 })
      }
      const created = await createOrReplaceInvitation({
        workspaceId,
        email: parsed.data.email,
        role: parsed.data.role,
        documentId,
        invitedById: user.id,
      })
      const result: MemberPostResult = { kind: 'invitation', ...created }
      // no-store: this body holds the only copy of the token there will ever be.
      return Response.json(result, { status: 201, headers: NO_STORE })
    }

    if (await wouldLeaveWorkspaceOwnerless(workspaceId, invitee.id, parsed.data.role)) {
      return Response.json(
        { error: 'workspace must have at least one owner' },
        { status: 400 },
      )
    }

    const member = await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId: invitee.id } },
      create: { workspaceId, userId: invitee.id, role: parsed.data.role },
      update: { role: parsed.data.role },
      select: { userId: true, role: true },
    })
    const result: MemberPostResult = { kind: 'member', ...member }
    return Response.json(result, { status: 201 })
  } catch (error) {
    return toResponse(error)
  }
}
```

- [ ] **Step 4: Create the list route**

Create `apps/web/src/app/api/workspaces/[id]/invitations/route.ts`:

```ts
import { requireUser, requireWorkspaceRole, toResponse } from '@/lib/auth-guard'
import { NO_STORE, listPendingInvitations } from '@/lib/invitations'

/**
 * Pending invitations, for the share sheet's Invited list. Owners only: only owners can
 * invite, so only owners see who has been invited.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId } = await params
    // This route's own check. Nothing above it gates routes under workspaces/[id].
    await requireWorkspaceRole(user.id, workspaceId, 'owner')

    const invitations = await listPendingInvitations(workspaceId)
    return Response.json({ invitations }, { headers: NO_STORE })
  } catch (error) {
    return toResponse(error)
  }
}
```

- [ ] **Step 5: Create the revoke route**

Create `apps/web/src/app/api/workspaces/[id]/invitations/[invitationId]/route.ts`:

```ts
import { HttpError, requireUser, requireWorkspaceRole, toResponse } from '@/lib/auth-guard'
import { revokeInvitation } from '@/lib/invitations'

/** Revoke a pending invitation. Its link stops working at once. Owners only. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId, invitationId } = await params
    // This route's own check. Nothing above it gates routes under workspaces/[id].
    await requireWorkspaceRole(user.id, workspaceId, 'owner')

    // Scoped by workspace inside revokeInvitation: owning one workspace does not let you
    // revoke another's invitation by id.
    if (!(await revokeInvitation(workspaceId, invitationId))) throw new HttpError(404, 'not found')
    return new Response(null, { status: 204 })
  } catch (error) {
    return toResponse(error)
  }
}
```

- [ ] **Step 6: Create the re-issue route**

Create `apps/web/src/app/api/workspaces/[id]/invitations/[invitationId]/link/route.ts`:

```ts
import { HttpError, requireUser, requireWorkspaceRole, toResponse } from '@/lib/auth-guard'
import { NO_STORE, reissueInvitation } from '@/lib/invitations'

/**
 * Copy link in the Invited list: a fresh link for a pending invitation, with the expiry
 * reset. Only a hash of a token is stored, so the old link cannot be shown again; it
 * stops working instead. Owners only.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId, invitationId } = await params
    // This route's own check. Nothing above it gates routes under workspaces/[id].
    await requireWorkspaceRole(user.id, workspaceId, 'owner')

    const result = await reissueInvitation(workspaceId, invitationId)
    if (!result) throw new HttpError(404, 'not found')
    // no-store: this body holds the only copy of the new token there will ever be.
    return Response.json(result, { headers: NO_STORE })
  } catch (error) {
    return toResponse(error)
  }
}
```

- [ ] **Step 7: Run the route tests to verify they pass**

Run: `pnpm --filter @crdt/web exec vitest run test/invitation-routes.integration.test.ts test/workspace-routes.integration.test.ts`
Expected: PASS. The existing members-route tests in `workspace-routes.integration.test.ts` still pass (they check status codes and rows, not the body).

- [ ] **Step 8: Prove they discriminate**

Commit (Step 11), then mutate one at a time, rerun, watch it fail, restore with `git checkout -- <file>`:
- In the list route, `'owner'` to `'viewer'`: "refuses everyone but owners" fails for editor and viewer.
- In the members route, drop `workspaceId` from the document `findFirst` where: "refuses a document from another workspace" fails.
- In the members route, drop `headers: NO_STORE`: the first test fails on `cache-control`.

- [ ] **Step 9: Retire the e2e test whose behaviour this task changes**

In `apps/web/e2e/auth-flow.spec.ts`, delete the whole test `'inviting an email with no account explains the problem'` (lines 230-243). Inviting an unknown email now makes an invitation instead of an error; Task 8 adds the e2e that replaces it. Until Task 8, the sheet treats the new 201 as "added": expected on this branch, never shipped.

- [ ] **Step 10: Say what invitations store on the privacy page**

In `apps/web/src/app/privacy/page.tsx`, inside the first `<ul>`, after the `<li>` that starts `<strong>Your work:</strong>`, insert:

```tsx
          <li>
            <strong>Invitations:</strong> when a workspace owner invites an email address that
            has no account yet, that address, the role offered and who sent the invite.
            Revoking an invite deletes it.
          </li>
```

- [ ] **Step 11: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: PASS; `next build` lists 3 more routes than the baseline; Playwright one test fewer.

```bash
git add apps/web/src/app/api/workspaces/[id]/members/route.ts apps/web/src/app/api/workspaces/[id]/invitations apps/web/test/invitation-routes.integration.test.ts apps/web/src/app/privacy/page.tsx apps/web/e2e/auth-flow.spec.ts
git commit -m "feat(invites): invite emails with no account; list, re-issue and revoke

The members route stores a pending invitation and returns its link when nobody has
signed in with the email. Owners only, each route checking for itself. Bodies that
carry a token are never cached."
```

Quote the bracketed paths if your shell globs them: `git add 'apps/web/src/app/api/workspaces/[id]/members/route.ts' 'apps/web/src/app/api/workspaces/[id]/invitations'`.

---

### Task 6: Signing in accepts pending invitations

**Files:**
- Modify: `apps/web/src/app/api/auth/oauth/[provider]/callback/route.ts`
- Test: `apps/web/test/oauth-routes.integration.test.ts`

**Interfaces:**
- Consumes: Task 4's `acceptPendingInvitations(userId: string, now?: Date): Promise<number>`, `createOrReplaceInvitation`, `resolveInvite`; Task 3's `INVITE_TTL_MS`.
- Produces: the callback accepts every pending, unexpired invitation for the signed-in user's stored email after `resolveOAuthUser`, before issuing the session. A failure there is logged and never fails the sign-in.

- [ ] **Step 1: Write the failing tests**

In `apps/web/test/oauth-routes.integration.test.ts`, add to the imports:

```ts
import { createOrReplaceInvitation, resolveInvite } from '../src/lib/invitations.js'
import { INVITE_TTL_MS } from '../src/lib/invite-token.js'
```

Append at the end of the file:

```ts
describe('signing in accepts pending invitations', () => {
  let inviterId: string
  let workspaceId: string
  let secondWorkspaceId: string
  let lateWorkspaceId: string
  let documentId: string

  beforeAll(async () => {
    // The inviter's email matches the file's cleanup, which deletes the workspaces they
    // own, and the invitations go with them.
    inviterId = (await prisma.user.create({ data: { email: email('inviter'), name: 'Inviter' } })).id
    const make = async (name: string) =>
      (await prisma.workspace.create({ data: { name: `${name}-${RUN}`, ownerId: inviterId } })).id
    workspaceId = await make('oauth-invite')
    secondWorkspaceId = await make('oauth-invite-second')
    lateWorkspaceId = await make('oauth-invite-late')
    documentId = (await prisma.document.create({ data: { workspaceId, type: 'doc', title: 'Invited doc' } })).id
  })

  it('a new person invited by email joins on first sign-in, returns to the invite, and it sends them to the document', async () => {
    const invited = email('invited')
    const { link } = await createOrReplaceInvitation({
      workspaceId,
      email: invited,
      role: 'viewer',
      documentId,
      invitedById: inviterId,
    })
    // GitHub reports the address in its own capitalisation.
    stubGithub({ accountId: `gh-invited-${RUN}`, email: invited.toUpperCase() })
    const { cookie, state } = await begin('github', link)

    const response = await finish('github', { code: 'c', state }, cookie)

    expect(response.headers.get('location')).toBe(`${APP}${link}`)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: invited }, select: { id: true, email: true } })
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
    })
    expect(membership?.role).toBe('viewer')
    const row = await prisma.invitation.findUniqueOrThrow({
      where: { workspaceId_email: { workspaceId, email: invited } },
    })
    expect(row.acceptedAt).not.toBeNull()
    // Back on the invite page, the used link sends its own person on to the document.
    expect(await resolveInvite(link.slice('/invite/'.length), user)).toEqual({
      kind: 'redirect',
      to: `/workspaces/${workspaceId}/documents/${documentId}`,
    })
  })

  it('accepts pending invitations without the link, skips expired ones, and never changes a role', async () => {
    const returning = email('returning')
    stubGithub({ accountId: `gh-returning-${RUN}`, email: returning })
    // A first sign-in creates the person.
    const first = await begin('github')
    await finish('github', { code: 'c', state: first.state }, first.cookie)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: returning } })
    await prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role: 'editor' } })

    // The members route only invites emails with no account; these stand for
    // invitations made before the account existed and not yet swept.
    const base = { email: returning, documentId: null, invitedById: inviterId }
    await createOrReplaceInvitation({ ...base, workspaceId, role: 'viewer' })
    await createOrReplaceInvitation({ ...base, workspaceId: secondWorkspaceId, role: 'editor' })
    await createOrReplaceInvitation({
      ...base,
      workspaceId: lateWorkspaceId,
      role: 'editor',
      now: new Date(Date.now() - INVITE_TTL_MS - 60_000),
    })

    const again = await begin('github', '/')
    const response = await finish('github', { code: 'c', state: again.state }, again.cookie)
    expect(response.headers.get('location')).toBe(`${APP}/`)

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id, workspaceId: { in: [workspaceId, secondWorkspaceId, lateWorkspaceId] } },
      select: { workspaceId: true, role: true },
    })
    expect(new Map(memberships.map((m) => [m.workspaceId, m.role]))).toEqual(
      new Map([
        [workspaceId, 'editor'],
        [secondWorkspaceId, 'editor'],
      ]),
    )
    const late = await prisma.invitation.findUniqueOrThrow({
      where: { workspaceId_email: { workspaceId: lateWorkspaceId, email: returning } },
    })
    expect(late.acceptedAt).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @crdt/web exec vitest run test/oauth-routes.integration.test.ts`
Expected: the two new tests FAIL (no membership after sign-in); every existing test still passes.

- [ ] **Step 3: Accept invitations in the callback**

In `apps/web/src/app/api/auth/oauth/[provider]/callback/route.ts`, add the import:

```ts
import { acceptPendingInvitations } from '@/lib/invitations'
```

Replace:

```ts
    const user = await resolveOAuthUser(provider, profile)
    const token = await signSession(user.id, secret)
```

with:

```ts
    const user = await resolveOAuthUser(provider, profile)
    await acceptInvitationsQuietly(user.id)
    const token = await signSession(user.id, secret)
```

and append, after the `GET` function (not exported: a route module may export only its handlers):

```ts
/**
 * Accepts the person's pending invitations as they sign in, so an invite works even if
 * its link was lost. A failure here must not fail the sign-in: the invitations stay
 * pending, and the next sign-in or the link accepts them. Logged with the error's name
 * and code only, because a Prisma message can quote the query, and this query carries
 * the person's email.
 */
async function acceptInvitationsQuietly(userId: string): Promise<void> {
  try {
    await acceptPendingInvitations(userId)
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'invitation sweep failed',
        error: error instanceof Error ? error.name : 'unknown',
        code: typeof code === 'string' ? code : null,
      }),
    )
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @crdt/web exec vitest run test/oauth-routes.integration.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Prove they discriminate**

Step 2 saw both fail before the change. Commit (Step 6), then delete the `await acceptInvitationsQuietly(user.id)` line, rerun, watch both fail, and restore with `git checkout -- <file>`. The quiet-failure branch is not exercised by a test (the Prisma client is a shared singleton, and stubbing a model delegate is not reliable); say so in the report so the reviewer reads it.

- [ ] **Step 6: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`

```bash
git add 'apps/web/src/app/api/auth/oauth/[provider]/callback/route.ts' apps/web/test/oauth-routes.integration.test.ts
git commit -m "feat(auth): signing in accepts your pending invitations

After the user is resolved and before the session is issued. Existing roles are kept.
A failure is logged without the email and never fails the sign-in."
```

---

### Task 7: The invite page

**Files:**
- Create: `apps/web/src/app/(auth)/ProviderButtons.tsx`
- Modify: `apps/web/src/app/(auth)/login/page.tsx`
- Modify: `apps/web/src/app/(auth)/auth.module.css`
- Create: `apps/web/src/app/(auth)/invite/[token]/page.tsx`
- Create: `apps/web/src/app/(auth)/invite/[token]/InviteSignOut.tsx`
- Create: `apps/web/src/lib/sign-out.ts`
- Modify: `apps/web/src/components/UserMenu.tsx:72-99`
- Modify: `apps/web/e2e/fixtures.ts`
- Test: `apps/web/e2e/invitations.spec.ts`
- Modify: `docs/design/glass-handoff.md`

**Interfaces:**
- Consumes: Task 4's `resolveInvite`, `revokeInvitation`, `createOrReplaceInvitation`; Task 3's `describeInvite`; `getCurrentUser(): Promise<SessionUser | null>`; `availableProviders()`, `PROVIDERS` from `@/lib/oauth/providers`; `clearVersionStateCache()` from `@/lib/history-client`.
- Produces:
  - Page `/invite/[token]`, public, under the `(auth)` card layout. Test ids: `invite-summary` (signed out), `signin-github`, `signin-google`, `invite-mismatch`, `invite-sign-out`, `invite-invalid`. Metadata `referrer: 'no-referrer'`.
  - `ProviderButtons({ next }: { next: string })` in `apps/web/src/app/(auth)/ProviderButtons.tsx`.
  - `signOut(): Promise<boolean>` in `apps/web/src/lib/sign-out.ts` (false only when the request never reached the server).
  - e2e fixture `invite(input: { workspaceId: string; invitedById: string; email: string; role: Role; documentId?: string }): Promise<{ id: string; link: string }>` in `apps/web/e2e/fixtures.ts`.
  - `apps/web/e2e/invitations.spec.ts` with `const LABEL = 'e2e-invite'`, which Task 8 appends to.

- [ ] **Step 1: Add the e2e fixture**

In `apps/web/e2e/fixtures.ts`, add to the imports:

```ts
import { createOrReplaceInvitation } from '../src/lib/invitations.js'
```

and append:

```ts
/**
 * A pending invitation, made exactly as the members route makes one. Returns its id and
 * its link's path (/invite/<token>); the token exists nowhere else.
 */
export async function invite(input: {
  workspaceId: string
  invitedById: string
  email: string
  role: Role
  documentId?: string
}) {
  const { invitation, link } = await createOrReplaceInvitation({
    ...input,
    documentId: input.documentId ?? null,
  })
  return { id: invitation.id, link }
}
```

- [ ] **Step 2: Write the failing e2e tests**

Create `apps/web/e2e/invitations.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { prisma } from '@crdt/db'
import { revokeInvitation } from '../src/lib/invitations.js'
import {
  addMember,
  cleanup,
  createDocument,
  documentPath,
  invite,
  seedWorkspace,
  signIn,
} from './fixtures.js'

const LABEL = 'e2e-invite'
const INVALID = 'This invite link is no longer valid. Ask the person who shared it for a new one.'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('a signed-out visitor sees who invited them to what, and signs in back to the invite', async ({
  page,
}) => {
  const label = `${LABEL}-signedout`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const email = `${label}-new@e2e.test`
  const { link } = await invite({
    workspaceId: workspace.id,
    invitedById: owner.id,
    email,
    role: 'viewer',
    documentId: document.id,
  })

  await page.goto(link)
  await expect(page.getByTestId('invite-summary')).toHaveText(
    `Owner invited you to view e2e doc in ${label}. Sign in as ${email} to open it.`,
  )
  for (const provider of ['github', 'google']) {
    await expect(page.getByTestId(`signin-${provider}`)).toHaveAttribute(
      'href',
      `/api/auth/oauth/${provider}?next=${encodeURIComponent(link)}`,
    )
  }
  // The token is in this page's URL. No referrer, so no Referer header ever carries it.
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')

  await cleanup(label)
})

test('the invited person lands in the document with the role they were invited with', async ({
  page,
}) => {
  const label = `${LABEL}-accept`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const email = `${label}-new@e2e.test`
  const { id, link } = await invite({
    workspaceId: workspace.id,
    invitedById: owner.id,
    email,
    role: 'viewer',
    documentId: document.id,
  })
  // Their first sign-in creates this row. The OAuth return trip through the link is
  // covered by oauth-routes.integration.test.ts; here the session already exists.
  const invitee = await prisma.user.create({ data: { email, name: 'Newcomer' } })
  await signIn(page, invitee.id)

  await page.goto(link)
  await expect(page).toHaveURL(documentPath(document))
  await expect(page.getByTestId('view-only')).toBeVisible()
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: invitee.id } },
  })
  expect(membership?.role).toBe('viewer')
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).acceptedAt).not.toBeNull()

  // Opening the used link again still takes them there.
  await page.goto(link)
  await expect(page).toHaveURL(documentPath(document))

  await cleanup(label)
})

test('someone signed in under another email is told who it is for, and can sign out', async ({
  page,
}) => {
  const label = `${LABEL}-mismatch`
  const { owner, workspace } = await seedWorkspace(label)
  const email = `${label}-new@e2e.test`
  const { id, link } = await invite({ workspaceId: workspace.id, invitedById: owner.id, email, role: 'editor' })
  const other = await seedWorkspace(`${label}-other`)
  await signIn(page, other.owner.id)

  await page.goto(link)
  await expect(page.getByTestId('invite-mismatch')).toHaveText(
    `This invite is for ${email}. You're signed in as ${other.owner.email}.`,
  )
  // Nothing was accepted for the wrong person.
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).acceptedAt).toBeNull()

  await page.getByTestId('invite-sign-out').click()
  // Signed out, on the same page, which now offers sign-in for the invited email.
  await expect(page.getByTestId('invite-summary')).toContainText(`Sign in as ${email}`)
  await expect(page).toHaveURL(link)
  expect((await page.context().cookies()).some((c) => c.name === 'crdt_session')).toBe(false)
  const stray = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: other.owner.id } },
  })
  expect(stray).toBeNull()

  await cleanup(label)
  await cleanup(`${label}-other`)
})

test('expired, revoked, used and unknown links all read the same, and name nothing', async ({ page }) => {
  const label = `${LABEL}-invalid`
  const { owner, workspace } = await seedWorkspace(label)
  const base = { workspaceId: workspace.id, invitedById: owner.id, role: 'editor' as const }
  const expired = await invite({ ...base, email: `${label}-expired@e2e.test` })
  await prisma.invitation.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  })
  const revoked = await invite({ ...base, email: `${label}-revoked@e2e.test` })
  await revokeInvitation(workspace.id, revoked.id)
  const used = await invite({ ...base, email: `${label}-used@e2e.test` })
  await prisma.invitation.update({ where: { id: used.id }, data: { acceptedAt: new Date() } })

  for (const path of [expired.link, revoked.link, used.link, `/invite/${'A'.repeat(43)}`, '/invite/nonsense']) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    await expect(page.getByTestId('invite-invalid'), path).toHaveText(INVALID)
    // Nothing about the workspace or the inviter, for a link that does not work.
    await expect(page.locator('body'), path).not.toContainText(label)
    await expect(page.getByTestId('signin-github'), path).toHaveCount(0)
  }

  await cleanup(label)
})

test('a member invited again lands there and keeps their role', async ({ page }) => {
  const label = `${LABEL}-member`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const editor = await addMember(workspace.id, label, 'editor')
  const { id, link } = await invite({
    workspaceId: workspace.id,
    invitedById: owner.id,
    email: editor.email,
    role: 'viewer',
    documentId: document.id,
  })
  await signIn(page, editor.id)

  await page.goto(link)
  await expect(page).toHaveURL(documentPath(document))
  // Still an editor: no View only pill, and the row says so.
  await expect(page.getByTestId('view-only')).toHaveCount(0)
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: editor.id } },
  })
  expect(membership?.role).toBe('editor')
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).acceptedAt).not.toBeNull()

  await cleanup(label)
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @crdt/web exec playwright test e2e/invitations.spec.ts`
Expected: FAIL, `/invite/...` is a 404 and none of the test ids exist.

- [ ] **Step 4: Share the sign-in buttons**

Create `apps/web/src/app/(auth)/ProviderButtons.tsx`:

```tsx
import { PROVIDERS, availableProviders } from '@/lib/oauth/providers'
import styles from './auth.module.css'

/**
 * The sign-in buttons, each sending the browser back to `next` afterwards. `next` must
 * already be a safe same-origin path: the login page passes it through safeNext, and
 * the invite page passes its own path. Only providers with credentials get a button.
 */
export function ProviderButtons({ next }: { next: string }) {
  const providers = availableProviders()
  if (providers.length === 0) {
    return (
      <p className={styles.alt} data-testid="no-providers">
        No sign-in providers are configured.
      </p>
    )
  }
  return (
    <div className={styles.providers}>
      {providers.map((id) => (
        <a
          key={id}
          className={`${styles.provider} ${id === 'github' ? styles.providerAccent : styles.providerGlass}`}
          href={`/api/auth/oauth/${id}?next=${encodeURIComponent(next)}`}
          data-testid={`signin-${id}`}
        >
          Continue with {PROVIDERS[id].label}
        </a>
      ))}
    </div>
  )
}
```

In `apps/web/src/app/(auth)/login/page.tsx`, replace the import line `import { PROVIDERS, availableProviders } from '@/lib/oauth/providers'` with `import { ProviderButtons } from '../ProviderButtons'`, delete the line `const providers = availableProviders()`, and replace the whole `{providers.length === 0 ? (...) : (...)}` block (the `no-providers` paragraph and the `.providers` div) with:

```tsx
      <ProviderButtons next={destination} />
```

The rendered HTML is unchanged, so the login tests in `auth-flow.spec.ts` keep passing.

- [ ] **Step 5: One sign-out call**

Create `apps/web/src/lib/sign-out.ts`:

```ts
import { clearVersionStateCache } from './history-client.js'

/**
 * Ends the session and forgets what this browser fetched for it. False only when the
 * request never reached the server (offline, connection refused): fetch rejects then,
 * and the caller lets the person try again. The next person to sign in on this browser
 * must not be served a document state this one fetched: that cache is keyed by
 * document and version only.
 */
export async function signOut(): Promise<boolean> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
  } catch {
    return false
  }
  clearVersionStateCache()
  return true
}
```

In `apps/web/src/components/UserMenu.tsx`, replace the import `import { clearVersionStateCache } from '@/lib/history-client'` with `import { signOut } from '@/lib/sign-out'`, and replace the sign-out button's `onClick` (lines 77-96) with:

```tsx
            onClick={async () => {
              setPending(true)
              // False when the request never reached the server. Without re-enabling here
              // the button would sit disabled forever with no way to retry.
              if (!(await signOut())) {
                setPending(false)
                return
              }
              // refresh() drops the server tree rendered for the old session
              // before navigating, so no signed-in data stays on screen.
              router.refresh()
              router.push('/login')
            }}
```

- [ ] **Step 6: The sign-out control on the invite page**

Add to the end of `apps/web/src/app/(auth)/auth.module.css`:

```css
/* A <button> wearing the provider look: undo the browser's button font, width and
   cursor. Used by the invite page's Sign out. */
.providerButton {
  width: 100%;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}

.providerButton:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

Create `apps/web/src/app/(auth)/invite/[token]/InviteSignOut.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { signOut } from '@/lib/sign-out'
import styles from '../../auth.module.css'
import ui from '@/components/ui/ui.module.css'

/**
 * Signs out and stays on this page. Re-rendered signed out, the page offers sign-in for
 * the invited email, and the token never has to go into another URL to get back here.
 */
export function InviteSignOut() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <>
      {failed && (
        <p className={ui.error} role="alert">
          Could not sign out. Check your connection and try again.
        </p>
      )}
      <button
        type="button"
        className={`${styles.provider} ${styles.providerGlass} ${styles.providerButton}`}
        disabled={pending}
        data-testid="invite-sign-out"
        onClick={async () => {
          setPending(true)
          setFailed(false)
          if (!(await signOut())) {
            setPending(false)
            setFailed(true)
            return
          }
          router.refresh()
        }}
      >
        Sign out
      </button>
    </>
  )
}
```

- [ ] **Step 7: The page**

Read `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` (the `referrer` field) and `.../redirect.md` first.

Create `apps/web/src/app/(auth)/invite/[token]/page.tsx`:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/current-user'
import { resolveInvite } from '@/lib/invitations'
import { describeInvite } from '@/lib/invite-text'
import { ProviderButtons } from '../../ProviderButtons'
import { InviteSignOut } from './InviteSignOut'
import styles from '../../auth.module.css'

export const metadata: Metadata = {
  title: 'Invitation · CRDT Workspace',
  // The token is in this page's URL. With no referrer, no request from here, to another
  // site or to this one, ever carries it in a Referer header.
  referrer: 'no-referrer',
}

// Public, like /login and /privacy: the person opening this usually has no account yet.
// It does its own check instead: a link is accepted only for a signed-in user whose
// email is the invitation's (resolveInvite).
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  // The session first. Reading the cookie makes this render dynamic before anything
  // else runs, so no outcome for any token is ever prerendered or served from a cache.
  const user = await getCurrentUser()
  const { token } = await params
  const outcome = await resolveInvite(token, user)

  // redirect() signals by throwing, so it stays outside any try/catch.
  if (outcome.kind === 'redirect') redirect(outcome.to)

  if (outcome.kind === 'invalid') {
    // One message for expired, revoked, used and unknown links alike, naming nothing.
    return (
      <>
        <div className={styles.intro}>
          <h1 className={styles.heading}>Invitation</h1>
          <p className={styles.lede} data-testid="invite-invalid">
            This invite link is no longer valid. Ask the person who shared it for a new one.
          </p>
        </div>
        <p className={styles.alt}>
          <Link href="/">Go to your workspaces</Link>
        </p>
      </>
    )
  }

  if (outcome.kind === 'mismatch') {
    return (
      <>
        <div className={styles.intro}>
          <h1 className={styles.heading}>Invitation</h1>
          <p className={styles.lede} data-testid="invite-mismatch">
            This invite is for <strong>{outcome.invitedEmail}</strong>. You&apos;re signed in as{' '}
            <strong>{outcome.signedInEmail}</strong>.
          </p>
        </div>
        <InviteSignOut />
      </>
    )
  }

  // Signed out, valid link. Sign-in returns here: by then the callback has accepted the
  // invitation for the right email, and this page sends them on (resolveInvite).
  return (
    <>
      <div className={styles.intro}>
        <h1 className={styles.heading}>You&apos;re invited</h1>
        <p className={styles.lede} data-testid="invite-summary">
          {describeInvite(outcome.invite)} Sign in as <strong>{outcome.invite.email}</strong> to open it.
        </p>
      </div>
      <ProviderButtons next={`/invite/${token}`} />
      <p className={styles.alt}>
        New here? Signing in creates your account.{' '}
        <Link href="/privacy" data-testid="privacy-link">
          Privacy
        </Link>
      </p>
    </>
  )
}
```

The token reaches `ProviderButtons` only when `resolveInvite` found a valid invitation for it, which means it passed `isWellFormedInviteToken` (43 base64url characters), so `/invite/${token}` is a safe same-origin path.

- [ ] **Step 8: Run the e2e tests to verify they pass**

Run: `pnpm --filter @crdt/web exec playwright test e2e/invitations.spec.ts e2e/auth-flow.spec.ts`
Expected: PASS. The sign-out test in `auth-flow.spec.ts` ("the dashboard lists the workspaces...") still lands on `/login`.

- [ ] **Step 9: Prove they discriminate**

Step 3 saw them all fail. Commit (Step 11), then mutate one at a time, rerun, watch it fail, restore with `git checkout -- <file>`:
- In the page, render the sign-in branch for `mismatch` too: "someone signed in under another email..." fails.
- In `InviteSignOut`, replace `router.refresh()` with `router.push('/login')`: the `toHaveURL(link)` assertion fails.
- Remove `referrer: 'no-referrer'`: the meta assertion fails.

- [ ] **Step 10: Record the page in the handoff**

In `docs/design/glass-handoff.md`, at the end of the `### Invite links and the Workspaces nav link` subsection (after Task 1's table), append:

```markdown
- **Invite page, `/invite/[token]`.** Public, in the `(auth)` group, so it is the sign-in
  card of §7 (mark, 30px heading, lede in `--text-muted`, the two provider buttons,
  13px footnote). States:
  - Valid, signed out: "You're invited", then "{inviter} invited you to {edit|view|own}
    {document} in {workspace}. Sign in as {email} to open it." Without a document:
    "... to {verb} {workspace}." An inviter who deleted their account is "Someone".
    The provider buttons return to the same page.
  - Signed in as the invited email: accepted, and redirected to the document, or the
    workspace if none. A used link opened by that same person redirects again.
  - Signed in as another email: "This invite is for {email}. You're signed in as
    {other}." and a Sign out button in the Google button's style, which stays on the
    page.
  - Expired, revoked, used (by anyone else) or unknown: one message, "This invite link is
    no longer valid. Ask the person who shared it for a new one." HTTP 200 in every case.
  - `<meta name="referrer" content="no-referrer">`, because the token is in the URL.
- **Signing in accepts pending invitations** for the user's stored email, in the OAuth
  callback, without the link. An existing member's role never changes.
```

- [ ] **Step 11: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: PASS; `next build` lists one more route (`/invite/[token]`); Playwright 5 more tests.

```bash
git add 'apps/web/src/app/(auth)/ProviderButtons.tsx' 'apps/web/src/app/(auth)/login/page.tsx' 'apps/web/src/app/(auth)/auth.module.css' 'apps/web/src/app/(auth)/invite' apps/web/src/lib/sign-out.ts apps/web/src/components/UserMenu.tsx apps/web/e2e/fixtures.ts apps/web/e2e/invitations.spec.ts docs/design/glass-handoff.md
git commit -m "feat(invites): the public invite page

Shows who invited you to what and asks you to sign in as that email; accepts and
redirects when you are that person; says who it is for when you are not. Every dead
link reads the same and names nothing. No referrer leaves the page."
```

---

### Task 8: The share sheet: invite link, Copy link, Invited list

**Files:**
- Create: `apps/web/src/lib/invitations-client.ts`
- Modify: `apps/web/src/components/ShareSheet.tsx` (whole file)
- Modify: `apps/web/src/components/share-sheet.module.css`
- Modify: `apps/web/src/components/AppShell.tsx:405-413` (the `<ShareSheet>` element)
- Test: `apps/web/e2e/invitations.spec.ts` (append), `apps/web/e2e/auth-flow.spec.ts` (the existing-user test)
- Modify: `docs/design/glass-handoff.md`

**Interfaces:**
- Consumes: Task 4's types `InvitationView`, `InvitationLinkResult`, `MemberPostResult` from `@/lib/members`; Task 5's HTTP routes; Task 7's `invite()` fixture and `invitations.spec.ts` (`LABEL`, `INVALID`, imports); `activeDocumentId` in `AppShell`.
- Produces:
  - In `apps/web/src/lib/invitations-client.ts`: `absoluteInviteUrl(path: string): string`, `fetchPendingInvitations(workspaceId: string): Promise<InvitationView[] | null>`, `fetchNewInviteLink(workspaceId: string, invitationId: string): Promise<InvitationLinkResult | null>`, `deleteInvitation(workspaceId: string, invitationId: string): Promise<boolean>`.
  - `ShareSheet` gains the prop `documentId?: string`.
  - Test ids: `invite-link-panel`, `invite-link` (read-only input holding the absolute URL), `invite-link-copy`, `invited-list`, `invited-<invitationId>`, `invited-copy-<invitationId>`, `invited-revoke-<invitationId>`, `invited-error`. Existing ids unchanged.

- [ ] **Step 1: Write the failing e2e tests**

In `apps/web/e2e/invitations.spec.ts`, change the first import to `import { test, expect, type Browser, type Page } from '@playwright/test'`, add `sessionCookieFor` to the `./fixtures.js` import, then append:

```ts
/**
 * On `path`, already signed in as an owner: opens the share sheet and invites `email`
 * with `role`. Returns the absolute link the sheet shows.
 */
async function inviteFromSheet(
  page: Page,
  path: string,
  email: string,
  role: 'viewer' | 'editor' | 'owner',
) {
  await page.goto(path)
  await page.getByTestId('share').click()
  const sheet = page.getByTestId('sheet')
  await sheet.getByTestId('member-email').fill(email)
  await sheet.getByTestId('member-role').selectOption(role)
  await sheet.getByTestId('add-member').click()
  const field = sheet.getByTestId('invite-link')
  await expect(field).toHaveValue(/\/invite\/[A-Za-z0-9_-]{43}$/)
  return field.inputValue()
}

/** A signed-out browser of its own, for opening a link as a stranger would. */
async function visitSignedOut(browser: Browser, url: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(url)
  return { context, page }
}

test('an owner invites someone new from a document, copies the link, and it opens that document', async ({
  page,
  browser,
}) => {
  const label = `${LABEL}-sheet`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  const email = `${label}-new@e2e.test`
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await signIn(page, owner.id)

  // Typed in capitals: it is stored, listed and matched lowercased.
  const url = await inviteFromSheet(page, documentPath(document), email.toUpperCase(), 'viewer')
  const sheet = page.getByTestId('sheet')
  expect(new URL(url).origin).toBe('http://localhost:3000')
  await expect(page.getByTestId('toast').filter({ hasText: `Invite link created for ${email}` })).toBeVisible()
  await expect(sheet.getByTestId('member-error')).toHaveCount(0)

  await sheet.getByTestId('invite-link-copy').click()
  await expect(page.getByTestId('toast').filter({ hasText: 'Link copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url)

  // The invitation remembers the document the sheet was opened from.
  const row = await prisma.invitation.findUniqueOrThrow({
    where: { workspaceId_email: { workspaceId: workspace.id, email } },
  })
  expect(row.documentId).toBe(document.id)
  await expect(sheet.getByTestId(`invited-${row.id}`)).toContainText(email)
  await expect(sheet.getByTestId(`invited-${row.id}`)).toContainText('Can view')

  // The person it was for opens it in a browser of their own.
  const invitee = await prisma.user.create({ data: { email, name: 'Newcomer' } })
  const context = await browser.newContext()
  await context.addCookies([await sessionCookieFor(invitee.id)])
  const theirs = await context.newPage()
  await theirs.goto(url)
  await expect(theirs).toHaveURL(documentPath(document))
  await expect(theirs.getByTestId('view-only')).toBeVisible()
  await context.close()

  await cleanup(label)
})

test('inviting the same email again kills the old link', async ({ page, browser }) => {
  const label = `${LABEL}-reinvite`
  const { owner, workspace } = await seedWorkspace(label)
  const email = `${label}-new@e2e.test`
  await signIn(page, owner.id)

  const first = await inviteFromSheet(page, `/workspaces/${workspace.id}`, email, 'viewer')
  const sheet = page.getByTestId('sheet')
  await sheet.getByTestId('member-email').fill(email)
  await sheet.getByTestId('member-role').selectOption('editor')
  await sheet.getByTestId('add-member').click()
  await expect(sheet.getByTestId('invite-link')).not.toHaveValue(first)
  const second = await sheet.getByTestId('invite-link').inputValue()
  await expect(
    page.getByTestId('toast').filter({ hasText: `New invite link for ${email}. The old link no longer works.` }),
  ).toBeVisible()
  // One invitation, replaced in place, now Can edit.
  expect(await prisma.invitation.count({ where: { workspaceId: workspace.id, email } })).toBe(1)
  const row = await prisma.invitation.findUniqueOrThrow({
    where: { workspaceId_email: { workspaceId: workspace.id, email } },
  })
  await expect(sheet.getByTestId(`invited-${row.id}`)).toContainText('Can edit')

  const old = await visitSignedOut(browser, first)
  await expect(old.page.getByTestId('invite-invalid')).toHaveText(INVALID)
  await old.page.goto(second)
  await expect(old.page.getByTestId('invite-summary')).toContainText('invited you to edit')
  await old.context.close()

  await cleanup(label)
})

test('Copy link in the Invited list makes a new link and retires the old one', async ({ page, browser }) => {
  const label = `${LABEL}-recopy`
  const { owner, workspace } = await seedWorkspace(label)
  const email = `${label}-new@e2e.test`
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await signIn(page, owner.id)

  const first = await inviteFromSheet(page, `/workspaces/${workspace.id}`, email, 'editor')
  const sheet = page.getByTestId('sheet')
  const row = await prisma.invitation.findUniqueOrThrow({
    where: { workspaceId_email: { workspaceId: workspace.id, email } },
  })
  // Said before anyone clicks, not only after.
  await expect(sheet.getByTestId('invited-list')).toContainText('earlier links for them stop working')

  await sheet.getByTestId(`invited-copy-${row.id}`).click()
  await expect(sheet.getByTestId('invite-link')).not.toHaveValue(first)
  const second = await sheet.getByTestId('invite-link').inputValue()
  await expect(
    page.getByTestId('toast').filter({ hasText: `New link copied for ${email}. The old link no longer works.` }),
  ).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(second)

  const visitor = await visitSignedOut(browser, first)
  await expect(visitor.page.getByTestId('invite-invalid')).toHaveText(INVALID)
  await visitor.page.goto(second)
  await expect(visitor.page.getByTestId('invite-summary')).toBeVisible()
  await visitor.context.close()

  await cleanup(label)
})

test('revoking an invite removes it and kills its link', async ({ page, browser }) => {
  const label = `${LABEL}-revoke`
  const { owner, workspace } = await seedWorkspace(label)
  const email = `${label}-new@e2e.test`
  await signIn(page, owner.id)

  const url = await inviteFromSheet(page, `/workspaces/${workspace.id}`, email, 'viewer')
  const sheet = page.getByTestId('sheet')
  const row = await prisma.invitation.findUniqueOrThrow({
    where: { workspaceId_email: { workspaceId: workspace.id, email } },
  })

  await sheet.getByTestId(`invited-revoke-${row.id}`).click()
  await expect(page.getByTestId('toast').filter({ hasText: `Invite for ${email} revoked` })).toBeVisible()
  await expect(sheet.getByTestId(`invited-${row.id}`)).toHaveCount(0)
  // The link on screen was that invitation's, so it goes too.
  await expect(sheet.getByTestId('invite-link-panel')).toHaveCount(0)
  expect(await prisma.invitation.findUnique({ where: { id: row.id } })).toBeNull()

  const visitor = await visitSignedOut(browser, url)
  await expect(visitor.page.getByTestId('invite-invalid')).toHaveText(INVALID)
  await visitor.context.close()

  await cleanup(label)
})

test('non-owners see no invite controls or pending invites, and the API refuses them', async ({ page }) => {
  const label = `${LABEL}-nonowner`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const viewer = await addMember(workspace.id, label, 'viewer')
  const pendingEmail = `${label}-pending@e2e.test`
  const pending = await invite({ workspaceId: workspace.id, invitedById: owner.id, email: pendingEmail, role: 'editor' })

  const asked: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/invitations')) asked.push(request.url())
  })

  // Positive control: an owner's sheet does ask, and does list it. Without this, a sheet
  // that never fetched would pass every check below.
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)
  await page.getByTestId('share').click()
  await expect(page.getByTestId('invited-list')).toContainText(pendingEmail)
  expect(asked.length).toBeGreaterThan(0)

  for (const member of [editor, viewer]) {
    await page.context().clearCookies()
    await signIn(page, member.id)
    asked.length = 0
    await page.goto(`/workspaces/${workspace.id}`)
    await page.getByTestId('share').click()
    await expect(page.getByTestId('sheet')).toBeVisible()
    await page.waitForLoadState('networkidle')

    await expect(page.getByTestId('member-email')).toHaveCount(0)
    await expect(page.getByTestId('invited-list')).toHaveCount(0)
    await expect(page.getByTestId('sheet')).not.toContainText(pendingEmail)
    expect(asked, member.email).toEqual([])

    // And the API refuses them directly.
    const api = `/api/workspaces/${workspace.id}`
    expect((await page.request.get(`${api}/invitations`)).status(), member.email).toBe(403)
    expect(
      (await page.request.post(`${api}/members`, { data: { email: `${label}-sneaky@e2e.test`, role: 'owner' } })).status(),
      member.email,
    ).toBe(403)
    expect((await page.request.post(`${api}/invitations/${pending.id}/link`)).status(), member.email).toBe(403)
    expect((await page.request.delete(`${api}/invitations/${pending.id}`)).status(), member.email).toBe(403)
  }
  expect(await prisma.invitation.count({ where: { workspaceId: workspace.id } })).toBe(1)

  await cleanup(label)
})
```

In `apps/web/e2e/auth-flow.spec.ts`, add `import { prisma } from '@crdt/db'` to the imports, and in the test `'an owner sees the member list and can invite an existing user'`, directly after the line `await page.getByTestId('add-member').click()` (line 223, before the existing `member-…` "Can edit" assertion), insert the lines below. The toast is asserted first: it appears only once the response is back, so the database count after it is not racing the request.

```ts
  // Exactly as before invite links: added at once, no link shown, nothing pending.
  await expect(page.getByTestId('toast').filter({ hasText: `${outsider.owner.email} added` })).toBeVisible()
  await expect(page.getByTestId('invite-link-panel')).toHaveCount(0)
  expect(await prisma.invitation.count({ where: { workspaceId: workspace.id } })).toBe(0)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @crdt/web exec playwright test e2e/invitations.spec.ts -g "owner invites|same email again|Copy link in the Invited|revoking|non-owners"`
Expected: FAIL, `invite-link` never appears. The existing-user assertions in `auth-flow.spec.ts` already pass on the old sheet; they guard against regression rather than drive the change, so prove them in Step 7.

- [ ] **Step 3: The client calls**

Create `apps/web/src/lib/invitations-client.ts`:

```ts
import type { InvitationLinkResult, InvitationView } from './members.js'

// The share sheet's calls to the invitation routes. Each returns null (or false) for a
// refusal and for a request that never got an answer: fetch rejects then, and the
// sheet only needs to know that it did not work.

/** An invite link's path, made absolute on this browser's origin, which is the app's. */
export function absoluteInviteUrl(path: string): string {
  return new URL(path, window.location.origin).toString()
}

export async function fetchPendingInvitations(workspaceId: string): Promise<InvitationView[] | null> {
  try {
    const response = await fetch(`/api/workspaces/${workspaceId}/invitations`, { cache: 'no-store' })
    if (!response.ok) return null
    return ((await response.json()) as { invitations: InvitationView[] }).invitations
  } catch {
    return null
  }
}

/** Copy link: a new link for a pending invitation. The old one stops working. */
export async function fetchNewInviteLink(
  workspaceId: string,
  invitationId: string,
): Promise<InvitationLinkResult | null> {
  try {
    const response = await fetch(`/api/workspaces/${workspaceId}/invitations/${invitationId}/link`, {
      method: 'POST',
    })
    if (!response.ok) return null
    return (await response.json()) as InvitationLinkResult
  } catch {
    return null
  }
}

export async function deleteInvitation(workspaceId: string, invitationId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/workspaces/${workspaceId}/invitations/${invitationId}`, {
      method: 'DELETE',
    })
    return response.ok
  } catch {
    return false
  }
}
```

- [ ] **Step 4: The sheet**

Replace the whole of `apps/web/src/components/ShareSheet.tsx` with:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import type { Role } from '@crdt/shared/types'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { colorFor } from '@/lib/color'
import {
  absoluteInviteUrl,
  deleteInvitation,
  fetchNewInviteLink,
  fetchPendingInvitations,
} from '@/lib/invitations-client'
import type { InvitationView, MemberPostResult, WorkspaceMemberView } from '@/lib/members'
import { ROLE_LABEL } from '@/lib/role-label'
import styles from './share-sheet.module.css'
import ui from '@/components/ui/ui.module.css'

/** The invite link on screen: just made by inviting someone, or by Copy link. */
type ShownLink = { invitationId: string; email: string; url: string }

export function ShareSheet({
  workspaceId,
  workspaceName,
  members,
  canManage,
  documentId,
  onClose,
}: {
  workspaceId: string
  workspaceName: string
  members: WorkspaceMemberView[]
  canManage: boolean
  /** The open document, when the sheet was opened from one. An invitation remembers it. */
  documentId?: string
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const invitedHeadingId = useId()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [invitations, setInvitations] = useState<InvitationView[]>([])
  const [invitationsFailed, setInvitationsFailed] = useState(false)
  const [shown, setShown] = useState<ShownLink | null>(null)

  // Fetched here rather than passed down from the layout: the layout renders for every
  // member, and who has been invited is for owners only. The API enforces that as well.
  const loadInvitations = useCallback(async () => {
    if (!canManage) return
    const list = await fetchPendingInvitations(workspaceId)
    setInvitationsFailed(list === null)
    if (list !== null) setInvitations(list)
  }, [canManage, workspaceId])

  useEffect(() => {
    void loadInvitations()
  }, [loadInvitations])

  async function postMember(body: {
    email: string
    role: Role
    documentId?: string
  }): Promise<MemberPostResult | null> {
    setError(null)
    setPending(true)
    let response: Response
    try {
      response = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      // fetch rejects, rather than resolving with an error status, when the request
      // never reaches the server. Without this the rejection escapes and pending
      // stays true, leaving the control disabled with nothing shown.
      setError('Could not reach the server. Check your connection and try again.')
      setPending(false)
      return null
    }
    const payload: unknown = await response.json().catch(() => null)
    setPending(false)
    if (!response.ok || payload === null) {
      setError(
        response.status === 403
          ? 'Your role in this workspace changed. Reload the page.'
          : ((payload as { error?: string } | null)?.error ?? 'Could not update that member'),
      )
      return null
    }
    return payload as MemberPostResult
  }

  async function copy(url: string, announce: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast(announce)
    } catch {
      // No clipboard: an insecure origin, a denied permission, or Safari refusing a
      // write that follows a network round trip. The link is in the field, selected on
      // focus, so it can still be copied by hand.
      setError('Could not copy the link. Select it in the field and copy it yourself.')
    }
  }

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    if (!email) return
    // The members route upserts, so posting an existing member would silently
    // change their role instead of inviting anyone. Catch it here and say so;
    // role changes have their own control on the row.
    const existing = members.find((m) => m.email.toLowerCase() === email.toLowerCase())
    if (existing) {
      setError(`${email} already has access.`)
      return
    }
    const role = String(data.get('role') ?? 'editor') as Role
    // Inviting a pending email again replaces its invitation, and its old link stops
    // working. Say so rather than let it look like a second invite.
    const replacing = invitations.some((i) => i.email === email.toLowerCase())
    const result = await postMember({ email, role, ...(documentId ? { documentId } : {}) })
    // Clear the field only on success, as before: a failed invite keeps what was typed
    // so it can be corrected.
    if (!result) return
    form.reset()
    if (result.kind === 'member') {
      toast(`${email} added`)
      router.refresh()
      return
    }
    setShown({
      invitationId: result.invitation.id,
      email: result.invitation.email,
      url: absoluteInviteUrl(result.link),
    })
    toast(
      replacing
        ? `New invite link for ${result.invitation.email}. The old link no longer works.`
        : `Invite link created for ${result.invitation.email}`,
    )
    void loadInvitations()
  }

  async function onRoleChange(member: WorkspaceMemberView, role: Role) {
    if (!(await postMember({ email: member.email, role }))) return
    toast(role === 'editor' ? `${member.name} can edit now` : `${member.name} is now ${ROLE_LABEL[role]}`)
    router.refresh()
  }

  // Copy link in the Invited list. Only a hash of each token is stored, so the link
  // first sent cannot be shown again: this makes a new one and the old one stops
  // working (the plan's Copy-link decision). The toast and the note say so.
  async function onCopyNew(invitation: InvitationView) {
    setError(null)
    setPending(true)
    const result = await fetchNewInviteLink(workspaceId, invitation.id)
    setPending(false)
    if (!result) {
      setError('Could not make a new link. Reload the page and try again.')
      return
    }
    const url = absoluteInviteUrl(result.link)
    setShown({ invitationId: invitation.id, email: invitation.email, url })
    await copy(url, `New link copied for ${invitation.email}. The old link no longer works.`)
    void loadInvitations()
  }

  async function onRevoke(invitation: InvitationView) {
    setError(null)
    setPending(true)
    const ok = await deleteInvitation(workspaceId, invitation.id)
    setPending(false)
    if (!ok) {
      setError('Could not revoke that invite. Reload the page and try again.')
      return
    }
    if (shown?.invitationId === invitation.id) setShown(null)
    toast(`Invite for ${invitation.email} revoked`)
    void loadInvitations()
  }

  return (
    <Sheet title={`Share "${workspaceName}"`} onClose={onClose}>
      {canManage && (
        <form className={styles.invite} onSubmit={onInvite}>
          <input
            className={styles.inviteInput}
            name="email"
            type="email"
            required
            placeholder="teammate@company.com"
            aria-label="Invite by email"
            data-testid="member-email"
          />
          <select
            className={styles.inviteRole}
            name="role"
            defaultValue="editor"
            aria-label="Role"
            data-testid="member-role"
          >
            <option value="viewer">{ROLE_LABEL.viewer}</option>
            <option value="editor">{ROLE_LABEL.editor}</option>
            <option value="owner">{ROLE_LABEL.owner}</option>
          </select>
          <Button type="submit" disabled={pending} data-testid="add-member">
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      )}

      {error && (
        <p className={ui.error} role="alert" data-testid="member-error">
          {error}
        </p>
      )}

      {canManage && shown && (
        <div className={styles.linkPanel} data-testid="invite-link-panel">
          <p className={styles.linkNote}>
            Send this link to {shown.email}. It works only for them, for 14 days.
          </p>
          <div className={styles.linkRow}>
            <input
              className={styles.linkInput}
              readOnly
              value={shown.url}
              aria-label={`Invite link for ${shown.email}`}
              data-testid="invite-link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button onClick={() => void copy(shown.url, 'Link copied')} data-testid="invite-link-copy">
              Copy link
            </Button>
          </div>
        </div>
      )}

      <div className={styles.people}>
        {members.map((member) => (
          <div className={styles.row} key={member.id} data-testid={`share-member-${member.id}`}>
            <span
              className={styles.avatar}
              style={{ background: colorFor(member.id) }}
              aria-hidden="true"
            >
              {(member.name || member.email).slice(0, 1).toUpperCase()}
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{member.name}</span>
              <span className={styles.email}>{member.email}</span>
            </span>
            {canManage ? (
              <select
                className={styles.inviteRole}
                value={member.role}
                aria-label={`Role for ${member.name}`}
                data-testid={`role-for-${member.id}`}
                disabled={pending}
                onChange={(event) => void onRoleChange(member, event.target.value as Role)}
              >
                <option value="viewer">{ROLE_LABEL.viewer}</option>
                <option value="editor">{ROLE_LABEL.editor}</option>
                <option value="owner">{ROLE_LABEL.owner}</option>
              </select>
            ) : (
              <span className={styles.rowRole}>{ROLE_LABEL[member.role]}</span>
            )}
          </div>
        ))}
      </div>

      {canManage && invitations.length > 0 && (
        <section className={styles.invited} aria-labelledby={invitedHeadingId} data-testid="invited-list">
          <h3 className={styles.invitedHeading} id={invitedHeadingId}>
            Invited
          </h3>
          {invitations.map((invitation) => (
            <div className={styles.row} key={invitation.id} data-testid={`invited-${invitation.id}`}>
              <span className={`${styles.avatar} ${styles.avatarPending}`} aria-hidden="true">
                {invitation.email.slice(0, 1).toUpperCase()}
              </span>
              <span className={styles.text}>
                <span className={styles.name}>{invitation.email}</span>
                <span className={styles.email}>
                  {ROLE_LABEL[invitation.role]}
                  {invitation.expired ? ' · link expired' : ''}
                </span>
              </span>
              <Button
                variant="ghost"
                className={styles.rowButton}
                disabled={pending}
                aria-label={`Copy link for ${invitation.email}`}
                data-testid={`invited-copy-${invitation.id}`}
                onClick={() => void onCopyNew(invitation)}
              >
                Copy link
              </Button>
              <Button
                variant="danger"
                className={styles.rowButton}
                disabled={pending}
                aria-label={`Revoke invite for ${invitation.email}`}
                data-testid={`invited-revoke-${invitation.id}`}
                onClick={() => void onRevoke(invitation)}
              >
                Revoke
              </Button>
            </div>
          ))}
          <p className={styles.invitedNote}>
            Copy link makes a new link each time; earlier links for them stop working.
          </p>
        </section>
      )}

      {canManage && invitationsFailed && (
        <p className={ui.error} role="alert" data-testid="invited-error">
          Could not load pending invites. Reload the page to try again.
        </p>
      )}

      <p className={styles.footnote}>
        Someone without an account gets an invite link to send them. Role changes apply the
        next time they connect.
      </p>
    </Sheet>
  )
}
```

- [ ] **Step 5: Its styles**

Append to `apps/web/src/components/share-sheet.module.css`:

```css
/* The invite link, shown to the owner right after inviting someone or after Copy link.
   Tinted so it reads as the result of what was just done, not as another member. */
.linkPanel {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  padding: 12px;
  border-radius: var(--r-card);
  background: var(--accent-tint);
}

.linkNote {
  margin: 0;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.45;
}

.linkRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* White field, as the invite bar's (§14). */
.linkInput {
  flex: 1 1 auto;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--field-border);
  border-radius: var(--r-pill);
  background: #fff;
  font-size: 13px;
  color: var(--text);
}

.linkInput:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-ring);
}

.invited {
  display: grid;
  gap: 2px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.invitedHeading {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}

/* Not a person yet: the dashed outline of the "make a new one" tiles, no fill. */
.avatarPending {
  background: transparent;
  border: 1.5px dashed var(--dash);
  color: var(--text-muted);
  box-shadow: none;
}

/* Two classes, so this outranks .button's 36px whichever stylesheet loads last. */
.row .rowButton {
  flex: none;
  height: 30px;
  padding: 0 12px;
  font-size: 13px;
}

.invitedNote {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--text-faint);
}
```

- [ ] **Step 6: Pass the open document to the sheet**

In `apps/web/src/components/AppShell.tsx`, replace the `<ShareSheet ... />` element (lines 405-413) with:

```tsx
        {workspace && overlay === 'share' && (
          <ShareSheet
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            members={members}
            canManage={canManage}
            documentId={activeDocumentId}
            onClose={closeOverlay}
          />
        )}
```

- [ ] **Step 7: Run the tests to verify they pass, and prove they discriminate**

Run: `pnpm --filter @crdt/web exec playwright test e2e/invitations.spec.ts e2e/share-sheet.spec.ts e2e/auth-flow.spec.ts`
Expected: PASS. The existing share-sheet tests (focus trap, backdrop, duplicate guard, role toast, People link) still pass.

Commit (Step 9), then mutate one at a time, rerun, watch it fail, restore with `git checkout -- <file>`:
- In `ShareSheet`, drop `...(documentId ? { documentId } : {})`: "an owner invites someone new from a document" fails at `row.documentId`.
- Make `loadInvitations` skip the `canManage` check: "non-owners see no invite controls" fails at `asked` being non-empty.
- In `onRevoke`, drop `setShown(null)`: "revoking an invite" fails at `invite-link-panel`.
- For the existing-user assertions in `auth-flow.spec.ts`: in `onInvite`, show the panel for `result.kind === 'member'` too (set `shown` with the member's email and a dummy URL before returning): the `invite-link-panel` count assertion fails.

- [ ] **Step 8: Record the sheet in the handoff**

In `docs/design/glass-handoff.md`, at the end of the `### Invite links and the Workspaces nav link` subsection (after Task 7's bullets), append:

```markdown
- **Share sheet.** Inviting an email with no account (owner only) shows the link in a
  tinted panel under the invite bar, a read-only field with **Copy link**, and a toast.
  Owners see an **Invited** list under the members: email, role, "link expired" when it
  is, **Copy link** and **Revoke**. Non-owners see neither, and the sheet does not ask
  the API for them.
- **Copy link re-issues** (the plan's Copy-link decision). Only a hash of each token is
  stored, so the Invited list's Copy link makes a new link, resets its 14 days, and the
  old link stops working. The toast and a note under the list say so. The panel's Copy
  link, right after inviting, copies the link just made and re-issues nothing.

| Where | §14 / §16 says | Built | Why |
|---|---|---|---|
| §14 errors | "We couldn't find {email}. Ask them to sign in once, then try again." | Retired: an unknown email now gets an invitation | Decision 2 of 2026-10-09. |
| §14 footnote | "People need to have signed in once before you can add them. Role changes apply the next time they connect." | "Someone without an account gets an invite link to send them. Role changes apply the next time they connect." | The first sentence is no longer true. |
| §14 link panel | Not in §14 | `--accent-tint` panel, `--r-card`, 12px padding; white 36px pill field with the invite bar's border and the `--accent-ring` focus halo; an accent **Copy link** | Nothing in the design shows a link; built from the sheet's own parts. |
| §14 Invited list | Not in §14 | Below the members, a 1px `--line` rule, "Invited" at 13/600 `--text-muted`; rows as member rows, the avatar a dashed `--dash` outline (the create tiles' "not yet" language); 30px ghost **Copy link** and danger **Revoke**; a 12.5px `--text-faint` note | Not in the design. |
| §16 toasts | "{name} added", "{name} can edit now", ... | Adds "Invite link created for {email}", "New invite link for {email}. The old link no longer works.", "Link copied", "New link copied for {email}. The old link no longer works.", "Invite for {email} revoked" | New actions. |

Known limitations, specific to this work:

- **An earlier copy of a link dies when Copy link is used again.** The cost of storing
  only a hash. Softened: signing in with the invited email accepts the invitation
  without any link.
- **Copying can fail in Safari after Copy link's round trip**, which can drop the user
  gesture a clipboard write needs. The sheet says so and the link stays in the field,
  selected on focus.
- **The invite path is in the host's request logs.** The app never logs a token, and no
  token goes into any other URL; Render's own HTTP logs record request paths, the
  invite page's included.
- **Used and expired invitations are kept.** Used ones are marked and hidden; expired
  ones stay listed until re-issued or revoked. Nothing purges them.
```

- [ ] **Step 9: Run the full gate and commit**

Run: `pnpm typecheck && pnpm --filter @crdt/web build && pnpm test && pnpm --filter @crdt/web exec playwright test`
Expected: PASS; Playwright 5 more tests than after Task 7.

```bash
git add apps/web/src/lib/invitations-client.ts apps/web/src/components/ShareSheet.tsx apps/web/src/components/share-sheet.module.css apps/web/src/components/AppShell.tsx apps/web/e2e/invitations.spec.ts apps/web/e2e/auth-flow.spec.ts docs/design/glass-handoff.md
git commit -m "feat(share): invite links, Copy link and an owner-only Invited list

Inviting an email with no account shows a link to send, remembering the document the
sheet was opened from. Copy link in the list makes a new link and says the old one
stops working. Non-owners see no invitations and the API refuses them."
```

---

## After the last task

- Confirm with `git status` that `README.md`, `CRDT workspace design.zip`, `.env*`, `docker-compose*`, `apps/web/next-env.d.ts` and `apps/web/AGENTS.md` are not staged or committed by this branch, and that `git log main..invite-links-and-nav --stat` touches only the files in the File Structure table.
- Search the diff for a token in a log line: `git diff main...invite-links-and-nav | grep -n "console\."` must show only the callback's sweep log, which logs a name and a code.
- **Do not push.** Tell the owner: the production Neon database needs `prisma migrate deploy` (with Neon's direct connection string, as for the authorship migration) **before** this branch is pushed to `main`, because Render deploys do not run migrations and every share-sheet open, invite and sign-in would query a table that does not exist.
