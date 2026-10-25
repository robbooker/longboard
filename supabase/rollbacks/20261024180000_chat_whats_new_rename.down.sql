-- Rollback for 20261024180000_chat_whats_new_rename.sql: puts the two posts back to "What's New"
-- (only while they still carry the renamed text).

update public.longboard_chat_messages
   set body = replace(body, 'Welcome to What''s New? ', 'Welcome to What''s New. ')
 where id = '30200000-0000-4000-8000-000000000302'
   and room_slug = 'whats-new'
   and body like 'Welcome to What''s New? When a change to Longboard goes live,%';

update public.longboard_chat_messages
   set body = 'There''s a new What''s New room in chat. Every member is in it, and a short note appears there whenever a change to Longboard goes live.'
 where room_slug = 'whats-new'
   and bot_slug = 'whats-new'
   and body = 'There''s a new What''s New? room in chat. Every member is in it, and a short note appears there whenever a change to Longboard goes live.';
