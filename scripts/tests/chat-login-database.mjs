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
let checks=0;
const check = (actual,expected) => {assert.deepEqual(actual,expected);checks++;};
for(const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  for(const table of ['chat_accounts','chat_provider_identities','chat_login_requests','chat_sessions']) {
    await assert.rejects(()=>rows(`select * from ${table}`),/permission denied/);checks++;
  }
  await assert.rejects(()=>rows('select consume_chat_login($1,$2,$3,null,$4)',[hash(),hash(),challenge(),hash()]),/permission denied/);checks++;
  await db.exec('reset role');
}
await db.exec('set role service_role');
async function handoff(subject=randomUUID(),link=null) {
 const r={state:hash(),code:hash(),challenge:challenge(),subject,link};
 await rows(`insert into chat_login_requests(state_hash,challenge,link_user_id,return_room,subject,membership_level,code_hash)
 values($1,$2,$3,'shortscout',$4,'mastermind',$5)`,[r.state,r.challenge,r.link,r.subject,r.code]);
 return r;
}
const consume = async (r, override={}) => {
 const v={...r,...override};
 return (await rows('select consume_chat_login($1,$2,$3,$4,$5) as value',[v.state,v.code,v.challenge,v.link,hash()]))[0].value;
};
const ss=await handoff();
for(const bad of [{code:hash()},{challenge:challenge()},{link:lb}]) {
 await assert.rejects(()=>consume(ss,bad),/invalid_login_handoff/);checks++;
}
const session=await consume(ss);
check(session.room,'shortscout');
await assert.rejects(()=>consume(ss),/invalid_login_handoff/);checks++;
check((await rows('select count(*)::int n from profiles'))[0].n,1);
check((await rows('select longboard_user_id from chat_accounts where id=$1',[session.accountId]))[0].longboard_user_id,null);
const same=await consume(await handoff(ss.subject));
check(same.accountId,session.accountId);
const dual=await consume(await handoff(randomUUID(),lb));
check(dual.accountId,lb);
const collision=await handoff(ss.subject,lb);
await assert.rejects(()=>consume(collision),/identity_already_linked/);checks++;
const expired=await handoff();
await rows("update chat_login_requests set expires_at=now()-interval '1 second' where state_hash=$1",[expired.state]);
await assert.rejects(()=>consume(expired),/invalid_login_handoff/);checks++;
const pending=await handoff();
await rows('update chat_login_requests set subject=null,membership_level=null,code_hash=null where state_hash=$1',[pending.state]);
await assert.rejects(()=>consume(pending),/invalid_login_handoff/);checks++;
check((await rows('select count(*)::int n from chat_sessions'))[0].n,3);
const ssMember=(await rows("select longboard_chat_link_member($1,'Scout Member',null) as m",[session.accountId]))[0].m;
check(!!ssMember.id,true);
check((await rows("select chat_account_has_room($1,'main') as allowed",[session.accountId]))[0].allowed,false);
check((await rows("select chat_account_has_room($1,'social') as allowed",[session.accountId]))[0].allowed,true);
check((await rows("select chat_account_has_room($1,'shortscout') as allowed",[session.accountId]))[0].allowed,true);
const post=async(room,member)=> (await rows("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,$2,'Test member','hello') returning id",[member,room]))[0].id;
await post('shortscout',ssMember.id);checks++;
await post('social',ssMember.id);checks++;
await assert.rejects(()=>post('main',ssMember.id),/chat_room_forbidden/);checks++;
const lbMember=(await rows("select longboard_chat_link_member($1,'LB Member',null) as m",[lb]))[0].m;
const lbMessage=await post('main',lbMember.id);
await assert.rejects(()=>rows('insert into longboard_chat_reactions(message_id,guest_id) values($1,$2)',[lbMessage,ssMember.id]),/chat_room_forbidden/);checks++;
const dm=(await rows("select longboard_chat_dm_action($1,'request',$2,'hello',$3,null) as d",[session.accountId,lbMember.id,randomUUID()]))[0].d;
check(!!dm.conversationId,true);
console.log(`${checks} chat login database checks passed`);
await db.close();
