-- D-304 "What's New Room Changes": the room is renamed "What's New?" (with a question mark).
-- The room's name lives in the app, not the database; only two posts in the room name it:
--  * the welcome post (inserted by 20261023200000_chat_whats_new_room.sql), and
--  * the automatic note for PR #494 ("There's a new What's New room in chat. ...").
-- Each is changed only while its text is still exactly the original, so a hand edit by an admin
-- is never overwritten. Rows keep their author, time and edited_at (a wording fix, not an edit).
-- Production when written (2026-10-24, read-only): both rows present with the original text.

update public.longboard_chat_messages
   set body = replace(body, 'Welcome to What''s New. ', 'Welcome to What''s New? ')
 where id = '30200000-0000-4000-8000-000000000302'
   and room_slug = 'whats-new'
   and body like 'Welcome to What''s New. When a change to Longboard goes live,%';

update public.longboard_chat_messages
   set body = 'There''s a new What''s New? room in chat. Every member is in it, and a short note appears there whenever a change to Longboard goes live.'
 where room_slug = 'whats-new'
   and bot_slug = 'whats-new'
   and body = 'There''s a new What''s New room in chat. Every member is in it, and a short note appears there whenever a change to Longboard goes live.';
