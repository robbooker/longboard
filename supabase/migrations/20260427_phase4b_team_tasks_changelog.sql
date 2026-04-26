-- Phase 4B — boardroom sub-pages schema.
--
-- Three independent changes wrapped in one migration:
--   1. boardroom_tasks: convert from personal-per-user (Phase 4A) to
--      cohort-visible team tasks. Adds cohort, assignee_id, category,
--      status (replaces is_done with a 3-state), description, and
--      promoted_from_request_id. Drops user_id and is_done after
--      backfilling created_by/assignee_id and status.
--   2. boardroom_changelog: new admin-curated table for platform
--      updates. Same RLS shape as boardroom_announcements.
--   3. boardroom_meetings: add transcript_url column.
--   4. boardroom_feature_requests: add accepted_task_id (FK to
--      boardroom_tasks) so the Commit 4 promote-to-task flow has
--      somewhere to record the link. Folded into this migration to
--      keep the schema atomic — no second migration needed before
--      Commit 4 lands.
--
-- Idempotent on re-apply via `if not exists` / `if exists` /
-- `drop policy if exists` / `on conflict do nothing` patterns.

-- ── boardroom_tasks: schema additions ───────────────────────────────
alter table boardroom_tasks add column if not exists cohort text;
alter table boardroom_tasks add column if not exists assignee_id uuid
  references auth.users on delete set null;
alter table boardroom_tasks add column if not exists category text;
alter table boardroom_tasks add column if not exists status text not null default 'open';
  -- 'open' | 'in_progress' | 'done'
alter table boardroom_tasks add column if not exists description text;
alter table boardroom_tasks add column if not exists promoted_from_request_id uuid
  references boardroom_feature_requests on delete set null;
alter table boardroom_tasks add column if not exists created_by uuid
  references auth.users on delete set null;

-- ── boardroom_tasks: backfill ───────────────────────────────────────
-- Preserve existing personal-task rows so Phase 4A members don't lose
-- their lists. cohort defaults to cohort-1 (only cohort in production);
-- ownership maps to both created_by and assignee_id (the original
-- author keeps doing the work); is_done maps to status='done'.
update boardroom_tasks set cohort = 'cohort-1' where cohort is null;
update boardroom_tasks
  set status = case when is_done then 'done' else 'open' end
  where is_done is not null;
update boardroom_tasks
  set created_by = user_id, assignee_id = user_id
  where created_by is null and user_id is not null;

alter table boardroom_tasks alter column cohort set not null;

-- ── boardroom_tasks: drop OLD policies BEFORE dropping their column ─
-- The Phase 4A RLS policies all reference user_id. Dropping the column
-- without dropping the policies first would error ("cannot drop column
-- because policy depends on it").
drop policy if exists "users read own tasks" on boardroom_tasks;
drop policy if exists "users insert own tasks" on boardroom_tasks;
drop policy if exists "users update own tasks" on boardroom_tasks;
drop policy if exists "users delete own tasks" on boardroom_tasks;

-- Now safe to drop. The boardroom_tasks_user_idx index from Phase 4A
-- is auto-dropped by Postgres because it references user_id/is_done.
alter table boardroom_tasks drop column if exists user_id;
alter table boardroom_tasks drop column if exists is_done;

-- ── boardroom_tasks: indexes for the team-tasks model ───────────────
create index if not exists boardroom_tasks_cohort_status_idx
  on boardroom_tasks(cohort, status, category);
create index if not exists boardroom_tasks_assignee_idx
  on boardroom_tasks(assignee_id) where assignee_id is not null;

-- ── boardroom_tasks: NEW policies for team-tasks model ──────────────
-- Read: any cohort member sees all tasks for their cohort.
-- Insert: must be created_by self AND must hold the cohort tag.
-- Update: creator OR current assignee (so anyone can re-assign or
--   bump status on tasks they own / are working on). Admins handle
--   anything else via service-role.
-- Delete: creator only. Admins handle everything else via service-role.

create policy "members read tasks for own cohort"
  on boardroom_tasks for select
  to authenticated
  using (
    exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || boardroom_tasks.cohort
    )
  );

create policy "members insert tasks for own cohort"
  on boardroom_tasks for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || cohort
    )
  );

create policy "members update tasks they own or are assigned"
  on boardroom_tasks for update
  to authenticated
  using (created_by = auth.uid() or assignee_id = auth.uid())
  with check (created_by = auth.uid() or assignee_id = auth.uid());

create policy "members delete tasks they created"
  on boardroom_tasks for delete
  to authenticated
  using (created_by = auth.uid());

-- ── boardroom_changelog (new table) ─────────────────────────────────
create table if not exists boardroom_changelog (
  id uuid primary key default gen_random_uuid(),
  cohort text not null,
  title text not null,
  body text,
  kind text not null default 'feature',  -- 'feature' | 'fix' | 'infra' | 'note'
  posted_at timestamptz not null default now(),
  is_published boolean not null default true
);
create index if not exists boardroom_changelog_cohort_posted_idx
  on boardroom_changelog(cohort, posted_at desc);

alter table boardroom_changelog enable row level security;

drop policy if exists "members read published changelog for own cohort" on boardroom_changelog;
create policy "members read published changelog for own cohort"
  on boardroom_changelog for select
  to authenticated
  using (
    is_published
    and exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || boardroom_changelog.cohort
    )
  );

-- ── boardroom_meetings: transcript URL ──────────────────────────────
alter table boardroom_meetings add column if not exists transcript_url text;

-- ── boardroom_feature_requests: accepted_task_id (Commit 4 prep) ────
-- When admin promotes a feature request to a task (Phase 4B Commit 4),
-- this column records the link so the request UI can show "✓ Accepted"
-- and link through to the resulting task. on delete set null so a
-- deleted task doesn't cascade-delete the request.
alter table boardroom_feature_requests add column if not exists accepted_task_id uuid
  references boardroom_tasks on delete set null;
