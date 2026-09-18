// Runs against an isolated PostgreSQL engine; never reads production credentials.
// Usage: node scripts/tests/chat-dm-directory-database.mjs
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import('@electric-sql/pglite');
const { vector } = await import("@electric-sql/pglite-pgvector");
const db = new PGlite({extensions:{vector}});
let checks = 0;
async function ok(sql, args = []) { return (await db.query(sql, args)).rows; }
async function denied(sql, args, match) {
  await assert.rejects(() => db.query(sql,args), match); checks++;
}
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create schema extensions;
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
for (const file of [
  '20260827135528_public_chat_guest_room.sql',
  '20260901125001_longboard_chat_admin_buddy.sql',
  '20260915115419_chat_member_direct_messages.sql',
]) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
const users = [randomUUID(),randomUUID(),randomUUID()];
for (const [i,id] of users.entries()) {
  await ok('insert into auth.users values($1)',[id]);
  await ok('insert into profiles values($1,$2,\'user\')',[id,`test${i}@example.invalid`]);
}
for (const file of ['20260915204338_chat_social_room.sql','20260915225504_member_chat_search.sql','20260915231144_chat_semantic_search.sql','20260915232125_chat_shortscout_admin_room.sql','20260916142421_shared_chat_login.sql','20260917231136_chat_dm_message_actions.sql']) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/20260918115352_chat_dm_directory.sql',import.meta.url),'utf8'));
await db.exec('set role service_role');
const members=[];
for(const [i,id] of users.entries())members.push((await ok('select longboard_chat_link_member($1,$2,null) as m',[id,`Member ${i}`]))[0].m);
const act=async(u,a,target,body=null,client=randomUUID())=>(await ok('select longboard_chat_dm_action($1,$2,$3,$4,$5) as r',[u,a,target,body,client]))[0].r;
const mutate=async(u,c,m,a,revision,body=null)=>(await ok('select longboard_chat_dm_message_action($1,$2,$3,$4,$5,$6) as r',[u,c,m,a,revision,body]))[0].r.message;

const directory=async(user=users[0],query='Member')=>ok('select * from longboard_chat_dm_directory($1,$2)',[user,query]);
assert.deepEqual((await directory()).map(row=>row.id),[members[1].id,members[2].id]);checks++;
assert.equal((await ok('select count(*)::int n from longboard_chat_messages where member_id=$1',[members[1].id]))[0].n,0);checks++;
assert.deepEqual(Object.keys((await directory())[0]).sort(),['display_name','id']);checks++;
await denied('select * from longboard_chat_dm_directory($1,$2)',[randomUUID(),'Member'],/member_required/);
for(const query of [null,'','x','x'.repeat(29)])await denied('select * from longboard_chat_dm_directory($1,$2)',[users[0],query],/invalid_query/);
await ok('update longboard_chat_members set accepts_requests=false where id=$1',[members[1].id]);assert.deepEqual((await directory()).map(row=>row.id),[members[2].id]);checks++;
// Existing pending/accepted relationships remain discoverable after opting out.
await ok('update longboard_chat_members set accepts_requests=true where id=$1',[members[1].id]);
const conversation=(await act(users[0],'request',members[1].id,'Hello')).conversationId;
await ok('update longboard_chat_members set accepts_requests=false where id=$1',[members[1].id]);assert.ok((await directory()).some(row=>row.id===members[1].id));checks++;
await act(users[1],'accept',conversation);assert.ok((await directory()).some(row=>row.id===members[1].id));checks++;
await act(users[0],'block',conversation);assert.ok(!(await directory()).some(row=>row.id===members[1].id));checks++;
await act(users[0],'unblock',conversation);await act(users[1],'block',conversation);assert.ok(!(await directory()).some(row=>row.id===members[1].id));checks++;
await act(users[1],'unblock',conversation);
const declined=(await act(users[0],'request',members[2].id,'Hello')).conversationId;await act(users[2],'decline',declined);assert.ok(!(await directory()).some(row=>row.id===members[2].id));checks++;
await ok("update longboard_chat_members set display_name='Literal_Name' where id=$1",[members[1].id]);
assert.equal((await directory(users[0],'al_N')).length,1);assert.equal((await directory(users[0],'alXN')).length,0);assert.equal((await directory(users[0],'%%')).length,0);checks+=3;
// The bound applies after eligibility filtering, and ordering is stable.
await db.exec('reset role');
for(let i=25;i>=0;i--){const user=randomUUID();await ok('insert into auth.users values($1)',[user]);await ok("insert into profiles values($1,$2,'user')",[user,`extra${i}@example.invalid`]);await ok('select longboard_chat_link_member($1,$2,null)',[user,`Directory ${String(i).padStart(2,'0')}`]);}
await db.exec('set role service_role');
const first=await directory(users[0],'Directory');assert.equal(first.length,20);assert.equal(first[0].display_name,'Directory 00');assert.equal(first.at(-1).display_name,'Directory 19');assert.deepEqual(await directory(users[0],'Directory'),first);checks+=4;
await ok("update longboard_chat_members set accepts_requests=false where display_name in ('Directory 00','Directory 01','Directory 02','Directory 03')");
const filtered=await directory(users[0],'Directory');assert.equal(filtered.length,20);assert.equal(filtered[0].display_name,'Directory 04');assert.equal(filtered.at(-1).display_name,'Directory 23');checks+=3;
const before=(await ok('select count(*)::int n from longboard_chat_conversations'))[0].n;await directory(users[0],'Directory');assert.equal((await ok('select count(*)::int n from longboard_chat_conversations'))[0].n,before);checks++;
await db.exec('reset role;set role authenticated');await denied('select * from longboard_chat_dm_directory($1,$2)',[users[0],'Member'],/permission denied/);
await db.exec('reset role;set role anon');await denied('select * from longboard_chat_dm_directory($1,$2)',[users[0],'Member'],/permission denied/);
await db.close();console.log(`PASS ${checks} directory SQL assertions: no-history names, blocks, opt-out, declined, bounds, literal matching, ordering, read-only and grants.`);
