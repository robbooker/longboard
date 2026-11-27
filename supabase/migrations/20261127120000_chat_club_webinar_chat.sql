-- #535 Booker Stock Club: the chat opens to everyone in the room while a webinar is live there, and
-- is read-only for members again when it ends.
--
-- WHO DECIDES. The app's server, from the live-video state it already keeps (lib/chatClubLive.ts,
-- lib/chatClubLiveServer.ts): LiveKit says the club's broadcast is playing, or it stopped so
-- recently that its notice has not been marked ended (20 seconds). The database cannot ask LiveKit,
-- so it does not judge "live" a second time (a second opinion that could refuse, at the moment a
-- webinar starts, what the server had just allowed). Instead:
--
-- 1. enforce_chat_club_post (the club's guard): the definition from
--    20261126120000_chat_stage_broadcasts.sql with ONE addition to "a person's post needs its
--    author to be an admin": or the transaction carries the setting chat.club_webinar = '1'.
--    Everything else is as it was: a person's own post only (member_id = guest_id), never an
--    agent's, never a bot's; no reply under a stock-pick card or any other bot post; nothing moves
--    into or out of the club; the stock-pick cards and bot posts never change (the live-video
--    notice's words excepted, as before).
-- 2. Two functions, service role only (security invoker), which set that setting for their own
--    transaction and then call the ordinary function, so every other rule (the room's pause, the
--    send limits of 1.5 seconds and 30 in 10 minutes, a retry being the same send, own-post-only
--    edits, expected words and revision) is exactly the ordinary room's:
--      send_chat_club_live_message    -> send_chat_room_message(..., 'club', ...)
--      change_chat_club_live_message  -> change_chat_message(..., 'club', ..., p_admin false, ...)
--    Nothing but these sets the setting: a browser cannot (PostgREST only sets request.*), agents
--    go through send_chat_agent_message, and the app calls these only for a member signed in
--    through the browser while its server says a webinar is live.
--
-- Not changed: who can open the club (chat_account_has_room), reactions (members always could),
-- bell entries and phone push for the club (queue_chat_push: replies and @names in the club still
-- never reach phones; only a live-video notice does), post_chat_club_pick, every room check.
--
-- Additive, and safe to apply BEFORE the app from #535 ships: the running app never sets the
-- setting and never calls the two new functions, so with this applied and the old app running the
-- club behaves exactly as it does today. Apply it before that app (the new app's member posts call
-- the new functions). No table is rewritten, no row is read or changed; the only locks are the
-- brief ones of CREATE OR REPLACE FUNCTION. Apply it as one transaction (as the migration tool
-- does), so a failed check leaves nothing behind.
-- The block below stops the migration if the guard is not the definition this was written
-- against, rather than overwriting something newer.
-- Rollback: supabase/rollbacks/20261127120000_chat_club_webinar_chat.down.sql

do $$
begin
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='enforce_chat_club_post') is distinct from '08e55816ae48f031371524264fc8415d'
  then raise exception 'enforce_chat_club_post is not the expected definition: read it and add the webinar setting by hand'; end if;
end $$;

-- 20261126120000_chat_stage_broadcasts.sql's definition with the #535 addition (the block marked #535).
CREATE OR REPLACE FUNCTION public.enforce_chat_club_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare parent public.longboard_chat_messages;
begin
 -- #524: the one bot post in the club whose words may change: Longboard Bot's live-video notice (a
 -- row of chat_stage_broadcasts for the club), rewritten by public.chat_stage_notice_rewrite, which
 -- names it in a setting for its own transaction. Its words change; who posted it, where, when,
 -- under what name, as a reply to what, with what files, and whether it is deleted may not.
 if tg_op='UPDATE' and old.room_slug='club' and new.room_slug='club' and old.guest_id is null
  and old.bot_slug='longboard' and coalesce(current_setting('chat.stage_notice',true),'')=old.id::text
  and exists(select 1 from public.chat_stage_broadcasts b where b.notice_id=old.id and b.room_slug='club')
  and new.id=old.id and new.guest_id is null and new.member_id is null and new.agent_id is null
  and new.bot_slug='longboard' and new.author_label=old.author_label
  and new.reply_to_id is not distinct from old.reply_to_id and new.attachment_ids=old.attachment_ids
  and new.created_at=old.created_at and new.deleted_at is not distinct from old.deleted_at
 then return new; end if;
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
   -- #535: or a webinar to be live in the club, which only the app's server can say: it sends a
   -- member's post or edit through send_chat_club_live_message / change_chat_club_live_message,
   -- which name it in a setting for their own transaction. Still the member's own post, never an
   -- agent's (refused above) and never a bot's.
   if (tg_op='INSERT' or (new.deleted_at is null
     and (new.body is distinct from old.body or new.attachment_ids is distinct from old.attachment_ids)))
    and not (new.member_id is not null and new.member_id=new.guest_id and (
     coalesce(current_setting('chat.club_webinar',true),'')='1'
     or exists(select 1 from public.longboard_chat_members m join public.profiles p on p.id=m.user_id
      where m.id=new.member_id and p.role='admin')))
   then raise exception 'club_read_only'; end if;
  elsif tg_op<>'INSERT' or new.member_id is not null
   or new.reply_to_id is not null or cardinality(new.attachment_ids)>0
   or not ((new.bot_slug='club' and new.author_label='Booker Stock Club'
     and exists(select 1 from public.chat_club_picks p where p.message_id=new.id))
    or (new.bot_slug='longboard' and new.author_label='Longboard Bot'))
  then raise exception 'club_read_only'; end if;
 end if;
 -- A reply under a club post: only a club post allowed above (an admin's, or during a webinar a
 -- member's) under a person's post, never under the bot's, and never from another room.
 if new.reply_to_id is not null and (tg_op='INSERT' or new.reply_to_id is distinct from old.reply_to_id) then
  select * into parent from public.longboard_chat_messages where id=new.reply_to_id;
  if found and parent.room_slug='club' and (new.room_slug<>'club' or new.guest_id is null
    or parent.guest_id is null or parent.bot_slug is not null)
  then raise exception 'club_read_only'; end if;
 end if;
 return new;
end $function$;

create or replace function public.send_chat_club_live_message(p_user uuid,p_body text,p_reply uuid,p_files uuid[],p_client uuid)
 returns jsonb language plpgsql security invoker set search_path to '' as $function$
begin
 perform set_config('chat.club_webinar','1',true);
 return public.send_chat_room_message(p_user,'club',p_body,p_reply,p_files,p_client);
end $function$;

create or replace function public.change_chat_club_live_message(p_actor uuid,p_message uuid,p_action text,p_body text default null,p_expected_body text default null,p_expected_revision integer default null)
 returns jsonb language plpgsql security invoker set search_path to '' as $function$
begin
 perform set_config('chat.club_webinar','1',true);
 return public.change_chat_message(p_actor,p_message,'club',p_action,p_body,p_expected_body,false,p_expected_revision);
end $function$;

revoke all on function public.send_chat_club_live_message(uuid,text,uuid,uuid[],uuid) from public,anon,authenticated;
revoke all on function public.change_chat_club_live_message(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.send_chat_club_live_message(uuid,text,uuid,uuid[],uuid) to service_role;
grant execute on function public.change_chat_club_live_message(uuid,uuid,text,text,text,integer) to service_role;
