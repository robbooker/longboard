-- Rollback for 20261111120000_chat_gainers_alert_news.sql (#436 latest press release under a
-- stock's first Gainers alert). Drops the posted headlines; the room then shows the alerts alone and
-- the facts route saves news reads as before (it reports the headline as "unavailable").
drop function if exists public.post_chat_gainers_alert_news(date,text);
drop table if exists public.chat_gainers_alert_news;
