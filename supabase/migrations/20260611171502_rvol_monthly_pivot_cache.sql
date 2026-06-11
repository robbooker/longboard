-- Daily cache for missed monthly pivot levels used by the live RVOL scanner.
-- Rows are keyed by trading date, ticker, and lookback window. The scanner
-- reads/writes through service-role API routes only; no public policies are
-- defined, so direct anon/authenticated access fails closed.

create table if not exists rvol_monthly_pivot_cache (
  et_date date not null,
  ticker text not null,
  lookback_months integer not null default 36,
  pivots jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (et_date, ticker, lookback_months),
  constraint rvol_monthly_pivot_cache_ticker_chk
    check (ticker = upper(ticker) and ticker ~ '^[A-Z][A-Z0-9]{0,5}$'),
  constraint rvol_monthly_pivot_cache_lookback_chk
    check (lookback_months between 1 and 120),
  constraint rvol_monthly_pivot_cache_pivots_array_chk
    check (jsonb_typeof(pivots) = 'array')
);

create index if not exists rvol_monthly_pivot_cache_et_date_idx
  on rvol_monthly_pivot_cache (et_date);

alter table rvol_monthly_pivot_cache enable row level security;

grant select, insert, update, delete on rvol_monthly_pivot_cache to service_role;
