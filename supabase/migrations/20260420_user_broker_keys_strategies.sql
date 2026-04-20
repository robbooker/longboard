-- Strategies Phase 1 — extend user_broker_keys to hold strategy-scoped
-- creds alongside the existing per-user rows. Rob's decision on audit
-- Addendum Q2: reuse the existing table, don't split into a second one,
-- so rotation/audit tooling stays uniform.
--
-- Shape of the change:
--   * user_id becomes nullable
--   * new strategy_id column, text FK → strategies(id)
--   * XOR constraint: exactly one of user_id / strategy_id is set
--   * surrogate uuid PK (the old composite PK had user_id NOT NULL)
--   * two partial unique indexes replace the old composite PK's
--     uniqueness guarantee — one per scope
--   * RLS policies preserved; strategy-scoped rows are only reachable
--     via service role (policies reference auth.uid() / is_admin, both
--     of which resolve strategy rows as not-yours, not-readable by
--     non-admins — by intent)

-- ── Drop the composite PK ─────────────────────────────────────────────
alter table user_broker_keys
  drop constraint if exists user_broker_keys_pkey;

-- ── Relax user_id to nullable ─────────────────────────────────────────
alter table user_broker_keys
  alter column user_id drop not null;

-- ── Add strategy_id, XOR constraint, surrogate PK ─────────────────────
alter table user_broker_keys
  add column if not exists id uuid not null default gen_random_uuid();

alter table user_broker_keys
  add column if not exists strategy_id text references strategies(id);

alter table user_broker_keys
  add constraint user_broker_keys_scope_xor
  check ((user_id is not null) <> (strategy_id is not null));

alter table user_broker_keys
  add primary key (id);

-- ── Partial unique indexes per scope ──────────────────────────────────
-- Replace the old (user_id, broker, key_label) uniqueness guarantee.
create unique index if not exists user_broker_keys_user_scope_unique
  on user_broker_keys (user_id, broker, key_label)
  where user_id is not null;

create unique index if not exists user_broker_keys_strategy_scope_unique
  on user_broker_keys (strategy_id, broker, key_label)
  where strategy_id is not null;

-- ── RLS unchanged ─────────────────────────────────────────────────────
-- Existing policies ("read own or admin", "user inserts/updates/deletes
-- own") keep evaluating against user_id = auth.uid(). For strategy-scoped
-- rows (user_id null), those predicates evaluate to NULL, so non-admin
-- users can't see or touch them — exactly the intent. Admins can read
-- via the "or is_admin(auth.uid())" branch. Writes for strategy rows
-- go through the service role, which bypasses RLS.

-- ── Helper comment on seeding ─────────────────────────────────────────
-- To seed the Long/Short Portfolio's paper-trading creds:
--
--   with k as (
--     insert into vault.secrets (name, secret)
--     values ('strategy:long-short:alpaca:api_key', '<paste key>')
--     returning id
--   )
--   insert into user_broker_keys (strategy_id, broker, key_label, vault_secret_id)
--   select 'long-short', 'alpaca', 'api_key', id from k;
--
-- Repeat for api_secret and (optionally) base_url. Prefer the
-- app_vault_create_secret(p_value, p_name) RPC if the vault.secrets
-- direct-insert path isn't available in your environment — that's the
-- same RPC lib/brokerKeys.ts already uses.
