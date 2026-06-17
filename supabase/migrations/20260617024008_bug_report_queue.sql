create table if not exists bug_report_queue (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 240),
  description text not null check (char_length(description) between 1 and 4000),
  page_url text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'ignored', 'promoted', 'archived')),
  source text not null default 'web'
    check (source in ('web', 'slack', 'admin', 'codex')),
  reported_by uuid references auth.users(id) on delete set null,
  reported_by_email text,
  slack_posted_at timestamptz,
  slack_error text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_by_email text,
  reviewed_at timestamptz,
  review_note text,
  promoted_codex_task_id uuid references codex_task_queue(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bug_report_queue_status_created_idx
  on bug_report_queue(status, created_at desc);

create index if not exists bug_report_queue_reported_by_idx
  on bug_report_queue(reported_by, created_at desc);

alter table bug_report_queue enable row level security;

grant select, insert, update, delete on bug_report_queue to authenticated;
grant select, insert, update, delete on bug_report_queue to service_role;

drop policy if exists "members create bug reports" on bug_report_queue;
create policy "members create bug reports"
  on bug_report_queue
  for insert
  to authenticated
  with check (
    auth.uid() = reported_by
    and status = 'pending'
    and source = 'web'
  );

drop policy if exists "members read own bug reports" on bug_report_queue;
create policy "members read own bug reports"
  on bug_report_queue
  for select
  to authenticated
  using (auth.uid() = reported_by);

drop policy if exists "admins manage bug reports" on bug_report_queue;
create policy "admins manage bug reports"
  on bug_report_queue
  for all
  to authenticated
  using (
    exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
