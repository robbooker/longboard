create table if not exists rvol_alert_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  browser_push_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table rvol_alert_preferences enable row level security;

drop policy if exists "users read own rvol alert preference" on rvol_alert_preferences;
create policy "users read own rvol alert preference"
  on rvol_alert_preferences
  for select
  using (user_id = auth.uid());

drop policy if exists "users insert own rvol alert preference" on rvol_alert_preferences;
create policy "users insert own rvol alert preference"
  on rvol_alert_preferences
  for insert
  with check (user_id = auth.uid());

drop policy if exists "users update own rvol alert preference" on rvol_alert_preferences;
create policy "users update own rvol alert preference"
  on rvol_alert_preferences
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists rvol_alert_dispatches (
  alert_key text primary key,
  et_date date not null,
  ticker text not null,
  signal_unix_seconds bigint not null,
  signal_time_et text not null,
  signal_rvol numeric not null,
  signal_price numeric not null,
  change_pct numeric not null,
  onesignal_notification_id text,
  recipients_count integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

alter table rvol_alert_dispatches enable row level security;
