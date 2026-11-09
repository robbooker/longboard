-- Rollback for 20261109110000_reader_books.sql (#385 Reader). Every book row and every member's
-- saved place are lost.
--
-- The book files are NOT removed by this script: Supabase does not allow deleting storage objects
-- with SQL. Before running it, empty the reader-books bucket (Dashboard > Storage > reader-books >
-- select all > Delete, or storage.from('reader-books').remove(...) with the service role). The last
-- statement then removes the empty bucket; it fails harmlessly if files are still in it.
drop table if exists public.reader_progress;
drop table if exists public.reader_books;
delete from storage.buckets where id='reader-books';
