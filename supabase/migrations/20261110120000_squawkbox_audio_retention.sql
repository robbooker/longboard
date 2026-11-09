-- #393: stop squawkbox audio filling the database.
--
-- public.squawkbox_relay_audio holds every TTS clip the TraderRadio relay has
-- ever uploaded (8.5 GB, growing ~460 MB/week). The table is created by the
-- relay project, not by these migrations, so everything here is guarded and
-- no-ops where the table (or pg_cron) is missing.
--
-- What the relay does (TraderRadio scripts/squawkbox-relay-supabase.mjs):
--   * clip paths are content-addressed (audio-cache/line-<hash>.mp3) and are
--     uploaded once: each cycle it checks which paths already exist and skips
--     them, so updated_at is the FIRST upload time, not "last used".
--   * a clip that is missing remotely but still in the local playout is
--     re-uploaded on the next cycle, before the playout row that points at it
--     is written (self-heal).
--   * recurring station IDs reuse the same clip for weeks, so an old
--     updated_at does not mean the clip is unused.
--
-- Delete rule (all three must hold):
--   1. path starts with 'audio-cache/' -- sounds/... (bells, evening shows) and
--      smoke-probe/keepalive.txt (relay health probe) are never touched;
--   2. updated_at is older than `keep` (default 7 days);
--   3. the path does not appear anywhere in squawkbox_relay_state (the live
--      feed/playout rows listeners are reading right now).
--
-- The first, large cleanup is run by hand after a backup, not here.
-- See docs/squawkbox-audio-retention.md.

create or replace function public.squawkbox_audio_prune(
  keep interval default interval '7 days',
  batch_size integer default 2000,
  max_rows integer default null
)
returns bigint
language plpgsql
set search_path = public, pg_temp
as $$
declare
  protected text[];
  deleted bigint := 0;
  n integer;
  this_batch integer;
begin
  if to_regclass('public.squawkbox_relay_audio') is null then
    return 0;
  end if;

  -- Without the live state we cannot tell what is playing: do nothing.
  if to_regclass('public.squawkbox_relay_state') is null then
    return 0;
  end if;

  if keep is null or keep < interval '1 day' then
    raise exception 'squawkbox_audio_prune: keep must be at least 1 day (got %)', keep;
  end if;

  if batch_size is null or batch_size < 1 then
    raise exception 'squawkbox_audio_prune: batch_size must be positive';
  end if;

  -- Every audio-cache path mentioned in the current feed/playout payloads
  -- (relay URLs and local audioPath values both contain it).
  select coalesce(array_agg(distinct m[1]), '{}')
    into protected
    from public.squawkbox_relay_state s
    cross join lateral regexp_matches(s.payload::text, '(audio-cache/[A-Za-z0-9._-]+)', 'g') as m;

  loop
    this_batch := batch_size;
    if max_rows is not null then
      this_batch := least(batch_size, max_rows - deleted);
      exit when this_batch <= 0;
    end if;

    delete from public.squawkbox_relay_audio a
     where a.path in (
       select c.path
         from public.squawkbox_relay_audio c
        where c.path like 'audio-cache/%'
          and c.updated_at < now() - keep
          and c.path <> all (protected)
        limit this_batch
        for update skip locked
     );

    get diagnostics n = row_count;
    deleted := deleted + n;
    exit when n < this_batch;
  end loop;

  return deleted;
end;
$$;

comment on function public.squawkbox_audio_prune(interval, integer, integer) is
  '#393: delete audio-cache/ clips older than keep that the live squawkbox feed/playout does not reference. Returns rows deleted. Never touches sounds/ or smoke-probe/.';

-- Not callable through the API; only the database owner / pg_cron runs it.
revoke all on function public.squawkbox_audio_prune(interval, integer, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.squawkbox_audio_prune(interval, integer, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.squawkbox_audio_prune(interval, integer, integer) from authenticated';
  end if;
end;
$$;

-- Nightly at 09:30 UTC (3:30 AM Central, 4:30 AM Eastern): outside US market
-- hours. Idempotent: drop any earlier job with this name, then schedule.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'squawkbox-audio-prune'$q$;
    execute $q$select cron.schedule('squawkbox-audio-prune', '30 9 * * *', 'select public.squawkbox_audio_prune()')$q$;
  end if;
end;
$$;
