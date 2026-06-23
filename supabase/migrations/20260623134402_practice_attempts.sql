create table if not exists practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  setup_key text not null,
  account_balance numeric not null check (account_balance > 0),
  attempt_number integer not null default 1 check (attempt_number > 0),
  completed_at timestamptz,
  executions jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  reveal jsonb not null default '{}'::jsonb,
  self_score text not null default 'unscored'
    check (self_score in ('unscored', 'good', 'mixed', 'poor')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists practice_attempts_user_created_idx
  on practice_attempts(user_id, created_at desc);

create index if not exists practice_attempts_user_setup_idx
  on practice_attempts(user_id, setup_key, attempt_number);

alter table practice_attempts enable row level security;

grant select, insert, update, delete on practice_attempts to authenticated;
grant select, insert, update, delete on practice_attempts to service_role;

drop policy if exists "users read own practice attempts" on practice_attempts;
create policy "users read own practice attempts"
  on practice_attempts
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users insert own practice attempts" on practice_attempts;
create policy "users insert own practice attempts"
  on practice_attempts
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users update own practice attempts" on practice_attempts;
create policy "users update own practice attempts"
  on practice_attempts
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "users delete own practice attempts" on practice_attempts;
create policy "users delete own practice attempts"
  on practice_attempts
  for delete
  to authenticated
  using (user_id = auth.uid());
