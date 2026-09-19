-- Authorized room directory. Presence is advisory UI state, never membership proof.
create function public.longboard_chat_room_members(p_user_id uuid,p_room text,p_cursor uuid default null,p_query text default '')
returns table(id uuid,display_name text) language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','ss-announcements') then raise exception 'invalid_room'; end if;
 if p_query is null or char_length(p_query)>28 then raise exception 'invalid_query'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 return query
 select m.id,m.display_name from public.longboard_chat_members m
 where (p_cursor is null or m.id>p_cursor)
   and strpos(lower(m.display_name),lower(btrim(p_query)))>0
   and public.chat_account_has_room(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
 -- UUID keysets remain stable across name edits; the UI sorts the loaded names.
 order by m.id limit 51;
end $$;
revoke all on function public.longboard_chat_room_members(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.longboard_chat_room_members(uuid,text,uuid,text) to service_role;
