-- Rollback for 20261110230000_chat_gainers_above_prev_close.sql (#433): chat_gainers_table(day) as
-- 20261110190000_chat_gainers_after_hours.sql defined it, without the any_not_after_hours and
-- after_hours_high columns. The app reads the missing columns as "not known" and keeps every row.
drop function if exists public.chat_gainers_table(date);
create function public.chat_gainers_table(p_day date)
returns table(ticker text,last_alert_at timestamptz,alerts integer,country text,country_checked_at timestamptz,
 cash_usd numeric,cash_months_left numeric,cash_flow_positive boolean,cash_checked_at timestamptz,
 inst_own_pct numeric,inst_own_checked_at timestamptz,not_found boolean,checked_at timestamptz,
 last_after_hours boolean)
language sql stable set search_path='' as $$
 with bounds as (
  select (p_day::timestamp at time zone 'America/New_York') s,((p_day+1)::timestamp at time zone 'America/New_York') f
 ), alerts as (
  select substring(m.body from '^🚨 ([A-Z. ]+?) \(\+') sym,
   coalesce(replace(substring(m.body from 'Volume: ([0-9,]{1,20})'),',','')::numeric,0) vol,m.created_at,
   m.body ~ 'After[- ]Hours' after_hours,m.id
  from public.longboard_chat_messages m,bounds b
  where m.room_slug='gainers' and m.reply_to_id is null and not m.removed
   and m.created_at>=b.s and m.created_at<b.f
 ), stocks as (
  select a.sym,max(a.created_at) last_at,count(*)::integer n,
   (array_agg(a.after_hours order by a.created_at desc,a.id desc))[1] last_ah
  from alerts a
  where a.sym is not null group by a.sym having max(a.vol)>=150000
 )
 select s.sym,s.last_at,s.n,f.country,f.country_checked_at,f.cash_usd,f.cash_months_left,coalesce(f.cash_flow_positive,false),
  f.cash_checked_at,f.inst_own_pct,f.inst_own_checked_at,coalesce(f.not_found,false),f.checked_at,coalesce(s.last_ah,false)
 from stocks s left join public.chat_gainers_facts f on f.ticker=s.sym
 order by s.last_at desc,s.sym limit 500;
$$;
revoke all on function public.chat_gainers_table(date) from public,anon,authenticated;
grant execute on function public.chat_gainers_table(date) to service_role;
