-- Phase 3L — essays table for /admin/essays list + /learn full-text
-- search. MDX files in content/essays/ remain the source of truth; this
-- table is a derived index, populated by scripts/sync-essays.mjs on
-- every Vercel build (via npm prebuild).
--
-- Weighting (per Phase 3L audit, Addenda A + C):
--   A — title, dek
--   B — kicker, marginalia (label + body text)
--   C — body (plain text; HTML/MDX stripped by the sync script), sources
--       (author + title + gloss concatenated)
--
-- marginalia_search and sources_search are sync-script-populated plain
-- text columns. Postgres generated columns can't reference subqueries,
-- so the sync script flattens the jsonb arrays into text columns that
-- the tsvector generator can consume directly.

create table if not exists essays (
  slug text primary key,
  issue integer not null,
  title text not null,
  kicker text,
  dek text,
  published date,
  read_minutes integer,
  audio_url text,
  daily_rank integer,
  publish_at timestamptz,
  marginalia jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  body text,
  marginalia_search text,
  sources_search text,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(dek, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(kicker, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(marginalia_search, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(sources_search, '')), 'C')
  ) stored,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists essays_search_idx on essays using gin(search_vector);
create index if not exists essays_issue_idx on essays(issue);
create index if not exists essays_daily_rank_idx on essays(daily_rank) where daily_rank is not null;

alter table essays enable row level security;

drop policy if exists "authenticated read" on essays;
create policy "authenticated read" on essays
  for select using (auth.role() = 'authenticated');

-- No insert/update/delete policies. Writes flow through the service
-- role key (sync script).
