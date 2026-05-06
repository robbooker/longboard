-- Stock briefing system — schema only.
--
-- Two tables that together implement a request-queue + result-store pattern
-- for ticker briefings. /command2 (or any future surface) inserts a row into
-- briefing_requests; the Buddy worker polls pending rows, generates the
-- 9-section structured briefing, and writes the result to stock_briefings.
--
-- RLS is enabled on both tables with no policies. Service role bypasses RLS,
-- which is the only access path we need today. Anonymous browser access stays
-- blocked by default. A read policy for authenticated users will be added in a
-- later PR when /command2 needs direct browser reads.

-- Queue: one row per ticker/day request, lifecycle pending → running → done|error.
create table if not exists briefing_requests (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  briefing_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'error')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  requested_by uuid
);

create unique index if not exists briefing_requests_ticker_date_uniq
  on briefing_requests(ticker, briefing_date);

create index if not exists briefing_requests_status_requested_at_idx
  on briefing_requests(status, requested_at);

alter table briefing_requests enable row level security;

-- Results: one row per ticker/day briefing. payload holds the full structured output.
create table if not exists stock_briefings (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  briefing_date date not null,
  generated_at timestamptz not null default now(),
  payload jsonb not null,
  generated_by text default 'buddy'
);

create unique index if not exists stock_briefings_ticker_date_uniq
  on stock_briefings(ticker, briefing_date);

create index if not exists stock_briefings_briefing_date_idx
  on stock_briefings(briefing_date);

alter table stock_briefings enable row level security;
