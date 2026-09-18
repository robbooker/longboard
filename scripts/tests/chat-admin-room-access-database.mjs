import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const db = new PGlite({extensions:{vector}});
const hash = () => randomBytes(32).toString('hex');
const challenge = () => randomBytes(32).toString('base64url');
const rows = async (q, args=[]) => (await db.query(q,args)).rows;
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create table public.profiles(id uuid primary key references auth.users(id),email text,role text);
create schema extensions;
grant usage on schema extensions to service_role,authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
create publication supabase_realtime;
alter default privileges in schema public grant all on tables to service_role;
grant usage on schema public,auth to service_role;
grant select on public.profiles to service_role;`);
const lb = randomUUID();
await rows('insert into auth.users values($1)',[lb]);
await rows("insert into profiles values($1,'test@example.invalid','user')",[lb]);
for (const file of ['20260827135528_public_chat_guest_room.sql','20260901125001_longboard_chat_admin_buddy.sql','20260915115419_chat_member_direct_messages.sql','20260915204338_chat_social_room.sql','20260915225504_member_chat_search.sql','20260915231144_chat_semantic_search.sql','20260915232125_chat_shortscout_admin_room.sql']) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/20260916142421_shared_chat_login.sql',import.meta.url),'utf8'));

await db.exec(`create table public.user_tags(user_id uuid,tag text);grant select on public.profiles,public.user_tags to authenticated,service_role;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
for(const file of ['20260916160122_chat_message_actions.sql','20260916211649_chat_room_summary_inbox.sql','20260916213912_chat_activity_notifications.sql','20260917030546_chat_attachments.sql','20260917135451_chat_announcement_rooms.sql','20260917202524_chat_boardroom_access.sql'])await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
await rows("update profiles set role='admin' where id=$1",[lb]);await rows("insert into user_tags values($1,'boardroom-cohort-1')",[lb]);
await db.exec('set role service_role');
let checks=0;const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
async function handoff(level='mastermind',room='shortscout',link=null,subject=randomUUID()){
 const r={state:hash(),code:hash(),challenge:challenge(),subject,link};
 await rows('insert into chat_login_requests(state_hash,challenge,link_user_id,return_room,subject,membership_level,code_hash) values($1,$2,$3,$4,$5,$6,$7)',[r.state,r.challenge,r.link,room,r.subject,level,r.code]);return r;
}
const consume=async r=>(await rows('select consume_chat_login($1,$2,$3,$4,$5) as value',[r.state,r.code,r.challenge,r.link,hash()]))[0].value;
const access=async(account,room)=>(await rows('select chat_account_has_room($1,$2) as allowed',[account,room]))[0].allowed;
const post=async(room,member)=>(await rows("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,$2,'Test member','hello') returning id",[member,room]))[0].id;
await db.exec('reset role');
for(const file of ['20260918141732_chat_ss_mastermind_access.sql','20260918160518_chat_admin_public_room_access.sql','20260916171034_private_chat_features.sql'])await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
await rows('delete from user_tags where user_id=$1',[lb]);
await db.exec('set role service_role');
const member=(await rows("select longboard_chat_link_member($1,'Admin member',null) as m",[lb]))[0].m;
const rooms=['main','social','shortscout','lb-announcements','ss-announcements'];
check((await rows('select count(*)::int n from chat_provider_identities where account_id=$1',[lb]))[0].n,0);
const messages=[];
for(const room of rooms){check(await access(lb,room),true);messages.push(await post(room,member.id));checks++;}
for(const room of ['unknown','features','dm','',null])check(await access(lb,room),false);
await assert.rejects(()=>rows("select chat_feature_action($1,null,'create','Private attempt',0)",[lb]),/feature_access_denied/);checks++;
// Browser RLS uses current profile role, never client metadata.
await db.exec('reset role;set role authenticated');await rows("select set_config('request.jwt.claim.sub',$1,false)",[lb]);
for(const id of messages)check((await rows('select id from longboard_chat_messages where id=$1',[id])).length,1);
await assert.rejects(()=>rows('select chat_account_has_room($1,$2)',[lb,'shortscout']),/permission denied/);checks++;
await db.exec('reset role');await rows("update profiles set role='user' where id=$1",[lb]);await db.exec('set role service_role');
for(const room of ['main','shortscout','lb-announcements','ss-announcements'])check(await access(lb,room),false);
check(await access(lb,'social'),true);
await assert.rejects(()=>post('shortscout',member.id),/chat_room_forbidden/);checks++;
await db.exec('reset role;set role authenticated');await rows("select set_config('request.jwt.claim.sub',$1,false)",[lb]);
for(const id of [messages[0],messages[2],messages[3],messages[4]])check((await rows('select id from longboard_chat_messages where id=$1',[id])).length,0);
await db.exec('reset role;set role service_role');
for(const level of ['monthly','annual','lifetime']){const account=await consume(await handoff(level,'social'));check(await access(account.accountId,'shortscout'),false);check(await access(account.accountId,'social'),true);}
const mastermind=await consume(await handoff());check(await access(mastermind.accountId,'shortscout'),true);check(await access(mastermind.accountId,'main'),false);
await db.exec('reset role');await rows("insert into user_tags values($1,'boardroom-cohort-1')",[lb]);await db.exec('set role service_role');check(await access(lb,'main'),true);check(await access(lb,'shortscout'),false);
await db.close();console.log(`PASS ${checks} admin public-room SQL assertions`);
