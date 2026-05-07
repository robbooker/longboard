-- Morning report automation v1.
--
-- Keep the legacy morning_email_archive name, but extend it from "email
-- archive" into immutable report-version history with an explicit current
-- pointer.

alter table morning_email_archive
  add column if not exists report_date date,
  add column if not exists report_schema_version integer not null default 1,
  add column if not exists version_type text not null default 'manual_full_regeneration',
  add column if not exists status text not null default 'success',
  add column if not exists is_current boolean not null default false,
  add column if not exists current_pointer_key text not null default 'command_center',
  add column if not exists payload_json jsonb,
  add column if not exists prices_updated_at timestamptz,
  add column if not exists generated_at timestamptz,
  add column if not exists trigger text,
  add column if not exists job_run_id uuid;

alter table morning_email_archive
  add constraint morning_email_archive_version_type_check
  check (version_type in ('morning_build', 'manual_full_regeneration', 'live_refresh', 'closing_refresh'))
  not valid;

alter table morning_email_archive
  add constraint morning_email_archive_status_check
  check (status in ('success'))
  not valid;

alter table morning_email_archive
  add constraint morning_email_archive_trigger_check
  check (trigger is null or trigger in ('scheduled', 'admin', 'retry'))
  not valid;

update morning_email_archive
set
  report_date = coalesce(report_date, sent_date),
  generated_at = coalesce(generated_at, created_at),
  prices_updated_at = coalesce(prices_updated_at, created_at),
  payload_json = coalesce(
    payload_json,
    jsonb_build_object(
      'report_schema_version', report_schema_version,
      'date', sent_date,
      'subject', subject,
      'stocks', stocks_json,
      'qa', coalesce(qa_json, '[]'::jsonb),
      'closing1', '',
      'closing2', ''
    )
  );

with latest as (
  select id
  from morning_email_archive
  order by created_at desc
  limit 1
)
update morning_email_archive
set is_current = true, current_pointer_key = 'command_center'
where id in (select id from latest)
  and not exists (
    select 1
    from morning_email_archive
    where is_current = true
      and current_pointer_key = 'command_center'
  );

create unique index if not exists morning_email_archive_one_current_idx
  on morning_email_archive(current_pointer_key)
  where is_current = true;

create index if not exists morning_email_archive_current_created_idx
  on morning_email_archive(is_current, created_at desc);

create index if not exists morning_email_archive_report_date_created_idx
  on morning_email_archive(report_date desc, created_at desc);

create table if not exists morning_report_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('morning_build', 'manual_full_regeneration', 'live_refresh')),
  trigger text not null check (trigger in ('scheduled', 'admin', 'retry')),
  status text not null check (status in ('running', 'success', 'failed', 'skipped')),
  report_date date,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  tickers_attempted text[] not null default '{}',
  tickers_succeeded text[] not null default '{}',
  tickers_failed text[] not null default '{}',
  error_summary text,
  error_details jsonb,
  current_report_updated boolean not null default false,
  email_html_regenerated boolean not null default false,
  expensive_api_usage jsonb,
  created_by uuid references auth.users on delete set null,
  created_by_email text
);

create index if not exists morning_report_job_runs_type_status_started_idx
  on morning_report_job_runs(job_type, status, started_at desc);

create index if not exists morning_report_job_runs_report_date_started_idx
  on morning_report_job_runs(report_date desc, started_at desc);

alter table morning_report_job_runs enable row level security;

create table if not exists morning_report_locks (
  lock_key text primary key,
  job_run_id uuid references morning_report_job_runs on delete set null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists morning_report_locks_expires_idx
  on morning_report_locks(expires_at);

alter table morning_report_locks enable row level security;

create table if not exists morning_report_research_cache (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  ticker text not null,
  content_type text not null,
  content_json jsonb not null,
  metadata_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_date, ticker, content_type)
);

create index if not exists morning_report_research_cache_date_ticker_idx
  on morning_report_research_cache(report_date desc, ticker);

alter table morning_report_research_cache enable row level security;
