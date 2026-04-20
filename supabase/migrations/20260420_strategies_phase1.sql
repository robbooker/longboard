-- Strategies Phase 1 — the /strategies surface.
--
-- Four tables, all carrying `strategy_id` so future strategies (Black
-- Swan, Covered Caller) slot in without migrations. Seeded with three
-- rows: long-short (live), black-swan (planned), covered-caller (planned).
--
-- RLS on. No read policies — the /strategies page and /admin reads go
-- through service-role-backed API routes (same pattern as /api/admin/audit).
-- Writes are always service role (from the morning routine).

create table if not exists strategies (
  id text primary key,                     -- slug, e.g. 'long-short'
  name text not null,                      -- display name
  status text not null default 'planned',  -- 'live' | 'planned' | 'paused'
  mandate text not null,                   -- one-sentence mandate
  spec_path text not null,                 -- repo path to canonical spec md
  starting_capital numeric,
  started_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists strat_runs (
  id uuid primary key default gen_random_uuid(),
  strategy_id text not null references strategies(id),
  run_type text not null,                  -- 'morning' | 'eod' | 'weekly'
  ran_at timestamptz not null,
  inputs jsonb,                            -- research bundle Claude received
  output jsonb,                            -- structured decisions
  writeup_md text,                         -- full markdown writeup
  status text not null,                    -- 'ok' | 'error' | 'skipped' | 'running'
  error text,
  created_at timestamptz not null default now()
);

create table if not exists strat_positions (
  id uuid primary key default gen_random_uuid(),
  strategy_id text not null references strategies(id),
  ticker text not null,
  side text not null,                      -- 'long' | 'short'
  opened_at timestamptz not null,
  closed_at timestamptz,
  qty numeric not null,
  entry_price numeric not null,
  exit_price numeric,
  stop_price numeric not null,             -- required; set at entry
  thesis text not null,
  opened_by_run_id uuid references strat_runs(id),
  closed_by_run_id uuid references strat_runs(id),
  pnl numeric,                             -- filled on close
  created_at timestamptz not null default now()
);

create table if not exists strat_trades (
  id uuid primary key default gen_random_uuid(),
  strategy_id text not null references strategies(id),
  position_id uuid references strat_positions(id),
  run_id uuid references strat_runs(id),
  ticker text not null,
  side text not null,                      -- 'buy' | 'sell' | 'sell_short' | 'buy_to_cover'
  qty numeric not null,
  order_type text not null,
  alpaca_order_id text,
  submitted_at timestamptz,
  filled_at timestamptz,
  fill_price numeric,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists strat_runs_strategy_ran_idx
  on strat_runs(strategy_id, ran_at desc);
create index if not exists strat_positions_strategy_open_idx
  on strat_positions(strategy_id, closed_at) where closed_at is null;
create index if not exists strat_trades_strategy_submitted_idx
  on strat_trades(strategy_id, submitted_at desc);

alter table strategies        enable row level security;
alter table strat_runs        enable row level security;
alter table strat_positions   enable row level security;
alter table strat_trades      enable row level security;

-- ── Seed ─────────────────────────────────────────────────────────────
-- Idempotent on re-apply: `on conflict (id) do update` so edits to the
-- mandate or spec_path land without needing a new migration.

insert into strategies (id, name, status, mandate, spec_path, starting_capital, started_at)
values
  ('long-short',
   'Long/Short Portfolio',
   'live',
   'Trade on current events. Do not lose a lot of money when wrong.',
   'docs/strategies/long-short.md',
   100000,
   now()),
  ('black-swan',
   'Black Swan',
   'planned',
   'Continuously long volatility via UVXY-type calls.',
   'docs/strategies/black-swan.md',
   null,
   null),
  ('covered-caller',
   'Covered Caller',
   'planned',
   'Index shares + daily-expiry covered calls.',
   'docs/strategies/covered-caller.md',
   null,
   null)
on conflict (id) do update set
  name = excluded.name,
  status = excluded.status,
  mandate = excluded.mandate,
  spec_path = excluded.spec_path,
  starting_capital = excluded.starting_capital,
  started_at = coalesce(strategies.started_at, excluded.started_at);
