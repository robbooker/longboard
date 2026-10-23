-- #301 Replies - Remove Multiple Layers: a conversation is one original message with one list of
-- replies under it. Nothing is deleted.
--
--  * answered_id (new, nullable): for a reply that answered another reply, the message it answered.
--    The app shows "replying to <name>" from it. No foreign key on purpose: when the answered
--    message is later hard-deleted by a moderator the reply still says "replying to a deleted
--    message" instead of silently losing who it answered.
--  * Existing replies to replies (any depth) move under their original top-level message:
--    answered_id = the old reply_to_id, reply_to_id = the top-level ancestor. Their own ids, times,
--    reading order (unread_seq) and reactions are unchanged, so each conversation keeps the same
--    total number of replies, now in one list. A deleted reply that only stayed visible because it
--    had replies under it now has none, so it stops taking space (removed), exactly as deleting a
--    reply without replies does today (change_chat_message).
--  * New replies: a BEFORE INSERT trigger stores a reply aimed at a reply under that reply's
--    original message, with answered_id set, so older clients and any API caller cannot build a
--    second layer again. It covers every insert path (send RPCs, Buddy, scripts).
--  * Retry checks in send_chat_room_message / send_chat_attachment_message compare the asked-for
--    target with coalesce(answered_id, reply_to_id), so a retried reply-to-a-reply is still the
--    same send (not a send_conflict).
--  * Buddy: one answer per source message was a unique index on reply_to_id. Buddy answers to
--    replies now share their original message's reply_to_id, so the index (and the two buddy job
--    functions that look an answer up) key on coalesce(answered_id, reply_to_id) instead.
--  * chat_room_events_after also returns answered_id, so a live row can carry its label.
--
-- Production when written (2026-10-23): 7,690 messages; 845 direct replies, 136 deeper replies
-- (114 at depth 2, 18 at 3, 2 at 4, 2 at 5; 2 of them Buddy answers), no cycles. No paused-room or
-- announcement guard runs during the move (those triggers are switched off for this one UPDATE
-- inside the transaction); the event-stream stamp still runs, so open pages pick the moves up.
-- Idempotent: running it again finds no reply under a reply and changes nothing.
-- Rollback: supabase/rollbacks/20261023120000_chat_single_level_replies.down.sql (puts every moved
-- reply back under the message it answered while that message still exists).

alter table public.longboard_chat_messages add column if not exists answered_id uuid;
comment on column public.longboard_chat_messages.answered_id is
 '#301: the reply this reply answered (shown as "replying to <name>"); reply_to_id is always the top-level message. Null for a direct reply.';

-- Buddy's one-answer-per-source rule, keyed on the message Buddy actually answered.
drop index if exists public.longboard_chat_messages_buddy_reply_idx;
create unique index if not exists longboard_chat_messages_buddy_answer_idx
 on public.longboard_chat_messages ((coalesce(answered_id,reply_to_id)))
 where bot_slug='buddy' and reply_to_id is not null;

-- Move every reply to a reply under its top-level message.
alter table public.longboard_chat_messages
 disable trigger announcement_message_writer,
 disable trigger longboard_chat_messages_require_open,
 disable trigger chat_gainers_source_guard;

with recursive chain as (
 select m.id,m.room_slug,m.reply_to_id answered,m.reply_to_id top,array[m.id] visited,1 hops
 from public.longboard_chat_messages m
 where m.reply_to_id is not null
  and exists(select 1 from public.longboard_chat_messages p where p.id=m.reply_to_id and p.reply_to_id is not null)
 union all
 select c.id,c.room_slug,c.answered,p.reply_to_id,c.visited||p.id,c.hops+1
 from chain c join public.longboard_chat_messages p on p.id=c.top and p.room_slug=c.room_slug
 where p.reply_to_id is not null and not p.id=any(c.visited) and c.hops<100
), moved as (
 select distinct on (c.id) c.id,c.answered,c.top from chain c order by c.id,c.hops desc
)
update public.longboard_chat_messages m
set answered_id=coalesce(m.answered_id,moved.answered),reply_to_id=moved.top
from moved
where m.id=moved.id and moved.top<>moved.answered
 -- Only to a real top-level message (a malformed cycle or a 100-deep chain is left alone).
 and exists(select 1 from public.longboard_chat_messages t where t.id=moved.top and t.room_slug=m.room_slug and t.reply_to_id is null);

-- A deleted reply kept only for the replies under it now has none: it stops taking space.
update public.longboard_chat_messages r set removed=true,revision=r.revision+1
where r.reply_to_id is not null and r.deleted_at is not null and not r.removed
 and not exists(select 1 from public.longboard_chat_messages c where c.reply_to_id=r.id and not c.removed);

alter table public.longboard_chat_messages
 enable trigger announcement_message_writer,
 enable trigger longboard_chat_messages_require_open,
 enable trigger chat_gainers_source_guard;

-- New replies: one level only. Runs first among the BEFORE INSERT triggers (name order), so the
-- parent guard, Buddy and notification triggers all see the top-level message.
create or replace function public.flatten_chat_reply() returns trigger
language plpgsql set search_path='' as $$
declare target uuid; above uuid; hops int:=0;
begin
 if new.reply_to_id is null then return new; end if;
 select reply_to_id into above from public.longboard_chat_messages where id=new.reply_to_id and room_slug=new.room_slug;
 if above is null then return new; end if;
 target:=new.reply_to_id;
 loop
  target:=above;
  select reply_to_id into above from public.longboard_chat_messages where id=target and room_slug=new.room_slug;
  hops:=hops+1;
  exit when above is null or hops>=100;
 end loop;
 new.answered_id:=new.reply_to_id;
 new.reply_to_id:=target;
 return new;
end $$;
revoke all on function public.flatten_chat_reply() from public,anon,authenticated;
grant execute on function public.flatten_chat_reply() to service_role;
drop trigger if exists aa_flatten_chat_reply on public.longboard_chat_messages;
create trigger aa_flatten_chat_reply before insert on public.longboard_chat_messages
 for each row execute function public.flatten_chat_reply();

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
   -- #301: a reply to a reply is stored under the original message; answered_id keeps its target.
   or coalesce(result.answered_id,result.reply_to_id) is distinct from p_reply
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
  if result.room_slug<>room or result.body<>content or coalesce(result.answered_id,result.reply_to_id) is distinct from reply or result.attachment_ids<>files then raise exception 'send_conflict'; end if;
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
  select id into existing_reply from public.longboard_chat_messages where bot_slug='buddy' and coalesce(answered_id,reply_to_id)=candidate;
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
   on conflict ((coalesce(answered_id,reply_to_id))) where bot_slug='buddy' and reply_to_id is not null do nothing returning id into response;
  if response is null then select id into response from public.longboard_chat_messages where bot_slug='buddy' and coalesce(answered_id,reply_to_id)=source; end if;
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
     'body', m.body, 'bot_slug', m.bot_slug, 'reply_to_id', m.reply_to_id, 'answered_id', m.answered_id, 'created_at', m.created_at,
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
