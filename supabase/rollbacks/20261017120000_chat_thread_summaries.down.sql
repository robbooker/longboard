-- Rollback for 20261017120000_chat_thread_summaries.sql. Safe at any time: the thread-counts
-- API falls back to chat_thread_counts, so thread links show the reply count without the
-- repliers and the last reply time.
drop function if exists public.chat_thread_summaries(text,uuid[]);
