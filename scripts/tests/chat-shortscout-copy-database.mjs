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
// A6: before the new migration, a recent answer and an old one, to check the carry-over.
await q("insert into chat_shortscout_authorization(subject,decision,membership_level,checked_at,valid_until) values('10000000-0000-4000-8000-000000000011','allow','mastermind',now()-interval '1 hour',now()-interval '59 minutes'),('10000000-0000-4000-8000-000000000012','allow','mastermind',now()-interval '30 hours',now()-interval '30 hours')");
await db.exec(await readFile(root+'/supabase/migrations/20261009150000_chat_shortscout_nightly_copy.sql','utf8'));
let checks=0;const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const access=async(account,room='shortscout',fn='chat_account_has_room')=>(await one(`select ${fn}($1,$2) value`,[account,room])).value;
const begin=async(account=accounts[2],session=token)=>(await one('select begin_chat_shortscout_renewal($1,$2) value',[account,session])).value;
const run=()=>crypto.randomUUID();
const sync=async(state='allow',level='mastermind',target=subject,id=run())=>{const start=(await one('select begin_chat_shortscout_sync($1,$2) value',[target,id])).value;equal(start.mode,'refresh');return (await one('select finish_chat_shortscout_sync($1,$2,$3,$4,$5) value',[target,id,start.generation,state,level])).value;};
const age=async(at=subject)=>(await one("select round(extract(epoch from valid_until-checked_at)/3600) h from chat_shortscout_authorization where subject=$1",[at])).h;
const shift=(hours,at=subject)=>q(`update chat_shortscout_authorization set checked_at=checked_at-interval '${hours} hours',valid_until=valid_until-interval '${hours} hours',requested_at=requested_at-interval '${hours} hours' where subject=$1`,[at]);
await q("update chat_shortscout_rollout set legacy_until=now()");
// Carry-over: today's answer gets the 36-hour lifetime; an older one waits for the first sync.
equal(Number(await age('10000000-0000-4000-8000-000000000011')),36);
equal((await one("select valid_until<now() v from chat_shortscout_authorization where subject='10000000-0000-4000-8000-000000000012'")).v,true);
// The request path only reads the copy: never 'refresh', and no copy means unavailable.
await q('delete from chat_shortscout_authorization where subject=$1',[subject]);
equal((await begin()).mode,'unavailable');equal(await access(accounts[2]),false);
equal((await one('select count(*)::int n from chat_shortscout_authorization where subject=$1',[subject])).n,0,'reading never reserves');
// A sync answer lasts 36 hours, for actors, offline candidates and badges alike.
equal(await sync(),true);equal(Number(await age()),36);
let state=await begin();equal([state.mode,state.decision,state.level],['ready','allow','mastermind']);
equal(await access(accounts[2]),true);equal(await access(accounts[1]),true,'bridged account follows the same copy');
await shift(35);equal(await access(accounts[2]),true,'still valid after 35 hours');
equal(await access(accounts[2],'shortscout','chat_account_room_recipient_eligible'),true);
equal((await q('select chat_shortscout_paid_subjects($1) s',[[subject]])).map(r=>r.s),[subject]);
await shift(2);equal((await begin()).mode,'unavailable');equal(await access(accounts[2]),false);
equal(await access(accounts[2],'shortscout','chat_account_room_recipient_eligible'),false);
equal((await q('select chat_shortscout_paid_subjects($1) s',[[subject]])).length,0);
// An outage keeps the current copy; it never expires or extends it.
equal(await sync(),true);const before=(await one('select valid_until from chat_shortscout_authorization where subject=$1',[subject])).valid_until;
equal(await sync('unavailable',null),true);
equal((await one('select valid_until from chat_shortscout_authorization where subject=$1',[subject])).valid_until,before);
equal(await access(accounts[2]),true,'outage keeps access');
// A denial removes access at once and stands after it expires, until ShortScout says otherwise.
equal(await sync('deny',null),true);state=await begin();equal([state.mode,state.decision],['ready','deny']);
equal(await access(accounts[2]),false);equal(await access(accounts[2],'shortscout','chat_account_room_recipient_eligible'),false);
await shift(40);state=await begin();equal([state.mode,state.decision],['ready','deny'],'expired denial still denies');
equal(await sync('unavailable',null),true);equal(await access(accounts[2],'shortscout','chat_account_room_recipient_eligible'),false,'outage never clears a denial');
equal(await sync('allow','annual'),true);equal(await access(accounts[2]),false);equal(await access(accounts[2],'social'),true,'exact tiers still apply');
// Out-of-order answers: an older run's answer cannot overwrite a newer one.
const oldRun=run(),oldStart=(await one('select begin_chat_shortscout_sync($1,$2) value',[subject,oldRun])).value;
const newRun=run(),newStart=(await one('select begin_chat_shortscout_sync($1,$2) value',[subject,newRun])).value;
equal((await one('select finish_chat_shortscout_sync($1,$2,$3,$4,$5) value',[subject,newRun,newStart.generation,'allow','mastermind'])).value,true);
equal((await one('select finish_chat_shortscout_sync($1,$2,$3,$4,$5) value',[subject,oldRun,oldStart.generation,'deny',null])).value,false);
equal(await access(accounts[2]),true);
// A stale answer (ShortScout took longer than six seconds) is refused.
const slowRun=run(),slowStart=(await one('select begin_chat_shortscout_sync($1,$2) value',[subject,slowRun])).value;
await q("update chat_shortscout_authorization set requested_at=requested_at-interval '7 seconds' where subject=$1",[subject]);
equal((await one('select finish_chat_shortscout_sync($1,$2,$3,$4,$5) value',[subject,slowRun,slowStart.generation,'deny',null])).value,false);
equal(await access(accounts[2]),true);
// Sign-in still checks ShortScout live, and its answer gets the same 36 hours.
await q('delete from chat_shortscout_authorization where subject=$1',[subject]);
const r={state:hash(),code:hash(),challenge:'c'.repeat(43)};
await q("insert into chat_login_requests(state_hash,code_hash,challenge,subject,membership_level,return_room,link_user_id) values($1,$2,$3,$4,'mastermind','shortscout',null)",[r.state,r.code,r.challenge,subject]);
const loginStart=(await one('select begin_chat_login_authorization($1,$2,$3,null) value',[r.state,r.code,r.challenge])).value;
const login=(await one("select finish_chat_login_authorization($1,$2,$3,null,$4,$5,'allow','mastermind') value",[r.state,r.code,r.challenge,hash(),loginStart.generation])).value;
equal(login.sessionMaxAge,2592000);equal(Number(await age()),36);equal(await access(accounts[2]),true);
// Session and bridge revocation still win over a current copy.
await q('update chat_sessions set revoked_at=now() where token_hash=$1',[token]);equal((await begin()).mode,'invalid');
await q('update chat_sessions set revoked_at=null where token_hash=$1',[token]);
await q('select revoke_chat_shortscout_membership_link($1)',[accounts[1]]);equal((await begin(accounts[1],null)).mode,'absent');equal(await access(accounts[1]),false);
// The sync covers every known subject; LB-only accounts are unaffected.
const listed=(await q('select chat_shortscout_sync_subjects() s')).map(r=>r.s);
equal(listed.includes(subject)&&listed.includes(expiredSubject)&&listed.includes('10000000-0000-4000-8000-000000000012'),true);
equal((await begin(accounts[0],null)).mode,'absent');equal(await access(accounts[0]),true);
// Owners' Sync now is audited.
await q("insert into longboard_chat_admin_events(room_slug,owner_user_id,action) values('shortscout',$1,'shortscout_sync')",[accounts[0]]);checks++;
// Only the service role can run the new functions.
for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const query of [()=>q('select chat_shortscout_sync_subjects()'),()=>q('select begin_chat_shortscout_sync($1,$2)',[subject,run()]),()=>q("select finish_chat_shortscout_sync($1,$2,1,'allow','mastermind')",[subject,run()]),()=>q('select chat_shortscout_paid_subjects($1)',[[subject]])]){await assert.rejects(query,/permission denied/);checks++;}await db.exec('reset role');}
await db.close();console.log(`PASS ${checks} copy assertions: carry-over, read-only request path, 36-hour lifetime, outages keep the copy, denials stand, ordering, sign-in, revocation, sync coverage, audit, permissions.`);
