-- #373 Gainers Table: what it costs to borrow each of today's gainers at TradeZero, per share.
--
--  * chat_gainers_borrow: one row per ticker per Eastern day. status is etb (easy to borrow, no
--    locate needed), offered (price_per_share is the cheapest offer for 100 shares, locate_type says
--    which pool: Locate, PreBorrow or SingleUse), none (nothing offered) or error (every check so far
--    today failed). checked_at is when the shown result was read; attempted_at is the last check,
--    failed or not, so the route can space checks out.
--  * Written only by the lookup program on Rob's computer through /api/chat/gainers/facts (its own
--    token, CHAT_GAINERS_LOOKUP_TOKEN); read only by server code, for members who can open the
--    gainers room (/api/chat/gainers/table). RLS on, no policies, service role only.
--  * A failed check never replaces a result: it only moves attempted_at.
--  * chat_gainers_borrow_day(day): that day's rows. save_chat_gainers_borrow: the only write.
--
-- Additive: nothing existing changes. The app copes with this not being applied yet (the column
-- shows "checking…" and the lookup is told nothing is due).
-- Rollback: supabase/rollbacks/20261108120000_chat_gainers_borrow.down.sql

create table public.chat_gainers_borrow(
 day date not null,
 ticker text not null check(ticker ~ '^[A-Z][A-Z. ]{0,11}$'),
 status text not null check(status in ('offered','none','etb','error')),
 etb boolean,
 price_per_share numeric check(price_per_share is null or (price_per_share>0 and price_per_share<=1000)),
 locate_type text check(locate_type is null or locate_type in ('Locate','PreBorrow','SingleUse')),
 checked_at timestamptz,
 attempted_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(day,ticker),
 check((status='offered')=(price_per_share is not null and locate_type is not null)),
 check(status<>'etb' or etb),
 check((status='error')=(checked_at is null))
);
alter table public.chat_gainers_borrow enable row level security;
revoke all on public.chat_gainers_borrow from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_gainers_borrow to service_role;

create function public.chat_gainers_borrow_day(p_day date)
returns table(ticker text,status text,etb boolean,price_per_share numeric,locate_type text,checked_at timestamptz,attempted_at timestamptz)
language sql stable set search_path='' as $$
 select b.ticker,b.status,b.etb,b.price_per_share,b.locate_type,b.checked_at,b.attempted_at
 from public.chat_gainers_borrow b where b.day=p_day order by b.ticker limit 500;
$$;
revoke all on function public.chat_gainers_borrow_day(date) from public,anon,authenticated;
grant execute on function public.chat_gainers_borrow_day(date) to service_role;

-- One check's result. An error keeps an earlier result for the day and only notes the attempt.
create function public.save_chat_gainers_borrow(p_day date,p_ticker text,p_status text,p_etb boolean,p_price_per_share numeric,p_locate_type text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_status='error' then
  insert into public.chat_gainers_borrow as b(day,ticker,status,etb,attempted_at)
  values(p_day,p_ticker,'error',p_etb,now())
  on conflict(day,ticker) do update set attempted_at=now(),updated_at=now();
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
