-- #379 Six view: each member's saved card layout, so Six opens the same on every computer.
--
--  * chat_card_layouts: one row per chat account and view ('six' today; the view column leaves room
--    for Quad or a bigger grid later). slots is a JSON list of up to 12 entries, each null (empty
--    slot) or {"type": "...", "source": "..."}.
--  * Written and read only by /api/chat/card-layout with the service role. The route checks every
--    card against what the member can reach (rooms, their own DMs, Gainers Table only with the
--    Gainers room) before saving, and again on every read, so a saved card the member lost access
--    to comes back as an empty slot. RLS on, no policies.
--  * Quad keeps saving its four panes in the browser as before; nothing about Quad changes here.
--
-- Additive: nothing existing changes. Until it is applied, Six still works and keeps its layout in
-- the browser only (the route answers 503 and the page falls back).
-- Rollback: supabase/rollbacks/20261108120000_chat_card_layouts.down.sql

create table public.chat_card_layouts(
 account_id uuid not null references public.chat_accounts(id) on delete cascade,
 view text not null check(view in ('six')),
 slots jsonb not null check(jsonb_typeof(slots)='array' and jsonb_array_length(slots)<=12 and pg_column_size(slots)<8192),
 updated_at timestamptz not null default now(),
 primary key(account_id,view)
);
alter table public.chat_card_layouts enable row level security;
revoke all on public.chat_card_layouts from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_card_layouts to service_role;
