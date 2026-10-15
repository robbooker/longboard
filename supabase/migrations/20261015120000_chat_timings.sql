-- CHAT-TIMING: how fast the chat feels on real phones and computers. One in five chat tab
-- sessions sends a small batch of timings when the tab hides (POST /api/chat/timings).
-- A row is only a metric name, a number, a room slug and phone/desktop: no message text,
-- names, member ids or message ids. Kept 30 days (daily cron /api/cron/chat-timings).
-- value is whole milliseconds, except wrong_landing which is pixels (0 = opened in the right spot).
create table public.chat_timings (
 id bigint generated always as identity primary key,
 created_at timestamptz not null default now(),
 metric text not null check (metric in ('open_first_message','room_switch','send_visible','delivery_lag','tap_response','wrong_landing')),
 value integer not null check (value between 0 and 120000),
 room text not null check (room ~ '^[a-z][a-z-]{0,39}$'),
 device text not null check (device in ('phone','desktop'))
);
create index chat_timings_created_at on public.chat_timings(created_at);
-- Server only: RLS on with no policies, and no table rights for browser roles.
alter table public.chat_timings enable row level security;
revoke all on public.chat_timings from public,anon,authenticated;
grant all on public.chat_timings to service_role;

-- Daily median and 95th percentile per metric and device (days in America/Chicago).
create function public.chat_timings_daily(p_days integer default 30)
returns table(day date, metric text, device text, samples bigint, median double precision, p95 double precision, wrong_share double precision)
language sql stable security invoker set search_path='' as $$
 select (t.created_at at time zone 'America/Chicago')::date as day, t.metric, t.device, count(*) as samples,
  percentile_cont(0.5) within group (order by t.value) as median,
  percentile_cont(0.95) within group (order by t.value) as p95,
  avg((t.value > 0)::int)::double precision as wrong_share
 from public.chat_timings t
 where t.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days,30),1),30))
 group by 1, 2, 3
 order by 1, 2, 3;
$$;
revoke all on function public.chat_timings_daily(integer) from public,anon,authenticated;
grant execute on function public.chat_timings_daily(integer) to service_role;
