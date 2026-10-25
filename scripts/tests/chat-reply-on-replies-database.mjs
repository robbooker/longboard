// D-305 database check: reply alerts for Reply on a reply, on the full migration chain from the
// mobile fixture (one level of replies, #301, included). A reply sent to a reply goes through the
// send RPC as the app sends it (replyTo = the answered reply) and checks:
//  * it is stored under the original message, answered_id = the reply it answered;
//  * the answered reply's author gets one reply alert (bell row + push job), naming the original
//    message as the conversation, and so does the original author; the sender gets none;
//  * answering your own reply alerts nobody about yourself; when the answered author also wrote
//    the original message they get one alert, not two;
//  * the alert respects the reply-alert setting, room muting (bell, queued push and its delivery
//    check), blocks, and room access; replying to the original message is unchanged.
// Synthetic data only; no migration is added by D-305.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+'\nexport {db,people};';
const target=new URL(`.chat-reply-on-replies-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const q=async(sql,args=[])=>(await db.query(sql,args)).rows,one=async(sql,args=[])=>(await q(sql,args))[0];
const [alice,bob,mallory]=people;
assert.equal((await one("select count(*)::int n from information_schema.columns where table_name='longboard_chat_messages' and column_name='answered_id'")).n,1,'#301 is in the chain');
// Mallory is a Longboard member here too, so all three can write in LB.
await q("insert into user_tags(user_id,tag) select $1,'boardroom-cohort-1' where not exists(select 1 from user_tags where user_id=$1 and tag='boardroom-cohort-1')",[mallory.id]);
// Seed history predates the send RPC's anti-spam window.
await q("update longboard_chat_messages set created_at=created_at-interval '1 hour'");
let minute=0;
const post=async(person,body,parent=null)=>(await one(
 "insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) values($1,$1,$2,$3,'main',$4,now()-interval '2 days'+($5*interval '1 minute')) returning *",
 [person.member.id,person.name,body,parent,++minute]));
// As the app sends: the send RPC with replyTo. Each send moves the sender's earlier rows back so
// the burst limit never applies to this check.
const send=async(person,body,replyTo)=>{
 await q("update longboard_chat_messages set created_at=created_at-interval '1 hour' where member_id=$1",[person.member.id]);
 const r=(await one('select send_chat_room_message($1,$2,$3,$4,$5,$6) r',[person.id,'main',body,replyTo,[],crypto.randomUUID()])).r;
 assert.equal(r.status,'sent',JSON.stringify(r));return r.message;
};
const alerted=async id=>(await q("select account_id,category,thread_root_id from chat_room_mentions where message_id=$1 order by account_id",[id]));
const accounts=rows=>rows.map(r=>r.account_id).sort();
for(const p of people)await q('insert into chat_push_subscriptions(account_id,endpoint,p256dh,auth) values($1,$2,$3,$4)',[p.id,`https://push.example.test/${p.name}`,'p256dh-'+p.name,'auth-'+p.name]).catch(e=>{throw Error('push subscription seed: '+e.message);});
const pushed=async id=>(await q("select s.account_id from chat_push_jobs j join chat_push_subscriptions s on s.id=j.subscription_id join chat_room_mentions n on n.id=j.source_id where j.kind='room' and n.message_id=$1 order by 1",[id])).map(r=>r.account_id);
const target_=async(account,id)=>(await one("select chat_push_target('room',n.id,$1) t from chat_room_mentions n where n.account_id=$1 and n.message_id=$2",[account,id]))?.t??null;
const inbox=async account=>(await one("select chat_activity_inbox($1,array['main']) r",[account])).r;

// Mallory starts a conversation, Bob replies, Alice answers Bob's reply.
const top=await post(mallory,'RRD top');
const bobReply=await post(bob,'RRD Bob replies',top.id);
const answer=await send(alice,'RRD Alice answers Bob',bobReply.id);
assert.deepEqual([answer.reply_to_id,answer.answered_id],[top.id,bobReply.id],'stored under the original, answering Bob');
let rows=await alerted(answer.id);
assert.deepEqual(accounts(rows),[bob.id,mallory.id].sort(),'Bob (answered) and Mallory (original) get one alert each; Alice none');
assert(rows.every(r=>r.category==='reply'&&r.thread_root_id===top.id),'reply alerts name the original message');
assert.deepEqual(await pushed(answer.id),[bob.id,mallory.id].sort(),'one push each');
assert.equal(await target_(bob.id,answer.id),`/chat?room=main&thread=${top.id}`,'Bob\'s push opens the conversation');
const bell=(await inbox(bob.id)).mentions.filter(n=>n.messageId===answer.id);
assert.equal(bell.length,1);assert.equal(bell[0].category,'reply');assert.equal(bell[0].author,'Alice');
console.log('PASS answered person: Bob gets one reply alert (bell + push) for Alice answering his reply, Mallory one as the original author, Alice none.');

// Bob answers his own reply: no alert to Bob; the others in the conversation as before.
const own=await send(bob,'RRD Bob adds to his own reply',bobReply.id);
assert.deepEqual([own.reply_to_id,own.answered_id],[top.id,bobReply.id]);
assert.deepEqual(accounts(await alerted(own.id)),[alice.id,mallory.id].sort(),'no alert to yourself');
assert.deepEqual(await pushed(own.id),[alice.id,mallory.id].sort());
// Mallory answers her own reply in her own conversation: nobody alerts Mallory.
const mReply=await post(mallory,'RRD Mallory replies in her conversation',top.id);
const mOwn=await send(mallory,'RRD Mallory answers herself',mReply.id);
assert.equal((await alerted(mOwn.id)).some(r=>r.account_id===mallory.id),false);
console.log('PASS self: answering your own reply never alerts you.');

// Mallory wrote both the original and the answered reply: one alert, not two.
const both=await send(bob,'RRD Bob answers Mallory\'s reply',mReply.id);
rows=await alerted(both.id);
assert.equal(rows.filter(r=>r.account_id===mallory.id).length,1,'one alert for the original + answered author');
assert.equal((await pushed(both.id)).filter(a=>a===mallory.id).length,1,'one push');
assert.equal((await inbox(mallory.id)).mentions.filter(n=>n.messageId===both.id).length,1,'one bell row');
console.log('PASS no double alert when the answered reply and the original message have the same author.');

// Replying to the original message: unchanged (no answered_id, everyone in the conversation).
const plain=await send(alice,'RRD Alice replies to the original',top.id);
assert.deepEqual([plain.reply_to_id,plain.answered_id],[top.id,null]);
assert.deepEqual(accounts(await alerted(plain.id)),[bob.id,mallory.id].sort());
console.log('PASS a reply to the original message is unchanged.');

// Settings: reply alerts off, the room muted (bell + push), a block, no room access.
await q('insert into chat_activity_preferences(account_id,replies) values($1,false) on conflict(account_id) do update set replies=false',[bob.id]);
const off=await send(alice,'RRD with Bob\'s reply alerts off',bobReply.id);
assert.equal((await alerted(off.id)).some(r=>r.account_id===bob.id),false,'reply alerts off');
await q('update chat_activity_preferences set replies=true where account_id=$1',[bob.id]);
await q("insert into chat_room_notification_levels(account_id,room_slug,level) values($1,'main','muted')",[bob.id]);
const muted=await send(alice,'RRD with main muted for Bob',bobReply.id);
assert.equal((await inbox(bob.id)).mentions.some(n=>n.messageId===muted.id),false,'muted room: not in the bell');
assert.equal((await pushed(muted.id)).includes(bob.id),false,'muted room: no push queued');
await q("update chat_room_notification_levels set level='mentions' where account_id=$1",[bob.id]);
const mentionsOnly=await send(alice,'RRD with main on mentions only for Bob',bobReply.id);
assert.equal((await inbox(bob.id)).mentions.filter(n=>n.messageId===mentionsOnly.id).length,1,'mentions only: a reply to you still alerts');
await q("update chat_room_notification_levels set level='muted' where account_id=$1",[bob.id]);
assert.equal(await target_(bob.id,mentionsOnly.id),null,'muting later stops a queued push at delivery');
await q('delete from chat_room_notification_levels where account_id=$1',[bob.id]);
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[bob.member.id,alice.member.id]);
const blocked=await send(alice,'RRD after Bob blocked Alice',bobReply.id);
assert.equal((await alerted(blocked.id)).some(r=>r.account_id===bob.id),false,'blocked sender: no alert');
await q('delete from longboard_chat_blocks where blocker_id=$1',[bob.member.id]);
const again=await send(alice,'RRD after the block is lifted',bobReply.id);
assert.equal((await alerted(again.id)).filter(r=>r.account_id===bob.id).length,1);
console.log('PASS settings: reply alerts off, muted room (bell, queued push, delivery), mentions-only, blocks all respected.');

await db.close();
console.log('PASS D-305 reply alerts for replies to replies.');
