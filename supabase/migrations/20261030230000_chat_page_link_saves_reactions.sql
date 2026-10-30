-- #336 D-336: save a shared link to My Links, and react to shared links.
--
--  * chat_private_links.saved_from_link_id: the shared link a private link was saved from, if any.
--    The private link is a full copy, so editing the original never changes it. Removing the
--    original clears this column (on delete set null) and the copy stays. The unique constraint
--    means one copy per member per link, however many requests arrive at once; NULLs don't count,
--    so links a member typed in are unaffected. It also serves the foreign key's lookups.
--  * chat_page_link_reactions: one row per member per emoji per link, with the same four choices
--    as chat messages (and, as there, a member can use several, and can react to their own).
--    Taking a reaction back deletes the row. Removing the link or the member removes the rows.
--  * chat_page_link_reaction_summary(member, links): per link and emoji, the count, whether that
--    member used it, and the first ten names, the shape chat message reactions already use.
--  * Like the other Pages tables (#321), RLS is on with no policies and anon/authenticated get
--    nothing; the routes use the service role after requireChatUser + the member lookup. Only the
--    service role may run the function.
--
-- No existing function changes. Safe to apply before the code ships: the current code never reads
-- the new column or table. The new code hides Save and reactions until this is applied.
--
-- Production when written (2026-10-30): the column, table and function don't exist. Needs #321
-- (20261029120000_chat_pages.sql) first.
-- Rollback: supabase/rollbacks/20261030230000_chat_page_link_saves_reactions.down.sql

alter table public.chat_private_links
 add column saved_from_link_id uuid references public.chat_page_links(id) on delete set null,
 add constraint chat_private_links_one_save_per_link unique(saved_from_link_id, member_id);

create table public.chat_page_link_reactions(
 link_id uuid not null references public.chat_page_links(id) on delete cascade,
 member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
 emoji text not null check(emoji in ('like','heart','laugh','rob')),
 created_at timestamptz not null default now(),
 primary key(link_id, member_id, emoji)
);
create index chat_page_link_reactions_member on public.chat_page_link_reactions(member_id);

create function public.chat_page_link_reaction_summary(p_member uuid, p_links uuid[])
returns table(link_id uuid, emoji text, reaction_count integer, mine boolean, names text[])
language sql stable security invoker set search_path='' as $$
 select r.link_id, r.emoji, count(*)::integer, coalesce(bool_or(r.member_id = p_member), false),
  (array_agg(m.display_name order by m.display_name, r.member_id))[1:10]
  from public.chat_page_link_reactions r
  join public.longboard_chat_members m on m.id = r.member_id
  where r.link_id = any(p_links)
  group by r.link_id, r.emoji
$$;
revoke all on function public.chat_page_link_reaction_summary(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.chat_page_link_reaction_summary(uuid,uuid[]) to service_role;

alter table public.chat_page_link_reactions enable row level security;
revoke all on public.chat_page_link_reactions from public,anon,authenticated,service_role;
grant select,insert,delete on public.chat_page_link_reactions to service_role;
