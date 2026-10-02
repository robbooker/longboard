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
let checks=0;const eq=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const denied=async(work,pattern)=>{await assert.rejects(work,pattern);checks++;};
const list=async(actor=accounts[0],room='main')=>(await one('select chat_room_message_pins_list($1,$2) value',[actor,room])).value;
const pin=async(id,active=true,room='main',actor=accounts[0])=>(await one('select set_chat_room_message_pin($1,$2,$3,$4) value',[actor,room,id,active])).value;
const message=async(body,room='main',parent=null)=>(await one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id) values($1,$1,'Original author',$2,$3,$4) returning *",[members[room==='main'||room==='social'?1:0],body,room,parent]));
const rootMessage=await message('Root pin text'),reply=await message('Nested pin','main',rootMessage.id),deep=await message('Deep pin','main',reply.id);
const beforeMessages=await q('select * from longboard_chat_messages order by id'),beforeReads=await q('select * from chat_room_reads order by account_id,room_slug');
const beforeEvents=await one('select (select count(*) from chat_room_mentions) mentions,(select count(*) from chat_reaction_notifications) reactions');
await db.exec('set role service_role');
eq((await pin(rootMessage.id)).pins[0].messageId,rootMessage.id);
eq((await list(accounts[1])).canManagePins,false);eq((await list()).canManagePins,true);
const first=(await list()).pins[0];eq(first.preview,'Root pin text');eq(first.authorLabel,'LB member');
eq((await pin(rootMessage.id)).pins[0].pinnedAt,first.pinnedAt);
eq((await pin(deep.id)).pins[0].replyToId,reply.id);
await denied(()=>pin(rootMessage.id,true,'main',accounts[1]),/admin_required/);
await denied(()=>pin(rootMessage.id,true,'social'),/message_not_found/);
eq((await list(accounts[1],'social')).pins,[]);
await denied(()=>list(accounts[2],'main'),/room_forbidden/);
await denied(()=>pin(rootMessage.id,true,'invalid'),/room_forbidden/);
await denied(()=>pin(crypto.randomUUID()),/message_not_found/);
await db.exec('reset role');
eq(await q('select * from longboard_chat_messages order by id'),beforeMessages);
eq(await q('select * from chat_room_reads order by account_id,room_slug'),beforeReads);
eq(await one('select (select count(*) from chat_room_mentions) mentions,(select count(*) from chat_reaction_notifications) reactions'),beforeEvents);
await q("update longboard_chat_messages set body='Edited current content' where id=$1",[rootMessage.id]);
await q("update longboard_chat_members set display_name='Current member' where id=$1",[members[1]]);
eq((await list()).pins.find(p=>p.messageId===rootMessage.id).preview,'Edited current content');
eq((await list()).pins.find(p=>p.messageId===rootMessage.id).authorLabel,'Current member');
// All eight rooms share the same pin permission, regardless of send policy or pause.
for(const room of ['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings']){
 const target=room==='gainers'?{id:(await one("select ingest_chat_gainers_alert('-100',1,now(),'Room gainers') value")).value.messageId}:await message('Room '+room,room);
 await q('update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$2 where room_slug=$1',[room,accounts[0]]);
 eq((await pin(target.id,true,room)).pins.some(p=>p.messageId===target.id),true);
 await pin(target.id,false,room);await pin(target.id,false,room);
 eq((await list(accounts[0],room)).pins.some(p=>p.messageId===target.id),false);
 await q('update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug=$1',[room]);
}
for(let n=0;n<8;n++)await pin((await message('Capacity '+n)).id);
const extra=await message('Over capacity');eq((await list()).pins.length,10);
await denied(()=>pin(extra.id),/pin_limit/);eq((await list()).pins.length,10);
await pin(deep.id,false);eq((await pin(extra.id)).pins.length,10);
await q("update chat_room_message_pins set pinned_at='2026-01-01 00:00:00+00'");
const tied=(await list()).pins.map(p=>p.messageId);eq(tied,[...tied].sort());
// Actual deletion RPC erases pins atomically, including retained parent tombstones.
await q('select change_chat_message($1,$2,$3,$4)',[accounts[1],rootMessage.id,'main','delete']);
eq((await one('select count(*) n from chat_room_message_pins where message_id=$1',[rootMessage.id])).n,0);
eq((await one('select removed from longboard_chat_messages where id=$1',[rootMessage.id])).removed,false);
await denied(()=>pin(rootMessage.id),/message_not_found/);
await q("select change_chat_message($1,$2,'main','edit','Deliberate replacement','Message deleted',false,1)",[accounts[1],rootMessage.id]);
eq((await list()).pins.some(p=>p.messageId===rootMessage.id),false);
await pin(deep.id);await q('delete from longboard_chat_messages where id=$1',[deep.id]);eq((await list()).pins.some(p=>p.messageId===deep.id),false);
// Source entitlement and administrator revocation are current, not cached.
eq((await list(accounts[2],'shortscout')).canManagePins,false);
await q("insert into chat_shortscout_authorization(subject,decision,membership_level,checked_at,valid_until) values('10000000-0000-4000-8000-000000000003','allow','mastermind',now(),now())");
await denied(()=>list(accounts[2],'shortscout'),/room_forbidden/);
await q("update profiles set role='user' where id=$1",[accounts[0]]);
await denied(()=>pin(extra.id,false),/admin_required/);eq((await list()).canManagePins,false);
for(const role of ['anon','authenticated']){
 await db.exec('set role '+role);
 await denied(()=>list(),/permission denied/);await denied(()=>pin(extra.id,false),/permission denied/);
 await denied(()=>q('select * from chat_room_message_pins'),/permission denied/);await db.exec('reset role');
}
eq((await one("select relrowsecurity enabled from pg_class where oid='chat_room_message_pins'::regclass")).enabled,true);
for(const name of ['chat_room_message_pins_list','set_chat_room_message_pin','remove_deleted_chat_message_pin']){const definition=await one('select prosecdef,proconfig from pg_proc where proname=$1',[name]);eq(definition.prosecdef,false);eq(definition.proconfig,['search_path=""']);}
// Removing the pinning account does not remove shared pins or retain its audit ID.
const otherAdmin=crypto.randomUUID();await q('insert into auth.users values($1)',[otherAdmin]);await q("insert into profiles values($1,'temporary@example.test','admin')",[otherAdmin]);await q('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[otherAdmin]);
await pin(rootMessage.id,true,'main',otherAdmin);await q('delete from chat_accounts where id=$1',[otherAdmin]);
eq((await one('select pinned_by from chat_room_message_pins where message_id=$1',[rootMessage.id])).pinned_by,null);eq((await list()).pins.some(p=>p.messageId===rootMessage.id),true);
console.log(`PASS ${checks} room-message pin DB assertions: all rooms/paused rooms, strict current access/admin, stable idempotency/limit/order, canonical edits/names, nested targets, unchanged messages/read/events, deletion/replacement/cascade and service-only privileges. Sequential PGlite; no native concurrent-session claim.`);
await db.close();
