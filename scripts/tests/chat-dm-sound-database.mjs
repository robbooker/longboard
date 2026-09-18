// Runs against an isolated PostgreSQL engine; never reads production credentials.
// Usage: node scripts/tests/chat-dm-media-database.mjs
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import('@electric-sql/pglite');
const { vector } = await import("@electric-sql/pglite-pgvector");
const db = new PGlite({extensions:{vector}});
let checks = 0;
async function ok(sql, args = []) { return (await db.query(sql, args)).rows; }
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
await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
for(const file of ['20260917030546_chat_attachments.sql','20260918001755_chat_dm_media.sql'])await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
await db.exec('set role service_role');
const members=[];
for(const [i,id] of users.entries())members.push((await ok('select longboard_chat_link_member($1,$2,null) as m',[id,`Member ${i}`]))[0].m);
const act=async(u,a,target,body=null,client=randomUUID())=>(await ok('select longboard_chat_dm_action($1,$2,$3,$4,$5) as r',[u,a,target,body,client]))[0].r;
const mutate=async(u,c,m,a,revision,body=null)=>(await ok('select longboard_chat_dm_message_action($1,$2,$3,$4,$5,$6) as r',[u,c,m,a,revision,body]))[0].r.message;

const c=(await act(users[0],'request',members[1].id,'Hello')).conversationId;
const c2=(await act(users[0],'request',members[2].id,'Hello too')).conversationId;
await db.exec('reset role');await db.exec(await readFile(new URL('../../supabase/migrations/20260918172508_chat_dm_sound_cursor.sql',import.meta.url),'utf8'));await db.exec('set role service_role');
const inbox=async(user)=>(await ok('select longboard_chat_inbox($1) as list',[user]))[0].list;
const cursor=async(user,conversation)=>(await inbox(user)).find(row=>row.id===conversation)?.latestIncomingSeq;
assert.equal(await cursor(users[0],c),0);checks++;
const initial=await cursor(users[1],c);assert.ok(initial>0);checks++;
assert.equal((await inbox(users[2])).some(row=>row.id===c),false);checks++;
await act(users[1],'accept',c);await act(users[0],'send',c,'Second');const second=await cursor(users[1],c);assert.ok(second>initial);checks++;
await act(users[1],'send',c,'Own reply');assert.equal(await cursor(users[1],c),second);checks++;
const incoming=(await ok('select id,revision from longboard_chat_direct_messages where seq=$1',[second]))[0];
await mutate(users[0],c,incoming.id,'edit',incoming.revision,'Edited');assert.equal(await cursor(users[1],c),second);checks++;
await mutate(users[0],c,incoming.id,'delete',incoming.revision+1);assert.equal(await cursor(users[1],c),initial);checks++;
for(const user of [users[0],users[1]]){await act(user,'block',c);assert.equal(await cursor(users[0],c),0);assert.equal(await cursor(users[1],c),0);checks+=2;await act(user,'unblock',c);}
await act(users[2],'decline',c2);assert.equal(await cursor(users[2],c2),0);checks++;
await db.exec('reset role;set role authenticated');await assert.rejects(()=>inbox(users[0]),/permission denied/);checks++;
await db.exec('reset role;set role anon');await assert.rejects(()=>inbox(users[0]),/permission denied/);checks++;
await db.close();console.log(`PASS ${checks} DM sound cursor privacy and arrival assertions`);
