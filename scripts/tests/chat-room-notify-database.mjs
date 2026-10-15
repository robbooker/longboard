// ROOM-NOTIFY database check: room levels in the bell (chat_activity_inbox) and push (queue +
// delivery re-check), on the full migration chain from the mobile fixture. Synthetic data only.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
// Keep the database setup and every migration; drop the HTTP server.
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-room-notify-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const account=async p=>(await one('select id from chat_accounts where longboard_user_id=$1',[p.id])).id;
const [alice,bob]=[await account(people[0]),await account(people[1])];
const [aliceMember,bobMember]=[people[0].member.id,people[1].member.id];
const rooms=['main','social','lb-announcements','gainers','lb-recordings'];
const inbox=async who=>(await one('select chat_activity_inbox($1,$2) r',[who,rooms])).r;
const level=(who,room,l)=>l==='all'?db.query('delete from chat_room_notification_levels where account_id=$1 and room_slug=$2',[who,room]):db.query("insert into chat_room_notification_levels(account_id,room_slug,level) values($1,$2,$3) on conflict(account_id,room_slug) do update set level=excluded.level,updated_at=now()",[who,room,l]);
const post=(member,name,room,body)=>one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,$2,$3,$4) returning id",[member,name,body,room]);
// Start from a clean bell for Alice and Bob.
await db.query('update chat_room_mentions set read_at=now() where read_at is null');
await db.query('update chat_reaction_notifications set read_at=now() where read_at is null');

// 1. Default (no row) is "all": a SOCIAL mention lights the bell; roomLevels is reported (empty).
let a=await inbox(alice);assert.deepEqual(a.roomLevels,{});assert.equal(a.mentionCount,0);
await post(bobMember,'Bob','social','@Alice room notify check');
a=await inbox(alice);assert.equal(a.mentionCount,1);assert.equal(a.roomCounts.social,1);

// 2. Mentions only keeps a personal mention; muted removes it from the count, room counts and the list.
await level(alice,'social','mentions');a=await inbox(alice);
assert.deepEqual(a.roomLevels,{social:'mentions'});assert.equal(a.mentionCount,1);assert.equal(a.roomCounts.social,1);
await level(alice,'social','muted');a=await inbox(alice);
assert.deepEqual(a.roomLevels,{social:'muted'});assert.equal(a.mentionCount,0);assert.equal(a.roomCounts.social,undefined);
assert.ok(!a.mentions.some(m=>m.room==='social'),'muted room is not listed in the bell');
// Another room is unaffected.
await post(bobMember,'Bob','main','@Alice LB still rings');a=await inbox(alice);assert.equal(a.mentionCount,1);assert.equal(a.roomCounts.main,1);
await level(alice,'social','all');a=await inbox(alice);assert.equal(a.mentionCount,2);assert.deepEqual(a.roomLevels,{});
await db.query('update chat_room_mentions set read_at=now() where read_at is null');

// 3. Announcements post to everyone; mentions-only and muted both keep them out of Bob's bell.
await post(aliceMember,'Alice','lb-announcements','Room notify announcement');
let b=await inbox(bob);assert.equal(b.roomCounts['lb-announcements'],1);
await level(bob,'lb-announcements','mentions');b=await inbox(bob);assert.equal(b.roomCounts['lb-announcements'],undefined);assert.equal(b.mentionCount,0);
await level(bob,'lb-announcements','muted');b=await inbox(bob);assert.equal(b.mentionCount,0);
await level(bob,'lb-announcements','all');b=await inbox(bob);assert.equal(b.mentionCount,1);
await db.query('update chat_room_mentions set read_at=now() where read_at is null');

// 4. Reactions on your own message: counted on "all", not on mentions-only or muted.
const mine=await post(aliceMember,'Alice','main','React to me');
await db.query("insert into longboard_chat_reactions(message_id,guest_id,active) values($1,$2,true)",[mine.id,bobMember]);
a=await inbox(alice);const reactions=a.reactionCount;assert.ok(reactions>=1,'reaction notification recorded');
await level(alice,'main','mentions');a=await inbox(alice);assert.equal(a.reactionCount,reactions-1);assert.ok(!a.reactions.some(r=>r.messageId===mine.id));
await level(alice,'main','muted');a=await inbox(alice);assert.equal(a.reactionCount,reactions-1);
await level(alice,'main','all');a=await inbox(alice);assert.equal(a.reactionCount,reactions);

// 5. Push: muted rooms queue nothing, and a job queued before muting is dropped at delivery.
const sub=await one("insert into chat_push_subscriptions(account_id,endpoint,p256dh,auth) values($1,'https://fcm.googleapis.com/fcm/send/room-notify','p','a') returning id",[alice]);
const jobs=async()=>Number((await one("select count(*) n from chat_push_jobs where subscription_id=$1 and kind='room'",[sub.id])).n);
await post(bobMember,'Bob','social','@Alice push on all');assert.equal(await jobs(),1);
await level(alice,'social','mentions');await post(bobMember,'Bob','social','@Alice push on mentions-only');assert.equal(await jobs(),2);
await level(alice,'social','muted');await post(bobMember,'Bob','social','@Alice no push when muted');assert.equal(await jobs(),2,'muted room queues no push');
const queued=await one("select n.id from chat_push_jobs j join chat_room_mentions n on n.id=j.source_id where j.subscription_id=$1 order by n.seq desc limit 1",[sub.id]);
assert.equal((await one("select chat_push_target('room',$1,$2) t",[queued.id,alice])).t,null,'delivery re-check drops a muted room');
await level(alice,'social','mentions');assert.match((await one("select chat_push_target('room',$1,$2) t",[queued.id,alice])).t,/^\/chat\?room=social&thread=/);

// 6. Browser roles cannot read or write the table.
for(const role of ['anon','authenticated'])await assert.rejects(db.exec(`set role ${role};select * from public.chat_room_notification_levels;`),/permission denied/);
await db.exec('reset role');
await assert.rejects(db.query("insert into chat_room_notification_levels(account_id,room_slug,level) values($1,'main','loud')",[alice]),/check/);

// 7. Rough cost check against the pre-migration bell (same data): one primary-key read added.
const rollback=await readFile(`${root}/supabase/rollbacks/20261015180000_chat_room_notification_levels.down.sql`,'utf8');
const oldInbox=rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION public.chat_activity_inbox'),rollback.indexOf('$function$;')+11).replace('public.chat_activity_inbox(','public.fixture_old_chat_activity_inbox(');
await db.exec(oldInbox);
const time=async fn=>{for(let i=0;i<20;i++)await db.query(`select ${fn}($1,$2)`,[alice,rooms]);const t=performance.now();for(let i=0;i<200;i++)await db.query(`select ${fn}($1,$2)`,[alice,rooms]);return (performance.now()-t)/200;};
await level(alice,'social','all');await level(alice,'main','all');
const before=await time('fixture_old_chat_activity_inbox'),none=await time('chat_activity_inbox');
await level(alice,'social','muted');await level(alice,'lb-announcements','mentions');
const some=await time('chat_activity_inbox');
console.log(`bell call (PGlite, 200 runs): before ${before.toFixed(2)} ms; after, no levels ${none.toFixed(2)} ms; after, two levels ${some.toFixed(2)} ms`);
console.log('PASS room levels: default all, mentions-only keeps mentions, muted clears bell/list/room counts, announcements and reactions follow levels, no push queued or delivered for muted rooms, server-only table');
