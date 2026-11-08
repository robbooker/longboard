-- Rollback for 20261108120000_chat_gainers_borrow.sql (#373 Gainers Table borrow at TradeZero).
-- Drops the saved borrow checks; the Borrow at TZ column then shows "checking…" until re-applied.
drop function if exists public.save_chat_gainers_borrow(date,text,text,boolean,numeric,text);
drop function if exists public.chat_gainers_borrow_day(date);
drop table if exists public.chat_gainers_borrow;
