-- #339 D-339: a link saved from Trader Links keeps saying who posted it, on My Links too.
--
--  * chat_private_links.saved_from_member_id: who posted the shared link this copy was saved from.
--    It is kept on the copy because saved_from_link_id is cleared when the original is removed, and
--    the copy outlives the original. Only the id is kept, never the name: the page looks the name
--    up, so a new chat name shows everywhere, as it does on Trader Links, and removing the member
--    clears the column (on delete set null), which drops the line, also as on Trader Links.
--  * chat_private_link_set_poster: the database fills it in, so no route has to and no request can
--    set it. On a save it copies the original's poster. If the member changes a copy's web address
--    it is cleared, because the poster never posted the new address. Other edits leave it alone.
--    Links a member types in have no original, so the column stays null and they show no line.
--  * Existing copies are filled in from their originals. Copies whose original is gone stay null.
--    Their updated_at doesn't change: the member changed nothing.
--  * Only the saver ever reads the row (the routes filter by the verified member). RLS and grants
--    are the table's existing ones: RLS on, no policies, service role only.
--
-- No existing function changes. Safe to apply before the code ships: the current code never reads
-- the column, and saving works the same with the trigger in place. The new code reads the column
-- if it is there and shows no line if it isn't.
--
-- Production when written (2026-10-31): the column and function don't exist, on production or the
-- preview database; 2 saved copies, both with their original and a poster. Needs #336
-- (20261030230000_chat_page_link_saves_reactions.sql) first.
-- Rollback: supabase/rollbacks/20261031090000_chat_private_link_poster.down.sql

alter table public.chat_private_links
 add column saved_from_member_id uuid references public.longboard_chat_members(id) on delete set null;
create index chat_private_links_saved_from_member on public.chat_private_links(saved_from_member_id)
 where saved_from_member_id is not null;

update public.chat_private_links p
 set saved_from_member_id = l.added_by
 from public.chat_page_links l
 where l.id = p.saved_from_link_id and l.added_by is not null;

create function public.chat_private_link_set_poster() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op = 'INSERT' then
  new.saved_from_member_id := null;
  if new.saved_from_link_id is not null then
   select l.added_by into new.saved_from_member_id from public.chat_page_links l where l.id = new.saved_from_link_id;
  end if;
 elsif new.url is distinct from old.url then
  new.saved_from_member_id := null;
 end if;
 return new;
end $$;
revoke all on function public.chat_private_link_set_poster() from public,anon,authenticated;
create trigger chat_private_link_poster before insert or update of url on public.chat_private_links
 for each row execute function public.chat_private_link_set_poster();
