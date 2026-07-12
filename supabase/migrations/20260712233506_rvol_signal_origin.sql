alter table public.rvol_alert_dispatches
  add column if not exists signal_origin text not null default 'live_scan';

alter table public.rvol_alert_dispatches
  drop constraint if exists rvol_alert_dispatches_signal_origin_check;

alter table public.rvol_alert_dispatches
  add constraint rvol_alert_dispatches_signal_origin_check
  check (signal_origin in ('live_scan', 'historical_backtest'));
