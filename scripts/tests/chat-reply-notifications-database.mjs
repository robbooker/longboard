import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role;
alter default privileges grant all on tables to service_role;
create table chat_accounts(id uuid primary key);
create table longboard_chat_members(id uuid primary key,user_id uuid unique,display_name text);
create table longboard_chat_messages(id uuid primary key default gen_random_uuid(),member_id uuid,body text,author_label text,room_slug text,reply_to_id uuid references longboard_chat_messages(id) on delete cascade);
create table longboard_chat_conversations(id uuid primary key,requester_id uuid,recipient_id uuid,status text,requester_read_seq bigint default 0,recipient_read_seq bigint default 0);
create table longboard_chat_blocks(blocker_id uuid,blocked_id uuid);
create table longboard_chat_direct_messages(seq bigint generated always as identity,conversation_id uuid,sender_id uuid,created_at timestamptz default now());`);
await db.exec(await readFile(new URL('../../supabase/migrations/20260916213912_chat_activity_notifications.sql',import.meta.url),'utf8'));

await db.exec(`create table test_access(account_id uuid,room text);create function chat_account_has_room(a uuid,r text) returns boolean language sql stable as $$select exists(select 1 from public.test_access where account_id=a and room=r)$$;`);
await db.exec(await readFile(new URL('../../supabase/migrations/20260918140909_chat_reply_notifications.sql',import.meta.url),'utf8'));
const users=Array.from({length:4},()=>randomUUID()),members=Array.from({length:4},()=>randomUUID());
for(let i=0;i<4;i++){await db.query('insert into chat_accounts values($1)',[users[i]]);await db.query('insert into longboard_chat_members values($1,$2,$3)',[members[i],users[i],['Alice','Bob','Carol','Dave'][i]]);await db.query("insert into test_access values($1,'main')",[users[i]]);}
await db.exec('set role service_role');
const post=async(sender,body,parent=null)=>(await db.query("insert into longboard_chat_messages(member_id,body,author_label,room_slug,reply_to_id) values($1,$2,$3,'main',$4) returning id",[members[sender],body,['Alice','Bob','Carol','Dave'][sender],parent])).rows[0].id;
const inbox=async(i)=>(await db.query("select chat_activity_inbox($1,array['main']) r",[users[i]])).rows[0].r;
const root=await post(0,'Original subject');const first=await post(1,'First reply',root);
eq((await inbox(0)).mentions.map(n=>n.messageId),[first]);eq((await inbox(1)).mentionCount,0);eq((await inbox(2)).mentionCount,0);
const nested=await post(2,'@Alice nested reply',first);
eq((await inbox(0)).mentionCount,2);eq((await inbox(1)).mentionCount,1);eq((await inbox(2)).mentionCount,0);
const n=(await inbox(0)).mentions.find(n=>n.messageId===nested);eq(n.category,'reply');eq(n.parentPreview,'Original subject');eq(n.threadRootId,root);eq(n.preview,'@Alice nested reply');
await db.query('update longboard_chat_messages set body=$1 where id=$2',['Edited without mention',nested]);eq((await inbox(0)).mentionCount,2);eq((await inbox(1)).mentionCount,1);
await db.query('select read_visible_chat_room_alerts($1,$2,$3)',[users[0],'main',n.seq]);eq((await inbox(0)).mentionCount,2);
await db.query('select read_chat_activity($1,$2,$3,$4)',[users[0],['main'],n.seq,n.id]);await db.query('update longboard_chat_messages set body=$1 where id=$2',['@Alice edited again',nested]);eq((await inbox(0)).mentionCount,1);
await db.query('insert into chat_activity_preferences values($1,false)',[users[1]]);const off=await post(2,'Muted reply',root);eq((await inbox(1)).mentionCount,1);eq((await inbox(1)).replyNotifications,false);
await db.query('update chat_activity_preferences set replies=true where account_id=$1',[users[1]]);await post(3,'Another participant',root);eq((await inbox(1)).mentionCount,2);eq((await inbox(2)).mentionCount,1);
await db.query('insert into longboard_chat_blocks values($1,$2)',[members[0],members[3]]);const blocked=await post(3,'@Alice blocked',root);eq((await inbox(0)).mentions.some(n=>n.messageId===blocked),false);
await db.query('delete from public.test_access where account_id=$1',[users[1]]);eq((await inbox(1)).mentionCount,0);await post(3,'Revoked recipient',root);eq((await db.query('select count(*)::int n from chat_room_mentions where account_id=$1',[users[1]])).rows[0].n,3);
await db.query("insert into longboard_chat_messages(body,author_label,room_slug,reply_to_id) values('Assistant response','Buddy','main',$1)",[root]);eq((await inbox(2)).mentions.some(n=>n.author==='Buddy'),true);
await db.query('delete from longboard_chat_messages where id=$1',[root]);eq((await inbox(0)).mentionCount,0);eq((await inbox(2)).mentionCount,0);
for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await assert.rejects(()=>db.query('select * from chat_activity_preferences'),/permission denied/);await assert.rejects(()=>db.query('select * from chat_room_mentions'),/permission denied/);}
await db.close();console.log(`PASS ${checks} reply fanout, nested participation, sender exclusion, mention dedupe, edit/read stability, preference, entitlement/block and cascade assertions plus client-role denial.`);
