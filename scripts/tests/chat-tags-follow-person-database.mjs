// #439 database check: @tags follow the person through name changes, on the full migration chain
// from the mobile fixture with 20261111120000_chat_tags_follow_person.sql held back. Tags and renames
// are seeded the way production has them (a name in the text only), then the migration and its
// batched backfill run, then live sends, edits, the lookups, the @ list, grants and the rollback.
// Synthetic only.
//   node scripts/tests/chat-tags-follow-person-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
const MIGRATION='20261111120000_chat_tags_follow_person.sql';
process.env.CHAT_FIXTURE_DEFER_MIGRATIONS=MIGRATION;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-tags-follow-person-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const q=async(sql,args=[])=>(await db.query(sql,args)).rows,one=async(sql,args=[])=>(await q(sql,args))[0];
let checks=0;const check=(fn)=>{fn();checks++;};

const [alice,bob,mallory]=people;
const am=alice.member.id,bm=bob.member.id,mm=mallory.member.id;
const newPerson=async(id,name)=>{
 await q('insert into auth.users values($1)',[id]);await q("insert into profiles values($1,$2,'user')",[id,`${name.toLowerCase()}@example.test`]);
 return (await one('select longboard_chat_link_member($1,$2,null) m',[id,name])).m.id;
};
const carolId='00000000-0000-4000-8000-0000000000c1',daveId='00000000-0000-4000-8000-0000000000d1';
const cm=await newPerson(carolId,'Carol');
const post=async(member,name,body,room='social')=>(await one('insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,$2,$3,$4) returning id',[member,name,body,room])).id;
const mentions=(message)=>q("select account_id,read_at from chat_room_mentions where message_id=$1 and category='mention' order by account_id",[message]);
const rename=(account,name)=>q('select chat_update_member_name($1,$2)',[account,name]);

// ---- Before the migration, the way production is today ----
const oldTag=await post(am,'Alice','@Bob can you share your notes from this morning?');
assert.deepEqual((await mentions(oldTag)).map(r=>r.account_id),[bob.id]);checks++;
await q('update chat_room_mentions set read_at=now() where message_id=$1',[oldTag]); // Bob has seen it.
const editedTag=await post(mm,'Mallory','@Bob what size did you take?');
const carolSelf=await post(cm,'Carol','Note to self @Carol: check the borrow');
const carolTagged=await post(am,'Alice','@Carol nice call');
const twoTags=await post(mm,'Mallory','@Bob and @Alice, see you at the open');
const mainTag=await post(am,'Alice','@Bob main room note','main');
await post(bm,'Bob','Bob speaking, before the rename');
await rename(bob.id,'Robert Bobson');
await rename(carolId,'Caroline');
const dm=await newPerson(daveId,'Carol'); // Someone else now has Carol's old name.
// An edit after the rename lost the notification (the old name no longer matched anyone).
await q("update longboard_chat_messages set body='@Bob what size did you take? (edited)' where id=$1",[editedTag]);
assert.deepEqual(await mentions(editedTag),[]);checks++;

// The read-only estimate Rob can run on production first (scripts/sql/chat-tags-follow-person-estimate.sql).
const estimate=await one(await readFile(`${root}/scripts/sql/chat-tags-follow-person-estimate.sql`,'utf8'));
assert.equal(Number(estimate.earlier_names),2,'Bob and Carol, from the names their messages were sent under');checks++;
assert.equal(Number(estimate.shared_names),1,'Carol');checks++;
assert.ok(Number(estimate.messages_with_at)>=6&&Number(estimate.messages_scanned)>Number(estimate.messages_with_at));checks++;

// ---- The migration ----
await db.exec(await readFile(`${root}/supabase/migrations/${MIGRATION}`,'utf8'));
const names=async(member)=>(await q('select display_name from chat_member_names where member_id=$1 order by display_name',[member])).map(r=>r.display_name);
assert.deepEqual(await names(bm),['Robert Bobson']);checks++;
assert.equal((await one('select count(*)::int n from chat_message_tags')).n,0,'the migration itself writes no tags');checks++;

// ---- The backfill, in small batches ----
let state,steps=0;
do{state=(await one('select chat_tags_backfill_step(7) s')).s;steps++;assert.ok(steps<200);}while(state.phase!=='done');
assert.ok(steps>3,'many small batches');checks++;
assert.deepEqual(await names(bm),['Bob','Robert Bobson']);checks++;
assert.deepEqual(await names(cm),['Carol','Caroline']);checks++;
const tags=async(message)=>(await q('select tagged_as,member_id from chat_message_tags where message_id=$1 order by tag_key',[message])).map(r=>[r.tagged_as,r.member_id]);
assert.deepEqual(await tags(oldTag),[['Bob',bm]]);checks++;
assert.deepEqual(await tags(editedTag),[['Bob',bm]]);checks++;
assert.deepEqual(await tags(twoTags),[['Alice',am],['Bob',bm]]);checks++;
// "@Carol" by Alice notified Caroline (then Carol): her notification says who was meant.
assert.deepEqual(await tags(carolTagged),[['Carol',cm]]);checks++;
// Caroline's note to herself had no notification and two people have been Carol: left alone.
assert.deepEqual(await tags(carolSelf),[]);checks++;
assert.equal(state.ambiguous,1);checks++;
assert.ok(state.tags_added>=6&&state.messages_tagged>=5,JSON.stringify(state));checks++;
// The backfill never creates notifications (each would send a push).
assert.deepEqual(await mentions(editedTag),[]);checks++;
assert.ok((await mentions(oldTag))[0].read_at,'read state kept');checks++;
// Running it again does nothing.
const again=(await one('select chat_tags_backfill_step(7) s')).s;
assert.equal(again.tags_added,state.tags_added);checks++;

// ---- Showing tags: the current name and the right person ----
const lookup=(actor,rooms,namesAsked,messages)=>q('select message_id,tag_key,member_id,display_name from chat_tag_lookup($1,$2,$3,$4) order by message_id nulls first,tag_key',[actor,rooms,namesAsked,messages]);
let rows=await lookup(alice.id,['social','main'],['bob','alice'],[oldTag,carolTagged]);
assert.deepEqual(rows.filter(r=>!r.message_id).map(r=>r.display_name),['Alice'],'"bob" is no one now');checks++;
assert.deepEqual(rows.filter(r=>r.message_id===oldTag).map(r=>[r.tag_key,r.display_name,r.member_id]),[['bob','Robert Bobson',bm]]);checks++;
assert.deepEqual(rows.filter(r=>r.message_id===carolTagged).map(r=>r.display_name),['Caroline']);checks++;
// Only rooms the reader may open: Mallory has no Longboard room access, and asking for it does not help.
assert.deepEqual(await lookup(mallory.id,['main'],[],[mainTag]),[]);checks++;
assert.equal((await lookup(alice.id,['main'],[],[mainTag])).length,1);checks++;
assert.deepEqual(await lookup(alice.id,['social'],[],[mainTag]),[],'the room must be one the caller listed');checks++;
await assert.rejects(()=>lookup(alice.id,['social'],Array(61).fill('x'),[]),/invalid_query/);checks++;

// ---- Live: new tags, edits after a rename ----
const fresh=await post(am,'Alice','@Robert Bobson welcome back');
assert.deepEqual(await tags(fresh),[['Robert Bobson',bm]]);checks++;
assert.deepEqual((await mentions(fresh)).map(r=>r.account_id),[bob.id],'new tags notify as before');checks++;
const readAt=(await mentions(oldTag))[0].read_at;
await q("update longboard_chat_messages set body='@Bob can you share your notes from this morning, please?' where id=$1",[oldTag]);
assert.deepEqual(await tags(oldTag),[['Bob',bm]],'an edit keeps the person of a tag typed as an old name');checks++;
assert.deepEqual((await mentions(oldTag)).map(r=>[r.account_id,String(r.read_at)]),[[bob.id,String(readAt)]],'and the notification, still read');checks++;
await q("update longboard_chat_messages set body='@Bob and @Robert Bobson twice' where id=$1",[oldTag]);
assert.deepEqual(await tags(oldTag),[['Bob',bm],['Robert Bobson',bm]]);checks++;
assert.equal((await mentions(oldTag)).length,1,'one notification per person');checks++;
await q("update longboard_chat_messages set body='No tag any more' where id=$1",[oldTag]);
assert.deepEqual(await tags(oldTag),[]);assert.deepEqual(await mentions(oldTag),[]);checks+=2;
// Self tags are stored (they are drawn as links) but never notify; announcement rooms never notify.
const self=await post(am,'Alice','@Alice reminder');
assert.deepEqual(await tags(self),[['Alice',am]]);assert.deepEqual(await mentions(self),[]);checks+=2;
// A tag typed now with an old name is plain text: new tags follow current names only.
const stale=await post(mm,'Mallory','@Bob are you there?');
assert.deepEqual(await tags(stale),[]);assert.deepEqual(await mentions(stale),[]);checks+=2;
// Longest name wins, and a name may not run on into a word.
const longer=await post(mm,'Mallory','@Robert Bobsonish and @Alice!');
assert.deepEqual(await tags(longer),[['Alice',am]]);checks++;
// Blocks still stop the notification (not the link).
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[bm,mm]);
const blocked=await post(mm,'Mallory','@Robert Bobson hello');
assert.deepEqual(await tags(blocked),[['Robert Bobson',bm]]);assert.deepEqual(await mentions(blocked),[]);checks+=2;
await q('delete from longboard_chat_blocks');
// A rename is remembered at once.
await rename(bob.id,'Rob B');
assert.deepEqual(await names(bm),['Bob','Rob B','Robert Bobson']);checks++;
assert.equal((await lookup(alice.id,['social'],[],[fresh]))[0].display_name,'Rob B');checks++;
// Deleting a message removes its tags.
await q('delete from longboard_chat_messages where id=$1',[fresh]);
assert.deepEqual(await tags(fresh),[]);checks++;

// ---- The @ list: one row per member, under the current name ----
const suggest=async(query,hidden=[])=>(await q('select id,display_name,previous_name from chat_tag_suggestions($1,$2,10)',[query,hidden])).map(r=>[r.display_name,r.previous_name]);
assert.deepEqual(await suggest('Ro'),[['Rob B',null]]);checks++;
assert.deepEqual(await suggest('Bo'),[['Rob B','Bob']],'found once by the old name, shown with the new one');checks++;
assert.deepEqual(await suggest('robert'),[['Rob B','Robert Bobson']]);checks++;
assert.deepEqual(await suggest('Carol'),[['Carol',null],['Caroline',null]],'Dave now owns Carol; Caroline is found by her own name');checks++;
assert.deepEqual(await suggest('Caro',[daveId]),[['Caroline',null]]);checks++;
const everyone=await q("select id from chat_tag_suggestions('',array[]::uuid[],20)");
assert.equal(new Set(everyone.map(r=>r.id)).size,everyone.length,'nobody twice');checks++;
assert.equal(everyone.length,(await one('select count(*)::int n from longboard_chat_members')).n);checks++;
await q("update longboard_chat_members set display_name='Literal_Name' where id=$1",[mm]);
assert.deepEqual(await suggest('Literal_N'),[['Literal_Name',null]]);assert.deepEqual(await suggest('LiteralXN'),[]);assert.deepEqual(await suggest('%'),[]);checks+=3;
await assert.rejects(()=>q("select * from chat_tag_suggestions($1,'{}',10)",['x'.repeat(29)]),/invalid_query/);checks++;

// ---- Grants ----
for(const sql of ["select * from chat_tag_lookup($1,'{social}','{}','{}')","select * from chat_tag_suggestions('a','{}',10)","select chat_tags_backfill_step(1)","select * from chat_message_tags","select * from chat_member_names"]){
 for(const role of ['authenticated','anon']){
  await db.exec(`reset role;set role ${role}`);
  await assert.rejects(()=>q(sql,sql.includes('$1')?[alice.id]:[]),/permission denied/);checks++;
 }
}
await db.exec('reset role');

// ---- Rollback ----
await db.exec(await readFile(`${root}/supabase/rollbacks/${MIGRATION.replace('.sql','.down.sql')}`,'utf8'));
assert.equal((await one("select count(*)::int n from pg_tables where tablename in ('chat_message_tags','chat_member_names','chat_tags_backfill')")).n,0);checks++;
const after=await post(am,'Alice','@Rob B after the rollback');
assert.deepEqual((await mentions(after)).map(r=>r.account_id),[bob.id],'the old name matching is back');checks++;
await db.exec(await readFile(`${root}/supabase/migrations/${MIGRATION}`,'utf8'));
checks++;
await db.close();
console.log(`PASS ${checks} tag SQL assertions: backfill in batches (names from messages, exact and ambiguous matches, no notifications), current names and room checks on lookup, live tags, edits after renames, self, blocks, the one-per-person @ list, grants and the rollback.`);
