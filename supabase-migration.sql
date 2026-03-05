-- Run this in the Supabase SQL Editor for the longboard project
-- https://supabase.com/dashboard/project/qnwizieggisnbjqyxrjo/sql/new

create table if not exists ticker_research (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  status text not null default 'pending',
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable realtime
alter table ticker_research replica identity full;
alter publication supabase_realtime add table ticker_research;

-- Auto-update updated_at on row changes
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger ticker_research_updated_at
  before update on ticker_research
  for each row execute function update_updated_at();

-- Index for Buddy's polling query
create index ticker_research_status_idx on ticker_research(status, created_at);
