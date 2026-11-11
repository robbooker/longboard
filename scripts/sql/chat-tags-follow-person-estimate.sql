-- #439 estimate before the backfill, read-only: how many messages the backfill reads, how many have
-- an "@" (only those can get tags), how many earlier names it would record from the messages'
-- author_label, and how many of those names more than one member has had (tags typed with them are
-- left alone unless the message's notification says who was meant).
--   supabase db query --linked --project-ref <ref> -f scripts/sql/chat-tags-follow-person-estimate.sql
-- Output: counts only.
with labels as (
 select distinct m.member_id,lower(btrim(m.author_label)) name_key
 from public.longboard_chat_messages m join public.longboard_chat_members mem on mem.id=m.member_id
 where m.bot_slug is null and char_length(btrim(m.author_label)) between 2 and 28
  and lower(btrim(m.author_label)) not in ('buddy','longboard','longboard admin')
), names as (
 select member_id,name_key from labels union select id,lower(display_name) from public.longboard_chat_members
)
select
 (select count(*) from public.longboard_chat_messages) messages_scanned,
 (select count(*) from public.longboard_chat_messages where strpos(body,'@')>0) messages_with_at,
 (select count(*) from names) name_rows,
 (select count(*) from labels l join public.longboard_chat_members mem on mem.id=l.member_id where l.name_key<>lower(mem.display_name)) earlier_names,
 (select count(*) from (select name_key from names group by name_key having count(distinct member_id)>1) s) shared_names,
 (select count(*) from public.chat_room_mentions where category='mention') mention_rows;
