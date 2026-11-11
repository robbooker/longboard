-- Rollback for 20261111143000_chat_whats_new_pictures.sql (#443): What's New notes go back to text
-- only. The picture follow-up messages are deleted, the notes keep their text and lose their
-- pictures, the picture rows go (their stored files are queued for deletion as usual), and the
-- functions and checks are put back exactly as 20261110200000_chat_longboard_bot.sql and
-- 20261023200000_chat_whats_new_room.sql defined them.
drop function if exists public.post_chat_whats_new_pictures(integer,jsonb);
drop function if exists public.post_chat_whats_new_note(text,text,jsonb,uuid[],jsonb);
drop function if exists public.insert_chat_whats_new_picture_messages(text,jsonb);
drop function if exists public.check_chat_whats_new_pictures(integer[],uuid[],jsonb);

delete from public.longboard_chat_messages where id in (select message_id from public.chat_whats_new_notes where kind='pictures');
delete from public.chat_whats_new_notes where kind='pictures';
-- Run the deferred checks the deletes queued now, so the tables can be altered in the same transaction.
set constraints all immediate;
-- Files on a message can't be changed once bound (bind_chat_attachments); lift that for this one update.
alter table public.longboard_chat_messages disable trigger bind_room_attachments;
update public.longboard_chat_messages m set attachment_ids='{}'
 where room_slug='whats-new' and cardinality(attachment_ids)>0
  and exists(select 1 from public.chat_attachments a where a.id=any(m.attachment_ids) and a.whats_new_pr is not null);
alter table public.longboard_chat_messages enable trigger bind_room_attachments;
delete from public.chat_attachments where whats_new_pr is not null;
set constraints all immediate;

alter table public.chat_whats_new_notes drop constraint chat_whats_new_notes_kind_check;
alter table public.chat_whats_new_notes add constraint chat_whats_new_notes_kind_check check(kind in ('welcome','auto'));
alter table public.chat_whats_new_changes drop column pictures_posted_at;
drop index if exists public.chat_attachments_whats_new_pr;
alter table public.chat_attachments drop constraint chat_attachments_whats_new_picture;
alter table public.chat_attachments drop column whats_new_pr;
alter table public.chat_attachments alter column member_id set not null;

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

-- 20261110200000_chat_longboard_bot.sql's definition.
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
 end if;
 if target_room in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings','whats-new') and not exists (
  select 1 from public.longboard_chat_members m join public.profiles p on p.id=m.user_id
  where m.id=target_member and p.role='admin'
 ) then raise exception 'announcement_admin_only'; end if;
 return new;
end $function$;

-- 20261110200000_chat_longboard_bot.sql's definition.
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
  or new.member_id is not null or new.guest_id is not null or cardinality(new.attachment_ids)>0
  or not exists(select 1 from public.chat_whats_new_notes n where n.message_id=new.id))
 then raise exception 'whats_new_note_forbidden'; end if;
 if tg_op='UPDATE' and (new.room_slug<>old.room_slug or new.bot_slug is distinct from old.bot_slug
  or (old.bot_slug='whats-new' and new.author_label<>old.author_label))
 then raise exception 'whats_new_note_forbidden'; end if;
 return new;
end $function$;
