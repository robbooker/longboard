// Synthetic local database; no production connection or credentials.
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

for(const file of ['20261001170025_chat_notification_formatting.sql','20261001170041_chat_visible_notification_reads.sql','20261001190002_chat_shortscout_authorization.sql','20261001191605_chat_pinned_unread.sql','20261002120756_chat_member_display_names.sql','20261002140651_chat_room_message_pins.sql','20261002152103_chat_notification_list.sql'])await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const rooms=['main','social','shortscout','lb-announcements','ss-announcements','lb-recordings','ss-recordings'];
const inbox=async(i,allowed=rooms)=>(await one('select chat_activity_inbox($1,$2) value',[accounts[i],allowed])).value;
const post=async(i,body,parent=null,room='main')=>(await one('select send_chat_attachment_message($1,$2,$3,$4,$5,$6,$7) m',[members[i],room,['Admin','LB member','SS member'][i],body,parent,[],crypto.randomUUID()])).m;
const react=async(i,id,emoji='heart',active=true,room='main',conversation=null)=>q('select set_chat_message_reaction($1,$2,$3,$4,$5,$6)',[accounts[i],room,conversation,id,emoji,active]);
const all=async(i,snapshot)=>q('select read_chat_activity_notifications($1,$2,$3,null,$4,null,$5,null)',[accounts[i],rooms,snapshot.mentionThrough,snapshot.dmThrough,snapshot.reactionThrough]);
const dm=async(a,b)=>{const id=crypto.randomUUID();await q("insert into longboard_chat_conversations(id,requester_id,recipient_id,status) values($1,$2,$3,'accepted')",[id,members[a],members[b]]);return id;};
const send=async(c,i,body)=>(await one('insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,$3,gen_random_uuid()) returning *',[c,members[i],body]));
const history=async(i,allowed=rooms)=>q('select * from chat_reaction_notification_history($1,$2) order by seq',[accounts[i],allowed]);
const equivalent=async(i,allowed=rooms)=>{const h=(await history(i,allowed)).filter(row=>!row.read).map(({read,...row})=>{void read;return row;});eq(h,await q('select * from eligible_chat_reaction_notifications($1,$2) order by seq',[accounts[i],allowed]));};
const target=await post(1,'Retained reaction preview');await react(0,target.id);
const rootMessage=await post(1,'Original thread');const reply=await post(0,'Nested reply',rootMessage.id);
const mention=await post(0,'@LB member plain mention');
for(const room of ['lb-announcements','lb-recordings'])await post(0,'An alert in '+room,null,room);
const conversation=await dm(1,0),incoming=await send(conversation,0,'Incoming preview'),outgoing=await send(conversation,1,'Own outgoing preview');
await react(0,outgoing.id,'laugh',true,null,conversation);await q("select chat_pins($1,'pin',null,$2)",[accounts[1],conversation]);
let before=await inbox(1);eq(before.mentions.length,4);eq(before.mentions.every(n=>n.read===false),true);eq(before.reactions.length,2);eq(before.reactionCount,2);eq(before.dms[0].messageId,incoming.id);eq(before.pinnedDmUnread[conversation],1);await equivalent(1);
const marker=await one('select requester_read_seq,recipient_read_seq from longboard_chat_conversations where id=$1',[conversation]);await inbox(1);eq(await one('select requester_read_seq,recipient_read_seq from longboard_chat_conversations where id=$1',[conversation]),marker);
await all(1,before);let read=await inbox(1);
eq(read.mentions.map(n=>n.id),before.mentions.map(n=>n.id));eq(read.mentions.every(n=>n.read),true);eq(read.reactions.map(n=>n.id),before.reactions.map(n=>n.id));eq(read.reactions.every(n=>n.read),true);
eq([read.mentionCount,read.mentionThrough,read.dmCount,read.dmThrough,read.reactionCount,read.reactionThrough],[0,0,0,0,0,0]);eq(read.roomCounts,{});eq(read.roomThrough,{});eq(read.pinnedDmUnread[conversation],0);eq(read.dms[0].unread,0);eq(read.dms[0].preview,'Incoming preview');eq(read.dms[0].throughSeq,incoming.seq);await equivalent(1);
// Old clients may redundantly submit retained rows: their observed cursors cannot read later events.
const freshMention=await post(0,'@LB member newer event');const newIncoming=await send(conversation,0,'New incoming');await react(0,target.id,'rob');
await all(1,before);let fresh=await inbox(1);eq([fresh.mentionCount,fresh.dmCount,fresh.reactionCount],[1,1,1]);eq(fresh.mentions[0].messageId,freshMention.id);eq(fresh.mentions[0].read,false);eq(fresh.dms[0].messageId,newIncoming.id);eq(fresh.pinnedDmUnread[conversation],1);await equivalent(1);
const oldReaction=before.reactions.find(n=>n.messageId===target.id);await react(0,target.id,'heart',false);eq((await history(1)).some(n=>n.id===oldReaction.id),false);await react(0,target.id);const replacement=(await history(1)).find(n=>n.message_id===target.id&&n.emoji==='heart');eq(replacement.read,false);eq(replacement.seq>oldReaction.seq,true);eq(replacement.id!==oldReaction.id,true);
await q('select read_chat_activity_notifications($1,$2,0,null,0,null,$3,$4)',[accounts[1],rooms,oldReaction.seq,oldReaction.id]);eq((await history(1)).find(n=>n.id===replacement.id).read,false);
// Exact visible acknowledgements retain only matched event rows, preserving later activation.
await q('select read_visible_chat_notifications($1,$2,$3,$4,$5,$6)',[accounts[1],'main',null,[target.id],0,replacement.seq]);eq((await history(1)).find(n=>n.id===replacement.id).read,true);eq((await inbox(1)).mentionCount,1);
await q("select chat_update_member_name($1,'Current Admin')",[accounts[0]]);eq((await inbox(1)).mentions.find(n=>n.messageId===mention.id).author,'Current Admin');eq((await inbox(1)).reactions[0].author,'Current Admin');eq((await inbox(1)).dms[0].name,'Current Admin');
await q("select change_chat_message($1,$2,'main','edit','Current body','Retained reaction preview',false,0)",[accounts[1],target.id]);eq((await history(1)).filter(n=>n.message_id===target.id).every(n=>n.preview==='Current body'),true);
// Read and unread projections enforce identical current room / block / target ownership gates.
for(const pair of [[members[1],members[0]],[members[0],members[1]]]){await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',pair);eq((await inbox(1)).mentions.length,0);eq((await inbox(1)).dms.length,0);eq((await history(1)).length,0);await equivalent(1);await q('delete from longboard_chat_blocks');}
eq((await history(0)).length,0);await equivalent(0);eq((await history(1,['social'])).some(n=>n.kind==='room'),false);await equivalent(1,['social']);
await q('delete from user_tags where user_id=$1',[accounts[1]]);eq((await inbox(1)).mentions.length,0);eq((await history(1)).filter(n=>n.kind==='room').length,0);await equivalent(1);await q("insert into user_tags values($1,'boardroom-cohort-2')",[accounts[1]]);
for(const status of ['pending','declined']){await q('update longboard_chat_conversations set status=$1 where id=$2',[status,conversation]);eq((await history(1)).some(n=>n.kind==='dm'),false);eq((await inbox(1)).dms.length,status==='pending'?1:0);await equivalent(1);}
await q("update longboard_chat_conversations set status='accepted' where id=$1",[conversation]);
await q('update longboard_chat_conversations set requester_id=$1 where id=$2',[members[2],conversation]);eq((await history(1)).some(n=>n.kind==='dm'),false);eq((await inbox(1)).dms.length,0);await equivalent(1);await q('update longboard_chat_conversations set requester_id=$1 where id=$2',[members[1],conversation]);
// Even malformed service-created events cannot expose a foreign target or nonparticipant reactor.
const foreignTarget=await post(0,'Foreign owner');
await q("insert into chat_reaction_notifications(account_id,reactor_member_id,room_message_id,emoji,read_at) values($1,$2,$3,'heart',now())",[accounts[1],members[2],foreignTarget.id]);eq((await history(1)).some(n=>n.message_id===foreignTarget.id),false);await equivalent(1);
await q("insert into chat_reaction_notifications(account_id,reactor_member_id,dm_message_id,emoji,read_at) values($1,$2,$3,'rob',now())",[accounts[1],members[2],outgoing.id]);eq((await history(1)).some(n=>n.message_id===outgoing.id&&n.emoji==='rob'),false);await equivalent(1);
// Strict ShortScout entitlement applies to read survivors too, not only unread counts.
const subject='10000000-0000-4000-8000-000000000003';await q("insert into chat_shortscout_authorization(subject,decision,membership_level,checked_at,valid_until) values($1,'allow','mastermind',now(),now()+interval '5 minutes')",[subject]);
const ss=await post(2,'SS read target',null,'shortscout');await react(0,ss.id,'heart',true,'shortscout');await post(0,'@SS member SS mention',null,'shortscout');await post(0,'SS announcement',null,'ss-announcements');await post(0,'SS recording',null,'ss-recordings');await all(2,await inbox(2));eq((await inbox(2)).mentions.length,3);eq((await history(2)).length,1);await equivalent(2);
await q("update chat_shortscout_authorization set valid_until=now() where subject=$1",[subject]);eq((await inbox(2)).mentions.length,0);eq((await history(2)).length,0);await equivalent(2);
await q("update chat_shortscout_authorization set valid_until=now()+interval '5 minutes',decision='deny',membership_level=null where subject=$1",[subject]);eq((await inbox(2)).mentions.length,0);eq((await history(2)).length,0);
// Live joins never retain deleted body snapshots; surviving tombstones are not alerts.
await q("select change_chat_message($1,$2,'main','delete',null,null,false,0)",[accounts[0],reply.id]);eq((await inbox(1)).mentions.some(n=>n.messageId===reply.id),false);
await q("select change_chat_message($1,$2,'main','delete',null,null,false,1)",[accounts[1],target.id]);eq((await history(1)).some(n=>n.message_id===target.id),false);
await q("select longboard_chat_dm_message_action($1,$2,$3,'delete',0)",[accounts[0],conversation,newIncoming.id]);eq((await inbox(1)).dms[0].messageId,incoming.id);eq((await inbox(1)).dms[0].unread,0);
await q("select longboard_chat_dm_message_action($1,$2,$3,'delete',0)",[accounts[0],conversation,incoming.id]);eq((await inbox(1)).dms.length,0);
// Complete unread totals/cursors are independent of capped, mixed read/unread lists.
for(let i=0;i<55;i++){await post(0,'@LB member capped '+i);const m=await post(1,'Capped reaction '+i);await react(0,m.id);}
const many=await inbox(1);eq(many.mentions.length,50);eq(many.reactions.length,50);eq(many.mentionCount>50,true);eq(many.reactionCount>50,true);eq(many.mentionThrough,many.mentions[0].seq);eq(many.reactionThrough,many.reactions[0].seq);await all(1,many);const manyRead=await inbox(1);eq(manyRead.mentions.length,50);eq(manyRead.reactions.length,50);eq([manyRead.mentionCount,manyRead.reactionCount,manyRead.mentionThrough,manyRead.reactionThrough],[0,0,0,0]);
await send(conversation,0,'Pinned unread outside the preview sample');
for(let i=0;i<101;i++){const a=crypto.randomUUID();await q('insert into auth.users values($1)',[a]);await q("insert into profiles values($1,$2,'user')",[a,`history${i}@example.test`]);await q('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[a]);const m=(await one('select longboard_chat_link_member($1,$2,null) m',[a,`History ${i}`])).m;const c=crypto.randomUUID();await q("insert into longboard_chat_conversations(id,requester_id,recipient_id,status) values($1,$2,$3,'accepted')",[c,members[1],m.id]);await q("insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,'Recent DM',gen_random_uuid())",[c,m.id]);}
const manyDms=await inbox(1);eq(manyDms.dms.length,100);eq(manyDms.dmCount,102);eq(manyDms.dms.some(n=>n.id===conversation),false);eq(manyDms.pinnedDmUnread[conversation],1);await all(1,manyDms);const readDms=await inbox(1);eq(readDms.dms.length,100);eq(readDms.dms.every(n=>n.unread===0),true);eq([readDms.dmCount,readDms.dmThrough],[0,0]);eq(readDms.pinnedDmUnread[conversation],0);
for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>history(1),/permission denied/);await assert.rejects(()=>inbox(1),/permission denied/);checks+=2;await db.exec('reset role');}
await db.exec('set role service_role');await inbox(1);await history(1);await db.exec('reset role');checks++;
eq((await one("select bool_and(not prosecdef and proconfig @> array['search_path=\"\"']) safe from pg_proc where proname in ('chat_reaction_notification_history','chat_activity_inbox')")).safe,true);
console.log(`PASS ${checks} notification-list assertions: retained read survivors, independent unread boundaries/maps, old-client/fresh-event safety, exact visible reads, current names, DM grouping, current access/blocks/strict SS/deletion/ownership, sample caps and service-only projection.`);
await db.close();
