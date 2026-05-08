-- Durable app-owned invite links.
--
-- Supabase Auth invite/recovery emails are one-shot and time-limited. These
-- columns let Longboard issue its own high-entropy invite token, store only a
-- hash, and keep the link usable until an admin revokes it or the invite is
-- accepted.

alter table invites
  add column if not exists invite_token_hash text,
  add column if not exists invite_token_created_at timestamptz,
  add column if not exists invite_token_last_sent_at timestamptz;

create unique index if not exists invites_token_hash_unique
  on invites (invite_token_hash)
  where invite_token_hash is not null;
