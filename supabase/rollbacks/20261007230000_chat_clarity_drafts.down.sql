-- Rollback for 20261007230000_chat_clarity_drafts.sql (removes stored originals).
drop trigger if exists chat_clarity_draft_follows_dm_delete on public.longboard_chat_direct_messages;
drop function if exists public.delete_chat_clarity_draft();
drop table if exists public.chat_clarity_drafts;
