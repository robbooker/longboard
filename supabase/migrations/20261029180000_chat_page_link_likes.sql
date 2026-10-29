-- #323 LB-PAGES-LIKES: likes rank the links on a shared list page (Trader Links), like Reddit.
--
--  * chat_page_link_likes: one row per member per link they like (primary key link_id+member_id,
--    so a second like is a no-op). Removing the link or the member removes their likes.
--  * Members can't like their own link, and only links on a shared list ('links') page can be
--    liked: /api/chat/pages/links/likes checks both before writing, and the trigger below refuses
--    them too.
--  * chat_page_link_like_summary(page, member[, link]): per link on a page that has any likes,
--    its like count and whether that member likes it. One grouped read through the primary key,
--    alongside the existing list query; links with no likes are simply absent (count 0).
--  * Like the other Pages tables (#321), RLS is on with no policies and anon/authenticated get
--    nothing; the routes use the service role after requireChatUser + the member lookup. Only the
--    service role may run the function.
--
-- Production when written (2026-10-29): the table and function don't exist. Needs #321
-- (20261029120000_chat_pages.sql) first.
-- Rollback: supabase/rollbacks/20261029180000_chat_page_link_likes.down.sql

create table public.chat_page_link_likes(
 link_id uuid not null references public.chat_page_links(id) on delete cascade,
 member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(link_id, member_id)
);
create index chat_page_link_likes_member on public.chat_page_link_likes(member_id);

-- Only links on a shared list, and never your own.
create function public.enforce_chat_page_link_like() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
 link_page_kind text;
 link_added_by uuid;
begin
 select p.kind, l.added_by into link_page_kind, link_added_by
  from public.chat_page_links l join public.chat_pages p on p.id = l.page_id
  where l.id = new.link_id;
 if link_page_kind is distinct from 'links' then
  raise exception 'chat_page_link_not_on_a_list' using errcode='23514';
 end if;
 if link_added_by = new.member_id then
  raise exception 'chat_page_link_own_like' using errcode='23514';
 end if;
 return new;
end $$;
create trigger chat_page_link_like_guard before insert or update on public.chat_page_link_likes
 for each row execute function public.enforce_chat_page_link_like();
revoke all on function public.enforce_chat_page_link_like() from public,anon,authenticated;

create function public.chat_page_link_like_summary(p_page uuid, p_member uuid, p_link uuid default null)
returns table(link_id uuid, like_count integer, liked_by_me boolean)
language sql stable security invoker set search_path='' as $$
 select k.link_id, count(*)::integer, coalesce(bool_or(k.member_id = p_member), false)
  from public.chat_page_links l
  join public.chat_page_link_likes k on k.link_id = l.id
  where l.page_id = p_page and (p_link is null or l.id = p_link)
  group by k.link_id
$$;
revoke all on function public.chat_page_link_like_summary(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_page_link_like_summary(uuid,uuid,uuid) to service_role;

alter table public.chat_page_link_likes enable row level security;
revoke all on public.chat_page_link_likes from public,anon,authenticated,service_role;
grant select,insert,delete on public.chat_page_link_likes to service_role;
