import {randomUUID,randomBytes} from 'node:crypto';
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

for(const file of ['20260916142421_shared_chat_login.sql','20260916160122_chat_message_actions.sql','20260916213912_chat_activity_notifications.sql','20260917135451_chat_announcement_rooms.sql']) await db.exec(await readFile(`${root}/supabase/migrations/${file}`,'utf8'));
for(const file of ['20260917195530_chat_room_unread.sql','20260918141732_chat_ss_mastermind_access.sql','20260918160518_chat_admin_public_room_access.sql','20260919172700_chat_favorite.sql','20260921192000_chat_gainers_broadcast.sql'])await db.exec(await readFile(`${root}/supabase/migrations/${file}`,'utf8'));
await db.exec(await readFile(`${root}/supabase/migrations/20260921202321_chat_shortscout_membership_links.sql`,'utf8'));
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const hash=()=>randomBytes(32).toString('hex');
async function lbAccount(){const id=randomUUID();await rows('insert into auth.users values($1)',[id]);await rows("insert into profiles values($1,'fixture@example.invalid','user')",[id]);await rows('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[id]);return id;}
const lb=await lbAccount(),other=await lbAccount();
await rows("insert into user_tags values($1,'boardroom-cohort-1')",[lb]);
await db.exec('set role service_role');
async function handoff(subject=randomUUID(),link=null,level='mastermind',room='social',expected=null){const r={state:hash(),code:hash(),challenge:randomBytes(32).toString('base64url'),subject,link};await rows('insert into chat_login_requests(state_hash,code_hash,challenge,subject,membership_level,return_room,link_user_id,expected_subject) values($1,$2,$3,$4,$5,$6,$7,$8)',[r.state,r.code,r.challenge,subject,level,room,link,expected]);return r;}
async function consume(r,override={}){const v={...r,...override};return (await rows('select consume_chat_login($1,$2,$3,$4,$5) result',[v.state,v.code,v.challenge,v.link,hash()]))[0].result;}
const initial=await handoff(),ss=(await consume(initial)).accountId;
const member=async(id,name)=>(await rows('select longboard_chat_link_member($1,$2,null) m',[id,name]))[0].m.id;
const lbMember=await member(lb,'LB history'),ssMember=await member(ss,'SS history'),otherMember=await member(other,'Counterpart');
for(const [actor,room]of [[lbMember,'main'],[ssMember,'shortscout']])await rows("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,$2,'Historic member','Preserve original room history')",[actor,room]);
const dm=async(account,action,target,body=null)=>(await rows('select longboard_chat_dm_action($1,$2,$3,$4,$5,null) result',[account,action,target,body,randomUUID()]))[0].result;
for(const account of [lb,ss]){const conversation=(await dm(account,'request',otherMember,'Original private history')).conversationId;await dm(other,'accept',conversation);await dm(account,'send',conversation,'Keep distinct conversation');}
const snapshot=async()=>{const v={};for(const table of ['longboard_chat_members','longboard_chat_guests','longboard_chat_messages','longboard_chat_conversations','longboard_chat_direct_messages','longboard_chat_reactions'])v[table]=await rows(`select * from ${table} order by 1`);return JSON.stringify(v);};
const before=await snapshot();
const linked=await consume(await handoff(initial.subject,lb));assert.equal(linked.accountId,lb);assert.equal(linked.membershipBridge,true);
assert.equal(await snapshot(),before);
assert.equal((await rows("select account_id from chat_provider_identities where subject=$1",[initial.subject]))[0].account_id,ss);
assert.equal((await rows('select longboard_user_id from chat_accounts where id=$1',[ss]))[0].longboard_user_id,null);
assert.ok((await rows('select count(*)::int n from chat_sessions where account_id=$1',[ss]))[0].n>=1);
const entitlement=async(a,r)=>(await rows('select chat_account_has_room($1,$2) ok',[a,r]))[0].ok;
assert.equal(await entitlement(lb,'shortscout'),true);assert.equal(await entitlement(lb,'main'),true);assert.equal(await entitlement(ss,'main'),false);assert.equal(await entitlement(ss,'shortscout'),true);
assert.deepEqual((await rows('select memberships from chat_member_memberships($1)',[[lbMember]]))[0].memberships,['LB','SS']);
await consume(await handoff(initial.subject,lb));assert.equal((await rows('select count(*)::int n from chat_shortscout_link_events'))[0].n,1);
// Expiry and downgrade use the original proof; there is no copied tier.
await rows("update chat_provider_identities set verified_at=now()-interval '13 hours' where subject=$1",[initial.subject]);
for(const a of [lb,ss])assert.equal(await entitlement(a,'shortscout'),false);
await consume(await handoff(initial.subject,null,'monthly'));for(const a of [lb,ss])assert.equal(await entitlement(a,'shortscout'),false);
assert.equal(await entitlement(lb,'social'),true);assert.equal(await entitlement(ss,'social'),true);
await assert.rejects(consume(await handoff(initial.subject,lb,'monthly','shortscout')),/insufficient_membership/);
await consume(await handoff(initial.subject,null));assert.equal(await entitlement(lb,'shortscout'),true);
assert.equal((await rows('select revoke_chat_shortscout_membership_link($1) result',[lb]))[0].result,true);
assert.equal(await entitlement(lb,'shortscout'),false);assert.equal(await entitlement(ss,'shortscout'),true);
await consume(await handoff(initial.subject,null));assert.equal(await entitlement(lb,'shortscout'),false,'ordinary SS sign-in cannot reactivate');
await consume(await handoff(initial.subject,lb));assert.equal(await entitlement(lb,'shortscout'),true);
assert.equal(await snapshot(),before);
// Proof, replay and expected original-profile binding.
const pending=await handoff(initial.subject,lb);
for(const override of [{challenge:'bad'},{code:hash()},{link:other}])await assert.rejects(consume(pending,override),/invalid_login_handoff/);
await consume(pending);await assert.rejects(consume(pending),/invalid_login_handoff/);
await assert.rejects(consume(await handoff(randomUUID(),null,'mastermind','social',initial.subject)),/identity_mismatch/);
assert.equal((await consume(await handoff(initial.subject,null,'mastermind','social',initial.subject))).accountId,ss);
// Opposite side conflicts, including admin, remain denied.
await assert.rejects(consume(await handoff(initial.subject,other)),/identity_already_linked/);
const extra=await handoff();await consume(extra);await assert.rejects(consume(await handoff(extra.subject,lb)),/identity_already_linked/);
const direct=await handoff(randomUUID(),other);await consume(direct);await assert.rejects(consume(await handoff(direct.subject,lb)),/identity_already_linked/);
await db.exec('reset role');await rows("update profiles set role='admin' where id=$1",[lb]);await db.exec('set role service_role');await assert.rejects(consume(await handoff(direct.subject,lb)),/identity_already_linked/);
// Both sides are constrained even if calls race; PGlite serializes DB operations.
await db.exec('reset role');const raceTarget=await lbAccount(),raceTarget2=await lbAccount();await db.exec('set role service_role');
const x=await handoff(),y=await handoff();await consume(x);await consume(y);
const contenders=await Promise.all([handoff(x.subject,raceTarget),handoff(y.subject,raceTarget)]);
const outcomes=await Promise.allSettled(contenders.map(r=>consume(r)));assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
const winner=contenders[outcomes.findIndex(r=>r.status==='fulfilled')];await assert.rejects(consume(await handoff(winner.subject,raceTarget2)),/identity_already_linked/);
// Source ownership cannot be reassigned underneath the bridge.
await assert.rejects(rows('update chat_provider_identities set account_id=$1 where subject=$2',[raceTarget2,initial.subject]),/foreign key constraint/);
assert.equal(await snapshot(),before);
// Notification recipients use the same authoritative helper.
const announcement=(await rows("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'ss-announcements','Admin','SS announcement') returning id",[lbMember]))[0].id;
assert.equal((await rows('select count(*)::int n from chat_room_mentions where message_id=$1 and account_id in ($2,$3)',[announcement,lb,ss]))[0].n,2);
await db.exec('reset role');await rows("update profiles set role='user' where id=$1",[lb]);await db.exec('set role service_role');
assert.equal(await entitlement(randomUUID(),'shortscout'),false);
for(const role of ['anon','authenticated']){await db.exec(`reset role;set role ${role}`);for(const table of ['chat_shortscout_membership_links','chat_shortscout_link_events'])await assert.rejects(rows(`select * from ${table}`),/permission denied/);await assert.rejects(rows('select chat_shortscout_identity($1)',[lb]),/permission denied/);await assert.rejects(rows('select revoke_chat_shortscout_membership_link($1)',[lb]),/permission denied/);}
await db.close();console.log('PASS SS linking: original dual histories/DMs preserved; exact dual proof, direct + bridged identities, expiry/downgrade/revocation/reactivation, both-side conflicts, queued competitors, pinned original profile, helper/badge/notification authorization and private RPCs.');
