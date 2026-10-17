-- Rollback for 20261017173000_chat_room_member_names.sql. Safe at any time: the route sees the
-- function missing and falls back to a one-row read of longboard_chat_room_members.
drop function if exists public.longboard_chat_room_member_names(uuid,text,uuid[]);
