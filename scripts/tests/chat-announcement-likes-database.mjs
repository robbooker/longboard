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
const accounts=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
for(let i=0;i<2;i++){
 await db.query('insert into auth.users values($1)',[accounts[i]]);
 await db.query('insert into profiles values($1,$2,$3)',[accounts[i],`test${i}@example.test`,i===0?'admin':'user']);
 await db.query('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[accounts[i]]);
}
await db.query('insert into chat_accounts(id) values($1)',[accounts[2]]);
await db.query("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout','10000000-0000-4000-8000-000000000003',$1,'monthly')",[accounts[2]]);
await db.query("insert into user_tags values($1,'boardroom-cohort-1'),($2,'boardroom-cohort-2')",[accounts[0],accounts[1]]);
const members=[];
for(let i=0;i<3;i++) members.push((await db.query('select longboard_chat_link_member($1,$2,null) m',[accounts[i],['Admin','LB member','SS member'][i]])).rows[0].m.id);
const post=async(i,room)=>(await db.query("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,$2,'Admin','Announcement') returning id",[members[i],room])).rows[0].id;
const inbox=async(i,rooms)=>(await db.query('select chat_activity_inbox($1,$2) value',[accounts[i],rooms])).rows[0].value;
await assert.rejects(post(1,'lb-announcements'),/announcement_admin_only/);
await assert.rejects(post(2,'ss-announcements'),/announcement_admin_only/);
await assert.rejects(post(2,'lb-announcements'),/announcement_admin_only|chat_room_forbidden/);
const lb=await post(0,'lb-announcements'),ss=await post(0,'ss-announcements');
// Verify the exact independent guards that remain after removing the admin-only reaction trigger.
const triggers=(await db.query("select tgname from pg_trigger where tgrelid='longboard_chat_reactions'::regclass and not tgisinternal")).rows.map(r=>r.tgname);
assert.ok(triggers.includes('shortscout_reaction_admin'));assert.ok(triggers.includes('longboard_chat_reactions_require_open'));assert.ok(!triggers.includes('announcement_reaction_writer'));
const react=(i,message,active=true)=>db.query('insert into longboard_chat_reactions(message_id,guest_id,active) values($1,$2,$3) on conflict(message_id,guest_id) do update set active=excluded.active',[message,members[i],active]);
await react(1,lb);await react(2,ss);await react(0,lb);await react(0,ss);
await react(1,lb);assert.equal((await db.query('select count(*)::int n from longboard_chat_reactions where message_id=$1 and active',[lb])).rows[0].n,2);
await react(1,lb,false);assert.equal((await db.query('select count(*)::int n from longboard_chat_reactions where message_id=$1 and active',[lb])).rows[0].n,1);
await assert.rejects(react(1,ss),/chat_room_forbidden/);await assert.rejects(react(2,lb),/chat_room_forbidden/);
await db.query("delete from user_tags where user_id=$1",[accounts[1]]);await assert.rejects(react(1,lb),/chat_room_forbidden/);await assert.rejects(react(1,lb,false),/chat_room_forbidden/);await db.query("insert into user_tags values($1,'boardroom-cohort-2')",[accounts[1]]);
await db.query("update chat_provider_identities set verified_at=now()-interval '13 hours' where account_id=$1",[accounts[2]]);await assert.rejects(react(2,ss),/chat_room_forbidden/);await db.query("update chat_provider_identities set verified_at=now() where account_id=$1",[accounts[2]]);
for(const [message,room,member] of [[lb,'lb-announcements',1],[ss,'ss-announcements',2]]){
 await db.query('update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$1 where room_slug=$2',[accounts[0],room]);
 await assert.rejects(react(member,message),/longboard_chat_paused/);await assert.rejects(react(member,message,false),/longboard_chat_paused/);await assert.rejects(react(0,message),/longboard_chat_paused/);
 await db.query('update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug=$1',[room]);
}
for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(react(1,lb),/permission denied/);await db.exec('reset role');}
assert.equal((await inbox(1,['lb-announcements'])).mentionCount,1);
assert.equal((await inbox(2,['ss-announcements'])).mentionCount,1);
assert.equal((await inbox(1,['ss-announcements'])).mentionCount,0);
assert.equal((await inbox(2,['lb-announcements'])).mentionCount,0);
const snap=await inbox(1,['lb-announcements']);await db.query('select read_chat_activity($1,$2,$3)',[accounts[1],['lb-announcements'],snap.mentionThrough]);
await db.query("update longboard_chat_messages set body='Edited announcement' where id=$1",[lb]);
assert.equal((await inbox(1,['lb-announcements'])).mentionCount,0);
await assert.rejects(db.query("select reserve_chat_attachment($1,'ss-announcements','a.pdf','application/pdf',8)",[members[2]]),/announcement_admin_only/);
await assert.rejects(db.query("insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('lb-announcements','@Buddy','fake','buddy')"),/announcement_admin_only/);
await db.query('delete from longboard_chat_messages where id=$1',[ss]);assert.equal((await inbox(2,['ss-announcements'])).mentionCount,0);
await db.query("update profiles set role='user' where id=$1",[accounts[0]]);
await assert.rejects(db.query("select change_chat_message($1,$2,'lb-announcements','delete',null,null,true)",[accounts[0],lb]),/message_forbidden/);
await db.exec('set role authenticated');await assert.rejects(db.query('select * from chat_room_mentions'),/permission denied/);await db.exec('reset role');
await db.close();console.log('PASS eligible reader/admin reactions, idempotent count, unlike, cross-room/revoked/expired membership denial, paused like/unlike, browser write denial, announcement admin-only writes, membership recipients, private alerts, edit/read preservation, attachment/bot denial and revoked-admin delete denial.');
