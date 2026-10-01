-- Exact viewed targets plus independent observed event boundaries. No message
-- sequence or thread-root cursor implies that every associated alert was seen.
create function public.read_visible_chat_notifications(
 actor uuid,p_room text,p_conversation uuid,p_message_ids uuid[],
 p_mention_through bigint,p_reaction_through bigint
) returns void language plpgsql security invoker set search_path='' as $$
declare member uuid; other uuid;
begin
 if (p_room is null)=(p_conversation is null) or coalesce(cardinality(p_message_ids),0) not between 1 and 100
  or array_position(p_message_ids,null) is not null
  or cardinality(p_message_ids)<>(select count(distinct id) from unnest(p_message_ids) id)
  or p_mention_through is null or p_reaction_through is null or p_mention_through<0 or p_reaction_through<0
 then raise exception 'invalid_visible_snapshot'; end if;
 select id into member from public.longboard_chat_members where user_id=actor;
 if member is null then raise exception 'member_required'; end if;
 if p_room is not null then
  if not public.chat_account_has_room(actor,p_room) then raise exception 'room_forbidden'; end if;
  update public.chat_room_mentions n set read_at=clock_timestamp()
  from public.longboard_chat_messages m
  where n.account_id=actor and n.read_at is null and n.seq<=p_mention_through
   and n.room_slug=p_room and n.message_id=m.id and m.id=any(p_message_ids)
   and m.room_slug=p_room and m.deleted_at is null and not m.removed
   and not exists(select 1 from public.longboard_chat_blocks b where
    (b.blocker_id=member and b.blocked_id=m.member_id) or (b.blocked_id=member and b.blocker_id=m.member_id))
   and not exists(select 1 from public.longboard_chat_messages root join public.longboard_chat_blocks b on
    (b.blocker_id=member and b.blocked_id=root.member_id) or (b.blocked_id=member and b.blocker_id=root.member_id)
    where root.id=n.thread_root_id);
  update public.chat_reaction_notifications n set read_at=clock_timestamp()
  from public.eligible_chat_reaction_notifications(actor,array[p_room]) eligible
  where n.id=eligible.id and eligible.kind='room' and eligible.room=p_room
   and eligible.message_id=any(p_message_ids) and eligible.seq<=p_reaction_through;
 else
  if p_mention_through<>0 then raise exception 'invalid_visible_snapshot'; end if;
  if not public.chat_account_has_room(actor,'social') then raise exception 'room_forbidden'; end if;
  select case when c.requester_id=member then c.recipient_id else c.requester_id end into other
   from public.longboard_chat_conversations c where c.id=p_conversation
    and member in(c.requester_id,c.recipient_id) and c.status='accepted';
  if other is null or exists(select 1 from public.longboard_chat_blocks b where
   (b.blocker_id=member and b.blocked_id=other) or (b.blocked_id=member and b.blocker_id=other))
  then raise exception 'conversation_unavailable'; end if;
  update public.chat_reaction_notifications n set read_at=clock_timestamp()
  from public.eligible_chat_reaction_notifications(actor,array[]::text[]) eligible
  where n.id=eligible.id and eligible.kind='dm' and eligible.conversation_id=p_conversation
   and eligible.message_id=any(p_message_ids) and eligible.seq<=p_reaction_through;
 end if;
end $$;
revoke all on function public.read_visible_chat_notifications(uuid,text,uuid,uuid[],bigint,bigint) from public,anon,authenticated;
grant execute on function public.read_visible_chat_notifications(uuid,text,uuid,uuid[],bigint,bigint) to service_role;

-- Old automatic room clients lack target IDs. Keep the signature through rollout
-- but do not let their broad room cursor acknowledge unseen notifications.
create or replace function public.read_visible_chat_room_alerts(actor uuid,room text,through_seq bigint)
returns void language plpgsql security invoker set search_path='' as $$ begin return; end $$;
