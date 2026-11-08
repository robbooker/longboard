-- #385 Reader: a Kindle-style book reader inside the chat, for Booker Stock Club members.
--
--  * reader-books: a PRIVATE storage bucket for the book files (EPUB, PDF) and their covers. 50 MB
--    per file, those types only. No storage policies: only the server (service role) signs upload
--    links for admins and short-lived download links for members it has checked.
--  * reader_books: one row per book on the shelf, in `sort` order. `ready` turns true only after the
--    server has checked the uploaded file; `hidden` takes a book off members' shelves (admins still
--    see it). Deleting a book deletes everyone's place in it.
--  * reader_progress: where each chat account is in each book (an EPUB CFI or a PDF page number, and
--    how far through, 0 to 1), so a book opens at the same place on every device.
--  * Both tables: RLS on, no policies; read and written only by /api/chat/reader/* with the service
--    role after the Reader access check (lib/readerAccess.ts).
--
-- Additive: nothing existing changes. Until it is applied the Reader says it is unavailable.
-- Rollback: supabase/rollbacks/20261109110000_reader_books.down.sql

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('reader-books','reader-books',false,52428800,array['application/epub+zip','application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create table public.reader_books(
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(title) between 1 and 200),
 author text not null default '' check(length(author)<=200),
 format text not null check(format in ('epub','pdf')),
 storage_path text not null unique check(storage_path ~ '^books/[0-9a-f-]{36}\.(epub|pdf)$'),
 cover_path text check(cover_path is null or cover_path ~ '^covers/[0-9a-f-]{36}\.(jpg|png|webp)$'),
 byte_size bigint not null check(byte_size between 1 and 52428800),
 sort integer not null default 0,
 hidden boolean not null default false,
 ready boolean not null default false,
 created_by uuid references public.chat_accounts(id) on delete set null,
 created_at timestamptz not null default now()
);
create index reader_books_sort_idx on public.reader_books(sort,created_at);

create table public.reader_progress(
 account_id uuid not null references public.chat_accounts(id) on delete cascade,
 book_id uuid not null references public.reader_books(id) on delete cascade,
 location text not null check(length(location) between 1 and 600),
 percent real not null default 0 check(percent between 0 and 1),
 updated_at timestamptz not null default now(),
 primary key(account_id,book_id)
);
create index reader_progress_book_idx on public.reader_progress(book_id);

alter table public.reader_books enable row level security;
alter table public.reader_progress enable row level security;
revoke all on public.reader_books from public,anon,authenticated,service_role;
revoke all on public.reader_progress from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.reader_books to service_role;
grant select,insert,update,delete on public.reader_progress to service_role;
