-- #376 Gainers Table: Interactive Brokers' borrow fee and shares available for today's gainers.
--
--  * chat_gainers_ib: one row per ticker, from IB's public short stock file (ftp2.interactivebrokers.com,
--    usa.txt, about every 15 minutes). fee_pct and rebate_pct are % a year (null when IB writes NA);
--    available is the shares IB has to lend (0: none, or the ticker isn't in IB's file at all), and
--    available_more says IB wrote ">" before it (">10000000"). file_time is when IB wrote that file.
--  * Written only by the lookup program on Rob's computer through /api/chat/gainers/facts (its own
--    token, CHAT_GAINERS_LOOKUP_TOKEN); read only by server code, for members who can open the
--    gainers room (/api/chat/gainers/table). RLS on, no policies, service role only.
--  * An older file never replaces a newer one's row.
--  * chat_gainers_ib_for(tickers): those tickers' rows. save_chat_gainers_ib: the only write.
--
-- Additive: nothing existing changes. The app copes with this not being applied yet (the IB columns
-- show "—").
-- Rollback: supabase/rollbacks/20261108140000_chat_gainers_ib.down.sql

create table public.chat_gainers_ib(
 ticker text primary key check(ticker ~ '^[A-Z][A-Z. ]{0,11}$'),
 fee_pct numeric check(fee_pct is null or fee_pct between -100000 and 100000),
 rebate_pct numeric check(rebate_pct is null or rebate_pct between -100000 and 100000),
 available bigint check(available is null or available between 0 and 1000000000000),
 available_more boolean not null default false,
 file_time timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(not available_more or available is not null)
);
alter table public.chat_gainers_ib enable row level security;
revoke all on public.chat_gainers_ib from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_gainers_ib to service_role;

create function public.chat_gainers_ib_for(p_tickers text[])
returns table(ticker text,fee_pct numeric,rebate_pct numeric,available bigint,available_more boolean,file_time timestamptz,updated_at timestamptz)
language sql stable set search_path='' as $$
 select i.ticker,i.fee_pct,i.rebate_pct,i.available,i.available_more,i.file_time,i.updated_at
 from public.chat_gainers_ib i where i.ticker=any(p_tickers[1:500]) order by i.ticker;
$$;
revoke all on function public.chat_gainers_ib_for(text[]) from public,anon,authenticated;
grant execute on function public.chat_gainers_ib_for(text[]) to service_role;

-- One file's rows for some tickers: [{ticker, fee_pct, rebate_pct, available, available_more}, ...].
create function public.save_chat_gainers_ib(p_file_time timestamptz,p_rows jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'bad rows'; end if;
 insert into public.chat_gainers_ib as i(ticker,fee_pct,rebate_pct,available,available_more,file_time)
 select r.ticker,r.fee_pct,r.rebate_pct,r.available,coalesce(r.available_more,false),p_file_time
 from jsonb_to_recordset(p_rows) as r(ticker text,fee_pct numeric,rebate_pct numeric,available bigint,available_more boolean)
 on conflict(ticker) do update set fee_pct=excluded.fee_pct,rebate_pct=excluded.rebate_pct,available=excluded.available,
  available_more=excluded.available_more,file_time=excluded.file_time,updated_at=now()
  where i.file_time<=excluded.file_time;
 get diagnostics n=row_count;
 return n;
end $$;
revoke all on function public.save_chat_gainers_ib(timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.save_chat_gainers_ib(timestamptz,jsonb) to service_role;
