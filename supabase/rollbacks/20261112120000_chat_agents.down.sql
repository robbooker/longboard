-- Rollback for 20261112120000_chat_agents.sql (#450): agents go away. Their posts stay, as posts
-- of their owners (member_id was always the owner's); their stored author_label keeps the agent's
-- name until the owner's current name is shown by the usual name projection. Agent tokens,
-- settings and mutes are deleted. No existing function was changed, so none is restored.
drop function if exists public.chat_agent_mute_set(uuid,uuid,boolean);
drop function if exists public.chat_agent_mutes_list(uuid);
drop function if exists public.chat_agent_message_identities(uuid[]);
drop function if exists public.send_chat_agent_message(uuid,text,text,uuid,uuid[],uuid);
drop function if exists public.chat_agent_request_context(text);
drop function if exists public.chat_agent_admin_pause(uuid,uuid,boolean);
drop function if exists public.chat_agent_admin_list(uuid);
drop function if exists public.chat_agent_ceiling_update(uuid,jsonb);
drop function if exists public.chat_agent_token_revoke(uuid,uuid);
drop function if exists public.chat_agent_token_create(uuid,uuid,text,text,text);
drop function if exists public.chat_agent_delete(uuid,uuid);
drop function if exists public.chat_agent_update(uuid,uuid,jsonb);
drop function if exists public.chat_agent_create(uuid,text);
drop function if exists public.chat_agent_name_free(text,uuid);
drop function if exists public.chat_agent_list(uuid);
drop function if exists public.chat_agent_json(public.chat_agents);
drop function if exists public.chat_agent_effective(uuid);
drop function if exists public.chat_agent_ceiling();
drop function if exists public.chat_agent_is_admin(uuid);
drop function if exists public.chat_agent_owner_ok(uuid);

drop trigger if exists chat_agent_keep_message_agent on public.longboard_chat_messages;
drop trigger if exists chat_agent_stamp_message on public.longboard_chat_messages;
drop function if exists public.chat_agent_keep_message_agent();
drop function if exists public.chat_agent_stamp_message();
drop index if exists public.longboard_chat_messages_agent;
alter table public.longboard_chat_messages drop column if exists agent_id;

drop table if exists public.chat_agent_mutes;
drop table if exists public.chat_agent_tokens;
drop table if exists public.chat_agents;
drop table if exists public.chat_agent_settings;
drop function if exists public.chat_agent_rooms();
