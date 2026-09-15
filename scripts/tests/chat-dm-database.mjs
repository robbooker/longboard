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
await db.exec('set role service_role');
const members=[];
for (const [i,id] of users.entries()) members.push((await ok('select longboard_chat_link_member($1,$2,null) as m',[id,`Member ${i}`]))[0].m);
assert.equal((await ok('select longboard_chat_link_member($1,$2,null) as m',[users[0],'Another name']))[0].m.id,members[0].id); checks++;
const act = async (u,action,target=null,body=null,client=randomUUID(),value=null) => (await ok('select longboard_chat_dm_action($1,$2,$3,$4,$5,$6) as result',[u,action,target,body,client,value]))[0].result;
const requestClient=randomUUID();
const conversation=(await act(users[0],'request',members[1].id,'Hello privately',requestClient)).conversationId;
assert.equal((await act(users[0],'request',members[1].id,'Hello privately',requestClient)).conversationId,conversation); checks++;
assert.equal((await act(users[1],'request',members[0].id,'Opposite request')).conversationId,conversation); checks++;
assert.equal((await ok('select count(*)::int as n from longboard_chat_direct_messages'))[0].n,1); checks++;
await assert.rejects(()=>act(users[0],'send',conversation,'Not accepted'),/request_not_accepted/); checks++;
await assert.rejects(()=>act(users[0],'accept',conversation),/request_not_pending/); checks++;
await assert.rejects(()=>act(users[2],'accept',conversation),/conversation_not_found/); checks++;
await assert.rejects(()=>act(users[2],'read',conversation),/conversation_not_found/); checks++;
await assert.rejects(()=>act(users[0],'request',members[0].id,'Self'),/invalid_recipient/); checks++;
// Real RLS reads, including direct Data API-style table access.
await db.exec('reset role; set role authenticated');
await ok("select set_config('request.jwt.claim.sub',$1,false)",[users[2]]);
assert.equal((await ok('select * from longboard_chat_conversations')).length,0); checks++;
assert.equal((await ok('select * from longboard_chat_direct_messages')).length,0); checks++;
assert.equal((await ok('select * from longboard_chat_members')).length,1); checks++;
await denied('select longboard_chat_dm_action($1,\'accept\',$2)',[users[1],conversation],/permission denied/);
await denied('select longboard_chat_inbox($1)',[users[1]],/permission denied/);
await denied('select longboard_chat_link_member($1,\'fake\',null)',[users[1]],/permission denied/);
await denied('insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values($1,$2,$3,\'forged\')',[conversation,members[0].id,randomUUID()],/permission denied/);
await denied('update longboard_chat_conversations set status=\'accepted\' where id=$1',[conversation],/permission denied/);
await denied('delete from longboard_chat_direct_messages where conversation_id=$1',[conversation],/permission denied/);
await ok("select set_config('request.jwt.claim.sub',$1,false)",[users[1]]);
assert.equal((await ok('select * from longboard_chat_direct_messages')).length,1); checks++;
await db.exec('reset role; set role anon');
await denied('select * from longboard_chat_direct_messages',[],/permission denied/);
await denied('select * from longboard_chat_members',[],/permission denied/);
await db.exec('reset role; set role service_role');
await act(users[1],'accept',conversation);
const replyClient=randomUUID();
await act(users[1],'send',conversation,'Accepted reply',replyClient);
await act(users[1],'send',conversation,'Accepted reply',replyClient);
assert.equal((await ok('select count(*)::int as n from longboard_chat_direct_messages'))[0].n,2); checks++;
let list=(await ok('select longboard_chat_inbox($1) as list',[users[0]]))[0].list;
assert.equal(list[0].unread,1); checks++;
const last=(await ok('select id from longboard_chat_direct_messages order by seq desc limit 1'))[0].id;
await act(users[0],'read',conversation,null,last);
list=(await ok('select longboard_chat_inbox($1) as list',[users[0]]))[0].list;
assert.equal(list[0].unread,0); checks++;
await act(users[1],'block',conversation);
await assert.rejects(()=>act(users[0],'send',conversation,'Blocked'),/conversation_unavailable/); checks++;
await assert.rejects(()=>act(users[1],'send',conversation,'Also blocked'),/conversation_unavailable/); checks++;
await act(users[0],'unblock',conversation); // Cannot undo the other participant's block.
await assert.rejects(()=>act(users[0],'send',conversation,'Still blocked'),/conversation_unavailable/); checks++;
await act(users[1],'unblock',conversation);
await act(users[0],'send',conversation,'Unblocked');
await act(users[1],'report',conversation,'Test report');
assert.equal((await ok('select count(*)::int as n from longboard_chat_reports'))[0].n,1); checks++;
await assert.rejects(()=>act(users[2],'report',conversation,'Outsider'),/conversation_not_found/); checks++;
await act(users[2],'settings',null,null,null,false);
await assert.rejects(()=>act(users[0],'request',members[2].id,'Disabled'),/requests_unavailable/); checks++;
await act(users[2],'settings',null,null,null,true);
const declined=(await act(users[0],'request',members[2].id,'Request to decline')).conversationId;
await act(users[2],'decline',declined);
await assert.rejects(()=>act(users[0],'send',declined,'After decline'),/request_not_accepted/); checks++;
assert.equal((await act(users[0],'request',members[2].id,'Try again')).conversationId,declined); checks++;
await assert.rejects(()=>act(users[2],'accept',declined),/request_not_pending/); checks++;
// Existing guest identity is linked atomically; its old token is retired.
await db.exec('reset role');
const fourth=randomUUID(); const hash='a'.repeat(64);
await ok('insert into auth.users values($1)',[fourth]); await ok("insert into profiles values($1,'fourth@example.invalid','user')",[fourth]);
const guest=(await ok('insert into longboard_chat_guests(token_hash,display_name) values($1,\'Guest\') returning id',[hash]))[0].id;
await db.exec('set role service_role');
const linked=(await ok('select longboard_chat_link_member($1,\'Linked\',$2) as m',[fourth,hash]))[0].m;
assert.equal(linked.id,guest); checks++;
assert.equal((await ok('select * from longboard_chat_guests where token_hash=$1',[hash])).length,0); checks++;
// Fresh receipts must survive a late acknowledgement of an older message.
await act(users[1],'send',conversation,'A new unread reply');
await act(users[0],'read',conversation,null,last);
assert.equal((await ok('select longboard_chat_inbox($1) as list',[users[0]]))[0].list.find(c=>c.id===conversation).unread,1); checks++;
await assert.rejects(()=>act(users[1],'send',conversation,'x'.repeat(2001)),/invalid_message/); checks++;
// A declined request does not count as unread.
assert.equal((await ok('select longboard_chat_inbox($1) as list',[users[2]]))[0].list[0].unread,0); checks++;
// Each recipient gets only one opening request and senders have a daily cap.
await db.exec('reset role');
const recipients=[];
for(let i=0;i<11;i++) {
 const id=randomUUID();
 await ok('insert into auth.users values($1)',[id]);
 await ok('insert into profiles values($1,$2,\'user\')',[id,`recipient${i}@example.invalid`]);
 recipients.push((await ok('select longboard_chat_link_member($1,$2,null) as m',[id,`Recipient ${i}`]))[0].m.id);
}
await db.exec('set role service_role');
for(const recipient of recipients.slice(0,10)) await act(fourth,'request',recipient,'Opening request');
await assert.rejects(()=>act(fourth,'request',recipients[10],'Over request cap'),/request_rate_limited/); checks++;

// Account names cannot impersonate another linked member, including case variants.
await db.exec('reset role');
const duplicate=randomUUID();
await ok('insert into auth.users values($1)',[duplicate]);
await ok('insert into profiles values($1,$2,\'user\')',[duplicate,'duplicate@example.invalid']);
await db.exec('set role service_role');
await denied('select longboard_chat_link_member($1,\'member 0\',null)',[duplicate],/longboard_chat_member_name_idx/);
// Daily request limits and message limits cannot be bypassed with another client ID.
await db.exec('reset role');
await ok("insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) select $1,$2,gen_random_uuid(),'rate fixture' from generate_series(1,60)",[conversation,members[0].id]);
await db.exec('set role service_role');
await assert.rejects(()=>act(users[0],'send',conversation,'Over rate'),/rate_limited/); checks++;
// Upgrade an existing Main history, then exercise independent room controls.
await db.exec('reset role');
const oldMessage = (await ok("insert into longboard_chat_messages(guest_id,author_label,body) values($1,'Member 0','Existing Main history') returning id",[members[0].id]))[0].id;
await db.exec(await readFile(new URL('../../supabase/migrations/20260915204338_chat_social_room.sql',import.meta.url),'utf8'));
assert.equal((await ok('select room_slug from longboard_chat_messages where id=$1',[oldMessage]))[0].room_slug,'main'); checks++;
await db.exec('set role service_role');
const socialMessage = (await ok("insert into longboard_chat_messages(room_slug,guest_id,author_label,body) values('social',$1,'Member 0','A movie recommendation') returning id",[members[0].id]))[0].id;
assert.equal((await ok("select count(*)::int n from longboard_chat_messages where room_slug='social'"))[0].n,1); checks++;
await ok("update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$1 where room_slug='social'",[users[0]]);
await denied("insert into longboard_chat_messages(room_slug,guest_id,author_label,body) values('social',$1,'Member 0','Paused')",[members[0].id],/longboard_chat_paused/);
await denied("insert into longboard_chat_reactions(message_id,guest_id) values($1,$2)",[socialMessage,members[0].id],/longboard_chat_paused/);
await ok("insert into longboard_chat_messages(guest_id,author_label,body) values($1,'Member 0','Main still open')",[members[0].id]); checks++;
await ok("insert into longboard_chat_reactions(message_id,guest_id) values($1,$2)",[oldMessage,members[0].id]); checks++;
await ok("update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug='social'");
await ok("update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$1 where room_slug='main'",[users[0]]);
await ok("insert into longboard_chat_messages(room_slug,guest_id,author_label,body) values('social',$1,'Member 0','Social still open')",[members[0].id]); checks++;
await ok("insert into longboard_chat_guests(token_hash,display_name) values($1,'New social guest')",['c'.repeat(64)]); checks++;
await denied("update longboard_chat_messages set room_slug='social' where id=$1",[oldMessage],/longboard_chat_room_immutable/);
await db.exec('reset role; set role anon');
assert.equal((await ok("select count(*)::int n from longboard_chat_messages where room_slug='social'"))[0].n,2); checks++;
await denied("insert into longboard_chat_messages(room_slug,guest_id,author_label,body) values('social',$1,'Forged','Forged')",[members[0].id],/permission denied/);
await denied('select * from longboard_chat_direct_messages',[],/permission denied/);
// Authentication and search migration protects historic rows and RPC access.
await db.exec('reset role');
await db.exec('grant select on profiles to authenticated');
await db.exec(await readFile(new URL('../../supabase/migrations/20260915225504_member_chat_search.sql',import.meta.url),'utf8'));
await db.exec('set role anon');
await denied('select * from longboard_chat_messages',[],/permission denied/);
await denied('select * from longboard_chat_reactions',[],/permission denied/);
await denied("select * from search_longboard_chat('movie','social')",[],/permission denied/);
await denied('select * from longboard_chat_search_context($1)',[oldMessage],/permission denied/);
await db.exec('reset role; set role authenticated');
await ok("select set_config('request.jwt.claim.sub',$1,false)",[users[0]]);
assert.equal((await ok("select * from search_longboard_chat('movie','social')")).length,1); checks++;
assert.equal((await ok("select * from search_longboard_chat('movie','main')")).length,0); checks++;
assert.equal((await ok('select * from longboard_chat_search_context($1)',[oldMessage])).every(m=>m.room_slug==='main'),true); checks++;
assert.equal((await ok("select * from search_longboard_chat('privately','all')")).length,0); checks++;
await ok("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);
assert.equal((await ok('select * from longboard_chat_messages')).length,0); checks++;
assert.equal((await ok("select * from search_longboard_chat('movie','all')")).length,0); checks++;
await db.exec('reset role; set role service_role');
await denied("insert into longboard_chat_messages(room_slug,guest_id,author_label,body) values('social',$1,'Guest','Denied')",[members[0].id],/chat_member_required/);
await ok("insert into longboard_chat_messages(room_slug,guest_id,member_id,author_label,body) select 'social',$1,$1,'Member 0','AAPL dilution search fixture' from generate_series(1,25)",[members[0].id]);
await db.exec('reset role; set role authenticated');
await ok("select set_config('request.jwt.claim.sub',$1,false)",[users[0]]);
const firstPage=await ok("select * from search_longboard_chat('AAPL','social')");
assert.equal(firstPage.length,21); checks++;
const cursor=firstPage[19];
const nextPage=await ok("select * from search_longboard_chat('AAPL','social',$1,$2)",[cursor.created_at,cursor.id]);
assert.equal(nextPage.length,5); checks++;
assert.equal(nextPage.some(m=>firstPage.slice(0,20).some(x=>x.id===m.id)),false); checks++;
// Real pgvector exercises: no production data or external embeddings.
await db.exec('reset role');
await db.exec(await readFile(new URL('../../supabase/migrations/20260915231144_chat_semantic_search.sql',import.meta.url),'utf8'));
const vec=JSON.stringify([1,...Array(1535).fill(0)]);
await db.exec('set role anon');
await denied('select * from longboard_chat_embeddings',[],/permission denied/);
await denied("select * from search_longboard_chat_semantic('movie',$1,'all')",[vec],/permission denied/);
await db.exec('reset role; set role authenticated');
await ok("select set_config('request.jwt.claim.sub',$1,false)",[users[0]]);
await denied('select * from claim_longboard_chat_embeddings()',[],/permission denied/);
await denied('select take_longboard_chat_search_budget($1)',[users[0]],/permission denied/);
await denied('update longboard_chat_embeddings set embedding=$1',[vec],/permission denied/);
await db.exec('reset role; set role service_role');
const claimed=await ok('select * from claim_longboard_chat_embeddings()');
assert.ok(claimed.length>0 && claimed.length<=32); checks++;
assert.equal(claimed.some(j=>j.content.includes('Hello privately')),false); checks++;
assert.equal((await ok('select * from claim_longboard_chat_embeddings()')).length,0); checks++;
for(const job of claimed) await ok('update longboard_chat_embeddings set embedding=$1 where message_id=$2 and lease_id=$3',[vec,job.message_id,job.lease_id]);
await db.exec('reset role; set role authenticated');
assert.ok((await ok("select * from search_longboard_chat_semantic('film',$1,'social')",[vec])).length>0); checks++;
assert.equal((await ok("select * from search_longboard_chat_semantic('film',$1,'social')",[vec])).every(m=>m.room_slug==='social'),true); checks++;
await ok("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);
assert.equal((await ok('select * from longboard_chat_embeddings')).length,0); checks++;
assert.equal((await ok("select * from search_longboard_chat_semantic('film',$1,'all')",[vec])).length,0); checks++;
await db.exec('reset role; set role service_role');
await ok("update longboard_chat_messages set body='Edited movie' where id=$1",[socialMessage]);
assert.equal((await ok('select embedding from longboard_chat_embeddings where message_id=$1',[socialMessage]))[0].embedding,null); checks++;
const oldJob=claimed.find(j=>j.message_id===socialMessage);
assert.equal((await ok('update longboard_chat_embeddings set embedding=$1 where message_id=$2 and lease_id=$3 returning message_id',[vec,socialMessage,oldJob.lease_id])).length,0); checks++;
assert.equal((await ok('select * from claim_longboard_chat_embeddings()')).length,1); checks++;
await ok("update longboard_chat_embeddings set available_at=now()-interval '1 minute' where message_id=$1",[socialMessage]);
assert.equal((await ok('select * from claim_longboard_chat_embeddings()')).length,1); checks++;
await ok("update longboard_chat_embeddings set attempts=8,available_at=now()-interval '1 minute' where message_id=$1",[socialMessage]);
assert.equal((await ok('select * from claim_longboard_chat_embeddings()')).length,0); checks++;
await ok('delete from longboard_chat_messages where id=$1',[socialMessage]);
assert.equal((await ok('select * from longboard_chat_embeddings where message_id=$1',[socialMessage])).length,0); checks++;
for(let i=0;i<30;i++) assert.equal((await ok('select take_longboard_chat_search_budget($1) allowed',[users[0]]))[0].allowed,true);
assert.equal((await ok('select take_longboard_chat_search_budget($1) allowed',[users[0]]))[0].allowed,false); checks++;
console.log(`PASS: ${checks} database identity, request, privacy, blocking, unread and retry checks`);
await db.close();
