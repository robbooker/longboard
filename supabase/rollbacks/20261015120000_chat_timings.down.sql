-- Rollback for 20261015120000_chat_timings.sql. Safe at any time: the app treats a missing
-- table as "timings off" (POST /api/chat/timings stays a quiet 204, the stats read returns
-- ready:false, the retention cron is a no-op). Deletes all collected timings.
begin;
drop function public.chat_timings_daily(integer);
drop table public.chat_timings;
commit;
