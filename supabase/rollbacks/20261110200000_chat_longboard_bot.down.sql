-- Rollback for 20261110200000_chat_longboard_bot.sql (#413): removes the posting function and puts back
-- the actor check (production definition read on 2026-11-09) and the three room guards exactly as
-- 20261023200000_chat_whats_new_room.sql and 20261109120000_chat_stock_club.sql defined them.
-- Longboard Bot rows must go first, or the old actor check can't be added: they are announcements,
-- so deleting them only removes those posts.
drop function if exists public.post_chat_longboard_announcement(uuid,text,text);
delete from public.longboard_chat_messages where bot_slug='longboard';
-- Run the deferred checks the delete queued now, so the table can be altered in the same transaction.
set constraints all immediate;

alter table public.longboard_chat_messages drop constraint longboard_chat_messages_actor_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_actor_check CHECK ((((guest_id IS NOT NULL) AND (bot_slug IS NULL)) OR ((guest_id IS NULL) AND (bot_slug = 'buddy'::text)) OR ((room_slug = 'gainers'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'gainers'::text)) OR ((room_slug = 'whats-new'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'whats-new'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = ANY (ARRAY['faq-suggestions'::text, 'chat-improvements'::text]))) OR ((room_slug = 'club'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'club'::text)) OR ((room_slug = ANY (ARRAY['runner-watch'::text, 'main'::text, 'shortscout'::text])) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch-notices'::text))));

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
  end if;
 end if;
 if target_room in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings','whats-new') and not exists (
  select 1 from public.longboard_chat_members m join public.profiles p on p.id=m.user_id
  where m.id=target_member and p.role='admin'
 ) then raise exception 'announcement_admin_only'; end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_chat_whats_new_note()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_chat_club_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if tg_op='UPDATE' and old.room_slug='club' then raise exception 'club_read_only'; end if;
 if new.room_slug='club' then
  if tg_op<>'INSERT' or new.member_id is not null or new.guest_id is not null or new.bot_slug is distinct from 'club'
   or new.author_label<>'Booker Stock Club' or new.reply_to_id is not null or cardinality(new.attachment_ids)>0
   or not exists(select 1 from public.chat_club_picks p where p.message_id=new.id)
  then raise exception 'club_read_only'; end if;
 end if;
 if new.reply_to_id is not null and exists(select 1 from public.longboard_chat_messages where id=new.reply_to_id and room_slug='club') then raise exception 'club_read_only'; end if;
 return new;
end $function$;
