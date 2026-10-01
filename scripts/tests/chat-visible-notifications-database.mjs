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

await db.exec(await readFile(process.env.CHAT_FORMATTING_MIGRATION||root+'/supabase/migrations/20261001170025_chat_notification_formatting.sql','utf8'));
await db.exec(await readFile(root+'/supabase/migrations/20261001170041_chat_visible_notification_reads.sql','utf8'));
let checks=0;
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const one=async(sql,args=[]) => (await q(sql,args))[0];
const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const denied=async(run,re)=>{await assert.rejects(run,re);checks++;};
const post=async(i,body,parent=null,room='main')=>one('select send_chat_attachment_message($1,$2,$3,$4,$5,$6,$7) m',[members[i],room,i?'LB member':'Admin',body,parent,[],crypto.randomUUID()]).then(x=>x.m);
const inbox=async(i=0)=>(await one("select chat_activity_inbox($1,array['main','social']) a",[accounts[i]])).a;
const ack=async(ids,{room='main',conversation=null,mentions=0,reactions=0,actor=0}={})=>q('select read_visible_chat_notifications($1,$2,$3,$4,$5,$6)',[accounts[actor],room,conversation,ids,mentions,reactions]);
const react=async(message,emoji='heart',active=true,conversation=null)=>q('select set_chat_message_reaction($1,$2,$3,$4,$5,$6)',[accounts[1],conversation?null:'main',conversation,message.id,emoji,active]);
const rootMessage=await post(0,'Original owned conversation');
const visible=await post(1,'@Admin visible mention'),hidden=await post(1,'@Admin offscreen mention');
const reply=await post(1,'Visible reply',rootMessage.id),unseenReply=await post(1,'Unseen nested reply',reply.id);
const unrelated=await post(0,'Unseen owned target');
await react(rootMessage);await react(unrelated);
const before=await inbox();
equal(before.mentionCount,4);equal(before.reactionCount,2);
await ack([visible.id,rootMessage.id],{mentions:before.mentionThrough,reactions:before.reactionThrough});
const after=await inbox();
equal(after.mentions.map(x=>x.messageId).sort(),[hidden.id,reply.id,unseenReply.id].sort());
equal(after.reactions.map(x=>x.messageId),[unrelated.id]);
// Reading the exact reply clears that alert but never its descendants or siblings.
await ack([reply.id],{mentions:before.mentionThrough});
equal((await inbox()).mentions.map(x=>x.messageId).sort(),[hidden.id,unseenReply.id].sort());
// A newer event on the same already-read target survives an older snapshot.
await react(rootMessage,'like');
let fresh=await inbox();const latest=fresh.reactions.find(x=>x.messageId===rootMessage.id);
assert(latest.seq>before.reactionThrough);checks++;
await ack([rootMessage.id],{reactions:before.reactionThrough});
equal((await inbox()).reactions.some(x=>x.id===latest.id),true);
await ack([rootMessage.id],{reactions:fresh.reactionThrough});
equal((await inbox()).reactions.some(x=>x.id===latest.id),false);
await react(rootMessage,'heart',false);await react(rootMessage,'heart',true);
fresh=await inbox();const reactivated=fresh.reactions.find(x=>x.messageId===rootMessage.id);
assert(reactivated.seq>latest.seq&&reactivated.id!==before.reactions.find(x=>x.messageId===rootMessage.id).id);checks++;
await ack([rootMessage.id],{reactions:latest.seq});equal((await inbox()).reactions.some(x=>x.id===reactivated.id),true);
// A late mention has an independent sequence even when the row was previously visible.
const lateMention=await post(1,'@Admin arrived later');
await ack([lateMention.id],{mentions:before.mentionThrough});equal((await inbox()).mentions.some(x=>x.messageId===lateMention.id),true);
// Neither an ID from another scope nor a forged account can acknowledge this recipient.
const otherRoom=await post(1,'@Admin social scope',null,'social');
fresh=await inbox();await ack([otherRoom.id],{mentions:fresh.mentionThrough});equal((await inbox()).mentions.some(x=>x.messageId===otherRoom.id),true);
await ack([hidden.id],{mentions:fresh.mentionThrough,actor:1});equal((await inbox()).mentions.some(x=>x.messageId===hidden.id),true);
await denied(()=>ack([hidden.id],{mentions:fresh.mentionThrough,actor:2}),/room_forbidden/);
for(const ids of [[],[hidden.id,hidden.id],Array(101).fill(hidden.id),[null]])await denied(()=>ack(ids),/invalid_visible_snapshot/);
await denied(()=>ack([hidden.id],{mentions:-1}),/invalid_visible_snapshot/);
await denied(()=>ack([hidden.id],{room:null}),/invalid_visible_snapshot/);
// Current privacy checks also apply at acknowledgement time.
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[members[0],members[1]]);
await ack([hidden.id,rootMessage.id],{mentions:fresh.mentionThrough,reactions:fresh.reactionThrough});
equal((await one('select read_at from chat_room_mentions where account_id=$1 and message_id=$2',[accounts[0],hidden.id])).read_at,null);
equal((await one('select read_at from chat_reaction_notifications where id=$1',[reactivated.id])).read_at,null);
await q('delete from longboard_chat_blocks where blocker_id=$1 and blocked_id=$2',[members[0],members[1]]);
// Compatibility auto-read is inert; explicit existing bell actions still work.
await q('select read_visible_chat_room_alerts($1,$2,$3)',[accounts[0],'main',fresh.mentionThrough]);
equal((await one('select read_at from chat_room_mentions where account_id=$1 and message_id=$2',[accounts[0],hidden.id])).read_at,null);
const explicit=(await inbox()).mentions.find(x=>x.messageId===hidden.id);
await q('select read_chat_activity($1,$2,$3,$4)',[accounts[0],['main'],explicit.seq,explicit.id]);
equal((await inbox()).mentions.some(x=>x.id===explicit.id),false);
// DM reactions require the exact conversation and target; sequence markers stay untouched.
const dm=async(i,action,target,body=null,client=crypto.randomUUID())=>(await one('select longboard_chat_dm_action($1,$2,$3,$4,$5) m',[accounts[i],action,target,body,client])).m;
const conversation=(await dm(0,'request',members[1],'Owned DM')).conversationId;await dm(1,'accept',conversation);
const direct=await one('select * from longboard_chat_direct_messages where conversation_id=$1',[conversation]);
await react(direct,'heart',true,conversation);
const dmBefore=await one('select requester_read_seq,recipient_read_seq from longboard_chat_conversations where id=$1',[conversation]);
fresh=await inbox();const dmEvent=fresh.reactions.find(x=>x.messageId===direct.id);
await ack([direct.id],{reactions:fresh.reactionThrough});equal((await inbox()).reactions.some(x=>x.id===dmEvent.id),true);
await denied(()=>ack([direct.id],{room:null,conversation:crypto.randomUUID(),reactions:fresh.reactionThrough}),/conversation_unavailable/);
await denied(()=>ack([direct.id],{room:null,conversation,reactions:fresh.reactionThrough,actor:2}),/conversation_unavailable/);
await denied(()=>ack([direct.id],{room:null,conversation,mentions:1,reactions:fresh.reactionThrough}),/invalid_visible_snapshot/);
await ack([direct.id],{room:null,conversation,reactions:fresh.reactionThrough});equal((await inbox()).reactions.some(x=>x.id===dmEvent.id),false);
equal(await one('select requester_read_seq,recipient_read_seq from longboard_chat_conversations where id=$1',[conversation]),dmBefore);
await react(direct,'heart',false,conversation);await react(direct,'heart',true,conversation);
await ack([direct.id],{room:null,conversation,reactions:fresh.reactionThrough});equal((await inbox()).reactions.some(x=>x.messageId===direct.id),true);
// Existing manual all-read handles remaining mentions and both kinds of reaction.
fresh=await inbox();await q('select read_chat_activity_notifications($1,$2,$3,null,0,null,$4,null)',[accounts[0],['main','social'],fresh.mentionThrough,fresh.reactionThrough]);
equal((await inbox()).mentionCount,0);equal((await inbox()).reactionCount,0);
for(const role of ['anon','authenticated']){
 await db.exec('reset role;set role '+role);
 await denied(()=>ack([rootMessage.id]),/permission denied/);
}
await db.close();console.log(`PASS ${checks} exact visible notification assertions: scoped targets, offscreen/reply isolation, future/reactivated event boundaries, ownership/privacy, bounded input, DM marker stability, legacy/manual compatibility and grants.`);
