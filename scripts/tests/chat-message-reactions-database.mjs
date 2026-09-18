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
await db.exec('reset role');
await db.exec(await readFile(new URL('../../supabase/migrations/20260918182733_chat_message_reaction_choices.sql',import.meta.url),'utf8'));
await db.exec('set role service_role');
const roomId=randomUUID();await ok("insert into longboard_chat_messages(id,guest_id,member_id,author_label,body,room_slug) values($1,$2,$2,'Author','Reaction target','social')",[roomId,members[0].id]);
const react=async(actor,message,emoji='heart',active=true,room='social',conversation=null)=>(await ok('select set_chat_message_reaction($1,$2,$3,$4,$5,$6) r',[users[actor],room,conversation,message,emoji,active]))[0].r;
const read=async(actor,message,room='social',conversation=null)=>(await ok('select read_chat_message_reactions($1,$2,$3,$4) r',[users[actor],room,conversation,[message]]))[0].r[message];
await react(1,roomId,'like');await react(1,roomId,'like');assert.equal((await read(1,roomId))[0].count,1);checks++;
assert.equal((await ok('select active from longboard_chat_reactions where message_id=$1',[roomId]))[0].active,true);checks++;
await react(1,roomId);await react(0,roomId);let hearts=(await read(1,roomId)).find(r=>r.emoji==='heart');assert.equal(hearts.count,2);assert.equal(hearts.mine,true);assert.equal(hearts.names.length,2);checks+=3;
await react(1,roomId,'heart',false);await react(1,roomId,'heart',false);assert.equal((await read(1,roomId)).find(r=>r.emoji==='heart').count,1);checks++;
await denied('select set_chat_message_reaction($1,$2,null,$3,$4,true)',[users[1],'main',roomId,'heart'],/message_not_found/);
await denied('select set_chat_message_reaction($1,$2,null,$3,$4,true)',[users[1],'social',roomId,'evil'],/invalid_reaction/);
await ok("update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$1 where room_slug='social'",[users[0]]);
await assert.rejects(()=>react(1,roomId),/chat_paused/);await assert.rejects(()=>react(1,roomId,'like',false),/chat_paused/);checks+=2;
await ok("update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug='social'");
const c=(await act(users[0],'request',members[1].id,'A DM')).conversationId;
let message=(await ok('select id from longboard_chat_direct_messages where conversation_id=$1',[c]))[0].id;
await assert.rejects(()=>react(1,message,'like',true,null,c),/conversation_unavailable/);checks++;
await act(users[1],'accept',c);
for(const emoji of ['like','heart','laugh']){await react(1,message,emoji,true,null,c);await react(1,message,emoji,true,null,c);}
assert.equal((await read(1,message,null,c)).length,3);assert((await read(1,message,null,c)).every(r=>r.count===1&&r.mine));checks+=2;
await assert.rejects(()=>react(2,message,'heart',true,null,c),/conversation_not_found/);assert.deepEqual(await read(2,message,null,c),[]);checks+=2;
await db.exec('reset role');await ok('delete from profiles where id=$1',[users[1]]);await db.exec('set role service_role');assert.deepEqual(await read(1,message,null,c),[]);await assert.rejects(()=>react(1,message,'heart',true,null,c),/room_forbidden/);checks+=2;
await db.exec('reset role');await ok("insert into profiles values($1,'restored@example.test','user')",[users[1]]);await db.exec('set role service_role');
await assert.rejects(()=>react(1,message,'heart',true,null,randomUUID()),/conversation_not_found/);checks++;
await denied('select read_chat_message_reactions($1,$2,null,$3)',[users[0],'social',Array(101).fill(roomId)],/invalid_target/);
// Both serialization orders: successful reaction then block hides names/counts;
// committed block before a later reaction denies that mutation.
await act(users[0],'block',c);assert.deepEqual(await read(1,message,null,c),[]);assert.deepEqual(await read(1,roomId),[]);checks+=2;
await assert.rejects(()=>react(1,message,'heart',false,null,c),/conversation_unavailable/);await assert.rejects(()=>react(1,roomId),/message_not_found/);checks+=2;
await act(users[0],'unblock',c);
await mutate(users[0],c,message,'delete',0);assert.deepEqual(await read(1,message,null,c),[]);await assert.rejects(()=>react(1,message,'laugh',true,null,c),/message_not_found/);checks+=2;
await ok('delete from longboard_chat_messages where id=$1',[roomId]);assert.equal((await ok('select * from chat_message_reaction_choices where room_message_id=$1',[roomId])).length,0);await assert.rejects(()=>react(1,roomId),/message_not_found/);checks+=2;
for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await denied('select * from chat_message_reaction_choices',[],/permission denied/);await denied("select set_chat_message_reaction($1,null,$2,$3,'heart',true)",[users[1],c,message],/permission denied/);}
await db.close();console.log('PASS',checks,'reaction DB assertions: legacy compatibility, idempotency, author counts, scope, paused/block/delete orderings, participant/privacy and client grants');
