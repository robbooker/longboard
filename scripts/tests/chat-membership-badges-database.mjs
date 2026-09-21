import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;
create table public.profiles(id uuid primary key,role text);
create table public.chat_accounts(id uuid primary key,longboard_user_id uuid);
create table public.longboard_chat_members(id uuid primary key,user_id uuid);
create table public.user_tags(user_id uuid,tag text);
create table public.chat_provider_identities(account_id uuid,provider text,membership_level text,verified_at timestamptz);`);
await db.exec(readFileSync(new URL('../../supabase/migrations/20260921140650_chat_membership_badges.sql',import.meta.url),'utf8'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
for(let n=1;n<=9;n++) {
 await db.query('insert into profiles values($1,$2)',[id(n),n===4?'admin':'user']);
 await db.query('insert into chat_accounts values($1,$1)',[id(n)]);
 await db.query('insert into longboard_chat_members values($1,$1)',[id(n)]);
}
for(const n of [1,3,5])await db.query("insert into user_tags values($1,'boardroom-cohort-1')",[id(n)]);
for(const [n,level,age] of [[2,'monthly',1],[3,'mastermind',1],[5,'annual',13],[6,'free',1],[7,'lifetime',1],[8,'annual',1]])await db.query("insert into chat_provider_identities values($1,'shortscout',$2,now()-$3::integer*interval '1 hour')",[id(n),level,age]);
const labels=async n=>(await db.query('select memberships from chat_member_memberships($1)',[[id(n)]])).rows[0]?.memberships;
for(const [n,want] of [[1,['LB']],[2,['SS']],[3,['LB','SS']],[4,[]],[5,['LB']],[6,[]],[7,['SS']],[8,['SS']],[9,[]]])assert.deepEqual(await labels(n),want);
await db.query('delete from user_tags where user_id=$1',[id(3)]);assert.deepEqual(await labels(3),['SS']);
await db.query('delete from chat_provider_identities where account_id=$1',[id(3)]);assert.deepEqual(await labels(3),[]);
assert.equal((await db.query('select * from chat_member_memberships($1)',[[id(999)]])).rows.length,0);
for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.chat_member_memberships(uuid[])','EXECUTE') as allowed",[role])).rows[0].allowed,false);
assert.equal((await db.query("select has_function_privilege('service_role','public.chat_member_memberships(uuid[])','EXECUTE') as allowed")).rows[0].allowed,true);
await db.close();console.log('PASS membership SQL: LB, SS, both, none, admin without tags, expired/free identity, all paid tiers, removal, unknown member, service-only grants.');
