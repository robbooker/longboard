-- Rollback for 20261127120000_chat_club_webinar_chat.sql (#535 Booker Stock Club: chat during a webinar).
-- Roll the app back first (the app from #535 calls the two functions removed here for a member's
-- post during a webinar; the app before it does not). Then this puts enforce_chat_club_post back
-- exactly as 20261126120000_chat_stage_broadcasts.sql defined it and removes the two functions.
-- No message is deleted or changed: what members said during a webinar stays in the room (the old
-- guard only judges new posts and new words; deletes and bookkeeping updates keep working).

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

drop function if exists public.send_chat_club_live_message(uuid,text,uuid,uuid[],uuid);
drop function if exists public.change_chat_club_live_message(uuid,uuid,text,text,text,integer);
