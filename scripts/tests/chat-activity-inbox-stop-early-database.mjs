// HEALTH-2026-11-02-1 database check: the bell that stops at 50 (chat_activity_inbox) and the plpgsql
// room check return exactly what the previous definitions returned, on the
// full migration chain from the mobile fixture. The previous definitions come from the rollback
// file under fixture_old_* names. The data goes past the 50-row limits on purpose. Synthetic only.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-activity-stop-early-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const q=async(sql,args=[])=>(await db.query(sql,args)).rows,one=async(sql,args=[])=>(await q(sql,args))[0];

const language=async fn=>(await one('select l.lanname from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=$1::regproc',['public.'+fn])).lanname;
assert.equal(await language('chat_account_has_room'),'plpgsql');
assert.equal(await language('chat_activity_inbox'),'plpgsql');
const rollback=await readFile(`${root}/supabase/rollbacks/20261102120000_chat_activity_inbox_stop_early.down.sql`,'utf8');
await db.exec(rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION'))
 .replace(/public\.(chat_activity_inbox|chat_account_has_room)\(/g,'public.fixture_old_$1('));

const account=async p=>(await one('select id from chat_accounts where longboard_user_id=$1',[p.id])).id;
const [alice,bob,mallory]=await Promise.all(people.map(account));
const [aliceMember,bobMember,malloryMember]=people.map(p=>p.member.id);

const post=(member,name,room,body,reply=null)=>one('insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id) values($1,$1,$2,$3,$4,$5) returning id',[member,name,body,room,reply]);
// Past the limit: 70 mentions and 70 reactions, across rooms, with the newest ones hidden in
// different ways, so a list that stopped too early or filtered too late would show different rows.
const posted=[];
for(let i=0;i<70;i++){
 const room=i%3===0?'main':'social';
 await post(bobMember,'Bob',room,`@Alice mention ${i}`);
 const mine=await post(aliceMember,'Alice',room,`Alice post ${i}`);
 posted.push(mine.id);
 await q('insert into longboard_chat_reactions(message_id,guest_id,active) values($1,$2,true)',[mine.id,room==='main'||i%2?bobMember:malloryMember]);
}
// DM reactions in between, so the newest 50 mix both kinds.
const dmId=(await one('insert into longboard_chat_conversations(requester_id,recipient_id,status) values($1,$2,$3) on conflict do nothing returning id',[aliceMember,malloryMember,'accepted']))?.id
 ??(await one('select id from longboard_chat_conversations where least(requester_id,recipient_id)=least($1::uuid,$2::uuid) and greatest(requester_id,recipient_id)=greatest($1::uuid,$2::uuid)',[aliceMember,malloryMember])).id;
await q("update longboard_chat_conversations set status='accepted' where id=$1",[dmId]);
for(let i=0;i<30;i++){
 const m=await one('insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,$3,gen_random_uuid()) returning id',[dmId,aliceMember,`dm ${i}`]);
 await q("insert into chat_reaction_notifications(account_id,reactor_member_id,dm_message_id,emoji) values($1,$2,$3,'heart')",[alice,malloryMember,m.id]);
 await q('insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,$3,gen_random_uuid())',[dmId,malloryMember,`reply ${i}`]);
}

const all=['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','lb-review','admins'];
const roomLists=[all,['main','social'],['social'],['main'],['gainers'],[],null];
const actors=[alice,bob,mallory,'00000000-0000-4000-8000-0000000000ff'];
let checks=0;
const compare=async label=>{
 for(const who of actors)for(const rooms of roomLists){
  const row=await one('select chat_activity_inbox($1,$2) new,fixture_old_chat_activity_inbox($1,$2) old',[who,rooms]);
  assert.deepEqual(row.new,row.old,`${label}: ${who} ${JSON.stringify(rooms)}`);checks++;
 }
};
await compare('past the limits');
const a=(await one('select chat_activity_inbox($1,$2) r',[alice,all])).r;
assert.equal(a.mentions.length,50,'mention list is full');
assert.equal(a.reactions.length,50,'reaction list is full');
assert.ok(a.reactions.some(r=>r.kind==='dm')&&a.reactions.some(r=>r.kind==='room'),'list mixes both kinds');
assert.ok(a.mentionCount>50&&a.reactionCount>50,'unread counts go past the list');
assert.ok(a.dmCount>0,'DMs covered');

// Newest ones hidden in each way the checks can hide them.
const newest=async(sql,n)=>q(sql,[alice,n]);
await newest('update longboard_chat_messages set deleted_at=now() where id in (select message_id from chat_room_mentions where account_id=$1 order by seq desc limit $2)',5);
await compare('newest mentioned messages deleted');
await newest('update longboard_chat_messages set removed=true where id in (select message_id from chat_room_mentions where account_id=$1 and message_id in (select id from longboard_chat_messages where deleted_at is null) order by seq desc limit $2)',5);
await compare('next newest removed');
await newest('update longboard_chat_messages set deleted_at=now() where id in (select room_message_id from chat_reaction_notifications where account_id=$1 and room_message_id is not null order by seq desc limit $2)',5);
await compare('newest reacted-to messages deleted');
await newest('update chat_room_mentions set read_at=now() where id in (select id from chat_room_mentions where account_id=$1 order by seq desc limit $2)',20);
await newest('update chat_reaction_notifications set read_at=now() where id in (select id from chat_reaction_notifications where account_id=$1 order by seq desc limit $2)',20);
await compare('newest ones read');
await q("insert into chat_room_notification_levels(account_id,room_slug,level) values($1,'social','muted') on conflict(account_id,room_slug) do update set level=excluded.level",[alice]);
await compare('Social muted');
await q("insert into chat_room_notification_levels(account_id,room_slug,level) values($1,'social','mentions') on conflict(account_id,room_slug) do update set level=excluded.level",[alice]);
await compare('Social mentions only');
await q('delete from chat_room_notification_levels where account_id=$1',[alice]);
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[aliceMember,malloryMember]);
await compare('Alice blocks the reactor of half the rows');
await q('delete from longboard_chat_blocks');
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[bobMember,aliceMember]);
await compare('Bob blocks Alice');
await q('delete from longboard_chat_blocks');
await q("update longboard_chat_conversations set status='declined' where id=$1",[dmId]);
await compare('conversation declined');
await q("update longboard_chat_conversations set status='accepted' where id=$1",[dmId]);

// The room check, for every account and room, with and without a profile.
const ssOnly='00000000-0000-4000-8000-0000000000aa',ssSubject='10000000-0000-4000-8000-0000000000aa';
await q('insert into chat_accounts(id) values($1) on conflict do nothing',[ssOnly]);
await q("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$2,'monthly') on conflict do nothing",[ssSubject,ssOnly]);
await q("insert into chat_shortscout_authorization(subject,decision,membership_level,valid_until) values($1,'allow','monthly',now()+interval '1 day') on conflict(subject) do update set decision=excluded.decision,membership_level=excluded.membership_level,valid_until=excluded.valid_until",[ssSubject]);
const noAccess='00000000-0000-4000-8000-0000000000ab';
await q('insert into chat_accounts(id) values($1) on conflict do nothing',[noAccess]);
const accounts=(await q('select id from chat_accounts')).map(r=>r.id);
assert.ok(accounts.length>=5,'accounts with and without a profile');
const attempt=async(fn,who,room)=>{try{return {value:(await one(`select public.${fn}($1,$2) v`,[who,room])).v};}catch(error){return {error:error.message};}};
for(const who of [...accounts,'00000000-0000-4000-8000-0000000000ff'])for(const room of [...all,'not-a-room',null]){
 assert.deepEqual(await attempt('chat_account_has_room',who,room),await attempt('fixture_old_chat_account_has_room',who,room),`room check ${who} ${room}`);checks++;
}

console.log(`PASS bell stops at 50: ${checks} comparisons identical to the previous definitions (lists past the limit, hidden rows, reads, levels, blocks, room checks)`);
