-- #367: longer messages. Members can write up to 10,000 characters in room messages, thread
-- replies and private messages, and edits get the same limit. Before this: 600 for room
-- messages and replies, 2,000 for private messages.
--
--  * longboard_chat_messages_body_check: the member cap goes from 600 to 10,000. Everything else
--    is unchanged: the Gainers broadcast keeps its 4,096, and a message still needs text or a file.
--  * longboard_chat_direct_messages_body_check: 2,000 -> 10,000, still text or a file.
--  * change_chat_message (room edits), longboard_chat_dm_action (private request/send),
--    longboard_chat_dm_media_send (private send with files), longboard_chat_dm_message_action
--    (private edits): each is its current definition, copied from the database with
--    pg_get_functiondef, with only the length number changed. Owners and grants are kept by
--    CREATE OR REPLACE.
--
-- Not changed: Buddy replies (600, 'invalid_buddy_reply'), What's New notes (600), reports (1,000),
-- push previews (left(body,600) already cuts long messages short), search (the tsvector index and
-- the embeddings take the whole body; nothing cuts it to 600).
-- Rollback: supabase/rollbacks/20261105120000_chat_longer_messages.down.sql
alter table public.longboard_chat_messages drop constraint longboard_chat_messages_body_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_body_check check(
 char_length(btrim(body)) <= case when room_slug='gainers' then 4096 else 10000 end
 and (char_length(btrim(body))>=1 or cardinality(attachment_ids)>0));

alter table public.longboard_chat_direct_messages drop constraint longboard_chat_direct_messages_body_check;
alter table public.longboard_chat_direct_messages add constraint longboard_chat_direct_messages_body_check check(char_length(body)<=10000 and (char_length(btrim(body))>0 or cardinality(attachment_ids)>0));

CREATE OR REPLACE FUNCTION public.change_chat_message(p_actor uuid, p_message uuid, p_room text, p_action text, p_body text DEFAULT NULL::text, p_expected_body text DEFAULT NULL::text, p_admin boolean DEFAULT false, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m public.longboard_chat_messages; ancestor public.longboard_chat_messages; own boolean; moderator boolean; parent_id uuid; note_edit boolean;
begin
 if p_action not in ('edit','delete') or p_action is null then raise exception 'invalid_action'; end if;
 if p_room in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings','whats-new') and not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'message_forbidden'; end if;
 if not public.chat_account_has_room(p_actor,p_room) then raise exception 'room_forbidden'; end if;
 perform public.lock_chat_message_ancestors(p_message,p_room);
 select * into m from public.longboard_chat_messages where id=p_message and room_slug=p_room for update;
 if not found then raise exception 'message_not_found'; end if;
 own:=m.member_id is not null and exists(select 1 from public.longboard_chat_members where id=m.member_id and user_id=p_actor);
 moderator:=p_admin and exists(select 1 from public.profiles where id=p_actor and role='admin');
 -- #302: admins can also edit the automatic What's New notes (Booker Chat Updates).
 note_edit:=p_action='edit' and moderator and p_room='whats-new' and m.bot_slug='whats-new' and m.member_id is null;
 if not own and not note_edit and not (p_action='delete' and moderator) then raise exception 'message_forbidden'; end if;
 -- Existing administrator moderation stays separate from members' own-message actions.
 if not own and not note_edit then
  delete from public.longboard_chat_messages where id=m.id;
  insert into public.chat_message_actions(message_id,room_slug,actor_id,action) values(m.id,m.room_slug,p_actor,'admin_delete');
  -- Moderation can remove the final child of a member-deleted parent too.
  parent_id:=m.reply_to_id;
  while parent_id is not null loop
   select * into ancestor from public.longboard_chat_messages where id=parent_id for update;
   exit when not found or ancestor.deleted_at is null or ancestor.removed or exists(select 1 from public.longboard_chat_messages where reply_to_id=ancestor.id and not removed);
   update public.longboard_chat_messages set removed=true,revision=revision+1 where id=ancestor.id;
   parent_id:=ancestor.reply_to_id;
  end loop;
  return jsonb_build_object('deletedId',m.id,'message',null);
 end if;
 if p_action='delete' and m.deleted_at is not null then return jsonb_build_object('deletedId',m.id,'message',to_jsonb(m)); end if;
 if m.removed then raise exception 'message_not_found'; end if;
 if p_expected_revision is not null and m.revision<>p_expected_revision then raise exception 'message_changed'; end if;
 if p_action='edit' then
  if m.bot_slug is not null and not note_edit then raise exception 'message_forbidden'; end if;
  if not exists(select 1 from public.longboard_chat_room_state where room_slug=p_room and is_open) then raise exception 'chat_paused'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 10000 then raise exception 'invalid_message'; end if;
  if p_expected_body is null or m.body<>p_expected_body or (m.deleted_at is not null and p_expected_revision is distinct from m.revision) then raise exception 'message_changed'; end if;
  if m.body=btrim(p_body) and m.deleted_at is null then return to_jsonb(m); end if;
  update public.longboard_chat_messages set body=btrim(p_body),edited_at=clock_timestamp(),deleted_at=null,revision=revision+1 where id=m.id returning * into m;
 else
  update public.longboard_chat_messages set body='Message deleted',deleted_at=clock_timestamp(),attachment_ids='{}',buddy_status=null,
   removed=not exists(select 1 from public.longboard_chat_messages r where r.reply_to_id=m.id and not r.removed),revision=revision+1
   where id=m.id returning * into m;
  delete from public.chat_attachments where room_message_id=m.id;
  delete from public.longboard_chat_reactions where message_id=m.id;
  delete from public.chat_message_reaction_choices where room_message_id=m.id;
  delete from public.chat_room_mentions where message_id=m.id;
  delete from public.chat_buddy_jobs where message_id=m.id;
  -- A deleted ancestor stops occupying space when its last surviving reply disappears.
  parent_id:=m.reply_to_id;
  while m.removed and parent_id is not null loop
   select * into ancestor from public.longboard_chat_messages where id=parent_id for update;
   exit when not found or ancestor.deleted_at is null or ancestor.removed or exists(select 1 from public.longboard_chat_messages where reply_to_id=ancestor.id and not removed);
   update public.longboard_chat_messages set removed=true,revision=revision+1 where id=ancestor.id;
   parent_id:=ancestor.reply_to_id;
  end loop;
 end if;
 insert into public.chat_message_actions(message_id,room_slug,actor_id,action) values(m.id,m.room_slug,p_actor,p_action);
 if p_action='delete' then return jsonb_build_object('deletedId',m.id,'message',to_jsonb(m)); end if;
 return to_jsonb(m);
end $function$;

CREATE OR REPLACE FUNCTION public.longboard_chat_dm_action(p_user_id uuid, p_action text, p_target uuid DEFAULT NULL::uuid, p_body text DEFAULT NULL::text, p_client_id uuid DEFAULT NULL::uuid, p_value boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  actor uuid; other uuid; c public.longboard_chat_conversations;
  msg public.longboard_chat_direct_messages; allowed boolean; latest bigint;
begin
  select id into actor from public.longboard_chat_members where user_id=p_user_id;
  if actor is null or not public.chat_account_has_room(p_user_id,'social') then raise exception 'member_required'; end if;
  -- Serialize a sender's rate limits across tabs/devices.
  perform pg_advisory_xact_lock(hashtextextended('chat-dm-actor:' || actor::text,0));
  if p_action='settings' then
    if p_value is null then raise exception 'invalid_settings'; end if;
    update public.longboard_chat_members set accepts_requests=p_value where id=actor;
    return jsonb_build_object('ok',true);
  end if;
  if p_action='request' then other:=p_target;
  else
    select * into c from public.longboard_chat_conversations where id=p_target and (requester_id=actor or recipient_id=actor);
    if not found then raise exception 'conversation_not_found'; end if;
    other:=case when c.requester_id=actor then c.recipient_id else c.requester_id end;
  end if;
  if other is null or other=actor then raise exception 'invalid_recipient'; end if;
  -- Requests in both directions, blocks, acceptance and sends use one pair lock.
  perform pg_advisory_xact_lock(hashtextextended('chat-dm-pair:' || least(actor,other)::text || ':' || greatest(actor,other)::text,0));
  if p_action='request' then
    select * into c from public.longboard_chat_conversations where least(requester_id,recipient_id)=least(actor,other) and greatest(requester_id,recipient_id)=greatest(actor,other);
    if found then return jsonb_build_object('conversationId',c.id); end if;
  else
    select * into c from public.longboard_chat_conversations where id=p_target for update;
  end if;
  if p_action='block' then
    insert into public.longboard_chat_blocks(blocker_id,blocked_id) values(actor,other) on conflict do nothing;
    update public.longboard_chat_conversations set updated_at=now() where id=c.id;
    return jsonb_build_object('conversationId',c.id);
  elsif p_action='unblock' then
    delete from public.longboard_chat_blocks where blocker_id=actor and blocked_id=other;
    update public.longboard_chat_conversations set updated_at=now() where id=c.id;
    return jsonb_build_object('conversationId',c.id);
  elsif p_action='report' then
    if p_body is null or char_length(btrim(p_body)) not between 1 and 1000 then raise exception 'invalid_report'; end if;
    insert into public.longboard_chat_reports(reporter_id,conversation_id,reason) values(actor,c.id,btrim(p_body))
      on conflict(reporter_id,conversation_id) do update set reason=excluded.reason;
    return jsonb_build_object('conversationId',c.id);
  elsif p_action='read' then
    -- Acknowledge only a message actually rendered by this client, never unseen arrivals.
    select seq into latest from public.longboard_chat_direct_messages where id=p_client_id and conversation_id=c.id;
    if latest is null then raise exception 'message_not_found'; end if;
    update public.longboard_chat_conversations set
      requester_read_seq=case when requester_id=actor then greatest(requester_read_seq,latest) else requester_read_seq end,
      recipient_read_seq=case when recipient_id=actor then greatest(recipient_read_seq,latest) else recipient_read_seq end
    where id=c.id;
    return jsonb_build_object('conversationId',c.id);
  end if;
  if exists(select 1 from public.longboard_chat_blocks where (blocker_id=actor and blocked_id=other) or (blocker_id=other and blocked_id=actor)) then raise exception 'conversation_unavailable'; end if;
  if p_action in ('accept','decline') then
    if actor<>c.recipient_id or c.status<>'pending' then raise exception 'request_not_pending'; end if;
    update public.longboard_chat_conversations set status=case when p_action='accept' then 'accepted' else 'declined' end, updated_at=now() where id=c.id;
    return jsonb_build_object('conversationId',c.id);
  end if;
  if p_action not in ('request','send') then raise exception 'invalid_action'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 10000 or p_client_id is null then raise exception 'invalid_message'; end if;
  if p_action='send' and c.status<>'accepted' then raise exception 'request_not_accepted'; end if;
  select * into msg from public.longboard_chat_direct_messages where sender_id=actor and client_id=p_client_id;
  if found then
    if msg.conversation_id is distinct from c.id then raise exception 'invalid_client_id'; end if;
    return jsonb_build_object('conversationId',c.id);
  end if;
  if (select count(*) from public.longboard_chat_direct_messages where sender_id=actor and created_at>now()-interval '10 minutes')>=60 then raise exception 'rate_limited'; end if;
  if p_action='request' then
    select accepts_requests into allowed from public.longboard_chat_members where id=other for share;
    if not coalesce(allowed,false) then raise exception 'requests_unavailable'; end if;
    if (select count(*) from public.longboard_chat_conversations where requester_id=actor and created_at>now()-interval '1 day')>=10 then raise exception 'request_rate_limited'; end if;
    insert into public.longboard_chat_conversations(requester_id,recipient_id) values(actor,other) returning * into c;
  end if;
  insert into public.longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values(c.id,actor,p_client_id,btrim(p_body)) returning * into msg;
  update public.longboard_chat_conversations set updated_at=now(),
    requester_read_seq=case when requester_id=actor then msg.seq else requester_read_seq end,
    recipient_read_seq=case when recipient_id=actor then msg.seq else recipient_read_seq end
  where id=c.id;
  return jsonb_build_object('conversationId',c.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.longboard_chat_dm_media_send(p_user_id uuid, p_action text, p_target uuid, p_body text, p_client_id uuid, p_files uuid[], p_value boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor uuid; result jsonb; m public.longboard_chat_direct_messages; existed boolean;
begin
 if p_action is distinct from 'send' or p_body is null or char_length(btrim(p_body))>10000 or p_files is null or cardinality(p_files) not between 1 and 3 then raise exception 'invalid_message'; end if;
 select id into actor from public.longboard_chat_members where user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-dm-actor:'||actor::text,0));
 select exists(select 1 from public.longboard_chat_direct_messages where sender_id=actor and client_id=p_client_id) into existed;
 -- A media-only message gets a useful inbox preview; no synthetic text is shown in the body.
 result:=public.longboard_chat_dm_action(p_user_id,'send',p_target,coalesce(nullif(btrim(p_body),''),'[Attachment]'),p_client_id,null);
 select * into m from public.longboard_chat_direct_messages where sender_id=actor and client_id=p_client_id for update;
 if cardinality(m.attachment_ids)>0 then
  if m.attachment_ids<>p_files or (m.deleted_at is null and m.edited_at is null and m.body<>btrim(p_body)) then raise exception 'invalid_client_id'; end if;
  return result;
 end if;
 -- An older text-only client id must never be converted into a media message.
 if m.deleted_at is not null or m.edited_at is not null or existed then raise exception 'invalid_client_id'; end if;
 update public.longboard_chat_direct_messages set body=btrim(p_body),attachment_ids=p_files where id=m.id;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.longboard_chat_dm_message_action(p_user_id uuid, p_conversation uuid, p_message uuid, p_action text, p_expected_revision integer, p_body text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      if p_body is null or (char_length(btrim(p_body))>10000 or (char_length(btrim(p_body))=0 and cardinality(m.attachment_ids)=0)) then raise exception 'invalid_message'; end if;
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
  return jsonb_build_object('message',jsonb_build_object('id',m.id,'seq',m.seq,'sender_id',m.sender_id,'body',m.body,'created_at',m.created_at,'edited_at',m.edited_at,'deleted_at',m.deleted_at,'revision',m.revision,'attachment_ids',m.attachment_ids));
end $function$;
