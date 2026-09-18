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
const reserve=async(who=0,conversation=c)=>(await ok("select to_jsonb(reserve_chat_dm_attachment($1,$2,'private.png','image/png',8)) as f",[members[who].id,conversation]))[0].f;
const send=async(files,body='',client=randomUUID(),conversation=c,who=0)=>(await ok("select longboard_chat_dm_media_send($1,'send',$2,$3,$4,$5) as r",[users[who],conversation,body,client,files]))[0].r;
const ready=async(file)=>(await ok("update chat_attachments set status='ready',object_path=$2,sha256='hash' where id=$1 returning *",[file.id,'clean/'+file.id]))[0];
await assert.rejects(reserve(),/request_not_accepted/);checks++;
await act(users[1],'accept',c);await act(users[2],'accept',c2);
await assert.rejects(reserve(2),/conversation_not_found/);checks++;
const file=await reserve();
await assert.rejects(send([file.id]),/attachment_not_ready/);checks++;
assert.equal((await ok('select count(*)::int n from longboard_chat_direct_messages where conversation_id=$1',[c]))[0].n,1);checks++;
await ready(file);
await assert.rejects(send([file.id],'',randomUUID(),c2),/attachment_wrong_conversation/);checks++;
await assert.rejects(send([file.id],'',randomUUID(),c,1),/attachment_not_ready/);checks++;
await assert.rejects(send([file.id,file.id]),/invalid_attachments/);checks++;
const client=randomUUID();await send([file.id],'',client);
let m=(await ok('select * from longboard_chat_direct_messages where client_id=$1',[client]))[0];
assert.equal(m.body,'');assert.deepEqual(m.attachment_ids,[file.id]);checks+=2;
assert.equal((await ok('select status from chat_attachments where id=$1',[file.id]))[0].status,'attached');checks++;
assert.equal((await ok('select longboard_chat_inbox($1) as list',[users[1]]))[0].list.find(x=>x.id===c).lastBody,'[Attachment]');checks++;
await send([file.id],'',client);assert.equal((await ok('select count(*)::int n from longboard_chat_direct_messages where client_id=$1',[client]))[0].n,1);checks++;
await assert.rejects(send([file.id],'changed',client),/invalid_client_id/);checks++;
await assert.rejects(send([file.id]),/attachment_not_ready/);checks++;
const edited=await mutate(users[0],c,m.id,'edit',0,'Caption');assert.deepEqual(edited.attachment_ids,[file.id]);checks++;
await mutate(users[0],c,m.id,'edit',1,'');checks++;
const room=(await ok("select to_jsonb(reserve_chat_attachment($1,'main','room.png','image/png',8)) as f",[members[0].id]))[0].f;await ready(room);
await assert.rejects(send([room.id]),/attachment_wrong_conversation/);checks++;
const f2=await ready(await reserve());
await assert.rejects(ok("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,attachment_ids) values($1,$1,'Alice','File','social',$2)",[members[0].id,[f2.id]]),/attachment_wrong_room/);checks++;
await act(users[1],'block',c);await assert.rejects(reserve(),/conversation_unavailable/);await assert.rejects(send([f2.id]),/conversation_unavailable/);checks+=2;
await mutate(users[0],c,m.id,'delete',2);
assert.equal((await ok('select count(*)::int n from chat_attachments where id=$1',[file.id]))[0].n,0);checks++;
assert.equal((await ok('select count(*)::int n from chat_attachment_deletions where path=$1',['clean/'+file.id]))[0].n,1);checks++;
await act(users[1],'unblock',c);await send([file.id],'',client);
m=(await ok('select * from longboard_chat_direct_messages where id=$1',[m.id]))[0];assert.ok(m.deleted_at);assert.equal(m.body,'Message deleted');checks+=2;
const plainClient=randomUUID();await act(users[0],'send',c,'Text',plainClient);
await assert.rejects(send([f2.id],'Text',plainClient),/invalid_client_id/);checks++;
await db.exec('reset role; set role authenticated');
await assert.rejects(ok('select * from chat_attachments'),/permission denied/);checks++;
await assert.rejects(reserve(),/permission denied/);checks++;
await assert.rejects(send([f2.id]),/permission denied/);checks++;
await db.close();console.log(`PASS ${checks} DM media database assertions: scopes, scan binding, replay, edit, delete cleanup, blocks, and role grants.`);
