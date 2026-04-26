-- Phase 4A — Boardroom members area.
--
-- Private /boardroom surface for Cohort 1 members. Gated by a generic
-- user_tags table (no Kit dependency). A row { user_id, tag:
-- 'boardroom-cohort-1' } in user_tags grants access to /boardroom for
-- cohort 'cohort-1'. The same user_tags table is reusable for any
-- future tag-based feature gating.
--
-- Six content surfaces, all keyed by `cohort` text (e.g. 'cohort-1').
-- Tasks are personal-per-user (keyed by user_id). Stats and welcome
-- are singletons (one row per cohort).
--
-- RLS is on for every table. Read policies let an authenticated user
-- SELECT rows scoped to a cohort they hold a matching user_tags row
-- for. Member-side writes (own tasks, vote toggles, submitting feature
-- requests) have explicit insert/update/delete policies. All admin
-- writes (welcome edit, publishing meetings, editing stats) go through
-- service-role API routes at /api/admin/boardroom/* which bypass RLS.
--
-- Idempotent on re-apply.

-- ── user_tags (generic, reusable beyond boardroom) ───────────────────
create table if not exists user_tags (
  user_id uuid not null references auth.users on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users,
  primary key (user_id, tag)
);
create index if not exists user_tags_tag_idx on user_tags(tag);

-- ── boardroom_welcome (singleton per cohort, markdown) ───────────────
create table if not exists boardroom_welcome (
  cohort text primary key,
  body_markdown text not null,
  updated_by uuid references auth.users,
  updated_at timestamptz not null default now()
);

-- ── boardroom_events (calendar) ──────────────────────────────────────
create table if not exists boardroom_events (
  id uuid primary key default gen_random_uuid(),
  cohort text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  title text not null,
  subtitle text,                       -- e.g. "10am CT · Zoom"
  rsvp_url text,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists boardroom_events_cohort_starts_idx
  on boardroom_events(cohort, starts_at);

-- ── boardroom_tasks (personal-per-user, NOT cohort-scoped) ───────────
create table if not exists boardroom_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  due_date date,
  is_done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists boardroom_tasks_user_idx
  on boardroom_tasks(user_id, is_done, due_date);

-- ── boardroom_meetings ───────────────────────────────────────────────
create table if not exists boardroom_meetings (
  id uuid primary key default gen_random_uuid(),
  cohort text not null,
  meeting_date date not null,
  title text not null,
  summary text,
  video_url text,                      -- provider TBD (Mux/Loom/etc)
  duration_seconds integer,
  tags text[] default '{}',
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists boardroom_meetings_cohort_date_idx
  on boardroom_meetings(cohort, meeting_date desc);

-- ── boardroom_announcements ──────────────────────────────────────────
create table if not exists boardroom_announcements (
  id uuid primary key default gen_random_uuid(),
  cohort text not null,
  title text not null,
  body text,
  kind text not null default 'info',   -- 'info' | 'success' | 'warning'
  posted_at timestamptz not null default now(),
  is_published boolean not null default true
);
create index if not exists boardroom_announcements_cohort_posted_idx
  on boardroom_announcements(cohort, posted_at desc);

-- ── boardroom_roadmap ────────────────────────────────────────────────
create table if not exists boardroom_roadmap (
  id uuid primary key default gen_random_uuid(),
  cohort text not null,
  title text not null,
  status text not null,                -- 'shipped' | 'in_flight' | 'next' | 'later'
  sort_order integer not null default 0,
  is_published boolean not null default true
);
create index if not exists boardroom_roadmap_cohort_sort_idx
  on boardroom_roadmap(cohort, sort_order);

-- ── boardroom_feature_requests ───────────────────────────────────────
create table if not exists boardroom_feature_requests (
  id uuid primary key default gen_random_uuid(),
  cohort text not null,
  title text not null,
  body text,
  upvote_count integer not null default 0,
  submitted_by uuid references auth.users,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists boardroom_feature_requests_cohort_votes_idx
  on boardroom_feature_requests(cohort, upvote_count desc);

-- ── boardroom_feature_request_votes (one per user per request) ──────
create table if not exists boardroom_feature_request_votes (
  request_id uuid references boardroom_feature_requests on delete cascade,
  user_id uuid references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

-- ── boardroom_stats (singleton per cohort, manual entry) ─────────────
-- Display fields are TEXT so admins control formatting ('$2,026,000',
-- '200 / 200'). Subtext fields drive the small grey caption under each
-- big number.
create table if not exists boardroom_stats (
  cohort text primary key,
  total_sales_display text not null default '$0',
  total_sales_subtext text,
  collected_display text not null default '$0',
  collected_subtext text,
  members_display text not null default '0 / 0',
  members_subtext text,
  new_leads_display text not null default '0',
  new_leads_subtext text,
  updated_by uuid references auth.users,
  updated_at timestamptz not null default now()
);

-- ── RLS enable ───────────────────────────────────────────────────────
alter table user_tags                          enable row level security;
alter table boardroom_welcome                  enable row level security;
alter table boardroom_events                   enable row level security;
alter table boardroom_tasks                    enable row level security;
alter table boardroom_meetings                 enable row level security;
alter table boardroom_announcements            enable row level security;
alter table boardroom_roadmap                  enable row level security;
alter table boardroom_feature_requests         enable row level security;
alter table boardroom_feature_request_votes    enable row level security;
alter table boardroom_stats                    enable row level security;

-- ── Read policies ────────────────────────────────────────────────────
-- Cohort-scoped reads use a subquery against user_tags. Tag format is
-- 'boardroom-' + cohort, so 'cohort-1' ↔ 'boardroom-cohort-1'.
-- Drop-and-recreate to keep this migration re-runnable.

drop policy if exists "users read own tags" on user_tags;
create policy "users read own tags"
  on user_tags for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "members read welcome for own cohort" on boardroom_welcome;
create policy "members read welcome for own cohort"
  on boardroom_welcome for select
  to authenticated
  using (
    exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || boardroom_welcome.cohort
    )
  );

drop policy if exists "members read published events for own cohort" on boardroom_events;
create policy "members read published events for own cohort"
  on boardroom_events for select
  to authenticated
  using (
    is_published
    and exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || boardroom_events.cohort
    )
  );

drop policy if exists "users read own tasks" on boardroom_tasks;
create policy "users read own tasks"
  on boardroom_tasks for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "members read published meetings for own cohort" on boardroom_meetings;
create policy "members read published meetings for own cohort"
  on boardroom_meetings for select
  to authenticated
  using (
    is_published
    and exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || boardroom_meetings.cohort
    )
  );

drop policy if exists "members read published announcements for own cohort" on boardroom_announcements;
create policy "members read published announcements for own cohort"
  on boardroom_announcements for select
  to authenticated
  using (
    is_published
    and exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || boardroom_announcements.cohort
    )
  );

drop policy if exists "members read published roadmap for own cohort" on boardroom_roadmap;
create policy "members read published roadmap for own cohort"
  on boardroom_roadmap for select
  to authenticated
  using (
    is_published
    and exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || boardroom_roadmap.cohort
    )
  );

drop policy if exists "members read published feature requests for own cohort" on boardroom_feature_requests;
create policy "members read published feature requests for own cohort"
  on boardroom_feature_requests for select
  to authenticated
  using (
    is_published
    and exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || boardroom_feature_requests.cohort
    )
  );

drop policy if exists "users read own votes" on boardroom_feature_request_votes;
create policy "users read own votes"
  on boardroom_feature_request_votes for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "members read stats for own cohort" on boardroom_stats;
create policy "members read stats for own cohort"
  on boardroom_stats for select
  to authenticated
  using (
    exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || boardroom_stats.cohort
    )
  );

-- ── Member-write policies ────────────────────────────────────────────
-- These cover the three member-controllable surfaces in Commit 6:
-- own tasks (CRUD), feature request submission (insert only — admin
-- moderates publish), and upvote toggling (insert/delete own row).
-- Everything else is admin-only and goes through service-role API
-- routes that bypass RLS entirely.

drop policy if exists "users insert own tasks" on boardroom_tasks;
create policy "users insert own tasks"
  on boardroom_tasks for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users update own tasks" on boardroom_tasks;
create policy "users update own tasks"
  on boardroom_tasks for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "users delete own tasks" on boardroom_tasks;
create policy "users delete own tasks"
  on boardroom_tasks for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "members insert feature requests for own cohort" on boardroom_feature_requests;
create policy "members insert feature requests for own cohort"
  on boardroom_feature_requests for insert
  to authenticated
  with check (
    submitted_by = auth.uid()
    and exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || cohort
    )
  );

drop policy if exists "users insert own votes" on boardroom_feature_request_votes;
create policy "users insert own votes"
  on boardroom_feature_request_votes for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users delete own votes" on boardroom_feature_request_votes;
create policy "users delete own votes"
  on boardroom_feature_request_votes for delete
  to authenticated
  using (user_id = auth.uid());
