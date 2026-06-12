-- Server-side cache for chart bar payloads used by /api/command2/chart-bars.
-- The route reads and writes through the service-role key only. No public RLS
-- policies are defined, and anon/authenticated grants are explicitly revoked.

create table if not exists chart_bars_cache (
  ticker text not null,
  resolution text not null,
  et_date date not null,
  lookback_days integer not null default 0,
  bars jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ticker, resolution, et_date, lookback_days),
  constraint chart_bars_cache_ticker_chk
    check (ticker = upper(ticker) and ticker ~ '^[A-Z][A-Z0-9.]{0,5}$'),
  constraint chart_bars_cache_resolution_chk
    check (resolution in ('1m', '5m', '1h', '4h', '1d')),
  constraint chart_bars_cache_lookback_chk
    check (lookback_days >= 0 and lookback_days <= 500),
  constraint chart_bars_cache_bars_array_chk
    check (jsonb_typeof(bars) = 'array'),
  constraint chart_bars_cache_expiry_chk
    check (expires_at >= fetched_at)
);

create index if not exists chart_bars_cache_expires_idx
  on chart_bars_cache (expires_at);

create index if not exists chart_bars_cache_ticker_idx
  on chart_bars_cache (ticker, resolution, et_date desc);

alter table chart_bars_cache enable row level security;

revoke all on chart_bars_cache from anon;
revoke all on chart_bars_cache from authenticated;
grant select, insert, update, delete on chart_bars_cache to service_role;
