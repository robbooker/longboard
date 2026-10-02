-- Shared message pins are independent from personal conversation pins.
create table public.chat_room_message_pins (
 message_id uuid primary key references public.longboard_chat_messages(id) on delete cascade,
 room_slug text not null references public.longboard_chat_room_state(room_slug) on delete cascade,
 pinned_at timestamptz not null default clock_timestamp(),
 pinned_by uuid references public.chat_accounts(id) on delete set null
);
create index chat_room_message_pins_order on public.chat_room_message_pins(room_slug,pinned_at desc,message_id);
create index chat_room_message_pins_actor on public.chat_room_message_pins(pinned_by);
alter table public.chat_room_message_pins enable row level security;
revoke all on public.chat_room_message_pins from public,anon,authenticated,service_role;
grant select,insert,delete on public.chat_room_message_pins to service_role;

create function public.chat_room_message_pins_list(p_actor uuid,p_room text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not public.chat_account_has_room(p_actor,p_room) then raise exception 'room_forbidden'; end if;
 return jsonb_build_object('canManagePins',exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_actor and p.role='admin'
 ),'pins',coalesce((select jsonb_agg(item order by pinned_at desc,message_id) from (
  select pin.pinned_at,pin.message_id,jsonb_build_object(
   'messageId',m.id,'replyToId',m.reply_to_id,'memberId',m.member_id,
   'authorLabel',case when m.bot_slug is null then coalesce(member.display_name,m.author_label) else m.author_label end,
   'preview',left(case when btrim(m.body)='' and cardinality(m.attachment_ids)>0 then '[Attachment]' else m.body end,240),
   'pinnedAt',pin.pinned_at,'createdAt',m.created_at
  ) item
  from public.chat_room_message_pins pin join public.longboard_chat_messages m on m.id=pin.message_id and m.room_slug=pin.room_slug
  left join public.longboard_chat_members member on member.id=m.member_id
  where pin.room_slug=p_room and m.deleted_at is null and not m.removed
  order by pin.pinned_at desc,pin.message_id limit 10
 ) visible),'[]'::jsonb));
end $$;

create function public.set_chat_room_message_pin(p_actor uuid,p_room text,p_message uuid,p_pin boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare target public.longboard_chat_messages;
begin
 if p_pin is null then raise exception 'invalid_pin'; end if;
 if not public.chat_account_has_room(p_actor,p_room) then raise exception 'room_forbidden'; end if;
 if not exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_actor and p.role='admin') then raise exception 'admin_required'; end if;
 -- Only pin mutations acquire this cap lock. Deletion cleanup never does.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-room-message-pins:'||p_room,0));
 perform public.lock_chat_message_ancestors(p_message,p_room);
 select * into target from public.longboard_chat_messages where id=p_message and room_slug=p_room for update;
 -- Recheck authorization after any lock wait.
 if not public.chat_account_has_room(p_actor,p_room) then raise exception 'room_forbidden'; end if;
 if not exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_actor and p.role='admin') then raise exception 'admin_required'; end if;
 if p_pin then
  if target.id is null or target.deleted_at is not null or target.removed then raise exception 'message_not_found'; end if;
  if not exists(select 1 from public.chat_room_message_pins where message_id=p_message and room_slug=p_room) then
   if (select count(*) from public.chat_room_message_pins where room_slug=p_room)>=10 then raise exception 'pin_limit'; end if;
   insert into public.chat_room_message_pins(message_id,room_slug,pinned_by) values(p_message,p_room,p_actor);
  end if;
 else
  delete from public.chat_room_message_pins where message_id=p_message and room_slug=p_room;
 end if;
 return public.chat_room_message_pins_list(p_actor,p_room);
end $$;

-- Erased messages do not retain previews or automatically regain pins on replacement.
create function public.remove_deleted_chat_message_pin() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 delete from public.chat_room_message_pins where message_id=new.id;
 return new;
end $$;
create trigger remove_deleted_chat_message_pin after update of deleted_at,removed on public.longboard_chat_messages
for each row when (new.deleted_at is not null or new.removed) execute function public.remove_deleted_chat_message_pin();
revoke all on function public.chat_room_message_pins_list(uuid,text),public.set_chat_room_message_pin(uuid,text,uuid,boolean),public.remove_deleted_chat_message_pin() from public,anon,authenticated;
grant execute on function public.chat_room_message_pins_list(uuid,text),public.set_chat_room_message_pin(uuid,text,uuid,boolean),public.remove_deleted_chat_message_pin() to service_role;
