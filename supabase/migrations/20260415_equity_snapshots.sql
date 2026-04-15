-- Phase 3G — daily equity snapshots for both brokers.
-- One row per (user, broker, snapshot_date). Cron writes at 21:05 UTC
-- weekdays after market close. Manual triggers via POST /api/equity/snapshot
-- are admin-gated. Reads (for chart rendering) go through
-- GET /api/equity/history. RLS on, no policies — service-role only.

create table if not exists equity_snapshots (
  id bigserial primary key,
  user_id uuid not null references auth.users,
  broker text not null,
  account_id text not null,
  snapshot_at timestamptz not null default now(),
  -- ET date for per-day keying. Keeps snapshot_at as the precise
  -- timestamp, but snapshot_date is what the unique index is keyed on
  -- so a cron retry within the same trading day overwrites rather than
  -- duplicates.
  snapshot_date date not null,
  equity numeric not null,
  cash numeric,
  buying_power numeric,
  day_pl numeric,
  open_pl numeric,
  positions_count integer
);

-- Idempotent daily write. Upsert on this key from the capture helper.
create unique index if not exists equity_snapshots_daily_idx
  on equity_snapshots (user_id, broker, snapshot_date);

-- Fast per-user-per-broker chronological queries for the history API.
create index if not exists equity_snapshots_user_broker_idx
  on equity_snapshots (user_id, broker, snapshot_at desc);

alter table equity_snapshots enable row level security;
