-- CHAT-TIMING return tag (HEALTH-2026-11-09-2, #392). The "75-second phone delay" was the raw age of
-- messages written while a phone was locked or the tab hidden: the browser no longer sends those,
-- and every row now carries the stream tag. `back` marks a timing taken just after the reader came
-- back (tab shown, page restored or resumed, device woken; within 10 s) or the wait for a message
-- written while they were away. The foreground is then `back = false` with a stream tag.
-- Rows from before this migration are all `back = false`; their raw ages are the ones with no stream.
alter table public.chat_timings add column back boolean not null default false;

create or replace function public.record_chat_timings(p_device text, p_rows jsonb) returns integer
language sql security invoker set search_path='' as $$
 with inserted as (
  insert into public.chat_timings(metric,value,room,device,stream,back)
  select r.m, r.v, r.r, p_device, case when r.s in ('on','off') then r.s end, coalesce(r.a = 'back', false)
  from (select * from jsonb_to_recordset(case when jsonb_typeof(p_rows)='array' and jsonb_array_length(p_rows)<=60 then p_rows else '[]'::jsonb end) as x(m text, v integer, r text, s text, a text)) r
  returning 1)
 select count(*)::integer from inserted;
$$;
revoke all on function public.record_chat_timings(text,jsonb) from public,anon,authenticated;
grant execute on function public.record_chat_timings(text,jsonb) to service_role;

-- chat_timings_daily split by stream ('on', 'off', or null for untagged rows) and by `back`.
create function public.chat_timings_daily_by_return(p_days integer default 30)
returns table(day date, metric text, device text, stream text, back boolean, samples bigint, median double precision, p95 double precision, wrong_share double precision)
language sql stable security invoker set search_path='' as $$
 select (t.created_at at time zone 'America/Chicago')::date as day, t.metric, t.device, t.stream, t.back, count(*) as samples,
  percentile_cont(0.5) within group (order by t.value) as median,
  percentile_cont(0.95) within group (order by t.value) as p95,
  avg((t.value > 0)::int)::double precision as wrong_share
 from public.chat_timings t
 where t.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days,30),1),30))
 group by 1, 2, 3, 4, 5
 order by 1, 2, 3, 4, 5;
$$;
revoke all on function public.chat_timings_daily_by_return(integer) from public,anon,authenticated;
grant execute on function public.chat_timings_daily_by_return(integer) to service_role;
