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

for(const file of ['20261001170025_chat_notification_formatting.sql','20261001170041_chat_visible_notification_reads.sql','20261001190002_chat_shortscout_authorization.sql','20261001191605_chat_pinned_unread.sql','20261002120756_chat_member_display_names.sql'])await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));

await db.exec(await readFile(root+'/supabase/migrations/20261002140651_chat_room_message_pins.sql','utf8'));
await db.exec(await readFile(root+'/supabase/migrations/20261002152103_chat_notification_list.sql','utf8'));
let checks=0;const eq=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const denied=async(work,pattern)=>{await assert.rejects(work,pattern);checks++;};
const definitions=async()=>q("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and proname in('chat_push_target','queue_chat_push','claim_chat_push_job','finish_chat_push_job','save_chat_push_subscription','set_chat_push_preview','test_chat_push_subscription','chat_activity_inbox','chat_reaction_notification_history','eligible_chat_reaction_notifications','read_chat_activity_notifications','read_visible_chat_notifications') order by 1");
const before=await definitions();
const endpoint='https://web.push.apple.com/phone-synthetic',otherEndpoint='https://web.push.apple.com/other-synthetic';
await q('select save_chat_push_subscription($1,$2,$3,$4)',[accounts[1],endpoint,'test-key','test-auth']);
await q("update chat_push_subscriptions set updated_at=now()-interval '5 seconds'");
await q('select save_chat_push_subscription($1,$2,$3,$4)',[accounts[1],otherEndpoint,'test-key','test-auth']);
await q('select set_chat_push_preview($1,$2,$3)',[accounts[1],endpoint,'message']);
const subscriptionBefore=await q('select * from chat_push_subscriptions order by endpoint');
await db.exec(await readFile(root+'/supabase/migrations/20261002153528_chat_phone_notification_layout.sql','utf8'));
eq(await definitions(),before);eq(await q('select * from chat_push_subscriptions order by endpoint'),subscriptionBefore);
eq((await one("select prosecdef,proconfig from pg_proc where oid='prepare_chat_push_job(uuid,uuid)'::regprocedure")),{prosecdef:false,proconfig:['search_path=""']});
for(const role of ['anon','authenticated']){await db.exec('set role '+role);await denied(()=>q('select prepare_chat_push_job($1,$2)',[crypto.randomUUID(),crypto.randomUUID()]),/permission denied/);await denied(()=>q('select * from chat_push_jobs'),/permission denied/);await db.exec('reset role');}
const conversation=(await one("insert into longboard_chat_conversations(requester_id,recipient_id,status) values($1,$2,'accepted') returning id",members.slice(0,2))).id;
const direct=(await one("insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values($1,$2,gen_random_uuid(),'Private message') returning *",[conversation,members[0]]));
const claimAll=async()=>{const jobs=[];while(true){const worker=crypto.randomUUID(),job=(await one('select claim_chat_push_job($1) value',[worker])).value;if(!job)break;jobs.push({job,worker});}return jobs;};
const prepare=async e=>(await one('select prepare_chat_push_job($1,$2) value',[e.job.id,e.worker])).value;
const dmJobs=await claimAll();eq(dmJobs.length,2);eq(JSON.stringify(dmJobs).includes('Private message'),false);
const rich=dmJobs.find(e=>e.job.subscription.endpoint===endpoint),privateDevice=dmJobs.find(e=>e.job.subscription.endpoint===otherEndpoint);
await db.exec('set role service_role');let data=await prepare(rich);eq(data.sender,'Admin');eq(data.body,'Private message');eq(data.kind,'dm');eq('room' in data,false);eq('category' in data,false);
data=await prepare(privateDevice);eq(data.preview,'off');for(const key of ['sender','body','room','category','hasAttachments'])eq(key in data,false);
await q('select set_chat_push_preview($1,$2,$3)',[accounts[1],endpoint,'sender']);data=await prepare(rich);eq(data.sender,'Admin');eq('body' in data,false);eq('hasAttachments' in data,false);
await q('select set_chat_push_preview($1,$2,$3)',[accounts[1],endpoint,'off']);data=await prepare(rich);eq('sender' in data,false);
await q('select set_chat_push_preview($1,$2,$3)',[accounts[1],endpoint,'message']);await db.exec('reset role');
await q("update longboard_chat_members set display_name='Luke' where id=$1",[members[0]]);await q("update longboard_chat_direct_messages set body='Edited after claim' where id=$1",[direct.id]);data=await prepare(rich);eq(data.sender,'Luke');eq(data.body,'Edited after claim');
const attachment=(await one("select to_jsonb(reserve_chat_dm_attachment($1,$2,'private-name.gif','image/gif',42)) value",[members[0],conversation])).value;
await q("update chat_attachments set status='ready',object_path=$2,sha256='synthetic-clean-hash' where id=$1",[attachment.id,'clean/'+attachment.id]);
await q("update longboard_chat_direct_messages set body='',attachment_ids=array[$2::uuid] where id=$1",[direct.id,attachment.id]);data=await prepare(rich);eq(data.body,'');eq(data.hasAttachments,true);
eq((await one('select prepare_chat_push_job($1,$2) value',[rich.job.id,crypto.randomUUID()])).value,null);
for(const condition of ["lease_until=now()", "completed_at=now()", "created_at=now()-interval '5 minutes'"]){const original=await one('select lease_until,completed_at,created_at from chat_push_jobs where id=$1',[rich.job.id]);await q('update chat_push_jobs set '+condition+' where id=$1',[rich.job.id]);eq(await prepare(rich),null);await q('update chat_push_jobs set lease_until=$2,completed_at=$3,created_at=$4 where id=$1',[rich.job.id,original.lease_until,original.completed_at,original.created_at]);}
for(const [blocker,blocked] of [[members[0],members[1]],[members[1],members[0]]]){await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[blocker,blocked]);eq(await prepare(rich),null);await q('delete from longboard_chat_blocks');}
await q("update longboard_chat_conversations set status='declined' where id=$1",[conversation]);eq(await prepare(rich),null);await q("update longboard_chat_conversations set status='accepted' where id=$1",[conversation]);
const inbox=async()=>(await one("select chat_activity_inbox($1,array['main','social']) value",[accounts[1]])).value;
const dmBefore=await inbox();eq(dmBefore.dms.find(d=>d.id===conversation).unread,1);
await q('select read_chat_activity_notifications($1,$2,0,null,$3,$4,0,null)',[accounts[1],['main','social'],direct.seq,conversation]);eq(await prepare(rich),null);
const dmRead=await inbox();eq(dmRead.dms.find(d=>d.id===conversation).unread,0);eq(dmRead.dms.find(d=>d.id===conversation).messageId,direct.id);eq([dmRead.dmCount,dmRead.dmThrough],[0,0]);
// Retained older rows/cursors cannot consume or replay a future push candidate.
const futureDm=await one("insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values($1,$2,gen_random_uuid(),'Future private message') returning *",[conversation,members[0]]);
const futureDmJobs=await claimAll(),futureDmJob=futureDmJobs.find(e=>e.job.subscription.endpoint===endpoint);assert.ok(futureDmJob);
await q('select read_chat_activity_notifications($1,$2,0,null,$3,$4,0,null)',[accounts[1],['main','social'],direct.seq,conversation]);
eq((await prepare(futureDmJob)).body,'Future private message');eq(await prepare(rich),null);eq((await inbox()).dmCount,1);
await q('select read_chat_activity_notifications($1,$2,0,null,$3,$4,0,null)',[accounts[1],['main','social'],futureDm.seq,conversation]);eq(await prepare(futureDmJob),null);eq((await inbox()).dms.find(d=>d.id===conversation).unread,0);
await q('update longboard_chat_conversations set recipient_read_seq=0 where id=$1',[conversation]);
await q('update longboard_chat_direct_messages set deleted_at=now() where id=$1',[direct.id]);eq(await prepare(rich),null);await q('update longboard_chat_direct_messages set deleted_at=null where id=$1',[direct.id]);
// Every supported room/category is metadata from the same authorized live notification row.
const roomJobs=[];
for(const room of ['main','social','shortscout'])for(const category of ['mention','reply']){
 const recipient=room==='shortscout'?accounts[2]:accounts[1];
 if(recipient===accounts[2]&&!(await one('select count(*) n from chat_push_subscriptions where account_id=$1',[recipient])).n)await q('select save_chat_push_subscription($1,$2,$3,$4)',[recipient,'https://web.push.apple.com/ss-synthetic','key','auth']);
 await q("update chat_push_subscriptions set preview_mode='message' where account_id=$1",[recipient]);
 const m=await one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Stored old name','Room private text',$2) returning *",[members[0],room]);
 const n=await one('insert into chat_room_mentions(account_id,message_id,room_slug,category) values($1,$2,$3,$4) returning id',[recipient,m.id,room,category]);
 const jobs=await claimAll();const entry=jobs.find(e=>e.job.url.includes('room='+room));assert.ok(entry);roomJobs.push({entry,m,n,room,category});
 data=await prepare(entry);eq([data.room,data.category,data.sender,data.body],[room,category,'Luke','Room private text']);
 await q("update chat_push_subscriptions set preview_mode='sender' where id=(select subscription_id from chat_push_jobs where id=$1)",[entry.job.id]);data=await prepare(entry);eq([data.room,data.category,data.sender],[room,category,'Luke']);eq('body' in data,false);eq('hasAttachments' in data,false);
 await q("update chat_push_subscriptions set preview_mode='off' where id=(select subscription_id from chat_push_jobs where id=$1)",[entry.job.id]);data=await prepare(entry);for(const key of ['sender','body','room','category','hasAttachments'])eq(key in data,false);
 await q("update chat_push_subscriptions set preview_mode='message' where id=(select subscription_id from chat_push_jobs where id=$1)",[entry.job.id]);
}
const reply=roomJobs.find(j=>j.room==='social'&&j.category==='reply');
await q('insert into chat_activity_preferences(account_id,replies) values($1,false)',[accounts[1]]);eq(await prepare(reply.entry),null);await q('update chat_activity_preferences set replies=true');
const roomBefore=await inbox(),observed=roomBefore.mentions.find(n=>n.id===reply.n.id);eq(observed.read,false);
await q('select read_visible_chat_notifications($1,$2,null,$3,$4,0)',[accounts[1],'social',[reply.m.id],observed.seq]);eq(await prepare(reply.entry),null);
const retained=(await inbox()).mentions.find(n=>n.id===reply.n.id);eq(retained.read,true);eq(retained.id,observed.id);
const futureRoom=await one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Luke','@LB member future room','social') returning *",[members[0]]);
const futureRoomEvent=await one('select id,seq from chat_room_mentions where message_id=$1 and account_id=$2',[futureRoom.id,accounts[1]]);
const futureRoomJobs=await claimAll(),futureRoomJob=futureRoomJobs.find(e=>e.job.url.includes(futureRoom.id));assert.ok(futureRoomJob);
await q('select read_chat_activity_notifications($1,$2,$3,$4,0,null,0,null)',[accounts[1],['main','social'],retained.seq,retained.id]);
eq((await prepare(futureRoomJob)).body,'@LB member future room');eq(await prepare(reply.entry),null);eq((await inbox()).mentions.find(n=>n.id===futureRoomEvent.id).read,false);
await q('select read_chat_activity_notifications($1,$2,$3,$4,0,null,0,null)',[accounts[1],['main','social'],futureRoomEvent.seq,futureRoomEvent.id]);eq(await prepare(futureRoomJob),null);eq((await inbox()).mentions.find(n=>n.id===futureRoomEvent.id).read,true);
await q('update chat_room_mentions set read_at=null where id=$1',[reply.n.id]);
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[members[1],members[0]]);eq(await prepare(reply.entry),null);await q('delete from longboard_chat_blocks');
await q("select change_chat_message($1,$2,'social','delete')",[accounts[0],reply.m.id]);eq(await prepare(reply.entry),null);
// Preserve existing 12-hour offline eligibility. A known denial suppresses a claimed push immediately.
const ss=roomJobs.find(j=>j.room==='shortscout');
await q("insert into chat_shortscout_authorization(subject,decision,membership_level,checked_at,valid_until) values('10000000-0000-4000-8000-000000000003','allow','mastermind',now()-interval '2 minutes',now()-interval '1 minute')");
eq((await one("select chat_account_has_room($1,'shortscout') value",[accounts[2]])).value,false);eq((await prepare(ss.entry)).room,'shortscout');
await q("update chat_shortscout_authorization set decision='deny',membership_level=null where subject='10000000-0000-4000-8000-000000000003'");eq(await prepare(ss.entry),null);
await q("update chat_shortscout_authorization set decision='allow',membership_level='mastermind',checked_at=now()-interval '12 hours',valid_until=now()-interval '11 hours' where subject='10000000-0000-4000-8000-000000000003'");eq(await prepare(ss.entry),null);
await q('delete from chat_push_subscriptions where endpoint=$1',[endpoint]);eq(await prepare(rich),null);
eq((await q("select column_name from information_schema.columns where table_name='chat_push_jobs'")).some(r=>/body|sender|preview|category|room/.test(r.column_name)),false);
eq(await definitions(),before);
console.log(`PASS ${checks} phone notification DB assertions: current published migration chain, additive metadata only after live target/privacy check, unchanged target/queue/claim/finish/subscription/read/history definitions, retained read rows never replay push and old cursors exclude future events, per-device privacy, current names and edited content, room/category mapping, service-only grants, lease/age/completion, accepted/unread/block/delete/reply preference/unsubscribe gates and preserved offline recipient expiry/known-deny behavior. Synthetic sequential PGlite; no real provider or production data.`);
await db.close();
