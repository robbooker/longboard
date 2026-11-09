-- Rollback for 20261110160000_reader_epub_only.sql (#406 Reader: EPUB only).
-- Puts back exactly what 20261109110000_reader_books.sql set: EPUB or PDF in reader_books and in the
-- reader-books bucket. (The app code from #406 still shows EPUBs only.)

alter table public.reader_books drop constraint if exists reader_books_format_check;
alter table public.reader_books add constraint reader_books_format_check check (format in ('epub','pdf'));

alter table public.reader_books drop constraint if exists reader_books_storage_path_check;
alter table public.reader_books add constraint reader_books_storage_path_check
  check (storage_path ~ '^books/[0-9a-f-]{36}\.(epub|pdf)$');

update storage.buckets
   set allowed_mime_types = array['application/epub+zip','application/pdf','image/jpeg','image/png','image/webp']
 where id = 'reader-books';
