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
await db.exec(await readFile(root+'/supabase/migrations/20261001190002_chat_shortscout_authorization.sql','utf8'));
let checks=0;const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const insert=async(room,body='Search needle')=>(await one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Search author',$2,$3) returning *",[members[0],body,room]));
const oldSs=await insert('shortscout','Search needle preexisting SS');
equal((await q('select * from longboard_chat_embeddings where message_id=$1',[oldSs.id])).length,0);
await db.exec(await readFile(root+'/supabase/migrations/20261006134004_chat_shortscout_search.sql','utf8'));
equal((await q('select * from longboard_chat_embeddings where message_id=$1',[oldSs.id])).length,1);
const main=await insert('main'),social=await insert('social'),ss=await insert('shortscout'),announcement=await insert('ss-announcements'),recording=await insert('ss-recordings');
const vec=JSON.stringify([1,...Array(1535).fill(0)]);
await db.exec('set role service_role');
const jobs=await q('select * from claim_longboard_chat_embeddings()');equal(jobs.length,4);equal((await q('select * from claim_longboard_chat_embeddings()')).length,0);
for(const job of jobs)await q('update longboard_chat_embeddings set embedding=$1 where message_id=$2 and lease_id=$3',[vec,job.message_id,job.lease_id]);
for(const [scope,rooms]of Object.entries({main:['main'],social:['social'],shortscout:['shortscout'],'lb-social':['main','social'],'ss-social':['shortscout','social'],all:['main','social']})){
 for(const mode of ['keyword','semantic']){
  const rows=mode==='keyword'?await q('select * from search_longboard_chat($1,$2)',['needle',scope]):await q('select * from search_longboard_chat_semantic($1,$2,$3)',['unmatched semantic phrase',vec,scope]);
  equal([...new Set(rows.map(r=>r.room_slug))].sort(),rooms.sort());
 }
}
for(const scope of ['dm','gainers','ss-announcements','ss-recordings','main,shortscout'])equal((await q('select * from search_longboard_chat($1,$2)',['needle',scope])).length,0);
equal((await q('select * from longboard_chat_search_context($1)',[ss.id])).every(row=>row.room_slug==='shortscout'),true);
// Retained deleted roots are context placeholders, never lexical/vector hits.
const retained=await insert('shortscout','Retained needle');await q("update longboard_chat_messages set deleted_at=now(),body='Message deleted' where id=$1",[retained.id]);
equal((await q('select * from longboard_chat_embeddings where message_id=$1',[retained.id])).length,0);
equal((await q("select * from search_longboard_chat('Search author','shortscout')")).some(row=>row.id===retained.id),false);
equal((await q("select * from search_longboard_chat_semantic('Search author',$1,'shortscout')",[vec])).some(row=>row.id===retained.id),false);
equal((await q('select * from longboard_chat_search_context($1)',[retained.id])).some(row=>row.id===retained.id&&row.body==='Message deleted'),true);
// A stale hash never supplies a vector-only hit.
await q("update longboard_chat_embeddings set content_hash='stale' where message_id=$1",[ss.id]);
equal((await q("select * from search_longboard_chat_semantic('no lexical terms match',$1,'shortscout')",[vec])).some(row=>row.id===ss.id),false);
await q("update longboard_chat_embeddings set content_hash=md5('Search author' || E'\\n' || 'Search needle') where message_id=$1",[ss.id]);
// Same-timestamp keyset pagination remains exact across both selected rooms.
for(let i=0;i<44;i++)await insert(i%2?'shortscout':'social','Paging needle '+i);
const first=await q("select * from search_longboard_chat('Paging','ss-social')"),cursor=first[19],next=await q("select * from search_longboard_chat('Paging','ss-social',$1,$2)",[cursor.created_at,cursor.id]);
equal(first.length,21);equal(next.length,21);equal(next.some(row=>first.slice(0,20).some(prev=>prev.id===row.id)),false);
// Edit/delete/eligibility changes invalidate old content and leases.
const oldJob=jobs.find(j=>j.message_id===ss.id);await q("update longboard_chat_messages set body='Replacement scout text' where id=$1",[ss.id]);
equal((await one('select embedding from longboard_chat_embeddings where message_id=$1',[ss.id])).embedding,null);
equal((await q('update longboard_chat_embeddings set embedding=$1 where message_id=$2 and lease_id=$3 returning message_id',[vec,ss.id,oldJob.lease_id])).length,0);
await q("update longboard_chat_messages set removed=true,deleted_at=now(),body='Message deleted' where id=$1",[oldSs.id]);equal((await q('select * from longboard_chat_embeddings where message_id=$1',[oldSs.id])).length,0);
equal((await q("select * from search_longboard_chat('Search author','shortscout')")).some(row=>row.id===oldSs.id),false);equal((await q('select * from longboard_chat_search_context($1)',[oldSs.id])).length,0);
await assert.rejects(()=>q("update longboard_chat_messages set room_slug='ss-announcements' where id=$1",[ss.id]),/immutable/);checks++;
// Defensive claims exclude stale/ineligible manually present rows too.
await q("insert into longboard_chat_embeddings(message_id,content_hash) values($1,'stale'),($2,'stale')",[announcement.id,oldSs.id]);
const batch=await q('select * from claim_longboard_chat_embeddings()');equal(batch.length,32);equal(batch.some(j=>[announcement.id,oldSs.id].includes(j.message_id)),false);
await db.exec('reset role;set role authenticated');await q("select set_config('request.jwt.claim.sub',$1,false)",[accounts[1]]);
equal((await q("select * from search_longboard_chat('needle','shortscout')")).length,0);equal((await q("select * from search_longboard_chat_semantic('needle',$1,'shortscout')",[vec])).length,0);equal((await q('select * from longboard_chat_search_context($1)',[oldSs.id])).length,0);
await assert.rejects(()=>q('select * from claim_longboard_chat_embeddings()'),/permission denied/);checks++;
await db.exec('reset role;set role anon');await assert.rejects(()=>q("select * from search_longboard_chat('needle','shortscout')"),/permission denied/);checks++;
await db.exec('reset role');const fn=await q("select proname,prosecdef from pg_proc where proname in ('search_longboard_chat','search_longboard_chat_semantic','queue_longboard_chat_embedding','claim_longboard_chat_embeddings')");equal(fn.length,4);equal(fn.every(f=>!f.prosecdef),true);
console.log(`PASS ${checks} SS search SQL assertions: exact scopes, legacy all, vector and lexical results, keyset pages, old SS backfill, bounded leases, edit/delete/move exclusions, context and RLS/service-only guards.`);await db.close();
