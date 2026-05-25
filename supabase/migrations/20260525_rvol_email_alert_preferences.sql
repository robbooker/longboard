alter table rvol_alert_preferences
  add column if not exists email_enabled boolean not null default false;

alter table rvol_alert_dispatches
  add column if not exists browser_push_recipients_count integer not null default 0,
  add column if not exists email_recipients_count integer not null default 0,
  add column if not exists email_message_id text;
