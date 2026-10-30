-- Rollback for 20261030180000_chat_page_suggestions.sql (#329 members suggest pages).
-- Restores enforce_chat_page_link_page() to its #321 body and removes the limit trigger and the new
-- columns. Pending and declined suggestions are deleted FIRST: without the status column they would
-- otherwise show up in everyone's sidebar. Approved pages, including ones that began as suggestions,
-- stay, as do their links.
delete from public.chat_pages where status <> 'approved';

create or replace function public.enforce_chat_page_link_page() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.chat_pages p where p.id=new.page_id and p.kind='links') then
  raise exception 'chat_page_not_a_list' using errcode='23514';
 end if;
 return new;
end $$;

drop trigger if exists chat_page_suggestion_limit on public.chat_pages;
drop function if exists public.enforce_chat_page_suggestion_limit();

alter table public.chat_pages
 drop constraint if exists chat_pages_built_in_approved,
 drop constraint if exists chat_pages_status,
 drop column if exists decided_at,
 drop column if exists decided_by,
 drop column if exists suggested_by,
 drop column if exists status;
