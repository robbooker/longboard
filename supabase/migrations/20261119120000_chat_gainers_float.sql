-- #466 Gainers Table: Float, right after Mkt Cap. The float comes from the same DilutionTracker company
-- page the lookup program already reads for the other facts ("Float & OS:0.55M / 16.46M" in its
-- header), so it is saved with them and read back in the table's one database read: no new provider,
-- no key, no call per row.
--
--  * chat_gainers_facts gets float_shares (the float in shares; null when the page showed none) and
--    float_checked_at (when it was last read; null: never). A known float is never replaced by an
--    empty one.
--  * save_chat_gainers_float(ticker, float): the lookup's float, saved by /api/chat/gainers/facts right
--    after save_chat_gainers_facts. Service role only, like the other writes.
--  * chat_gainers_table(day) gets the two columns at the END of its rows. Which stocks come back,
--    their order and every other column are the definition from
--    20261110230000_chat_gainers_above_prev_close.sql unchanged. Adding columns changes the return
--    type, so the function is dropped and created again, with the same settings and grants.
--
-- Readers of chat_gainers_table (/api/chat/gainers/table, /api/chat/gainers/facts,
-- /api/chat/news/feed) select by column name, so the extra columns are harmless to them; the app
-- before this change keeps working against it, and the app with this change shows "—" for Float and
-- asks for no float until this is applied.
-- Rollback: supabase/rollbacks/20261119120000_chat_gainers_float.down.sql

alter table public.chat_gainers_facts
 add column float_shares numeric check(float_shares is null or float_shares between 0 and 1e13),
 add column float_checked_at timestamptz;

drop function if exists public.chat_gainers_table(date);
create function public.chat_gainers_table(p_day date)
returns table(ticker text,last_alert_at timestamptz,alerts integer,country text,country_checked_at timestamptz,
 cash_usd numeric,cash_months_left numeric,cash_flow_positive boolean,cash_checked_at timestamptz,
 inst_own_pct numeric,inst_own_checked_at timestamptz,not_found boolean,checked_at timestamptz,
 last_after_hours boolean,any_not_after_hours boolean,after_hours_high numeric,
 float_shares numeric,float_checked_at timestamptz)
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
  coalesce(s.any_not_ah,false),s.ah_high,f.float_shares,f.float_checked_at
 from stocks s left join public.chat_gainers_facts f on f.ticker=s.sym
 order by s.last_at desc,s.sym limit 500;
$$;
revoke all on function public.chat_gainers_table(date) from public,anon,authenticated;
grant execute on function public.chat_gainers_table(date) to service_role;

-- One lookup's float. Null: the page showed none (noted as read; a known float stays).
create function public.save_chat_gainers_float(p_ticker text,p_float_shares numeric)
returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.chat_gainers_facts as f(ticker,float_shares,float_checked_at)
 values(p_ticker,p_float_shares,now())
 on conflict(ticker) do update set float_shares=coalesce(excluded.float_shares,f.float_shares),
  float_checked_at=now(),updated_at=now();
end $$;
revoke all on function public.save_chat_gainers_float(text,numeric) from public,anon,authenticated;
grant execute on function public.save_chat_gainers_float(text,numeric) to service_role;
