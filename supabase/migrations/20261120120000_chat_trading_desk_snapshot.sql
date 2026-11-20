-- #469 Trading Desk: the latest TradeZero snapshot from the home computer.
--
--  * chat_trading_desk_snapshot: ONE row (id is always true), the latest snapshot only. Each new one
--    replaces it; no history is kept. The snapshot is the desk's feed shape (lib/tradeZeroFeed.ts):
--    account balances, positions, P&L and open orders, read-only, with no account number in it (the
--    home computer strips it, and /api/chat/trading-desk/feed checks and rebuilds every field before
--    saving). At most 256 KB.
--  * save_chat_trading_desk_snapshot(snapshot): the upsert, called by /api/chat/trading-desk/feed
--    (its own token, CHAT_TRADING_DESK_FEED_TOKEN). Security invoker, search_path ''.
--  * RLS on with no policies; anon and authenticated get nothing. Only the service role reads it
--    (/api/chat/trading-desk, owner only) and writes it (through the function).
--
-- Additive: until this is applied the desk shows its sample data and the feed route answers 503.
-- Rollback: supabase/rollbacks/20261120120000_chat_trading_desk_snapshot.down.sql

create table public.chat_trading_desk_snapshot(
 id boolean primary key default true check(id),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=262144),
 received_at timestamptz not null default now()
);
alter table public.chat_trading_desk_snapshot enable row level security;
revoke all on public.chat_trading_desk_snapshot from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_trading_desk_snapshot to service_role;

create function public.save_chat_trading_desk_snapshot(p_snapshot jsonb)
returns timestamptz language plpgsql security invoker set search_path='' as $$
declare v_at timestamptz := now();
begin
 insert into public.chat_trading_desk_snapshot as s(id,snapshot,received_at) values(true,p_snapshot,v_at)
 on conflict(id) do update set snapshot=excluded.snapshot,received_at=excluded.received_at;
 return v_at;
end $$;
revoke all on function public.save_chat_trading_desk_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.save_chat_trading_desk_snapshot(jsonb) to service_role;
