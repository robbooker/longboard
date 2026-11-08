// #387 DilutionTracker press releases: database check on the full migration chain from the mobile
// fixture (synthetic data). Saving a read stores each release once (by DilutionTracker's id),
// marks the ticker read for that Eastern day only, forgets releases past 45 days; the feed's read
// returns the asked-for tickers newest first; members can't touch either table or the functions;
// the rollback and the migration re-applying.
// Usage: node scripts/tests/chat-gainers-news-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-gainers-news-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db;try{({db}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const up=await readFile(`${root}supabase/migrations/20261108180000_chat_gainers_news.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/20261108180000_chat_gainers_news.down.sql`,'utf8');
const hoursAgo=h=>new Date(Date.now()-h*3_600_000).toISOString();
const item=(key,h,title=`Release ${key}`,source='ACCESS Newswire')=>({key:`dt:${key}`,published_at:hoursAgo(h),source,title,url:`https://dilution.news/${key}`});
const save=(day,ticker,items)=>db.query(`select public.save_chat_gainers_news($1::date,$2,$3::jsonb) n`,[day,ticker,JSON.stringify(items)]);
const checked=async day=>(await db.query(`select ticker from chat_gainers_news_checked($1::date)`,[day])).rows.map(r=>r.ticker);
const feed=async(tickers,sinceH=24*30)=>(await db.query(`select ticker,item_key,source,title from chat_gainers_news_for($1::text[],$2::timestamptz)`,[tickers,hoursAgo(sinceH)])).rows;

eq(await checked('2026-11-09'),[],'nothing read yet');
eq((await save('2026-11-09','SMX',[item('a1',2),item('a2',30),item('a3',24*60)])).rows[0].n,3,'three saved');
eq(await checked('2026-11-09'),['SMX'],'SMX read today');
eq(await checked('2026-11-10'),[],'the next day starts fresh');
eq((await one(`select count(*)::int n from chat_gainers_news where ticker='SMX'`)).n,2,'past 45 days forgotten');
// The same release read again changes nothing new; a renamed headline is updated in place.
await save('2026-11-09','SMX',[item('a1',2,'Release a1 (updated)')]);
eq((await feed(['SMX'])).map(r=>[r.item_key,r.title]),[['dt:a1','Release a1 (updated)'],['dt:a2','Release a2']],'once each, newest first');
// A read with no releases still marks the day.
eq((await save('2026-11-09','NONE',[])).rows[0].n,0,'empty read');
eq(await checked('2026-11-09'),['NONE','SMX'],'empty read counts');
eq((await one(`select items from chat_gainers_news_checks where day='2026-11-09' and ticker='NONE'`)).items,0,'0 items noted');
await save('2026-11-09','AEHL',[item('b1',5,'Antelope news','GlobeNewswire')]);
eq((await feed(['SMX','AEHL'])).map(r=>[r.ticker,r.item_key,r.source]),[['SMX','dt:a1','ACCESS Newswire'],['AEHL','dt:b1','GlobeNewswire'],['SMX','dt:a2','ACCESS Newswire']],'across tickers, newest first');
eq((await feed(['AEHL'])).length,1,'only the asked-for tickers');
eq((await feed(['SMX'],10)).map(r=>r.item_key),['dt:a1'],'since a time');
await assert.rejects(save('2026-11-09','bad ticker',[]),/check/);checks++;
await assert.rejects(save('2026-11-09','SMX',[{...item('c1',1),url:'javascript:alert(1)'}]),/check/);checks++;
await assert.rejects(save('2026-11-09','SMX',[{...item('c2',1),title:''}]),/check/);checks++;

// Members never read the tables or call the functions themselves.
await db.exec(`set role authenticated`);
await assert.rejects(db.query('select * from chat_gainers_news'),/permission denied/);checks++;
await assert.rejects(db.query('select * from chat_gainers_news_checks'),/permission denied/);checks++;
await assert.rejects(feed(['SMX']),/permission denied/);checks++;
await assert.rejects(checked('2026-11-09'),/permission denied/);checks++;
await assert.rejects(save('2026-11-09','SMX',[]),/permission denied/);checks++;
await db.exec(`reset role`);

// Rollback, then the migration again.
await db.exec(down);
eq((await one(`select to_regclass('public.chat_gainers_news') a,to_regclass('public.chat_gainers_news_checks') b`)),{a:null,b:null},'rolled back');
await db.exec(up+"\n-- again");
eq((await one('select count(*)::int n from chat_gainers_news')).n,0,'re-applies');
console.log(`chat-gainers-news database: ${checks} checks passed`);
process.exit(0);
