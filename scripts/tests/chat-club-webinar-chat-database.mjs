// #535 database check: Booker Stock Club's chat during a webinar
// (20261127120000_chat_club_webinar_chat.sql). Runs on the full migration chain from the mobile
// fixture. Synthetic data only. The database does not judge "live" (the app's server does); what is
// checked here is that it refuses everything the server would not send, and accepts what it would.
//  1. the migration rolls back (the guard exactly as #524 left it, the two functions gone) and
//     re-applies; only the service role may call the two functions;
//  2. with the migration applied and the OLD app (the ordinary send and change functions): the club
//     is exactly as before: a member cannot post, reply or edit; an admin can;
//  3. a webinar (the two new functions): a member posts, replies under a person's post, edits and
//     deletes their own; never someone else's; never a reply under a stock-pick card; the ordinary
//     limits apply (1.5 seconds between posts, a paused room, a retry is the same send);
//  4. after it: what members said is still there; a member's edit is refused again;
//  5. never, even with the setting on: an agent, a bot post, a card changing, a row moving rooms;
//  6. alerts: a reply in the club writes its bell entry and queues no phone notification.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`\nexport {db,people};`;
const target=new URL(`.chat-club-webinar-chat-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const file=async path=>readFile(`${root}/supabase/${path}`,'utf8');
const migration={up:await file('migrations/20261127120000_chat_club_webinar_chat.sql'),down:await file('rollbacks/20261127120000_chat_club_webinar_chat.down.sql')};
const [alice,bob,mallory]=people.map(p=>p.id);
const memberOf=async who=>(await one('select id from longboard_chat_members where user_id=$1',[who])).id;
const [aliceMember,bobMember,malloryMember]=[await memberOf(alice),await memberOf(bob),await memberOf(mallory)];
await db.query(`update profiles set role='admin' where id=$1`,[alice]);
await db.query(`update profiles set role='user' where id=any($1)`,[[bob,mallory]]);
// The send limit is checked on purpose in step 3 only: elsewhere earlier posts are moved back.
const rested=who=>db.query(`update longboard_chat_messages set created_at=created_at-interval '1 hour' where guest_id=(select id from longboard_chat_members where user_id=$1) and created_at>now()-interval '1 hour'`,[who]);
const send=async(who,body,reply=null,files=[],client=crypto.randomUUID())=>(await rested(who),one(`select send_chat_room_message($1,'club',$2,$3,$4::uuid[],$5) r`,[who,body,reply,files,client]).then(x=>x.r));
const live=async(who,body,reply=null,files=[],client=crypto.randomUUID(),rest=true)=>(rest&&await rested(who),one(`select send_chat_club_live_message($1,$2,$3,$4::uuid[],$5) r`,[who,body,reply,files,client]).then(x=>x.r));
const change=(who,id,action,body=null,expected=null)=>one(`select change_chat_message($1,$2,'club',$3,$4,$5,false,null) r`,[who,id,action,body,expected]).then(x=>x.r);
const liveChange=(who,id,action,body=null,expected=null)=>one(`select change_chat_club_live_message($1,$2,$3,$4,$5,null) r`,[who,id,action,body,expected]).then(x=>x.r);
const row=id=>one('select * from longboard_chat_messages where id=$1',[id]);
const state=async()=>({
 guard:(await one(`select md5(pg_get_functiondef('public.enforce_chat_club_post'::regproc)) d`)).d,
 functions:(await db.query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like '%chat_club_live_message' order by 1`)).rows.map(r=>r.proname),
});

// 1. The migration rolls back and re-applies.
const applied=await state();
assert.deepEqual(applied.functions,['change_chat_club_live_message','send_chat_club_live_message']);
assert.match((await one(`select pg_get_functiondef('public.enforce_chat_club_post'::regproc) d`)).d,/#535/);
await db.exec(migration.down);
const before=await state();
assert.deepEqual(before,{guard:'08e55816ae48f031371524264fc8415d',functions:[]},'the guard exactly as #524 left it, and the two functions gone');
await db.exec(migration.up+'\n-- again');
assert.deepEqual(await state(),applied,'re-applies cleanly');
await assert.rejects(db.exec(migration.up+'\n-- a second time on top of itself'),/not the expected definition/,'never applied over a definition it was not written against');
for(const role of ['anon','authenticated'])for(const fn of ['send_chat_club_live_message(uuid,text,uuid,uuid[],uuid)','change_chat_club_live_message(uuid,uuid,text,text,text,integer)'])
 assert.equal((await one(`select has_function_privilege($1,$2,'execute') ok`,[role,`public.${fn}`])).ok,false,`${role} cannot call ${fn}`);
assert.equal((await one(`select has_function_privilege('service_role','public.send_chat_club_live_message(uuid,text,uuid,uuid[],uuid)','execute') ok`)).ok,true);
console.log('PASS 1 rolls back, re-applies, service role only');

// 2. The old app with the migration applied: exactly as before.
const hostPost=await send(alice,'Welcome to tonight\'s webinar.');
assert.equal(hostPost.status,'sent',JSON.stringify(hostPost));
const card=(await one(`select post_chat_club_pick('2026-11-27','ZZZZ','auto','#1 stock of the day: ZZZZ','{"ticker":"ZZZZ"}'::jsonb) r`)).r;
assert.equal(card.posted,true,'the stock-pick bot still posts');
await assert.rejects(send(bob,'member post'),/club_read_only/,'a member cannot post through the ordinary send');
await assert.rejects(send(bob,'member reply',hostPost.message.id),/club_read_only/,'nor reply');
await assert.rejects(db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'club','Bob','hi')`,[bobMember]),/club_read_only/,'nor insert a row');
console.log('PASS 2 without the webinar functions the club is as it was');

// 3. A webinar.
const said=await live(bob,'Hello from the webinar!');
assert.equal(said.status,'sent',JSON.stringify(said));
assert.deepEqual([said.message.room_slug,said.message.member_id,said.message.guest_id,said.message.bot_slug,said.message.agent_id??null],['club',bobMember,bobMember,null,null]);
// The setting was for that transaction only: the next plain send is refused again.
await assert.rejects(send(bob,'after that call'),/club_read_only/,'the setting does not outlive its transaction');
const reply=await live(mallory,'Great question.',said.message.id);
assert.equal(reply.status,'sent',JSON.stringify(reply));assert.equal(reply.message.reply_to_id,said.message.id);
const underHost=await live(bob,'Thanks for hosting.',hostPost.message.id);
assert.equal(underHost.status,'sent','a member replies under the admin\'s post too');
await assert.rejects(live(bob,'reply to a card',card.messageId),/club_read_only/,'never a reply under a stock-pick card');
// The ordinary limits: 1.5 seconds between posts; a retry of the same send is the same message.
assert.equal((await live(bob,'One more thing.')).status,'sent');
const quick=await live(bob,'too fast',null,[],crypto.randomUUID(),false);
assert.deepEqual([quick.status,quick.reason],['rate_limited','burst'],'the ordinary send limit applies');
const again=await one(`select send_chat_club_live_message($1,$2,null,'{}'::uuid[],$3) r`,[bob,'Hello from the webinar!',said.message.client_id]);
assert.deepEqual([again.r.status,again.r.message.id],['duplicate',said.message.id],'a retry is the same send');
// A paused room is paused for everyone.
await db.query(`update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$1 where room_slug='club'`,[alice]);
assert.equal((await live(bob,'while paused',null,[],crypto.randomUUID(),false)).status,'paused');
await db.query(`update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug='club'`);
// Their own post: edit and delete. Someone else's: never.
const edited=await liveChange(bob,said.message.id,'edit','Hello from the webinar! (edited)',said.message.body);
assert.equal(edited.body,'Hello from the webinar! (edited)');
await assert.rejects(liveChange(mallory,said.message.id,'edit','not mine',edited.body),/message_forbidden/,'a member cannot edit someone else\'s post');
await assert.rejects(liveChange(mallory,said.message.id,'delete'),/message_forbidden/,'nor delete it');
await assert.rejects(liveChange(bob,hostPost.message.id,'delete'),/message_forbidden/,'nor an admin\'s post');
await assert.rejects(liveChange(bob,card.messageId,'edit','my card','#1 stock of the day: ZZZZ'),/message_forbidden|club_read_only/,'never a stock-pick card');
await assert.rejects(liveChange(bob,card.messageId,'delete'),/message_forbidden/,'a card cannot be deleted by a member');
const gone=await liveChange(bob,underHost.message.id,'delete');
assert.equal(gone.deletedId,underHost.message.id,'a member deletes their own post during the webinar');
console.log('PASS 3 during a webinar members post, reply, edit and delete their own; the limits are the ordinary ones');

// 4. After it: what was said stays; a member's edit is refused again.
assert.equal((await row(said.message.id)).body,'Hello from the webinar! (edited)');
assert.equal((await row(reply.message.id)).body,'Great question.');
await assert.rejects(change(bob,said.message.id,'edit','later thoughts','Hello from the webinar! (edited)'),/club_read_only/,'no edits once the webinar functions are not used');
assert.equal((await row(said.message.id)).body,'Hello from the webinar! (edited)','and the post is unchanged');
// An admin still posts, and may remove a member's post (the app passes p_admin for a person's post only).
assert.equal((await send(alice,'Thanks everyone, the recording will follow.')).status,'sent');
const moderated=await one(`select change_chat_message($1,$2,'club','delete',null,null,true,null) r`,[alice,reply.message.id]);
assert.equal(moderated.r.deletedId,reply.message.id,'an admin removes a member\'s post');
assert.equal(await row(reply.message.id),undefined);
console.log('PASS 4 after the webinar the posts stay and members cannot change them');

// 5. Never, even with the setting on.
const inWebinar=async sql=>{await db.exec('begin');try{await db.query(`select set_config('chat.club_webinar','1',true)`);await sql();await db.exec('commit');}catch(e){await db.exec('rollback');throw e;}};
await db.query(`update chat_agent_settings set post_rooms=array_append(post_rooms,'club'),read_rooms=array_append(read_rooms,'club')`);
const agent=(await one(`insert into chat_agents(owner_id,name,post_rooms,read_rooms) values($1,'ClubBot','{club}','{club}') returning id`,[bob])).id;
await rested(bob);
await assert.rejects(inWebinar(()=>db.query(`select send_chat_agent_message($1,'club','agent post',null,'{}'::uuid[],$2)`,[agent,crypto.randomUUID()])),/club_read_only/,'an agent never posts, webinar or not');
await assert.rejects(inWebinar(()=>db.query(`insert into longboard_chat_messages(guest_id,member_id,agent_id,room_slug,author_label,body) values($1,$1,$2,'club','Bob','as an agent')`,[bobMember,agent])),/club_read_only|agent_send_required/);
await db.query('delete from chat_agents where id=$1',[agent]);
await db.query(`update chat_agent_settings set post_rooms=array_remove(post_rooms,'club'),read_rooms=array_remove(read_rooms,'club')`);
await assert.rejects(inWebinar(()=>db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$2,'club','Bob','as someone else')`,[bobMember,malloryMember])),/club_read_only|violates/,'only a member\'s own post');
await assert.rejects(inWebinar(()=>db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('club','Some Bot','hi','longboard')`)),/club_read_only|violates/,'no new kind of bot post');
await assert.rejects(inWebinar(()=>db.query(`update longboard_chat_messages set body='edited card' where id=$1`,[card.messageId])),/club_read_only/,'a card never changes');
await assert.rejects(inWebinar(()=>db.query(`update longboard_chat_messages set room_slug='social' where id=$1`,[said.message.id])),/club_read_only/,'nothing moves out of the club');
const social=(await one(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'social','Bob','in social') returning id`,[bobMember])).id;
await assert.rejects(inWebinar(()=>db.query(`update longboard_chat_messages set room_slug='club' where id=$1`,[social])),/club_read_only/,'nothing moves into the club');
await assert.rejects(inWebinar(()=>db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,'social','Bob','from social',$2)`,[bobMember,said.message.id])),/club_read_only/,'no replies from another room');
console.log('PASS 5 agents, bots, cards and moving rows are refused even during a webinar');

// 6. Alerts: a reply writes its bell entry in the club, and queues no phone notification.
await db.query(`insert into chat_push_subscriptions(account_id,endpoint,p256dh,auth) values($1,'https://fcm.googleapis.com/fcm/send/synthetic-bob-535','k','a')`,[bob]);
const pushes=async()=>(await one('select count(*)::int n from chat_push_jobs')).n,pushesBefore=await pushes();
const answer=await live(mallory,'Answering Bob.',said.message.id);
assert.equal(answer.status,'sent');
assert.equal((await one(`select count(*)::int n from chat_room_mentions where message_id=$1 and account_id=$2 and room_slug='club' and category='reply'`,[answer.message.id,bob])).n,1,'Bob is told about the reply in his bell');
assert.equal(await pushes(),pushesBefore,'and nothing is sent to his phone (club alerts stay out of phone push)');
console.log('PASS 6 a reply writes a bell entry and no phone notification');
console.log('chat-club-webinar-chat-database: ok');
process.exit(0);
