// Runs against an isolated PostgreSQL engine; never reads production credentials.
// Usage: npm run test:chat-db
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
await db.exec('set role service_role');
const members=[];
for(const [i,id] of users.entries())members.push((await ok('select longboard_chat_link_member($1,$2,null) as m',[id,`Member ${i}`]))[0].m);
const act=async(u,a,target,body=null,client=randomUUID())=>(await ok('select longboard_chat_dm_action($1,$2,$3,$4,$5) as r',[u,a,target,body,client]))[0].r;
const mutate=async(u,c,m,a,revision,body=null)=>(await ok('select longboard_chat_dm_message_action($1,$2,$3,$4,$5,$6) as r',[u,c,m,a,revision,body]))[0].r.message;
const sendId=randomUUID(),c=(await act(users[0],'request',members[1].id,'Original request',sendId)).conversationId;
let msg=(await ok('select * from longboard_chat_direct_messages where conversation_id=$1',[c]))[0];
const first=await mutate(users[0],c,msg.id,'edit',0,'Edited pending request');assert.equal(first.body,'Edited pending request');assert.ok(first.edited_at);assert.equal(first.revision,1);checks+=3;
assert.deepEqual(await mutate(users[0],c,msg.id,'edit',0,'Edited pending request'),first);checks++;
await assert.rejects(()=>mutate(users[0],c,msg.id,'edit',0,'Stale overwrite'),/message_changed/);checks++;
await assert.rejects(()=>mutate(users[1],c,msg.id,'edit',1,'Other member'),/message_not_found/);checks++;
await assert.rejects(()=>mutate(users[1],c,msg.id,'delete',1),/message_not_found/);checks++;
await assert.rejects(()=>mutate(users[2],c,msg.id,'delete',1),/conversation_not_found/);checks++;
const c2=(await act(users[0],'request',members[2].id,'Second conversation')).conversationId;
await assert.rejects(()=>mutate(users[0],c2,msg.id,'delete',1),/message_not_found/);checks++;
for(const body of ['', ' '.repeat(5), 'x'.repeat(2001)]){await assert.rejects(()=>mutate(users[0],c,msg.id,'edit',1,body),/invalid_message/);checks++;}
await assert.rejects(()=>mutate(users[0],c,msg.id,'edit',null,'x'),/invalid_revision/);checks++;
await act(users[1],'accept',c);
let list=(await ok('select longboard_chat_inbox($1) as list',[users[1]]))[0].list;assert.equal(list.find(x=>x.id===c).lastBody,'Edited pending request');checks++;
await act(users[1],'block',c);
await assert.rejects(()=>mutate(users[0],c,msg.id,'edit',1,'Blocked edit'),/conversation_unavailable/);checks++;
await assert.rejects(()=>mutate(users[0],c,msg.id,'delete',0),/message_changed/);checks++;
const deleted=await mutate(users[0],c,msg.id,'delete',1);assert.equal(deleted.body,'Message deleted');assert.ok(deleted.deleted_at);assert.equal(deleted.seq,first.seq);checks+=3;
assert.deepEqual(await mutate(users[0],c,msg.id,'delete',1),deleted);checks++;
await assert.rejects(()=>mutate(users[0],c,msg.id,'edit',2,'Resurrect'),/message_deleted/);checks++;
await act(users[1],'unblock',c);
await act(users[0],'send',c,'Replay deleted text',sendId);
assert.equal((await ok('select body from longboard_chat_direct_messages where id=$1',[msg.id]))[0].body,'Message deleted');checks++;
assert.equal((await ok('select count(*)::int n from longboard_chat_direct_messages where sender_id=$1 and client_id=$2',[members[0].id,sendId]))[0].n,1);checks++;
list=(await ok('select longboard_chat_inbox($1) as list',[users[1]]))[0].list;assert.equal(list.find(x=>x.id===c).lastBody,'Message deleted');checks++;
await act(users[1],'read',c,null,msg.id);assert.equal((await ok('select longboard_chat_inbox($1) as list',[users[1]]))[0].list.find(x=>x.id===c).unread,0);checks++;
await act(users[2],'decline',c2);
const closed=(await ok('select id from longboard_chat_direct_messages where conversation_id=$1',[c2]))[0].id;
await assert.rejects(()=>mutate(users[0],c2,closed,'edit',0,'Closed edit'),/conversation_unavailable/);checks++;
assert.equal((await mutate(users[0],c2,closed,'delete',0)).body,'Message deleted');checks++;
await assert.rejects(()=>mutate(randomUUID(),c,msg.id,'delete',2),/member_required/);checks++;
const security=(await ok("select prosecdef,proconfig from pg_proc where proname='longboard_chat_dm_message_action'"))[0];assert.equal(security.prosecdef,false);assert.ok(security.proconfig.some(x=>x.startsWith('search_path=')));checks+=2;
await db.exec('reset role;set role authenticated');await ok("select set_config('request.jwt.claim.sub',$1,false)",[users[0]]);
await denied('select longboard_chat_dm_message_action($1,$2,$3,$4,$5,$6)',[users[0],c,msg.id,'delete',2,null],/permission denied/);
await denied("update longboard_chat_direct_messages set body='Bypass' where id=$1",[msg.id],/permission denied/);
assert.equal((await ok('select body from longboard_chat_direct_messages where id=$1',[msg.id]))[0].body,'Message deleted');checks++;
await db.exec('reset role;set role anon');await denied('select longboard_chat_dm_message_action($1,$2,$3,$4,$5,$6)',[users[0],c,msg.id,'delete',2,null],/permission denied/);
console.log(`PASS ${checks} DM message-action database assertions: ownership, scope, CAS/replay, blocked edit/delete, tombstone, previews, read seq and grants.`);await db.close();
