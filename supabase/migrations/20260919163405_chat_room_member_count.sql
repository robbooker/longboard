-- Count the same visible membership set as the room directory, before search or pagination.
create function public.longboard_chat_room_member_count(p_user_id uuid,p_room text)
returns bigint language plpgsql stable security invoker set search_path='' as $$
declare actor uuid; total bigint;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','ss-announcements') then raise exception 'invalid_room'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 select count(*) into total from public.longboard_chat_members m
 where public.chat_account_has_room(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor));
 return total;
end $$;
revoke all on function public.longboard_chat_room_member_count(uuid,text) from public,anon,authenticated;
grant execute on function public.longboard_chat_room_member_count(uuid,text) to service_role;
