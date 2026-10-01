// Current published chat schema; synthetic local data only.
import {recordingMigrations} from './chat-recordings-migrations.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const root=new URL('../../',import.meta.url).pathname;
const db=new PGlite({extensions:{vector}});
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema extensions; create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public to anon,authenticated,service_role;
create table profiles(id uuid primary key,email text,role text);
create table user_tags(user_id uuid,tag text);
grant select on profiles,user_tags to authenticated,service_role;
alter table profiles enable row level security;
create policy self on profiles for select to authenticated using(id=auth.uid());
alter default privileges in schema public grant all on tables to service_role;
create publication supabase_realtime;`);
for(const file of ['20260827135528_public_chat_guest_room.sql','20260901125001_longboard_chat_admin_buddy.sql','20260915115419_chat_member_direct_messages.sql','20260915204338_chat_social_room.sql','20260915225504_member_chat_search.sql','20260915231144_chat_semantic_search.sql','20260915232125_chat_shortscout_admin_room.sql']) await db.exec(await readFile(`${root}/supabase/migrations/${file}`,'utf8'));

await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
await db.exec(await readFile(`${root}/supabase/migrations/20260917030546_chat_attachments.sql`,'utf8'));

for(const file of ['20260916142421_shared_chat_login.sql','20260916160122_chat_message_actions.sql','20260916213912_chat_activity_notifications.sql','20260917135451_chat_announcement_rooms.sql','20260917202524_chat_boardroom_access.sql','20260917231038_chat_announcement_member_reactions.sql']) await db.exec(await readFile(`${root}/supabase/migrations/${file}`,'utf8'));
for(const file of recordingMigrations.filter(f=>f!=='20260917231038_chat_announcement_member_reactions.sql'))await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));
const accounts=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
for(let i=0;i<2;i++){
 await db.query('insert into auth.users values($1)',[accounts[i]]);
 await db.query('insert into profiles values($1,$2,$3)',[accounts[i],`test${i}@example.test`,i===0?'admin':'user']);
 await db.query('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[accounts[i]]);
}
await db.query('insert into chat_accounts(id) values($1)',[accounts[2]]);
await db.query("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout','10000000-0000-4000-8000-000000000003',$1,'mastermind')",[accounts[2]]);
await db.query("insert into user_tags values($1,'boardroom-cohort-1'),($2,'boardroom-cohort-2')",[accounts[0],accounts[1]]);
const members=[];
for(let i=0;i<3;i++) members.push((await db.query('select longboard_chat_link_member($1,$2,null) m',[accounts[i],['Admin','LB member','SS member'][i]])).rows[0].m.id);

await db.exec(await readFile(root+'/supabase/migrations/20261001161221_chat_delete_replies.sql','utf8'));

await db.exec(await readFile(root+'/supabase/migrations/20261001170025_chat_notification_formatting.sql','utf8'));
await db.exec(await readFile(root+'/supabase/migrations/20261001170041_chat_visible_notification_reads.sql','utf8'));
await db.exec(await readFile(root+'/supabase/migrations/20261001190002_chat_shortscout_authorization.sql','utf8'));
let checks=0;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>(await q(sql,args))[0];
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
const denied=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const reserve=async(i,room)=>(await one("select reserve_chat_attachment($1,$2,'fixture.gif','image/gif',42) a",[members[i],room])).a;
const ready=async a=>{await q("update chat_attachments set status='ready',object_path=$2,sha256='verified-synthetic-hash' where id=$1",[a.id,'clean/'+a.id]);return a;};
const send=(i,room,files,body='',reply=null,client=crypto.randomUUID())=>one('select send_chat_attachment_message($1,$2,$3,$4,$5,$6,$7) m',[members[i],room,'Fixture sender',body,reply,files,client]).then(r=>r.m);
for(const [i,room]of [[1,'main'],[1,'social'],[2,'shortscout']]){
 for(const status of ['pending','scanning','rejected']){const a=await reserve(i,room);await q('update chat_attachments set status=$2 where id=$1',[a.id,status]);await denied(()=>send(i,room,[a.id]),/attachment_not_ready/);}
 const a=await ready(await reserve(i,room)),client=crypto.randomUUID();
 const sent=await send(i,room,[a.id],'',null,client);equal(sent.body,'');assert(sent.unread_seq>0);checks++;
 equal((await send(i,room,[a.id],'',null,client)).id,sent.id);
 equal((await one('select status,room_message_id from chat_attachments where id=$1',[a.id])),{status:'attached',room_message_id:sent.id});
 await denied(()=>send(i,room,[a.id],'changed',null,client),/send_conflict/);
 await denied(()=>send(i,room,[a.id]),/attachment_not_ready/);
 const replyFile=await ready(await reserve(i,room));const reply=await send(i,room,[replyFile.id],'',sent.id);equal(reply.reply_to_id,sent.id);equal(reply.body,'');
 const textFile=await ready(await reserve(i,room));equal((await send(i,room,[textFile.id],'line one\nline two')).body,'line one\nline two');
 await denied(()=>send(i,room,[]),/body_check/);
 const wrong=await ready(await reserve(i,room));await denied(()=>send(i,room==='social'?'main':'social',[wrong.id]),/attachment_wrong_room/);
 await denied(()=>send(i===1?0:1,room,[wrong.id]),/attachment_not_ready/);
 await denied(()=>send(i,room,[wrong.id,wrong.id]),/invalid_attachments/);
 const bad=await reserve(i,room);await denied(()=>send(i,room,[wrong.id,bad.id]),/attachment_not_ready/);
 equal((await one('select status from chat_attachments where id=$1',[wrong.id])).status,'ready');
}
const request=(await one("select longboard_chat_dm_action($1,'request',$2,'Hello',$3,null) r",[accounts[0],members[1],crypto.randomUUID()])).r;
await q("select longboard_chat_dm_action($1,'accept',$2,null,null,null)",[accounts[1],request.conversationId]);
const dmReserve=async i=>(await one("select to_jsonb(reserve_chat_dm_attachment($1,$2,'private.gif','image/gif',42)) a",[members[i],request.conversationId])).a;
const dmSend=(files,body='',client=crypto.randomUUID())=>one("select send_chat_dm_ack($1,'send',$2,$3,$4,$5) r",[accounts[0],request.conversationId,body,client,files]).then(r=>r.r);
const pending=await dmReserve(0);await denied(()=>dmSend([pending.id]),/attachment_not_ready/);
const a=await ready(pending),client=crypto.randomUUID(),sent=await dmSend([a.id],'',client);equal(sent.message.body,'');equal(sent.message.attachment_ids,[a.id]);
const markers=await one('select requester_read_seq,recipient_read_seq from longboard_chat_conversations where id=$1',[request.conversationId]);
equal((await dmSend([a.id],'',client)).message.id,sent.message.id);equal(await one('select requester_read_seq,recipient_read_seq from longboard_chat_conversations where id=$1',[request.conversationId]),markers);
await denied(()=>dmSend([a.id],'different',client),/invalid_client_id/);
await denied(()=>dmSend([]),/invalid_message/);
const other=await ready(await dmReserve(1));await denied(()=>dmSend([other.id]),/attachment_not_ready/);
const roomFile=await ready(await reserve(0,'main'));await denied(()=>dmSend([roomFile.id]),/attachment_wrong_conversation/);
const textFile=await ready(await dmReserve(0));equal((await dmSend([textFile.id],'DM one\nDM two')).message.body,'DM one\nDM two');
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[members[1],members[0]]);await denied(()=>dmSend([other.id]),/conversation_unavailable/);
for(const role of ['anon','authenticated']){await db.exec('set role '+role);await denied(()=>send(1,'main',[]),/permission denied/);await denied(()=>dmSend([]),/permission denied/);await db.exec('reset role');}
await db.close();console.log(`PASS ${checks} current-schema room/reply/DM assertions: attachment-only, formatting, exact retries, atomic scan/owner/scope gates, empty rejection, sequence stability and service-only execution.`);
