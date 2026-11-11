// #436 Latest press release under a stock's first Gainers alert: database check on the full migration
// chain from the mobile fixture (synthetic data). post_chat_gainers_alert_news puts the newest saved
// DilutionTracker release under the stock's first alert of the Eastern day (the first with 150,000
// shares or more), once per stock per day: retries, repeated reads, later alerts and calls racing
// each other never post twice (the (day, ticker) key and the one-per-alert key guard it). Nothing is
// posted with no release, a newest release more than 3 days old, or a first alert more than 30
// minutes old. Members can't touch the table or the function. Then the rollback and the migration
// re-applying.
// Usage: node scripts/tests/chat-gainers-alert-news-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-gainers-alert-news-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db;try{({db}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const up=await readFile(`${root}supabase/migrations/20261111120000_chat_gainers_alert_news.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/20261111120000_chat_gainers_alert_news.down.sql`,'utf8');

// Today's Eastern day, as the route works it out, and alerts minutes before now.
const day=(await one(`select (now() at time zone 'America/New_York')::date::text d`)).d;
const sinceMidnight=(await one(`select extract(epoch from (now() at time zone 'America/New_York')-((now() at time zone 'America/New_York')::date))::int s`)).s;
assert(sinceMidnight>50*60,'run this more than 50 minutes after Eastern midnight (the alerts below are up to 45 minutes old)');
const minutesAgo=m=>new Date(Date.now()-m*60000).toISOString();
let sourceId=1;
const body=(sym,volume)=>`🚨 ${sym} (+52.60%) 🕒 Pre-Market\n💵 Price: $4.76\n📊 Volume: ${volume}\n🏦 Market Cap: 18.4M · Float: 3.2M`;
const ingest=async(sym,minutes,volume='1,234,567')=>(await one(`select ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3) r`,[sourceId++,minutesAgo(minutes),body(sym,volume)])).r.messageId;
const item=(key,minutes,title=`Release ${key}`,source='ACCESS Newswire')=>({key:`dt:${key}`,published_at:minutesAgo(minutes),source,title,url:`https://dilution.news/${key}`});
const save=(ticker,items)=>db.query(`select public.save_chat_gainers_news($1::date,$2,$3::jsonb)`,[day,ticker,JSON.stringify(items)]);
const post=async(ticker,d=day)=>(await one(`select public.post_chat_gainers_alert_news($1::date,$2) r`,[d,ticker])).r;
const rows=async()=>(await db.query(`select ticker,alert_message_id,item_key,title,source,url from chat_gainers_alert_news order by ticker`)).rows;

// FRSH: a small alert first (under 150,000 shares: not on the Gainers Table), then the alert that
// put it there, then a later one. The headline goes under the 150,000-share alert.
const small=await ingest('FRSH',20,'40,000');
const frsh=await ingest('FRSH',10);
await save('FRSH',[item('f2',25,'Freshcorp Announces Clearance'),item('f1',60*24*2,'Older release','GlobeNewswire')]);
eq(await post('FRSH'),{posted:true,alertMessageId:frsh},'posted under the first 150,000-share alert');
assert.notEqual(frsh,small);checks++;
eq(await rows(),[{ticker:'FRSH',alert_message_id:frsh,item_key:'dt:f2',title:'Freshcorp Announces Clearance',source:'ACCESS Newswire',url:'https://dilution.news/f2'}],'the newest release');
// A retry and a repeated read post nothing; a later alert and a newer release don't either.
eq(await post('FRSH'),{posted:false,reason:'duplicate',alertMessageId:frsh},'a retry');
await ingest('FRSH',2);
await save('FRSH',[item('f3',1,'Even newer')]);
eq((await post('FRSH')).reason,'duplicate','second alert, newer release: still once');
eq((await rows()).length,1,'one row');
// Two calls at once (a retry overlapping the first): one posts. Separate connections can't be
// raced in this in-process database, so the guard itself is checked: a second row for the same
// stock and day, or for the same alert, is refused.
await assert.rejects(db.query(`insert into chat_gainers_alert_news(day,ticker,alert_message_id,item_key,published_at,title,url) values($1,'FRSH',$2,'dt:x',now(),'x','https://dilution.news/x')`,[day,await ingest('FRSH',1)]),/duplicate key|unique/);checks++;
await assert.rejects(db.query(`insert into chat_gainers_alert_news(day,ticker,alert_message_id,item_key,published_at,title,url) values($1::date-1,'FRSH',$2,'dt:x',now(),'x','https://dilution.news/x')`,[day,frsh]),/duplicate key|unique/);checks++;

// STAL: newest release 4 days old. NONE: a read with no releases. NOPE: never read.
await ingest('STAL',8);await save('STAL',[item('s1',60*24*4)]);
eq(await post('STAL'),{posted:false,reason:'stale'},'more than 3 days old');
await ingest('NONE',8);await save('NONE',[]);
eq(await post('NONE'),{posted:false,reason:'no_news'},'no releases');
await ingest('NOPE',8);
eq(await post('NOPE'),{posted:false,reason:'no_news'},'never read');
// EDGE: a release just under 3 days old still counts.
await ingest('EDGE',8);await save('EDGE',[item('e1',60*24*3-5)]);
eq((await post('EDGE')).posted,true,'just under 3 days');
// LATE: the first alert is 45 minutes old when the (retried) read arrives.
await ingest('LATE',45);await save('LATE',[item('l1',5)]);
eq(await post('LATE'),{posted:false,reason:'too_late'},'first alert more than 30 minutes old');
// A stock that only had small alerts, a ticker with no alert, another day, a bad ticker.
await ingest('TINY',5,'90,000');await save('TINY',[item('t1',5)]);
eq(await post('TINY'),{posted:false,reason:'no_alert'},'never 150,000 shares');
eq(await post('GHST'),{posted:false,reason:'no_alert'},'no alert at all');
eq((await one(`select public.post_chat_gainers_alert_news(($1::date-1),'FRSH') r`,[day])).r,{posted:false,reason:'no_alert'},'yesterday had no FRSH alert');
await assert.rejects(post('bad ticker'),/invalid_alert_news/);checks++;
eq((await rows()).map(r=>r.ticker),['EDGE','FRSH'],'only FRSH and EDGE got a headline');
// The room got no new message: the Gainers room's own guard still refuses anything but alerts.
eq((await one(`select count(*)::int n from longboard_chat_messages where room_slug='gainers' and bot_slug<>'gainers'`)).n,0,'no extra posts in the room');

// Members never read the table or call the function.
await db.exec(`set role authenticated`);
await assert.rejects(db.query('select * from chat_gainers_alert_news'),/permission denied/);checks++;
await assert.rejects(post('FRSH'),/permission denied/);checks++;
await db.exec(`reset role`);
await db.exec(`set role anon`);
await assert.rejects(post('FRSH'),/permission denied/);checks++;
await db.exec(`reset role`);

// Rollback, then the migration again.
await db.exec(down);
eq(await one(`select to_regclass('public.chat_gainers_alert_news') a`),{a:null},'rolled back');
await db.exec(up+"\n-- again");
eq((await one('select count(*)::int n from chat_gainers_alert_news')).n,0,'re-applies');
console.log(`chat-gainers-alert-news database: ${checks} checks passed`);
process.exit(0);
