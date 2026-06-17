create index if not exists bug_report_queue_reviewed_by_idx
  on bug_report_queue(reviewed_by);

create index if not exists bug_report_queue_promoted_codex_task_id_idx
  on bug_report_queue(promoted_codex_task_id);

drop policy if exists "members create bug reports" on bug_report_queue;
drop policy if exists "members read own bug reports" on bug_report_queue;
drop policy if exists "admins manage bug reports" on bug_report_queue;
drop policy if exists "bug reports select access" on bug_report_queue;
drop policy if exists "bug reports insert access" on bug_report_queue;
drop policy if exists "admins update bug reports" on bug_report_queue;
drop policy if exists "admins delete bug reports" on bug_report_queue;

create policy "bug reports select access"
  on bug_report_queue
  for select
  to authenticated
  using (
    auth.uid() = reported_by
    or exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

create policy "bug reports insert access"
  on bug_report_queue
  for insert
  to authenticated
  with check (
    (
      auth.uid() = reported_by
      and status = 'pending'
      and source = 'web'
    )
    or exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

create policy "admins update bug reports"
  on bug_report_queue
  for update
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

create policy "admins delete bug reports"
  on bug_report_queue
  for delete
  to authenticated
  using (
    exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
