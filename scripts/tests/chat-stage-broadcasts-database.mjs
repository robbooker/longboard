// #524 database check: webinar notices (20261126120000_chat_stage_broadcasts.sql). Runs on the full
// migration chain from the mobile fixture. Synthetic data only.
//  1. the migration rolls back (the two changed functions exactly as they were) and re-applies;
//  2. the table: service role only; one open broadcast per room; a notice is created at most once;
//     a stale open broadcast is closed when a new one opens; close, reopen; last seen live;
//  3. Booker Stock Club: the notice posts, and its words change through the functions only;
//     everything else in the club is refused as before (a direct edit of the notice, the setting
//     alone, another bot post, a stock-pick card, a member, moving rows, changing anything but words);
//  4. bell entries: everyone who can read the room, in slices, with the place remembered; not bots,
//     not "Mentions only"/"Muted", not the admin named; personal blocks are not applied; a second
//     run adds nothing; nothing after the end;
//  5. phones: a club notice's bell entry queues a push; a reply alert in the club still does not;
//  6. the recording: only on an ended notice of that room; the first link wins for posts; an admin
//     replaces or removes; a notice from before this table gets its row.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`\nexport {db,people};`;
const target=new URL(`.chat-stage-broadcasts-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const all=async(sql,args=[])=>(await db.query(sql,args)).rows;
const file=async path=>readFile(`${root}/supabase/${path}`,'utf8');
const migration={up:await file('migrations/20261126120000_chat_stage_broadcasts.sql'),down:await file('rollbacks/20261126120000_chat_stage_broadcasts.down.sql')};
const [alice,bob,mallory]=people.map(p=>p.id);
const memberOf=async who=>(await one('select id from longboard_chat_members where user_id=$1',[who])).id;
const [aliceMember,bobMember,malloryMember]=[await memberOf(alice),await memberOf(bob),await memberOf(mallory)];
const id=n=>`5240000${n}-0000-4000-8000-000000000000`.replace(/^(.{8}).*?-/,(m,a)=>`${String(n).padStart(8,'5')}-`);
const LIVE=room=>`🔴 ${room} is live now. Watch live: https://chat.example.test/chat?room=x&stage=1`;
const ENDED=room=>`The live video in ${room} has ended. The recording will follow.`;
const YT='https://www.youtube.com/watch?v=dQw4w9WgXcQ',LOOM='https://www.loom.com/share/0123456789abcdef0123456789abcdef';
const RECORDED=(room,url)=>`The live video in ${room} has ended. Watch the recording: ${url}`;
const open=async(notice,room,name,started='now()')=>(await one(`select chat_stage_broadcast_open($1,$2,$3,${started},$4) r`,[notice,room,LIVE(name),ENDED(name)])).r;
const close=async(notice,name,at='now()')=>(await one(`select chat_stage_broadcast_close($1,$2,${at}) r`,[notice,ENDED(name)])).r;
const row=notice=>one('select * from chat_stage_broadcasts where notice_id=$1',[notice]);
const message=notice=>one('select * from longboard_chat_messages where id=$1',[notice]);
const bells=async notice=>(await all('select account_id from chat_room_mentions where message_id=$1 order by account_id',[notice])).map(r=>r.account_id);
const notify=async(notice,skip=null,limit=500)=>(await one('select chat_stage_broadcast_notify($1,$2,$3) r',[notice,skip,limit])).r;
const state=async()=>({
 club:(await one(`select pg_get_functiondef('public.enforce_chat_club_post'::regproc) d`)).d,
 push:(await one(`select pg_get_functiondef('public.queue_chat_push'::regproc) d`)).d,
 table:(await one(`select to_regclass('public.chat_stage_broadcasts')::text t`)).t,
 functions:(await all(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'chat_stage_%' order by 1`)).map(r=>r.proname),
});

// 1. The migration rolls back and re-applies.
const applied=await state();
assert.match(applied.club,/#524/);assert.match(applied.push,/#524/);assert.equal(applied.table,'chat_stage_broadcasts');
assert.deepEqual(applied.functions,['chat_stage_broadcast_close','chat_stage_broadcast_notify','chat_stage_broadcast_open','chat_stage_broadcast_recording','chat_stage_broadcast_reopen','chat_stage_notice_rewrite']);
await db.exec(migration.down);
const before=await state();
assert.doesNotMatch(before.club,/#524/);assert.doesNotMatch(before.push,/#524/);assert.equal(before.table,null);assert.deepEqual(before.functions,[]);
// Exactly the definitions the migration says it was written against (its own check reads these).
assert.equal((await one(`select md5(pg_get_functiondef('public.enforce_chat_club_post'::regproc)) m`)).m,'719dc4ec7c9a4e58b9e12892606ce8b7');
assert.equal((await one(`select md5(pg_get_functiondef('public.queue_chat_push'::regproc)) m`)).m,'b9feb024c9af1cfa01b87c1c4b970236');
await db.exec(migration.up+'\n-- again');
assert.deepEqual(await state(),applied,'re-applies cleanly');
// A function that is not the expected one stops the migration before anything is made.
await db.exec(migration.down+'\n-- twice');
await db.exec(`create or replace function public.queue_chat_push() returns trigger language plpgsql set search_path to '' as $f$ begin return new; end $f$`);
await assert.rejects(db.exec(`begin;${migration.up}\n-- on a changed function\n;commit;`),/queue_chat_push is not the expected definition/);
await db.exec('rollback').catch(()=>{});
assert.equal((await state()).table,null,'nothing was left behind');
await db.exec(migration.down+'\n-- thrice');await db.exec(migration.up+'\n-- and back');
assert.deepEqual(await state(),applied);

// 2. The table.
for(const role of ['anon','authenticated']){
 for(const privilege of ['select','insert','update','delete'])assert.equal((await one(`select has_table_privilege($1,'public.chat_stage_broadcasts',$2) ok`,[role,privilege])).ok,false,`${role} ${privilege}`);
 for(const fn of ['chat_stage_notice_rewrite(uuid,text)','chat_stage_broadcast_open(uuid,text,text,timestamptz,text)','chat_stage_broadcast_close(uuid,text,timestamptz)','chat_stage_broadcast_reopen(uuid,text)','chat_stage_broadcast_recording(uuid,text,text,text,text,boolean)','chat_stage_broadcast_notify(uuid,uuid,integer)'])
  assert.equal((await one(`select has_function_privilege($1,$2,'execute') ok`,[role,`public.${fn}`])).ok,false,`${role} ${fn}`);
}
assert.equal((await one(`select relrowsecurity r from pg_class where oid='public.chat_stage_broadcasts'::regclass`)).r,true);
assert.equal((await one(`select count(*)::int n from pg_policies where tablename='chat_stage_broadcasts'`)).n,0,'no policies: service role only');
assert.equal((await one(`select has_table_privilege('service_role','public.chat_stage_broadcasts','delete') ok`)).ok,false);

const n1=id(1),n2=id(2),n3=id(3);
assert.deepEqual(await open(n1,'main','LB',`now()-interval '2 hours'`),{posted:true,closed:0});
assert.deepEqual(await open(n1,'main','LB'),{posted:false},'the same id again posts nothing');
assert.deepEqual([(await message(n1)).body,(await message(n1)).bot_slug,(await message(n1)).author_label],[LIVE('LB'),'longboard','Longboard Bot']);
assert.equal((await one('select count(*)::int n from longboard_chat_messages where id=$1',[n1])).n,1);
assert.equal((await row(n1)).ended_at,null);
// One open broadcast per room: the database itself refuses a second.
await assert.rejects(db.query(`insert into chat_stage_broadcasts(notice_id,room_slug,started_at,last_live_at) values($1,'main',now(),now())`,[n2]),/chat_stage_broadcasts_open/);
// Last seen live: only forward in time (the app's own write).
await db.query(`update chat_stage_broadcasts set last_live_at=now()-interval '90 minutes' where notice_id=$1`,[n1]);
const seenAt=(await row(n1)).last_live_at;
// A new broadcast while the old one's end was never seen: the stale one is marked ended (as of when
// it was last seen live), its message says so, its bells go; the new one is announced.
await notify(n1);assert((await bells(n1)).length>0);
assert.deepEqual(await open(n2,'main','LB'),{posted:true,closed:1});
assert.equal((await message(n1)).body,ENDED('LB'));
assert.equal((await message(n1)).revision,1);
assert.deepEqual(await bells(n1),[],'the stale notice’s alerts are taken back');
assert.equal(+(await row(n1)).ended_at,+seenAt);
assert.equal((await row(n2)).ended_at,null);
assert.equal((await one(`select count(*)::int n from chat_stage_broadcasts where room_slug='main' and ended_at is null`)).n,1);
// Close: once.
assert.equal(await close(n2,'LB'),true);assert.equal(await close(n2,'LB'),false);
assert.equal((await message(n2)).body,ENDED('LB'));
// Never before it started, never in the future.
assert.equal(await close(n1,'LB'),false);
// Reopen (back shortly after): the same message says live again; then it ends again.
assert.equal((await one('select chat_stage_broadcast_reopen($1,$2) r',[n2,LIVE('LB')])).r,true);
assert.equal((await one('select chat_stage_broadcast_reopen($1,$2) r',[n2,LIVE('LB')])).r,false);
assert.equal((await message(n2)).body,LIVE('LB'));assert.equal((await row(n2)).ended_at,null);
assert.equal(await close(n2,'LB',`now()+interval '1 hour'`),true);
assert((await row(n2)).ended_at<=new Date(Date.now()+5000),'an end time in the future is now');
// Another room is its own: both can be open.
assert.equal((await open(n3,'social','Social')).posted,true);
assert.equal((await open(id(4),'shortscout','SS')).posted,true);
assert.equal(await close(n3,'Social'),true);assert.equal(await close(id(4),'SS'),true);
// An id taken by something else is refused, and nothing is written.
const other=(await one(`select post_chat_longboard_announcement($1,'social','Not a notice') r`,[id(5)])).r;assert.equal(other.posted,true);
await assert.rejects(open(id(5),'main','LB'),/announcement_id_taken/);
assert.equal(await row(id(5)),undefined);

// 3. Booker Stock Club.
const c1=id(10);
assert.deepEqual(await open(c1,'club','Booker Stock Club'),{posted:true,closed:0});
assert.equal((await message(c1)).room_slug,'club');
// Refused, as before: a direct edit of the notice; the setting alone on another bot post; a card.
await assert.rejects(db.query(`update longboard_chat_messages set body='changed' where id=$1`,[c1]),/club_read_only/,'no direct edit');
const announcement=(await one(`select post_chat_longboard_announcement($1,'club','An ordinary announcement') r`,[id(11)])).r;assert.equal(announcement.posted,true);
await assert.rejects(db.exec(`begin;select set_config('chat.stage_notice','${id(11)}',true);update longboard_chat_messages set body='changed' where id='${id(11)}';commit;`),/club_read_only/,'the bot’s other posts never change');
await db.exec('rollback').catch(()=>{});
await db.query('select chat_stage_notice_rewrite($1,$2)',[id(11),'changed']).then(()=>assert.fail('an ordinary announcement cannot be rewritten'),e=>assert.match(e.message,/club_read_only/));
const card=(await one(`select post_chat_club_pick('2026-11-25','ZZZZ','auto','#1 stock of the day: ZZZZ','{"ticker":"ZZZZ"}'::jsonb) r`)).r;assert.equal(card.posted,true);
await assert.rejects(db.query('select chat_stage_notice_rewrite($1,$2)',[card.messageId,'changed']).then(()=>one('select body from longboard_chat_messages where id=$1',[card.messageId])).then(r=>{if(r.body!=='changed')throw Error('club_read_only (left alone)');}),/club_read_only/,'a stock-pick card never changes');
assert.equal((await message(card.messageId)).body,'#1 stock of the day: ZZZZ');
// The setting names the notice, but anything other than its words is refused.
for(const change of [`author_label='Someone'`,`room_slug='social'`,`bot_slug='club'`,`deleted_at=now()`,`reply_to_id='${n1}'`,`created_at=now()-interval '1 day'`,`member_id='${aliceMember}'`,`guest_id='${aliceMember}',bot_slug=null`]){
 await assert.rejects(db.exec(`begin;select set_config('chat.stage_notice','${c1}',true);update longboard_chat_messages set body='x',${change} where id='${c1}';commit;`),/club_read_only|actor_check|violates|read_only|forbidden/,change);
 await db.exec('rollback').catch(()=>{});
}
assert.equal((await message(c1)).body,LIVE('Booker Stock Club'),'untouched by all of that');
// The setting does not outlive its transaction.
assert.equal((await one(`select coalesce(current_setting('chat.stage_notice',true),'') v`)).v,'');
// People: unchanged. A member cannot post, an admin can; nobody moves a row in.
await db.query(`update longboard_chat_messages set created_at=created_at-interval '1 hour' where created_at>now()-interval '1 hour' and guest_id is not null`);
await assert.rejects(one(`select send_chat_room_message($1,'club','member post',null,'{}'::uuid[],$2) r`,[bob,crypto.randomUUID()]),/club_read_only/);
assert.equal((await one(`select send_chat_room_message($1,'club','Welcome to the webinar',null,'{}'::uuid[],$2) r`,[alice,crypto.randomUUID()])).r.status,'sent');
await assert.rejects(db.query(`update longboard_chat_messages set room_slug='club' where id=$1`,[n3]),/club_read_only/,'nothing moves into the club');
// Nobody replies under the notice.
await assert.rejects(db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,'club','Alice','reply',$2)`,[aliceMember,c1]),/club_read_only/);

// 4. Bell entries. Everyone who can read the club: Alice, Bob, Mallory (and the SS tester).
await db.query(`insert into chat_push_subscriptions(account_id,endpoint,p256dh,auth) values($1,'https://push.example.test/bob','p','a'),($2,'https://push.example.test/mallory','p','a')`,[bob,mallory]);
// Mallory blocked Alice (the admin), and Alice blocked Bob: a room notice ignores personal blocks.
await db.query('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2),($2,$3)',[malloryMember,aliceMember,bobMember]);
const everyone=(await all(`select m.user_id from longboard_chat_members m where chat_account_room_recipient_eligible(m.user_id,'club') order by m.id`)).map(r=>r.user_id);
assert(everyone.includes(alice)&&everyone.includes(bob)&&everyone.includes(mallory),'the fixture people can read the club');
// One member at a time: the place is remembered, and each call covers the next slice.
const members=(await one('select count(*)::int n from longboard_chat_members')).n;
let calls=0,done=false,added=0;
while(!done){const r=await notify(c1,alice,1);calls++;done=r.done;added+=r.added;assert(calls<=members+2,'it finishes');}
assert.equal(calls,members+1,'one slice per member, then one that finds the end');
assert.deepEqual(await bells(c1),everyone.filter(a=>a!==alice).sort(),'everyone but the admin named, blocks or not');
assert.equal(added,everyone.length-1);
assert.notEqual((await row(c1)).notified_at,null);
// Again: nothing.
assert.deepEqual(await notify(c1,null,500),{done:true,added:0});
assert.equal((await bells(c1)).length,everyone.length-1,'Alice is not added by a later run: it is finished');
// 5. Phones: the club notice's bells queued a push for each device; a reply alert in the club does not.
const pushed=async notice=>(await all(`select s.account_id from chat_push_jobs j join chat_room_mentions n on n.id=j.source_id join chat_push_subscriptions s on s.id=j.subscription_id where j.kind='room' and n.message_id=$1 order by 1`,[notice])).map(r=>r.account_id);
assert.deepEqual(await pushed(c1),[bob,mallory].sort());
const adminPost=(await one(`select id from longboard_chat_messages where room_slug='club' and guest_id=$1 order by created_at desc limit 1`,[aliceMember])).id;
await db.query(`insert into chat_room_mentions(account_id,message_id,room_slug,category) values($1,$2,'club','reply')`,[bob,adminPost]);
assert.deepEqual(await pushed(adminPost),[],'a reply alert in the club still sends no push');
// The push opens the club's notice (the app turns that address into the stage link).
assert.equal((await one(`select chat_push_target('room',n.id,n.account_id) u from chat_room_mentions n where n.message_id=$1 and n.account_id=$2`,[c1,bob])).u,`/chat?room=club&thread=${c1}`);

// Cut off part way, then finished by a later call; Muted and Mentions only; a bot.
assert.equal(await close(c1,'Booker Stock Club'),true);
assert.equal((await message(c1)).body,ENDED('Booker Stock Club'),'the club notice is rewritten when it ends');
assert.deepEqual(await bells(c1),[],'and its alerts are taken back');
// A push not yet sent has lost its bell entry (prepare_chat_push_job then finds nothing and drops it, unsent).
assert.equal((await one(`select count(*)::int n from chat_push_jobs j where j.kind='room' and exists(select 1 from chat_room_mentions n where n.id=j.source_id and n.message_id=$1)`,[c1])).n,0);
const c2=id(12);
await db.query(`insert into chat_room_notification_levels(account_id,room_slug,level) values($1,'club','muted') on conflict(account_id,room_slug) do update set level=excluded.level`,[bob]);
assert.equal((await open(c2,'club','Booker Stock Club')).posted,true);
assert.deepEqual(await notify(c2,null,2),{done:false,added:(await bells(c2)).length});
const part=await bells(c2);assert(part.length<=2);
assert.equal((await row(c2)).notified_at,null,'unfinished: the message is there and the bells are not all written');
assert.notEqual((await row(c2)).notify_cursor,null);
for(let i=0;i<members;i++)if((await notify(c2,null,2)).done)break;
assert.deepEqual(await bells(c2),everyone.filter(a=>a!==bob).sort(),'finished from where it stopped; the muted member is left out');
assert.notEqual((await row(c2)).notified_at,null);
await close(c2,'Booker Stock Club');
const c3=id(13);
await db.query(`update chat_room_notification_levels set level='mentions' where account_id=$1 and room_slug='club'`,[bob]);
await db.query(`insert into chat_bot_accounts(account_id,allowed_rooms) values($1,'{club}')`,[mallory]);
assert.equal((await open(c3,'club','Booker Stock Club')).posted,true);
assert.equal((await notify(c3,null,500)).done,true);
assert.deepEqual(await bells(c3),everyone.filter(a=>a!==bob&&a!==mallory).sort(),'not "Mentions only", not a bot account');
// Another room's setting does not count.
await db.query(`update chat_room_notification_levels set room_slug='social' where account_id=$1 and room_slug='club'`,[bob]);
await db.query('delete from chat_bot_accounts where account_id=$1',[mallory]);
// Over: a late call writes nothing.
await close(c3,'Booker Stock Club');
await db.query('update chat_stage_broadcasts set notified_at=null,notify_cursor=null where notice_id=$1',[c3]);
assert.deepEqual(await notify(c3,null,500),{done:true,added:0});assert.deepEqual(await bells(c3),[]);
await assert.rejects(notify(c3,null,0),/invalid_stage_notice/);await assert.rejects(notify(c3,null,5000),/invalid_stage_notice/);
assert.deepEqual(await notify(id(99),null,10),{done:true,added:0},'no such notice');

// 6. The recording.
const record=async(notice,room,name,url,source,onlyIfEmpty)=>(await one('select chat_stage_broadcast_recording($1,$2,$3,$4,$5,$6) r',[notice,room,url,url?RECORDED(name,url):ENDED(name),source,onlyIfEmpty])).r;
// A post's link: only when nobody has set one. The first wins.
assert.equal(await record(n2,'main','LB',YT,'post',true),true);
assert.equal((await message(n2)).body,RECORDED('LB',YT));
assert.equal(await record(n2,'main','LB',LOOM,'post',true),false,'the first link wins');
assert.equal((await message(n2)).body,RECORDED('LB',YT));
// An admin replaces it, then removes it; a later post does not put one back.
assert.equal(await record(n2,'main','LB',LOOM,'admin',false),true);assert.equal((await message(n2)).body,RECORDED('LB',LOOM));
assert.equal(await record(n2,'main','LB',null,'admin',false),true);assert.equal((await message(n2)).body,ENDED('LB'));
assert.deepEqual([(await row(n2)).recording_url,(await row(n2)).recording_source],[null,'admin']);
assert.equal(await record(n2,'main','LB',YT,'post',true),false,'an admin’s choice stands');
// In the club too (it has no recordings room: an admin adds it).
assert.equal(await record(c1,'club','Booker Stock Club',YT,'admin',false),true);
assert.equal((await message(c1)).body,RECORDED('Booker Stock Club',YT));
// Never on a live notice, in the wrong room, on another message, or with a bad source.
const c4=id(14);await open(c4,'club','Booker Stock Club');
assert.equal(await record(c4,'club','Booker Stock Club',YT,'admin',false),false,'not while it is live');
assert.equal((await message(c4)).body,LIVE('Booker Stock Club'));
assert.equal(await record(c1,'main','LB',LOOM,'admin',false),false,'the room must be the notice’s own');
assert.equal(await record(id(11),'club','Booker Stock Club',YT,'admin',false),false,'an ordinary announcement is not a notice');
assert.equal((await message(id(11))).body,'An ordinary announcement');
assert.equal(await record(adminPost,'club','Booker Stock Club',YT,'admin',false),false);
await assert.rejects(record(c1,'club','Booker Stock Club',YT,'member',false),/invalid_stage_notice/);
await assert.rejects(db.query(`update chat_stage_broadcasts set recording_url='x' where notice_id=$1`,[c1]),/check/);
await close(c4,'Booker Stock Club');
// No bell and no push when a recording is attached.
assert.deepEqual(await bells(c1),[]);
// A notice from before this table (no row, the old words): an admin can still add its recording.
const old=id(20);
await db.query(`select post_chat_longboard_announcement($1,'main','The live video in LB has ended.')`,[old]);
assert.equal(await row(old),undefined);
assert.equal(await record(old,'main','LB',YT,'admin',false),true);
assert.equal((await message(old)).body,RECORDED('LB',YT));assert.notEqual((await row(old)).ended_at,null);
// And one that was live when the app changed is taken over by the next look, live as it reads.
const during=id(21);
await db.query(`select post_chat_longboard_announcement($1,'developers',$2)`,[during,LIVE('Developers')]);
assert.deepEqual(await open(during,'developers','Developers'),{posted:false,closed:0});
assert.equal((await row(during)).ended_at,null);assert.notEqual((await row(during)).notified_at,null);
assert.equal(await close(during,'Developers'),true);assert.equal((await message(during)).body,ENDED('Developers'));

// The rollback with rows in place: the table goes, the messages stay as they read; it re-applies.
await db.exec(migration.down+'\n-- with rows');
assert.equal((await state()).table,null);
assert.equal((await message(c1)).body,RECORDED('Booker Stock Club',YT));
await assert.rejects(db.query(`update longboard_chat_messages set body='x' where id=$1`,[c1]),/club_read_only/);
await db.exec(migration.up+'\n-- once more');
assert.deepEqual(await state(),applied);
console.log('chat-stage-broadcasts-database: ok');
process.exit(0);
