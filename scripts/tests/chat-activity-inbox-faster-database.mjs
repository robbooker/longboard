// HEALTH-2026-11-09-1 (#391) database check: the cheaper bell (chat_activity_inbox) and
// chat_account_rooms return exactly what the previous definitions returned, on the full migration
// chain from the mobile fixture. The previous bell comes from the rollback file under a
// fixture_old_ name; chat_account_rooms is checked against chat_account_has_room for every account
// and room. The data goes past the 50-row limits on purpose. Synthetic only.
//   node scripts/tests/chat-activity-inbox-faster-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-activity-faster-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const q=async(sql,args=[])=>(await db.query(sql,args)).rows,one=async(sql,args=[])=>(await q(sql,args))[0];

const rollback=await readFile(`${root}/supabase/rollbacks/20261110100000_chat_activity_inbox_faster.down.sql`,'utf8');
const previous=rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION'),rollback.indexOf('DROP FUNCTION'));
assert.ok(previous.includes('public.chat_activity_inbox(')&&!previous.includes('chat_account_rooms'),'rollback holds the previous bell');
await db.exec(previous.replace('public.chat_activity_inbox(','public.fixture_old_chat_activity_inbox('));

const account=async p=>(await one('select id from chat_accounts where longboard_user_id=$1',[p.id])).id;
const [alice,bob,mallory]=await Promise.all(people.map(account));
const [aliceMember,bobMember,malloryMember]=people.map(p=>p.member.id);

const post=(member,name,room,body,reply=null)=>one('insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id) values($1,$1,$2,$3,$4,$5) returning id',[member,name,body,room,reply]);
// Past the limit: 70 mentions (some in threads) and 70 reactions across rooms.
let root0=null;
for(let i=0;i<70;i++){
 const room=i%3===0?'main':i%3===1?'social':'developers';
 const m=await post(bobMember,'Bob',room,`@Alice mention ${i}`,i%5===0&&root0?.room===room?root0.id:null);
 if(i%5===4&&room!=='main')root0={id:(await post(malloryMember,'Mallory',room,`thread root ${i}`)).id,room};
 void m;
 const mine=await post(aliceMember,'Alice',room,`Alice post ${i}`);
 await q('insert into longboard_chat_reactions(message_id,guest_id,active) values($1,$2,true)',[mine.id,room==='main'||i%2?bobMember:malloryMember]);
}
// Replies to Alice from Mallory, so the reply-to block check has rows to drop.
for(let i=0;i<8;i++){
 const parent=await post(malloryMember,'Mallory','social',`Mallory asks ${i}`);
 await post(aliceMember,'Alice','social',`Alice answers ${i}`,parent.id);
 await post(bobMember,'Bob','social',`@Alice see ${i}`,parent.id);
}
const dmId=(await one('insert into longboard_chat_conversations(requester_id,recipient_id,status) values($1,$2,$3) on conflict do nothing returning id',[aliceMember,malloryMember,'accepted']))?.id
 ??(await one('select id from longboard_chat_conversations where least(requester_id,recipient_id)=least($1::uuid,$2::uuid) and greatest(requester_id,recipient_id)=greatest($1::uuid,$2::uuid)',[aliceMember,malloryMember])).id;
await q("update longboard_chat_conversations set status='accepted' where id=$1",[dmId]);
for(let i=0;i<30;i++){
 const m=await one('insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,$3,gen_random_uuid()) returning id',[dmId,aliceMember,`dm ${i}`]);
 await q("insert into chat_reaction_notifications(account_id,reactor_member_id,dm_message_id,emoji) values($1,$2,$3,'heart')",[alice,malloryMember,m.id]);
 await q('insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,$3,gen_random_uuid())',[dmId,malloryMember,`reply ${i}`]);
}
await q("select chat_pins($1,'pin',null,$2)",[alice,dmId]).catch(()=>{});

const all=['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','lb-review','club','admins'];
const roomLists=[all,['main','social','developers'],['social'],['main'],['main','developers'],['gainers','club'],['main','main','social','social'],[],null];
const actors=[alice,bob,mallory,'00000000-0000-4000-8000-0000000000ff'];
let checks=0;
const compare=async label=>{
 for(const who of actors)for(const rooms of roomLists){
  const row=await one('select chat_activity_inbox($1,$2) new,fixture_old_chat_activity_inbox($1,$2) old',[who,rooms]);
  assert.deepEqual(row.new,row.old,`${label}: ${who} ${JSON.stringify(rooms)}`);
  assert.equal(JSON.stringify(row.new),JSON.stringify(row.old),`${label} (text): ${who} ${JSON.stringify(rooms)}`);checks++;
 }
};
await compare('past the limits');
const a=(await one('select chat_activity_inbox($1,$2) r',[alice,all])).r;
assert.equal(a.mentions.length,50,'mention list is full');
assert.equal(a.reactions.length,50,'reaction list is full');
assert.ok(a.mentionCount>50&&a.reactionCount>50,'unread counts go past the list');
assert.ok(Object.keys(a.roomCounts).length>=3,'unread mentions in several rooms');
assert.ok(a.dmCount>0,'DMs covered');

const newest=async(sql,n)=>q(sql,[alice,n]);
await newest('update longboard_chat_messages set deleted_at=now() where id in (select message_id from chat_room_mentions where account_id=$1 order by seq desc limit $2)',5);
await compare('newest mentioned messages deleted');
await newest('update longboard_chat_messages set removed=true where id in (select message_id from chat_room_mentions where account_id=$1 and message_id in (select id from longboard_chat_messages where deleted_at is null) order by seq desc limit $2)',5);
await compare('next newest removed');
await newest('update chat_room_mentions set read_at=now() where id in (select id from chat_room_mentions where account_id=$1 order by seq desc limit $2)',20);
await newest('update chat_reaction_notifications set read_at=now() where id in (select id from chat_reaction_notifications where account_id=$1 order by seq desc limit $2)',20);
await compare('newest ones read');
for(const level of ['muted','mentions']){
 await q("insert into chat_room_notification_levels(account_id,room_slug,level) values($1,'social',$2) on conflict(account_id,room_slug) do update set level=excluded.level",[alice,level]);
 await compare(`Social ${level}`);
}
await q('delete from chat_room_notification_levels where account_id=$1',[alice]);
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[aliceMember,malloryMember]);
await compare('Alice blocks Mallory (reactor, thread roots, reply-to messages)');
await q('delete from longboard_chat_blocks');
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[bobMember,aliceMember]);
await compare('Bob blocks Alice');
await q('delete from longboard_chat_blocks');
await q("update longboard_chat_conversations set status='declined' where id=$1",[dmId]);
await compare('conversation declined');
await q("update longboard_chat_conversations set status='accepted' where id=$1",[dmId]);
await q("update profiles set role='user' where id=$1",[people[0].id]);
await compare('Alice no longer an admin');

// chat_account_rooms against chat_account_has_room, for every account and room: with and without
// a profile, ShortScout only, a bot, and no access at all.
const ssOnly='00000000-0000-4000-8000-0000000000aa',ssSubject='10000000-0000-4000-8000-0000000000aa';
await q('insert into chat_accounts(id) values($1) on conflict do nothing',[ssOnly]);
await q("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$2,'monthly') on conflict do nothing",[ssSubject,ssOnly]);
await q("insert into chat_shortscout_authorization(subject,decision,membership_level,valid_until) values($1,'allow','monthly',now()+interval '1 day') on conflict(subject) do update set decision=excluded.decision,membership_level=excluded.membership_level,valid_until=excluded.valid_until",[ssSubject]);
await q('insert into chat_accounts(id) values($1) on conflict do nothing',['00000000-0000-4000-8000-0000000000ab']);
const accounts=[...(await q('select id from chat_accounts')).map(r=>r.id),'00000000-0000-4000-8000-0000000000ff'];
assert.ok(accounts.length>=6,'accounts of every kind');
const lists=[[...all,'not-a-room',null],['club','gainers'],['social','social'],[],null];
for(const who of accounts){
 for(const rooms of lists){
  const byRoom=rooms===null?[]:(await q('select r from unnest($2::text[]) with ordinality u(r,o) where public.chat_account_has_room($1,r) order by o',[who,rooms])).map(x=>x.r);
  assert.deepEqual((await one('select public.chat_account_rooms($1,$2) v',[who,rooms])).v,byRoom,`rooms ${who} ${JSON.stringify(rooms)}`);checks++;
 }
}
const bots=(await q('select account_id from chat_bot_accounts')).length;

console.log(`PASS faster bell: ${checks} comparisons identical to the previous definitions (lists past the limit, hidden rows, reads, levels, blocks, admin change, room checks for ${accounts.length} accounts${bots?`, ${bots} bots`:''})`);
