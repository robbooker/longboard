// #322 Developers room database check on the full migration chain from the mobile fixture
// (synthetic data only): every chat member is in the room with no joining step (Longboard with and
// without Boardroom, ShortScout mastermind, a paid ShortScout member, a brand-new account), anyone
// unknown is not; members post, reply, react, tag, attach and pin; tags and replies reach the bell
// and push, muting stops only that person's alerts; unread counts, search, /summary storage; admins
// moderate; other rooms keep their rules; the rollback removes it all and re-applies cleanly.
// Usage: node scripts/tests/chat-developers-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people,scoutId};`;
const target=new URL(`.chat-developers-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people,scoutId;try{({db,people,scoutId}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const all=async(sql,args=[])=>(await db.query(sql,args)).rows;
const [alice,bob,mallory]=people;
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};

// 1. Every chat member is in the room without joining: admin (Alice), Boardroom (Bob), Longboard
// without Boardroom (Mallory), ShortScout mastermind, a paid ShortScout member, a brand-new account.
const ssMember='00000000-0000-4000-8000-0000000000d2';
await db.query('insert into chat_accounts(id) values($1)',[ssMember]);
await db.query("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$1,'monthly')",[ssMember]);
const ssMemberMember=(await one("select longboard_chat_link_member($1,'Monthly Scout',null) m",[ssMember])).m;
const scoutMember=(await one('select id from longboard_chat_members where user_id=$1',[scoutId]));
const fresh='00000000-0000-4000-8000-0000000000d1';
await db.query('insert into auth.users values($1)',[fresh]);await db.query("insert into profiles values($1,'dev-fresh@example.test','user')",[fresh]);
const freshMember=(await one("select longboard_chat_link_member($1,'Fresh Builder',null) m",[fresh])).m;
const everyone=[alice.id,bob.id,mallory.id,scoutId,ssMember,fresh];
for(const account of everyone){
 ok((await one("select chat_account_has_room($1,'developers') v",[account])).v,`room access for ${account}`);
 ok((await one("select chat_account_room_recipient_eligible($1,'developers') v",[account])).v,`taggable ${account}`);
 // Exactly Social's rule.
 eq((await one("select chat_account_has_room($1,'developers')=chat_account_has_room($1,'social') v",[account])).v,true);
}
const stranger='00000000-0000-4000-8000-0000000000ee';
ok(!(await one("select chat_account_has_room($1,'developers') v",[stranger])).v,'an unknown account (a guest) is not in the room');
ok(!(await one("select chat_account_room_recipient_eligible($1,'developers') v",[stranger])).v);
eq((await one("select id,room_slug,is_open from longboard_chat_room_state where room_slug='developers'")),{id:10,room_slug:'developers',is_open:true});
ok(Number((await one("select longboard_chat_room_member_count($1,'developers') n",[bob.id])).n)>=6,'member list counts every chat member');
ok((await all("select id from longboard_chat_room_members($1,'developers',null,'')",[mallory.id])).some(r=>r.id===freshMember.id),'the new account is listed');
ok((await all("select id from longboard_chat_room_members_ordered($1,'developers','')",[ssMember])).some(r=>r.id===bob.member.id),'ordered list works for a paid SS member');
eq((await all("select id from longboard_chat_room_member_names($1,'developers',$2)",[fresh,[bob.member.id]])).map(r=>r.id),[bob.member.id]);
await assert.rejects(db.query("select longboard_chat_room_member_count($1,'developers')",[stranger]),/room_access_required/);checks++;

// 2. Every tier posts; replies, tags, reactions, attachments and pins work like Social.
const post=(member,name,body,reply=null,attachments=[])=>one("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id,attachment_ids) values($1,$1,'developers',$2,$3,$4,$5) returning id,created_at",[member.id,name,body,reply,attachments]);
const root1=(await post(bob.member,'Bob','Built a dashboard on the chat API, @Mallory Outsider have a look')).id;
for(const [member,name] of [[mallory.member,'Mallory Outsider'],[scoutMember,'Scout Tester'],[ssMemberMember,'Monthly Scout'],[freshMember,'Fresh Builder'],[alice.member,'Alice']])
 await post(member,name,`Hello from ${name}`);
checks+=6;
const reply=(await post(mallory.member,'Mallory Outsider','Nice one @Bob',root1)).id;checks++;
eq((await one('select reply_to_id from longboard_chat_messages where id=$1',[reply])).reply_to_id,root1,'replies are on');
for(const member of [mallory.member,scoutMember,ssMemberMember])await db.query('insert into longboard_chat_reactions(message_id,guest_id,active) values($1,$2,true)',[root1,member.id]);
eq((await one('select count(*)::int n from longboard_chat_reactions where message_id=$1 and active',[root1])).n,3,'members react');
const upload=(member,room)=>one("insert into chat_attachments(member_id,room_slug,filename,mime_type,byte_size,upload_path,object_path,sha256,status) values($1,$2,'p.png','image/png',50,$3,$4,$5,'ready') returning id",[member.id,room,'quarantine/'+crypto.randomUUID(),'clean/'+crypto.randomUUID(),'a'.repeat(64)]);
await upload(mallory.member,'developers');await upload(ssMemberMember,'developers');checks+=2;
// Room pins are admin-only in every room (as in Social); members pin conversations for themselves.
await assert.rejects(one('select set_chat_room_message_pin($1,$2,$3,true) v',[bob.id,'developers',root1]),/admin_required/);checks++;
await one('select set_chat_room_message_pin($1,$2,$3,true) v',[alice.id,'developers',root1]);
eq((await one("select count(*)::int n from chat_room_message_pins where room_slug='developers' and message_id=$1",[root1])).n,1,'an admin pins a message');
await one("select chat_pins($1,'pin','developers',null) v",[ssMember]);
eq((await one("select count(*)::int n from chat_conversation_pins where account_id=$1 and room_slug='developers'",[ssMember])).n,1,'a member pins the room in the sidebar');

// 3. Tags and replies reach the bell; push jobs follow; muting stops only that person's alerts.
const mentions=async(account)=>(await all("select category from chat_room_mentions n join longboard_chat_messages m on m.id=n.message_id where n.account_id=$1 and n.room_slug='developers' order by n.seq",[account])).map(r=>r.category);
eq(await mentions(mallory.id),['mention'],'Mallory was tagged');
ok((await mentions(bob.id)).length>=1,'Bob was replied to and tagged');
ok((await one("select chat_activity_inbox($1,array['developers']) v",[bob.id])).v.mentionCount>=1,'it shows in the bell');
const sub=async(account)=>(await one("insert into chat_push_subscriptions(account_id,endpoint,p256dh,auth) values($1,$2,'p','a') returning id",[account,'https://fcm.googleapis.com/fcm/send/dev-'+account])).id;
const bobSub=await sub(bob.id),malSub=await sub(mallory.id);
const jobs=async(s)=>Number((await one("select count(*) n from chat_push_jobs where subscription_id=$1 and kind='room'",[s])).n);
await db.query("insert into chat_room_notification_levels(account_id,room_slug,level) values($1,'developers','muted')",[bob.id]);
const before={bob:await jobs(bobSub),mal:await jobs(malSub)};
await post(alice.member,'Alice','@Bob and @Mallory Outsider, welcome');
eq(await jobs(bobSub),before.bob,'muted: no push for Bob');
eq(await jobs(malSub),before.mal+1,'Mallory still gets a push');
const job=await one("select id,source_id from chat_push_jobs where subscription_id=$1 and kind='room' order by created_at desc limit 1",[malSub]).catch(()=>one("select source_id from chat_push_jobs where subscription_id=$1 and kind='room' limit 1",[malSub]));
ok((await one("select chat_push_target('room',$1,$2) t",[job.source_id,mallory.id])).t?.startsWith('/chat?room=developers&thread='),'the push opens the room thread');
// Muting Developers doesn't touch Bob's other rooms.
const social=(await one("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'social','Alice','@Bob over in Social') returning id",[alice.member.id])).id;
eq((await one("select count(*)::int n from chat_room_mentions where account_id=$1 and message_id=$2",[bob.id,social])).n,1,'Bob is still tagged in Social');
eq(await jobs(bobSub),before.bob+1,'and still gets the Social push');

// 4. Unread counts.
const unread=async(account)=>(await one("select chat_room_unread($1,array['developers']) v",[account])).v;
ok((await unread(fresh)).roomMessageCounts.developers>=7,'every post is unread for the new member');
const through=(await unread(fresh)).roomMessageThrough.developers;
await db.query("insert into chat_room_reads(account_id,room_slug,through_seq) values($1,'developers',$2)",[fresh,through]);
eq((await unread(fresh)).roomMessageCounts.developers,0,'read after opening');

// 5. Search (keywords) covers the room; queued for search by meaning; summary storage accepts it.
eq((await all("select id from search_longboard_chat('dashboard','developers')")).map(r=>r.id),[root1],'keyword search finds it');
eq((await all("select id from search_longboard_chat('dashboard','social')")).length,0,'and only in its own scope');
ok((await one('select count(*)::int n from longboard_chat_embeddings where message_id=$1',[root1])).n===1,'queued for search by meaning');
await db.query("insert into chat_summary_deliveries(account_id,client_id,room_slug,body) values($1,$2,'developers','DEVELOPERS summary')",[bob.id,crypto.randomUUID()]);checks++;

// 6. Members edit/delete their own posts only; admins moderate any.
const change=(actor,action,message,body=null,expected=null,admin=false)=>one("select change_chat_message($1,$2,'developers',$3,$4,$5,$6) r",[actor,message,action,body,expected,admin]);
await assert.rejects(change(mallory.id,'delete',root1),/message_forbidden/);checks++;
eq((await change(bob.id,'edit',root1,'Built a dashboard on the chat API (edited)','Built a dashboard on the chat API, @Mallory Outsider have a look')).r.body,'Built a dashboard on the chat API (edited)');
await change(alice.id,'delete',reply,null,null,true);
eq((await one('select count(*)::int n from longboard_chat_messages where id=$1',[reply])).n,0,'admin removed a reply');
await db.query("update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$1 where room_slug='developers'",[alice.id]);
await assert.rejects(post(bob.member,'Bob','while paused'),/paused/);checks++;
await db.query("update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug='developers'");

// 7. Other rooms are unchanged.
await assert.rejects(db.query("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'main','Mallory','x')",[mallory.member.id]),/chat_room_forbidden/);checks++;
await assert.rejects(db.query("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'whats-new','Bob','x')",[bob.member.id]),/announcement_admin_only/);checks++;
await assert.rejects(db.query("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'lb-announcements','Bob','x')",[bob.member.id]),/announcement_admin_only/);checks++;
ok(!(await one("select chat_account_has_room($1,'shortscout') v",[ssMember])).v,'a paid SS member still has no SS room');
ok(!(await one("select chat_account_has_room($1,'main') v",[mallory.id])).v,'Mallory still has no LB room');

// 8. Rollback removes the room completely; the migration then applies again.
const down=await readFile(root+'supabase/rollbacks/20261029150000_chat_developers_room.down.sql','utf8');
const up=await readFile(root+'supabase/migrations/20261029150000_chat_developers_room.sql','utf8');
await db.exec(down);
eq((await one("select count(*)::int n from longboard_chat_messages where room_slug='developers'")).n,0);
ok(!(await one("select chat_account_has_room($1,'developers') v",[bob.id])).v,'no access after rollback');
ok((await one("select chat_account_has_room($1,'social') v",[bob.id])).v,'Social untouched by the rollback');
await assert.rejects(db.query("insert into longboard_chat_room_state(id,room_slug) values(10,'developers')"),/check/);checks++;
// The fixture runs each distinct SQL text once; mark this as a second run.
await db.exec(up+'\n-- re-applied after rollback');
ok((await one("select chat_account_has_room($1,'developers') v",[ssMember])).v,'re-applied');
console.log(`PASS ${checks} Developers database assertions: every tier in, guests out, posts/replies/reactions/tags/files/pins, bell + push with per-person mute, unread, search, admin moderation, other rooms unchanged, rollback + re-apply.`);
process.exit(0);
