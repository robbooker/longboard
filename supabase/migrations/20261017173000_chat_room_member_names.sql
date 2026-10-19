-- HEALTH-2026-10-17-1: a cheap way to name a few room members (the typing indicator's "Name is
-- typing…"). Until now the window asked for the whole ordered member list (every member's room
-- eligibility checked, about 0.5 s for social and 1.2 s for shortscout on an idle database) just
-- to read one name, once per watching window each time someone started typing. Under that load the
-- calls ran into the 8 s statement timeout and /api/chat/room-members returned 503s.
--
--  * longboard_chat_room_member_names(user, room, ids): the members among `ids` (at most 50) that
--    longboard_chat_room_members would list for this user in this room, with their chat names. Same
--    checks as that function (valid room, room access, a chat member, the member is eligible for the
--    room, no block either way); only the named members are checked, so it costs a few ms.
--
-- Additive and safe at any time: one new service-only function. Before it runs the route falls back
-- to a one-row read of longboard_chat_room_members (keyset cursor just before the asked member).
-- Rollback: supabase/rollbacks/20261017173000_chat_room_member_names.down.sql.
create or replace function public.longboard_chat_room_member_names(p_user_id uuid, p_room text, p_ids uuid[])
returns table(id uuid, display_name text) language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers') then raise exception 'invalid_room'; end if;
 if p_ids is null or cardinality(p_ids) > 50 then raise exception 'invalid_query'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 return query
 select m.id, m.display_name from public.longboard_chat_members m
 where m.id = any(p_ids)
   and public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
 order by m.id;
end $$;
revoke all on function public.longboard_chat_room_member_names(uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.longboard_chat_room_member_names(uuid,text,uuid[]) to service_role;
