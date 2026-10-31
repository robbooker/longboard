-- Rollback for 20261031090000_chat_private_link_poster.sql (#339).
-- My Links stop showing who posted a saved link; the saved links themselves stay, still tied to
-- their originals. The new code shows no line without the column. No existing function was changed,
-- so none is restored. Re-applying the migration fills in copies whose original still exists.
drop trigger if exists chat_private_link_poster on public.chat_private_links;
drop function if exists public.chat_private_link_set_poster();
drop index if exists public.chat_private_links_saved_from_member;
alter table public.chat_private_links drop column if exists saved_from_member_id;
