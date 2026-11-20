-- Rollback for 20261120120000_chat_trading_desk_snapshot.sql (#469): no saved snapshot. The desk then
-- shows its sample data again and /api/chat/trading-desk/feed answers 503 until it is re-applied.
drop function if exists public.save_chat_trading_desk_snapshot(jsonb);
drop table if exists public.chat_trading_desk_snapshot;
