-- Rollback for 20261030120000_chat_polls.sql (#328 Polls).
-- Removes every poll, answer and vote and the poll functions. The poll messages themselves stay in
-- the conversation as ordinary messages ("📊 Poll: <question>"); no existing function was changed,
-- so nothing else needs restoring.
drop trigger if exists chat_poll_question_guard on public.longboard_chat_messages;
drop function if exists public.keep_chat_poll_question();
drop function if exists public.read_chat_polls(uuid,text,uuid[]);
drop function if exists public.close_chat_poll(uuid,text,uuid);
drop function if exists public.vote_chat_poll(uuid,text,uuid,uuid[]);
drop function if exists public.create_chat_poll(uuid,text,text,text[],boolean,boolean,uuid,uuid);
drop table if exists public.chat_poll_votes;
drop table if exists public.chat_poll_options;
drop function if exists public.chat_poll_target(text,uuid);
drop table if exists public.chat_polls;
drop function if exists public.enforce_chat_poll_vote();
