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
create table profiles(id uuid primary key,email text,role text,updated_at timestamptz not null default now());
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
 await db.query('insert into profiles(id,email,role) values($1,$2,$3)',[accounts[i],`test${i}@example.test`,i===0?'admin':'user']);
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
// The grant runs against the same published chat functions used by the API fixture.
const target='6ad10d99-fe91-4955-86fa-a893b9763573';
const unlinked='00000000-0000-4000-8000-000000000004';
await q('insert into auth.users values($1)',[unlinked]);
await q("insert into profiles(id,email,role) values($1,'unlinked@example.test','user')",[unlinked]);
const migration=await readFile(root+'/supabase/migrations/20261002203642_chat_jammie_administrator.sql','utf8');
await q('insert into auth.users values($1)',[target]);
await q("insert into profiles(id,email,role) values($1,'ojammie@gmail.com','user')",[target]);
await q('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[target]);
const targetMember=(await one("select longboard_chat_link_member($1,'Jammie Synthetic',null) m",[target])).m.id;
await q("update profiles set email='madspreadsheets@gmail.com' where id=$1",[accounts[0]]);
for(const file of ['20260916171034_private_chat_features.sql','20260916174554_chat_feature_notifications.sql','20260916210308_chat_feature_publish_approval.sql','20260928120621_chat_jammie_development_approval.sql'])await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));
// Same trusted email on another account cannot be promoted by the exact-ID seed.
await q("update profiles set email='ojammie@gmail.com' where id=$1",[accounts[1]]);
await q('insert into longboard_chat_owners(user_id) values($1)',[accounts[0]]);
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const denied=async(run,re)=>{await assert.rejects(run,re);checks++;};
const profile=()=>one('select role,updated_at from profiles where id=$1',[target]);
const controls=()=>q('select * from longboard_chat_owners order by user_id');
const featureMembers=()=>q('select * from chat_feature_members order by account_id');
const definitions=()=>q("select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid");
const otherProfiles=()=>q('select * from profiles where id<>$1 order by id',[target]);
const oldOwners=await controls(),oldFeatures=await featureMembers(),oldFunctions=await definitions(),oldOthers=await otherProfiles();
eq(oldFeatures.find(x=>x.account_id===target).role,'participant');
eq(oldFeatures.find(x=>x.account_id===target).can_approve_development,true);
eq((await profile()).role,'user');
for(const change of [
 "update profiles set email='changed@example.test' where id=$1",
 'update chat_accounts set longboard_user_id=null where id=$1',
 `update chat_accounts set longboard_user_id='${unlinked}' where id=$1`,
 'delete from chat_accounts where id=$1',
 'delete from auth.users where id=$1',
 'delete from profiles where id=$1'
]){
 await db.exec('begin');
 if(change.startsWith('delete from chat_accounts')||change.startsWith('delete from auth.users'))await q('delete from chat_feature_members where account_id=$1',[target]);
 await q(change,[target]);
 await denied(()=>db.exec(migration),/jammie_admin_trusted_association_mismatch/);
 await db.exec('rollback');eq((await profile()).role,'user');eq(await controls(),oldOwners);
}
// A failure after the profile write must roll that write back too.
await db.exec(`create function fixture_reject_owner() returns trigger language plpgsql as $$begin if new.user_id='${target}' then raise exception 'fixture_owner_insert_failure';end if;return new;end$$;
create trigger fixture_reject_owner before insert on longboard_chat_owners for each row execute function fixture_reject_owner();`);
await denied(()=>db.exec(migration),/fixture_owner_insert_failure/);eq((await profile()).role,'user');eq(await controls(),oldOwners);
await db.exec('drop trigger fixture_reject_owner on longboard_chat_owners;drop function fixture_reject_owner()');
// Case-normalized trusted email still matches the established exact association.
await q("update profiles set email='OJammie@GMAIL.com' where id=$1",[target]);
await db.exec(migration);
eq((await profile()).role,'admin');eq((await controls()).filter(x=>x.user_id===target).length,1);
const after=await profile(),afterOwners=await controls();await db.exec(migration);
eq(await profile(),after);eq(await controls(),afterOwners);
eq(await otherProfiles(),oldOthers);eq(await featureMembers(),oldFeatures);eq(await definitions(),oldFunctions);
for(const room of ['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings']){
 eq((await one('select chat_account_has_room($1,$2) allowed',[target,room])).allowed,true);
 eq((await one('select chat_account_room_recipient_eligible($1,$2) allowed',[target,room])).allowed,true);
}
eq((await one("select chat_account_has_room($1,'unknown') allowed",[target])).allowed,false);
const post=async(room,member=targetMember)=>(await one("select send_chat_attachment_message($1,$2,'Synthetic','Admin grant check',null,'{}',gen_random_uuid()) m",[member,room])).m;
for(const room of ['main','social','shortscout','lb-announcements','ss-announcements','lb-recordings','ss-recordings']){
 const m=await post(room);eq(m.room_slug,room);
 await q('select set_chat_room_message_pin($1,$2,$3,true)',[target,room,m.id]);
 eq((await one('select count(*)::int n from chat_room_message_pins where message_id=$1',[m.id])).n,1);
 await q('select set_chat_room_message_pin($1,$2,$3,false)',[target,room,m.id]);
 eq((await one('select count(*)::int n from chat_room_message_pins where message_id=$1',[m.id])).n,0);
}
const foreign=await post('main',members[1]);
const ownTarget=await post('main');
await denied(()=>q("select change_chat_message($1,$2,'main','delete',null,null,true,0)",[accounts[1],ownTarget.id]),/message_forbidden/);
await q("select change_chat_message($1,$2,'main','delete',null,null,true,0)",[target,foreign.id]);eq((await q('select id from longboard_chat_messages where id=$1',[foreign.id])).length,0);
const privateConversation=crypto.randomUUID();await q("insert into longboard_chat_conversations(id,requester_id,recipient_id,status) values($1,$2,$3,'accepted')",[privateConversation,members[0],members[1]]);
const privateMessage=await one("insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,'Private',gen_random_uuid()) returning id",[privateConversation,members[0]]);
await denied(()=>q("select longboard_chat_dm_message_action($1,$2,$3,'delete',0)",[target,privateConversation,privateMessage.id]),/conversation_not_found|message_forbidden/);
// Site/chat administration does not confer release ownership.
await denied(()=>q('select approve_chat_feature_release($1,$2,1,$3)',[target,crypto.randomUUID(),'a'.repeat(40)]),/owner_only/);
eq(await featureMembers(),oldFeatures);
for(const role of ['anon','authenticated']){
 await db.exec('set role '+role);await q("select set_config('request.jwt.claim.sub',$1,false)",[target]);
 await denied(()=>q('insert into longboard_chat_owners(user_id) values($1)',[accounts[1]]),/permission denied/);
 await db.exec('reset role');
}
console.log(`PASS ${checks} Jammie admin SQL assertions: guarded exact association, atomic rollback, idempotence, unrelated roles/owners/functions preserved, eight-room access, existing posting/pins/moderation, DM privacy and release-owner separation.`);
await db.close();
