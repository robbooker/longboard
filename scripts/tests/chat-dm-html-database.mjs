// D-308: HTML files are DM-only in the database too. Runs against an isolated PostgreSQL
// engine (PGlite); never reads production credentials.
// Usage: node scripts/tests/chat-dm-html-database.mjs
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import('@electric-sql/pglite');
const { vector } = await import('@electric-sql/pglite-pgvector');
const db = new PGlite({ extensions: { vector } });
let checks = 0;
const ok = async (sql, args = []) => (await db.query(sql, args)).rows;
const sqlFile = (path) => readFile(new URL(`../../supabase/${path}`, import.meta.url), 'utf8');
const migrate = async (...files) => { for (const file of files) await db.exec(await sqlFile(`migrations/${file}`)); };
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema extensions;
grant usage on schema extensions to authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth, public to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table public.profiles(id uuid primary key references auth.users(id),email text,role text);
grant select on public.profiles to service_role;
alter default privileges in schema public grant all on tables to service_role;
create publication supabase_realtime;
`);
await migrate('20260827135528_public_chat_guest_room.sql', '20260901125001_longboard_chat_admin_buddy.sql', '20260915115419_chat_member_direct_messages.sql');
const users = [randomUUID(), randomUUID()];
for (const [i, id] of users.entries()) {
  await ok('insert into auth.users values($1)', [id]);
  await ok("insert into profiles values($1,$2,'user')", [id, `html${i}@example.invalid`]);
}
await migrate('20260915204338_chat_social_room.sql', '20260915225504_member_chat_search.sql', '20260915231144_chat_semantic_search.sql', '20260915232125_chat_shortscout_admin_room.sql', '20260916142421_shared_chat_login.sql', '20260917231136_chat_dm_message_actions.sql');
await db.exec('create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
await migrate('20260917030546_chat_attachments.sql', '20260918001755_chat_dm_media.sql', '20260918182625_chat_voice_messages.sql', '20260919002508_chat_attachment_previews.sql');

// Before the migration the database refuses HTML everywhere.
const members = [];
for (const [i, id] of users.entries()) members.push((await ok('select longboard_chat_link_member($1,$2,null) as m', [id, `Member ${i}`]))[0].m);
const act = async (u, a, target, body = null) => (await ok('select longboard_chat_dm_action($1,$2,$3,$4,$5) as r', [u, a, target, body, randomUUID()]))[0].r;
const c = (await act(users[0], 'request', members[1].id, 'Hello')).conversationId;
await act(users[1], 'accept', c);
const reserveDm = (name = 'report.html', mime = 'text/html') => ok("select to_jsonb(reserve_chat_dm_attachment($1,$2,$3,$4,1200)) as f", [members[0].id, c, name, mime]).then((r) => r[0].f);
const reserveRoom = (mime = 'text/html') => ok("select reserve_chat_attachment($1,'main','page.html',$2,1200) as f", [members[0].id, mime]).then((r) => r[0].f);
await assert.rejects(reserveDm(), /mime_type_check/); checks++;

await migrate('20261026120000_chat_dm_html_files.sql');
const bucket = async () => (await ok("select allowed_mime_types from storage.buckets where id='chat-attachments'"))[0].allowed_mime_types;
assert.deepEqual(await bucket(), ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'audio/wav', 'image/webp', 'text/html']); checks++;
// Re-running the bucket update never duplicates the type.
await db.exec("update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'text/html') where id='chat-attachments' and not ('text/html'=any(allowed_mime_types));");
assert.equal((await bucket()).filter((t) => t === 'text/html').length, 1); checks++;

// DM: reserve, scan result, bind to a DM message.
const file = await reserveDm();
assert.equal(file.mime_type, 'text/html'); assert.equal(file.conversation_id, c); checks += 2;
await ok("update chat_attachments set status='ready',object_path=$2,sha256='hash' where id=$1", [file.id, 'clean/' + file.id]);
await ok("select longboard_chat_dm_media_send($1,'send',$2,'',$3,$4)", [users[0], c, randomUUID(), [file.id]]);
assert.equal((await ok('select status from chat_attachments where id=$1', [file.id]))[0].status, 'attached'); checks++;
assert.equal((await ok("select to_jsonb(reserve_chat_dm_attachment($1,$2,'old.HTM','text/html',10000000)) as f", [members[0].id, c]))[0].f.byte_size, 10000000); checks++;
await assert.rejects(reserveDm('big.html').then(() => ok("update chat_attachments set byte_size=10000001 where filename='big.html'")), /byte_size_check/); checks++;

// Rooms: refused at reservation, and a row can never be moved into a room.
await assert.rejects(reserveRoom(), /chat_attachment_html_dm_only/); checks++;
await assert.rejects(ok("update chat_attachments set conversation_id=null,room_slug='main' where id=$1", [file.id]), /chat_attachment_html_dm_only|chat_attachment_message_scope/); checks++;
await assert.rejects(ok("insert into chat_attachments(member_id,room_slug,filename,mime_type,byte_size,upload_path) values($1,'social','x.html','text/html',5,'quarantine/x')", [members[0].id]), /chat_attachment_html_dm_only/); checks++;
// Other room files are unaffected; unknown types still refused.
assert.equal((await reserveRoom('application/pdf')).mime_type, 'application/pdf'); checks++;
await assert.rejects(reserveDm('x.svg', 'image/svg+xml'), /mime_type_check/); checks++;

// Rollback restores the old shape (and removes HTML rows first so it can).
await db.exec(await sqlFile('rollbacks/20261026120000_chat_dm_html_files.down.sql'));
assert.equal((await ok("select count(*)::int n from chat_attachments where mime_type='text/html'"))[0].n, 0); checks++;
assert.ok(!(await bucket()).includes('text/html')); checks++;
await assert.rejects(reserveDm(), /mime_type_check/); checks++;
await migrate('20261026120000_chat_dm_html_files.sql');
assert.equal((await reserveDm()).mime_type, 'text/html'); checks++;
await db.close();
console.log(`PASS ${checks} DM HTML database assertions: DM-only HTML type, bucket list, size limit, room refusal, rollback and re-apply.`);
