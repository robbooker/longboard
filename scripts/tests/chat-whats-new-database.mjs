// #302 What's New database check on the full migration chain from the mobile fixture (synthetic
// data only): everyone who can use chat is in the room (new accounts too), only admins post,
// members react, no replies, no alerts, unread counts, automatic notes are idempotent and can't
// be forged, admins edit and delete them, and the rollback removes it all and re-applies cleanly.
// Usage: node scripts/tests/chat-whats-new-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people,scoutId};`;
const target=new URL(`.chat-whats-new-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people,scoutId;try{({db,people,scoutId}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const all=async(sql,args=[])=>(await db.query(sql,args)).rows;
const [alice,bob,mallory]=people;const welcome='30200000-0000-4000-8000-000000000302';
const sha='b'.repeat(40);
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};

// 1. The welcome post is the room's first (and only) message, from Booker Chat Updates.
const rows=await all("select id,author_label,bot_slug,member_id,reply_to_id from longboard_chat_messages where room_slug='whats-new' order by created_at,id");
eq(rows,[{id:welcome,author_label:'Booker Chat Updates',bot_slug:'whats-new',member_id:null,reply_to_id:null}],'welcome is the first message');
ok((await one('select body from longboard_chat_messages where id=$1',[welcome])).body.startsWith("Welcome to What's New."));

// 2. Everyone who can use chat is in the room without joining: admin, Boardroom member, a
// Longboard account without Boardroom, a ShortScout-only account, and a brand-new account.
const fresh='00000000-0000-4000-8000-0000000000f1';
await db.query('insert into auth.users values($1)',[fresh]);await db.query("insert into profiles values($1,'fresh@example.test','user')",[fresh]);
const freshMember=(await one("select longboard_chat_link_member($1,'Fresh Face',null) m",[fresh])).m;
for(const account of [alice.id,bob.id,mallory.id,scoutId,fresh]){
 ok((await one("select chat_account_has_room($1,'whats-new') v",[account])).v,`room access for ${account}`);
 ok((await one("select chat_account_room_recipient_eligible($1,'whats-new') v",[account])).v);
}
ok(!(await one("select chat_account_has_room('00000000-0000-4000-8000-0000000000ee','whats-new') v")).v,'an unknown account is not in the room');
const count=(await one("select longboard_chat_room_member_count($1,'whats-new') n",[bob.id])).n;
ok(Number(count)>=5,'member list counts every chat member');
ok((await all("select id from longboard_chat_room_members($1,'whats-new',null,'')",[mallory.id])).some(r=>r.id===freshMember.id),'the new account is listed');

// 3. Only admins post; members can't post, reply or forge a bot note.
const post=(person,body,reply=null)=>one("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,'whats-new',$2,$3,$4) returning id",[person.member.id,person.name,body,reply]);
for(const person of [bob,mallory])await assert.rejects(post(person,'member post'),/announcement_admin_only/);
await assert.rejects(post({member:freshMember,name:'Fresh Face'},'new member post'),/announcement_admin_only/);
const hand=(await post(alice,'Admin note by hand @Bob')).id;checks++;
await assert.rejects(post(alice,'admin reply',hand),/whats_new_no_replies|whats_new_roots_only/);
await assert.rejects(post(bob,'member reply',hand),/announcement_admin_only|whats_new_no_replies/);
await assert.rejects(db.query("insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('whats-new','Booker Chat Updates','forged','whats-new')"),/whats_new_note_forbidden/);
await assert.rejects(db.query("insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('social','Booker Chat Updates','forged','whats-new')"),/whats_new_note_forbidden|actor_check/);
checks+=5;

// 4. No alerts: nothing in the bell (an @name in an admin note included), no push jobs.
eq((await one("select count(*)::int n from chat_room_mentions where message_id in (select id from longboard_chat_messages where room_slug='whats-new')")).n,0,'no mention or announcement rows');
for(const person of [bob,mallory])eq((await one("select chat_activity_inbox($1,array['whats-new']) v",[person.id])).v.mentionCount,0);

// 5. New posts are unread until read; the author's own post is not unread for them.
const unread=async(account)=>(await one("select chat_room_unread($1,array['whats-new']) v",[account])).v;
eq((await unread(bob.id)).roomMessageCounts['whats-new'],2,'welcome + admin note unread for a member');
eq((await unread(fresh)).roomMessageCounts['whats-new'],2,'and for the brand-new account');
eq((await unread(alice.id)).roomMessageCounts['whats-new'],1,'the admin has only the welcome unread');
const through=(await unread(bob.id)).roomMessageThrough['whats-new'];
await db.query("insert into chat_room_reads(account_id,room_slug,through_seq) values($1,'whats-new',$2)",[bob.id,through]);
eq((await unread(bob.id)).roomMessageCounts['whats-new'],0,'read after opening');

// 6. Members react.
for(const person of [bob,mallory,{member:freshMember}])await db.query("insert into longboard_chat_reactions(message_id,guest_id,active) values($1,$2,true)",[welcome,person.member.id]);
eq((await one('select count(*)::int n from longboard_chat_reactions where message_id=$1 and active',[welcome])).n,3);

// 7. Automatic notes: one per call, never twice for the same PR, and a rerun posts nothing.
const auto=(prs,body='Search is faster now.')=>one('select post_chat_whats_new_note($1,$2,$3) r',[sha,body,JSON.stringify(prs.map(pr=>({pr,note:`Note ${pr}`,mergedAt:'2026-10-23T12:00:00Z'})))]);
const first=(await auto([301,302],'New on Longboard:\n• One.\n• Two.')).r;ok(first.posted);
await assert.rejects(auto([302,303]),/whats_new_already_posted/);checks++;
eq((await one("select count(*)::int n from longboard_chat_messages where room_slug='whats-new' and bot_slug='whats-new'")).n,2,'welcome + one automatic note');
eq((await all('select pr_number from chat_whats_new_changes order by 1')).map(r=>r.pr_number),[301,302]);
const note=await one('select author_label,bot_slug,member_id,body from longboard_chat_messages where id=$1',[first.messageId]);
eq(note,{author_label:'Booker Chat Updates',bot_slug:'whats-new',member_id:null,body:'New on Longboard:\n• One.\n• Two.'});
eq((await unread(bob.id)).roomMessageCounts['whats-new'],1,'the new note is unread');
eq((await one("select count(*)::int n from chat_room_mentions where message_id=$1",[first.messageId])).n,0,'and alerts nobody');
for(const bad of [['abc','x',[{pr:1,note:'x'}]],[sha,'',[{pr:1,note:'x'}]],[sha,'x'.repeat(601),[{pr:1,note:'x'}]],[sha,'x',[]],[sha,'x',[{pr:'1',note:'x'}]]])
 await assert.rejects(db.query('select post_chat_whats_new_note($1,$2,$3)',[bad[0],bad[1],JSON.stringify(bad[2])]),/invalid_whats_new/);
checks+=5;
await db.query("update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$1 where room_slug='whats-new'",[alice.id]);
await assert.rejects(auto([304]),/longboard_chat_paused/);checks++;
eq((await one('select count(*)::int n from chat_whats_new_changes where pr_number=304')).n,0,'a failed post records nothing');
await db.query("update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug='whats-new'");
for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(auto([305]),/permission denied/);await assert.rejects(db.query('select * from chat_whats_new_changes'),/permission denied/);await db.exec('reset role');checks+=2;}

// 8. Admins edit and delete notes, automatic ones included; members can't.
const change=(actor,action,message,body=null,expected=null,admin=false)=>one("select change_chat_message($1,$2,'whats-new',$3,$4,$5,$6) r",[actor,message,action,body,expected,admin]);
await assert.rejects(change(bob.id,'edit',first.messageId,'x',note.body),/message_forbidden/);
await assert.rejects(change(bob.id,'delete',first.messageId,null,null,false),/message_forbidden/);
const edited=(await change(alice.id,'edit',first.messageId,'New on Longboard:\n• One, edited.',note.body,true)).r;
eq([edited.body,edited.bot_slug,edited.author_label],['New on Longboard:\n• One, edited.','whats-new','Booker Chat Updates'],'admin edited the automatic note');
await assert.rejects(change(alice.id,'edit',first.messageId,'again',note.body,false),/message_forbidden/,'only as admin');
const handEdit=(await change(alice.id,'edit',hand,'Admin note, edited',"Admin note by hand @Bob")).r;eq(handEdit.body,'Admin note, edited');
await change(alice.id,'delete',first.messageId,null,null,true);
eq((await one('select count(*)::int n from longboard_chat_messages where id=$1',[first.messageId])).n,0,'admin deleted the automatic note');
eq((await one('select count(*)::int n from chat_whats_new_changes where pr_number=301')).n,1,'and it is still recorded as announced');
checks+=3;

// The shared announcement guard also runs on chat_attachments (rows without bot_slug): uploads
// in other rooms and an admin's What's New upload still work; a member's What's New upload doesn't.
const upload=(person,room)=>one("insert into chat_attachments(member_id,room_slug,filename,mime_type,byte_size,upload_path,object_path,sha256,status) values($1,$2,'p.png','image/png',50,$3,$4,$5,'ready') returning id",[person.member.id,room,'quarantine/'+crypto.randomUUID(),'clean/'+crypto.randomUUID(),'a'.repeat(64)]);
await upload(bob,'main');await upload(alice,'whats-new');checks+=2;
await assert.rejects(upload(bob,'whats-new'),/announcement_admin_only/);checks++;

// 9. Other rooms are unchanged: a Boardroom member still posts in LB and replies there.
const lb=(await one("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'main','Bob','still works') returning id",[bob.member.id])).id;
await one("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,'main','Alice','reply',$2) returning id",[alice.member.id,lb]);checks++;
await assert.rejects(db.query("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'main','Mallory','x')",[mallory.member.id]),/chat_room_forbidden/);checks++;

// 10. Rollback removes the room completely; the migration then applies again.
const down=await readFile(root+'supabase/rollbacks/20261023200000_chat_whats_new_room.down.sql','utf8');
const up=await readFile(root+'supabase/migrations/20261023200000_chat_whats_new_room.sql','utf8');
await db.exec(down);
eq((await one("select count(*)::int n from longboard_chat_messages where room_slug='whats-new'")).n,0);
ok(!(await one("select chat_account_has_room($1,'whats-new') v",[bob.id])).v,'no access after rollback');
eq((await one("select to_regclass('public.chat_whats_new_changes') t")).t,null);
await assert.rejects(db.query("insert into longboard_chat_room_state(id,room_slug) values(9,'whats-new')"),/check/);checks++;
// The fixture runs each distinct SQL text once; mark this as a second run.
await db.exec(up+'\n-- re-applied after rollback');
eq((await all("select id from longboard_chat_messages where room_slug='whats-new'")).map(r=>r.id),[welcome],'re-applied with the welcome post');
console.log(`PASS ${checks} What's New database assertions: room for every tier and new accounts, admin-only posts, reactions, no replies/alerts, unread, idempotent unforgeable notes, admin edit/delete, rollback + re-apply.`);
