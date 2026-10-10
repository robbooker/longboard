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
const expiredSubject='10000000-0000-4000-8000-000000000004',expiredAccount='00000000-0000-4000-8000-000000000004';
await q('insert into chat_accounts(id) values($1)',[expiredAccount]);
await q("insert into chat_provider_identities(provider,subject,account_id,membership_level,verified_at) values('shortscout',$1,$2,'mastermind',now()-interval '14 hours')",[expiredSubject,expiredAccount]);
await db.exec(await readFile(root+'/supabase/migrations/20261001190002_chat_shortscout_authorization.sql','utf8'));
await db.exec(await readFile(root+'/supabase/migrations/20261009150000_chat_shortscout_nightly_copy.sql','utf8'));
let checks=0;const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const begin=async(account,sessionHash)=>(await one('select begin_chat_shortscout_renewal($1,$2) value',[account,sessionHash])).value;
// P3: auth.sessions and the user columns the Longboard context reads.
await db.exec(`alter table auth.users add column deleted_at timestamptz, add column banned_until timestamptz;
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);`);
await db.exec(await readFile(root+'/supabase/migrations/20261010010000_chat_request_context.sql','utf8'));
await q("insert into chat_shortscout_authorization(subject,decision,membership_level,checked_at,valid_until) values($1,'allow','mastermind',now(),now()+interval '36 hours') on conflict(subject) do update set decision='allow',membership_level='mastermind',checked_at=now(),valid_until=now()+interval '36 hours',pending=false",[subject]);
const session=async user=>{const id=crypto.randomUUID();await q('insert into auth.sessions(id,user_id) values($1,$2)',[id,user]);return id;};
const lb=async(user,sess)=>(await one('select chat_longboard_request_context($1,$2) value',[user,sess])).value;
const chat=async token_hash=>(await one('select chat_session_request_context($1) value',[token_hash])).value;
const unauth={mode:'unauthenticated'};
// Longboard: one call returns the profile, Boardroom tag and the ShortScout copy, the same answer
// the separate renewal function gives.
const adminSession=await session(accounts[0]),memberSession=await session(accounts[1]);
equal(await lb(accounts[0],adminSession),{mode:'ok',user:{id:accounts[0],email:'test0@example.test',role:'admin'},boardroom:true,shortscout:{mode:'absent'}},'admin without ShortScout');
const linked=await lb(accounts[1],memberSession);
equal([linked.mode,linked.user.role,linked.boardroom],['ok','user',true],'linked member');
equal(linked.shortscout,await begin(accounts[1],null),'same copy answer as the renewal function');
equal([linked.shortscout.decision,linked.shortscout.binding.bridged],['allow',true],'bridged allow');
// The session must exist and belong to the user: signing out, another user's session, a
// session past its limit, a ban or a deleted user all end it.
equal(await lb(accounts[1],crypto.randomUUID()),unauth,'unknown session');
equal(await lb(accounts[1],adminSession),unauth,"another user's session");
await q('delete from auth.sessions where id=$1',[memberSession]);
equal(await lb(accounts[1],memberSession),unauth,'signed out');
const limited=await session(accounts[1]);await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[limited]);
equal(await lb(accounts[1],limited),unauth,'session past its limit');
await q("update auth.sessions set not_after=now()+interval '1 hour' where id=$1",[limited]);
equal((await lb(accounts[1],limited)).mode,'ok','session within its limit');
await q("update auth.users set banned_until=now()+interval '1 day' where id=$1",[accounts[1]]);
equal(await lb(accounts[1],limited),unauth,'banned');
await q("update auth.users set banned_until=now()-interval '1 day' where id=$1",[accounts[1]]);
equal((await lb(accounts[1],limited)).mode,'ok','ban over');
await q("update auth.users set deleted_at=now() where id=$1",[accounts[1]]);
equal(await lb(accounts[1],limited),unauth,'deleted user');
await q("update auth.users set deleted_at=null where id=$1",[accounts[1]]);
// A first visit creates the chat account; a missing profile creates nothing.
const fresh='00000000-0000-4000-8000-000000000021',noProfile='00000000-0000-4000-8000-000000000022';
await q('insert into auth.users(id) values($1),($2)',[fresh,noProfile]);
equal(await lb(noProfile,await session(noProfile)),{mode:'no_profile'},'no profile');
equal(await q('select id from chat_accounts where id=$1',[noProfile]),[],'no account without a profile');
await q("insert into profiles values($1,'fresh@example.test','user')",[fresh]);
const freshSession=await session(fresh);
equal(await lb(fresh,freshSession),{mode:'ok',user:{id:fresh,email:'fresh@example.test',role:'user'},boardroom:false,shortscout:{mode:'absent'}},'first visit');
equal(await q('select id,longboard_user_id from chat_accounts where id=$1',[fresh]),[{id:fresh,longboard_user_id:fresh}],'account created');
equal((await lb(fresh,freshSession)).mode,'ok','second visit');
// An existing account is never overwritten.
await q('update chat_accounts set longboard_user_id=null where id=$1',[fresh]);
await lb(fresh,freshSession);
equal(await q('select longboard_user_id from chat_accounts where id=$1',[fresh]),[{longboard_user_id:null}],'existing link kept');
equal((await lb(fresh,freshSession)).shortscout,{mode:'invalid'},'unlinked account is an invalid principal, as before');
await q('update chat_accounts set longboard_user_id=id where id=$1',[fresh]);
// Role and tag changes show on the next request.
await q("update profiles set role='admin' where id=$1",[fresh]);await q("insert into user_tags values($1,'boardroom-cohort-1')",[fresh]);
equal([(await lb(fresh,freshSession)).user.role,(await lb(fresh,freshSession)).boardroom],['admin',true],'role and tag changes');
await q("delete from user_tags where user_id=$1",[fresh]);await q("insert into user_tags values($1,'other-tag')",[fresh]);
equal((await lb(fresh,freshSession)).boardroom,false,'other tags do not count');

// Chat sign-in sessions.
const ss=await chat(token);
equal([ss.mode,ss.account,ss.longboard,ss.role,ss.boardroom],['ok',accounts[2],false,null,false],'ShortScout-only session');
equal(ss.shortscout,await begin(accounts[2],token),'same copy answer as the renewal function');
const linkedToken=hash();
await q("insert into chat_sessions(token_hash,account_id,expires_at) values($1,$2,now()+interval '12 hours')",[linkedToken,accounts[1]]);
const linkedChat=await chat(linkedToken);
equal([linkedChat.account,linkedChat.longboard,linkedChat.role,linkedChat.boardroom],[accounts[1],true,'user',true],'session on a linked account');
equal(linkedChat.shortscout,await begin(accounts[1],linkedToken),'linked copy answer');
await q("update profiles set role='admin' where id=$1",[accounts[1]]);
equal((await chat(linkedToken)).role,'admin','live profile role');
await q("update profiles set role='user' where id=$1",[accounts[1]]);
equal(await chat(hash()),unauth,'unknown token');
await q("update chat_sessions set expires_at=now()-interval '1 second' where token_hash=$1",[linkedToken]);
equal(await chat(linkedToken),unauth,'expired session');
await q("update chat_sessions set expires_at=now()+interval '1 hour',revoked_at=now() where token_hash=$1",[linkedToken]);
equal(await chat(linkedToken),unauth,'revoked session');
// An overdue copy reads as unavailable (SS waits for the sync), not as signed out.
await q("update chat_shortscout_authorization set valid_until=now()-interval '1 second' where subject=$1",[subject]);
equal((await chat(token)).shortscout.mode,'unavailable','overdue copy');
equal((await lb(accounts[1],limited)).mode,'ok','overdue copy keeps Longboard access');

// Only the server can call them; the session function only reads.
for(const fn of ['chat_longboard_request_context(uuid,uuid)','chat_session_request_context(text)'])
 equal((await q(`select has_function_privilege('anon','${fn}','execute') a,has_function_privilege('authenticated','${fn}','execute') b,has_function_privilege('service_role','${fn}','execute') c`))[0],{a:false,b:false,c:true},fn+' privileges');
equal((await q("select proname,provolatile,prosecdef from pg_proc where proname in ('chat_longboard_request_context','chat_session_request_context') order by 1")),[{proname:'chat_longboard_request_context',provolatile:'v',prosecdef:true},{proname:'chat_session_request_context',provolatile:'s',prosecdef:false}],'volatility and definer');
console.log(`chat request context database: ${checks} checks passed`);
