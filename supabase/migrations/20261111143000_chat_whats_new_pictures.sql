-- #443 What's New notes show pictures of the new feature.
--
--  * A PR can commit up to 4 "after" pictures under docs/whats-new/<pr>/ (see CLAUDE.md). When it
--    goes live, scripts/whats-new/post-whats-new.mjs uploads each one to
--    POST /api/chat/whats-new/pictures (WHATS_NEW_TOKEN). The route rebuilds the image from its
--    pixels, stores it in the chat-attachments bucket like any chat image, and records it here as a
--    'ready' chat_attachments row with no member and whats_new_pr set: a picture of Booker Chat
--    Updates, in What's New only, PNG or JPEG only.
--  * post_chat_whats_new_note takes two more arguments, both optional: p_note_files (at most 3,
--    the per-message limit, bound to the note) and p_follow_ups ([{body,files}], messages posted
--    right after the note in the same transaction for pictures past the first 3). Called with the
--    three old arguments it behaves exactly as before, so the running app keeps working.
--  * post_chat_whats_new_pictures posts pictures for a PR that was already announced (its note
--    went out before this existed, or its upload failed), once: chat_whats_new_changes gains
--    pictures_posted_at, and a second call for the same PR is refused.
--  * Follow-up picture messages are ledger rows of kind 'pictures' in chat_whats_new_notes, so the
--    What's New guard accepts them like notes. The guard now lets a Booker Chat Updates row carry
--    files, but only these pictures; bind_chat_attachments (unchanged) binds a file only to a
--    message with the same member, and only these rows have none, so no member can attach them.
--  * enforce_chat_announcement_writer and enforce_chat_whats_new_note are the current definitions
--    (20261110200000_chat_longboard_bot.sql) with only the picture lines added.
--
-- Additive: the running app keeps working once this is applied. Apply it before the app ships
-- (until then the picture upload answers "unavailable" and notes post as text only).
-- Rollback: supabase/rollbacks/20261111143000_chat_whats_new_pictures.down.sql

alter table public.chat_attachments alter column member_id drop not null;
alter table public.chat_attachments add column whats_new_pr integer;
alter table public.chat_attachments add constraint chat_attachments_whats_new_picture check(
 (member_id is not null and whats_new_pr is null) or
 (member_id is null and whats_new_pr between 1 and 1000000000 and room_slug='whats-new' and conversation_id is null
  and mime_type in ('image/png','image/jpeg'))
);
create index chat_attachments_whats_new_pr on public.chat_attachments(whats_new_pr) where whats_new_pr is not null;

alter table public.chat_whats_new_changes add column pictures_posted_at timestamptz;
-- post_chat_whats_new_pictures marks the PR (the table is otherwise select/insert only).
grant update(pictures_posted_at) on public.chat_whats_new_changes to service_role;
alter table public.chat_whats_new_notes drop constraint chat_whats_new_notes_kind_check;
alter table public.chat_whats_new_notes add constraint chat_whats_new_notes_kind_check check(kind in ('welcome','auto','pictures'));

-- 20261110200000_chat_longboard_bot.sql's definition with the What's New picture line added.
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
  -- Also the trigger on chat_attachments, whose rows have no bot_slug: check the table first.
  if tg_table_name='longboard_chat_messages' then
   if new.room_slug='whats-new' and new.bot_slug='whats-new' and new.member_id is null then return new; end if;
   -- #413: Longboard Bot announcements (only the service role writes bot rows).
   if new.bot_slug='longboard' and new.member_id is null and new.guest_id is null then return new; end if;
  end if;
  -- #443: pictures for the automatic notes (only the service role writes chat_attachments).
  if tg_table_name='chat_attachments' then
   if new.room_slug='whats-new' and new.member_id is null and new.whats_new_pr is not null then return new; end if;
  end if;
 end if;
 if target_room in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings','whats-new') and not exists (
  select 1 from public.longboard_chat_members m join public.profiles p on p.id=m.user_id
  where m.id=target_member and p.role='admin'
 ) then raise exception 'announcement_admin_only'; end if;
 return new;
end $function$;

-- 20261110200000_chat_longboard_bot.sql's definition; a ledger note may now carry What's New
-- pictures (and nothing else) instead of no files at all.
CREATE OR REPLACE FUNCTION public.enforce_chat_whats_new_note()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if new.room_slug<>'whats-new' then raise exception 'whats_new_note_forbidden'; end if;
 if new.reply_to_id is not null then raise exception 'whats_new_no_replies'; end if;
 if tg_op='INSERT' and new.bot_slug is not null and not (new.bot_slug='longboard' and new.author_label='Longboard Bot'
  and new.member_id is null and new.guest_id is null and cardinality(new.attachment_ids)=0)
  and (new.bot_slug<>'whats-new' or new.author_label<>'Booker Chat Updates'
  or new.member_id is not null or new.guest_id is not null
  or exists(select 1 from unnest(new.attachment_ids) x where not exists(
   select 1 from public.chat_attachments a where a.id=x and a.whats_new_pr is not null and a.member_id is null))
  or not exists(select 1 from public.chat_whats_new_notes n where n.message_id=new.id))
 then raise exception 'whats_new_note_forbidden'; end if;
 if tg_op='UPDATE' and (new.room_slug<>old.room_slug or new.bot_slug is distinct from old.bot_slug
  or (old.bot_slug='whats-new' and new.author_label<>old.author_label))
 then raise exception 'whats_new_note_forbidden'; end if;
 return new;
end $function$;

-- Checks a list of picture messages ([{body,files}]) and the files they and the note carry:
-- each file an uploaded, not yet posted picture of one of p_prs, no file twice, at most 4 per PR.
create function public.check_chat_whats_new_pictures(p_prs integer[],p_note_files uuid[],p_follow_ups jsonb) returns uuid[]
language plpgsql stable security invoker set search_path='' as $$
declare files uuid[];
begin
 if p_note_files is null or cardinality(p_note_files)>3 or array_position(p_note_files,null) is not null
  or p_follow_ups is null or jsonb_typeof(p_follow_ups)<>'array' or jsonb_array_length(p_follow_ups)>20
  or exists(select 1 from jsonb_array_elements(p_follow_ups) f where jsonb_typeof(f)<>'object'
   or jsonb_typeof(f->'body')<>'string' or char_length(btrim(f->>'body')) not between 1 and 600
   or jsonb_typeof(f->'files')<>'array' or jsonb_array_length(f->'files') not between 1 and 3
   or exists(select 1 from jsonb_array_elements(f->'files') x where jsonb_typeof(x)<>'string'
    or (x#>>'{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
 then raise exception 'invalid_whats_new'; end if;
 files:=p_note_files||array(select x::uuid from jsonb_array_elements(p_follow_ups) f,jsonb_array_elements_text(f->'files') x);
 if cardinality(files)<>(select count(distinct x) from unnest(files) x)
  or exists(select 1 from unnest(files) x where not exists(select 1 from public.chat_attachments a
   where a.id=x and a.member_id is null and a.whats_new_pr=any(p_prs) and a.status='ready'))
  or exists(select 1 from public.chat_attachments a where a.id=any(files) group by a.whats_new_pr having count(*)>4)
 then raise exception 'invalid_whats_new_pictures'; end if;
 return files;
end $$;
revoke all on function public.check_chat_whats_new_pictures(integer[],uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.check_chat_whats_new_pictures(integer[],uuid[],jsonb) to service_role;

-- Posts the picture messages after a note, in order, each a 'pictures' ledger row.
create function public.insert_chat_whats_new_picture_messages(p_deployment text,p_follow_ups jsonb) returns uuid[]
language plpgsql security invoker set search_path='' as $$
declare follow jsonb; follow_id uuid; ids uuid[]:='{}';
begin
 for follow in select f.value from jsonb_array_elements(p_follow_ups) with ordinality f(value,i) order by f.i loop
  follow_id:=gen_random_uuid();
  insert into public.chat_whats_new_notes(message_id,kind,deployment_sha) values(follow_id,'pictures',p_deployment);
  -- clock_timestamp: after the note (now()) and after the follow-up before it.
  insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug,attachment_ids,created_at)
   values(follow_id,'whats-new','Booker Chat Updates',btrim(follow->>'body'),'whats-new',
    array(select x::uuid from jsonb_array_elements_text(follow->'files') with ordinality t(x,i) order by t.i),clock_timestamp());
  ids:=ids||follow_id;
 end loop;
 return ids;
end $$;
revoke all on function public.insert_chat_whats_new_picture_messages(text,jsonb) from public,anon,authenticated;
grant execute on function public.insert_chat_whats_new_picture_messages(text,jsonb) to service_role;

-- 20261023200000_chat_whats_new_room.sql's note, plus pictures: p_note_files on the note itself,
-- p_follow_ups as messages right after it. With the old three arguments, exactly as before.
drop function public.post_chat_whats_new_note(text,text,jsonb);
create function public.post_chat_whats_new_note(p_deployment text,p_body text,p_changes jsonb,
 p_note_files uuid[] default '{}',p_follow_ups jsonb default '[]') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare note_id uuid:=gen_random_uuid(); files uuid[]; follow_ids uuid[];
begin
 if p_deployment is null or p_deployment !~ '^[0-9a-f]{40}$' or p_body is null or char_length(btrim(p_body)) not between 1 and 600
  or p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes) not between 1 and 50
  or exists(select 1 from jsonb_array_elements(p_changes) e where jsonb_typeof(e->'pr')<>'number' or jsonb_typeof(e->'note')<>'string')
 then raise exception 'invalid_whats_new'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-whats-new',0));
 files:=public.check_chat_whats_new_pictures(array(select (e->>'pr')::integer from jsonb_array_elements(p_changes) e),p_note_files,p_follow_ups);
 if exists(select 1 from public.chat_whats_new_changes c join jsonb_array_elements(p_changes) e on c.pr_number=(e->>'pr')::integer)
 then raise exception 'whats_new_already_posted'; end if;
 insert into public.chat_whats_new_notes(message_id,kind,deployment_sha) values(note_id,'auto',p_deployment);
 insert into public.chat_whats_new_changes(pr_number,message_id,note,merged_at,pictures_posted_at)
  select (e->>'pr')::integer,note_id,e->>'note',nullif(e->>'mergedAt','')::timestamptz,
   case when exists(select 1 from public.chat_attachments a where a.id=any(files) and a.whats_new_pr=(e->>'pr')::integer) then now() end
  from jsonb_array_elements(p_changes) e;
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug,attachment_ids)
  values(note_id,'whats-new','Booker Chat Updates',btrim(p_body),'whats-new',p_note_files);
 follow_ids:=public.insert_chat_whats_new_picture_messages(p_deployment,p_follow_ups);
 return jsonb_build_object('messageId',note_id,'posted',true,'followUpIds',to_jsonb(follow_ids));
end $$;
revoke all on function public.post_chat_whats_new_note(text,text,jsonb,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.post_chat_whats_new_note(text,text,jsonb,uuid[],jsonb) to service_role;

-- Pictures for a PR whose note is already in the room: once per PR.
create function public.post_chat_whats_new_pictures(p_pr integer,p_follow_ups jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.chat_whats_new_changes; sha text; ids uuid[];
begin
 if p_pr is null or p_follow_ups is null or jsonb_typeof(p_follow_ups)<>'array' or jsonb_array_length(p_follow_ups) not between 1 and 2
 then raise exception 'invalid_whats_new'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-whats-new',0));
 select * into c from public.chat_whats_new_changes where pr_number=p_pr for update;
 if not found then raise exception 'whats_new_not_announced'; end if;
 if c.pictures_posted_at is not null then raise exception 'whats_new_pictures_already_posted'; end if;
 perform public.check_chat_whats_new_pictures(array[p_pr],'{}',p_follow_ups);
 select deployment_sha into sha from public.chat_whats_new_notes where message_id=c.message_id;
 ids:=public.insert_chat_whats_new_picture_messages(sha,p_follow_ups);
 update public.chat_whats_new_changes set pictures_posted_at=now() where pr_number=p_pr;
 return jsonb_build_object('posted',true,'messageIds',to_jsonb(ids));
end $$;
revoke all on function public.post_chat_whats_new_pictures(integer,jsonb) from public,anon,authenticated;
grant execute on function public.post_chat_whats_new_pictures(integer,jsonb) to service_role;
