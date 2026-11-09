-- Rollback for 20261110180000_chat_member_avatars.sql (#410 profile pictures). Every member goes back
-- to the initials tile; the upload counts are lost.
--
-- The picture files are NOT removed by this script: Supabase does not allow deleting storage objects
-- with SQL. Before running it, empty the chat-avatars and chat-avatar-uploads buckets (Dashboard >
-- Storage > select all > Delete, or storage.from(...).remove(...) with the service role). The last two
-- statements then remove the empty buckets; they fail harmlessly if files are still in them.
drop function if exists public.chat_avatar_clear(uuid);
drop function if exists public.chat_avatar_set(uuid,uuid,text);
drop function if exists public.chat_avatar_reserve(uuid);
drop table if exists public.chat_avatar_uploads;
alter table public.longboard_chat_members drop column if exists avatar_path;
delete from storage.buckets where id='chat-avatar-uploads';
delete from storage.buckets where id='chat-avatars';
