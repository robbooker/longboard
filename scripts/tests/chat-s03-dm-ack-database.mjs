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

await db.exec('reset role');
await db.exec(await readFile(new URL('../../supabase/migrations/20260918211147_chat_s03_dm_ack.sql',import.meta.url),'utf8'));
await db.exec('set role service_role');
const ack=async(u,action,target,body,client=randomUUID(),files=[])=>(await ok('select send_chat_dm_ack($1,$2,$3,$4,$5,$6) r',[u,action,target,body,client,files]))[0].r;
const act=async(u,a,target)=>(await ok('select longboard_chat_dm_action($1,$2,$3) r',[u,a,target]))[0].r;
const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const client=randomUUID();const first=await ack(users[0],'request',members[1].id,'Hello',client);
check(first.message.body,'Hello');check(first.message.client_id,client);check(first.message.sender_id,members[0].id);
check(await ack(users[0],'request',members[1].id,'Hello',client),first);
check((await ack(users[0],'request',members[1].id,'Do not insert another')).message,null);
await assert.rejects(ack(users[0],'send',first.conversationId,'Unaccepted'),/request_not_accepted/);checks++;
await act(users[1],'accept',first.conversationId);
const id=randomUUID();const sent=await ack(users[0],'send',first.conversationId,'A message',id);
check(await ack(users[0],'send',first.conversationId,'A message',id),sent);
check((await ok('select count(*)::int n from longboard_chat_direct_messages where client_id=$1',[id]))[0].n,1);
await assert.rejects(ack(users[0],'send',first.conversationId,'Changed',id),/invalid_client_id/);checks++;
await assert.rejects(ack(users[2],'send',first.conversationId,'Intruder'),/conversation_not_found/);checks++;
await act(users[1],'block',first.conversationId);
await assert.rejects(ack(users[0],'send',first.conversationId,'A message',id),/conversation_unavailable/);checks++;
await act(users[1],'unblock',first.conversationId);
const file=(await ok("select to_jsonb(reserve_chat_dm_attachment($1,$2,'image.png','image/png',100)) f",[members[0].id,first.conversationId]))[0].f;
const mediaId=randomUUID();
await assert.rejects(ack(users[0],'send',first.conversationId,'',mediaId,[file.id]),/attachment_not_ready/);checks++;
check((await ok('select count(*)::int n from longboard_chat_direct_messages where client_id=$1',[mediaId]))[0].n,0);
await ok("update chat_attachments set status='ready',object_path='clean/image',sha256='synthetic' where id=$1",[file.id]);
const media=await ack(users[0],'send',first.conversationId,'',mediaId,[file.id]);check(media.message.body,'');check(media.message.attachment_ids,[file.id]);
check(await ack(users[0],'send',first.conversationId,'',mediaId,[file.id]),media);
check((await ok('select dm_message_id from chat_attachments where id=$1',[file.id]))[0].dm_message_id,media.message.id);
await ok("select longboard_chat_dm_message_action($1,$2,$3,'delete',0,null)",[users[0],first.conversationId,sent.message.id]);
const deleted=await ack(users[0],'send',first.conversationId,'A message',id);check(deleted.message.body,'Message deleted');assert(deleted.message.deleted_at);checks++;
for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await assert.rejects(ack(users[0],'send',first.conversationId,'No direct RPC'),/permission denied/);checks++;}
await db.close();console.log(`PASS ${checks} S03 DM acknowledgement SQL assertions: canonical responses, retry dedupe, null intro ack, scan rollback/binding, blocked/outsider authorization, deleted replay, private RPC grants.`);
