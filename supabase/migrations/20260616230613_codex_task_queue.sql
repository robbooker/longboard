-- Codex task inbox.
--
-- This table is the shared queue behind the private /codex web inbox and
-- future inputs such as Slack or Apple Shortcuts. Admins can manage tasks
-- through Longboard. Background workers use the service role.

create table if not exists codex_task_queue (
  id uuid primary key default gen_random_uuid(),
  list text not null default 'longboard',
  title text not null check (char_length(title) between 1 and 500),
  notes text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'done', 'archived')),
  source text not null default 'web'
    check (source in ('web', 'slack', 'shortcut', 'menu_bar', 'codex')),
  created_by uuid references auth.users on delete set null,
  created_by_email text,
  claimed_at timestamptz,
  completed_at timestamptz,
  completed_by text,
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists codex_task_queue_status_created_idx
  on codex_task_queue(status, created_at);

create index if not exists codex_task_queue_list_status_idx
  on codex_task_queue(list, status, created_at);

alter table codex_task_queue enable row level security;

grant select, insert, update, delete on codex_task_queue to authenticated;
grant select, insert, update, delete on codex_task_queue to service_role;

drop policy if exists "admins manage codex task queue" on codex_task_queue;
create policy "admins manage codex task queue"
  on codex_task_queue
  for all
  to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
