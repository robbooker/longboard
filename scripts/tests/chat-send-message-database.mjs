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

for(const file of ['20261001170025_chat_notification_formatting.sql','20261001170041_chat_visible_notification_reads.sql'])await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));

const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>(await q(sql,args))[0];
const hash=()=>crypto.randomUUID().replaceAll('-','').repeat(2);
const subject='10000000-0000-4000-8000-000000000003',token=hash();
await q("insert into chat_sessions(token_hash,account_id,expires_at) values($1,$2,now()+interval '12 hours')",[token,accounts[2]]);
async function handoff(level='mastermind',room='shortscout',link=null){const r={state:hash(),code:hash(),challenge:'c'.repeat(43),subject,level,room,link};await q('insert into chat_login_requests(state_hash,code_hash,challenge,subject,membership_level,return_room,link_user_id) values($1,$2,$3,$4,$5,$6,$7)',[r.state,r.code,r.challenge,subject,level,room,link]);return r;}
const consume=async r=>(await one('select consume_chat_login($1,$2,$3,$4,$5) value',[r.state,r.code,r.challenge,r.link,hash()])).value;
await consume(await handoff('mastermind','social',accounts[1]));
await db.exec(await readFile(root+'/supabase/migrations/20261001190002_chat_shortscout_authorization.sql','utf8'));
await db.exec(await readFile(root+'/supabase/migrations/20261009150000_chat_shortscout_nightly_copy.sql','utf8'));
await db.exec(await readFile(root+'/supabase/migrations/20261012120000_chat_send_message.sql','utf8'));
await q("insert into chat_shortscout_authorization(subject,decision,membership_level,checked_at,valid_until) values($1,'allow','mastermind',now(),now()+interval '36 hours') on conflict(subject) do update set decision='allow',membership_level='mastermind',checked_at=now(),valid_until=now()+interval '36 hours',pending=false",[subject]);
let checks=0;const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const id=()=>crypto.randomUUID();
const send=async(user,{room='main',body='Hello',reply=null,files=[],client=id()}={})=>(await one('select send_chat_room_message($1,$2,$3,$4,$5,$6) value',[user,room,body,reply,files,client])).value;
const count=async()=>Number((await one('select count(*) n from longboard_chat_messages')).n);
// Move a member's earlier sends out of the rate-limit window, as if time had passed.
const later=async member=>q("update longboard_chat_messages set created_at=created_at-interval '11 minutes' where guest_id=$1",[member]);

// A send returns the stored row with the current name and the badges, in one call.
const first=await send(accounts[1],{client:'20000000-0000-4000-8000-000000000001'});
equal([first.status,first.message.member_id,first.message.room_slug,first.message.body,first.message.author_label],['sent',members[1],'main','Hello','LB member'],'sent as the verified member');
equal(first.message.memberships,['LB','SS'],'Longboard and ShortScout copy badges');
await later(members[0]);
equal((await send(accounts[0])).message.memberships,['LB'],'no ShortScout badge without the copy');

// Same clientId: the stored message comes back once; anything different is a conflict.
await later(members[1]);
const before=await count();
const retry=await send(accounts[1],{client:'20000000-0000-4000-8000-000000000001'});
equal([retry.status,retry.message.id,await count()],['duplicate',first.message.id,before],'retry returns the first send');
equal((await send(accounts[1],{client:'20000000-0000-4000-8000-000000000001',body:'Other'})).status,'send_conflict','different body');
equal((await send(accounts[1],{client:'20000000-0000-4000-8000-000000000001',room:'social'})).status,'send_conflict','different room');
equal((await send(accounts[1],{client:'20000000-0000-4000-8000-000000000001',reply:first.message.id})).status,'send_conflict','different reply');
await q("update longboard_chat_messages set body='Edited',edited_at=now() where id=$1",[first.message.id]);
equal((await send(accounts[1],{client:'20000000-0000-4000-8000-000000000001'})).status,'duplicate','a retry after an edit is the same send');
// Another member may reuse the clientId.
await later(members[0]);
equal((await send(accounts[0],{client:'20000000-0000-4000-8000-000000000001'})).status,'sent','clientIds are per member');

// Reply parents: same room and not removed.
await later(members[1]);
const reply=await send(accounts[1],{reply:first.message.id,body:'Reply'});
equal([reply.status,reply.message.reply_to_id],['sent',first.message.id],'reply to a visible parent');
for(const [parent,room,why] of [[id(),'main','missing'],[first.message.id,'social','other room']]){
 await later(members[1]);
 equal((await send(accounts[1],{reply:parent,room})).status,'reply_not_found',why);
}
await q('update longboard_chat_messages set removed=true where id=$1',[reply.message.id]);
equal((await send(accounts[1],{reply:reply.message.id})).status,'reply_not_found','removed parent');

// S2: the rate limit is read and recorded under one lock per member.
await later(members[1]);
equal((await send(accounts[1])).status,'sent','first of a pair');
equal((await send(accounts[1])).status,'rate_limited','second within 1.5 s');
equal((await send(accounts[1])).reason,'burst','burst reason');
await later(members[1]);
for(let i=0;i<30;i++)await q("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,created_at) values($1,$1,'main','LB member','Backlog',now()-interval '5 minutes')",[members[1]]);
const busy=await send(accounts[1]);
equal([busy.status,busy.reason],['rate_limited','window'],'30 in ten minutes');
await later(members[1]);
equal((await send(accounts[1])).status,'sent','window passed');

// Paused room, unknown member, missing room state: nothing is written.
await later(members[1]);
await q("update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$1,pause_reason='  Back soon  ' where room_slug='main'",[accounts[0]]);
const n=await count();
const paused=await send(accounts[1]);
equal([paused.status,paused.room.isOpen,paused.room.notice,typeof paused.room.pausedAt,await count()],['paused',false,'Back soon','string',n],'paused room');
equal((await send(accounts[1],{room:'social'})).status,'sent','other rooms stay open');
await q("update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null,pause_reason=null where room_slug='main'");
equal((await send('00000000-0000-4000-8000-000000000009')).status,'member_required','no member');
equal((await send(accounts[1],{room:'no-such-room'})).status,'room_unavailable','no room state');
equal(await count(),n+1,'only the open-room send was written');

// The insert triggers still apply: an attachment that isn't ready aborts the send.
await later(members[1]);
await assert.rejects(send(accounts[1],{files:[id()]}),/attachment_/);checks++;
await assert.rejects(one('select send_chat_room_message($1,$2,$3,$4,$5,null)',[accounts[1],'main','x',null,[]]),/client_id_required/);checks++;

// Only the server (service_role) may call it.
for(const role of ['anon','authenticated'])
 equal((await one("select has_function_privilege($1,'public.send_chat_room_message(uuid,text,text,uuid,uuid[],uuid)','execute') ok",[role])).ok,false,role);
equal((await one("select has_function_privilege('service_role','public.send_chat_room_message(uuid,text,text,uuid,uuid[],uuid)','execute') ok")).ok,true,'service_role');
console.log(`chat send database: ${checks} checks passed`);
