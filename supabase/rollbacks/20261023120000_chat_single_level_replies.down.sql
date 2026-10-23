-- Rollback for 20261023120000_chat_single_level_replies.sql (#301). Safe at any time.
--  * New replies may nest again (the flatten trigger is dropped).
--  * Every reply with answered_id goes back under the message it answered, when that message still
--    exists in the same room (replies posted to a reply after the migration included). One whose
--    answered message was hard-deleted stays under the original message.
--  * Deleted replies the migration marked removed stay removed (their text was already gone).
--  * Buddy's unique answer index, the send/Buddy functions and chat_room_events_after go back to
--    their definitions before the migration; answered_id is dropped.
-- Run the app version before #301 first (or together): the #301 app reads answered_id.

drop trigger if exists aa_flatten_chat_reply on public.longboard_chat_messages;
drop function if exists public.flatten_chat_reply();

alter table public.longboard_chat_messages
 disable trigger announcement_message_writer,
 disable trigger longboard_chat_messages_require_open,
 disable trigger chat_gainers_source_guard;

do $$
begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='longboard_chat_messages' and column_name='answered_id') then
  update public.longboard_chat_messages m set reply_to_id=m.answered_id
  from public.longboard_chat_messages a
  where m.answered_id is not null and a.id=m.answered_id and a.room_slug=m.room_slug and m.reply_to_id is distinct from m.answered_id;
 end if;
end $$;

alter table public.longboard_chat_messages
 enable trigger announcement_message_writer,
 enable trigger longboard_chat_messages_require_open,
 enable trigger chat_gainers_source_guard;

CREATE OR REPLACE FUNCTION public.send_chat_room_message(p_user uuid, p_room text, p_body text, p_reply uuid, p_files uuid[], p_client uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 room public.longboard_chat_room_state;
 member public.longboard_chat_members;
 result public.longboard_chat_messages;
 recent int;
 latest timestamptz;
 status text:='sent';
 badges jsonb;
begin
 if p_client is null then raise exception 'client_id_required'; end if;
 select * into room from public.longboard_chat_room_state where room_slug=p_room;
 if not found then return jsonb_build_object('status','room_unavailable'); end if;
 if not room.is_open then
  return jsonb_build_object('status','paused','room',jsonb_build_object('isOpen',false,'pausedAt',room.paused_at,
   'notice',nullif(btrim(room.pause_reason),''),'updatedAt',room.updated_at));
 end if;
 select * into member from public.longboard_chat_members where user_id=p_user;
 if not found then return jsonb_build_object('status','member_required'); end if;

 -- Same key as send_chat_attachment_message, so old and new app versions exclude each other.
 perform pg_advisory_xact_lock(hashtextextended(member.id::text||p_client::text,0));
 select * into result from public.longboard_chat_messages where member_id=member.id and client_id=p_client;
 if found then
  -- A retry of a message since edited or deleted is still the same send.
  if result.room_slug<>p_room
   or (result.deleted_at is null and result.edited_at is null and result.body<>p_body)
   or result.reply_to_id is distinct from p_reply
   or (result.deleted_at is null and result.attachment_ids<>p_files)
  then return jsonb_build_object('status','send_conflict'); end if;
  status:='duplicate';
 else
  if p_reply is not null and not exists(select 1 from public.longboard_chat_messages
    where id=p_reply and room_slug=p_room and not removed) then
   return jsonb_build_object('status','reply_not_found');
  end if;
  -- S2: concurrent sends by one member queue here, so each sees the others' inserts.
  perform pg_advisory_xact_lock(hashtextextended('chat_send_rate:'||member.id::text,0));
  select count(*),max(created_at) into recent,latest from (
   select created_at from public.longboard_chat_messages
   where guest_id=member.id and created_at>=clock_timestamp()-interval '10 minutes'
   order by created_at desc limit 30) r;
  if recent>=30 then return jsonb_build_object('status','rate_limited','reason','window'); end if;
  if latest>clock_timestamp()-interval '1.5 seconds' then return jsonb_build_object('status','rate_limited','reason','burst'); end if;
  insert into public.longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id,attachment_ids,client_id)
  values(member.id,member.id,p_room,member.display_name,p_body,p_reply,p_files,p_client) returning * into result;
 end if;

 -- Badges as chat_member_membership_sources and the local ShortScout copy give them.
 select jsonb_path_query_array(jsonb_build_array(
   case when s.longboard then 'LB' end,
   case when s.shortscout_subject is not null and exists(select 1 from public.chat_shortscout_paid_subjects(array[s.shortscout_subject])) then 'SS' end),
  '$[*] ? (@ != null)')
 into badges from public.chat_member_membership_sources(array[member.id]) s;
 return jsonb_build_object('status',status,'message',to_jsonb(result)
  ||jsonb_build_object('author_label',member.display_name,'memberships',coalesce(badges,'[]'::jsonb)));
end $function$;

CREATE OR REPLACE FUNCTION public.send_chat_attachment_message(sender uuid, room text, label text, content text, reply uuid, files uuid[], client uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare result public.longboard_chat_messages;
begin
 if client is null then raise exception 'client_id_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(sender::text||client::text,0));
 select * into result from public.longboard_chat_messages where member_id=sender and client_id=client;
 if found then
  if result.room_slug<>room or result.body<>content or result.reply_to_id is distinct from reply or result.attachment_ids<>files then raise exception 'send_conflict'; end if;
  return to_jsonb(result);
 end if;
 insert into public.longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id,attachment_ids,client_id)
 values(sender,sender,room,label,content,reply,files,client) returning * into result;
 return to_jsonb(result);
end $function$;

CREATE OR REPLACE FUNCTION public.claim_chat_buddy_job(worker uuid, source uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare candidate uuid; m public.longboard_chat_messages; j public.chat_buddy_jobs; guard text; existing_reply uuid;
begin
 if worker is null then raise exception 'worker_required'; end if;
 for candidate in select message_id from public.chat_buddy_jobs where (source is null or message_id=source) and
  ((state='pending' and next_attempt_at<=now()) or (state='processing' and lease_until<=now())) order by next_attempt_at,created_at limit 20 loop
  perform public.lock_chat_message_ancestors(candidate,'main');
  select * into m from public.longboard_chat_messages where id=candidate for update skip locked;
  if not found then continue; end if;
  select * into j from public.chat_buddy_jobs where message_id=candidate and ((state='pending' and next_attempt_at<=now()) or (state='processing' and lease_until<=now())) for update skip locked;
  if not found then continue; end if;
  guard:=public.guard_chat_buddy_source(candidate,j.source_body,j.source_edited_at);
  if guard='cancelled' or j.attempts>=3 then
   update public.chat_buddy_jobs set state=case when guard='cancelled' then 'cancelled' else 'failed' end,worker_token=null,lease_until=null,error_code=case when guard='cancelled' then 'source_unavailable' else 'retry_limit' end,updated_at=now() where message_id=candidate;
   update public.longboard_chat_messages set buddy_status=case when guard='cancelled' then 'cancelled' else 'failed' end where id=candidate;
   continue;
  end if;
  if guard='paused' then
   update public.chat_buddy_jobs set state='pending',worker_token=null,lease_until=null,next_attempt_at=now()+interval '1 minute',updated_at=now() where message_id=candidate;
   update public.longboard_chat_messages set buddy_status='pending' where id=candidate;
   continue;
  end if;
  -- An older server may already have answered during a rolling deployment.
  select id into existing_reply from public.longboard_chat_messages where bot_slug='buddy' and reply_to_id=candidate;
  if existing_reply is not null then
   update public.chat_buddy_jobs set state='completed',reply_id=existing_reply,worker_token=null,lease_until=null,error_code=null,updated_at=now() where message_id=candidate;
   update public.longboard_chat_messages set buddy_status='completed' where id=candidate;
   continue;
  end if;
  update public.chat_buddy_jobs set state='processing',attempts=attempts+1,worker_token=worker,lease_until=now()+interval '90 seconds',updated_at=now() where message_id=candidate;
  update public.longboard_chat_messages set buddy_status='processing' where id=candidate;
  return jsonb_build_object('messageId',candidate,'body',j.source_body,'createdAt',m.created_at);
 end loop;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.finish_chat_buddy_job(source uuid, worker uuid, answer text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.chat_buddy_jobs; guard text; response uuid; next_state text;
begin
 perform public.lock_chat_message_ancestors(source,'main');
 perform 1 from public.longboard_chat_messages where id=source for update;
 if not found then return false; end if;
 select * into j from public.chat_buddy_jobs where message_id=source for update;
 if not found or worker is null or j.worker_token is distinct from worker or j.state<>'processing' or j.lease_until<=now() then return false; end if;
 guard:=public.guard_chat_buddy_source(source,j.source_body,j.source_edited_at);
 if guard='cancelled' then next_state:='cancelled';
 elsif guard='paused' then next_state:='pending';
 elsif answer is null then next_state:=case when j.attempts>=3 then 'failed' else 'pending' end;
 else
  if length(btrim(answer)) not between 1 and 600 then raise exception 'invalid_buddy_reply'; end if;
  insert into public.longboard_chat_messages(room_slug,guest_id,author_label,body,bot_slug,reply_to_id)
   values('main',null,'@Buddy',btrim(answer),'buddy',source)
   on conflict (reply_to_id) where bot_slug='buddy' and reply_to_id is not null do nothing returning id into response;
  if response is null then select id into response from public.longboard_chat_messages where bot_slug='buddy' and reply_to_id=source; end if;
  if response is null then raise exception 'reply_save_failed'; end if;
  next_state:='completed';
 end if;
 update public.chat_buddy_jobs set state=next_state,reply_id=response,worker_token=null,lease_until=null,
  next_attempt_at=now()+case when guard='paused' then interval '1 minute' when j.attempts=1 then interval '30 seconds' else interval '2 minutes' end,
  error_code=case when next_state='failed' then 'reply_unavailable' when next_state='cancelled' then 'source_unavailable' else null end,updated_at=now() where message_id=source;
 update public.longboard_chat_messages set buddy_status=next_state where id=source;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.chat_room_events_after(p_room text, p_after bigint, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
  'head', coalesce(h.seq, 0),
  'pins', coalesce(h.pins_seq, 0),
  'state', coalesce(h.state_seq, 0),
  'rows', coalesce((
   select jsonb_agg(r.row order by r.seq) from (
    select m.event_seq as seq, jsonb_build_object(
     'id', m.id, 'room_slug', m.room_slug, 'member_id', m.member_id, 'author_label', m.author_label,
     'body', m.body, 'bot_slug', m.bot_slug, 'reply_to_id', m.reply_to_id, 'created_at', m.created_at,
     'edited_at', m.edited_at, 'deleted_at', m.deleted_at, 'removed', m.removed, 'revision', m.revision,
     'attachment_ids', m.attachment_ids, 'buddy_status', m.buddy_status, 'unread_seq', m.unread_seq,
     'event_seq', m.event_seq) as row
    from public.longboard_chat_messages m
    where m.room_slug = p_room and m.event_seq > p_after
    order by m.event_seq limit least(greatest(p_limit, 1), 500) + 1) r), '[]'::jsonb),
  'deleted', coalesce((
   select jsonb_agg(jsonb_build_object('id', t.message_id, 'event_seq', t.event_seq, 'reply_to_id', t.reply_to_id) order by t.event_seq) from (
    select x.message_id, x.event_seq, x.reply_to_id from public.longboard_chat_room_event_tombstones x
    where x.room_slug = p_room and x.event_seq > p_after
    order by x.event_seq limit least(greatest(p_limit, 1), 500) + 1) t), '[]'::jsonb),
  'reactions', coalesce((
   select jsonb_agg(jsonb_build_object('id', e.message_id, 'event_seq', e.event_seq) order by e.event_seq) from (
    select x.message_id, x.event_seq from public.longboard_chat_room_reaction_events x
    where x.room_slug = p_room and x.event_seq > p_after
    order by x.event_seq limit least(greatest(p_limit, 1), 500) + 1) e), '[]'::jsonb)
 )
 from (select 1) one
 left join public.longboard_chat_room_event_heads h on h.room_slug = p_room;
$function$;

drop index if exists public.longboard_chat_messages_buddy_answer_idx;
create unique index if not exists longboard_chat_messages_buddy_reply_idx
 on public.longboard_chat_messages(reply_to_id)
 where bot_slug='buddy' and reply_to_id is not null;
alter table public.longboard_chat_messages drop column if exists answered_id;
