-- Rolls back 20261021120000_chat_api_tokens: every API token stops working and is deleted.
drop function if exists public.chat_api_request_context(text);
drop function if exists public.revoke_chat_api_token(uuid,uuid);
drop function if exists public.list_chat_api_tokens(uuid);
drop function if exists public.create_chat_api_token(uuid,text,text,text);
drop table if exists public.chat_api_tokens;
drop table if exists public.chat_api_access;
