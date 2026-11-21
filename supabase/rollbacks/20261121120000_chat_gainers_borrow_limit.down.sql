-- Rollback for 20261121120000_chat_gainers_borrow_limit.sql (#480): no 'limit' status. Any 'limit' rows
-- become error rows (no checked_at), which the column shows as "—"; then the status check and
-- save_chat_gainers_borrow are as 20261108120000_chat_gainers_borrow.sql defined them.
update public.chat_gainers_borrow set status='error',checked_at=null,updated_at=now() where status='limit';
alter table public.chat_gainers_borrow drop constraint if exists chat_gainers_borrow_limit_check;
alter table public.chat_gainers_borrow drop constraint chat_gainers_borrow_status_check;
alter table public.chat_gainers_borrow add constraint chat_gainers_borrow_status_check
 check(status in ('offered','none','etb','error'));

create or replace function public.save_chat_gainers_borrow(p_day date,p_ticker text,p_status text,p_etb boolean,p_price_per_share numeric,p_locate_type text)
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
