-- #321 LB-PAGES: a "Pages" section in the chat sidebar, below Recordings.
--
--  * chat_pages: one row per page, in sidebar order (position, then created_at). A page is an
--    embedded website ('embed', https only), a shared list of links ('links'), or the built-in
--    private list each trader keeps ('my-links', at most one). Admins add more pages from the
--    chat (/api/chat/pages) with no new code; the three seeded rows below are built in and can't
--    be removed from there.
--  * chat_page_links: links on a shared list page (Trader Links): title, https address, optional
--    one-line note, who added it, and an admin pin. Any member adds; the adder or an admin edits
--    or removes; only admins pin. Removing a page removes its links.
--  * chat_private_links: each trader's My Links. Only the owner ever reads them: the routes always
--    filter by the verified member, and "Share" copies one into chat_page_links.
--  * Like the other chat tables, RLS is on with no policies and anon/authenticated get nothing;
--    the routes use the service role after requireChatUser + the member lookup.
--
-- Production when written (2026-10-29): none of these tables exist.
-- Rollback: supabase/rollbacks/20261029120000_chat_pages.down.sql

create table public.chat_pages(
 id uuid primary key default gen_random_uuid(),
 slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
 name text not null check(char_length(btrim(name)) between 1 and 40),
 kind text not null check(kind in ('embed','links','my-links')),
 embed_url text check(embed_url is null or (embed_url ~ '^https://\S+$' and char_length(embed_url)<=2048)),
 position integer not null default 100,
 built_in boolean not null default false,
 created_by uuid references public.longboard_chat_members(id) on delete set null,
 created_at timestamptz not null default now(),
 constraint chat_pages_embed_url check((kind='embed')=(embed_url is not null))
);
create unique index chat_pages_one_private_list on public.chat_pages(kind) where kind='my-links';

create table public.chat_page_links(
 id uuid primary key default gen_random_uuid(),
 page_id uuid not null references public.chat_pages(id) on delete cascade,
 title text not null check(char_length(btrim(title)) between 1 and 80),
 url text not null check(url ~ '^https://\S+$' and char_length(url)<=2048),
 note text check(note is null or (char_length(btrim(note)) between 1 and 140 and note !~ '[\r\n]')),
 added_by uuid references public.longboard_chat_members(id) on delete set null,
 pinned boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index chat_page_links_page on public.chat_page_links(page_id, pinned desc, created_at desc);
create index chat_page_links_added_by on public.chat_page_links(added_by) where added_by is not null;

create table public.chat_private_links(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
 title text not null check(char_length(btrim(title)) between 1 and 80),
 url text not null check(url ~ '^https://\S+$' and char_length(url)<=2048),
 note text check(note is null or (char_length(btrim(note)) between 1 and 140 and note !~ '[\r\n]')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index chat_private_links_member on public.chat_private_links(member_id, created_at desc);

-- Links belong only on shared list pages (never on an embed or the private list).
create function public.enforce_chat_page_link_page() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.chat_pages p where p.id=new.page_id and p.kind='links') then
  raise exception 'chat_page_not_a_list' using errcode='23514';
 end if;
 return new;
end $$;
create trigger chat_page_link_page_guard before insert or update of page_id on public.chat_page_links
 for each row execute function public.enforce_chat_page_link_page();
revoke all on function public.enforce_chat_page_link_page() from public,anon,authenticated;

alter table public.chat_pages enable row level security;
alter table public.chat_page_links enable row level security;
alter table public.chat_private_links enable row level security;
revoke all on public.chat_pages,public.chat_page_links,public.chat_private_links from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.chat_pages,public.chat_page_links,public.chat_private_links to service_role;

insert into public.chat_pages(slug,name,kind,embed_url,position,built_in) values
 ('market-dashboard','Market Dashboard','embed','https://dashboard.robbooker.com',10,true),
 ('trader-links','Trader Links','links',null,20,true),
 ('my-links','My Links','my-links',null,30,true);
