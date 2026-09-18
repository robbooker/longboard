-- Legacy public like rows and clients remain unchanged.
create table public.chat_message_reaction_choices (
 room_message_id uuid references public.longboard_chat_messages(id) on delete cascade,
 dm_message_id uuid references public.longboard_chat_direct_messages(id) on delete cascade,
 member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
 emoji text not null check(emoji in ('like','heart','laugh')),
 active boolean not null default true,
 updated_at timestamptz not null default now(),
 check(num_nonnulls(room_message_id,dm_message_id)=1),
 check(room_message_id is null or emoji<>'like'),
 unique(room_message_id,member_id,emoji), unique(dm_message_id,member_id,emoji)
);
alter table public.chat_message_reaction_choices enable row level security;
revoke all on public.chat_message_reaction_choices from public,anon,authenticated;
grant select,insert,update,delete on public.chat_message_reaction_choices to service_role;

create function public.check_chat_reaction_target(p_actor uuid,p_room text,p_conversation uuid,p_message uuid,p_write boolean default false)
returns uuid language plpgsql security invoker set search_path='' as $$
declare actor uuid; other uuid; c public.longboard_chat_conversations; m public.longboard_chat_direct_messages; author uuid;
begin
 select id into actor from public.longboard_chat_members where user_id=p_actor;
 if actor is null then raise exception 'member_required'; end if;
 if (p_room is null)=(p_conversation is null) then raise exception 'invalid_target'; end if;
 if p_room is not null then
  if not public.chat_account_has_room(p_actor,p_room) then raise exception 'room_forbidden'; end if;
  select member_id into author from public.longboard_chat_messages where id=p_message and room_slug=p_room;
  if not found then raise exception 'message_not_found'; end if;
  if p_write then
   -- Serialize with block changes, room pauses and message deletion.
   perform pg_advisory_xact_lock(hashtextextended('chat-dm-actor:'||actor::text,0));
   if author is not null then perform pg_advisory_xact_lock(hashtextextended('chat-dm-pair:'||least(actor,author)::text||':'||greatest(actor,author)::text,0)); end if;
   perform 1 from public.longboard_chat_room_state where room_slug=p_room and is_open for share;
   if not found then raise exception 'chat_paused'; end if;
   perform 1 from public.longboard_chat_messages where id=p_message and room_slug=p_room for update;
   if not found then raise exception 'message_not_found'; end if;
  end if;
  if exists(select 1 from public.longboard_chat_blocks where (blocker_id=actor and blocked_id=author) or (blocker_id=author and blocked_id=actor)) then raise exception 'message_not_found'; end if;
 else
  if not public.chat_account_has_room(p_actor,'social') then raise exception 'room_forbidden'; end if;
  if p_write then perform pg_advisory_xact_lock(hashtextextended('chat-dm-actor:'||actor::text,0)); end if;
  select * into c from public.longboard_chat_conversations where id=p_conversation and actor in(requester_id,recipient_id);
  if not found then raise exception 'conversation_not_found'; end if;
  other:=case when c.requester_id=actor then c.recipient_id else c.requester_id end;
  if p_write then
   perform pg_advisory_xact_lock(hashtextextended('chat-dm-pair:'||least(actor,other)::text||':'||greatest(actor,other)::text,0));
   select * into c from public.longboard_chat_conversations where id=p_conversation for update;
  end if;
  if c.status<>'accepted' or exists(select 1 from public.longboard_chat_blocks where (blocker_id=actor and blocked_id=other) or (blocker_id=other and blocked_id=actor)) then raise exception 'conversation_unavailable'; end if;
  if p_write then select * into m from public.longboard_chat_direct_messages where id=p_message and conversation_id=c.id for update;
  else select * into m from public.longboard_chat_direct_messages where id=p_message and conversation_id=c.id; end if;
  if not found or m.deleted_at is not null then raise exception 'message_not_found'; end if;
 end if;
 return actor;
end $$;

create function public.read_chat_message_reactions(p_actor uuid,p_room text,p_conversation uuid,p_messages uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare mid uuid; actor uuid; result jsonb:='{}'; items jsonb;
begin
 if coalesce(cardinality(p_messages),0) not between 1 and 100 then raise exception 'invalid_target'; end if;
 foreach mid in array p_messages loop
  begin
   actor:=public.check_chat_reaction_target(p_actor,p_room,p_conversation,mid,false);
   with reactions as (
    select r.emoji,r.member_id,g.display_name from public.chat_message_reaction_choices r join public.longboard_chat_members g on g.id=r.member_id
    where r.active and ((p_room is not null and r.room_message_id=mid) or (p_conversation is not null and r.dm_message_id=mid))
    union all
    select 'like',r.guest_id,g.display_name from public.longboard_chat_reactions r join public.longboard_chat_guests g on g.id=r.guest_id
    where p_room is not null and r.message_id=mid and r.active
   ), grouped as (
    select emoji,count(*) as count,bool_or(member_id=actor) as mine,(array_agg(display_name order by display_name,member_id))[1:10] as names from reactions group by emoji
   ) select coalesce(jsonb_agg(to_jsonb(grouped)),'[]') into items from grouped;
   result:=result||jsonb_build_object(mid::text,items);
  exception when raise_exception then
   if sqlerrm in ('message_not_found','conversation_not_found','conversation_unavailable','room_forbidden','member_required') then result:=result||jsonb_build_object(mid::text,'[]'::jsonb); else raise; end if;
  end;
 end loop;
 return result;
end $$;

create function public.set_chat_message_reaction(p_actor uuid,p_room text,p_conversation uuid,p_message uuid,p_emoji text,p_active boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid;
begin
 if p_emoji is null or p_emoji not in ('like','heart','laugh') or p_active is null then raise exception 'invalid_reaction'; end if;
 actor:=public.check_chat_reaction_target(p_actor,p_room,p_conversation,p_message,true);
 if p_room is not null and p_emoji='like' then
  insert into public.longboard_chat_reactions(message_id,guest_id,active,updated_at) values(p_message,actor,p_active,clock_timestamp())
  on conflict(message_id,guest_id) do update set active=excluded.active,updated_at=excluded.updated_at;
 elsif p_room is not null then
  insert into public.chat_message_reaction_choices(room_message_id,member_id,emoji,active) values(p_message,actor,p_emoji,p_active)
  on conflict(room_message_id,member_id,emoji) do update set active=excluded.active,updated_at=clock_timestamp();
 else
  insert into public.chat_message_reaction_choices(dm_message_id,member_id,emoji,active) values(p_message,actor,p_emoji,p_active)
  on conflict(dm_message_id,member_id,emoji) do update set active=excluded.active,updated_at=clock_timestamp();
 end if;
 return public.read_chat_message_reactions(p_actor,p_room,p_conversation,array[p_message]);
end $$;
revoke all on function public.check_chat_reaction_target(uuid,text,uuid,uuid,boolean),public.read_chat_message_reactions(uuid,text,uuid,uuid[]),public.set_chat_message_reaction(uuid,text,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.check_chat_reaction_target(uuid,text,uuid,uuid,boolean),public.read_chat_message_reactions(uuid,text,uuid,uuid[]),public.set_chat_message_reaction(uuid,text,uuid,uuid,text,boolean) to service_role;
