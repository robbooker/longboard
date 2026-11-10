-- #433 Gainers Table: leave off stocks that were below yesterday's close when they alerted.
-- Rob: "I hate that they are even on the gainers list at all! Since they are below where they were
-- yesterday!" After hours the alert fires when a stock is up from TODAY's close, so a stock that fell
-- hard in the day and bounced after the close alerted while still far below YESTERDAY's close
-- (2026-11-10: BMGL at $2.43 and $2.72 against about $5.40, ALGS at $3.25 against about $3.95).
--
-- The rule (worked out by /api/chat/gainers/table, which knows yesterday's close from Polygon): a
-- stock is on the table when at least one of its alerts that day was above yesterday's close at the
-- time of the alert. Pre-market and regular-hours alerts are measured from yesterday's close already,
-- so they always count; an after-hours alert counts when its Extended Price is above yesterday's close.
--
-- This migration only gives the route what it needs to decide: two more columns at the END of
-- chat_gainers_table(day)'s rows.
--  * any_not_after_hours: the stock has at least one alert that day that is not after hours
--    (pre-market or regular hours).
--  * after_hours_high: the highest "Extended Price: $x" among its after-hours alerts that day (the
--    bot writes "🕒 Extended Price: $2.43 (+25.91%)"); null when it has none, or none with a price.
-- Which stocks come back, their order and every other column are the definition from
-- 20261110190000_chat_gainers_after_hours.sql unchanged. Adding columns changes the return type, so
-- the function is dropped and created again (create or replace can't change it), with the same
-- settings and grants.
--
-- Readers: /api/chat/gainers/table, /api/chat/gainers/facts (the lookup's list) and
-- /api/chat/news/feed. All select by column name, so the extra columns are harmless to them. The app
-- before this change keeps working against it, and the app with this change keeps every row until
-- this is applied (it reads the missing columns as "not known").
-- Rollback: supabase/rollbacks/20261110230000_chat_gainers_above_prev_close.down.sql

drop function if exists public.chat_gainers_table(date);
create function public.chat_gainers_table(p_day date)
returns table(ticker text,last_alert_at timestamptz,alerts integer,country text,country_checked_at timestamptz,
 cash_usd numeric,cash_months_left numeric,cash_flow_positive boolean,cash_checked_at timestamptz,
 inst_own_pct numeric,inst_own_checked_at timestamptz,not_found boolean,checked_at timestamptz,
 last_after_hours boolean,any_not_after_hours boolean,after_hours_high numeric)
language sql stable set search_path='' as $$
 with bounds as (
  select (p_day::timestamp at time zone 'America/New_York') s,((p_day+1)::timestamp at time zone 'America/New_York') f
 ), alerts as (
  select substring(m.body from '^🚨 ([A-Z. ]+?) \(\+') sym,
   coalesce(replace(substring(m.body from 'Volume: ([0-9,]{1,20})'),',','')::numeric,0) vol,m.created_at,
   m.body ~ 'After[- ]Hours' after_hours,m.id,
   replace(substring(m.body from 'Extended Price: \$([0-9][0-9,]{0,14}(?:\.[0-9]{1,8})?)'),',','')::numeric ext
  from public.longboard_chat_messages m,bounds b
  where m.room_slug='gainers' and m.reply_to_id is null and not m.removed
   and m.created_at>=b.s and m.created_at<b.f
 ), stocks as (
  select a.sym,max(a.created_at) last_at,count(*)::integer n,
   (array_agg(a.after_hours order by a.created_at desc,a.id desc))[1] last_ah,
   bool_or(not a.after_hours) any_not_ah,max(a.ext) filter (where a.after_hours) ah_high
  from alerts a
  where a.sym is not null group by a.sym having max(a.vol)>=150000
 )
 select s.sym,s.last_at,s.n,f.country,f.country_checked_at,f.cash_usd,f.cash_months_left,coalesce(f.cash_flow_positive,false),
  f.cash_checked_at,f.inst_own_pct,f.inst_own_checked_at,coalesce(f.not_found,false),f.checked_at,coalesce(s.last_ah,false),
  coalesce(s.any_not_ah,false),s.ah_high
 from stocks s left join public.chat_gainers_facts f on f.ticker=s.sym
 order by s.last_at desc,s.sym limit 500;
$$;
revoke all on function public.chat_gainers_table(date) from public,anon,authenticated;
grant execute on function public.chat_gainers_table(date) to service_role;
