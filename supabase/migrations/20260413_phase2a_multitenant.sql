-- Phase 2A Step 1 — multi-user foundation
-- Adds: profiles (role-aware), per-user broker key refs into Supabase Vault,
-- admin-issued invites, is_admin() helper, RLS across the board.
-- No app code changes yet; this migration is DB-only.

-- ── Extensions ─────────────────────────────────────────
-- pgsodium + supabase_vault let us store broker secrets as vault secret ids
-- instead of raw text. Per-user keys will be written via the vault RPC layer.
create extension if not exists pgsodium;
create extension if not exists supabase_vault;

-- ── profiles ───────────────────────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- ── is_admin() helper ──────────────────────────────────
-- security definer so RLS on profiles doesn't recurse when policies call this.
create or replace function is_admin(user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = user_id and role = 'admin'
  );
$$;

grant execute on function is_admin(uuid) to authenticated;

-- ── auth.users → profiles trigger ──────────────────────
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();

-- ── profiles: block self role escalation ───────────────
-- Policies below let users update their own row; this trigger ensures they
-- can't promote themselves to admin even if they smuggle role= into the patch.
create or replace function prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not is_admin(auth.uid())
  then
    raise exception 'only admins can change role';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_escalation on profiles;
create trigger profiles_prevent_role_escalation
  before update on profiles
  for each row
  execute function prevent_role_self_escalation();

-- ── profiles RLS policies ──────────────────────────────
drop policy if exists "profiles: read own or admin" on profiles;
create policy "profiles: read own or admin" on profiles
  for select
  using (id = auth.uid() or is_admin(auth.uid()));

drop policy if exists "profiles: user updates own" on profiles;
create policy "profiles: user updates own" on profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles: admin updates any" on profiles;
create policy "profiles: admin updates any" on profiles
  for update
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- ── user_broker_keys ───────────────────────────────────
-- One row per individual secret. vault_secret_id is a pointer into
-- vault.secrets; intentionally no FK (vault is a separate schema and
-- Supabase docs recommend against direct FKs across it).
create table if not exists user_broker_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  broker text not null check (broker in ('alpaca', 'tradezero')),
  vault_secret_id uuid not null,
  key_label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, broker, key_label)
);

alter table user_broker_keys enable row level security;

drop policy if exists "broker_keys: read own or admin" on user_broker_keys;
create policy "broker_keys: read own or admin" on user_broker_keys
  for select
  using (user_id = auth.uid() or is_admin(auth.uid()));

drop policy if exists "broker_keys: user inserts own" on user_broker_keys;
create policy "broker_keys: user inserts own" on user_broker_keys
  for insert
  with check (user_id = auth.uid());

drop policy if exists "broker_keys: user updates own" on user_broker_keys;
create policy "broker_keys: user updates own" on user_broker_keys
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "broker_keys: user deletes own" on user_broker_keys;
create policy "broker_keys: user deletes own" on user_broker_keys
  for delete
  using (user_id = auth.uid());

-- ── invites ────────────────────────────────────────────
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  invited_by uuid not null references auth.users(id),
  invited_by_email text not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  status text generated always as (
    case
      when revoked_at is not null then 'revoked'
      when accepted_at is not null then 'accepted'
      else 'pending'
    end
  ) stored
);

alter table invites enable row level security;

-- Admins only — non-admin users cannot see or touch invites.
drop policy if exists "invites: admin select" on invites;
create policy "invites: admin select" on invites
  for select
  using (is_admin(auth.uid()));

drop policy if exists "invites: admin insert" on invites;
create policy "invites: admin insert" on invites
  for insert
  with check (is_admin(auth.uid()));

drop policy if exists "invites: admin update" on invites;
create policy "invites: admin update" on invites
  for update
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- ── Bootstrap ──────────────────────────────────────────
-- Backfill profiles for any pre-existing auth.users (the trigger above only
-- fires on future inserts). Must run before the admin promotion so the
-- update target exists.
insert into profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Promote initial admin. No-op if the email hasn't signed up yet.
update profiles set role = 'admin' where email = 'madspreadsheets@gmail.com';
