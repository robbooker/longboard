-- Presence IDs are ordering hints only. Authorization always uses verified room membership.
create function public.longboard_chat_room_members_ordered(
 p_user_id uuid,p_room text,p_query text default '',p_online_ids uuid[] default '{}',
 p_after_rank integer default null,p_after_name text default null,p_after_id uuid default null
) returns table(id uuid,display_name text,sort_rank integer,sort_name text)
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','ss-announcements') then raise exception 'invalid_room'; end if;
 if p_query is null or char_length(p_query)>28 or p_online_ids is null or cardinality(p_online_ids)>5000 then raise exception 'invalid_query'; end if;
 if ((p_after_rank is null and p_after_name is null and p_after_id is null) or
   (p_after_rank in (0,1) and p_after_name is not null and p_after_id is not null)) is not true then raise exception 'invalid_cursor'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 return query
 select m.id,m.display_name,case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name)
 from public.longboard_chat_members m
 where strpos(lower(m.display_name),lower(btrim(p_query)))>0
   and public.chat_account_has_room(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
   and (p_after_id is null or
     (case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name) collate "C",m.id) >
     (p_after_rank,p_after_name collate "C",p_after_id))
 order by case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name) collate "C",m.id
 limit 51;
end $$;
revoke all on function public.longboard_chat_room_members_ordered(uuid,text,text,uuid[],integer,text,uuid) from public,anon,authenticated;
grant execute on function public.longboard_chat_room_members_ordered(uuid,text,text,uuid[],integer,text,uuid) to service_role;
