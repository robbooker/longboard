-- #457 Booker Stock Club: chat admins post there directly (Liz's announcements). Members still only
-- read and react.
--
--  * enforce_chat_club_post: 20261110200000_chat_longboard_bot.sql's definition (the stock-pick
--    bot and Longboard Bot lines are unchanged) with one more kind of club post: a chat admin's own
--    post (profile role exactly 'admin', as enforce_chat_announcement_writer checks it for the
--    announcement rooms), with text, photos and links. The admin can edit and delete it. Replies:
--    admins reply under a person's post, as in the announcement rooms; replies under the bot's posts
--    (the stock-pick cards, Longboard Bot) stay refused. Never an agent's post (agent_id or the
--    chat.agent_id setting send_chat_agent_message uses), never a guest's. Rows still never move
--    into or out of the club, and the bot's posts still never change.
--    Bookkeeping updates of a person's club post keep working without the admin check: a delete,
--    a reply's parent going away (reply_to_id set null), a member removed (member_id set null).
--  * The app refuses members, API tokens (even an admin's own) and agents first (canWriteChatRoom
--    in lib/chatAccess.ts), with "Booker Stock Club is a read-only channel."
--  * chat_attachments_room_slug_check: photos in the club. chat_room_mentions_room_slug_check: an
--    @name or a reply in an admin's post alerts that person in the bell (queue_chat_push leaves
--    club alerts out of phone push, unchanged). Both are the current definitions (as
--    20261110140000_chat_runner_watch.sql left them, read from the fixture) with only 'club' added;
--    the block below stops the migration if production's definition is different, rather than
--    narrowing it.
--  * The actor check needs no change: a member's post (guest_id set, no bot_slug) is already allowed
--    in every room; it limits only bot posts.
--
-- Additive: the running app keeps working once this is applied (it doesn't send member posts to the
-- club until the app from #457 ships). Apply it before that app.
-- Rollback: supabase/rollbacks/20261115120000_chat_club_admin_posts.down.sql

do $$
begin
 if pg_get_constraintdef((select oid from pg_constraint where conrelid='public.chat_attachments'::regclass and conname='chat_attachments_room_slug_check'))
  <> $c$CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text])))$c$
 then raise exception 'chat_attachments_room_slug_check is not the expected definition: read it and add club by hand'; end if;
 if pg_get_constraintdef((select oid from pg_constraint where conrelid='public.chat_room_mentions'::regclass and conname='chat_room_mentions_room_slug_check'))
  <> $c$CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text])))$c$
 then raise exception 'chat_room_mentions_room_slug_check is not the expected definition: read it and add club by hand'; end if;
end $$;

alter table public.chat_attachments drop constraint chat_attachments_room_slug_check;
alter table public.chat_attachments add constraint chat_attachments_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text, 'club'::text])));
alter table public.chat_room_mentions drop constraint chat_room_mentions_room_slug_check;
alter table public.chat_room_mentions add constraint chat_room_mentions_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text, 'club'::text])));

CREATE OR REPLACE FUNCTION public.enforce_chat_club_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare parent public.longboard_chat_messages;
begin
 -- Nothing moves into or out of the club, and a bot's post there never changes.
 if tg_op='UPDATE' and (old.room_slug='club' or new.room_slug='club')
  and (old.room_slug<>new.room_slug or old.guest_id is null) then raise exception 'club_read_only'; end if;
 if new.room_slug='club' then
  if new.guest_id is not null then
   -- #457: a person's post: only a chat admin's own (never an agent's), with text, photos, links.
   if new.bot_slug is not null or new.agent_id is not null
    or coalesce(current_setting('chat.agent_id',true),'')<>''
   then raise exception 'club_read_only'; end if;
   -- A new post, or new words or files on one, needs its author to be an admin now.
   if (tg_op='INSERT' or (new.deleted_at is null
     and (new.body is distinct from old.body or new.attachment_ids is distinct from old.attachment_ids)))
    and not (new.member_id is not null and new.member_id=new.guest_id and exists(
     select 1 from public.longboard_chat_members m join public.profiles p on p.id=m.user_id
     where m.id=new.member_id and p.role='admin'))
   then raise exception 'club_read_only'; end if;
  elsif tg_op<>'INSERT' or new.member_id is not null
   or new.reply_to_id is not null or cardinality(new.attachment_ids)>0
   or not ((new.bot_slug='club' and new.author_label='Booker Stock Club'
     and exists(select 1 from public.chat_club_picks p where p.message_id=new.id))
    or (new.bot_slug='longboard' and new.author_label='Longboard Bot'))
  then raise exception 'club_read_only'; end if;
 end if;
 -- A reply under a club post: only an admin's club post (checked above) under a person's post, never
 -- under the bot's, and never from another room.
 if new.reply_to_id is not null and (tg_op='INSERT' or new.reply_to_id is distinct from old.reply_to_id) then
  select * into parent from public.longboard_chat_messages where id=new.reply_to_id;
  if found and parent.room_slug='club' and (new.room_slug<>'club' or new.guest_id is null
    or parent.guest_id is null or parent.bot_slug is not null)
  then raise exception 'club_read_only'; end if;
 end if;
 return new;
end $function$;
