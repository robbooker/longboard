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

let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const rename=async(actor,name)=>(await one('select chat_update_member_name($1,$2) value',[actor,name])).value;
await q("update profiles set role='user'");
const before=await q('select id,user_id,accepts_requests,created_at from longboard_chat_members order by id');
const tokens=await q('select id,token_hash from longboard_chat_guests order by id');
const identities=await q('select * from chat_provider_identities order by subject');
const rootMessage=(await one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Admin','Hello @LB member, keep this original name and body.','social') returning *",[members[0]]));
const reply=(await one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id) values($1,$1,'Admin','A historical reply.','social',$2) returning *",[members[0],rootMessage.id]));
const messages=await q('select * from longboard_chat_messages order by id');
const counts=await one('select (select count(*) from chat_room_mentions) mentions,(select count(*) from chat_reaction_notifications) reactions');
const cursors=await q('select * from chat_room_reads order by account_id,room_slug');
await db.exec('set role service_role');
const first=await rename(accounts[0],'  Alice   Baker  ');eq(first.display_name,'Alice Baker');eq(first.id,members[0]);eq(first.name_revision,1);
eq((await one('select display_name from longboard_chat_guests where id=$1',[members[0]])).display_name,'Alice Baker');
eq((await rename(accounts[0],'Alice Baker')).name_revision,1);
const second=await rename(accounts[0],"Anne-Marie O'Neill");eq(second.name_revision,2);eq(second.display_name,"Anne-Marie O'Neill");
eq((await rename(accounts[0],'Ｊｏｓé Li')).display_name,'José Li');
for(const name of ['', ' ', 'A', 'a'.repeat(29), '<script>', 'Buddy', 'LONGBOARD ADMIN', 'Fuck Trader', 'Trader SHIT']){await assert.rejects(()=>rename(accounts[0],name),/invalid_display_name/);checks++;}
for(const name of ['Scunthorpe','Dick Smith','Rob','Jammie','Ashit Patel'])eq((await rename(accounts[0],name)).display_name,name);
const collisionBefore=await one('select display_name,name_revision from longboard_chat_members where id=$1',[members[0]]);
await assert.rejects(()=>rename(accounts[0],'lb MEMBER'),/longboard_chat_member_name_idx/);checks++;
eq(await one('select display_name,name_revision from longboard_chat_members where id=$1',[members[0]]),collisionBefore);
eq((await one('select display_name from longboard_chat_guests where id=$1',[members[0]])).display_name,collisionBefore.display_name);
eq((await rename(accounts[1],'Bob Brooks')).id,members[1]);
eq((await rename(accounts[2],'Sam Scout')).id,members[2]);
await db.exec('reset role');
eq(await q('select id,user_id,accepts_requests,created_at from longboard_chat_members order by id'),before);
eq(await q('select id,token_hash from longboard_chat_guests order by id'),tokens);
eq(await q('select * from chat_provider_identities order by subject'),identities);
eq(await q('select * from longboard_chat_messages order by id'),messages);
eq(await one('select (select count(*) from chat_room_mentions) mentions,(select count(*) from chat_reaction_notifications) reactions'),counts);
eq(await q('select * from chat_room_reads order by account_id,room_slug'),cursors);
const activity=(await one("select chat_activity_inbox($1,array['social']) value",[accounts[1]])).value;
eq(activity.mentions.find(item=>item.messageId===rootMessage.id).author,'Ashit Patel');
eq(activity.mentions.find(item=>item.messageId===rootMessage.id).preview,rootMessage.body);
eq((await one('select longboard_chat_link_member($1,$2,null) value',[accounts[0],'Ignored new label'])).value.display_name,'Ashit Patel');
// Both providers still use the same canonical member; no identity merge is performed.
await q("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout','10000000-0000-4000-8000-000000000004',$1,'mastermind')",[accounts[0]]);
eq((await rename(accounts[0],'Alice Both')).id,members[0]);
await q("insert into chat_shortscout_authorization(subject,decision,membership_level,checked_at,valid_until) values('10000000-0000-4000-8000-000000000003','allow','mastermind',now(),now())");
await assert.rejects(()=>rename(accounts[2],'Expired Scout'),/member_required/);checks++;
eq((await one('select display_name from longboard_chat_members where id=$1',[members[2]])).display_name,'Sam Scout');
await assert.rejects(()=>rename(crypto.randomUUID(),'Foreign Actor'),/member_required/);checks++;
for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>rename(accounts[0],'Anonymous change'),/permission denied/);checks++;await db.exec('reset role');}
const definition=await one("select prosecdef,proconfig from pg_proc where proname='chat_update_member_name'");eq(definition.prosecdef,false);eq(definition.proconfig,['search_path=""']);
console.log(`PASS ${checks} name-update assertions: ordinary LB/SS/both identities, atomic collisions, normalized validation, monotonic/idempotent revisions, unchanged credentials/messages/read state/notification counts, current activity names, legacy link compatibility and service-only strict actor access.`);
await db.close();
