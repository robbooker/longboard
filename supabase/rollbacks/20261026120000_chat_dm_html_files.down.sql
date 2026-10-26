-- Rollback for 20261026120000_chat_dm_html_files.sql.
-- HTML files must go first or the narrower type check cannot be added back. Deleting the
-- rows queues their stored objects for cleanup (chat_attachment_cleanup_delete trigger);
-- DM messages that pointed at them simply stop listing those files.
delete from public.chat_attachments where mime_type='text/html';
alter table public.chat_attachments drop constraint if exists chat_attachment_html_dm_only;
alter table public.chat_attachments drop constraint chat_attachments_mime_type_check;
alter table public.chat_attachments add constraint chat_attachments_mime_type_check
 check(mime_type in ('application/pdf','image/jpeg','image/png','image/gif','audio/wav'));
update storage.buckets set allowed_mime_types=array_remove(allowed_mime_types,'text/html')
 where id='chat-attachments';
