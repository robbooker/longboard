alter table public.rvol_alert_dispatches
  add column if not exists signal_breakout_mode text not null default 'premarketHigh',
  add column if not exists breakout_level numeric,
  add column if not exists rvol_method text not null default 'sameDayRolling';

alter table public.rvol_alert_dispatches
  drop constraint if exists rvol_alert_dispatches_signal_breakout_mode_check;
alter table public.rvol_alert_dispatches
  add constraint rvol_alert_dispatches_signal_breakout_mode_check
  check (signal_breakout_mode in ('premarketHigh', 'openingRangeHigh'));

alter table public.rvol_alert_dispatches
  drop constraint if exists rvol_alert_dispatches_rvol_method_check;
alter table public.rvol_alert_dispatches
  add constraint rvol_alert_dispatches_rvol_method_check
  check (rvol_method in ('sameDayRolling', 'historicalTimeOfDay'));

create table if not exists public.rvol_scan_diagnostics (
  et_date date not null,
  signal_resolution text not null,
  ticker text not null,
  evaluated_at timestamptz not null default now(),
  evaluation_source text not null default 'live_scan',
  qualified boolean not null default false,
  breakout_mode text not null,
  rvol_method text not null,
  best_bar_unix_seconds bigint,
  best_bar_time_et text,
  rejection_reasons text[] not null default '{}'::text[],
  conditions_passed smallint not null default 0,
  signal_rvol numeric,
  breakout_level numeric,
  cumulative_volume bigint not null default 0,
  cumulative_volume_pace numeric,
  baseline_sessions smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (et_date, signal_resolution, ticker),
  constraint rvol_scan_diagnostics_resolution_check
    check (signal_resolution in ('1m', '5m', '1h', '4h')),
  constraint rvol_scan_diagnostics_ticker_check
    check (ticker = upper(ticker) and ticker ~ '^[A-Z0-9.-]+$'),
  constraint rvol_scan_diagnostics_breakout_mode_check
    check (breakout_mode in ('premarketHigh', 'openingRangeHigh')),
  constraint rvol_scan_diagnostics_rvol_method_check
    check (rvol_method in ('sameDayRolling', 'historicalTimeOfDay')),
  constraint rvol_scan_diagnostics_source_check
    check (evaluation_source in ('live_scan', 'historical_backtest')),
  constraint rvol_scan_diagnostics_conditions_check
    check (conditions_passed between 0 and 6),
  constraint rvol_scan_diagnostics_cumulative_volume_check
    check (cumulative_volume >= 0),
  constraint rvol_scan_diagnostics_baseline_sessions_check
    check (baseline_sessions >= 0)
);

create index if not exists rvol_scan_diagnostics_ticker_date_idx
  on public.rvol_scan_diagnostics (ticker, et_date desc);

alter table public.rvol_scan_diagnostics enable row level security;

revoke all on table public.rvol_scan_diagnostics from anon, authenticated;
grant select, insert, update, delete on table public.rvol_scan_diagnostics to service_role;
