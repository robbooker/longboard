// Runs against an isolated PostgreSQL engine; never reads production credentials.
// Usage: node scripts/tests/chat-dm-media-database.mjs
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
await db.exec('set role service_role');
const members=[];
for(const [i,id] of users.entries())members.push((await ok('select longboard_chat_link_member($1,$2,null) as m',[id,`Member ${i}`]))[0].m);
const act=async(u,a,target,body=null,client=randomUUID())=>(await ok('select longboard_chat_dm_action($1,$2,$3,$4,$5) as r',[u,a,target,body,client]))[0].r;
const mutate=async(u,c,m,a,revision,body=null)=>(await ok('select longboard_chat_dm_message_action($1,$2,$3,$4,$5,$6) as r',[u,c,m,a,revision,body]))[0].r.message;

const c=(await act(users[0],'request',members[1].id,'Hello')).conversationId;
await act(users[1],'accept',c);
const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const reserve=async()=>(await ok("select to_jsonb(reserve_chat_dm_attachment($1,$2,'voice.wav','audio/wav',32044)) f",[members[0].id,c]))[0].f;
const attach=async()=>{const f=await reserve();await ok("update chat_attachments set status='ready',duration_seconds=1,object_path=$2,sha256='synthetic' where id=$1",[f.id,'clean/'+f.id]);await ok("select longboard_chat_dm_media_send($1,'send',$2,'',$3,$4)",[users[0],c,randomUUID(),[f.id]]);return f;};
const claim=async(f,actor=members[1].id)=>(await ok('select claim_chat_transcript($1,$2,$3) r',[actor,f.id,randomUUID()]))[0].r;
const pending=await reserve();
for(const duration of [null,0,121]){await assert.rejects(ok("update chat_attachments set status='ready',object_path='clean/test',sha256='synthetic',duration_seconds=$2 where id=$1",[pending.id,duration]),/chat_voice_limits/);checks++;}
await assert.rejects(claim(pending),/audio_unavailable/);checks++;
const f=await attach();
await assert.rejects(claim(f,members[2].id),/audio_unavailable/);checks++;
check((await claim(f)).status,'claimed');check((await claim(f,members[0].id)).status,'processing');
check((await ok('select attempts from chat_audio_transcripts where attachment_id=$1',[f.id]))[0].attempts,1);
await ok("update chat_audio_transcripts set status='ready',text='<b>Plain text only</b>',claim_token=null where attachment_id=$1",[f.id]);check(await claim(f),{status:'ready',text:'<b>Plain text only</b>'});
await act(users[0],'block',c);await assert.rejects(claim(f),/audio_unavailable/);checks++;await act(users[0],'unblock',c);
await act(users[1],'block',c);await assert.rejects(claim(f),/audio_unavailable/);checks++;await act(users[1],'unblock',c);
await ok("update longboard_chat_conversations set status='declined' where id=$1",[c]);await assert.rejects(claim(f),/audio_unavailable/);checks++;await ok("update longboard_chat_conversations set status='accepted' where id=$1",[c]);
const retry=await attach();await claim(retry);
for(let i=0;i<2;i++){await ok("update chat_audio_transcripts set started_at=now()-interval '3 minutes' where attachment_id=$1",[retry.id]);check((await claim(retry)).status,'claimed');}
await ok("update chat_audio_transcripts set status='failed' where attachment_id=$1",[retry.id]);await assert.rejects(claim(retry),/transcript_retry_limit/);checks++;
const quota=await attach();await ok("update chat_audio_usage set requests=30 where member_id=$1",[members[1].id]);await assert.rejects(claim(quota),/transcript_rate_limit/);checks++;
const message=(await ok('select dm_message_id from chat_attachments where id=$1',[f.id]))[0].dm_message_id;await mutate(users[0],c,message,'delete',0);
check((await ok('select count(*)::int n from chat_audio_transcripts where attachment_id=$1',[f.id]))[0].n,0);await assert.rejects(claim(f),/audio_unavailable/);checks++;
const room=(await ok("select to_jsonb(reserve_chat_attachment($1,'main','room.wav','audio/wav',32044)) f",[members[0].id]))[0].f;
await ok("update chat_attachments set status='ready',duration_seconds=1,object_path='clean/room',sha256='hash' where id=$1",[room.id]);
await ok("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,attachment_ids) values($1,$1,'Member','', 'main',$2)",[members[0].id,[room.id]]);
check((await claim(room,members[0].id)).status,'claimed');await assert.rejects(claim(room,members[2].id),/audio_unavailable/);checks++;
await ok('delete from user_tags where user_id=$1',[users[0]]);await assert.rejects(claim(room,members[0].id),/audio_unavailable/);checks++;
for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await assert.rejects(claim(quota),/permission denied/);checks++;await assert.rejects(ok('select * from chat_audio_transcripts'),/permission denied/);checks++;await assert.rejects(ok('select * from chat_audio_usage'),/permission denied/);checks++;}
await db.close();console.log(`PASS ${checks} voice database assertions: duration constraints, attachment binding, participant/block/decline access, deduplication, bounded leases/usage, deletion and private grants.`);
