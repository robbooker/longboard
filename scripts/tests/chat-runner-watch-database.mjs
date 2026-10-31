// #341 Runner Watch database check on the full migration chain from the mobile fixture (synthetic data):
// who has the room, where the bot can write, duplicates, limits, the switches, main rooms, and the
// rollback restoring every function to its exact previous body, then the migration re-applying cleanly.
// Usage: node scripts/tests/chat-runner-watch-database.mjs
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-runner-watch-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m)=>{await assert.rejects(p,re,m);checks++;};
const has=async(account,room)=>(await one('select public.chat_account_has_room($1,$2) ok',[account,room])).ok;
const [alice,bob]=people;
const up=await readFile(`${root}supabase/migrations/20261031150000_chat_runner_watch.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/20261031150000_chat_runner_watch.down.sql`,'utf8');
const lb=await readFile(`${root}supabase/migrations/20261031120000_chat_lb_review.sql`,'utf8');

// The room.
eq(await has(bob.id,'runner-watch'),true,'member has it');eq(await has(alice.id,'runner-watch'),true,'admin has it');
eq(await has('99999999-9999-4999-8999-999999999999','runner-watch'),false,'unknown account');
eq((await one(`select count(*)::int n from longboard_chat_room_state where room_slug='runner-watch' and id=13`)).n,1,'room row');

// The bot: three rooms, and the notices one only in Admins. Nothing else, however it's asked.
const bot=(room,slug='runner-watch')=>db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values($1,'X','probe',$2) returning id`,[room,slug]);
for(const room of ['social','gainers','developers','lb-review','whats-new','admins','lb-announcements','ss-announcements','lb-recordings','ss-recordings'])await rejects(bot(room),/./,`bot can't write in ${room}`); // the actor check or a room's own guard
for(const room of ['main','shortscout','runner-watch','social'])await rejects(bot(room,'runner-watch-notices'),/actor_check/,`notices can't write in ${room}`);
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug,guest_id) select 'main','X','probe','runner-watch',id from longboard_chat_members limit 1`),/actor_check/,'the bot is never a member');

// Tables: RLS on, no policies, service role only.
for(const table of ['chat_runner_watch_reports','chat_runner_watch_settings','chat_runner_watch_room_posts']){
 eq((await one(`select relrowsecurity r from pg_class where oid=$1::regclass`,[table])).r,true,`${table} RLS`);
 eq((await db.query(`select 1 from pg_policies where tablename=$1`,[table])).rows,[],`${table} no policies`);
 for(const role of ['anon','authenticated'])for(const right of ['select','insert','update'])eq((await one(`select has_table_privilege($1,$2,$3) s`,[role,table,right])).s,false,`${table} ${role} ${right}`);
 eq((await one(`select has_table_privilege('service_role',$1,'delete') s`,[table])).s,false,`${table} no delete`);
}
const SIG='public.ingest_chat_runner_watch(uuid,text,text,text[],text,text,text,text,boolean,timestamptz,text)';
for(const fn of [SIG,'public.release_chat_runner_watch(uuid,text)','public.chat_runner_watch_post_main(uuid,text,boolean,text)'])for(const role of ['anon','authenticated'])eq((await one(`select has_function_privilege($1,$2,'execute') e`,[role,fn])).e,false,`${role} ${fn}`);

// The feed.
const reset=async()=>{await db.exec(`delete from chat_runner_watch_reports;delete from longboard_chat_messages where bot_slug in ('runner-watch','runner-watch-notices');update chat_runner_watch_settings set enabled=true,alerts_only=false,max_per_hour=12,max_per_day=60,main_alerts_only=true,main_max_per_day=3,last_notice_at=null`);};
let n=0;
const send=async({key=`k${++n}`,text=`text ${key}`,alert=false}={})=>{
 const id=createHash('md5').update(key).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
 const hash=createHash('sha256').update(text).digest('hex');
 return (await one(`select ${SIG.split('(')[0]}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r`,[id,key,hash,['SGRX'],'S '+key,text,`post ${text}`,`main ${text}`,alert,null,'https://x.test/admin/runner-watch'])).r;
};
const count=async(room,slug='runner-watch')=>(await one(`select count(*)::int n from longboard_chat_messages where room_slug=$1 and bot_slug=$2`,[room,slug])).n;
const rooms=async()=>[await count('runner-watch'),await count('main'),await count('shortscout')];

await reset();
// An ordinary update: Runner Watch only.
let r=await send({key:'a'});eq(r.status,'posted','posts');eq(r.rooms,[],'not an alert, no main rooms');eq(await rooms(),[1,0,0],'Runner Watch only');
eq((await one(`select author_label,body from longboard_chat_messages where room_slug='runner-watch'`)),{author_label:'Runner Risk Watch',body:'post text a'},'as the bot');
// The same update again, and the same words under a new id.
eq((await send({key:'a'})).status,'duplicate','same key');eq((await send({key:'a2',text:'text a'})).status,'duplicate','same words');eq(await rooms(),[1,0,0],'nothing new');
// An alert: all three, once each, including on a resend.
r=await send({key:'b',alert:true});eq(r.rooms,['main','shortscout'],'alert reaches both');eq(await rooms(),[2,1,1],'one post each');
eq((await one(`select body from longboard_chat_messages where room_slug='main' and bot_slug='runner-watch'`)).body,'main text b','main wording');
eq((await send({key:'b',alert:true})).status,'duplicate','alert resend');eq(await rooms(),[2,1,1],'resend posts nowhere');
eq((await one(`select count(*)::int n from chat_runner_watch_room_posts where report_id=(select id from chat_runner_watch_reports where dedupe_key='b')`)).n,3,'three room rows');
await rejects(db.query(`insert into chat_runner_watch_room_posts(report_id,room_slug) select id,'main' from chat_runner_watch_reports where dedupe_key='b'`),/duplicate key/,'the table refuses a second post in a room');
await rejects(db.query(`insert into chat_runner_watch_room_posts(report_id,room_slug) select id,'social' from chat_runner_watch_reports where dedupe_key='b'`),/room_slug_check/,'no other room');
// A member can reply to a post in the room.
const post=await one(`select id from longboard_chat_messages where room_slug='runner-watch' limit 1`),member=await one('select id from longboard_chat_members where user_id=$1',[bob.id]);
await db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,'runner-watch','Bob','Thanks',$2)`,[member.id,post.id]);checks++;

// Main rooms' daily limit: per room, Runner Watch unaffected, Rob told, and not sent later.
await reset();
for(let i=0;i<3;i++)eq((await send({alert:true})).rooms,['main','shortscout'],`alert ${i}`);
r=await send({key:'over',alert:true});eq([r.status,r.rooms,r.capped,r.told],['posted',[],['main','shortscout'],true],'over the limit');eq(await rooms(),[4,3,3],'Runner Watch still gets it');
eq(await count('admins','runner-watch-notices'),1,'admins told');
eq((await send({alert:true})).told,false,'told once an hour');eq(await count('admins','runner-watch-notices'),1,'no second note');
eq((await send({key:'over',alert:true})).status,'duplicate','resend doesn\'t fill in later');eq(await rooms(),[5,3,3],'still three');
// The limit is one room's: SS full, LB not.
await db.exec(`delete from chat_runner_watch_room_posts where room_slug='main'`);
eq((await send({alert:true})).rooms,['main'],'each room counts alone');
// Yesterday's don't count, and the setting moves it.
await db.exec(`update chat_runner_watch_room_posts set posted_at=now()-interval '25 hours'`);
eq((await send({alert:true})).rooms,['main','shortscout'],'a day later');
await db.exec('update chat_runner_watch_settings set main_max_per_day=0');eq((await send({alert:true})).capped,['main','shortscout'],'zero means none');
// Rob's main-room rule.
await reset();await db.exec('update chat_runner_watch_settings set main_alerts_only=false');
eq((await send()).rooms,['main','shortscout'],'switched: every update');
// A paused main room costs only that room.
await reset();await db.exec(`update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by='${bob.id}' where room_slug='main'`);
eq((await send({alert:true})).rooms,['shortscout'],'paused LB skipped');eq(await rooms(),[1,0,1],'others post');
await db.exec(`update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug='main'`);
// A paused Runner Watch rolls everything back, for a resend.
await reset();await db.exec(`update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by='${bob.id}' where room_slug='runner-watch'`);
await rejects(send({key:'p',alert:true}),/longboard_chat_paused/,'paused room');eq(await rooms(),[0,0,0],'nothing posted');
await db.exec(`update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug='runner-watch'`);
eq((await send({key:'p',alert:true})).status,'posted','resend after the pause');

// Off stops all three, stores nothing.
await reset();await db.exec('update chat_runner_watch_settings set enabled=false');
eq((await send({alert:true})).status,'off','off');eq(await rooms(),[0,0,0],'nothing in any room');eq((await one('select count(*)::int n from chat_runner_watch_reports')).n,0,'nothing stored');
await db.exec('update chat_runner_watch_settings set enabled=true');
// Room-wide alerts only: saved, unposted, and a resend posts once it's lifted.
await db.exec('update chat_runner_watch_settings set alerts_only=true');
eq((await send({key:'s'})).status,'saved','not an alert');eq(await rooms(),[0,0,0],'not posted');eq((await send({key:'t',alert:true})).status,'posted','an alert still posts');eq(await rooms(),[1,1,1],'in all three');
await db.exec('update chat_runner_watch_settings set alerts_only=false');eq((await send({key:'s'})).status,'posted','saved one can post later');

// Too many: held back, one note, nothing in main rooms.
await reset();await db.exec('update chat_runner_watch_settings set max_per_hour=2,main_alerts_only=false');
await send();await send();
r=await send({key:'h1',alert:true});eq([r.status,r.told],['held',true],'held');eq(await rooms(),[2,2,2],'held posts nowhere');
eq((await one(`select status from chat_runner_watch_reports where dedupe_key='h1'`)).status,'held','stored as held');
eq((await send({key:'h2',alert:true})).told,false,'one note an hour');eq(await count('admins','runner-watch-notices'),1,'one note');
eq((await send({key:'h3',text:'text h1',alert:true})).status,'duplicate','same words as a held one');
// Resent after the hour, it posts, once.
await db.exec(`update chat_runner_watch_reports set posted_at=now()-interval '2 hours' where status='posted'`);
await db.exec(`update chat_runner_watch_room_posts set posted_at=now()-interval '2 hours'`);
eq((await send({key:'h1',alert:true})).status,'posted','resent later');eq((await send({key:'h1',alert:true})).status,'duplicate','and only once');
// The daily limit holds too.
await reset();await db.exec('update chat_runner_watch_settings set max_per_day=1');await send();eq((await send()).status,'held','daily limit');
// An admin's Post now: past the limit, once, main rooms too; the off switch still wins.
await reset();await db.exec('update chat_runner_watch_settings set max_per_day=1');await send();
await send({key:'rel',alert:true});const rel=(await one(`select id from chat_runner_watch_reports where dedupe_key='rel'`)).id;
const release=async(id)=>(await one(`select public.release_chat_runner_watch($1,'https://x.test') r`,[id])).r;
await db.exec('update chat_runner_watch_settings set enabled=false');eq((await release(rel)).status,'off','off stops Post now');
await db.exec('update chat_runner_watch_settings set enabled=true');
r=await release(rel);eq([r.status,r.rooms],['posted',['main','shortscout']],'released');eq(await rooms(),[2,1,1],'in all three');
eq((await release(rel)).status,'not_held','only once');eq((await release(randomUUID())).status,'not_held','unknown id');
// A runaway feed stops being stored at 200 held in a day; a known one can still come back.
await reset();await db.exec('update chat_runner_watch_settings set max_per_day=1');await send();
await db.query(`insert into chat_runner_watch_reports(id,dedupe_key,content_hash,summary,full_text,post_body,main_post_body,status) select gen_random_uuid(),'bulk'||g,md5(g::text)||md5(g::text),'s','f','p','m','held' from generate_series(1,200) g`);
eq((await send()).status,'refused','refused');eq((await one(`select count(*)::int n from chat_runner_watch_reports where status='held'`)).n,200,'not stored');
// Concurrency: one key sent at once posts once (the lock serialises it).
await reset();const both=await Promise.all([send({key:'c',alert:true}),send({key:'c',alert:true})]);eq(both.map(x=>x.status).sort(),['duplicate','posted'],'two at once');eq(await rooms(),[1,1,1],'one post each');

// Rollback: every function exactly as the chain had it, room, tables and bot posts gone.
const names=[...up.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map(x=>x[1]);
eq(names.length,11,'eleven functions changed');
const body=(text,name)=>{const start=text.indexOf(`FUNCTION public.${name}(`);assert(start>=0,name);const open=text.indexOf('$function$',start),close=text.indexOf('$function$',open+10);return text.slice(open,close);};
for(const name of names){
 eq(body(down,name),body(lb,name),`rollback body of ${name} is its previous definition`);
 eq(body(up,name).replaceAll(`'lb-review','runner-watch'`,`'lb-review'`),body(lb,name),`migration only adds the room to ${name}`);
}
await db.exec(down);
for(const t of ['chat_runner_watch_reports','chat_runner_watch_settings','chat_runner_watch_room_posts'])eq((await one(`select to_regclass($1) t`,['public.'+t])).t,null,`${t} gone`);
for(const fn of ['ingest_chat_runner_watch','release_chat_runner_watch','chat_runner_watch_post_main'])eq((await db.query(`select 1 from pg_proc where proname=$1`,[fn])).rows,[],`${fn} gone`);
eq((await db.query(`select 1 from longboard_chat_room_state where room_slug='runner-watch'`)).rows,[],'room gone');
eq((await db.query(`select 1 from longboard_chat_messages where room_slug='runner-watch' or bot_slug in ('runner-watch','runner-watch-notices')`)).rows,[],'every bot post gone');
eq(await has(bob.id,'runner-watch'),false,'nobody has it');eq(await has(bob.id,'lb-review'),true,'LB Review stays');
assert(!(await one(`select qual from pg_policies where policyname='members read chat messages'`)).qual.includes('runner-watch'),'policy restored');checks++;
await rejects(db.query(`insert into longboard_chat_room_state(id,room_slug) values(13,'runner-watch')`),/room_slug_check/,'constraint restored');
await rejects(bot('main'),/actor_check/,'actor check restored');

// And it applies again.
await db.exec(up+'\n-- again');
eq(await has(bob.id,'runner-watch'),true,'re-applied');eq((await send({alert:true})).status,'posted','works again');
console.log(`PASS ${checks} Runner Watch database assertions.`);
await db.close();
