-- #329 LB-PAGES-SUGGEST: members suggest pages, admins approve. ("Admins must approve pages but not
-- links": links on a shared list still appear at once, as in #321.)
--
--  * chat_pages.status: 'approved' (in everyone's sidebar), 'pending' (a member's suggestion waiting
--    for an admin) or 'declined'. The default is 'approved', so every existing row stays visible
--    and an admin's new page needs no approval step. Built-in pages are always approved.
--  * suggested_by: the member who suggested it (kept after approval; set null if they leave).
--    decided_by / decided_at: the admin who approved or declined it, and when.
--  * A pending or declined page is seen only by its suggester (in their sidebar, marked) and, while
--    pending, by admins (the waiting list). /api/chat/pages reads only approved pages for the
--    sidebar; the links, likes and share routes treat anything else as not found. A declined row
--    stays until the member dismisses it, so they can see it was declined.
--  * enforce_chat_page_suggestion_limit(): a member can have at most 3 pages waiting, checked here
--    under a per-member lock so parallel requests can't get past it. Admins' pages don't count.
--  * enforce_chat_page_link_page() now also refuses links on a page that isn't approved.
--  * No new tables, policies or grants: like the rest of Pages (#321), RLS is on with no policies
--    and only the service role reads these rows, after requireChatUser + the member lookup.
--
-- Production when written (2026-10-30): the columns don't exist. Needs #321
-- (20261029120000_chat_pages.sql) first. Safe to apply before the code ships: nothing pending can
-- exist until it does, and the existing code ignores the new columns.
-- Rollback: supabase/rollbacks/20261030180000_chat_page_suggestions.down.sql

alter table public.chat_pages
 add column status text not null default 'approved',
 add column suggested_by uuid references public.longboard_chat_members(id) on delete set null,
 add column decided_by uuid references public.longboard_chat_members(id) on delete set null,
 add column decided_at timestamptz,
 add constraint chat_pages_status check(status in ('approved','pending','declined')),
 add constraint chat_pages_built_in_approved check(status='approved' or not built_in);

create function public.enforce_chat_page_suggestion_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('chat_page_suggestions:' || new.suggested_by::text, 0));
 if (select count(*) from public.chat_pages p where p.suggested_by=new.suggested_by and p.status='pending') >= 3 then
  raise exception 'chat_page_suggestion_limit' using errcode='23514';
 end if;
 return new;
end $$;
create trigger chat_page_suggestion_limit before insert on public.chat_pages
 for each row when (new.status='pending' and new.suggested_by is not null)
 execute function public.enforce_chat_page_suggestion_limit();
revoke all on function public.enforce_chat_page_suggestion_limit() from public,anon,authenticated;

-- Links belong only on approved shared list pages (never on an embed, the private list or a suggestion).
create or replace function public.enforce_chat_page_link_page() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.chat_pages p where p.id=new.page_id and p.kind='links' and p.status='approved') then
  raise exception 'chat_page_not_a_list' using errcode='23514';
 end if;
 return new;
end $$;
