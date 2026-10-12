-- Revert the P10 PR first (the app must be back on send_chat_attachment_message), then run this.
drop function if exists public.send_chat_room_message(uuid,text,text,uuid,uuid[],uuid);
