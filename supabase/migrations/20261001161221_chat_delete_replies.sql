-- Preserve message IDs/client IDs and sequence cursors while erasing deleted content.
alter table public.longboard_chat_messages add column deleted_at timestamptz,
 add column removed boolean not null default false,
 add column revision integer not null default 0 check(revision>=0);
create index chat_room_visible_history on public.longboard_chat_messages(room_slug,created_at desc) where not removed and reply_to_id is null;

-- All room mutations take ancestor locks root-first. This also orders admin FK
-- detachment and reply-notification root references against nested child deletion.
create function public.lock_chat_message_ancestors(p_message uuid,p_room text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform locked.id from public.longboard_chat_messages locked join (
  with recursive ancestors as (
   select id,reply_to_id,0 depth,array[id] visited from public.longboard_chat_messages where id=p_message and room_slug=p_room
   union all
   select parent.id,parent.reply_to_id,ancestors.depth+1,ancestors.visited||parent.id
   from ancestors join public.longboard_chat_messages parent on parent.id=ancestors.reply_to_id
   where parent.room_slug=p_room and not parent.id=any(ancestors.visited)
  ) select id,depth from ancestors
 ) chain on chain.id=locked.id order by chain.depth desc for update of locked;
end $$;
revoke all on function public.lock_chat_message_ancestors(uuid,text) from public,anon,authenticated;
grant execute on function public.lock_chat_message_ancestors(uuid,text) to service_role;

-- Replies lock the same parent as deletion, so a concurrent send cannot become orphaned.
create function public.guard_chat_reply_parent() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.reply_to_id is not null then
  perform public.lock_chat_message_ancestors(new.reply_to_id,new.room_slug);
  perform 1 from public.longboard_chat_messages where id=new.reply_to_id and room_slug=new.room_slug and not removed for update;
  if not found then raise exception 'reply_not_found'; end if;
 end if;
 return new;
end $$;
create trigger guard_chat_reply_parent before insert on public.longboard_chat_messages for each row execute function public.guard_chat_reply_parent();
revoke all on function public.guard_chat_reply_parent() from public,anon,authenticated;
grant execute on function public.guard_chat_reply_parent() to service_role;

create or replace function public.enforce_longboard_chat_open()
returns trigger language plpgsql security invoker set search_path=public as $$
declare target_room text;
begin
 if tg_table_name='longboard_chat_messages' then
  if tg_op='UPDATE' then
   if new.deleted_at is not null and new.body='Message deleted' and cardinality(new.attachment_ids)=0
    and (to_jsonb(new)-array['deleted_at','removed','revision','body','attachment_ids','buddy_status','search_document'])=(to_jsonb(old)-array['deleted_at','removed','revision','body','attachment_ids','buddy_status','search_document']) then return new; end if;
   -- Generated search_document is recomputed after BEFORE triggers.
   if (to_jsonb(new)-array['buddy_status','search_document'])=(to_jsonb(old)-array['buddy_status','search_document']) then return new; end if;
   if new.room_slug<>old.room_slug then raise exception 'longboard_chat_room_immutable' using errcode='P0001'; end if;
  end if;
  target_room:=new.room_slug;
 else select room_slug into target_room from public.longboard_chat_messages where id=new.message_id;
 end if;
 if not exists(select 1 from public.longboard_chat_room_state where room_slug=target_room and is_open) then raise exception 'longboard_chat_paused' using errcode='P0001'; end if;
 return new;
end $$;

create or replace function public.bind_chat_attachments() returns trigger language plpgsql security invoker set search_path='' as $$
declare a public.chat_attachments; aid uuid;
begin
 if TG_OP='UPDATE' and new.attachment_ids=old.attachment_ids then return new; end if;
 if TG_OP='UPDATE' and new.deleted_at is not null and cardinality(new.attachment_ids)=0 then return new; end if;
 if TG_OP='UPDATE' and cardinality(old.attachment_ids)>0 then raise exception 'attachments_immutable'; end if;
 if cardinality(new.attachment_ids)>3 or array_position(new.attachment_ids,null) is not null or cardinality(new.attachment_ids)<>(select count(distinct x) from unnest(new.attachment_ids) x) then raise exception 'invalid_attachments'; end if;
 foreach aid in array new.attachment_ids loop
  select * into a from public.chat_attachments where id=aid for update;
  if not found or a.status<>'ready' or a.member_id is distinct from new.member_id then raise exception 'attachment_not_ready'; end if;
  if a.room_slug is distinct from new.room_slug then raise exception 'attachment_wrong_room'; end if;
  update public.chat_attachments set status='attached',room_message_id=new.id where id=aid;
 end loop;
 return new;
end $$;

create or replace function public.queue_longboard_chat_embedding() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.deleted_at is not null then
  delete from public.longboard_chat_embeddings where message_id=new.id;
 elsif new.room_slug in ('main','social') then
  insert into public.longboard_chat_embeddings(message_id,content_hash)
  values(new.id,md5(new.author_label || E'\n' || new.body))
  on conflict(message_id) do update set content_hash=excluded.content_hash,embedding=null,
   lease_id=null,available_at=now(),attempts=0,indexed_at=null,input_tokens=0;
 end if;
 return new;
end; $$;

-- Backwards-compatible optional revision; tombstone replacement requires an exact revision.
drop function public.change_chat_message(uuid,uuid,text,text,text,text,boolean);
create function public.change_chat_message(p_actor uuid,p_message uuid,p_room text,p_action text,p_body text default null,p_expected_body text default null,p_admin boolean default false,p_expected_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.longboard_chat_messages; ancestor public.longboard_chat_messages; own boolean; moderator boolean; parent_id uuid;
begin
 if p_action not in ('edit','delete') or p_action is null then raise exception 'invalid_action'; end if;
 if p_room in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings') and not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'message_forbidden'; end if;
 if not public.chat_account_has_room(p_actor,p_room) then raise exception 'room_forbidden'; end if;
 perform public.lock_chat_message_ancestors(p_message,p_room);
 select * into m from public.longboard_chat_messages where id=p_message and room_slug=p_room for update;
 if not found then raise exception 'message_not_found'; end if;
 own:=m.member_id is not null and exists(select 1 from public.longboard_chat_members where id=m.member_id and user_id=p_actor);
 moderator:=p_admin and exists(select 1 from public.profiles where id=p_actor and role='admin');
 if not own and not (p_action='delete' and moderator) then raise exception 'message_forbidden'; end if;
 -- Existing administrator moderation stays separate from members' own-message actions.
 if not own then
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
  if m.bot_slug is not null then raise exception 'message_forbidden'; end if;
  if not exists(select 1 from public.longboard_chat_room_state where room_slug=p_room and is_open) then raise exception 'chat_paused'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 600 then raise exception 'invalid_message'; end if;
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
end $$;
revoke all on function public.change_chat_message(uuid,uuid,text,text,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.change_chat_message(uuid,uuid,text,text,text,text,boolean,integer) to service_role;

create or replace function public.chat_thread_counts(p_room text, p_ids uuid[])
returns table(message_id uuid, reply_count bigint)
language sql stable security invoker set search_path=public
as $$
 select p.id, count(r.id)
 from public.longboard_chat_messages p
 left join public.longboard_chat_messages r on r.reply_to_id=p.id and r.room_slug=p_room and not r.removed
 where p.room_slug=p_room and p.id=any(p_ids)
 group by p.id;
$$;

create or replace function public.chat_room_unread(actor uuid, rooms text[])
returns jsonb language sql stable security invoker set search_path=public as $$
 with me as (select id from public.longboard_chat_members where user_id=actor), counts as (
 select room.room_slug,
 (select count(*) from public.longboard_chat_messages m
  where m.room_slug=room.room_slug and m.deleted_at is null and m.unread_seq>coalesce(r.through_seq,0)
  and m.member_id is distinct from (select id from me)) unread,
 (select m.unread_seq from public.longboard_chat_messages m
  where m.room_slug=room.room_slug order by m.unread_seq desc limit 1) through
 from (select distinct unnest(rooms) room_slug) room
 left join public.chat_room_reads r on r.account_id=actor and r.room_slug=room.room_slug
 ) select jsonb_build_object('roomMessageCounts',coalesce(jsonb_object_agg(room_slug,unread),'{}'::jsonb),
 'roomMessageThrough',coalesce(jsonb_object_agg(room_slug,coalesce(through,0)),'{}'::jsonb)) from counts;
$$;

create or replace function public.longboard_chat_inbox(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(item order by updated_at desc),'[]'::jsonb) from (
    select c.updated_at, jsonb_build_object(
      'id',c.id, 'status',c.status, 'incoming',c.recipient_id=me.id,
      'otherId',other.id, 'otherName',other.display_name,
      'blockedByMe',exists(select 1 from public.longboard_chat_blocks b where b.blocker_id=me.id and b.blocked_id=other.id),
      'unavailable',exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=other.id) or (b.blocker_id=other.id and b.blocked_id=me.id)),
      'lastBody',(select case when d.body='' and cardinality(d.attachment_ids)>0 then '[Attachment]' else d.body end from public.longboard_chat_direct_messages d where d.conversation_id=c.id and d.deleted_at is null order by d.seq desc limit 1),
      'updatedAt',c.updated_at,
      'latestIncomingSeq',case when c.status='declined' or exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=other.id) or (b.blocker_id=other.id and b.blocked_id=me.id)) then 0 else coalesce((select max(d.seq) from public.longboard_chat_direct_messages d where d.conversation_id=c.id and d.sender_id<>me.id and d.deleted_at is null),0) end,
      'unread',case when c.status='declined' then 0 else (select count(*) from public.longboard_chat_direct_messages d where d.conversation_id=c.id and d.sender_id<>me.id and d.deleted_at is null and d.seq>case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end) end
    ) as item
    from public.longboard_chat_members me
    join public.longboard_chat_conversations c on c.requester_id=me.id or c.recipient_id=me.id
    join public.longboard_chat_members other on other.id=case when c.requester_id=me.id then c.recipient_id else c.requester_id end
    where me.user_id=p_user_id
  ) conversations;
$$;

create or replace function public.check_chat_reaction_target(p_actor uuid,p_room text,p_conversation uuid,p_message uuid,p_write boolean default false)
returns uuid language plpgsql security invoker set search_path='' as $$
declare actor uuid; other uuid; c public.longboard_chat_conversations; m public.longboard_chat_direct_messages; author uuid;
begin
 select id into actor from public.longboard_chat_members where user_id=p_actor;
 if actor is null then raise exception 'member_required'; end if;
 if (p_room is null)=(p_conversation is null) then raise exception 'invalid_target'; end if;
 if p_room is not null then
  if not public.chat_account_has_room(p_actor,p_room) then raise exception 'room_forbidden'; end if;
  select member_id into author from public.longboard_chat_messages where id=p_message and room_slug=p_room and deleted_at is null;
  if not found then raise exception 'message_not_found'; end if;
  if p_write then
   -- Serialize with block changes, room pauses and message deletion.
   perform pg_advisory_xact_lock(hashtextextended('chat-dm-actor:'||actor::text,0));
   if author is not null then perform pg_advisory_xact_lock(hashtextextended('chat-dm-pair:'||least(actor,author)::text||':'||greatest(actor,author)::text,0)); end if;
   perform 1 from public.longboard_chat_room_state where room_slug=p_room and is_open for share;
   if not found then raise exception 'chat_paused'; end if;
   perform 1 from public.longboard_chat_messages where id=p_message and room_slug=p_room and deleted_at is null for update;
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

create function public.guard_deleted_chat_reaction() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 -- Lock before checking; a legacy write that waited for deletion must see the tombstone.
 perform 1 from public.longboard_chat_messages where id=new.message_id and deleted_at is null for update;
 if not found then raise exception 'message_not_found'; end if;
 return new;
end $$;
create trigger guard_deleted_chat_reaction before insert or update on public.longboard_chat_reactions for each row execute function public.guard_deleted_chat_reaction();
revoke all on function public.guard_deleted_chat_reaction() from public,anon,authenticated;
grant execute on function public.guard_deleted_chat_reaction() to service_role;

-- Search never returns deleted text, author-index matches, or tombstone-only hits.
create or replace function public.search_longboard_chat(p_query text,p_room text default 'main',p_before timestamptz default null,p_before_id uuid default null)
returns table(id uuid,room_slug text,author_label text,body text,created_at timestamptz)
language sql stable security invoker set search_path=public as $$
 select m.id,m.room_slug,m.author_label,m.body,m.created_at from public.longboard_chat_messages m
 where m.deleted_at is null and char_length(btrim(p_query)) between 2 and 200
 and m.room_slug in ('main','social') and (p_room='all' or m.room_slug=p_room)
 and m.search_document @@ websearch_to_tsquery('simple',p_query)
 and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
 order by m.created_at desc,m.id desc limit 21;
$$;

create or replace function public.search_longboard_chat_semantic(p_query text,p_embedding extensions.vector(1536),p_room text default 'main')
returns table(id uuid,room_slug text,author_label text,body text,created_at timestamptz)
language sql stable security invoker set search_path=public,extensions as $$
 with semantic as (
  select m.id,row_number() over(order by e.embedding <=> p_embedding,m.id) as rank
  from public.longboard_chat_embeddings e join public.longboard_chat_messages m on m.id=e.message_id
  where m.deleted_at is null and e.embedding is not null and e.model='text-embedding-3-small'
   and m.room_slug in ('main','social') and (p_room='all' or m.room_slug=p_room)
   and e.content_hash=md5(m.author_label || E'\n' || m.body)
   and e.embedding <=> p_embedding < 0.75
  order by e.embedding <=> p_embedding,m.id limit 40
 ), keywords as (
  select m.id,row_number() over(order by ts_rank_cd(m.search_document,websearch_to_tsquery('simple',p_query)) desc,m.created_at desc,m.id) as rank
  from public.longboard_chat_messages m
  where m.deleted_at is null and m.room_slug in ('main','social') and (p_room='all' or m.room_slug=p_room)
   and m.search_document @@ websearch_to_tsquery('simple',p_query)
  order by ts_rank_cd(m.search_document,websearch_to_tsquery('simple',p_query)) desc,m.created_at desc,m.id limit 40
 ), scores as (
  select coalesce(s.id,k.id) id,coalesce(1.0/(60+s.rank),0)+coalesce(1.0/(60+k.rank),0) score
  from semantic s full join keywords k on k.id=s.id
 ) select m.id,m.room_slug,m.author_label,m.body,m.created_at
 from scores s join public.longboard_chat_messages m on m.id=s.id
 where m.deleted_at is null and char_length(btrim(p_query)) between 2 and 200
 order by s.score desc,m.created_at desc,m.id limit 20;
$$;

create or replace function public.longboard_chat_search_context(p_message uuid)
returns table(id uuid, room_slug text, author_label text, body text, created_at timestamptz)
language sql stable security invoker set search_path = public as $$
  with target as (select * from public.longboard_chat_messages where id=p_message and not removed),
  earlier as (
    select m.id,m.room_slug,m.author_label,m.body,m.created_at from public.longboard_chat_messages m,target t
    where not m.removed and m.room_slug=t.room_slug and (m.created_at,m.id)<(t.created_at,t.id)
    order by m.created_at desc,m.id desc limit 5
  ), later as (
    select m.id,m.room_slug,m.author_label,m.body,m.created_at from public.longboard_chat_messages m,target t
    where not m.removed and m.room_slug=t.room_slug and (m.created_at,m.id)>(t.created_at,t.id)
    order by m.created_at,m.id limit 5
  )
  select * from (
    select * from earlier union all
    select id,room_slug,author_label,body,created_at from target union all
    select * from later
  ) context order by created_at,id;
$$;


-- Buddy workers follow the same root/source/job order as edits and deletion.
create or replace function public.guard_chat_buddy_source(source uuid,expected_body text,expected_edited timestamptz) returns text
language plpgsql security invoker set search_path='' as $$
declare m public.longboard_chat_messages; account uuid; lb uuid; opened boolean;
begin
 perform public.lock_chat_message_ancestors(source,'main');
 select * into m from public.longboard_chat_messages where id=source for update;
 if not found then return 'cancelled'; end if;
 if m.room_slug<>'main' or m.member_id is null or m.bot_slug is not null or m.body is distinct from expected_body or m.edited_at is distinct from expected_edited then return 'cancelled'; end if;
 select user_id into account from public.longboard_chat_members where id=m.member_id for share;
 select longboard_user_id into lb from public.chat_accounts where id=account for share;
 perform 1 from public.profiles where id=lb for share;
 perform 1 from public.user_tags where user_id=lb for share;
 if public.chat_account_has_room(account,'main') is distinct from true then return 'cancelled'; end if;
 select is_open into opened from public.longboard_chat_room_state where room_slug='main' for share;
 if opened is distinct from true then return 'paused'; end if;
 return 'ok';
end $$;

-- Buddy workers follow the same root/source/job order as edits and deletion.
create or replace function public.claim_chat_buddy_job(worker uuid,source uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
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
end $$;

-- Buddy workers follow the same root/source/job order as edits and deletion.
create or replace function public.finish_chat_buddy_job(source uuid,worker uuid,answer text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
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
end $$;
