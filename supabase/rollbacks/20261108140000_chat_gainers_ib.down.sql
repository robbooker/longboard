-- Rollback for 20261108140000_chat_gainers_ib.sql (#376 Gainers Table Interactive Brokers columns).
-- Drops the saved IB rates; the IB fee and IB avail columns then show "—" until re-applied.
drop function if exists public.save_chat_gainers_ib(timestamptz,jsonb);
drop function if exists public.chat_gainers_ib_for(text[]);
drop table if exists public.chat_gainers_ib;
