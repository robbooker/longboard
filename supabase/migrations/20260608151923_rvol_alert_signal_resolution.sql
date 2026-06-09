alter table rvol_alert_dispatches
  add column if not exists signal_resolution text not null default '1m';

alter table rvol_alert_dispatches
  drop constraint if exists rvol_alert_dispatches_signal_resolution_check;

alter table rvol_alert_dispatches
  add constraint rvol_alert_dispatches_signal_resolution_check
  check (signal_resolution in ('1m', '5m'));

create index if not exists rvol_alert_dispatches_resolution_created_at_idx
  on rvol_alert_dispatches (signal_resolution, created_at desc);
