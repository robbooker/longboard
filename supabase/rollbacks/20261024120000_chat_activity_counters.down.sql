-- Rollback for 20261024120000_chat_activity_counters.sql (D-212). Safe at any time once
-- CHAT_BELL_COUNTERS is off (or unset): with the function gone the app already falls back to
-- chat_activity_inbox on its own (lib/chatReads/activity.ts), so even with the flag on nothing
-- breaks; the bell is just back to the old query. Removes the triggers first (writes stop
-- touching the counters), then the read function, the helpers, the table and the index.
-- No other object changes.

drop trigger if exists chat_activity_counters_insert on public.chat_room_mentions;
drop trigger if exists chat_activity_counters_update on public.chat_room_mentions;
drop trigger if exists chat_activity_counters_delete on public.chat_room_mentions;
drop trigger if exists chat_activity_counters_insert on public.chat_reaction_notifications;
drop trigger if exists chat_activity_counters_update on public.chat_reaction_notifications;
drop trigger if exists chat_activity_counters_delete on public.chat_reaction_notifications;
drop trigger if exists chat_activity_counters on public.longboard_chat_messages;
drop trigger if exists chat_activity_counters on public.longboard_chat_direct_messages;
drop trigger if exists chat_activity_counters_update on public.longboard_chat_direct_messages;
drop trigger if exists chat_activity_counters on public.longboard_chat_conversations;
drop trigger if exists chat_activity_counters_delete on public.longboard_chat_conversations;
drop trigger if exists chat_activity_counters on public.longboard_chat_blocks;
drop trigger if exists chat_activity_counters on public.longboard_chat_members;
drop trigger if exists chat_activity_counters_update on public.longboard_chat_members;

drop function if exists public.chat_activity_counts(uuid,text[]);
drop function if exists public.chat_activity_counters_mentions();
drop function if exists public.chat_activity_counters_reactions();
drop function if exists public.chat_activity_counters_room_message();
drop function if exists public.chat_activity_counters_direct_message();
drop function if exists public.chat_activity_counters_conversation();
drop function if exists public.chat_activity_counters_block();
drop function if exists public.chat_activity_counters_member();
drop function if exists public.chat_activity_counter_refresh_conversation(uuid,boolean);
drop function if exists public.chat_activity_counter_refresh_account(uuid,text);
drop function if exists public.chat_activity_counter_refresh(uuid,text,text);
drop function if exists public.chat_activity_counter_compute(uuid,text,text);
drop table if exists public.chat_activity_counters;
drop index if exists public.chat_room_mentions_message;
