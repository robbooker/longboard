// Synthetic local database; no production connection or credentials.
import {recordingMigrations} from './chat-recordings-migrations.mjs';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const root=new URL('../../',import.meta.url).pathname;
export const inboxEfficiencyMigration='20261005180236_chat_inbox_history_efficiency.sql';
// Resolves room access once per bell call instead of once per row; results must not change.
export const roomAccessOnceMigration='20261007210000_chat_activity_room_access_once.sql';
export async function createInboxFixture({optimized=true}={}) {
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

// Keep the published definition as an independent local differential oracle.
const original=await readFile(root+'/supabase/migrations/20261002152103_chat_notification_list.sql','utf8');
await db.exec(original.slice(original.indexOf('create or replace function public.chat_activity_inbox')).replace('public.chat_activity_inbox(', 'public.chat_activity_inbox_baseline('));
if(optimized){
 await db.exec(await readFile(root+'/supabase/migrations/'+inboxEfficiencyMigration,'utf8'));
 await db.exec(await readFile(root+'/supabase/migrations/'+roomAccessOnceMigration,'utf8'));
}
return {db,root,accounts,members,q,one};
}
