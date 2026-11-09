-- #413 Longboard Bot: one bot, "Longboard Bot" (bot_slug 'longboard'), that admins and the ops
-- session use to post announcements into the chat rooms.
--
--  * Posts carry bot_slug 'longboard' with no member and no guest, like the other bots: no login, no
--    member row, no API token. It can't tag anyone (record_chat_room_mentions only reads members'
--    posts) or wake Buddy (prepare_chat_buddy_status needs a member).
--  * post_chat_longboard_announcement below is the only way the app posts one: service role only,
--    called by POST /api/chat/admin/announce (chat admins) and scripts/announce.ts (the ops session).
--    The caller picks the message id (one per announcement and room, derived from the request's
--    clientId), so a retry finds the row already there and posts nothing.
--  * Rooms: the actor check allows 'longboard' in every room. Three rooms' own guards also need a line:
--    the announcement and recording rooms and What's New (enforce_chat_announcement_writer: admins
--    only), What's New (enforce_chat_whats_new_note: only ledger notes) and Booker Stock Club
--    (enforce_chat_club_post: only picks). Gainers stays refused by its own guard
--    (enforce_chat_gainers_source, unchanged): every post there is read as a stock alert by the
--    nightly gainers page and chat_gainers_table, so the app leaves it out of "all".
--  * Each changed function is the current definition (the latest migration that defines it:
--    20261023200000_chat_whats_new_room.sql for the announcement writer and the What's New guard,
--    20261109120000_chat_stock_club.sql for the club guard) with only the Longboard Bot line added.
--    The actor check is the production definition read on 2026-11-09 with one clause added.
--
-- Additive: the running app keeps working once this is applied. Apply it before the app ships (until
-- then the route and the script answer "unavailable" and post nothing).
-- Rollback: supabase/rollbacks/20261110200000_chat_longboard_bot.down.sql

alter table public.longboard_chat_messages drop constraint longboard_chat_messages_actor_check;
-- Production definition (2026-11-09) with one clause added at the end: Longboard Bot, any room.
alter table public.longboard_chat_messages add constraint longboard_chat_messages_actor_check CHECK ((((guest_id IS NOT NULL) AND (bot_slug IS NULL)) OR ((guest_id IS NULL) AND (bot_slug = 'buddy'::text)) OR ((room_slug = 'gainers'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'gainers'::text)) OR ((room_slug = 'whats-new'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'whats-new'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = ANY (ARRAY['faq-suggestions'::text, 'chat-improvements'::text]))) OR ((room_slug = 'club'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'club'::text)) OR ((room_slug = ANY (ARRAY['runner-watch'::text, 'main'::text, 'shortscout'::text])) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch-notices'::text)) OR ((guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'longboard'::text))));

-- 20261023200000_chat_whats_new_room.sql's definition with the Longboard Bot line added.
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

-- 20261023200000_chat_whats_new_room.sql's definition with Longboard Bot allowed next to the notes.
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

-- 20261109120000_chat_stock_club.sql's definition with Longboard Bot allowed next to the picks.
CREATE OR REPLACE FUNCTION public.enforce_chat_club_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if tg_op='UPDATE' and old.room_slug='club' then raise exception 'club_read_only'; end if;
 if new.room_slug='club' then
  if tg_op<>'INSERT' or new.member_id is not null or new.guest_id is not null
   or new.reply_to_id is not null or cardinality(new.attachment_ids)>0
   or not ((new.bot_slug='club' and new.author_label='Booker Stock Club'
     and exists(select 1 from public.chat_club_picks p where p.message_id=new.id))
    or (new.bot_slug='longboard' and new.author_label='Longboard Bot'))
  then raise exception 'club_read_only'; end if;
 end if;
 if new.reply_to_id is not null and exists(select 1 from public.longboard_chat_messages where id=new.reply_to_id and room_slug='club') then raise exception 'club_read_only'; end if;
 return new;
end $function$;

-- One announcement in one room. Returns {posted: true, messageId} for a new post, or
-- {posted: false, reason: 'duplicate', messageId} when that id is already this room's announcement
-- (a retry). Raises invalid_announcement, longboard_chat_paused, announcement_id_taken, or a room
-- guard's error (gainers_read_only).
create function public.post_chat_longboard_announcement(p_id uuid,p_room text,p_body text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare posted uuid; existing public.longboard_chat_messages;
begin
 if p_id is null or p_room is null or p_body is null or char_length(btrim(p_body)) not between 1 and 4000
 then raise exception 'invalid_announcement'; end if;
 -- A retry: the room's triggers (event numbers included) don't run again.
 select * into existing from public.longboard_chat_messages where id=p_id;
 if found then
  if existing.room_slug is distinct from p_room or existing.bot_slug is distinct from 'longboard' then raise exception 'announcement_id_taken'; end if;
  return jsonb_build_object('posted',false,'reason','duplicate','messageId',p_id);
 end if;
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug,client_id)
  values(p_id,p_room,'Longboard Bot',btrim(p_body),'longboard',p_id)
  on conflict(id) do nothing returning id into posted;
 if posted is not null then return jsonb_build_object('posted',true,'messageId',posted); end if;
 select * into existing from public.longboard_chat_messages where id=p_id;
 if existing.room_slug is distinct from p_room or existing.bot_slug is distinct from 'longboard' then raise exception 'announcement_id_taken'; end if;
 return jsonb_build_object('posted',false,'reason','duplicate','messageId',p_id);
end $$;
revoke all on function public.post_chat_longboard_announcement(uuid,text,text) from public,anon,authenticated;
grant execute on function public.post_chat_longboard_announcement(uuid,text,text) to service_role;
