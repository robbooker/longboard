-- Rollback for 20261107120000_chat_gainers_facts.sql (#371 Gainers Table). Drops the saved company
-- facts; the lookup program would have to look every ticker up again.
drop function if exists public.save_chat_gainers_facts(text,text,numeric,numeric,boolean,numeric,boolean);
drop function if exists public.chat_gainers_table(date);
drop table if exists public.chat_gainers_facts;
