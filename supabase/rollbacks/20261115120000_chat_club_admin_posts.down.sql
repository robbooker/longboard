-- Rollback for 20261115120000_chat_club_admin_posts.sql (#457): Booker Stock Club is read-only again
-- (only the stock-pick bot and Longboard Bot post). Puts back enforce_chat_club_post exactly as
-- 20261110200000_chat_longboard_bot.sql defined it and the two room checks without 'club'.
-- The admins' club posts must go first (with their replies, files and alerts), or the old checks
-- can't be added and the old guard would refuse their later updates: they are announcements, so
-- deleting them only removes those posts. Roll the app back first, so nobody posts in between.
delete from public.chat_room_mentions where room_slug='club';
delete from public.longboard_chat_messages where room_slug='club' and guest_id is not null;
delete from public.chat_attachments where room_slug='club';
-- Run the deferred checks the deletes queued now, so the tables can be altered in the same transaction.
set constraints all immediate;

alter table public.chat_attachments drop constraint chat_attachments_room_slug_check;
alter table public.chat_attachments add constraint chat_attachments_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text])));
alter table public.chat_room_mentions drop constraint chat_room_mentions_room_slug_check;
alter table public.chat_room_mentions add constraint chat_room_mentions_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text])));

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
