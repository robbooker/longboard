-- #406 Reader: EPUB only. Rob: "We never want to try to show people a PDF. We want the reading
-- experience to be perfect." The app already refuses PDFs (Manage books, the upload route, the shelf
-- and /reader/<id>); this makes the database and the bucket refuse them too.
--
--  * reader_books.format: 'epub' only (was 'epub' or 'pdf').
--  * reader_books.storage_path: books/<uuid>.epub only (was .epub or .pdf).
--  * reader-books bucket: EPUB files and the cover images (JPEG, PNG, WebP) only; no application/pdf.
--    Size limit unchanged (50 MB).
--
-- Constraints only: the production shelf is empty, so no rows change. If a PDF row did exist the
-- constraint would fail to add (on purpose: delete it in Manage books first).
-- Rollback: supabase/rollbacks/20261110160000_reader_epub_only.down.sql

alter table public.reader_books drop constraint if exists reader_books_format_check;
alter table public.reader_books add constraint reader_books_format_check check (format = 'epub');

alter table public.reader_books drop constraint if exists reader_books_storage_path_check;
alter table public.reader_books add constraint reader_books_storage_path_check
  check (storage_path ~ '^books/[0-9a-f-]{36}\.epub$');

update storage.buckets
   set allowed_mime_types = array['application/epub+zip','image/jpeg','image/png','image/webp']
 where id = 'reader-books';
