-- Preserve message identity/client-id/read sequences while removing deleted text.
alter table public.longboard_chat_direct_messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  add column revision integer not null default 0 check (revision >= 0);

create function public.longboard_chat_dm_message_action(
  p_user_id uuid, p_conversation uuid, p_message uuid, p_action text,
  p_expected_revision integer, p_body text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare actor uuid; other uuid; c public.longboard_chat_conversations; m public.longboard_chat_direct_messages; changed boolean := false;
begin
  if p_action is null or p_action not in ('edit','delete') then raise exception 'invalid_action'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'invalid_revision'; end if;
  select id into actor from public.longboard_chat_members where user_id=p_user_id;
  if actor is null or not public.chat_account_has_room(p_user_id,'social') then raise exception 'member_required'; end if;
  -- Same lock order as sending/blocking: actor, pair, conversation, message.
  perform pg_advisory_xact_lock(hashtextextended('chat-dm-actor:' || actor::text,0));
  select * into c from public.longboard_chat_conversations where id=p_conversation and actor in (requester_id,recipient_id);
  if not found then raise exception 'conversation_not_found'; end if;
  other := case when actor=c.requester_id then c.recipient_id else c.requester_id end;
  perform pg_advisory_xact_lock(hashtextextended('chat-dm-pair:' || least(actor,other)::text || ':' || greatest(actor,other)::text,0));
  select * into c from public.longboard_chat_conversations where id=p_conversation for update;
  select * into m from public.longboard_chat_direct_messages where id=p_message and conversation_id=c.id and sender_id=actor for update;
  if not found then raise exception 'message_not_found'; end if;
  -- Delete remains available for one's own messages, including blocked/closed conversations.
  if p_action='delete' and m.deleted_at is not null then
    null; -- Idempotent delete, never resurrect or expose the original body.
  elsif m.deleted_at is not null then raise exception 'message_deleted';
  else
    if p_action='edit' then
      if c.status='declined' or exists(select 1 from public.longboard_chat_blocks where (blocker_id=actor and blocked_id=other) or (blocker_id=other and blocked_id=actor)) then raise exception 'conversation_unavailable'; end if;
      if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then raise exception 'invalid_message'; end if;
    end if;
    if m.revision <> p_expected_revision then
      if not (p_action='edit' and m.revision=p_expected_revision+1 and m.body=btrim(p_body)) then raise exception 'message_changed'; end if;
    elsif p_action='edit' then
      if m.body<>btrim(p_body) then
        update public.longboard_chat_direct_messages set body=btrim(p_body),edited_at=clock_timestamp(),revision=revision+1 where id=m.id returning * into m;
        changed := true;
      end if;
    else
      update public.longboard_chat_direct_messages set body='Message deleted',deleted_at=clock_timestamp(),revision=revision+1 where id=m.id returning * into m;
      changed := true;
    end if;
    if changed then update public.longboard_chat_conversations set updated_at=clock_timestamp() where id=c.id; end if;
  end if;
  return jsonb_build_object('message',jsonb_build_object('id',m.id,'seq',m.seq,'sender_id',m.sender_id,'body',m.body,'created_at',m.created_at,'edited_at',m.edited_at,'deleted_at',m.deleted_at,'revision',m.revision));
end $$;
revoke all on function public.longboard_chat_dm_message_action(uuid,uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.longboard_chat_dm_message_action(uuid,uuid,uuid,text,integer,text) to service_role;
