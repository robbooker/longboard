-- PIN is already published. Extend only its room constraint for recording channels;
-- its service-only RPC continues to revalidate the existing room entitlement.
alter table public.chat_conversation_pins drop constraint chat_conversation_pins_room_slug_check;
alter table public.chat_conversation_pins add constraint chat_conversation_pins_room_slug_check
 check(room_slug is null or room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings'));
