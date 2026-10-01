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

const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const one=async(sql,args=[]) => (await q(sql,args))[0];
const post=async(i,body,parent=null,room='main')=>(await one('select send_chat_attachment_message($1,$2,$3,$4,$5,$6,$7) m',[members[i],room,['Admin','LB member','SS member'][i],body,parent,[],crypto.randomUUID()])).m;
const react=async(i,id,emoji='heart',active=true,room='main',conversation=null)=>q('select set_chat_message_reaction($1,$2,$3,$4,$5,$6)',[accounts[i],room,conversation,id,emoji,active]);
const inbox=async(i,rooms=['main','social','shortscout'])=>(await one('select chat_activity_inbox($1,$2) m',[accounts[i],rooms])).m;
const remove=async(i,m)=>(await one("select change_chat_message($1,$2,$3,'delete',null,null,false,$4) m",[accounts[i],m.id,m.room_slug,m.revision])).m;
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const older=await post(1,'Existing reaction has no new notification');await react(0,older.id);
await db.exec(await readFile(root+'/supabase/migrations/20261001170025_chat_notification_formatting.sql','utf8'));
eq((await inbox(1)).reactionCount,0);
const message=await post(1,'My original message');
const pushBefore=(await one('select count(*)::int n from chat_push_jobs')).n;
await react(0,message.id,'like');let first=(await inbox(1)).reactions[0];
eq(first.kind,'room');eq(first.room,'main');eq(first.messageId,message.id);eq(first.author,'Admin');eq(first.emoji,'like');eq(first.preview,'My original message');
eq((await inbox(0)).reactionCount,0);eq((await one('select count(*)::int n from chat_push_jobs')).n,pushBefore);
await react(0,message.id,'like');eq((await inbox(1)).reactions.map(n=>n.id),[first.id]);
await q('select read_chat_activity_notifications($1,$2,0,null,0,null,$3,$4)',[accounts[1],['main'],first.seq,first.id]);eq((await inbox(1)).reactionCount,0);
await react(0,message.id,'like');eq((await inbox(1)).reactionCount,0);
await react(0,message.id,'like',false);eq((await one('select count(*)::int n from chat_reaction_notifications where id=$1',[first.id])).n,0);
await react(0,message.id,'like');let fresh=(await inbox(1)).reactions[0];assert(fresh.id!==first.id&&fresh.seq>first.seq);checks++;
await q('select read_chat_activity_notifications($1,$2,0,null,0,null,$3,null)',[accounts[1],['main'],first.seq]);eq((await inbox(1)).reactionCount,1);
await react(1,message.id,'rob');eq((await inbox(1)).reactionCount,1);
for(const emoji of ['heart','laugh','rob'])await react(0,message.id,emoji);
eq(new Set((await inbox(1)).reactions.map(n=>n.emoji)),new Set(['like','heart','laugh','rob']));
const parent=await post(0,'Original thread context'),reply=await post(1,'A nested response',parent.id);await react(0,reply.id,'rob');eq((await inbox(1)).reactions[0].messageId,reply.id);
await q("select change_chat_message($1,$2,'main','edit','Edited visible text','My original message',false,0)",[accounts[1],message.id]);
eq((await inbox(1)).reactions.find(n=>n.id===fresh.id).preview,'Edited visible text');
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[members[1],members[0]]);eq((await inbox(1)).reactionCount,0);eq((await inbox(1)).mentions.length,0);
await q('delete from longboard_chat_blocks where blocker_id=$1 and blocked_id=$2',[members[1],members[0]]);
await q('delete from user_tags where user_id=$1',[accounts[1]]);eq((await inbox(1)).reactionCount,0);
await q("insert into user_tags values($1,'boardroom-cohort-2')",[accounts[1]]);
const current=await one('select * from longboard_chat_messages where id=$1',[message.id]);await remove(1,current);assert(!(await inbox(1)).reactions.some(n=>n.messageId===message.id));checks++;
eq((await one('select count(*)::int n from chat_reaction_notifications where room_message_id=$1',[message.id])).n,0);
const ss=await post(0,'ShortScout owner message',null,'shortscout');await react(2,ss.id,'like',true,'shortscout');eq((await inbox(0)).reactions[0].room,'shortscout');eq((await inbox(0,['main'])).reactionCount,0);
const dm=async(i,action,target,body=null)=>(await one('select longboard_chat_dm_action($1,$2,$3,$4,$5) m',[accounts[i],action,target,body,crypto.randomUUID()])).m;
const conversation=(await dm(1,'request',members[0],'Incoming private preview')).conversationId;
let incoming=(await inbox(0)).dms.find(n=>n.id===conversation);eq(incoming.preview,'Incoming private preview');eq(incoming.pending,true);assert(incoming.messageId);checks++;
await dm(0,'accept',conversation);let privateMessage=await one('select * from longboard_chat_direct_messages where conversation_id=$1',[conversation]);
await react(0,privateMessage.id,'heart',true,null,conversation);let privateEvent=(await inbox(1)).reactions.find(n=>n.kind==='dm');eq(privateEvent.conversationId,conversation);eq(privateEvent.messageId,privateMessage.id);eq(privateEvent.preview,'Incoming private preview');
eq((await inbox(2)).reactionCount,0);
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[members[0],members[1]]);eq((await inbox(1)).reactions.filter(n=>n.kind==='dm').length,0);eq((await inbox(0)).dms.length,0);
await q('delete from longboard_chat_blocks where blocker_id=$1 and blocked_id=$2',[members[0],members[1]]);
await q("select longboard_chat_dm_message_action($1,$2,$3,'delete',0)",[accounts[1],conversation,privateMessage.id]);eq((await inbox(1)).reactions.filter(n=>n.kind==='dm').length,0);eq((await inbox(0)).dms.length,0);eq((await inbox(0)).dmCount,0);
const mention=await post(0,'@LB member visible mention');let mentionEvent=(await inbox(1)).mentions.find(n=>n.messageId===mention.id);assert(mentionEvent);checks++;
await remove(0,mention);assert(!(await inbox(1)).mentions.some(n=>n.messageId===mention.id));checks++;
for(let i=0;i<55;i++){const m=await post(1,'Bounded notification '+i);await react(0,m.id);}
const many=await inbox(1);eq(many.reactions.length,50);assert(many.reactionCount>50);checks++;eq(many.reactionThrough,Math.max(...many.reactions.map(n=>n.seq)));
const columns=(await q("select column_name from information_schema.columns where table_name='chat_reaction_notifications' order by ordinal_position")).map(n=>n.column_name);
eq(columns,['id','seq','account_id','reactor_member_id','room_message_id','dm_message_id','emoji','created_at','read_at']);
for(const role of ['anon','authenticated']){
 await db.exec('set role '+role);await assert.rejects(()=>q('select * from chat_reaction_notifications'),/permission denied/);await assert.rejects(()=>q('select * from eligible_chat_reaction_notifications($1,$2)',[accounts[1],['main']]),/permission denied/);checks+=2;await db.exec('reset role');
}
eq((await one("select bool_and(not prosecdef) safe from pg_proc where proname in ('record_chat_reaction_notification','eligible_chat_reaction_notifications','read_chat_activity_notifications')")).safe,true);
console.log(`PASS ${checks} notification event/projection/privacy/cursor/rollout assertions; no push fanout or backfill.`);
await db.close();
