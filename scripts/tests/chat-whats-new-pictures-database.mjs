// #443 What's New pictures, database check on the full migration chain from the mobile fixture
// (synthetic data only): a note carries its pictures (2 here, bound and shown like any chat file),
// pictures past 3 follow right after it, the old three-argument call is unchanged, a PR already
// announced gets its pictures once, nobody can attach, forge or reuse a picture, and the rollback
// strips the pictures but keeps the notes, then the migration applies again.
// Usage: node scripts/tests/chat-whats-new-pictures-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-whats-new-pictures-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const all=async(sql,args=[])=>(await db.query(sql,args)).rows;
const [alice,bob]=people;
await db.query("update profiles set role='admin' where id=$1",[alice.id]);
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(promise,match,m)=>{await assert.rejects(promise,match,m);checks++;};
const sha='e'.repeat(40);
let n=0;
// What POST /api/chat/whats-new/pictures stores: a ready, rebuilt picture with no member.
const picture=(pr,{room='whats-new',mime='image/png',member=null,status='ready'}={})=>one(
 `insert into chat_attachments(member_id,room_slug,filename,mime_type,byte_size,upload_path,object_path,sha256,status,whats_new_pr,width,height)
  values($1,$2,$3,$4,1234,$5,$6,$7,$8,$9,1280,900) returning id`,
 [member,room,`Picture ${++n}.png`,mime,'whats-new/'+crypto.randomUUID(),'clean/'+crypto.randomUUID(),'a'.repeat(64),status,pr]).then(r=>r.id);
const changes=(...prs)=>JSON.stringify(prs.map(pr=>({pr,note:`Change ${pr} is live.`,mergedAt:'2026-11-11T12:00:00Z'})));
// The route calls these as the service role, never as the table owner.
const asService=async(sql,args)=>{const role=(await one('select current_user u')).u;if(role!=='postgres')return one(sql,args);
 await db.exec('set role service_role');try{return await one(sql,args);}finally{await db.exec('reset role');}};
const note=(prs,files=[],follow=[],body='New on Longboard.')=>asService('select post_chat_whats_new_note($1,$2,$3::jsonb,$4::uuid[],$5::jsonb) r',[sha,body,changes(...prs),files,JSON.stringify(follow)]).then(r=>r.r);
const message=id=>one('select body,bot_slug,author_label,member_id,attachment_ids,created_at,unread_seq from longboard_chat_messages where id=$1',[id]);

// 1. Picture rows: only pictures of What's New, PNG or JPEG, with no member; members' files unchanged.
const p1=await picture(4431),p2=await picture(4431);checks+=2;
await rejects(picture(4431,{room:'social'}),/chat_attachments_whats_new_picture/,'a picture belongs to What\'s New');
await rejects(picture(4431,{mime:'image/gif'}),/chat_attachments_whats_new_picture/,'PNG or JPEG only');
await rejects(picture(null),/chat_attachments_whats_new_picture|announcement_admin_only/,'a file without a member must be a picture');
await rejects(picture(4431,{member:alice.member.id}),/chat_attachments_whats_new_picture/,'a member\'s file is never a picture');

// 2. A note with 2 pictures: bound to the note like any chat file, the PR marked as pictured.
const first=await note([4431],[p1,p2],[],'You can now see pictures in What\'s New.');
ok(first.posted);eq(first.followUpIds,[]);
const m1=await message(first.messageId);
eq([m1.bot_slug,m1.author_label,m1.member_id,m1.attachment_ids],['whats-new','Booker Chat Updates',null,[p1,p2]],'note carries 2 pictures');
eq((await all('select status,room_message_id from chat_attachments where id=any($1::uuid[]) order by id',[[p1,p2]])).map(r=>[r.status,r.room_message_id]),[['attached',first.messageId],['attached',first.messageId]],'pictures attached to the note');
ok((await one('select pictures_posted_at from chat_whats_new_changes where pr_number=4431')).pictures_posted_at,'PR marked as pictured');
eq((await one("select count(*)::int c from chat_room_mentions where message_id=$1",[first.messageId])).c,0,'still alerts nobody');

// 3. The old three-argument call (the running app before this ships) posts text only, as before.
const plain=(await one('select post_chat_whats_new_note($1,$2,$3::jsonb) r',[sha,'Text only.',changes(4432)])).r;
eq((await message(plain.messageId)).attachment_ids,[],'text-only note');
eq((await one('select pictures_posted_at from chat_whats_new_changes where pr_number=4432')).pictures_posted_at,null);

// 4. Two PRs, 4 + 1 pictures: the note shows 3, the rest follow right after it (one message per PR).
const a=[await picture(4433),await picture(4433),await picture(4433),await picture(4433)],b=await picture(4434);
const big=await note([4433,4434],a.slice(0,3),[{body:'More pictures: Change 4433 is live.',files:[a[3]]},{body:'More pictures: Change 4434 is live.',files:[b]}]);
eq(big.followUpIds.length,2);
const [f1,f2]=await Promise.all(big.followUpIds.map(message));
const mn=await message(big.messageId);
eq([mn.attachment_ids,f1.attachment_ids,f2.attachment_ids],[a.slice(0,3),[a[3]],[b]],'3 on the note, the rest after it');
eq([f1.body,f1.bot_slug,f1.author_label],['More pictures: Change 4433 is live.','whats-new','Booker Chat Updates']);
ok(mn.created_at<=f1.created_at&&f1.created_at<=f2.created_at&&Number(mn.unread_seq)<Number(f1.unread_seq)&&Number(f1.unread_seq)<Number(f2.unread_seq),'follow-ups come right after the note, in order');
eq((await all("select kind from chat_whats_new_notes where message_id=any($1::uuid[])",[big.followUpIds])).map(r=>r.kind),['pictures','pictures']);

// 5. Refused, and nothing is posted: a picture of another PR, one already used, twice, more than 4
// for a PR, more than 3 on one message, a member's file, a bad follow-up.
const before=(await one("select count(*)::int c from longboard_chat_messages where room_slug='whats-new'")).c;
const other=await picture(9999),q=[await picture(4435),await picture(4435),await picture(4435),await picture(4435),await picture(4435)];
const memberFile=(await one(`insert into chat_attachments(member_id,room_slug,filename,mime_type,byte_size,upload_path,object_path,sha256,status) values($1,'whats-new','m.png','image/png',10,$2,$3,$4,'ready') returning id`,[alice.member.id,'quarantine/'+crypto.randomUUID(),'clean/'+crypto.randomUUID(),'b'.repeat(64)])).id;
await rejects(note([4435],[other]),/invalid_whats_new_pictures/,'picture of another PR');
await rejects(note([4435],[p1]),/invalid_whats_new_pictures/,'picture already posted');
await rejects(note([4435],[q[0],q[0]]),/invalid_whats_new_pictures/,'same picture twice');
await rejects(note([4435],q.slice(0,3),[{body:'More',files:q.slice(3)}]),/invalid_whats_new_pictures/,'5 pictures for one PR');
await rejects(note([4435],q.slice(0,4)),/invalid_whats_new/,'4 on one message');
await rejects(note([4435],[memberFile]),/invalid_whats_new_pictures/,'a member\'s file');
await rejects(note([4435],[],[{body:'',files:[q[0]]}]),/invalid_whats_new/,'follow-up without text');
await rejects(note([4435],[],[{body:'x',files:[]}]),/invalid_whats_new/,'follow-up without pictures');
eq((await one("select count(*)::int c from longboard_chat_messages where room_slug='whats-new'")).c,before,'nothing posted');
eq((await one('select count(*)::int c from chat_whats_new_changes where pr_number=4435')).c,0,'and nothing recorded');

// 6. Nobody else can use a picture: a member's or an admin's own message, Longboard Bot, or a bot
// row without a ledger note.
await rejects(db.query("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,attachment_ids) values($1,$1,'whats-new','Alice','mine',$2)",[alice.member.id,[q[0]]]),/attachment_not_ready/,'admin message cannot take a picture');
await rejects(db.query("insert into longboard_chat_messages(room_slug,author_label,body,bot_slug,attachment_ids) values('whats-new','Longboard Bot','x','longboard',$1)",[[q[0]]]),/whats_new_note_forbidden/,'Longboard Bot cannot');
await rejects(db.query("insert into longboard_chat_messages(room_slug,author_label,body,bot_slug,attachment_ids) values('whats-new','Booker Chat Updates','forged','whats-new',$1)",[[q[0]]]),/whats_new_note_forbidden/,'no forged note');
const forgedId=crypto.randomUUID();await db.query("insert into chat_whats_new_notes(message_id,kind) values($1,'auto')",[forgedId]);
await rejects(db.query("insert into longboard_chat_messages(id,room_slug,author_label,body,bot_slug,attachment_ids) values($1,'whats-new','Booker Chat Updates','x','whats-new',$2)",[forgedId,[memberFile]]),/whats_new_note_forbidden|attachment_not_ready/,'a note carries only pictures');
eq((await one("select status from chat_attachments where id=$1",[q[0]])).status,'ready','still unused');

// 7. A PR already announced without pictures (#434's case): its pictures go out once, after its note.
const late=[await picture(4432),await picture(4432),await picture(4432),await picture(4432)];
const pics=(pr,follow)=>asService('select post_chat_whats_new_pictures($1,$2::jsonb) r',[pr,JSON.stringify(follow)]).then(r=>r.r);
await rejects(pics(4436,[{body:'Pictures: x',files:[await picture(4436)]}]),/whats_new_not_announced/,'not announced');
await rejects(pics(4432,[{body:'Pictures',files:[other]}]),/invalid_whats_new_pictures/,'other PR\'s picture');
const posted=await pics(4432,[{body:'Pictures: Text only.',files:late.slice(0,3)},{body:'More pictures: Text only.',files:[late[3]]}]);
eq(posted.messageIds.length,2);
eq((await message(posted.messageIds[0])).attachment_ids,late.slice(0,3),'pictures after the note');
eq((await one("select deployment_sha from chat_whats_new_notes where message_id=$1",[posted.messageIds[0]])).deployment_sha,sha);
await rejects(pics(4432,[{body:'Again',files:[await picture(4432)]}]),/whats_new_pictures_already_posted/,'only once');
await rejects(pics(4431,[{body:'Again',files:[await picture(4431)]}]),/whats_new_pictures_already_posted/,'not for a PR whose note had pictures');

// 8. Service role only.
for(const role of ['anon','authenticated']){
 await db.exec('set role '+role);
 await rejects(db.query('select post_chat_whats_new_pictures(1,$1::jsonb)',['[]']),/permission denied/);
 await rejects(note([1]),/permission denied/);
 await db.exec('reset role');
}

// 9. Deleting a note (admin) takes its pictures with it.
const removed=(await one("select change_chat_message($1,$2,'whats-new','delete',null,null,true) r",[alice.id,big.followUpIds[1]])).r;ok(removed.deletedId);
eq((await one('select count(*)::int c from chat_attachments where id=$1',[b])).c,0,'picture removed with its message');

// 10. Rollback: picture messages gone, notes keep their text without pictures, functions as
// before; then the migration applies again.
const up=await readFile(root+'supabase/migrations/20261111143000_chat_whats_new_pictures.sql','utf8');
const down=await readFile(root+'supabase/rollbacks/20261111143000_chat_whats_new_pictures.down.sql','utf8');
await db.exec(down);
eq((await message(first.messageId)).attachment_ids,[],'note kept, pictures stripped');
eq((await message(first.messageId)).body,"You can now see pictures in What's New.");
eq((await one("select count(*)::int c from chat_whats_new_notes where kind='pictures'")).c,0);
eq((await one('select count(*)::int c from longboard_chat_messages where id=any($1::uuid[])',[[...big.followUpIds,...posted.messageIds]])).c,0,'picture messages removed');
eq((await one("select count(*)::int c from chat_attachments where member_id is null")).c,0);
eq((await one("select is_nullable from information_schema.columns where table_name='chat_attachments' and column_name='member_id'")).is_nullable,'NO');
ok((await one('select post_chat_whats_new_note($1,$2,$3::jsonb) r',[sha,'After rollback.',changes(4437)])).r.posted,'old function works');
await rejects(db.query("insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('whats-new','Booker Chat Updates','forged','whats-new')"),/whats_new_note_forbidden/,'old guard back');
await db.exec(up+'\n-- re-applied after rollback');
const again=await note([4438],[await picture(4438)]);
eq((await message(again.messageId)).attachment_ids.length,1,'re-applied');
console.log(`PASS ${checks} What's New picture database assertions: picture rows, note with 2 pictures, text-only unchanged, 3-per-message with follow-ups in order, refusals post nothing, no reuse or forging, once-only pictures for an announced PR, service role only, delete cascades, rollback + re-apply.`);
