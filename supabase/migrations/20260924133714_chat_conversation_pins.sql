-- Pins are independent of the single favorite and keep their insertion order.
create table public.chat_conversation_pins (
 id bigint generated always as identity primary key,
 account_id uuid not null references public.chat_accounts(id) on delete cascade,
 room_slug text,
 conversation_id uuid references public.longboard_chat_conversations(id) on delete cascade,
 check ((room_slug is not null)::integer + (conversation_id is not null)::integer = 1),
 check (room_slug is null or room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers')),
 unique(account_id,room_slug),
 unique(account_id,conversation_id)
);
create index chat_conversation_pins_account_order on public.chat_conversation_pins(account_id,id);
alter table public.chat_conversation_pins enable row level security;
revoke all on public.chat_conversation_pins from public,anon,authenticated;
revoke all on sequence public.chat_conversation_pins_id_seq from public,anon,authenticated;
grant all on public.chat_conversation_pins to service_role;
grant usage,select on sequence public.chat_conversation_pins_id_seq to service_role;

-- Only the authenticated server API supplies p_user_id. Every read revalidates access.
create function public.chat_pins(p_user_id uuid,p_action text default 'get',p_room text default null,p_conversation uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.longboard_chat_members where user_id=p_user_id) then raise exception 'member_required'; end if;
 if p_action not in ('get','pin','unpin') or p_action is null then raise exception 'invalid_action'; end if;
 if p_action in ('pin','unpin') then
  if (p_room is not null)::integer+(p_conversation is not null)::integer<>1 then raise exception 'invalid_target'; end if;
  -- Serialize modifications per account so concurrent tabs cannot exceed the limit.
  perform 1 from public.chat_accounts where id=p_user_id for update;
  if p_action='pin' then
   if public.chat_favorite_target(p_user_id,p_room,p_conversation) is null then raise exception 'pin_unavailable'; end if;
   if not exists(select 1 from public.chat_conversation_pins where account_id=p_user_id and (room_slug=p_room or conversation_id=p_conversation)) then
    if (select count(*) from public.chat_conversation_pins where account_id=p_user_id)>=50 then raise exception 'pin_limit'; end if;
    insert into public.chat_conversation_pins(account_id,room_slug,conversation_id) values(p_user_id,p_room,p_conversation);
   end if;
  else
   delete from public.chat_conversation_pins where account_id=p_user_id and (room_slug=p_room or conversation_id=p_conversation);
  end if;
 end if;
 select coalesce(jsonb_agg(target order by id),'[]'::jsonb) into result from (
  select id,public.chat_favorite_target(p_user_id,room_slug,conversation_id) as target
  from public.chat_conversation_pins where account_id=p_user_id
 ) visible where target is not null;
 return result;
end $$;
revoke all on function public.chat_pins(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.chat_pins(uuid,text,text,uuid) to service_role;
