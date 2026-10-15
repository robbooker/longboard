-- Rollback for 20261016120000_chat_attachment_dimensions.sql. Safe at any time: the app
-- falls back to preview_width/preview_height (and then a fixed box) when these are missing.
-- New uploads keep working; images shared since the migration lose their stored size only.
begin;
alter table public.chat_attachments drop constraint if exists chat_attachments_dimensions_check;
alter table public.chat_attachments drop column if exists height;
alter table public.chat_attachments drop column if exists width;
commit;
