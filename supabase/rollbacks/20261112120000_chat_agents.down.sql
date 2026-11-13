-- Rollback for 20261112120000_chat_agents.sql (#450): agents go away. Their posts stay, as posts
-- of their owners (member_id was always the owner's); their stored author_label keeps the agent's
-- name until the owner's current name is shown by the usual name projection. Agent tokens,
-- settings and mutes are deleted. chat_merge_account_columns is put back exactly as
-- 20261111170000_chat_merge_linked_profiles.sql defined it (after the tables are gone).
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

create or replace function public.chat_merge_account_columns() returns table(table_name regclass, column_name text, action text)
language plpgsql stable security invoker set search_path='' as $$
declare r record; decided text;
begin
 for r in
  select c.conrelid::regclass t, a.attname::text col
  from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and cardinality(c.conkey)=1 and c.confrelid='public.chat_accounts'::regclass
  group by 1,2 order by 1::text,2
 loop
  decided:=case regexp_replace(r.t::text,'^public\.','')||'.'||r.col
   -- The person's own things: notifications, read positions, devices, pins, settings.
   when 'chat_room_mentions.account_id' then 'move'
   when 'chat_room_reads.account_id' then 'move'
   when 'chat_reaction_notifications.account_id' then 'move'
   when 'chat_favorites.account_id' then 'move'
   when 'chat_conversation_pins.account_id' then 'move'
   when 'chat_room_notification_levels.account_id' then 'move'
   when 'chat_push_subscriptions.account_id' then 'move'
   when 'chat_activity_preferences.account_id' then 'move'
   when 'chat_card_layouts.account_id' then 'move'
   when 'chat_summary_requests.account_id' then 'move'
   when 'chat_summary_deliveries.account_id' then 'move'
   when 'chat_room_message_pins.pinned_by' then 'move'
   when 'chat_feature_notifications.account_id' then 'move'
   when 'chat_feature_notification_mutes.account_id' then 'move'
   when 'chat_feature_notification_preferences.account_id' then 'move'
   when 'reader_progress.account_id' then 'move'
   -- Moved by the merge itself (sign-ins, the profile row) or worked out again (bell counters).
   when 'chat_sessions.account_id' then 'special'
   when 'longboard_chat_members.user_id' then 'special'
   when 'chat_activity_counters.account_id' then 'special'
   -- Stay with the ShortScout account: its identity and link, access grants and audit history.
   when 'chat_provider_identities.account_id' then 'keep'
   when 'chat_shortscout_membership_links.lb_account_id' then 'keep'
   when 'chat_shortscout_membership_links.source_account_id' then 'keep'
   when 'chat_bot_accounts.account_id' then 'keep'
   when 'chat_api_tokens.account_id' then 'keep'
   when 'chat_api_access.account_id' then 'keep'
   when 'chat_feature_members.account_id' then 'keep'
   when 'chat_feature_requests.approved_by' then 'keep'
   when 'chat_feature_requests.archived_by' then 'keep'
   when 'chat_feature_requests.created_by' then 'keep'
   when 'chat_feature_messages.author_id' then 'keep'
   when 'chat_feature_releases.approved_by' then 'keep'
   when 'chat_message_actions.actor_id' then 'keep'
   when 'longboard_chat_search_budget.user_id' then 'keep'
   when 'member_people.chat_account_id' then 'keep'
   when 'reader_books.created_by' then 'keep'
   else null end;
  if decided is null then raise exception 'merge_unclassified_account_column: %.%',r.t,r.col; end if;
  table_name:=r.t; column_name:=r.col; action:=decided; return next;
 end loop;
end $$;
