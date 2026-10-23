-- #302 Software Update List for Users - Read-Only: a "What's New" room listing Longboard changes.
--
--  * Room slug 'whats-new' (room_state id 9). Everyone who can use chat is in it with no joining
--    step: access is by tier, exactly like Social/Gainers (chat_account_has_room and
--    chat_account_room_recipient_eligible), so new accounts are in it from their first visit.
--  * Admin posts only, like the announcement rooms (enforce_chat_announcement_writer and
--    change_chat_message). Members can react. No replies (whats_new_roots_only).
--  * No alerts: record_chat_room_mentions skips the room, notify_chat_announcement is unchanged
--    (it never lists 'whats-new'), and chat_room_mentions does not accept the slug, so nothing can
--    reach the bell or push. New posts still count as unread through chat_room_unread.
--  * Automatic notes come from bot 'whats-new' labelled "Booker Chat Updates". A note row must be
--    reserved in chat_whats_new_notes in the same transaction (enforce_chat_whats_new_note), and
--    chat_whats_new_changes records every announced PR so reruns never post twice
--    (post_chat_whats_new_note, called by /api/chat/whats-new with a server secret).
--  * Admins can edit the automatic notes and delete any note (change_chat_message).
--  * The welcome post is inserted below as the room's first message.
--
-- Production when written (2026-10-23): no 'whats-new' rows anywhere; 8 rooms in room_state.
-- Rollback: supabase/rollbacks/20261023200000_chat_whats_new_room.down.sql

alter table public.longboard_chat_room_state drop constraint longboard_chat_room_slug_check;
alter table public.longboard_chat_room_state add constraint longboard_chat_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new'));
alter table public.chat_room_reads drop constraint chat_room_reads_room_slug_check;
alter table public.chat_room_reads add constraint chat_room_reads_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new'));
alter table public.chat_favorites drop constraint chat_favorites_room_slug_check;
alter table public.chat_favorites add constraint chat_favorites_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new'));
alter table public.chat_conversation_pins drop constraint chat_conversation_pins_room_slug_check;
alter table public.chat_conversation_pins add constraint chat_conversation_pins_room_slug_check check(room_slug is null or room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new'));
alter table public.chat_room_notification_levels drop constraint chat_room_notification_levels_room_slug_check;
alter table public.chat_room_notification_levels add constraint chat_room_notification_levels_room_slug_check check(room_slug in ('main','social','shortscout','gainers','lb-announcements','ss-announcements','lb-recordings','ss-recordings','whats-new'));
alter table public.chat_login_requests drop constraint chat_login_requests_return_room_check;
alter table public.chat_login_requests add constraint chat_login_requests_return_room_check check(return_room in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new'));
alter table public.chat_attachments drop constraint chat_attachments_room_slug_check;
alter table public.chat_attachments add constraint chat_attachments_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','lb-recordings','ss-recordings','whats-new'));
-- chat_room_mentions_room_slug_check deliberately stays without 'whats-new' (no alerts).

alter table public.longboard_chat_messages drop constraint longboard_chat_messages_actor_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_actor_check check (
 (guest_id is not null and bot_slug is null) or (guest_id is null and bot_slug='buddy') or
 (room_slug='gainers' and guest_id is null and member_id is null and bot_slug='gainers') or
 (room_slug='whats-new' and guest_id is null and member_id is null and bot_slug='whats-new')
);
alter table public.longboard_chat_messages add constraint whats_new_roots_only check(room_slug<>'whats-new' or reply_to_id is null);

insert into public.longboard_chat_room_state(id,room_slug) values(9,'whats-new');

-- Which notes came from automation (or the welcome), and which merged PRs they announced.
create table public.chat_whats_new_notes(
 message_id uuid primary key,
 kind text not null check(kind in ('welcome','auto')),
 deployment_sha text check(deployment_sha is null or deployment_sha ~ '^[0-9a-f]{40}$'),
 created_at timestamptz not null default now()
);
create table public.chat_whats_new_changes(
 pr_number integer primary key check(pr_number between 1 and 1000000000),
 message_id uuid not null references public.chat_whats_new_notes(message_id),
 note text not null check(char_length(note) between 1 and 600),
 merged_at timestamptz,
 announced_at timestamptz not null default now()
);
create index chat_whats_new_changes_message on public.chat_whats_new_changes(message_id);
alter table public.chat_whats_new_notes enable row level security;
alter table public.chat_whats_new_changes enable row level security;
revoke all on public.chat_whats_new_notes,public.chat_whats_new_changes from public,anon,authenticated,service_role;
grant select,insert on public.chat_whats_new_notes,public.chat_whats_new_changes to service_role;

-- A Booker Chat Updates row must have its note reserved in the same transaction; no replies.
create function public.enforce_chat_whats_new_note() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.room_slug<>'whats-new' then raise exception 'whats_new_note_forbidden'; end if;
 if new.reply_to_id is not null then raise exception 'whats_new_no_replies'; end if;
 if tg_op='INSERT' and new.bot_slug is not null and (new.bot_slug<>'whats-new' or new.author_label<>'Booker Chat Updates'
  or new.member_id is not null or new.guest_id is not null or cardinality(new.attachment_ids)>0
  or not exists(select 1 from public.chat_whats_new_notes n where n.message_id=new.id))
 then raise exception 'whats_new_note_forbidden'; end if;
 if tg_op='UPDATE' and (new.room_slug<>old.room_slug or new.bot_slug is distinct from old.bot_slug
  or (old.bot_slug='whats-new' and new.author_label<>old.author_label))
 then raise exception 'whats_new_note_forbidden'; end if;
 return new;
end $$;
revoke all on function public.enforce_chat_whats_new_note() from public,anon,authenticated;
grant execute on function public.enforce_chat_whats_new_note() to service_role;
create trigger chat_whats_new_note_guard before insert or update on public.longboard_chat_messages
 for each row when (new.room_slug='whats-new' or new.bot_slug='whats-new') execute function public.enforce_chat_whats_new_note();

-- One automatic note for one or more merged PRs. Fails (and posts nothing) if any of them was
-- already announced, so the caller re-reads and retries with only the new ones.
create function public.post_chat_whats_new_note(p_deployment text,p_body text,p_changes jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare note_id uuid:=gen_random_uuid();
begin
 if p_deployment is null or p_deployment !~ '^[0-9a-f]{40}$' or p_body is null or char_length(btrim(p_body)) not between 1 and 600
  or p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes) not between 1 and 50
  or exists(select 1 from jsonb_array_elements(p_changes) e where jsonb_typeof(e->'pr')<>'number' or jsonb_typeof(e->'note')<>'string')
 then raise exception 'invalid_whats_new'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-whats-new',0));
 if exists(select 1 from public.chat_whats_new_changes c join jsonb_array_elements(p_changes) e on c.pr_number=(e->>'pr')::integer)
 then raise exception 'whats_new_already_posted'; end if;
 insert into public.chat_whats_new_notes(message_id,kind,deployment_sha) values(note_id,'auto',p_deployment);
 insert into public.chat_whats_new_changes(pr_number,message_id,note,merged_at)
  select (e->>'pr')::integer,note_id,e->>'note',nullif(e->>'mergedAt','')::timestamptz from jsonb_array_elements(p_changes) e;
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
  values(note_id,'whats-new','Booker Chat Updates',btrim(p_body),'whats-new');
 return jsonb_build_object('messageId',note_id,'posted',true);
end $$;
revoke all on function public.post_chat_whats_new_note(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.post_chat_whats_new_note(text,text,jsonb) to service_role;

alter policy "members read chat messages" on public.longboard_chat_messages
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (
 (p.role='admin' and room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new')) or
 room_slug in ('social','gainers','whats-new') or
 (room_slug='main' and exists(select 1 from public.user_tags t where t.user_id=p.id and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')))
)));

-- Preserve current definition from production (repo main), adding What's New.

CREATE OR REPLACE FUNCTION public.chat_account_has_room(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with tier as (select public.chat_shortscout_identity(p_account)->>'membership_level' value) select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new') or p_room is null then false
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new') then exists(select 1 from public.profiles where id=p_account)
  or exists(select 1 from tier where value in ('monthly','annual','lifetime','mastermind'))
 when p_room in ('shortscout','ss-announcements','ss-recordings') then exists(select 1 from tier where value='mastermind')
 else false end;
$function$;

-- Preserve current definition from production (repo main), adding What's New.

CREATE OR REPLACE FUNCTION public.chat_account_room_recipient_eligible(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new') or p_room is null then false
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new') then exists(select 1 from public.profiles where id=p_account)
  or coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','') in ('monthly','annual','lifetime','mastermind')
 when p_room in ('shortscout','ss-announcements','ss-recordings') then coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$function$;

-- Preserve current definition from production (repo main), adding What's New.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_members(p_user_id uuid, p_room text, p_cursor uuid DEFAULT NULL::uuid, p_query text DEFAULT ''::text)
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new') then raise exception 'invalid_room'; end if;
 if p_query is null or char_length(p_query)>28 then raise exception 'invalid_query'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 return query
 select m.id,m.display_name from public.longboard_chat_members m
 where (p_cursor is null or m.id>p_cursor)
   and strpos(lower(m.display_name),lower(btrim(p_query)))>0
   and public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
 -- UUID keysets remain stable across name edits; the UI sorts the loaded names.
 order by m.id limit 51;
end $function$;

-- Preserve current definition from production (repo main), adding What's New.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_count(p_user_id uuid, p_room text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid; total bigint;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new') then raise exception 'invalid_room'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 select count(*) into total from public.longboard_chat_members m
 where public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor));
 return total;
end $function$;

-- Preserve current definition from production (repo main), adding What's New.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_members_ordered(p_user_id uuid, p_room text, p_query text DEFAULT ''::text, p_online_ids uuid[] DEFAULT '{}'::uuid[], p_after_rank integer DEFAULT NULL::integer, p_after_name text DEFAULT NULL::text, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, display_name text, sort_rank integer, sort_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new') then raise exception 'invalid_room'; end if;
 if p_query is null or char_length(p_query)>28 or p_online_ids is null or cardinality(p_online_ids)>5000 then raise exception 'invalid_query'; end if;
 if ((p_after_rank is null and p_after_name is null and p_after_id is null) or
   (p_after_rank in (0,1) and p_after_name is not null and p_after_id is not null)) is not true then raise exception 'invalid_cursor'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 return query
 select m.id,m.display_name,case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name)
 from public.longboard_chat_members m
 where strpos(lower(m.display_name),lower(btrim(p_query)))>0
   and public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
   and (p_after_id is null or
     (case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name) collate "C",m.id) >
     (p_after_rank,p_after_name collate "C",p_after_id))
 order by case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name) collate "C",m.id
 limit 51;
end $function$;

-- Preserve current definition from production (repo main), adding What's New.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_names(p_user_id uuid, p_room text, p_ids uuid[])
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new') then raise exception 'invalid_room'; end if;
 if p_ids is null or cardinality(p_ids) > 50 then raise exception 'invalid_query'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 return query
 select m.id, m.display_name from public.longboard_chat_members m
 where m.id = any(p_ids)
   and public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
 order by m.id;
end $function$;

-- Preserve current definition from production (repo main), adding What's New.

CREATE OR REPLACE FUNCTION public.record_chat_room_mentions()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare at_pos integer; scan_from integer:=1; relative_pos integer; person record; recipients uuid[]:='{}'; recipient uuid;
begin
 -- #302: What's New never alerts anyone, not even for an @name in an admin note.
 if new.room_slug in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings','whats-new') then return new; end if;
 if new.member_id is not null then
  loop
   relative_pos:=strpos(substr(new.body,scan_from),'@');exit when relative_pos=0;
   at_pos:=scan_from+relative_pos-1;scan_from:=at_pos+1;
   if at_pos>1 and substr(new.body,at_pos-1,1) ~ '[[:alnum:]_@]' then continue; end if;
   select m.id,m.user_id into person from longboard_chat_members m
   where lower(substr(new.body,at_pos+1,length(m.display_name)))=lower(m.display_name)
   and substr(new.body,at_pos+1+length(m.display_name),1) !~ '[[:alnum:]_]'
   order by length(m.display_name) desc,m.id limit 1;
   if person.id is not null and person.id<>new.member_id and public.chat_account_room_recipient_eligible(person.user_id,new.room_slug) and not exists(select 1 from longboard_chat_blocks b where (b.blocker_id=person.id and b.blocked_id=new.member_id) or (b.blocked_id=person.id and b.blocker_id=new.member_id)) then recipients:=array_append(recipients,person.user_id); end if;
  end loop;
 end if;
 delete from chat_room_mentions where message_id=new.id and category='mention' and not(account_id=any(recipients));
 foreach recipient in array recipients loop
  insert into chat_room_mentions(account_id,message_id,room_slug) values(recipient,new.id,new.room_slug) on conflict(account_id,message_id) do nothing;
 end loop;
 return new;
end $function$;

-- Preserve current definition from production (repo main), adding What's New.

CREATE OR REPLACE FUNCTION public.enforce_chat_announcement_writer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare target_room text; target_member uuid;
begin
 if tg_table_name='longboard_chat_reactions' then
  select room_slug into target_room from public.longboard_chat_messages where id=new.message_id;
  target_member:=new.guest_id;
 else target_room:=new.room_slug; target_member:=new.member_id;
  -- #302: automatic What's New notes (checked against their ledger by enforce_chat_whats_new_note).
  if new.room_slug='whats-new' and new.bot_slug='whats-new' and new.member_id is null then return new; end if;
 end if;
 if target_room in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings','whats-new') and not exists (
  select 1 from public.longboard_chat_members m join public.profiles p on p.id=m.user_id
  where m.id=target_member and p.role='admin'
 ) then raise exception 'announcement_admin_only'; end if;
 return new;
end $function$;

-- Preserve current definition from production (repo main), adding What's New.

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
end $function$;

-- The welcome post: the room's first message.
insert into public.chat_whats_new_notes(message_id,kind) values('30200000-0000-4000-8000-000000000302','welcome');
insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug) values(
 '30200000-0000-4000-8000-000000000302','whats-new','Booker Chat Updates',
 'Welcome to What''s New. When a change to Longboard goes live, a short plain-English note about it shows up here on its own, so you can see what''s new without asking. Notes cover things you''ll notice: new features, changes to how something works, and fixes you might have run into. Behind-the-scenes work (speed tweaks, tests, internal tools) is left out, and small changes that go live together share one note. Admins can also post, edit or remove notes by hand. You can react to any note; replies are off.',
 'whats-new');
