// Runs against an isolated PostgreSQL engine; never reads production credentials.
// Usage: node scripts/tests/chat-buddy-queue-database.mjs
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import('@electric-sql/pglite');
const { vector } = await import("@electric-sql/pglite-pgvector");
const db = new PGlite({extensions:{vector}});
let checks = 0;
async function ok(sql, args = []) { return (await db.query(sql, args)).rows; }
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create schema extensions;
grant usage on schema extensions to authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth, public to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table public.profiles(id uuid primary key references auth.users(id),email text,role text);
grant select on public.profiles to service_role;
alter default privileges in schema public grant all on tables to service_role;
create publication supabase_realtime;
`);
for (const file of [
  '20260827135528_public_chat_guest_room.sql',
  '20260901125001_longboard_chat_admin_buddy.sql',
  '20260915115419_chat_member_direct_messages.sql',
]) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
const users = [randomUUID(),randomUUID(),randomUUID()];
for (const [i,id] of users.entries()) {
  await ok('insert into auth.users values($1)',[id]);
  await ok('insert into profiles values($1,$2,\'user\')',[id,`test${i}@example.invalid`]);
}
for (const file of ['20260915204338_chat_social_room.sql','20260915225504_member_chat_search.sql','20260915231144_chat_semantic_search.sql','20260915232125_chat_shortscout_admin_room.sql','20260916142421_shared_chat_login.sql','20260917231136_chat_dm_message_actions.sql']) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
for(const file of ['20260917030546_chat_attachments.sql','20260918001755_chat_dm_media.sql'])await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
await db.exec('create table public.user_tags(user_id uuid,tag text);grant select on public.user_tags to service_role,authenticated;');
for(const file of ['20260916160122_chat_message_actions.sql','20260916211649_chat_room_summary_inbox.sql','20260916213912_chat_activity_notifications.sql','20260917135451_chat_announcement_rooms.sql','20260917202524_chat_boardroom_access.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
await ok("insert into user_tags values($1,'boardroom-cohort-1')",[users[0]]);
await db.exec(await readFile(new URL('../../supabase/migrations/20260918182625_chat_voice_messages.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/20260918211138_chat_buddy_async_queue.sql',import.meta.url),'utf8'));
await db.exec('grant update on public.profiles, public.user_tags to service_role;set role service_role');
const members=[];
for(const [i,id] of users.entries())members.push((await ok('select longboard_chat_link_member($1,$2,null) as m',[id,`Member ${i}`]))[0].m);
const act=async(u,a,target,body=null,client=randomUUID())=>(await ok('select longboard_chat_dm_action($1,$2,$3,$4,$5) as r',[u,a,target,body,client]))[0].r;
const mutate=async(u,c,m,a,revision,body=null)=>(await ok('select longboard_chat_dm_message_action($1,$2,$3,$4,$5,$6) as r',[u,c,m,a,revision,body]))[0].r.message;


const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const send=async(body='@Buddy explain support',client=randomUUID(),files=[],room='main')=>(await ok('select send_chat_attachment_message($1,$2,$3,$4,null,$5,$6) m',[members[0].id,room,'Member 0',body,files,client]))[0].m;
const claim=async(id,worker=randomUUID())=>({worker,job:(await ok('select claim_chat_buddy_job($1,$2) j',[worker,id]))[0].j});
const finish=async(id,worker,answer='An explanation')=>(await ok('select finish_chat_buddy_job($1,$2,$3) done',[id,worker,answer]))[0].done;
const status=async(id)=>(await ok('select buddy_status s from longboard_chat_messages where id=$1',[id]))[0]?.s;
const client=randomUUID(),m=await send(undefined,client);
check(m.buddy_status,'pending');check((await send(undefined,client)).id,m.id);
check((await ok('select count(*)::int n from chat_buddy_jobs where message_id=$1',[m.id]))[0].n,1);
const first=await claim(m.id);check(first.job.messageId,m.id);check(await status(m.id),'processing');check((await claim(m.id)).job,null);
check(await finish(m.id,randomUUID()),false);check(await finish(m.id,first.worker),true);check(await status(m.id),'completed');check(await finish(m.id,first.worker),false);
check((await ok("select count(*)::int n from longboard_chat_messages where reply_to_id=$1 and bot_slug='buddy'",[m.id]))[0].n,1);
for(const [body,expected] of [['normal',false],['email@buddy.com',false],['@buddybot',false],['é@buddy',false],['Hi @BUDDY!',true],['@buddyé',true]])check((await ok('select chat_has_buddy_mention($1) b',[body]))[0].b,expected);
check((await send('plain text')).buddy_status,null);check((await send('@Buddy hello',randomUUID(),[],'social')).buddy_status,null);
const legacy=await send();await ok("insert into longboard_chat_messages(room_slug,guest_id,author_label,body,bot_slug,reply_to_id) values('main',null,'@Buddy','Legacy reply','buddy',$1)",[legacy.id]);check((await claim(legacy.id)).job,null);check(await status(legacy.id),'completed');check((await ok('select attempts n from chat_buddy_jobs where message_id=$1',[legacy.id]))[0].n,0);
const edited=await send();const editClaim=await claim(edited.id);await ok("update longboard_chat_messages set body='Changed question',edited_at=now() where id=$1",[edited.id]);check(await status(edited.id),'cancelled');check(await finish(edited.id,editClaim.worker),false);
const deleted=await send();const deleteClaim=await claim(deleted.id);await ok('delete from longboard_chat_messages where id=$1',[deleted.id]);check(await finish(deleted.id,deleteClaim.worker),false);check((await ok('select count(*)::int n from chat_buddy_jobs where message_id=$1',[deleted.id]))[0].n,0);
const paused=await send();const pauseClaim=await claim(paused.id);await ok("update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$1 where room_slug='main'",[users[0]]);check(await finish(paused.id,pauseClaim.worker),true);check(await status(paused.id),'pending');await assert.rejects(send(),/paused/);checks++;await assert.rejects(ok("update longboard_chat_messages set body='Changed' where id=$1",[paused.id]),/paused/);checks++;
await ok('update chat_buddy_jobs set next_attempt_at=now() where message_id=$1',[paused.id]);check((await claim(paused.id)).job,null);check((await ok('select attempts n from chat_buddy_jobs where message_id=$1',[paused.id]))[0].n,1);
await ok("update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug='main'");
const revoked=await send();const revokeClaim=await claim(revoked.id);await ok('delete from user_tags where user_id=$1',[users[0]]);check(await finish(revoked.id,revokeClaim.worker),true);check(await status(revoked.id),'cancelled');await ok("insert into user_tags values($1,'boardroom-cohort-1')",[users[0]]);
const retry=await send();let oldWorker;
for(let i=0;i<3;i++){const c=await claim(retry.id);check(!!c.job,true);if(oldWorker)check(await finish(retry.id,oldWorker),false);oldWorker=c.worker;await ok("update chat_buddy_jobs set lease_until=now()-interval '1 second' where message_id=$1",[retry.id]);}
check((await claim(retry.id)).job,null);check(await status(retry.id),'failed');check(await finish(retry.id,oldWorker),false);
const providerFailure=await send();for(let i=0;i<3;i++){const c=await claim(providerFailure.id);check(await finish(providerFailure.id,c.worker,null),true);await ok('update chat_buddy_jobs set next_attempt_at=now() where message_id=$1',[providerFailure.id]);}check(await status(providerFailure.id),'failed');
const attachment=(await ok("select reserve_chat_attachment($1,'main','image.png','image/png',100) a",[members[0].id]))[0].a;
const before=(await ok('select count(*)::int n from chat_buddy_jobs'))[0].n;
await assert.rejects(send('@Buddy file',randomUUID(),[attachment.id]),/attachment_not_ready/);checks++;check((await ok('select count(*)::int n from chat_buddy_jobs'))[0].n,before);
await ok("update chat_attachments set status='ready',object_path='clean/test',sha256='test' where id=$1",[attachment.id]);const media=await send('@Buddy file',randomUUID(),[attachment.id]);check(media.buddy_status,'pending');check((await ok('select status from chat_attachments where id=$1',[attachment.id]))[0].status,'attached');
for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await assert.rejects(ok('select * from chat_buddy_jobs'),/permission denied/);checks++;await assert.rejects(claim(media.id),/permission denied/);checks++;await assert.rejects(ok("update longboard_chat_messages set buddy_status='completed' where id=$1",[media.id]),/permission denied/);checks++;}
await db.close();console.log(`PASS ${checks} Buddy queue assertions: atomic deduplication, leases/fencing/retries, current access/pause/edit/delete guards, clean attachment gating, status transitions and private grants.`);
