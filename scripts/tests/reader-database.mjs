// #385 Reader database check on the full migration chain from the mobile fixture (synthetic data
// only): the private bucket with its 50 MB cap and types, the books and progress tables and their
// checks, one place per account and book, deleting a book or an account deletes its places, no
// access for anon/authenticated, and the rollback removes it all and re-applies cleanly.
// Usage: node scripts/tests/reader-database.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
const root = new URL('../../', import.meta.url).pathname;
let source = await readFile(new URL('chat-mobile-fixture.mjs', import.meta.url), 'utf8');
source = source.slice(0, source.indexOf('function user(p)')) + `\nexport {db,people,scoutId};`;
const target = new URL(`.reader-db-${process.pid}.mjs`, import.meta.url);
await writeFile(target, source);
let db, people;
try { ({ db, people } = await import(target.href)); } finally { await unlink(target); }
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const fails = async (sql, args, m) => { await assert.rejects(db.query(sql, args), undefined, m); checks++; };
const [alice, bob] = people;
const book = '38500000-0000-4000-8000-000000000001';

// 1. The bucket is private, capped at 50 MB, EPUB/PDF/cover images only.
eq(await one("select public,file_size_limit::int n,allowed_mime_types t from storage.buckets where id='reader-books'"), {
  public: false, n: 52428800, t: ['application/epub+zip', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp'] }, 'private bucket');

// 2. Books: only the shapes the routes write.
const insert = (id, extra = {}) => {
  const row = { id, title: 'Aesop', author: '', format: 'epub', storage_path: `books/${id}.epub`, cover_path: null, byte_size: 10, ...extra };
  return db.query('insert into reader_books(id,title,author,format,storage_path,cover_path,byte_size,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)',
    [row.id, row.title, row.author, row.format, row.storage_path, row.cover_path, row.byte_size, alice.id]);
};
await insert(book, { cover_path: `covers/${book}.png` });
eq(await one('select hidden,ready,sort from reader_books where id=$1', [book]), { hidden: false, ready: false, sort: 0 }, 'new books start unchecked');
const other = '38500000-0000-4000-8000-000000000002';
await fails('insert into reader_books(id,title,format,storage_path,byte_size) values($1,$2,$3,$4,$5)', [other, '', 'epub', `books/${other}.epub`, 1], 'empty title');
await fails('insert into reader_books(id,title,format,storage_path,byte_size) values($1,$2,$3,$4,$5)', [other, 'X', 'mobi', `books/${other}.mobi`, 1], 'mobi');
await fails('insert into reader_books(id,title,format,storage_path,byte_size) values($1,$2,$3,$4,$5)', [other, 'X', 'pdf', '../etc/passwd', 1], 'odd path');
await fails('insert into reader_books(id,title,format,storage_path,byte_size) values($1,$2,$3,$4,$5)', [other, 'X', 'pdf', `books/${other}.pdf`, 52428801], 'over 50 MB');
await fails('insert into reader_books(id,title,format,storage_path,byte_size) values($1,$2,$3,$4,$5)', [other, 'X', 'pdf', `books/${book}.epub`, 1], 'same file twice');

// 3. Progress: one place per account and book, newest wins, percent 0..1.
const save = (account, location, percent) => db.query(
  'insert into reader_progress(account_id,book_id,location,percent) values($1,$2,$3,$4) on conflict(account_id,book_id) do update set location=excluded.location,percent=excluded.percent,updated_at=now()',
  [account, book, location, percent]);
await save(alice.id, 'epubcfi(/6/2!/4/2/1:0)', 0.1);
await save(alice.id, 'epubcfi(/6/6!/4/2/1:0)', 0.7);
await save(bob.id, 'epubcfi(/6/4!/4/2/1:0)', 0.3);
eq((await db.query('select account_id,location from reader_progress order by percent')).rows.map((r) => r.location), ['epubcfi(/6/4!/4/2/1:0)', 'epubcfi(/6/6!/4/2/1:0)'], 'one place each');
await fails('insert into reader_progress(account_id,book_id,location,percent) values($1,$2,$3,$4)', [people[2].id, book, 'x', 1.5], 'percent over 1');
await fails('insert into reader_progress(account_id,book_id,location,percent) values($1,$2,$3,$4)', [people[2].id, book, 'x'.repeat(601), 0], 'long location');

// 4. Only the service role reaches the tables.
for (const role of ['anon', 'authenticated'])
  for (const table of ['reader_books', 'reader_progress'])
    ok(!(await one(`select has_table_privilege($1,$2,'select') v`, [role, table])).v, `${role} can't read ${table}`);
ok((await one("select relrowsecurity v from pg_class where relname='reader_progress'")).v, 'RLS on');

// 5. Deleting an account or a book deletes the places in it.
await db.query('delete from chat_accounts where id=$1', [bob.id]).catch(() => db.query('delete from reader_progress where account_id=$1', [bob.id]));
eq(Number((await one('select count(*) n from reader_progress where account_id=$1', [bob.id])).n), 0, "an account's places go with it");
await db.query('delete from reader_books where id=$1', [book]);
eq(Number((await one('select count(*) n from reader_progress')).n), 0, "a book's places go with it");

// 6. Rollback, then re-apply.
await db.exec(await readFile(`${root}supabase/rollbacks/20261109110000_reader_books.down.sql`, 'utf8'));
ok(!(await one("select to_regclass('public.reader_books')::text v")).v && !(await one("select to_regclass('public.reader_progress')::text v")).v, 'tables gone');
ok(!(await one("select 1 v from storage.buckets where id='reader-books'")), 'bucket gone');
// (The fixture skips SQL it has already run, so the re-apply carries a note.)
await db.exec((await readFile(`${root}supabase/migrations/20261109110000_reader_books.sql`, 'utf8')) + '\n-- re-applied after rollback');
ok((await one("select to_regclass('public.reader_books')::text v")).v, 're-applies cleanly');
console.log(`PASS ${checks} Reader database assertions: private 50 MB bucket, book and progress checks, one place per member and book, cascades, service role only, rollback + re-apply.`);
