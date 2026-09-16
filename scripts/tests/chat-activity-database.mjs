import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role;
alter default privileges grant all on tables to service_role;
create table chat_accounts(id uuid primary key);
create table longboard_chat_members(id uuid primary key,user_id uuid unique,display_name text);
create table longboard_chat_messages(id uuid primary key default gen_random_uuid(),member_id uuid,body text,author_label text,room_slug text);
create table longboard_chat_conversations(id uuid primary key,requester_id uuid,recipient_id uuid,status text,requester_read_seq bigint default 0,recipient_read_seq bigint default 0);
create table longboard_chat_blocks(blocker_id uuid,blocked_id uuid);
create table longboard_chat_direct_messages(seq bigint generated always as identity,conversation_id uuid,sender_id uuid,created_at timestamptz default now());`);
await db.exec(await readFile(new URL('../../supabase/migrations/20260916213912_chat_activity_notifications.sql',import.meta.url),'utf8'));
const users=Array.from({length:4},()=>randomUUID()),members=Array.from({length:4},()=>randomUUID());
for(let i=0;i<4;i++){await db.query('insert into chat_accounts values($1)',[users[i]]);await db.query('insert into longboard_chat_members values($1,$2,$3)',[members[i],users[i],['Ann','Ann Marie','Bob','A.B'][i]]);}
const post=async(body,room='main',sender=2)=>(await db.query('insert into longboard_chat_messages(member_id,body,author_label,room_slug) values($1,$2,$3,$4) returning id',[sender===null?null:members[sender],body,'Sender',room])).rows[0].id;
const inbox=async(i=0,rooms=['main','social'])=>(await db.query('select chat_activity_inbox($1,$2) result',[users[i],rooms])).rows[0].result;
const read=(i,m=0,id=null,d=0,c=null,rooms=['main','social'])=>db.query('select read_chat_activity($1,$2,$3,$4,$5,$6)',[users[i],rooms,m,id,d,c]);
for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role}`);
 for(const sql of ['select * from chat_room_mentions',`select chat_activity_inbox('${users[0]}',array['main'])`,`select read_chat_activity('${users[0]}',array['main'])`]){await assert.rejects(()=>db.query(sql),/permission denied/);checks++;}
 await db.exec('reset role');
}
await db.exec('set role service_role');
await post('@Ann Marie hello @ann marie!');eq((await inbox(0)).mentionCount,0);eq((await inbox(1)).mentionCount,1);
await post('email@Ann @@Ann @Anna @Unknown');eq((await inbox()).mentionCount,0);
await post('@Ann @ANN hello!');eq((await inbox()).mentionCount,1);
await post('@Bob self');eq((await inbox(2)).mentionCount,0);
await post('@Ann bot','main',null);eq((await inbox()).mentionCount,1);
await post('@A.B literal punctuation');eq((await inbox(3)).mentionCount,1);
const edit=await post('@Ann edit');eq((await inbox()).mentionCount,2);
await db.query('update longboard_chat_messages set body=$1 where id=$2',['@Ann Marie edited',edit]);eq((await inbox()).mentionCount,1);eq((await inbox(1)).mentionCount,2);
await db.query('delete from longboard_chat_messages where id=$1',[edit]);eq((await inbox(1)).mentionCount,1);
await post('@Ann secret','shortscout');eq((await inbox()).mentionCount,1);eq((await inbox(0,['shortscout'])).mentionCount,1);
const old=await inbox();await post('@Ann newer','social');await read(0,old.mentionThrough);eq((await inbox()).mentionCount,1);eq((await inbox(0,['shortscout'])).mentionCount,1);
const social=await inbox();await read(1,social.mentionThrough,social.mentions[0].id);eq((await inbox()).mentionCount,1);
await read(0,social.mentionThrough,social.mentions[0].id);eq((await inbox()).mentionCount,0);
for(let i=0;i<55;i++)await post('@Ann count '+i);const many=await inbox();eq(many.mentions.length,50);eq(many.mentionCount,55);eq(many.roomCounts.main,55);
const c=randomUUID();await db.query("insert into longboard_chat_conversations(id,requester_id,recipient_id,status) values($1,$2,$3,'pending')",[c,members[2],members[0]]);
const dm=()=>db.query('insert into longboard_chat_direct_messages(conversation_id,sender_id) values($1,$2)',[c,members[2]]);
await dm();const first=await inbox();eq(first.dmCount,1);eq(first.dms[0].pending,true);eq((await inbox(1)).dmCount,0);
await dm();await read(0,0,null,first.dmThrough,c);eq((await inbox()).dmCount,1);eq((await inbox()).mentionCount,55);
await read(1,0,null,999,c);eq((await inbox()).dmCount,1);
await db.query('insert into longboard_chat_blocks values($1,$2)',[members[2],members[0]]);eq((await inbox()).dmCount,0);
await db.query('delete from longboard_chat_blocks');const last=await inbox();await read(0,last.mentionThrough,null,last.dmThrough);eq((await inbox()).dmCount,0);eq((await inbox()).mentionCount,0);
await dm();await db.query("update longboard_chat_conversations set status='declined' where id=$1",[c]);eq((await inbox()).dmCount,0);
console.log(`${checks} activity database checks passed`);await db.close();
