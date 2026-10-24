// D-212 database check: the bell's counters (chat_activity_counts over chat_activity_counters)
// give exactly the numbers chat_activity_inbox gives, after every kind of write the bell cares
// about: room sends, mentions, replies, edits, deletes (soft, removed, hard), reactions on and
// off, reads of each kind, DMs (send, read, delete, reactions), conversation status, blocks,
// room levels and room access changes. After each step it also checks that every stored
// counter row equals a fresh recount (no drift). Full migration chain from the mobile fixture;
// synthetic data only.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
// Keep the database setup and every migration; drop the HTTP server.
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-activity-counters-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const q=async(sql,args=[])=>(await db.query(sql,args)).rows,one=async(sql,args=[])=>(await q(sql,args))[0];

const account=async p=>(await one('select id from chat_accounts where longboard_user_id=$1',[p.id])).id;
const [alice,bob,mallory]=await Promise.all(people.map(account));
const [aliceMember,bobMember,malloryMember]=people.map(p=>p.member.id);
// A ShortScout-only account (no Longboard profile) with an allowed mastermind authorization.
const ss='00000000-0000-4000-8000-0000000000aa',ssSubject='10000000-0000-4000-8000-0000000000aa';
await q('insert into chat_accounts(id) values($1)',[ss]);
await q("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$2,'mastermind')",[ssSubject,ss]);
await q("insert into chat_shortscout_authorization(subject,decision,membership_level,valid_until) values($1,'allow','mastermind',now()+interval '1 day') on conflict(subject) do update set decision=excluded.decision,membership_level=excluded.membership_level,valid_until=excluded.valid_until",[ssSubject]);
const ssMember=(await one("select longboard_chat_link_member($1,'SS member',null) m",[ss])).m.id;

const all=['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new'];
const actors=[alice,bob,mallory,ss,'00000000-0000-4000-8000-0000000000ff'];
const countKeys=['roomLevels','replyNotifications','mentionCount','mentionThrough','roomCounts','roomThrough','pinnedDmUnread','dmCount','dmThrough','reactionCount','reactionThrough'];
const pick=o=>Object.fromEntries(countKeys.map(k=>[k,o[k]]));
let checks=0;
// The room lists the app could pass: everything the person may read (as allowedChatRooms
// does), and parts of it (one room, without Social, conversation rooms only).
const roomListsFor=async who=>{
 const allowed=(await one('select coalesce(array_agg(r order by o),$2::text[]) rooms from unnest($1::text[]) with ordinality u(r,o) where chat_account_has_room($3,r)',[all,[],who])).rooms;
 return [allowed,allowed.filter(r=>r!=='social'),allowed.filter(r=>r==='social'),allowed.filter(r=>['main','social','shortscout'].includes(r)),[]];
};
const compare=async label=>{
 for(const who of actors)for(const rooms of await roomListsFor(who)){
  const row=await one('select chat_activity_counts($1,$2) counts,chat_activity_inbox($1,$2) inbox',[who,rooms]);
  assert.deepEqual(row.counts,pick(row.inbox),`${label}: ${who} ${JSON.stringify(rooms)}`);checks++;
 }
 // No drift: every stored row is exactly a fresh recount, and nothing is missing.
 const stored=await q("select account_id::text a,kind,scope,unread,through_seq::text t from chat_activity_counters order by 1,2,3");
 const fresh=await q("select a.id::text a,c.kind,c.scope,c.unread,c.through_seq::text t from chat_accounts a cross join lateral chat_activity_counter_compute(a.id) c order by 1,2,3");
 assert.deepEqual(stored,fresh,`${label}: stored counters equal a fresh recount`);checks++;
};
const bell=async(who=alice)=>(await one('select chat_activity_counts($1,$2) c',[who,(await roomListsFor(who))[0]])).c;

const post=(member,name,room,body,reply=null)=>one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id) values($1,$1,$2,$3,$4,$5) returning id",[member,name,body,room,reply]);
const react=(message,member,active=true)=>q("insert into longboard_chat_reactions(message_id,guest_id,active) values($1,$2,$3) on conflict do nothing",[message,member,active]);
await compare('fixture as loaded (backfilled)');

// Sends and mentions in several rooms, a thread with replies, an announcement for everyone.
const mainMention=await post(bobMember,'Bob','main','@Alice main check');
await post(bobMember,'Bob','social','@Alice @Mallory social check');
const fromMallory=await post(malloryMember,'Mallory','social','@Alice from Mallory');
const root1=await post(aliceMember,'Alice','social','Alice thread root');
await post(bobMember,'Bob','social','Bob replies',root1.id);
const malloryReply=await post(malloryMember,'Mallory','social','Mallory replies',root1.id);
await post(aliceMember,'Alice','lb-announcements','Announcement for everyone');
await post(ssMember,'SS member','shortscout','@Alice shortscout check');
const malloryRoot=await post(malloryMember,'Mallory','social','Mallory thread root');
await post(aliceMember,'Alice','social','Alice replies to Mallory',malloryRoot.id);
await post(bobMember,'Bob','social','Bob replies to Mallory too',malloryRoot.id);
await compare('sends, mentions and replies');
let b=await bell();
assert.ok(b.mentionCount>=4&&Object.keys(b.roomCounts).length>=2,'Alice has mentions in several rooms');

// Reactions on and off.
const aliceMain=await post(aliceMember,'Alice','main','React to Alice');
const bobSocial=await post(bobMember,'Bob','social','React to Bob');
await react(aliceMain.id,bobMember);
const aliceSocial=await post(aliceMember,'Alice','social','React to Alice in social');
for(const m of [bobMember,malloryMember,ssMember])await react(aliceSocial.id,m);
for(const m of [aliceMember,malloryMember])await react(bobSocial.id,m);
await compare('reactions');
assert.ok((await bell()).reactionCount>=4,'Alice has reactions');
await q('update longboard_chat_reactions set active=false where message_id=$1 and guest_id=$2',[aliceSocial.id,malloryMember]);
await compare('a reaction taken back');

// Reads: one mention, then a room's alerts, then everything up to a cursor, then reactions.
await q("update chat_room_mentions set read_at=now() where id=(select id from chat_room_mentions where account_id=$1 and read_at is null order by seq limit 1)",[alice]);
await compare('one mention read');
b=await bell();
await q('select read_chat_activity($1,$2,$3)',[alice,['main'],b.roomThrough.main??0]);
await compare('main alerts read');
b=await bell();
await q('select read_chat_activity_notifications($1,$2,0,null,0,null,$3,null)',[alice,(await roomListsFor(alice))[0],b.reactionThrough]);
await compare('reactions read');

// Edits, deletes and removals of mentioned and reacted-to messages.
await q("update longboard_chat_messages set body='@Alice from Mallory (edited)', edited_at=now() where id=$1",[fromMallory.id]);
await compare('a mention edited');
const extra=await post(bobMember,'Bob','social','@Alice another one');
await q('update longboard_chat_messages set deleted_at=now() where id=$1',[extra.id]);
await compare('a mention soft-deleted');
await q('update longboard_chat_messages set removed=true where id=$1',[malloryReply.id]);
await compare('a reply removed by an admin');
await q('update longboard_chat_messages set removed=false where id=$1',[malloryReply.id]);
await compare('the removal undone');
const reacted=await post(aliceMember,'Alice','social','Soon deleted');await react(reacted.id,bobMember);
await q('update longboard_chat_messages set deleted_at=now() where id=$1',[reacted.id]);
await q('update longboard_chat_messages set deleted_at=now() where id=$1',[aliceMain.id]);
await compare('a reacted-to message deleted');
const gone=await post(ssMember,'SS member','social','@Alice soon gone');
await react(gone.id,aliceMember);
await q('delete from longboard_chat_messages where id=$1',[gone.id]);
await compare('a message hard-deleted (cascade)');
await q('delete from longboard_chat_messages where id=$1',[mainMention.id]).catch(()=>{});
await compare('a mention hard-deleted');

// DMs: accepted (both ways), pending; pins; sends, reactions, reads, deletes, status changes.
const dm=async(a,b2,status='accepted')=>(await one("update longboard_chat_conversations set status=$3 where least(requester_id,recipient_id)=least($1::uuid,$2::uuid) and greatest(requester_id,recipient_id)=greatest($1::uuid,$2::uuid) returning id",[a,b2,status]))?.id
 ??(await one("insert into longboard_chat_conversations(requester_id,recipient_id,status) values($1,$2,$3) returning id",[a,b2,status])).id;
const send=(c,sender,body)=>one('insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,$3,gen_random_uuid()) returning *',[c,sender,body]);
const ab=await dm(aliceMember,bobMember),am=await dm(malloryMember,aliceMember),bm=await dm(bobMember,malloryMember,'pending');
const fromAlice=await send(ab,aliceMember,'Hi Bob');await send(ab,bobMember,'Hi Alice');const there=await send(ab,bobMember,'Are you there?');
await send(am,malloryMember,'Hello from Mallory');await send(bm,bobMember,'Hello Mallory');
for(const c of [ab,am])await q('insert into chat_conversation_pins(account_id,conversation_id) values($1,$2) on conflict do nothing',[alice,c]);
await compare('DMs and pins');
assert.ok((await bell()).dmCount>=3&&Object.keys((await bell()).pinnedDmUnread).length===2,'Alice has unread DMs and two pins');
await q("insert into chat_reaction_notifications(account_id,reactor_member_id,dm_message_id,emoji) values($1,$2,$3,'heart')",[alice,bobMember,fromAlice.id]);
await compare('a DM reaction');
await q('update longboard_chat_direct_messages set deleted_at=now() where id=$1',[there.id]);
await compare('a DM deleted');
await q('update longboard_chat_conversations set recipient_read_seq=(select max(seq) from longboard_chat_direct_messages where conversation_id=$1) where id=$1 and recipient_id=$2',[ab,aliceMember]);
await q('update longboard_chat_conversations set requester_read_seq=(select max(seq) from longboard_chat_direct_messages where conversation_id=$1) where id=$1 and requester_id=$2',[ab,aliceMember]);
await compare('a DM conversation read');
b=await bell();
await q('select read_chat_activity($1,$2,0,null,$3,null)',[alice,(await roomListsFor(alice))[0],b.dmThrough]);
await compare('all DMs read through the cursor');
await send(am,malloryMember,'Still there?');
await q("update longboard_chat_conversations set status='declined' where id=$1",[am]);
await compare('a conversation declined');
await q("update longboard_chat_conversations set status='accepted' where id=$1",[am]);
await q("update longboard_chat_conversations set status='accepted' where id=$1",[bm]);
await compare('conversations accepted');
await q("update longboard_chat_conversations set status='pending' where id=$1",[ab]);
await compare('a conversation back to pending (DM reactions need accepted)');
await q("update longboard_chat_conversations set status='accepted' where id=$1",[ab]);
const temp=await dm(ssMember,aliceMember);await send(temp,ssMember,'Short-lived');
await compare('a new conversation');
await q('delete from longboard_chat_conversations where id=$1',[temp]);
await compare('a conversation deleted (cascade)');

// Blocks either way, room levels, room access.
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[aliceMember,malloryMember]);
await compare('Alice blocks Mallory');
const level=(who,room,l)=>l==='all'?q('delete from chat_room_notification_levels where account_id=$1 and room_slug=$2',[who,room]):q("insert into chat_room_notification_levels(account_id,room_slug,level) values($1,$2,$3) on conflict(account_id,room_slug) do update set level=excluded.level",[who,room,l]);
await level(alice,'social','muted');await level(alice,'main','mentions');await level(alice,'lb-announcements','mentions');await level(bob,'social','mentions');
await compare('room levels and a block');
await q('delete from longboard_chat_blocks');
await compare('unblocked');
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[bobMember,aliceMember]);
await compare('Bob blocks Alice');
await q('delete from longboard_chat_blocks');await level(alice,'social','all');await level(alice,'main','all');
await post(aliceMember,'Alice','shortscout','@SS member hello from Alice');
await post(bobMember,'Bob','social','@SS member hello from Bob');
await compare('mentions for the ShortScout member');
await q('update chat_shortscout_authorization set valid_until=now()-interval \'1 minute\' where subject=$1',[ssSubject]);
await compare('ShortScout authorization expired (rooms change)');
await q('update chat_shortscout_authorization set valid_until=now()+interval \'1 day\' where subject=$1',[ssSubject]);
await compare('ShortScout authorization renewed');

// Bulk writes in one statement (one trigger call for many rows), and visible-message reads.
await q("update chat_room_mentions set read_at=null where account_id=$1",[alice]);
await compare('every mention unread again (one statement)');
await q("update chat_reaction_notifications set read_at=null");
await compare('every reaction unread again (one statement)');
await q("update chat_room_mentions set read_at=now()");
await q("delete from chat_reaction_notifications where account_id=$1",[bob]);
await compare('bulk read and bulk delete');

// The two comparison scripts Rob runs on prod (read-only) agree with this test on this data:
// the precheck (counters worked out inline, before the migration) and the compare (after it).
const root=new URL('../../',import.meta.url).pathname;
await q("update chat_room_mentions set read_at=null where account_id=$1",[alice]);
for(const file of ['chat-activity-counters-precheck.sql','chat-activity-counters-compare.sql']){
 const r=await one(await readFile(`${root}scripts/sql/${file}`,'utf8'));
 assert.ok(Number(r.accounts)>=5&&Number(r.matching)===Number(r.accounts),`${file}: ${JSON.stringify(r.mismatches)}`);
 assert.deepEqual(r.mismatches,[],file);
 if('drifted_rows' in r)assert.equal(Number(r.drifted_rows),0,`${file}: no drift`);
 assert.ok(Number(r.mentions_total)>0&&Number(r.counter_rows)>0,`${file} sees the fixture's alerts`);
 checks++;
}

// Rollback, then the migration again (it is safe to re-run): the counters come back right.
await db.exec(await readFile(`${root}supabase/rollbacks/20261024120000_chat_activity_counters.down.sql`,'utf8'));
assert.equal(Number((await one("select count(*) n from pg_proc where proname like 'chat_activity_count%'")).n),0,'rollback removes the functions');
assert.equal((await one("select to_regclass('public.chat_activity_counters') t")).t,null,'rollback removes the table');
await post(bobMember,'Bob','social','@Alice while the counters were gone');
// (The fixture's exec skips SQL text it already ran, so each run gets its own trailing comment.)
const migration=await readFile(`${root}supabase/migrations/20261024120000_chat_activity_counters.sql`,'utf8');
for(const run of [1,2])await db.exec(`${migration}\n-- test re-run ${run}`);
await compare('rolled back and applied again (twice)');

// Speed: the counters read against the inbox, same person and rooms.
const rooms=(await roomListsFor(alice))[0];
await q("update chat_room_mentions set read_at=null");
const time=async fn=>{for(let i=0;i<20;i++)await q(`select ${fn}($1,$2)`,[alice,rooms]);const t=performance.now();for(let i=0;i<200;i++)await q(`select ${fn}($1,$2)`,[alice,rooms]);return (performance.now()-t)/200;};
const inboxMs=await time('chat_activity_inbox'),countsMs=await time('chat_activity_counts');
// What the triggers add to a write: 100 DMs and 100 room messages with a mention, with the
// counter triggers on and then off.
const writes=async()=>{const t=performance.now();for(let i=0;i<100;i++){await send(ab,bobMember,`timing ${i}`);await post(bobMember,'Bob','social',`@Alice timing ${i}`);}return (performance.now()-t)/200;};
const withTriggers=await writes();
const tables=['chat_room_mentions','chat_reaction_notifications','longboard_chat_messages','longboard_chat_direct_messages','longboard_chat_conversations','longboard_chat_blocks','longboard_chat_members'];
const triggers=await q("select tgrelid::regclass::text t,tgname from pg_trigger where tgname like 'chat_activity_counters%'");
for(const r of triggers)await q(`alter table ${r.t} disable trigger ${r.tgname}`);
const withoutTriggers=await writes();
for(const r of triggers)await q(`alter table ${r.t} enable trigger ${r.tgname}`);
assert.ok(tables.every(t=>triggers.some(r=>r.t===t)),'every table has its trigger');
console.log(`write (PGlite, 200 writes): ${withTriggers.toFixed(2)} ms with the counter triggers, ${withoutTriggers.toFixed(2)} ms without`);
console.log(`bell read (PGlite, 200 runs): chat_activity_inbox ${inboxMs.toFixed(2)} ms, chat_activity_counts ${countsMs.toFixed(2)} ms`);
console.log(`PASS bell counters: ${checks} comparisons identical to chat_activity_inbox and to a fresh recount`);
