// Runs against an isolated PostgreSQL engine; never reads production credentials.
// Checks the sender-only "Make clearer" table: no client access, deletion follows the DM.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import('@electric-sql/pglite');
const { vector } = await import('@electric-sql/pglite-pgvector');
const db = new PGlite({ extensions: { vector } });
let checks = 0;
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const migration = (file) => readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8');
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
for (const file of ['20260827135528_public_chat_guest_room.sql', '20260901125001_longboard_chat_admin_buddy.sql', '20260915115419_chat_member_direct_messages.sql'])
  await db.exec(await migration(file));
// Production DMs are soft-deleted through deleted_at (added by a later migration).
await db.exec('alter table public.longboard_chat_direct_messages add column if not exists deleted_at timestamptz');
await db.exec(await migration('20261007230000_chat_clarity_drafts.sql'));

const users = [randomUUID(), randomUUID()];
for (const [i, id] of users.entries()) {
  await q('insert into auth.users values($1)', [id]);
  await q("insert into profiles values($1,$2,'user')", [id, `test${i}@example.invalid`]);
}
await db.exec('set role service_role');
const members = [];
for (const [i, id] of users.entries()) members.push((await q('select longboard_chat_link_member($1,$2,null) as m', [id, `Member ${i}`]))[0].m.id);
const [conversation] = await q("insert into longboard_chat_conversations(requester_id,recipient_id,status) values($1,$2,'accepted') returning id", [members[0], members[1]]);
const dm = async (body) => (await q('insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values($1,$2,$3,$4) returning id', [conversation.id, members[0], randomUUID(), body]))[0].id;
const draft = (messageId) => q(
  `insert into chat_clarity_drafts(message_id,conversation_id,sender_member_id,original_body,suggested_body,final_body,intent,why_changed,ambiguity_note,used_suggestion,standards_sha256,model)
   values($1,$2,$3,'raw draft','clear version','clear version','intent','why',null,true,repeat('a',64),'claude-opus-5-5')`,
  [messageId, conversation.id, members[0]],
);

const first = await dm('clear version');
await draft(first); checks++;
assert.equal((await q('select count(*)::int n from chat_clarity_drafts'))[0].n, 1); checks++;

// Signed-in users (either participant) have no access at all, even though they can read the DM.
await db.exec('reset role');
for (const sub of users) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${sub}'`);
  await assert.rejects(() => db.query('select * from chat_clarity_drafts'), /permission denied/); checks++;
  await assert.rejects(() => db.query("update chat_clarity_drafts set original_body='x'"), /permission denied/); checks++;
  await db.exec('reset role');
}
assert.equal((await q("select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename='chat_clarity_drafts'"))[0].n, 0); checks++;

// Validation: the original must be present and stay within the DM limit.
await db.exec('set role service_role');
await assert.rejects(() => q(`insert into chat_clarity_drafts(message_id,conversation_id,sender_member_id,original_body,final_body,used_suggestion,standards_sha256,model) values($1,$2,$3,'',$4,false,repeat('a',64),'m')`, [first, conversation.id, members[0], 'x']), /check/); checks++;
await assert.rejects(() => q(`insert into chat_clarity_drafts(message_id,conversation_id,sender_member_id,original_body,final_body,used_suggestion,standards_sha256,model) values($1,$2,$3,'x','y',false,'nothex','m')`, [randomUUID(), conversation.id, members[0]]), /check|foreign key/); checks++;

// Soft-deleting the DM removes its private original; other drafts stay.
const second = await dm('second');
await draft(second);
await q('update longboard_chat_direct_messages set deleted_at=now() where id=$1', [first]);
assert.deepEqual((await q('select message_id from chat_clarity_drafts')).map((r) => r.message_id), [second]); checks++;
// A second update of an already-deleted DM is harmless.
await q('update longboard_chat_direct_messages set deleted_at=now() where id=$1', [first]); checks++;
// Hard deletes cascade.
await q('delete from longboard_chat_direct_messages where id=$1', [second]);
assert.equal((await q('select count(*)::int n from chat_clarity_drafts'))[0].n, 0); checks++;

// The rollback file removes everything it added.
await db.exec('reset role');
await db.exec(await readFile(new URL('../../supabase/rollbacks/20261007230000_chat_clarity_drafts.down.sql', import.meta.url), 'utf8'));
assert.equal((await q("select to_regclass('public.chat_clarity_drafts') as t"))[0].t, null); checks++;
assert.equal((await q("select count(*)::int n from pg_trigger where tgname='chat_clarity_draft_follows_dm_delete'"))[0].n, 0); checks++;
console.log(`PASS ${checks} clarity database checks: no client access for either participant, not in realtime, validation, soft-delete removal, cascade, rollback`);
