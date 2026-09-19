// Isolated PostgreSQL fixture exercising the deployed push SQL and preview migration.
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const db=new PGlite();const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table chat_accounts(id uuid primary key);
create table longboard_chat_members(id uuid primary key,user_id uuid,display_name text);
create table longboard_chat_conversations(id uuid primary key,requester_id uuid,recipient_id uuid,status text,requester_read_seq bigint default 0,recipient_read_seq bigint default 0);
create table longboard_chat_direct_messages(id uuid primary key,conversation_id uuid,sender_id uuid,body text,seq bigint,deleted_at timestamptz,attachment_ids uuid[] default '{}');
create table longboard_chat_messages(id uuid primary key,member_id uuid,author_label text,body text,reply_to_id uuid,attachment_ids uuid[] default '{}');
create table chat_room_mentions(id uuid primary key,account_id uuid,room_slug text,message_id uuid,thread_root_id uuid,read_at timestamptz,category text);
create table chat_activity_preferences(account_id uuid primary key,replies boolean);
create table longboard_chat_blocks(blocker_id uuid,blocked_id uuid);
create table fixture_access(account_id uuid,room text,allowed boolean);
create function chat_account_has_room(actor uuid,r text) returns boolean language sql stable as $$select coalesce((select allowed from public.fixture_access where account_id=actor and room=r),false)$$;
grant usage on schema public to service_role,authenticated,anon;
grant all on all tables in schema public to service_role;
`);
await db.exec(await readFile('supabase/migrations/20260919020901_chat_web_push.sql','utf8'));
const alice=randomUUID(),bob=randomUUID(),am=randomUUID(),bm=randomUUID(),conversation=randomUUID();
await q('insert into chat_accounts values($1),($2)',[alice,bob]);await q('insert into longboard_chat_members values($1,$2,$3),($4,$5,$6)',[am,alice,'Alice',bm,bob,'Bob']);
await q("insert into fixture_access values($1,'social',true),($2,'social',true)",[alice,bob]);
await q("insert into longboard_chat_conversations(id,requester_id,recipient_id,status) values($1,$2,$3,'accepted')",[conversation,am,bm]);
const endpoint1='https://web.push.apple.com/one',endpoint2='https://web.push.apple.com/two';
// A legacy device exists before migration; migration must keep it private.
await q('select save_chat_push_subscription($1,$2,$3,$4)',[bob,endpoint1,'key','auth']);
await db.exec(await readFile('supabase/migrations/20260919172901_chat_push_previews.sql','utf8'));
assert.equal((await q('select preview_mode from chat_push_subscriptions'))[0].preview_mode,'off');
await q("update chat_push_subscriptions set updated_at=now()-interval '5 seconds'");await q('select save_chat_push_subscription($1,$2,$3,$4)',[bob,endpoint2,'key','auth']);
assert.equal((await q('select set_chat_push_preview($1,$2,$3) as ok',[alice,endpoint1,'message']))[0].ok,false);
await q('select set_chat_push_preview($1,$2,$3)',[bob,endpoint1,'message']);
assert.deepEqual((await q('select preview_mode from chat_push_subscriptions order by endpoint')).map(r=>r.preview_mode),['message','off']);
await assert.rejects(()=>q('select set_chat_push_preview($1,$2,$3)',[bob,endpoint1,'all']),/invalid_preview/);
for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(()=>q('select set_chat_push_preview($1,$2,$3)',[bob,endpoint1,'message']),/permission denied/);await assert.rejects(()=>q('select prepare_chat_push_job($1,$2)',[randomUUID(),randomUUID()]),/permission denied/);await db.exec('reset role');}
const id=randomUUID();await q('insert into longboard_chat_direct_messages(id,conversation_id,sender_id,body,seq) values($1,$2,$3,$4,1)',[id,conversation,am,'Private message']);
const claimed=[];for(let i=0;i<2;i++){const worker=randomUUID();const job=(await q('select claim_chat_push_job($1) as job',[worker]))[0].job;assert.ok(job);assert.equal(JSON.stringify(job).includes('Private message'),false);claimed.push({job,worker});}
const prepare=async(entry)=>(await q('select prepare_chat_push_job($1,$2) as result',[entry.job.id,entry.worker]))[0].result;
const rich=claimed.find(e=>e.job.subscription.endpoint===endpoint1),privateDevice=claimed.find(e=>e.job.subscription.endpoint===endpoint2);
let payload=await prepare(rich);assert.equal(payload.sender,'Alice');assert.equal(payload.body,'Private message');assert.equal(payload.preview,'message');
payload=await prepare(privateDevice);assert.equal(payload.preview,'off');assert.equal('sender' in payload,false);assert.equal('body' in payload,false);
// Changing preference after claim immediately affects what leaves the database.
await q('select set_chat_push_preview($1,$2,$3)',[bob,endpoint1,'sender']);payload=await prepare(rich);assert.equal(payload.sender,'Alice');assert.equal('body' in payload,false);
await q('select set_chat_push_preview($1,$2,$3)',[bob,endpoint1,'off']);payload=await prepare(rich);assert.equal('sender' in payload,false);
await q('select set_chat_push_preview($1,$2,$3)',[bob,endpoint1,'message']);
await q('update longboard_chat_direct_messages set body=$1 where id=$2',['Edited text',id]);assert.equal((await prepare(rich)).body,'Edited text');
await q('update longboard_chat_direct_messages set body=$1,attachment_ids=$2 where id=$3',['',[randomUUID()],id]);payload=await prepare(rich);assert.equal(payload.body,'');assert.equal(payload.hasAttachments,true);
assert.equal((await q('select prepare_chat_push_job($1,$2) as result',[rich.job.id,randomUUID()]))[0].result,null);
await q('insert into longboard_chat_blocks values($1,$2)',[bm,am]);assert.equal(await prepare(rich),null);await q('delete from longboard_chat_blocks');
await q('update fixture_access set allowed=false where account_id=$1',[bob]);assert.equal(await prepare(rich),null);await q('update fixture_access set allowed=true');
await q('update longboard_chat_direct_messages set deleted_at=now() where id=$1',[id]);assert.equal(await prepare(rich),null);await q('update longboard_chat_direct_messages set deleted_at=null');
await q('update longboard_chat_conversations set recipient_read_seq=1');assert.equal(await prepare(rich),null);await q('update longboard_chat_conversations set recipient_read_seq=0');
// The outbox has IDs/lease metadata only: private text is not duplicated or persisted.
assert.equal((await q("select column_name from information_schema.columns where table_name='chat_push_jobs'")).some(r=>/body|sender|preview/.test(r.column_name)),false);
await q('delete from chat_push_subscriptions where endpoint=$1',[endpoint1]);assert.equal(await prepare(rich),null);
// Room mention/reply uses the same current access and reply preferences.
await q('select set_chat_push_preview($1,$2,$3)',[bob,endpoint2,'message']);const roomMessage=randomUUID(),mention=randomUUID();
await q('insert into longboard_chat_messages(id,member_id,author_label,body) values($1,$2,$3,$4)',[roomMessage,am,'Alice','Room private text']);
await q("insert into chat_room_mentions(id,account_id,room_slug,message_id,category) values($1,$2,'social',$3,'reply')",[mention,bob,roomMessage]);
const worker=randomUUID(),job=(await q('select claim_chat_push_job($1) as job',[worker]))[0].job;const room={worker,job};assert.equal((await prepare(room)).body,'Room private text');
await q('insert into chat_activity_preferences values($1,false)',[bob]);assert.equal(await prepare(room),null);await q('update chat_activity_preferences set replies=true');
await q('delete from longboard_chat_messages where id=$1',[roomMessage]);assert.equal(await prepare(room),null);
await db.close();console.log('PASS preview SQL: legacy private default, per-device/account isolation, privilege denial, no persisted text, post-claim preference/access/block/delete/read revocation, edited text, attachment-only fallback, room reply preferences.');
