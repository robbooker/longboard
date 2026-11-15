// #457 database check: chat admins post in Booker Stock Club. Runs on the full migration chain from
// the mobile fixture. Synthetic data only.
//  - an admin's own post (text, a photo) is sent; edited and deleted by its author;
//  - another admin replies under it (the reply alert is recorded for the club); nobody replies
//    under a stock-pick card, or into the club from another room;
//  - a member can't post, and neither can an agent (even one run by an admin);
//  - the stock-pick bot still posts, its cards still never change;
//  - bookkeeping updates still work (a parent removed under a reply);
//  - the rollback removes the admins' posts and puts back the old guard and checks; the migration
//    re-applies cleanly.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`\nexport {db,people};`;
const target=new URL(`.chat-club-admin-posts-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const file=async path=>readFile(`${root}/supabase/${path}`,'utf8');
const migration={up:await file('migrations/20261115120000_chat_club_admin_posts.sql'),down:await file('rollbacks/20261115120000_chat_club_admin_posts.down.sql')};
const [alice,bob,mallory]=people.map(p=>p.id);
const memberOf=async who=>(await one('select id from longboard_chat_members where user_id=$1',[who])).id;
const [aliceMember,bobMember]=[await memberOf(alice),await memberOf(bob)];
await db.query(`update profiles set role='admin' where id=any($1)`,[[alice,mallory]]);
// The send rate limit (1.5 seconds, 30 in 10 minutes) is not what this checks: move earlier posts back.
const send=async(who,body,reply=null,files=[])=>(await db.query(`update longboard_chat_messages set created_at=created_at-interval '1 hour' where guest_id=(select id from longboard_chat_members where user_id=$1) and created_at>now()-interval '1 hour'`,[who]),one(`select send_chat_room_message($1,'club',$2,$3,$4::uuid[],$5) r`,[who,body,reply,files,crypto.randomUUID()]).then(x=>x.r));
const change=(who,id,action,body=null,expected=null)=>one(`select change_chat_message($1,$2,'club',$3,$4,$5,false,null) r`,[who,id,action,body,expected]).then(x=>x.r);
const state=async()=>({
 guard:(await one(`select pg_get_functiondef('public.enforce_chat_club_post'::regproc) d`)).d,
 checks:(await db.query(`select conname,pg_get_constraintdef(oid) d from pg_constraint where conname in ('chat_attachments_room_slug_check','chat_room_mentions_room_slug_check','longboard_chat_messages_actor_check') order by conname`)).rows,
});

// 1. The migration rolls back and re-applies.
const applied=await state();
assert.match(applied.guard,/#457/);
assert(applied.checks.every(c=>c.conname==='longboard_chat_messages_actor_check'||c.d.includes("'club'::text")),'club photos and alerts');
await db.exec(migration.down);
const before=await state();
assert.doesNotMatch(before.guard,/#457/);
assert(before.checks.filter(c=>c.conname!=='longboard_chat_messages_actor_check').every(c=>!c.d.includes("'club'")));
assert.deepEqual(before.checks.find(c=>c.conname==='longboard_chat_messages_actor_check'),applied.checks.find(c=>c.conname==='longboard_chat_messages_actor_check'),'the actor check is not changed');
await assert.rejects(send(alice,'too early'),/club_read_only/,'before the migration an admin cannot post');
await db.exec(migration.up+'\n-- again');
assert.deepEqual(await state(),applied,'re-applies cleanly');

// 2. An admin posts, edits and deletes their own post.
const post=await send(alice,'Welcome to the club! Webinar link: https://example.test/webinar');
assert.equal(post.status,'sent',JSON.stringify(post));
assert.deepEqual([post.message.room_slug,post.message.member_id,post.message.bot_slug],['club',aliceMember,null]);
const edited=await change(alice,post.message.id,'edit','Welcome to the club! (edited)',post.message.body);
assert.equal(edited.body,'Welcome to the club! (edited)');
// A photo.
const photo=(await one(`insert into chat_attachments(member_id,room_slug,filename,mime_type,byte_size,status,upload_path,object_path,sha256) values($1,'club','chart.png','image/png',1000,'ready','u/chart.png','o/chart.png',repeat('a',64)) returning id`,[aliceMember])).id;
const withPhoto=await send(alice,'',null,[photo]);
assert.equal(withPhoto.status,'sent',JSON.stringify(withPhoto));
assert.equal((await one('select status,room_message_id from chat_attachments where id=$1',[photo])).room_message_id,withPhoto.message.id);

// 3. Replies: another admin under an admin's post (and the alert is recorded); never under a card.
const reply=await send(mallory,'Thanks!',post.message.id);
assert.equal(reply.status,'sent',JSON.stringify(reply));
assert.equal((await one(`select count(*)::int n from chat_room_mentions where message_id=$1 and account_id=$2 and room_slug='club' and category='reply'`,[reply.message.id,alice])).n,1,'Alice is told about the reply');
const card=(await one(`select post_chat_club_pick('2026-11-14','ZZZZ','auto','#1 stock of the day: ZZZZ','{"ticker":"ZZZZ"}'::jsonb) r`)).r;
assert.equal(card.posted,true,'the stock-pick bot still posts');
await assert.rejects(send(alice,'reply to a card',card.messageId),/club_read_only/,'no replies under a stock-pick card');
await assert.rejects(db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,'social','Alice','from social',$2)`,[aliceMember,post.message.id]),/club_read_only/,'no replies from another room');
await assert.rejects(db.query(`update longboard_chat_messages set body='edited card' where id=$1`,[card.messageId]),/club_read_only/,'a card never changes');
await assert.rejects(db.query(`update longboard_chat_messages set room_slug='social' where id=$1`,[post.message.id]),/club_read_only/,'nothing moves out of the club');

// 4. Members and agents can't.
await assert.rejects(send(bob,'member post'),/club_read_only/,'a member cannot post');
await assert.rejects(db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'club','Bob','hi')`,[bobMember]),/club_read_only/);
await db.query(`update chat_agent_settings set post_rooms=array_append(post_rooms,'club'),read_rooms=array_append(read_rooms,'club')`);
const agent=(await one(`insert into chat_agents(owner_id,name,post_rooms,read_rooms) values($1,'ClubBot','{club}','{club}') returning id`,[alice])).id;
await assert.rejects(one(`select send_chat_agent_message($1,'club','agent post',null,'{}'::uuid[],$2) r`,[agent,crypto.randomUUID()]),/club_read_only/,"an admin's agent cannot post");
await db.query('delete from chat_agents where id=$1',[agent]);
await db.query(`update chat_agent_settings set post_rooms=array_remove(post_rooms,'club'),read_rooms=array_remove(read_rooms,'club')`);
// A member who lost admin can't add words, but can still delete their post.
await db.query(`update profiles set role='user' where id=$1`,[mallory]);
await assert.rejects(change(mallory,reply.message.id,'edit','changed','Thanks!'),/club_read_only/,'no longer an admin: no edits');
await db.query(`update profiles set role='admin' where id=$1`,[mallory]);

// 5. Deletes and bookkeeping.
const deleted=await change(alice,withPhoto.message.id,'delete');
assert.equal(deleted.deletedId,withPhoto.message.id);
await db.query('delete from longboard_chat_messages where id=$1',[post.message.id]);
assert.equal((await one('select reply_to_id from longboard_chat_messages where id=$1',[reply.message.id])).reply_to_id,null,'a removed parent leaves its reply');

// 6. Rolling back with posts in place: the admins' posts go, the cards stay; then re-applies.
const kept=await send(alice,'still here');assert.equal(kept.status,'sent');
await db.exec(migration.down+'\n-- with rows');
assert.deepEqual(await state(),before);
assert.equal((await one(`select count(*)::int n from longboard_chat_messages where room_slug='club' and guest_id is not null`)).n,0);
assert.equal((await one(`select count(*)::int n from longboard_chat_messages where id=$1`,[card.messageId])).n,1,'the cards stay');
await db.exec(migration.up+'\n-- once more');
assert.deepEqual(await state(),applied);
console.log('chat-club-admin-posts-database: ok');
process.exit(0);
