-- Rollback for 20261108180000_chat_gainers_news.sql (#387 DilutionTracker press releases).
-- Drops the saved press releases and the once-a-day read marks; the News Feed then shows Polygon and
-- FMP only, and the lookup program is told no news reads are due.
drop function if exists public.save_chat_gainers_news(date,text,jsonb);
drop function if exists public.chat_gainers_news_for(text[],timestamptz);
drop function if exists public.chat_gainers_news_checked(date);
drop table if exists public.chat_gainers_news_checks;
drop table if exists public.chat_gainers_news;
