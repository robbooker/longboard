-- #480 Gainers Table: "TZ daily limit reached" in the Borrow at TZ column. TradeZero answers only about
-- 100 locate quotes a day per key, then 429 "limit reached". The lookup program on Rob's computer now
-- quotes each stock once per Eastern day and, once TradeZero says the limit is reached, asks it nothing
-- more that day; every stock not checked yet is saved with the new status 'limit'.
--
--  * chat_gainers_borrow.status may also be 'limit' (nothing quoted, no price, no locate type, never
--    etb). Like the other answers it has checked_at set (when the lookup saved it), so the existing
--    "error rows and only error rows have no checked_at" check is unchanged.
--  * save_chat_gainers_borrow: same signature, grants and settings. A 'limit' answer is saved for a
--    ticker with no row yet, or replaces an error row for the day; it never replaces a real result
--    (offered, none, etb). Errors and real results are saved exactly as before.
--
-- Additive: no row changes, and the running app (which never sends 'limit') works unchanged against it.
-- The app with #480 needs it before the lookup's 'limit' answers can be saved: until it is applied the
-- route answers 503 for them and the lookup keeps them and posts them again (it never asks TradeZero again).
-- Rollback: supabase/rollbacks/20261121120000_chat_gainers_borrow_limit.down.sql

alter table public.chat_gainers_borrow drop constraint chat_gainers_borrow_status_check;
alter table public.chat_gainers_borrow add constraint chat_gainers_borrow_status_check
 check(status in ('offered','none','etb','error','limit'));
alter table public.chat_gainers_borrow add constraint chat_gainers_borrow_limit_check
 check(status<>'limit' or (price_per_share is null and locate_type is null and etb is not true));

create or replace function public.save_chat_gainers_borrow(p_day date,p_ticker text,p_status text,p_etb boolean,p_price_per_share numeric,p_locate_type text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_status='error' then
  insert into public.chat_gainers_borrow as b(day,ticker,status,etb,attempted_at)
  values(p_day,p_ticker,'error',p_etb,now())
  on conflict(day,ticker) do update set attempted_at=now(),updated_at=now();
  return;
 end if;
 -- #480: TradeZero's daily quote limit. Never replaces a real result; an error row becomes 'limit'.
 if p_status='limit' then
  insert into public.chat_gainers_borrow as b(day,ticker,status,etb,checked_at,attempted_at)
  values(p_day,p_ticker,'limit',p_etb,now(),now())
  on conflict(day,ticker) do update set status='limit',etb=excluded.etb,checked_at=now(),attempted_at=now(),updated_at=now()
  where b.status='error';
  return;
 end if;
 insert into public.chat_gainers_borrow as b(day,ticker,status,etb,price_per_share,locate_type,checked_at,attempted_at)
 values(p_day,p_ticker,p_status,p_etb,case when p_status='offered' then p_price_per_share end,
  case when p_status='offered' then p_locate_type end,now(),now())
 on conflict(day,ticker) do update set status=excluded.status,etb=excluded.etb,price_per_share=excluded.price_per_share,
  locate_type=excluded.locate_type,checked_at=now(),attempted_at=now(),updated_at=now();
end $$;
revoke all on function public.save_chat_gainers_borrow(date,text,text,boolean,numeric,text) from public,anon,authenticated;
grant execute on function public.save_chat_gainers_borrow(date,text,text,boolean,numeric,text) to service_role;
