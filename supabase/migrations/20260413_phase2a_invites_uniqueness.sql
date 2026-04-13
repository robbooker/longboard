-- Phase 2A Step 4 — relax invites.email uniqueness
-- The Step 1 schema enforced unique(email) on invites, which made it
-- impossible to re-invite someone after their invite was revoked (or even
-- accepted-then-later-revoked in the future). Replace with a partial unique
-- index scoped to non-revoked rows so revoke → re-invite works, but two
-- simultaneously-pending invites for the same address are still blocked.

-- Drop the existing unique constraint on email. Name follows the Postgres
-- convention (<table>_<column>_key) used by the Step 1 migration.
alter table invites drop constraint if exists invites_email_key;

-- Partial unique index: only active (non-revoked) rows must be unique by email.
create unique index if not exists invites_email_active_unique
  on invites (email)
  where revoked_at is null;
