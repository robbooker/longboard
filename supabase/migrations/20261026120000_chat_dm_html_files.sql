-- D-308: HTML files (.html/.htm, text/html) can be shared in direct messages only.
-- They go through the same quarantine -> malware scan -> clean copy pipeline as PDFs,
-- and the app never hands them out as signed storage links: recipients only get a
-- forced download from /api/chat/attachments/<id> (attachment + nosniff + sandbox CSP).
alter table public.chat_attachments drop constraint chat_attachments_mime_type_check;
alter table public.chat_attachments add constraint chat_attachments_mime_type_check
 check(mime_type in ('application/pdf','image/jpeg','image/png','image/gif','audio/wav','text/html'));
-- Rooms never accept HTML: an HTML row must belong to a DM conversation. Room messages can
-- only bind room-scoped files (bind_chat_attachments checks room_slug), so this also keeps
-- HTML out of every room message.
alter table public.chat_attachments add constraint chat_attachment_html_dm_only
 check(mime_type<>'text/html' or (conversation_id is not null and room_slug is null and room_message_id is null));
update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'text/html')
 where id='chat-attachments' and not ('text/html'=any(allowed_mime_types));
