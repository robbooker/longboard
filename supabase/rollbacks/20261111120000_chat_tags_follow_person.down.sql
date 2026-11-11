-- Rollback for 20261111120000_chat_tags_follow_person.sql (#439): removes the stored tags, the name
-- history, the lookups and the backfill, and puts record_chat_room_mentions back exactly as
-- 20261023200000_chat_whats_new_room.sql defined it (tags matched by current names). Notification
-- rows already written stay as they are. The app falls back to its old lookups by itself.
drop trigger if exists chat_message_tag_events on public.longboard_chat_messages;
drop trigger if exists chat_member_name_history on public.longboard_chat_members;
drop function if exists public.chat_tags_backfill_step(integer);
drop function if exists public.chat_tag_suggestions(text,uuid[],integer);
drop function if exists public.chat_tag_lookup(uuid,text[],text[],uuid[]);
drop function if exists public.record_chat_message_tags();
drop function if exists public.chat_message_tag_scan(text,uuid,boolean);
drop function if exists public.remember_chat_member_name();
drop table if exists public.chat_tags_backfill;
drop table if exists public.chat_message_tags;
drop table if exists public.chat_member_names;

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
