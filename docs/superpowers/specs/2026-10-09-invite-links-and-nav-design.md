# Invite links and a Workspaces nav link

Approved by Dhanush on 2026-10-09 in chat. Two independent changes, one branch.

## 1. A "Workspaces" link in the nav

Today only the logo (aria-label "All workspaces") goes to `/`. Add a visible text link,
**Workspaces**, directly after the logo, styled like the nav's other text items. It goes to
`/`. On `/` itself it carries `aria-current="page"` and the nav's current-page styling, so it
does not read as a dead link. The logo keeps working.

Test: from a document, clicking Workspaces lands on `/`; on `/` the link is `aria-current`.

## 2. Inviting someone who has no account yet

### Today

`POST /api/workspaces/[id]/members` looks the email up in `User` and returns 404 if nobody
has signed in with it. The share sheet then says "We couldn't find … Ask them to sign in
once, then try again." Only owners can invite (`requireWorkspaceRole(..., 'owner')`).
Access is per workspace, not per document.

### Decisions (made by Dhanush)

- **No email service.** Inviting produces a link the owner copies and sends themselves.
- **A link only works for the invited email.** Someone signed in under a different email
  is told who the invite is for. A forwarded link is useless to anyone else.

### Behaviour

**Inviting.** In the share sheet (and the workspace page's members panel, which posts to the
same route), the owner enters an email and a role.
- If a user with that email exists, they are added at once, as today. Nothing else changes.
- Otherwise a pending invitation is stored and the route returns it. The sheet shows the
  invite link with a **Copy link** control and a toast. If the sheet was opened from a
  document, the invitation remembers that document, and accepting it lands there; otherwise
  it lands on the workspace.
- Inviting an email that already has a pending invitation to the same workspace replaces it:
  new token, new role, new expiry. The old link stops working.
- Email comparison is case-insensitive. Emails are stored lowercased and trimmed.

**The Invited list.** Owners see pending invitations under the members in the share sheet:
email, role, **Copy link**, **Revoke**. Revoking deletes the invitation, and its link stops
working. Non-owners do not see the list. The full link is shown only to owners.

Copy link must re-show a working link. The database holds only a hash of the token (see
Security), so the link cannot be rebuilt from storage. Choose one of these in the plan and
state which:
1. Copy link issues a fresh token. It invalidates the old link and resets the expiry, and
   the UI says so.
2. Store the token encrypted with a server secret, so the same link can be shown again.

Prefer option 1 unless it makes the UX misleading. It needs no new secret.

**The invite page** (`/invite/[token]`), public like `/login` and `/privacy`:
- Valid, signed out: "<inviter name> invited you to <edit|view|own> <document title, or the
  workspace name> in <workspace name>. Sign in as <invited email> to open it." Below that,
  the GitHub and Google buttons, with `next` set back to this page.
- Valid, signed in as the invited email: accept, which creates the membership, marks the
  invitation used, and redirects to the document, or the workspace if none.
- Valid, signed in as a different email: "This invite is for <email>. You're signed in as
  <other>." With a sign-out control that returns to this page.
- Expired, revoked, already used, or unknown token: one plain message, "This invite link is
  no longer valid. Ask the person who shared it for a new one." Do not reveal which case
  applies, or whether the token ever existed.
- Already a member (for example, added directly since): mark the invitation used and
  redirect.

**Accepting without the link.** When a user signs in, any pending, unexpired invitations for
their verified email are accepted: memberships are created and the invitations marked used.
This happens in the sign-in path (`resolveOAuthUser` or the callback route), after the user
is resolved. If they already have a membership, keep the existing role. Never downgrade
through an invite.

**Roles.** An invitation carries `viewer`, `editor` or `owner`, as the route accepts today.
Accepting never changes an existing member's role.

### Security

- Token: 32 random bytes, base64url. Only a SHA-256 hash is stored, and lookup is by hash.
- Expiry: 14 days from creation, or from the latest re-issue.
- Only owners can create, list, re-issue or revoke invitations, enforced in the API with the
  existing `requireWorkspaceRole` pattern. Each route does its own auth check, as every
  route under `workspaces/[id]` must.
- Accepting requires a signed-in user whose email equals the invitation's email. Provider
  emails are verified before a user exists (see `providers.ts` and `resolve-user.ts`).
- The invite page shows the inviter's name, the workspace name and the document title only
  for a valid token.
- The token must never appear in logs or analytics, and must never be placed in a URL other
  than the invite link itself.

### Data

A new Prisma model, `Invitation`, added in an additive migration:

| Field | Type |
|---|---|
| `id` | cuid |
| `workspaceId` | foreign key, cascade on delete |
| `email` | string, lowercased |
| `role` | `Role` |
| `documentId` | nullable foreign key, `SetNull` on delete |
| `invitedById` | nullable foreign key to `User`, `SetNull` on delete |
| `tokenHash` | string, unique |
| `expiresAt` | datetime |
| `acceptedAt` | nullable datetime |
| `createdAt` | datetime |

Constraints and indexes:
- unique on (`workspaceId`, `email`);
- an index on `email` for the sign-in sweep.

**Deployment:** the production Neon database needs `prisma migrate deploy` **before** the
push. Render deploys do not run migrations.

### Out of scope

- Sending email.
- Per-document permissions: access stays per workspace.
- "Anyone with the link" links.
- Invite quotas and rate limiting beyond owner-only access.

### Testing

End-to-end tests in a new spec, with per-label cleanup as the existing specs do:
- An owner invites an unknown email and the link appears.
- A new user signs in as that email through the link and lands in the document, with the
  right role.
- A different signed-in email sees the mismatch message and can sign out.
- A revoked link and an expired link show the invalid message.
- Re-inviting kills the old link.
- Signing in without the link accepts the pending invite.
- Existing-user invites behave exactly as before.
- Non-owners cannot list or create invitations, both via the API and in the UI.

Unit tests cover token hashing and lookup, and the case-insensitive email handling.
