-- Phase 3L — search RPC for /api/essays/search.
--
-- Encapsulates the ts_rank_cd + ts_headline query so the API route
-- calls it as a single Supabase `.rpc('search_essays', …)`. Alternative
-- — inlining the raw SQL in the TS route — would require bypassing the
-- Supabase JS client, which has no generic SQL surface. The RPC is the
-- idiomatic Supabase pattern.
--
-- security invoker so RLS on the `essays` table is honored (the
-- existing "authenticated read" policy grants select to any signed-in
-- user). `include_scheduled` lets admin-gated callers see essays whose
-- `publish_at` is in the future; default false for public-facing calls.

create or replace function search_essays(q text, include_scheduled boolean default false)
returns table (
  slug text,
  issue integer,
  title text,
  kicker text,
  dek text,
  published date,
  read_minutes integer,
  audio_url text,
  daily_rank integer,
  publish_at timestamptz,
  rank real,
  snippet text
)
language sql
stable
security invoker
as $$
  select
    e.slug,
    e.issue,
    e.title,
    e.kicker,
    e.dek,
    e.published,
    e.read_minutes,
    e.audio_url,
    e.daily_rank,
    e.publish_at,
    ts_rank_cd(e.search_vector, query)::real as rank,
    ts_headline(
      'english',
      coalesce(e.body, e.dek, ''),
      query,
      'MaxWords=30, MinWords=15, ShortWord=3'
    ) as snippet
  from essays e, plainto_tsquery('english', q) as query
  where e.search_vector @@ query
    and (include_scheduled or e.publish_at is null or e.publish_at <= now())
  order by rank desc, e.issue desc
  limit 25;
$$;

grant execute on function search_essays(text, boolean) to authenticated, anon, service_role;
