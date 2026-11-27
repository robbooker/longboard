// #537 database check: the Webinars room, its every-room live notice and its recordings room
// (20261127130000_chat_webinars_room.sql). Runs on the full migration chain from the mobile
// fixture. Synthetic data only.
//  1. the migration rolls back (every changed function, check and the policy exactly as they were)
//     and re-applies; a changed function stops it before anything is made; every existing room's
//     access answers are the same with and without it;
//  2. who can open Webinars: a Longboard member, a ShortScout member of any paid tier, a Booker
//     Stock Club buyer ('club-room' or 'gainers'), an admin; not an unknown account, a buyer whose
//     access was taken back, or a bot account that does not list the room; the same people as the club;
//  3. chat is open: a club-only buyer, a Longboard member and a ShortScout member post, reply,
//     react, edit and delete their own; an ordinary post writes no bell entry and no phone push; an
//     @name and a reply do, and reach phones unless the member muted the room; search finds a post;
//  4. Booker Stock Club is unchanged: a member cannot post, reply or edit there, with a webinar
//     live in Webinars and in the club itself;
//  5. the every-room notice: one silent copy per room asked for, once; no bell entry or phone push
//     for a copy (not even in the announcement and recording rooms, where every other post writes
//     one per member); Gainers and a paused room go without and the rest are posted; the room's
//     own notice writes each member one bell and one push; the end, a return and the recording
//     link reach every copy; the club's copy changes only through the notice's functions; a
//     broadcast in another room has no copies; an unread count rises by one per copy and not again
//     when its words change;
//  6. the recordings room (Recordings > Booker Stock Club): the same people as Webinars; admins
//     post, members read and react and cannot post, edit or reply; a new recording writes each
//     member a bell entry and no phone push; it gets the silent copy of the live notice too;
//  7. the rollback with rows: the room and everything in it goes; copies already posted stay.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`\nexport {db,people};`;
const target=new URL(`.chat-webinars-room-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const all=async(sql,args=[])=>(await db.query(sql,args)).rows;
let checks=0;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const rejects=async(p,re,m)=>{await assert.rejects(p,re,m);checks++;};
const NAME='20261127130000_chat_webinars_room';
const up=await readFile(`${root}supabase/migrations/${NAME}.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/${NAME}.down.sql`,'utf8');
const [alice,bob,mallory]=people.map(p=>p.id);
const memberOf=async who=>(await one('select id from longboard_chat_members where user_id=$1',[who])).id;
const scout=(await one(`select m.user_id account from longboard_chat_members m where m.display_name='Scout Tester'`)).account;
const ROOMS=['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','lb-review','runner-watch','club','ai-insights','admins'];
const FUNCTIONS=['enforce_chat_announcement_writer','change_chat_message','record_chat_room_mentions','chat_activity_counts','chat_activity_inbox','chat_account_has_room','chat_account_room_recipient_eligible','chat_account_rooms','longboard_chat_room_member_count','longboard_chat_room_member_names','longboard_chat_room_members','longboard_chat_room_members_ordered','queue_chat_push','search_longboard_chat','search_longboard_chat_semantic','queue_longboard_chat_embedding','claim_longboard_chat_embeddings','enforce_chat_club_post','notify_chat_announcement','chat_stage_notice_rewrite'];
const CHECKS=['longboard_chat_room_slug_check','chat_room_reads_room_slug_check','chat_favorites_room_slug_check','chat_conversation_pins_room_slug_check','chat_room_notification_levels_room_slug_check','chat_login_requests_return_room_check','chat_attachments_room_slug_check','chat_room_mentions_room_slug_check','chat_room_summary_cache_room_slug_check','chat_summary_deliveries_room_slug_check'];
const has=async(account,room)=>(await one('select public.chat_account_has_room($1,$2) ok',[account,room])).ok;
const eligible=async(account,room)=>(await one('select public.chat_account_room_recipient_eligible($1,$2) ok',[account,room])).ok;
const listed=async(account,rooms)=>(await one('select public.chat_account_rooms($1,$2::text[]) r',[account,rooms])).r;
const both=async(account,room)=>[await has(account,room),await eligible(account,room),(await listed(account,[room])).includes(room)];
const state=async()=>({
 functions:Object.fromEntries((await all(`select p.proname,pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1) order by 1`,[[...FUNCTIONS,'chat_stage_broadcast_copy_post']])).map(r=>[r.proname,r.d])),
 checks:Object.fromEntries((await all(`select conname,pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace and conname=any($1) order by 1`,[CHECKS])).map(r=>[r.conname,r.d])),
 policy:(await one(`select qual from pg_policies where schemaname='public' and tablename='longboard_chat_messages' and policyname='members read chat messages'`)).qual,
 table:(await one(`select to_regclass('public.chat_stage_broadcast_copies')::text t`)).t,
 room:(await one(`select count(*)::int n from longboard_chat_room_state where (room_slug='webinars' and id=16) or (room_slug='club-recordings' and id=17)`)).n,
});
// Every existing room's answers for the fixture's people (the admin, a member, an SS member).
const access=async()=>{const out={};for(const who of [alice,bob,mallory,scout])for(const room of ROOMS)out[`${who}:${room}`]=await both(who,room);
 for(const who of [alice,bob,scout])out[`${who}:list`]=await listed(who,ROOMS);return out;};

// 1. The migration rolls back and re-applies.
const applied=await state(),accessWith=await access();
eq(applied.table,'chat_stage_broadcast_copies');eq(applied.room,2,'room 16 is Webinars, 17 the recordings room');
eq(Object.keys(applied.functions).length,FUNCTIONS.length+1);
for(const name of CHECKS)ok(applied.checks[name].includes("'webinars'::text"),`${name} accepts the room`);
for(const name of FUNCTIONS.slice(5,17))ok(applied.functions[name].includes("'webinars'"),`${name} knows the room`);
for(const name of [...FUNCTIONS.slice(0,12),'notify_chat_announcement'])ok(applied.functions[name].includes("'club-recordings'"),`${name} knows the recordings room`);
ok(!applied.functions.queue_chat_push.includes('club-recordings'),'a recordings room sends nothing to phones');
for(const name of CHECKS)eq(applied.checks[name].includes("'club-recordings'::text"),!name.includes('summary'),`${name}: the recordings room`);
ok(!/webinars|club-recordings/.test((await one(`select pg_get_functiondef('public.chat_agent_rooms'::regproc) d`)).d),'agents are not offered either room');
await db.exec(down);
const before=await state();
eq(before.table,null);eq(before.room,0);eq(before.functions.chat_stage_broadcast_copy_post,undefined);
for(const name of CHECKS)ok(!/webinars|club-recordings/.test(before.checks[name]),`${name} as before`);
for(const name of FUNCTIONS)ok(!/webinars|club-recordings|#537|chat_stage_broadcast_copies|chat\.stage_copy/.test(before.functions[name]),`${name} as before`);
ok(!/webinars|club-recordings/.test(before.policy),'the policy as before');
eq(await has(bob,'webinars'),false,'without the migration there is no such room');
eq(await access(),accessWith,'every existing room answers the same with and without the migration');
// The migration's own check accepts what the rollback left: exactly the definitions it was written against.
await db.exec(up+'\n-- again');
eq(await state(),applied,'re-applies cleanly');
// A function that is not the expected one stops the migration before anything is made.
await db.exec(down+'\n-- twice');
const pushBefore=(await state()).functions.queue_chat_push;
await db.exec(`create or replace function public.queue_chat_push() returns trigger language plpgsql set search_path to '' as $f$ begin return new; end $f$`);
await rejects(db.exec(`begin;${up}\n-- on a changed function\n;commit;`),/queue_chat_push is not the expected definition/);
await db.exec('rollback').catch(()=>{});
eq([(await state()).table,(await state()).room],[null,0],'nothing was left behind');
await db.exec(pushBefore);
await db.exec(up+'\n-- and back');
eq(await state(),applied);
// Service role only.
for(const role of ['anon','authenticated']){
 eq((await one(`select has_table_privilege($1,'public.chat_stage_broadcast_copies','select') s,has_function_privilege($1,'public.chat_stage_broadcast_copy_post(uuid,text[],uuid[],text)','execute') f`,[role])),{s:false,f:false},`${role} has no way in`);
}
eq((await one(`select relrowsecurity r from pg_class where oid='public.chat_stage_broadcast_copies'::regclass`)).r,true,'row security is on');

// 2. Who can open Webinars.
const account=async()=>{const id=crypto.randomUUID();await db.query('insert into chat_accounts(id) values($1)',[id]);return id;};
const buyer=async(email,keys)=>{const id=await account();
 const person=(await one(`insert into member_people(email,chat_account_id) values($1,$2) returning id`,[email,id])).id;
 for(const key of keys)await db.query(`insert into member_entitlements(person_id,entitlement_key,granted_by) values($1,$2,'admin')`,[person,key]);
 return {account:id,person};};
const tier=async level=>{const id=await account();await db.query(`insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$1,$2)`,[id,level]);return id;};
const clubOnly=await buyer('club-only@example.test',['club-room']);
const gainersBuyer=await buyer('gainers-buyer@example.test',['gainers']);
const readerOnly=await buyer('reader-only@example.test',['reader']);
const monthly=await tier('monthly'),annual=await tier('annual'),lifetime=await tier('lifetime'),lapsed=await account();
const YES=[true,true,true],NO=[false,false,false];
const bots=[];
for(const ROOM of ['webinars','club-recordings']){
eq(await both(bob,ROOM),YES,'a Longboard member');
eq(await both(alice,ROOM),YES,'an admin');
eq(await both(scout,ROOM),YES,'a ShortScout mastermind member');
for(const [who,name] of [[monthly,'monthly'],[annual,'annual'],[lifetime,'lifetime']])eq(await both(who,ROOM),YES,`a ShortScout ${name} member`);
eq(await both(clubOnly.account,ROOM),YES,'a Booker Stock Club buyer (club-room)');
eq(await both(gainersBuyer.account,ROOM),YES,'a Booker Stock Club buyer (the Gainers rule)');
eq(await both(readerOnly.account,ROOM),NO,'another purchase alone does not open it');
eq(await both(lapsed,ROOM),NO,'a chat account with no membership at all');
eq(await both(crypto.randomUUID(),ROOM),NO,'an unknown account');
eq(await both(null,ROOM),NO,'nobody (signed out)');
// Exactly the club's people.
for(const who of [alice,bob,mallory,scout,monthly,annual,lifetime,lapsed,clubOnly.account,gainersBuyer.account,readerOnly.account])
 eq(await both(who,ROOM),await both(who,'club'),'the same answer as Booker Stock Club');
// A buyer whose access was taken back loses it.
const gone=await buyer(`gone-${ROOM}@example.test`,['club-room']);
eq(await both(gone.account,ROOM),YES);
await db.query(`update member_entitlements set revoked_at=now(),revoked_by='admin' where person_id=$1`,[gone.person]);
eq(await both(gone.account,ROOM),NO,'taken back');
// A bot account has only the rooms its own list names (the existing rule); none lists Webinars.
const bot=await account();bots.push(bot);
await db.query('insert into auth.users values($1)',[bot]);await db.query(`insert into profiles values($1,$2,'user')`,[bot,`bot-${ROOM}@bot.longboard.invalid`]);
eq(await both(bot,ROOM),YES,'(a plain profile would have it)');
await db.query(`insert into chat_bot_accounts(account_id,allowed_rooms) values($1,'{developers,social}')`,[bot]);
eq(await both(bot,ROOM),NO,'a bot account that does not list the room');
eq(await both(bot,'social'),[true,true,true],'(it keeps its own rooms)');
}
const bot=bots[0];
// The members list and count accept the room.
ok((await one(`select longboard_chat_room_member_count($1,'webinars') n`,[bob])).n>=3,'the member count');
ok((await all(`select * from longboard_chat_room_members($1,'webinars')`,[bob])).length>=3,'the member list');
ok((await all(`select * from longboard_chat_room_members_ordered($1,'webinars')`,[bob])).length>=3,'the ordered member list');
await rejects(db.query(`select longboard_chat_room_member_count($1,'webinars')`,[readerOnly.account]),/room_access_required/);

// 3. Chat is open.
const link=async(who,name)=>(await one('select longboard_chat_link_member($1,$2,null) m',[who,name])).m.id;
const clubMember=await link(clubOnly.account,'Club Only Buyer'),monthlyMember=await link(monthly,'Monthly Scout');
const bobMember=await memberOf(bob),malloryMember=await memberOf(mallory);
// The send rate limit (1.5 seconds, 30 in 10 minutes) is not what this checks: move earlier posts back.
const send=async(who,room,body,reply=null)=>{
 await db.query(`update longboard_chat_messages set created_at=created_at-interval '1 hour' where guest_id=(select id from longboard_chat_members where user_id=$1) and created_at>now()-interval '1 hour'`,[who]);
 return (await one(`select send_chat_room_message($1,$2,$3,$4,'{}'::uuid[],$5) r`,[who,room,body,reply,crypto.randomUUID()])).r;};
const change=(who,id,room,action,body=null,expected=null)=>one(`select change_chat_message($1,$2,$3,$4,$5,$6,false,null) r`,[who,id,room,action,body,expected]).then(x=>x.r);
const react=(who,room,id)=>one(`select set_chat_message_reaction($1,$2,null,$3,'like',true) r`,[who,room,id]).then(x=>x.r);
const bellsOf=async id=>(await all('select account_id,category from chat_room_mentions where message_id=$1 order by account_id',[id]));
const pushedOf=async id=>(await all(`select s.account_id from chat_push_jobs j join chat_room_mentions n on n.id=j.source_id join chat_push_subscriptions s on s.id=j.subscription_id where j.kind='room' and n.message_id=$1 order by 1`,[id])).map(r=>r.account_id);
await db.query(`insert into chat_push_subscriptions(account_id,endpoint,p256dh,auth) values($1,'https://push.example.test/bob','p','a'),($2,'https://push.example.test/club','p','a'),($3,'https://push.example.test/mallory','p','a')`,[bob,clubOnly.account,mallory]);
const posts={};
for(const [who,member,name] of [[clubOnly.account,clubMember,'a club-only buyer'],[bob,bobMember,'a Longboard member'],[monthly,monthlyMember,'a ShortScout member']]){
 const sent=await send(who,'webinars',`Hello from ${name}`);
 eq(sent.status,'sent',`${name} posts: ${JSON.stringify(sent).slice(0,200)}`);
 eq([sent.message.room_slug,sent.message.member_id,sent.message.guest_id,sent.message.bot_slug],['webinars',member,member,null],`${name}'s post is their own`);
 ok(sent.message.author_label.length>0,'under their chat name');
 posts[who]={...sent.message,memberships:sent.memberships??sent.message.memberships};
 // An ordinary post: no bell entry for anyone, so nothing for a phone.
 eq(await bellsOf(sent.message.id),[],`${name}'s ordinary post writes no bell entry`);
}
eq((await one(`select count(*)::int n from chat_push_jobs j join chat_room_mentions n on n.id=j.source_id where j.kind='room' and n.room_slug='webinars'`)).n,0,'no phone is told about ordinary posts');
eq(posts[clubOnly.account].author_label,'Club Only Buyer','the buyer posts under the name they chose');
// Reply, react, edit, delete: each of the three.
for(const [who,name] of [[clubOnly.account,'a club-only buyer'],[bob,'a Longboard member'],[monthly,'a ShortScout member']]){
 const other=who===bob?posts[clubOnly.account]:posts[bob];
 const reply=await send(who,'webinars',`A reply from ${name}`,other.id);
 eq(reply.status,'sent',`${name} replies`);eq(reply.message.reply_to_id,other.id);
 const liked=await react(who,'webinars',other.id);
 ok(liked&&!liked.error,`${name} reacts: ${JSON.stringify(liked).slice(0,160)}`);
 eq((await one('select count(*)::int n from longboard_chat_reactions r join longboard_chat_members m on m.id=r.guest_id where r.message_id=$1 and m.user_id=$2 and r.active',[other.id,who])).n,1,`${name}'s reaction is kept`);
 const mine=posts[who];
 const edited=await change(who,mine.id,'webinars','edit',`${mine.body} (edited)`,mine.body);
 eq(edited.body,`${mine.body} (edited)`,`${name} edits their own post`);
 await rejects(change(who,other.id,'webinars','edit','not mine',other.body),/./,`${name} cannot edit someone else's post`);
 const extra=await send(who,'webinars',`Delete me, ${name}`);
 await change(who,extra.message.id,'webinars','delete');
 ok((await one('select deleted_at from longboard_chat_messages where id=$1',[extra.message.id])).deleted_at,`${name} deletes their own post`);
}
// A reply tells the person replied to (bell entry, and their phone); an @name does too.
const replyToBuyer=await send(bob,'webinars','Welcome!',posts[clubOnly.account].id);
eq((await bellsOf(replyToBuyer.message.id)).filter(r=>r.account_id===clubOnly.account).map(r=>r.category),['reply'],'a reply writes the bell entry');
eq(await pushedOf(replyToBuyer.message.id),[clubOnly.account],'and reaches their phone');
const mention=await send(clubOnly.account,'webinars','@Bob thanks for the welcome');
eq((await bellsOf(mention.message.id)).map(r=>[r.account_id,r.category]),[[bob,'mention']],'an @name writes the bell entry');
eq(await pushedOf(mention.message.id),[bob],'and reaches their phone');
// Muted: the bell entry is written, the phone is left alone.
await db.query(`insert into chat_room_notification_levels(account_id,room_slug,level) values($1,'webinars','muted')`,[bob]);
const muted=await send(clubOnly.account,'webinars','@Bob one more');
eq(await pushedOf(muted.message.id),[],'a muted room sends nothing to the phone');
await db.query(`delete from chat_room_notification_levels where account_id=$1 and room_slug='webinars'`,[bob]);
// A buyer has no LB or SS badge, and the send does not need one.
eq(posts[clubOnly.account].memberships??[],[],'a club-only buyer carries no LB or SS badge');
// Someone with no chat name has nothing to post under. (Who may open or post in a room is the
// server's check before this function is called: lib/chatAccess.ts, lib/__tests__/chatWebinarsRoom.test.ts.)
eq((await send(readerOnly.account,'webinars','let me in')).status,'member_required');
// Search and embeddings, as in Social.
ok((await all(`select id from search_longboard_chat('welcome','webinars')`)).some(r=>r.id===replyToBuyer.message.id),'search finds a Webinars post');
eq((await one('select count(*)::int n from longboard_chat_embeddings where message_id=$1',[replyToBuyer.message.id])).n,1,'and it is queued for the meaning search');
// A favorite, a read marker and a notification level take the slug.
await db.query(`insert into chat_room_reads(account_id,room_slug,through_seq) values($1,'webinars',1) on conflict(account_id,room_slug) do update set through_seq=1`,[bob]);checks++;

// 4. Booker Stock Club is unchanged for members, with a webinar live or not.
const id=n=>`5${String(n).padStart(7,'0')}-3700-4000-8000-000000000000`;
const LIVE=(name,room)=>`🔴 ${name} is live now. Watch live: https://chat.example.test/chat?room=${room}&stage=1`;
const ENDED=name=>`The live video in ${name} has ended. The recording will follow.`;
const YT='https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const RECORDED=name=>`The live video in ${name} has ended. Watch the recording: ${YT}`;
const open=async(notice,room,name)=>(await one(`select chat_stage_broadcast_open($1,$2,$3,now(),$4) r`,[notice,room,LIVE(name,room),ENDED(name)])).r;
const close=async(notice,name)=>(await one(`select chat_stage_broadcast_close($1,$2,now()) r`,[notice,ENDED(name)])).r;
const message=mid=>one('select * from longboard_chat_messages where id=$1',[mid]);
const clubRefuses=async when=>{
 for(const [who,name] of [[bob,'a Longboard member'],[clubOnly.account,'a club-only buyer'],[monthly,'a ShortScout member']])
  await rejects(send(who,'club',`Can I post? (${when})`),/club_read_only/,`${name} cannot post in the club (${when})`);
};
await clubRefuses('nothing live');
const adminPost=await send(alice,'club','An admin post in the club');
eq(adminPost.status,'sent','an admin still posts in the club');
await rejects(send(bob,'club','a reply',adminPost.message.id),/club_read_only/,'a member cannot reply in the club');
const w1=id(1);
eq(await open(w1,'webinars','Webinars'),{posted:true,closed:0},'a webinar goes live in Webinars');
await clubRefuses('a webinar live in Webinars');
const c1=id(2);
eq((await open(c1,'club','Booker Stock Club')).posted,true,'and one in the club itself');
await clubRefuses('a webinar live in the club');
await rejects(send(bob,'club','a reply while live',adminPost.message.id),/club_read_only/,'nor reply there while it is live');
await rejects(db.query(`update longboard_chat_messages set body='changed' where id=$1`,[c1]),/club_read_only/,'the club notice still cannot be edited directly');
eq(await close(c1,'Booker Stock Club'),true);
const card=(await one(`select post_chat_club_pick('2026-11-27','ZZZZ','auto','#1 stock of the day: ZZZZ','{"ticker":"ZZZZ"}'::jsonb) r`)).r;
eq(card.posted,true,'the stock-pick card still posts');

// 5. The every-room notice.
const COPY_ROOMS=[...ROOMS,'club-recordings'].filter(room=>room!=='admins'&&room!=='gainers');
ROOMS.push('club-recordings'); // (after the access checks above: from here on it is a room like the rest)
const copyId=room=>id(100+ROOMS.indexOf(room));
const copy=async(notice,rooms,body,ids=rooms.map(copyId))=>(await one('select chat_stage_broadcast_copy_post($1,$2::text[],$3::uuid[],$4) r',[notice,rooms,ids,body])).r.rooms;
const copies=async notice=>(await all('select c.room_slug,c.message_id,m.body,m.bot_slug,m.author_label,m.guest_id,m.member_id,m.revision from chat_stage_broadcast_copies c join longboard_chat_messages m on m.id=c.message_id where c.notice_id=$1 order by c.room_slug',[notice]));
const pause=room=>db.query(`update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$2 where room_slug=$1`,[room,alice]);
const resume=room=>db.query(`update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null,pause_reason=null where room_slug=$1`,[room]);
const unread=async(who,room)=>(await one('select chat_room_unread($1,$2::text[]) r',[who,[room]])).r.roomMessageCounts[room];
const mentionsBefore=(await one('select count(*)::int n from chat_room_mentions')).n,jobsBefore=(await one('select count(*)::int n from chat_push_jobs')).n;
const unreadBefore={social:await unread(bob,'social'),club:await unread(bob,'club'),'lb-announcements':await unread(alice,'lb-announcements')};
// Developers is paused: it goes without, the rest are posted. Gainers refuses anything but its own alerts.
await pause('developers');
const posted=await copy(w1,[...COPY_ROOMS,'gainers','webinars'],LIVE('Webinars','webinars'),[...COPY_ROOMS.map(copyId),id(198),id(199)]);
eq([...posted].sort(),COPY_ROOMS.filter(room=>room!=='developers').sort(),'one copy per room asked for; a paused room, Gainers and Webinars itself go without');
await resume('developers');
eq(await message(id(198)),undefined,'nothing was posted in Gainers');eq(await message(id(199)),undefined,'nor a second notice in Webinars');
let rows=await copies(w1);
eq(rows.length,COPY_ROOMS.length-1);
for(const row of rows){
 eq([row.body,row.bot_slug,row.author_label,row.guest_id,row.member_id,row.revision],[LIVE('Webinars','webinars'),'longboard','Longboard Bot',null,null,0],`${row.room_slug}: a Longboard Bot post with the notice's words`);
 eq(row.message_id,copyId(row.room_slug),'under the id asked for');
 eq((await message(row.message_id)).room_slug,row.room_slug);
}
// Silent: not one bell entry and not one phone job, in any room (the announcement and recording
// rooms included, where every other post writes a bell entry for each member).
eq((await one('select count(*)::int n from chat_room_mentions')).n,mentionsBefore,'no bell entry for any copy');
eq((await one('select count(*)::int n from chat_push_jobs')).n,jobsBefore,'no phone push for any copy');
eq((await one('select count(*)::int n from chat_room_mentions where message_id=any($1)',[rows.map(r=>r.message_id)])).n,0);
// (That trigger is otherwise as it was: an ordinary bot announcement there still tells the room.)
const ordinary=(await one(`select post_chat_longboard_announcement($1,'lb-announcements','An ordinary announcement') r`,[id(50)])).r;
eq(ordinary.posted,true);ok((await bellsOf(id(50))).length>0,'an ordinary post in LB Announcements still writes bell entries');
// And the setting alone does not silence another post.
await db.exec(`begin;select set_config('chat.stage_copy','${id(51)}',true);select post_chat_longboard_announcement('${id(52)}','lb-announcements','Another ordinary announcement');commit;`);
ok((await bellsOf(id(52))).length>0,'the setting names one message; any other still tells the room');
// Unread counts: a copy counts as one unread post in its room, like any bot post.
eq(await unread(bob,'social'),unreadBefore.social+1,'Social: one more unread');
eq(await unread(bob,'club'),unreadBefore.club+1,'the club: one more unread');
// Asked again (another server, a retry): nothing new. The paused room, open again, gets its copy.
eq(await copy(w1,COPY_ROOMS,LIVE('Webinars','webinars')),['developers'],'a second call posts only what is missing');
eq(await copy(w1,COPY_ROOMS,LIVE('Webinars','webinars')),[],'and a third posts nothing');
eq((await copies(w1)).length,COPY_ROOMS.length);
eq((await one(`select count(*)::int n from longboard_chat_messages where bot_slug='longboard' and body=$1`,[LIVE('Webinars','webinars')])).n,COPY_ROOMS.length+1,'the notice and one copy per room, no more');
// The room's own notice tells each member once: one bell entry, one phone push. Nothing from a copy.
const told=(await one('select chat_stage_broadcast_notify($1,$2,500) r',[w1,alice])).r;
eq(told.done,true);
const bells=(await bellsOf(w1)).map(r=>r.account_id);
for(const who of [bob,mallory,scout,monthly,clubOnly.account])ok(bells.includes(who),'a member of the room has the bell entry');
ok(!bells.includes(alice),'the admin who went live is not told');ok(!bells.includes(bot),'a bot account is not told');
ok(!bells.includes(readerOnly.account),'someone who cannot open the room is not told');
eq(await pushedOf(w1),[bob,clubOnly.account,mallory].sort(),'each subscribed member gets one phone push, from the room notice');
eq((await one('select count(*)::int n from chat_room_mentions where account_id=$1 and message_id=any($2)',[bob,[w1,...rows.map(r=>r.message_id)]])).n,1,'one bell entry in total for a member');
eq((await one('select chat_stage_broadcast_notify($1,$2,500) r',[w1,alice])).r.added,0,'telling again adds nothing');
// The club's copy: a bot post there never changes by hand, and members still cannot post.
const clubCopy=copyId('club');
await rejects(db.query(`update longboard_chat_messages set body='changed' where id=$1`,[clubCopy]),/club_read_only/,'the club copy cannot be edited directly');
await rejects(db.exec(`begin;select set_config('chat.stage_notice','${clubCopy}',true);update longboard_chat_messages set author_label='Someone' where id='${clubCopy}';commit;`),/club_read_only/,'nothing but its words may change');
await db.exec('rollback').catch(()=>{});
await rejects(db.exec(`begin;select set_config('chat.stage_notice','${card.messageId}',true);update longboard_chat_messages set body='changed' where id='${card.messageId}';commit;`),/club_read_only/,'a stock-pick card still never changes');
await db.exec('rollback').catch(()=>{});
await rejects(send(bob,'club','a reply to the notice',clubCopy),/club_read_only/,'no replies under the notice in the club');
await clubRefuses('the notice is in the club');
// The end reaches every copy; nothing is told again; unread does not rise again.
const unreadLive={social:await unread(bob,'social'),club:await unread(bob,'club')};
eq(await close(w1,'Webinars'),true);
eq((await message(w1)).body,ENDED('Webinars'));
rows=await copies(w1);
for(const row of rows)eq([row.body,row.revision],[ENDED('Webinars'),1],`${row.room_slug}: the copy says it ended`);
eq(await bellsOf(w1),[],'the notice’s alerts are taken back');
eq([await unread(bob,'social'),await unread(bob,'club')],[unreadLive.social,unreadLive.club],'changing a copy’s words adds no unread');
eq(await copy(w1,COPY_ROOMS,LIVE('Webinars','webinars')),[],'no copy is posted for a broadcast that is over');
// Back shortly after: the same messages say live again; nobody is notified; no new copy.
eq((await one('select chat_stage_broadcast_reopen($1,$2) r',[w1,LIVE('Webinars','webinars')])).r,true);
rows=await copies(w1);
for(const row of rows)eq([row.body,row.revision],[LIVE('Webinars','webinars'),2],`${row.room_slug}: the copy says live again`);
eq(rows.length,COPY_ROOMS.length);eq(await bellsOf(w1),[]);
eq(await close(w1,'Webinars'),true);
// The recording link, added in Webinars by an admin, reaches every copy; and can be removed.
eq((await one(`select chat_stage_broadcast_recording($1,'webinars',$2,$3,'admin',false) r`,[w1,YT,RECORDED('Webinars')])).r,true);
eq((await message(w1)).body,RECORDED('Webinars'));
for(const row of await copies(w1))eq(row.body,RECORDED('Webinars'),`${row.room_slug}: the copy links the recording`);
eq((await one(`select chat_stage_broadcast_recording($1,'webinars',null,$2,'admin',false) r`,[w1,ENDED('Webinars')])).r,true);
for(const row of await copies(w1))eq(row.body,ENDED('Webinars'));
// A copy is not a notice of its own room: its recording cannot be set there.
eq((await one(`select chat_stage_broadcast_recording($1,'social',$2,$3,'admin',false) r`,[copyId('social'),YT,RECORDED('Webinars')])).r,false,'a copy has no recording of its own');
eq((await message(copyId('social'))).body,ENDED('Webinars'));
// A copy in a room that is paused when the words change is left as it reads; the rest still change.
const w2=id(3);
await db.query(`update chat_stage_broadcasts set created_at=now()-interval '2 hours' where notice_id=$1`,[w1]);
eq((await open(w2,'webinars','Webinars')).posted,true,'a later webinar');
const ids2=COPY_ROOMS.map(room=>id(200+ROOMS.indexOf(room)));
eq((await copy(w2,COPY_ROOMS,LIVE('Webinars','webinars'),ids2)).length,COPY_ROOMS.length,'its own copies, under their own ids');
for(const row of await copies(w1))eq(row.body,ENDED('Webinars'),'the earlier webinar’s copies still say ended');
await pause('lb-review');
eq(await close(w2,'Webinars'),true,'the end is recorded even with a copy’s room paused');
await resume('lb-review');
for(const row of await copies(w2))eq(row.body,row.room_slug==='lb-review'?LIVE('Webinars','webinars'):ENDED('Webinars'),`${row.room_slug}`);
// A missed end: the next webinar's start marks the stale notice and its copies ended.
const w3=id(4),w4=id(5);
await db.query(`update chat_stage_broadcasts set created_at=now()-interval '2 hours' where notice_id=$1`,[w2]);
eq((await open(w3,'webinars','Webinars')).posted,true);
await copy(w3,['social','club'],LIVE('Webinars','webinars'),[id(301),id(302)]);
await db.query(`update chat_stage_broadcasts set created_at=now()-interval '2 hours',last_live_at=now()-interval '2 hours' where notice_id=$1`,[w3]);
eq(await open(w4,'webinars','Webinars'),{posted:true,closed:1});
eq((await copies(w3)).map(r=>r.body),[ENDED('Webinars'),ENDED('Webinars')],'the stale webinar’s copies say ended');
eq(await close(w4,'Webinars'),true);
// A broadcast in another room has no copies, and its functions behave as they did.
const m1=id(6);
eq((await open(m1,'main','LB')).posted,true);
eq(await copies(m1),[],'no copies for another room’s broadcast');
eq(await close(m1,'LB'),true);eq((await message(m1)).body,ENDED('LB'));
eq((await one(`select count(*)::int n from longboard_chat_messages where body like '%LB is live now%' or body=$1`,[ENDED('LB')])).n,1,'LB’s notice is in LB alone');
// Bad calls.
await rejects(copy(w4,[],LIVE('Webinars','webinars'),[]),/invalid_stage_notice/);
await rejects(copy(w4,['social'],LIVE('Webinars','webinars'),[]),/invalid_stage_notice/);
eq(await copy(id(999),['social'],LIVE('Webinars','webinars'),[id(998)]),[],'an unknown broadcast posts nothing');

// 6. The recordings room.
const R='club-recordings';
const recording=await send(alice,R,`Webinar recording: ${YT}`);
eq(recording.status,'sent','an admin posts a recording');
const told6=(await bellsOf(recording.message.id)).map(r=>r.account_id);
for(const who of [bob,scout,monthly,clubOnly.account])ok(told6.includes(who),'a new recording writes each member a bell entry');
ok(!told6.includes(readerOnly.account),'not someone who cannot open the room');
eq(await pushedOf(recording.message.id),[],'and no phone push, as in LB and SS Recordings');
for(const [who,name] of [[bob,'a Longboard member'],[clubOnly.account,'a club-only buyer'],[monthly,'a ShortScout member']]){
 await rejects(send(who,R,`Can I post? ${name}`),/announcement_admin_only/,`${name} cannot post in the recordings room`);
 await rejects(send(who,R,'a reply',recording.message.id),/announcement_admin_only/,`${name} cannot reply there`);
 await rejects(change(who,recording.message.id,R,'edit','mine now',recording.message.body),/message_forbidden/,`${name} cannot edit a recording`);
 const liked=await react(who,R,recording.message.id);
 ok(liked&&!liked.error,`${name} reacts to a recording`);
}
const fixed=await change(alice,recording.message.id,R,'edit',`Webinar recording (fixed): ${YT}`,recording.message.body);
eq(fixed.body,`Webinar recording (fixed): ${YT}`,'an admin edits a recording');
// An @name in a recordings room sends nothing to a phone either.
const named=await send(alice,R,'@Bob the recording is up');
eq(await pushedOf(named.message.id),[],'no phone push for an @name there');
// It received the silent copy of each webinar's notice.
ok((await copies(w1)).some(r=>r.room_slug===R),'the recordings room has the live notice’s copy');
eq((await bellsOf(copyId(R))).length,0,'and that copy wrote no bell entry');
// "Mentions only" quiets the room's bell count, as for the other recordings rooms.
const bellCount=async who=>(await one('select chat_activity_counts($1,$2::text[]) r',[who,[R]])).r.roomCounts?.[R]??0;
ok(await bellCount(bob)>0,'the recordings’ bell entries count');
await db.query(`insert into chat_room_notification_levels(account_id,room_slug,level) values($1,$2,'mentions')`,[bob,R]);
eq(await bellCount(bob),0,'"Mentions only" quiets them');
await db.query(`delete from chat_room_notification_levels where account_id=$1 and room_slug=$2`,[bob,R]);

// 7. The rollback with rows: the room goes with everything in it; copies already posted stay.
const socialCopies=(await one(`select count(*)::int n from longboard_chat_messages where room_slug='social' and bot_slug='longboard' and body=$1`,[ENDED('Webinars')])).n;
ok(socialCopies>=2);
await db.exec(down+'\n-- with rows');
eq((await one(`select count(*)::int n from longboard_chat_messages where room_slug in ('webinars','club-recordings')`)).n,0,'the rooms’ messages are gone');
eq((await one(`select count(*)::int n from chat_room_mentions where room_slug='webinars'`)).n,0);
eq((await one(`select count(*)::int n from longboard_chat_room_state where room_slug in ('webinars','club-recordings')`)).n,0);
eq((await one(`select count(*)::int n from chat_stage_broadcasts where room_slug='webinars'`)).n,0);
eq((await one(`select count(*)::int n from longboard_chat_messages where room_slug='social' and bot_slug='longboard' and body=$1`,[ENDED('Webinars')])).n,socialCopies,'copies already posted stay as they read');
eq((await state()).functions,before.functions,'every function is back exactly as it was');
eq((await state()).checks,before.checks);eq((await state()).policy,before.policy);
await rejects(send(bob,'club','after the rollback'),/club_read_only/,'the club refuses members as ever');
await db.exec(up+'\n-- once more');
eq(await state(),applied,'and the migration applies again');
console.log(`chat-webinars-room-database: ${checks} checks passed`);
process.exit(0);
