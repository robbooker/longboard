-- Phase 1.5 — self-serve kill switch
create table if not exists app_settings (
  id int primary key default 1,
  order_submission_enabled boolean not null default true,
  updated_by uuid references auth.users,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint singleton check (id = 1)
);

insert into app_settings (id, order_submission_enabled)
values (1, true)
on conflict (id) do nothing;

alter table app_settings enable row level security;

drop policy if exists "authenticated read" on app_settings;
create policy "authenticated read" on app_settings
  for select using (auth.role() = 'authenticated');
