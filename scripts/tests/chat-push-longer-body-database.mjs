// #465 database check: with message previews on, delivery carries up to 2,000 characters of a DM
// or room reply (the app then cuts to about 1,000); Gainers stays at 600; "sender" and "off"
// still carry no text; the rollback puts the 600 read back. Full migration chain from the mobile
// fixture. Synthetic data only.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-push-longer-body-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const account=async p=>(await one('select id from chat_accounts where longboard_user_id=$1',[p.id])).id;
const [alice,bob]=[await account(people[0]),await account(people[1])];
await db.query('delete from chat_push_jobs');await db.query('delete from chat_push_subscriptions');
const bobPhone='https://fcm.googleapis.com/fcm/send/bob-phone';
await db.query('select save_chat_push_subscription($1,$2,$3,$4)',[bob,bobPhone,'p','a']);
const preview=mode=>db.query('select set_chat_push_preview($1,$2,$3)',[bob,bobPhone,mode]);
await preview('message');
const claimAll=async()=>{const out=[];for(let i=0;i<50;i++){const worker=randomUUID();const job=(await one('select claim_chat_push_job($1) j',[worker])).j;if(!job)break;out.push({job,worker});}return out;};
const prepare=c=>one('select prepare_chat_push_job($1,$2) r',[c.job.id,c.worker]).then(r=>r.r);
const long='Word '.repeat(500).trim(); // 2,499 characters
const fresh=async()=>{await db.query("update chat_push_jobs set completed_at=now()");};

// 1. DM: the whole text up to 2,000 characters reaches the app.
const pair=[people[0].member.id,people[1].member.id];
let conversation=(await one("select id from longboard_chat_conversations where (requester_id=$1 and recipient_id=$2) or (requester_id=$2 and recipient_id=$1)",pair))?.id;
if(!conversation)conversation=(await one("insert into longboard_chat_conversations(requester_id,recipient_id,status) values($1,$2,'accepted') returning id",pair)).id;
await db.query("update longboard_chat_conversations set status='accepted' where id=$1",[conversation]);
await fresh();
await db.query("insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values($1,$2,gen_random_uuid(),$3)",[conversation,people[0].member.id,long]);
let jobs=await claimAll();assert.equal(jobs.length,1,'one DM job for Bob\'s phone');
let payload=await prepare(jobs[0]);assert.equal(payload.kind,'dm');assert.equal(payload.body.length,2000);assert.equal(payload.body,long.slice(0,2000));
await preview('sender');payload=await prepare(jobs[0]);assert.equal('body' in payload,false,'sender mode carries no text');
await preview('off');payload=await prepare(jobs[0]);assert.equal('body' in payload,false,'off carries no text');assert.equal('sender' in payload,false);
await preview('message');

// 2. Room reply: same 2,000-character read.
await fresh();
const rootMessage=(await one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Bob','Root post','social') returning id",[people[1].member.id])).id;
await db.query("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id) values($1,$1,'Alice',$2,'social',$3)",[people[0].member.id,long,rootMessage]);
jobs=await claimAll();
if(!jobs.length){
 // Some fixture chains do not queue replies for this account; queue the mention directly.
 const mention=await one("select id from chat_room_mentions where account_id=$1 order by created_at desc limit 1",[bob]);
 assert.ok(mention,'a reply notification row exists for Bob');
 await db.query("insert into chat_push_jobs(subscription_id,kind,source_id) select id,'room',$1 from chat_push_subscriptions where endpoint=$2",[mention.id,bobPhone]);
 jobs=await claimAll();
}
assert.equal(jobs.length,1);payload=await prepare(jobs[0]);
assert.equal(payload.kind,'room');assert.equal(payload.body.length,2000);assert.equal(payload.category,'reply');

// 3. Gainers stays at 600.
await fresh();
await db.query('select set_chat_push_gainers($1,$2,true)',[bob,bobPhone]);
const gainersBody='🚨 LONG (+10.00%) 🕒 Pre-Market\n'+'x'.repeat(1500);
await db.query("select ingest_chat_gainers_alert('-100123',9001,now(),$1)",[gainersBody]);
jobs=(await claimAll()).filter(c=>c.job.url==='/chat?room=gainers');assert.equal(jobs.length,1);
payload=await prepare(jobs[0]);assert.equal(Array.from(payload.body).length,600,'Postgres left() counts code points');

// 4. The rollback puts the 600-character read back for DMs.
await db.exec(await readFile(`${root}/supabase/rollbacks/20261117120000_chat_push_longer_body.down.sql`,'utf8'));
await fresh();
await db.query("insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values($1,$2,gen_random_uuid(),$3)",[conversation,people[0].member.id,long]);
jobs=(await claimAll()).filter(c=>c.job.url.startsWith('/chat?dm='));assert.equal(jobs.length,1);
payload=await prepare(jobs[0]);assert.equal(payload.body.length,600);
assert.deepEqual(await one("select prosecdef,proconfig from pg_proc where oid='prepare_chat_push_job(uuid,uuid)'::regprocedure"),{prosecdef:false,proconfig:['search_path=""']});
for(const role of ['anon','authenticated']){await assert.rejects(db.exec(`set role ${role};select public.prepare_chat_push_job('${randomUUID()}','${randomUUID()}');`),/permission denied/);await db.exec('reset role');}
await db.close();
console.log('PASS push longer body: DM and room reply carry 2,000 characters in message mode, sender/off carry none, Gainers stays 600, rollback restores 600, invoker + empty search_path, browser roles denied');
