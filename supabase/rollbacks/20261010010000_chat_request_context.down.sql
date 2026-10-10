-- Rollback for 20261010010000_chat_request_context.sql. Only after the app no longer calls
-- these functions (revert the P3 PR first), or chat sign-in fails for everyone.
begin;
drop function public.chat_longboard_request_context(uuid,uuid);
drop function public.chat_session_request_context(text);
commit;
