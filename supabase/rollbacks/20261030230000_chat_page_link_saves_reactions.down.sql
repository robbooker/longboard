-- Rollback for 20261030230000_chat_page_link_saves_reactions.sql (#336).
-- Removes every reaction on shared links and the summary function. Saved copies stay on each
-- member's My Links as ordinary private links; only their tie to the original goes. No existing
-- function was changed, so none is restored.
drop function if exists public.chat_page_link_reaction_summary(uuid,uuid[]);
drop table if exists public.chat_page_link_reactions;
alter table public.chat_private_links
 drop constraint if exists chat_private_links_one_save_per_link,
 drop column if exists saved_from_link_id;
