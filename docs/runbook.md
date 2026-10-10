# Runbook

## Account deletion requests

When someone asks for their account and data to be deleted:

1. Delete their `User` row, and whatever else the request covers. Deleting the user
   removes their memberships and sign-in identities through foreign keys. It does not
   remove workspaces they own (`Workspace.ownerId` is a plain column), and sessions are
   signed cookies with no table.
2. Also run, with the address they signed in with:

   ```sql
   DELETE FROM "Invitation" WHERE email = lower('<address>');
   ```

Why step 2 exists: `Invitation.email` has no foreign key to `User`, because an
invitation is made for an address that has no account yet. Deleting the user therefore
leaves any invitation rows for that address behind, and they hold the address. Invitations
the person sent are different: `invitedById` is set to null when they are deleted, and
those rows hold someone else's address, so they stay.

Run it against the production database the same way as any other one-off change (Neon's
direct connection string, not the pooled one), and check the count it reports.
