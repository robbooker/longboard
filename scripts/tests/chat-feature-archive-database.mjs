import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const owner='00000000-0000-4000-8000-000000000001',friend='00000000-0000-4000-8000-000000000002',worker='00000000-0000-4000-8000-000000000003';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role;
create table chat_accounts(id uuid primary key,longboard_user_id uuid);create table profiles(id uuid primary key,email text);
insert into chat_accounts values('${owner}','${owner}'),('${friend}',null);insert into profiles values('${owner}','madspreadsheets@gmail.com');`);
for(const file of ['20260916171034_private_chat_features.sql','20260916174554_chat_feature_notifications.sql','20260916210308_chat_feature_publish_approval.sql','20260917151325_chat_feature_archive.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
await db.query("insert into chat_feature_members values($1,'participant')",[friend]);
const archive=(id,actor=owner,revision=1)=>db.query('select archive_chat_feature($1,$2,$3)',[actor,id,revision]);
const create=async(status='discussion',claimed=false)=>(await db.query("insert into chat_feature_requests(title,created_by,status,approved_by,approved_at,claimed_at,worker_token) values('Archive fixture',$1,$2,$1,now(),case when $3 then now() end,case when $3 then $4::uuid end) returning id",[owner,status,claimed,worker])).rows[0].id;
for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role}`);await assert.rejects(()=>archive(owner),/permission denied/);await db.exec('reset role');
}
await db.exec('set role service_role');
const discussion=await create();
await assert.rejects(()=>archive(discussion,friend),/owner_only/);
await assert.rejects(()=>archive(discussion,worker),/owner_only/);
await assert.rejects(()=>archive(discussion,owner,2),/proposal_changed/);
await db.query("insert into chat_feature_messages(request_id,author_label,body) values($1,'Rob','Keep my history')",[discussion]);
await archive(discussion);await archive(discussion);
const saved=(await db.query('select status,archived_by,archived_at from chat_feature_requests where id=$1',[discussion])).rows[0];
assert.equal(saved.status,'archived');assert.equal(saved.archived_by,owner);assert.ok(saved.archived_at);
assert.equal((await db.query('select count(*)::int n from chat_feature_messages where request_id=$1',[discussion])).rows[0].n,2);
const approved=await create('approved');await archive(approved);
assert.equal((await db.query('select * from claim_chat_feature($1)',[worker])).rows.length,0);
assert.equal((await db.query('select count(*)::int n from chat_feature_notifications where request_id=$1 and read_at is null',[approved])).rows[0].n,0);
// Reverse ordering: pickup wins, so the stale Archive click must fail.
const picked=await create('approved');assert.equal((await db.query('select * from claim_chat_feature($1)',[worker])).rows[0].id,picked);
await assert.rejects(()=>archive(picked),/ticket_already_picked_up/);
for(const status of ['in_progress','ready','done','blocked','declined'])await assert.rejects(async()=>archive(await create(status)),/ticket_already_picked_up/);
await assert.rejects(async()=>archive(await create('approved',true)),/ticket_already_picked_up/);
console.log('PASS archive permissions, stale revisions, idempotency/history, audit metadata, archive-before-pickup, pickup-before-archive and protected work states.');
await db.close();
