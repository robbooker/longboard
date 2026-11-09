-- HEALTH-2026-11-09-1 (#391): chat_account_rooms must give the same rooms as
-- chat_account_has_room, for every account and room. Read-only; run after
-- 20261110100000_chat_activity_inbox_faster.sql is applied, and after any change to the room rule.
--   supabase db query --linked --project-ref <ref> -f scripts/sql/chat-account-rooms-compare.sql
-- Expect accounts = every chat account and mismatched = 0.
with rooms as (
 select array['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings',
  'ss-recordings','whats-new','developers','lb-review','club','admins','not-a-room'] all_rooms
)
select count(*) accounts,
 count(*) filter (where by_room is distinct from by_list) mismatched,
 coalesce(jsonb_agg(jsonb_build_object('account',id,'has_room',by_room,'rooms',by_list)) filter (where by_room is distinct from by_list),'[]') mismatches
from (
 select a.id,
  array(select r from unnest(rooms.all_rooms) r where public.chat_account_has_room(a.id,r)) by_room,
  public.chat_account_rooms(a.id,rooms.all_rooms) by_list
 from public.chat_accounts a cross join rooms
) checked;
