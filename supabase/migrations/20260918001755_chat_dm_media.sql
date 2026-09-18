-- Private files reuse quarantine, scanning, quota, and delayed object cleanup.
alter table public.longboard_chat_direct_messages add column attachment_ids uuid[] not null default '{}';
alter table public.longboard_chat_direct_messages drop constraint longboard_chat_direct_messages_body_check;
alter table public.longboard_chat_direct_messages add constraint longboard_chat_direct_messages_body_check check(char_length(body)<=2000 and (char_length(btrim(body))>0 or cardinality(attachment_ids)>0));
alter table public.chat_attachments alter column room_slug drop not null;
alter table public.chat_attachments add column conversation_id uuid references public.longboard_chat_conversations(id) on delete cascade,
 add column dm_message_id uuid references public.longboard_chat_direct_messages(id) on delete cascade deferrable initially deferred;
alter table public.chat_attachments drop constraint chat_attachments_check1;
alter table public.chat_attachments add constraint chat_attachment_scope check ((room_slug is not null)::integer+(conversation_id is not null)::integer=1),
 add constraint chat_attachment_message_scope check ((room_message_id is null or room_slug is not null) and (dm_message_id is null or conversation_id is not null)),
 add constraint chat_attachment_attached_message check(status<>'attached' or ((room_message_id is not null)::integer+(dm_message_id is not null)::integer=1));
create index chat_attachments_dm_message_idx on public.chat_attachments(dm_message_id) where dm_message_id is not null;
create index chat_attachments_conversation_idx on public.chat_attachments(conversation_id) where conversation_id is not null;

create function public.reserve_chat_dm_attachment(sender uuid,conversation uuid,name text,mime text,bytes integer)
returns public.chat_attachments language plpgsql security invoker set search_path='' as $$
declare c public.longboard_chat_conversations; other uuid; result public.chat_attachments; next_id uuid:=gen_random_uuid();
begin
 if not exists(select 1 from public.longboard_chat_members where id=sender and public.chat_account_has_room(user_id,'social')) then raise exception 'member_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-dm-actor:'||sender::text,0));
 select * into c from public.longboard_chat_conversations where id=conversation and sender in(requester_id,recipient_id);
 if not found then raise exception 'conversation_not_found'; end if;
 other:=case when c.requester_id=sender then c.recipient_id else c.requester_id end;
 perform pg_advisory_xact_lock(hashtextextended('chat-dm-pair:'||least(sender,other)::text||':'||greatest(sender,other)::text,0));
 select * into c from public.longboard_chat_conversations where id=conversation for update;
 if c.status<>'accepted' then raise exception 'request_not_accepted'; end if;
 if exists(select 1 from public.longboard_chat_blocks where (blocker_id=sender and blocked_id=other) or (blocker_id=other and blocked_id=sender)) then raise exception 'conversation_unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-files:'||sender::text,0));
 insert into public.chat_attachment_daily_usage(member_id,day,uploads) values(sender,(now() at time zone 'UTC')::date,1)
 on conflict(member_id,day) do update set uploads=public.chat_attachment_daily_usage.uploads+1 where public.chat_attachment_daily_usage.uploads<100;
 if not found then raise exception 'attachment_rate_limited'; end if;
 insert into public.chat_attachments(id,member_id,conversation_id,filename,mime_type,byte_size,upload_path)
 values(next_id,sender,conversation,name,mime,bytes,'quarantine/'||next_id::text) returning * into result;
 return result;
end $$;
revoke all on function public.reserve_chat_dm_attachment(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_chat_dm_attachment(uuid,uuid,text,text,integer) to service_role;

create function public.bind_chat_dm_attachments() returns trigger language plpgsql security invoker set search_path='' as $$
declare aid uuid; a public.chat_attachments;
begin
 if tg_op='UPDATE' and old.attachment_ids=new.attachment_ids then return new; end if;
 if tg_op='UPDATE' and cardinality(old.attachment_ids)>0 then raise exception 'attachments_immutable'; end if;
 if new.deleted_at is not null then raise exception 'message_deleted'; end if;
 if cardinality(new.attachment_ids)>3 or cardinality(new.attachment_ids)<>(select count(distinct x) from unnest(new.attachment_ids)x) then raise exception 'invalid_attachments'; end if;
 foreach aid in array new.attachment_ids loop
  select * into a from public.chat_attachments where id=aid for update;
  if not found or a.status<>'ready' or a.member_id<>new.sender_id then raise exception 'attachment_not_ready'; end if;
  if a.conversation_id is distinct from new.conversation_id then raise exception 'attachment_wrong_conversation'; end if;
  update public.chat_attachments set status='attached',dm_message_id=new.id where id=aid;
 end loop;
 return new;
end $$;
create trigger bind_chat_dm_attachments before insert or update of attachment_ids on public.longboard_chat_direct_messages for each row execute function public.bind_chat_dm_attachments();

create function public.delete_chat_dm_attachments() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.deleted_at is null and new.deleted_at is not null then
  delete from public.chat_attachments where dm_message_id=new.id;
 end if;
 return new;
end $$;
create trigger delete_chat_dm_attachments after update of deleted_at on public.longboard_chat_direct_messages for each row execute function public.delete_chat_dm_attachments();

-- Existing DM action performs participant, block, rate-limit and read-sequence checks.
-- Both the message and scanned file binding commit together, or both roll back.
create function public.longboard_chat_dm_media_send(p_user_id uuid,p_action text,p_target uuid,p_body text,p_client_id uuid,p_files uuid[],p_value boolean default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; result jsonb; m public.longboard_chat_direct_messages; existed boolean;
begin
 if p_action is distinct from 'send' or p_body is null or char_length(btrim(p_body))>2000 or p_files is null or cardinality(p_files) not between 1 and 3 then raise exception 'invalid_message'; end if;
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
end $$;
revoke all on function public.longboard_chat_dm_media_send(uuid,text,uuid,text,uuid,uuid[],boolean) from public,anon,authenticated;
grant execute on function public.longboard_chat_dm_media_send(uuid,text,uuid,text,uuid,uuid[],boolean) to service_role;

create or replace function public.longboard_chat_dm_message_action(
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
      if p_body is null or (char_length(btrim(p_body))>2000 or (char_length(btrim(p_body))=0 and cardinality(m.attachment_ids)=0)) then raise exception 'invalid_message'; end if;
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
end $$;
revoke all on function public.longboard_chat_dm_message_action(uuid,uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.longboard_chat_dm_message_action(uuid,uuid,uuid,text,integer,text) to service_role;

create or replace function public.longboard_chat_inbox(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(item order by updated_at desc),'[]'::jsonb) from (
    select c.updated_at, jsonb_build_object(
      'id',c.id, 'status',c.status, 'incoming',c.recipient_id=me.id,
      'otherId',other.id, 'otherName',other.display_name,
      'blockedByMe',exists(select 1 from public.longboard_chat_blocks b where b.blocker_id=me.id and b.blocked_id=other.id),
      'unavailable',exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=other.id) or (b.blocker_id=other.id and b.blocked_id=me.id)),
      'lastBody',(select case when d.body='' and cardinality(d.attachment_ids)>0 then '[Attachment]' else d.body end from public.longboard_chat_direct_messages d where d.conversation_id=c.id order by d.seq desc limit 1),
      'updatedAt',c.updated_at,
      'unread',case when c.status='declined' then 0 else (select count(*) from public.longboard_chat_direct_messages d where d.conversation_id=c.id and d.sender_id<>me.id and d.seq>case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end) end
    ) as item
    from public.longboard_chat_members me
    join public.longboard_chat_conversations c on c.requester_id=me.id or c.recipient_id=me.id
    join public.longboard_chat_members other on other.id=case when c.requester_id=me.id then c.recipient_id else c.requester_id end
    where me.user_id=p_user_id
  ) conversations;
$$;

revoke all on function public.bind_chat_dm_attachments(),public.delete_chat_dm_attachments() from public,anon,authenticated;
grant execute on function public.bind_chat_dm_attachments(),public.delete_chat_dm_attachments() to service_role;
