-- Rollback of 20261102180000_chat_improvement_suggestions.sql. Messages already in the Admins room stay
-- readable, under the FAQ bot's slug (their name and words don't change), so the old constraint holds.
-- The record of who sent what, which is also the rate limit, is dropped; the messages still name them.
drop function if exists public.post_chat_improvement_suggestion(uuid,text);
drop table if exists public.chat_improvement_suggestions;
update public.longboard_chat_messages set bot_slug='faq-suggestions' where bot_slug='chat-improvements';
alter table public.longboard_chat_messages drop constraint longboard_chat_messages_actor_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_actor_check check (
 (guest_id is not null and bot_slug is null) or (guest_id is null and bot_slug='buddy') or
 (room_slug='gainers' and guest_id is null and member_id is null and bot_slug='gainers') or
 (room_slug='whats-new' and guest_id is null and member_id is null and bot_slug='whats-new') or
 (room_slug='admins' and guest_id is null and member_id is null and bot_slug='faq-suggestions')
);
