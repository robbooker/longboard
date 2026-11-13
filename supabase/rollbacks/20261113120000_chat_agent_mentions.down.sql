-- Rollback for 20261113120000_chat_agent_mentions.sql (#455): agent mention alerts go away.
-- Messages are untouched; only the recorded mentions are dropped. The mentions route then answers
-- mentions_unavailable.
drop trigger if exists chat_agent_mention_events on public.longboard_chat_messages;
drop function if exists public.chat_agent_mentions_since(uuid,text[],bigint,integer);
drop function if exists public.record_chat_agent_mentions();
drop function if exists public.chat_agent_mention_scan(text);
drop table if exists public.chat_agent_mentions;
