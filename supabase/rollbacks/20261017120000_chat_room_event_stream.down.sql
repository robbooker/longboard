-- Rollback for 20261017120000_chat_room_event_stream.sql. Turn CHAT_EVENT_STREAM off (or unset)
-- first; with it off the app never reads any of this. Safe at any time after that: windows that
-- still hold a cursor get an error from GET /api/chat/events and go back to the timed reload.
begin;
drop function if exists public.chat_room_events_after(text, bigint, integer);
drop trigger if exists zz_chat_room_event_tombstone on public.longboard_chat_messages;
drop trigger if exists zz_chat_room_event_seq on public.longboard_chat_messages;
drop function if exists public.stamp_chat_room_event();
drop index if exists public.longboard_chat_messages_room_event_seq;
alter table public.longboard_chat_messages drop column if exists event_seq;
drop table if exists public.longboard_chat_room_event_tombstones;
drop table if exists public.longboard_chat_room_event_heads;
commit;
