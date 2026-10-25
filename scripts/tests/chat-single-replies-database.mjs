// #301 database check: 20261023120000_chat_single_level_replies.sql on the full migration chain
// from the mobile fixture, with nested replies seeded BEFORE it runs (as on production). Checks the
// move (one list, answered_id, time order, counts), idempotency, the paused-room/announcement
// guards during the move, new replies to replies, send retries, Buddy's one-answer rule, the event
// stream row, and that the rollback puts every original reply_to_id back. Synthetic data only.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
const name='20261023120000_chat_single_level_replies';
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
// Every migration but this one (applied below, after nested replies exist), and no HTTP server.
process.env.CHAT_FIXTURE_DEFER_MIGRATIONS=`${name}.sql`;
assert.match(source,/CHAT_FIXTURE_DEFER_MIGRATIONS/,'the fixture must still let a test hold back a migration');
source=source.slice(0,source.indexOf('function user(p)'))+'\nexport {db,people};';
const target=new URL(`.chat-single-replies-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const migration=await readFile(`${root}/supabase/migrations/${name}.sql`,'utf8');
const rollback=await readFile(`${root}/supabase/rollbacks/${name}.down.sql`,'utf8');
// The fixture skips migration-sized SQL it already ran; a trailing comment makes each run real.
let runs=0;const run=sql=>db.exec(`${sql}\n-- run ${++runs}`);
const q=async(sql,args=[])=>(await db.query(sql,args)).rows,one=async(sql,args=[])=>(await q(sql,args))[0];
const [alice,bob]=people;
// Seed history predates the send RPC's anti-spam window.
await q("update longboard_chat_messages set created_at=created_at-interval '1 hour' where guest_id=$1",[bob.member.id]);
await q("update profiles set role='admin' where id=$1",[alice.id]);
let minute=0;
const post=async(person,body,parent=null,room='main')=>(await one(
 "insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) values($1,$1,$2,$3,$4,$5,now()-interval '2 days'+($6*interval '1 minute')) returning *",
 [person.member.id,person.name,body,room,parent,++minute]));
const buddy=async(parent,body)=>(await one("insert into longboard_chat_messages(room_slug,guest_id,author_label,body,bot_slug,reply_to_id,created_at) values('main',null,'@Buddy',$1,'buddy',$2,now()-interval '2 days'+($3*interval '1 minute')) returning *",[body,parent,++minute]));

// An older conversation four levels deep, with a Buddy answer and a deleted middle reply.
const top=await post(alice,'SR top message');
const r1=await post(bob,'SR first reply',top.id);
const r1a=await post(alice,'SR answer to Bob',r1.id);
const r2=await post(bob,'SR second reply',top.id);
const r1a1=await post(bob,'SR answer to Alice',r1a.id);
const r1b=await post(bob,'SR Mallory to Bob',r1.id);
const r1a1x=await post(bob,'SR deepest',r1a1.id);
const b2=await buddy(r2.id,'SR Buddy answers Mallory');
const gone=await post(bob,'SR deleted later',top.id);
const goneChild=await post(alice,'SR under the deleted one',gone.id);
await q("update longboard_chat_messages set body='Message deleted',deleted_at=now(),revision=revision+1 where id=$1",[gone.id]);
// A second conversation in a room that is now paused, and one in announcements by a non-admin.
const sTop=await post(bob,'SR social top',null,'social'),sOne=await post(alice,'SR social reply',sTop.id,'social'),sTwo=await post(bob,'SR social nested',sOne.id,'social');
await q("update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$1 where room_slug='social'",[alice.id]);
const aTop=await post(alice,'SR announcement',null,'lb-announcements'),aOne=await post(alice,'SR announcement reply',aTop.id,'lb-announcements');
const aDeep=await post(alice,'SR nested announcement reply',aOne.id,'lb-announcements');
// Alice is no longer an admin, so the announcement writer guard would refuse to touch her rows.
await q("update profiles set role='user' where id=$1",[alice.id]);

const original=new Map((await q("select id,reply_to_id from longboard_chat_messages where reply_to_id is not null")).map(r=>[r.id,r.reply_to_id]));
const threadNodes=[top,r1,r1a,r2,r1a1,r1b,r1a1x,b2,gone,goneChild];
const before=(await q('select sum(reply_count)::int n from chat_thread_counts($1,$2)',['main',threadNodes.map(m=>m.id)]))[0].n;
assert.equal(before,9,'nine replies across all levels before (the deleted one is still shown)');
const eventHead=async room=>Number((await one('select seq from longboard_chat_room_event_heads where room_slug=$1',[room]))?.seq??0);
const headBefore=await eventHead('main');

await run(migration);
const rows=async ids=>new Map((await q('select id,reply_to_id,answered_id,removed,deleted_at from longboard_chat_messages where id=any($1)',[ids])).map(r=>[r.id,r]));
let after=await rows([...original.keys()]);
const expect={[r1.id]:[top.id,null],[r2.id]:[top.id,null],[gone.id]:[top.id,null],[r1a.id]:[top.id,r1.id],[r1a1.id]:[top.id,r1a.id],[r1b.id]:[top.id,r1.id],[r1a1x.id]:[top.id,r1a1.id],[b2.id]:[top.id,r2.id],[goneChild.id]:[top.id,gone.id],
 [sOne.id]:[sTop.id,null],[sTwo.id]:[sTop.id,sOne.id],[aOne.id]:[aTop.id,null],[aDeep.id]:[aTop.id,aOne.id]};
for(const [id,[parent,answered]] of Object.entries(expect))assert.deepEqual([after.get(id).reply_to_id,after.get(id).answered_id],[parent,answered],id);
console.log('PASS move: every reply to a reply (depth 2-4, Buddy, paused room, announcements) sits under its original message with answered_id = the message it answered.');
assert.equal(after.get(gone.id).removed,true,'the deleted reply has nothing under it any more');
assert.equal((await one('select count(*)::int n from longboard_chat_messages where reply_to_id is not null and reply_to_id in (select id from longboard_chat_messages where reply_to_id is not null)')).n,0,'no reply under a reply anywhere');
const list=await q("select id from longboard_chat_messages where reply_to_id=$1 and not removed order by unread_seq",[top.id]);
assert.deepEqual(list.map(r=>r.id),[r1,r1a,r2,r1a1,r1b,r1a1x,b2,goneChild].map(m=>m.id),'one list in time order');
const afterCount=(await one('select reply_count::int n from chat_thread_counts($1,$2)',['main',[top.id]])).n;
assert.equal(afterCount,before-1,'the same replies in one list; only the deleted placeholder stops counting');
const counted=(await one("select count(*)::int n from longboard_chat_messages where reply_to_id=$1 and deleted_at is null and not removed",[top.id])).n;
assert.equal(counted,8,'all eight live replies are kept');
assert.equal((await one("select is_open from longboard_chat_room_state where room_slug='social'")).is_open,false,'paused room stays paused');
assert((await eventHead('main'))>headBefore,'the moves are numbered room events, so open pages pick them up');
console.log(`PASS counts: ${before} replies across levels before, ${afterCount} in one list after (8 live + no deleted placeholder), time order kept, events stamped.`);

const snapshot=async()=>JSON.stringify(await q('select id,reply_to_id,answered_id,removed,revision,event_seq from longboard_chat_messages order by id'));
const once=await snapshot();await run(migration);assert.equal(await snapshot(),once,'running it again changes nothing');
console.log('PASS idempotent: a second run changes nothing.');

// New replies to a reply land under the original message, from SQL or the send RPC.
const fresh=await post(bob,'SR new answer to Bob',r1a1.id);
assert.deepEqual([fresh.reply_to_id,fresh.answered_id],[top.id,r1a1.id]);
const direct=await post(bob,'SR new direct reply',top.id);
assert.deepEqual([direct.reply_to_id,direct.answered_id],[top.id,null]);
const mention=await one("select thread_root_id from chat_room_mentions where message_id=$1 and category='reply' limit 1",[fresh.id]);
assert.equal(mention?.thread_root_id,top.id,'reply notifications still name the original message');
const client=crypto.randomUUID();
const send=async()=> (await one('select send_chat_room_message($1,$2,$3,$4,$5,$6) r',[bob.id,'main','SR via send',r1b.id,[],client])).r;
const sent=await send();assert.equal(sent.status,'sent');assert.deepEqual([sent.message.reply_to_id,sent.message.answered_id],[top.id,r1b.id]);
assert.equal((await send()).status,'duplicate','a retried reply to a reply is the same send');
const aClient=crypto.randomUUID();
const legacy=async()=>(await one('select send_chat_attachment_message($1,$2,$3,$4,$5,$6,$7) r',[bob.member.id,'main','Bob','SR via legacy send',r1.id,[],aClient])).r;
const first=await legacy();assert.deepEqual([first.reply_to_id,first.answered_id],[top.id,r1.id]);assert.equal((await legacy()).id,first.id);
console.log('PASS new replies: a reply to a reply (SQL, send RPC, legacy RPC) is stored under the original message with answered_id; retries stay duplicates; reply alerts keep the original message.');

// Buddy: still one answer per message it answered; a second answer to another reply is fine.
await assert.rejects(buddy(r2.id,'SR second Buddy answer to Mallory'),/duplicate|unique/);
const b1=await buddy(r1.id,'SR Buddy answers Bob');assert.deepEqual([b1.reply_to_id,b1.answered_id],[top.id,r1.id]);
const conflict=await q("insert into longboard_chat_messages(room_slug,guest_id,author_label,body,bot_slug,reply_to_id) values('main',null,'@Buddy','SR again','buddy',$1) on conflict ((coalesce(answered_id,reply_to_id))) where bot_slug='buddy' and reply_to_id is not null do nothing returning id",[r1.id]);
assert.deepEqual(conflict,[],'finish_chat_buddy_job conflict target matches the new index');
const existing=await one("select id from longboard_chat_messages where bot_slug='buddy' and coalesce(answered_id,reply_to_id)=$1",[r1.id]);assert.equal(existing.id,b1.id);
console.log('PASS Buddy: one answer per answered message, under the original message.');

const events=await one('select chat_room_events_after($1,$2,500) e',['main',headBefore]);
const row=events.e.rows.find(r=>r.id===fresh.id);assert.equal(row.answered_id,r1a1.id);assert.equal(row.reply_to_id,top.id);
console.log('PASS event stream rows carry answered_id.');

// Rollback: every reply goes back under the message it answered.
await run(rollback);
const restored=new Map((await q('select id,reply_to_id from longboard_chat_messages where id=any($1)',[[...original.keys()]])).map(r=>[r.id,r]));
for(const [id,parent] of original)assert.equal(restored.get(id).reply_to_id,parent,'restored '+id);
assert.equal((await one('select reply_to_id from longboard_chat_messages where id=$1',[fresh.id])).reply_to_id,r1a1.id,'a reply to a reply made after the move goes back under its reply');
assert.equal((await one("select count(*)::int n from information_schema.columns where table_name='longboard_chat_messages' and column_name='answered_id'")).n,0);
assert.equal((await one("select count(*)::int n from pg_indexes where indexname='longboard_chat_messages_buddy_reply_idx'")).n,1);
const nested=await post(bob,'SR nests again',r1a.id);assert.equal(nested.reply_to_id,r1a.id,'after rollback replies may nest again');
const resend=await one('select send_chat_room_message($1,$2,$3,$4,$5,$6) r',[bob.id,'main','SR via send',r1b.id,[],client]);
assert.equal(resend.r.status,'duplicate');
console.log('PASS rollback: every original reply_to_id is back (including new replies to replies), answered_id and the new index are gone, the old Buddy index and functions are back.');

// And forward again.
await run(migration);
const again=await rows([...original.keys()]);
for(const [id,[parent,answered]] of Object.entries(expect))assert.deepEqual([again.get(id).reply_to_id,again.get(id).answered_id],[parent,answered],'again '+id);
assert.equal((await one('select reply_to_id from longboard_chat_messages where id=$1',[nested.id])).reply_to_id,top.id);
console.log('PASS re-apply after rollback gives the same single list.');
