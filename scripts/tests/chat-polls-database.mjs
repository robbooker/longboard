// #328 Polls database check on the full migration chain from the mobile fixture (synthetic data
// only): a poll is a message (room and thread), created with its answers in one transaction;
// bad polls are refused; single vs multiple answers, changing and taking back a vote; closed polls
// take no votes; only the creator closes; anonymous polls never select a voter; visible polls name
// them; deleting the message removes the poll; the rollback removes it all and re-applies cleanly.
// Usage: node scripts/tests/chat-polls-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-polls-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const [alice,bob,mallory]=people;
let checks=0;const ok=(v,m='check')=>{assert.ok(v,m);checks++;};const eq=(a,b,m=JSON.stringify(a)+' vs '+JSON.stringify(b))=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m='rejects')=>{await assert.rejects(p,re,m);checks++;};
await db.exec("update longboard_chat_room_state set is_open=true");
// The send rate limit (1.5 s between sends) would slow this test; it isn't what is tested here.
const clear=()=>db.query("update longboard_chat_messages set created_at=created_at-interval '1 day' where created_at>now()-interval '1 day'");
const create=async(user,{room='main',question='Which setup?',options=['Long','Short','Flat'],anonymous=true,multi=false,reply=null,client=crypto.randomUUID()}={})=>{
 await clear();
 return (await one('select create_chat_poll($1,$2,$3,$4,$5,$6,$7,$8) r',[user.id,room,question,options,anonymous,multi,reply,client])).r;
};
const read=async(user,room,ids)=>(await one('select read_chat_polls($1,$2,$3) r',[user.id,room,ids])).r;
const vote=(user,room,message,opts)=>db.query('select vote_chat_poll($1,$2,$3,$4)',[user.id,room,message,opts]);
const close=(user,room,message)=>db.query('select close_chat_poll($1,$2,$3)',[user.id,room,message]);

// 1. Creating: the message carries the question; the poll and answers come with it.
const client=crypto.randomUUID();
const made=await create(alice,{client});
eq(made.status,'sent');
const id=made.message.id;
eq(made.message.body,'📊 Poll: Which setup?');
let [poll]=await read(alice,'main',[id]);
eq(poll.options.map(o=>o.label),['Long','Short','Flat']);
eq([poll.anonymous,poll.multi,poll.closed_at,poll.created_by_me,poll.voters],[true,false,null,true,0]);
eq((await read(bob,'main',[id]))[0].created_by_me,false);
// A retry with the same client id is the same send, not a second poll.
eq((await create(alice,{client})).status,'duplicate');
eq(Number((await one('select count(*) n from chat_polls')).n),1);
// Bad polls are refused before any message is written.
for(const bad of [{options:['One']},{options:Array.from({length:11},(_,i)=>'A'+i)},{options:['Same','same']},{question:'  '},{options:['ok','']},{question:'x'.repeat(301)}])
 await rejects(create(alice,bad),/invalid_poll/,JSON.stringify(bad));
eq(Number((await one("select count(*) n from longboard_chat_messages where body like '📊 Poll:%'")).n),1);
// The room's own rules still apply: a paused room takes no poll.
await db.exec(`update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by='${alice.id}' where room_slug='main'`);
eq((await create(alice)).status,'paused');
await db.exec("update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug='main'");

// A poll's text can't be edited (through change_chat_message or directly); other messages can.
await rejects(db.query("select change_chat_message($1,$2,'main','edit','📊 Poll: Something else','📊 Poll: Which setup?')",[alice.id,id]),/message_forbidden/);
await rejects(db.query("update longboard_chat_messages set body='changed' where id=$1",[id]),/message_forbidden/);
const plain=(await one("insert into longboard_chat_messages(guest_id,member_id,author_label,body) values($1,$1,'Alice','📊 Poll: not really') returning id",[alice.member.id])).id;
await db.query("update longboard_chat_messages set body='edited' where id=$1",[plain]);checks++;

// 2. Voting: single answer, change, take back.
const [long,short,flat]=poll.options.map(o=>o.id);
await vote(bob,'main',id,[long]);
await rejects(vote(bob,'main',id,[long,short]),/single_choice/);
await rejects(db.query('insert into chat_poll_votes(poll_id,option_id,member_id) select id,$2,$3 from chat_polls where message_id=$1',[id,short,bob.member.id]),/single_choice/);
await vote(mallory,'main',id,[long]);
[poll]=await read(alice,'main',[id]);
eq(poll.options.map(o=>o.votes),[2,0,0]);eq(poll.voters,2);eq(poll.my_votes,[]);
// Anonymous: no member is selected at all.
ok(poll.options.every(o=>o.people===null),'anonymous poll names nobody');
ok(!JSON.stringify(await read(alice,'main',[id])).includes(bob.member.id),'no voter id anywhere');
await vote(bob,'main',id,[short]);
[poll]=await read(bob,'main',[id]);
eq(poll.options.map(o=>o.votes),[1,1,0]);eq(poll.my_votes,[short]);
await vote(bob,'main',id,[]);
[poll]=await read(bob,'main',[id]);
eq(poll.options.map(o=>o.votes),[1,0,0]);eq(poll.my_votes,[]);eq(poll.voters,1);
// Wrong room, unknown answer, deleted message.
await rejects(vote(bob,'social',id,[long]),/poll_not_found/);
const other=await create(alice,{options:['A','B']});
const otherOption=(await read(alice,'main',[other.message.id]))[0].options[0].id;
await rejects(vote(bob,'main',id,[otherOption]),/invalid_option/);
eq(await read(bob,'social',[id]),[]);

// 3. Multiple answers and visible votes, in a thread.
const thread=await create(bob,{question:'What did you trade?',options:['SPY','QQQ','IWM'],anonymous:false,multi:true,reply:id});
eq(thread.status,'sent');eq(thread.message.reply_to_id,id);
const tid=thread.message.id;
let [visible]=await read(alice,'main',[tid]);
const [spy,qqq]=visible.options.map(o=>o.id);
await vote(alice,'main',tid,[spy,qqq]);
await vote(mallory,'main',tid,[qqq]);
[visible]=await read(bob,'main',[tid]);
eq(visible.options.map(o=>o.votes),[1,2,0]);eq(visible.voters,2);
eq(visible.options[1].people.map(p=>p.name),['Alice','Mallory']);
eq(visible.options[2].people,[]);

// 4. Closing: creator only; then no votes.
await rejects(close(alice,'main',tid),/poll_forbidden/);
await close(bob,'main',tid);
[visible]=await read(alice,'main',[tid]);
ok(visible.closed_at,'closed');
await rejects(vote(alice,'main',tid,[]),/poll_closed/);
await rejects(vote(mallory,'main',tid,[spy]),/poll_closed/);
await rejects(db.query('insert into chat_poll_votes(poll_id,option_id,member_id) select id,$2,$3 from chat_polls where message_id=$1',[tid,spy,bob.member.id]),/poll_closed/);
// Paused room: no votes.
await db.exec(`update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by='${alice.id}' where room_slug='main'`);
await rejects(vote(bob,'main',id,[long]),/chat_paused/);
await db.exec("update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug='main'");

// 5. A deleted poll message hides the poll; removing the message removes it.
await db.query("select change_chat_message($1,$2,'main','delete')",[alice.id,other.message.id]);
eq(await read(alice,'main',[other.message.id]),[]);
await rejects(vote(bob,'main',other.message.id,[otherOption]),/poll_not_found/);
await db.query('delete from longboard_chat_messages where id=$1',[other.message.id]);
eq(Number((await one('select count(*) n from chat_polls where message_id=$1',[other.message.id])).n),0);

// 6. Grants: only the service role.
for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role}`);
 await rejects(db.query('select * from chat_poll_votes'),/permission denied/);
 await rejects(db.query('select read_chat_polls($1,$2,$3)',[alice.id,'main',[id]]),/permission denied/);
 await db.exec('reset role');
}

// 7. Rollback, then the migration again.
await db.exec(await readFile(`${root}/supabase/rollbacks/20261030120000_chat_polls.down.sql`,'utf8'));
ok(!(await one("select to_regclass('public.chat_polls') t")).t,'rolled back');
ok((await one("select count(*) n from longboard_chat_messages where body like '📊 Poll:%'")).n>0,'messages stay');
await db.exec(`${await readFile(`${root}/supabase/migrations/20261030120000_chat_polls.sql`,'utf8')}\n-- again`);
ok((await one("select to_regclass('public.chat_polls') t")).t,'re-applied');
console.log(`PASS chat polls database: ${checks} checks`);
process.exit(0);
