-- Phase 3E Commit 2 — cached research for the daily small-cap movers list.
-- One row per (ticker, trading day). Historical rows are kept for post-hoc
-- analysis (Phase 4 "look back"). Writes go through service-role API
-- routes only — anon + authenticated roles have no path to these rows
-- beyond what the GET /api/research/cached handler exposes.

create table if not exists ticker_research (
  ticker text not null,
  as_of_date date not null,
  rank integer,
  rank_reason text,
  research jsonb not null,
  last_price numeric,
  last_price_updated_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (ticker, as_of_date)
);

create index if not exists ticker_research_rank_idx
  on ticker_research (as_of_date, rank)
  where rank is not null;

alter table ticker_research enable row level security;

-- No RLS policies defined. All access is intentionally gated at the API
-- layer. Service role bypasses RLS; anon + authenticated see an empty
-- result on any direct query, which is the fail-closed shape we want.
