-- Read-only directory of registered chat identities. Never provisions accounts.
create function public.longboard_chat_dm_directory(p_user_id uuid,p_query text default '')
returns table(id uuid,display_name text) language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;
begin
 if p_query is null or char_length(btrim(p_query)) not between 2 and 28 then raise exception 'invalid_query'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null or not public.chat_account_has_room(p_user_id,'social') then raise exception 'member_required'; end if;
 return query
 select m.id,m.display_name from public.longboard_chat_members m
 left join public.longboard_chat_conversations c on least(c.requester_id,c.recipient_id)=least(actor,m.id) and greatest(c.requester_id,c.recipient_id)=greatest(actor,m.id)
 where m.id<>actor
   -- Literal substring matching: %, _ and backslashes are never LIKE wildcards.
   and strpos(lower(m.display_name),lower(btrim(p_query)))>0
   and public.chat_account_has_room(m.user_id,'social')
   and (c.id is null or c.status in ('pending','accepted'))
   and (m.accepts_requests or c.status in ('pending','accepted'))
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
 order by lower(m.display_name),m.id limit 20;
end $$;
revoke all on function public.longboard_chat_dm_directory(uuid,text) from public,anon,authenticated;
grant execute on function public.longboard_chat_dm_directory(uuid,text) to service_role;
