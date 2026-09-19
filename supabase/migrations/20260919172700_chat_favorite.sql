create table public.chat_favorites (
 account_id uuid primary key references public.chat_accounts(id) on delete cascade,
 room_slug text,
 conversation_id uuid references public.longboard_chat_conversations(id) on delete cascade,
 check ((room_slug is not null)::integer+(conversation_id is not null)::integer=1),
 check (room_slug is null or room_slug in ('main','social','shortscout','lb-announcements','ss-announcements'))
);
alter table public.chat_favorites enable row level security;
revoke all on public.chat_favorites from public,anon,authenticated;
grant all on public.chat_favorites to service_role;

-- Called only by the authenticated server API. Never trust a browser account ID.
create function public.chat_favorite_target(p_user_id uuid,p_room text,p_conversation uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor uuid; other_name text;
begin
 select id into actor from public.longboard_chat_members where user_id=p_user_id;
 if actor is null then return null; end if;
 if p_room is not null and p_conversation is null then
  if public.chat_account_has_room(p_user_id,p_room) then return jsonb_build_object('kind','room','room',p_room); end if;
 elsif p_conversation is not null and p_room is null and public.chat_account_has_room(p_user_id,'social') then
  select other.display_name into other_name from public.longboard_chat_conversations c
  join public.longboard_chat_members other on other.id=case when c.requester_id=actor then c.recipient_id else c.requester_id end
  where c.id=p_conversation and actor in(c.requester_id,c.recipient_id) and c.status='accepted'
  and public.chat_account_has_room(other.user_id,'social')
  and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=c.requester_id and b.blocked_id=c.recipient_id) or (b.blocker_id=c.recipient_id and b.blocked_id=c.requester_id));
  if found then return jsonb_build_object('kind','dm','conversationId',p_conversation,'label',other_name); end if;
 end if;
 return null;
end $$;
create function public.chat_favorite(p_user_id uuid,p_action text default 'get',p_room text default null,p_conversation uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.chat_favorites; target jsonb;
begin
 if not exists(select 1 from public.longboard_chat_members where user_id=p_user_id) then raise exception 'member_required'; end if;
 if p_action='get' then
  select * into saved from public.chat_favorites where account_id=p_user_id;
  return public.chat_favorite_target(p_user_id,saved.room_slug,saved.conversation_id);
 elsif p_action='clear' then
  delete from public.chat_favorites where account_id=p_user_id;
  return null;
 elsif p_action='set' then
  target:=public.chat_favorite_target(p_user_id,p_room,p_conversation);
  if target is null then raise exception 'favorite_unavailable'; end if;
  insert into public.chat_favorites(account_id,room_slug,conversation_id) values(p_user_id,p_room,p_conversation)
  on conflict(account_id) do update set room_slug=excluded.room_slug,conversation_id=excluded.conversation_id;
  return target;
 end if;
 raise exception 'invalid_action';
end $$;
revoke all on function public.chat_favorite_target(uuid,text,uuid),public.chat_favorite(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.chat_favorite_target(uuid,text,uuid),public.chat_favorite(uuid,text,text,uuid) to service_role;
