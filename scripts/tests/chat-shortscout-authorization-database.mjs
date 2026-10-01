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

const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>(await q(sql,args))[0];
const hash=()=>crypto.randomUUID().replaceAll('-','').repeat(2);
const subject='10000000-0000-4000-8000-000000000003',token=hash();
await q("insert into chat_sessions(token_hash,account_id,expires_at) values($1,$2,now()+interval '12 hours')",[token,accounts[2]]);
async function handoff(level='mastermind',room='shortscout',link=null){const r={state:hash(),code:hash(),challenge:'c'.repeat(43),subject,level,room,link};await q('insert into chat_login_requests(state_hash,code_hash,challenge,subject,membership_level,return_room,link_user_id) values($1,$2,$3,$4,$5,$6,$7)',[r.state,r.code,r.challenge,subject,level,room,link]);return r;}
const consume=async r=>(await one('select consume_chat_login($1,$2,$3,$4,$5) value',[r.state,r.code,r.challenge,r.link,hash()])).value;
await consume(await handoff('mastermind','social',accounts[1]));
await db.exec(await readFile(root+'/supabase/migrations/20261001190002_chat_shortscout_authorization.sql','utf8'));
let checks=0;const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const access=async(account,room='shortscout',fn='chat_account_has_room')=>(await one(`select ${fn}($1,$2) value`,[account,room])).value;
const begin=async(account=accounts[2],session=token)=>(await one('select begin_chat_shortscout_renewal($1,$2) value',[account,session])).value;
const finish=async(start,state='allow',level='mastermind',account=accounts[2],session=token)=>(await one('select finish_chat_shortscout_renewal($1,$2,$3,$4,$5,$6) value',[account,session,subject,start.generation,state,level])).value;
const expire=()=>q("update chat_shortscout_authorization set valid_until=now(),retry_after=null,requested_at=now()-interval '7 seconds' where subject=$1",[subject]);
// Migration supports the existing backend, with immutable captured proof horizons.
equal(await access(accounts[2]),true);equal(await access(accounts[1]),true);
await q('update chat_shortscout_legacy_access set expires_at=now() where subject=$1',[subject]);
await consume(await handoff());equal(await access(accounts[2]),false,'old callback cannot reset captured expiry');
await q("update chat_shortscout_legacy_access set expires_at=now()+interval '1 hour' where subject=$1",[subject]);
await q('update chat_shortscout_rollout set legacy_until=now()');equal(await access(accounts[2]),false);
await q("update chat_shortscout_rollout set legacy_until=now()+interval '24 hours'");equal(await access(accounts[2]),true);
// New app opts into managed authorization immediately, including when source fails.
let first=await begin();equal(first.mode,'refresh');equal(await access(accounts[2]),false);
equal(await finish(first,'unavailable',null),true);equal((await begin()).mode,'unavailable');equal(await access(accounts[2]),false);
await expire();first=await begin();equal(await finish(first),true);equal((await begin()).mode,'ready');equal(await access(accounts[2]),true);
equal((await one('select chat_shortscout_authorized_identity($1) value',[accounts[1]])).value.membership_level,'mastermind');
// Strict actor freshness does not silently remove offline notification candidates.
await expire();equal(await access(accounts[2]),false);equal(await access(accounts[2],'shortscout','chat_account_room_recipient_eligible'),true);
// Shared DB generation defeats out-of-order responses from different app instances.
const older=await begin();equal((await begin()).mode,'pending');await expire();const newer=await begin();
equal(await finish(newer,'deny',null),true);equal(await finish(older),false);
equal(await access(accounts[2]),false);equal(await access(accounts[2],'shortscout','chat_account_room_recipient_eligible'),false);
await expire();const unknown=await begin();equal(await finish(unknown,'unavailable',null),true);
equal(await access(accounts[2],'shortscout','chat_account_room_recipient_eligible'),false,'outage never clears known denial');
// Old one-use callbacks can update login display snapshots, never current proof.
await consume(await handoff());equal(await access(accounts[2]),false);equal(await access(accounts[2],'shortscout','chat_account_room_recipient_eligible'),false);
await expire();const late=await begin();await expire();equal(await finish(late),false,'proof cannot arrive after its lease');
const paid=await begin();equal(await finish(paid,'allow','annual'),true);
equal(await access(accounts[2]),false);equal(await access(accounts[2],'social'),true);equal(await access(accounts[1],'main'),true);
// Session and association are rechecked after source transport; never revive either.
await expire();const pending=await begin();await q('update chat_sessions set revoked_at=now() where token_hash=$1',[token]);
equal(await finish(pending),false);equal((await begin()).mode,'invalid');
await q('update chat_sessions set revoked_at=null,expires_at=now() where token_hash=$1',[token]);equal((await begin()).mode,'invalid');
await q("update chat_sessions set expires_at=now()+interval '1 hour' where token_hash=$1",[token]);
await expire();const bridged=await begin(accounts[1],null);
const oldLink=await handoff('mastermind','social',accounts[1]);
await q('select revoke_chat_shortscout_membership_link($1)',[accounts[1]]);
equal(await finish(bridged,'allow','mastermind',accounts[1],null),false);equal((await begin(accounts[1],null)).mode,'absent');
await assert.rejects(()=>consume(oldLink),/link_session_changed/);checks++;
equal(await access(accounts[1]),false);
await consume(await handoff('mastermind','social',accounts[1]));
// Handoff itself gets a new source check; only its freshly minted token gets 30 days.
const loginStart=async r=>(await one('select begin_chat_login_authorization($1,$2,$3,$4) value',[r.state,r.code,r.challenge,r.link])).value;
const loginFinish=async(r,start,state,level,sessionHash=hash())=>(await one('select finish_chat_login_authorization($1,$2,$3,$4,$5,$6,$7,$8) value',[r.state,r.code,r.challenge,r.link,sessionHash,start.generation,state,level])).value;
const downgraded=await handoff(),downgradeStart=await loginStart(downgraded);
equal((await loginFinish(downgraded,downgradeStart,'allow','monthly')).error,'insufficient_membership');
equal(await access(accounts[2]),false);equal(await access(accounts[2],'social'),true);
const denied=await handoff(),denialStart=await loginStart(denied);equal((await loginFinish(denied,denialStart,'deny',null)).error,'insufficient_membership');
equal(await access(accounts[2],'social'),false);
const fresh=await handoff(),freshStart=await loginStart(fresh),issued=hash();
const oldExpiry=(await one('select expires_at from chat_sessions where token_hash=$1',[token])).expires_at;
const result=await loginFinish(fresh,freshStart,'allow','mastermind',issued);equal(result.sessionMaxAge,2592000);
equal((await one('select extract(epoch from expires_at-created_at)::int age from chat_sessions where token_hash=$1',[issued])).age,2592000);
equal((await one('select expires_at from chat_sessions where token_hash=$1',[token])).expires_at,oldExpiry);
await assert.rejects(()=>loginFinish(fresh,freshStart,'allow','mastermind'),/invalid_login_handoff/);checks++;
const raced=await handoff(),raceOld=await loginStart(raced),raceNew=await loginStart(raced);
equal((await loginFinish(raced,raceOld,'allow','mastermind')).error,'login_expired');
equal((await loginFinish(raced,raceNew,'deny',null)).error,'insufficient_membership');equal(await access(accounts[2]),false);
// LB/admin permissions remain independently authoritative, never inferred from SS.
equal((await begin(accounts[0],null)).mode,'absent');equal(await access(accounts[0]),true);equal(await access(accounts[1],'main'),true);
for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const query of [()=>begin(),()=>q('select * from chat_shortscout_authorization'),()=>q('select * from chat_shortscout_legacy_access'),()=>q('select chat_account_room_recipient_eligible($1,$2)',[accounts[2],'shortscout'])]){await assert.rejects(query,/permission denied/);checks++;}await db.exec('reset role');}
await db.close();console.log(`PASS ${checks} authorization assertions: bounded legacy rollout, strict actor/offline split, source unknown/deny, DB-wide CAS, delayed handoffs, session/bridge revocation, exact tiers and new-token-only absolute persistence.`);
