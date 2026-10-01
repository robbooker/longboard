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

for(const file of ['20261001170025_chat_notification_formatting.sql','20261001170041_chat_visible_notification_reads.sql','20261001190002_chat_shortscout_authorization.sql','20261001191605_chat_pinned_unread.sql'])await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const inbox=async actor=>(await one("select chat_activity_inbox($1,array['main','social','shortscout']) value",[actor])).value;
const pin=async(actor,id)=>(await one("select chat_pins($1,'pin',null,$2) value",[actor,id])).value;
const dm=async(sender,recipient)=>{const id=crypto.randomUUID();await q("insert into longboard_chat_conversations(id,requester_id,recipient_id,status) values($1,$2,$3,'accepted')",[id,sender,recipient]);return id;};
const send=async(conversation,sender,body='New unread message')=>(await one('insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,$3,gen_random_uuid()) returning *',[conversation,sender,body]));
const conversation=await dm(members[0],members[1]);
await db.exec('set role service_role');
eq((await inbox(accounts[0])).pinnedDmUnread,{});
await pin(accounts[0],conversation);eq((await inbox(accounts[0])).pinnedDmUnread,{[conversation]:0});
await db.exec('reset role');
await send(conversation,members[0]);eq((await inbox(accounts[0])).pinnedDmUnread[conversation],0);
const incoming=await send(conversation,members[1]);eq((await inbox(accounts[0])).pinnedDmUnread[conversation],1);
const second=await send(conversation,members[1]);eq((await inbox(accounts[0])).pinnedDmUnread[conversation],2);
const markersBefore=await one('select requester_read_seq,recipient_read_seq from longboard_chat_conversations where id=$1',[conversation]);
await inbox(accounts[0]);eq(await one('select requester_read_seq,recipient_read_seq from longboard_chat_conversations where id=$1',[conversation]),markersBefore);
await q("select read_chat_activity($1,array['social'],0,null,$2,$3)",[accounts[0],incoming.seq,conversation]);
eq((await inbox(accounts[0])).pinnedDmUnread[conversation],1);
await q("select longboard_chat_dm_message_action($1,$2,$3,'delete',0)",[accounts[1],conversation,second.id]);
eq((await inbox(accounts[0])).pinnedDmUnread[conversation],0);
eq((await inbox(accounts[1])).pinnedDmUnread,{});
for(const pair of [[members[0],members[1]],[members[1],members[0]]]){
 await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',pair);eq((await inbox(accounts[0])).pinnedDmUnread,{});await q('delete from longboard_chat_blocks');
}
for(const status of ['pending','declined']){await q('update longboard_chat_conversations set status=$1 where id=$2',[status,conversation]);eq((await inbox(accounts[0])).pinnedDmUnread,{});}
await q("update longboard_chat_conversations set status='accepted' where id=$1",[conversation]);
await q('delete from profiles where id=$1',[accounts[1]]);eq((await inbox(accounts[0])).pinnedDmUnread,{});
await q("insert into profiles values($1,'member@example.test','user')",[accounts[1]]);
await q("select chat_pins($1,'unpin',null,$2)",[accounts[0],conversation]);eq((await inbox(accounts[0])).pinnedDmUnread,{});
await pin(accounts[0],conversation);
// A pinned conversation older than the 100 listed previews retains its full count.
await send(conversation,members[1]);
const extra=[];
for(let i=0;i<101;i++){
 const account=crypto.randomUUID();await q('insert into auth.users values($1)',[account]);await q("insert into profiles values($1,$2,'user')",[account,`other${i}@example.test`]);await q('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[account]);
 const member=(await one('select longboard_chat_link_member($1,$2,null) value',[account,`Other ${i}`])).value.id;
 const id=await dm(members[0],member);await send(id,member);extra.push(id);if(i<49)await pin(accounts[0],id);
}
const many=await inbox(accounts[0]);eq(many.dms.length,100);eq(many.dms.some(row=>row.id===conversation),false);eq(many.pinnedDmUnread[conversation],1);eq(Object.keys(many.pinnedDmUnread).length,50);eq(many.dmCount,102);
// Foreign saved IDs never reveal participant counts, even if injected as service data.
await q('insert into chat_conversation_pins(account_id,conversation_id) values($1,$2)',[accounts[2],conversation]);eq((await inbox(accounts[2])).pinnedDmUnread,{});
const privateDm=await dm(members[1],members[2]);await pin(accounts[1],privateDm);await pin(accounts[2],privateDm);await send(privateDm,members[2]);
const subject='10000000-0000-4000-8000-000000000003';
await q("insert into chat_shortscout_authorization(subject,decision,membership_level,checked_at,valid_until) values($1,'allow','mastermind',now(),now())",[subject]);
eq((await inbox(accounts[2])).pinnedDmUnread,{});eq((await inbox(accounts[1])).pinnedDmUnread[privateDm],1,'offline recipient window does not grant actor access');
await q("update chat_shortscout_authorization set decision='deny',membership_level=null where subject=$1",[subject]);eq((await inbox(accounts[1])).pinnedDmUnread,{});
await q('delete from longboard_chat_conversations where id=$1',[conversation]);eq((await inbox(accounts[0])).pinnedDmUnread[conversation],undefined);
await db.exec('reset role');
for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>inbox(accounts[0]),/permission denied/);checks++;await db.exec('reset role');}
eq((await one("select prosecdef from pg_proc where proname='chat_activity_inbox'")).prosecdef,false);
console.log(`PASS ${checks} pinned unread assertions: complete bounded counts, explicit zero, incoming/read/deletion, unchanged markers, truncated previews, account isolation, participants, blocks, status, strict SS actor and offline recipient eligibility.`);
await db.close();
