// #371 Gainers Table database check on the full migration chain from the mobile fixture (synthetic
// data): the seed, which alerts make a row (the 150K rule, no after-hours, that Eastern day only),
// newest first, how a lookup's result is saved (a known value is never replaced by an empty one),
// that members can't read the facts directly, and the rollback then the migration re-applying.
// #376: and Interactive Brokers' rows (an older file never replaces a newer one), with their rollback.
// Usage: node scripts/tests/chat-gainers-table-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-gainers-table-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db;try{({db}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const up=await readFile(`${root}supabase/migrations/20261107120000_chat_gainers_facts.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/20261107120000_chat_gainers_facts.down.sql`,'utf8');

// The seed: every saved country, and nothing else yet.
eq((await one('select count(*)::int n from chat_gainers_facts')).n,331,'331 seeded');
eq(await one(`select country,cash_checked_at,inst_own_checked_at from chat_gainers_facts where ticker='AEHL'`),{country:'China',cash_checked_at:null,inst_own_checked_at:null},'country only');

// Alerts, through the live feed's own function. Eastern day 2026-11-06 runs 04:00Z to 05:00Z next day (EST).
let source_id=1;
const alert=(at,body)=>db.query(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source_id++,at,body]);
const body=(sym,vol,extra='')=>`🚨 ${sym} (+42.5%)\nPrice: $2.50\nVolume: ${vol.toLocaleString('en-US')}\nMarket Cap: 12.5M${extra}`;
await alert('2026-11-06T13:00:00Z',body('AEHL',90000));
await alert('2026-11-06T14:00:00Z',body('AEHL',400000));
await alert('2026-11-06T15:30:00Z',body('AEHL',120000)); // a later small alert still counts as the latest
await alert('2026-11-06T14:30:00Z',body('NEWT',200000));
await alert('2026-11-06T14:40:00Z',body('SMAL',149999)); // never reaches 150K
await alert('2026-11-06T21:30:00Z',body('LATE',9000000,'\nAfter-Hours')); // after hours
await alert('2026-11-06T22:00:00Z',body('NEWT',900000,'\nAfter-Hours')); // after hours, not the latest
await alert('2026-11-07T06:00:00Z',body('NEXT',500000)); // the next Eastern day
await alert('2026-11-06T03:59:00Z',body('PREV',500000)); // the day before, in Eastern time
await alert('2026-11-06T16:00:00Z',body('BRK.B',300000));
await alert('2026-11-06T16:01:00Z','No ticker here\nVolume: 900,000');
const table=async()=>(await db.query(`select ticker,last_alert_at,alerts,country,cash_usd,not_found from chat_gainers_table('2026-11-06')`)).rows;
let rows=await table();
eq(rows.map(r=>r.ticker),['BRK.B','AEHL','NEWT'],'150K stocks, newest alert first, that day, no after-hours');
eq(rows[1].last_alert_at.toISOString(),'2026-11-06T15:30:00.000Z','latest alert');
eq(rows[1].alerts,3,'alert count');
eq(rows[1].country,'China','seeded country joined');
eq(rows[2].country,null,'unknown ticker: no facts');

// Saving a lookup.
const save=(t,c,cash,months,pos,inst,nf=false)=>db.query('select public.save_chat_gainers_facts($1,$2,$3,$4,$5,$6,$7)',[t,c,cash,months,pos,inst,nf]);
await save('NEWT','U.S.',31500000,304.7,false,12.5);
let f=await one(`select * from chat_gainers_facts where ticker='NEWT'`);
eq([f.country,Number(f.cash_usd),Number(f.cash_months_left),f.cash_flow_positive,Number(f.inst_own_pct),f.not_found],['U.S.',31500000,304.7,false,12.5,false],'saved');
assert(f.cash_checked_at&&f.inst_own_checked_at&&f.country_checked_at);checks++;
await save('NEWT','Canada',null,null,false,null);
f=await one(`select * from chat_gainers_facts where ticker='NEWT'`);
eq([f.country,Number(f.cash_usd),Number(f.cash_months_left),Number(f.inst_own_pct)],['U.S.',31500000,304.7,12.5],'country kept; empty never replaces');
await save('NEWT','U.S.',2000000,null,true,13);
f=await one(`select * from chat_gainers_facts where ticker='NEWT'`);
eq([Number(f.cash_usd),f.cash_months_left,f.cash_flow_positive,Number(f.inst_own_pct)],[2000000,null,true,13],'cash flow positive replaces cash, no months');
await save('AEHL','Japan',31500000,304.7,false,0.1);
f=await one(`select * from chat_gainers_facts where ticker='AEHL'`);
eq([f.country,f.country_checked_at.toISOString()],['China','2026-11-05T12:00:00.000Z'],'seeded country and its date kept');
await save('ZZZQ',null,null,null,null,null,true);
eq((await one(`select not_found,country from chat_gainers_facts where ticker='ZZZQ'`)),{not_found:true,country:null},'not found noted');
await save('NEWT',null,null,null,null,null,true);
eq((await one(`select not_found,country from chat_gainers_facts where ticker='NEWT'`)),{not_found:false,country:'U.S.'},'not found never hides known facts');
await assert.rejects(save('bad ticker','x',1,1,false,1),/check/);checks++;
await assert.rejects(save('NEWT','x',-5,1,false,1),/check/);checks++;

// #376: Interactive Brokers' rows: saved per ticker, an older file never replaces a newer one.
const ibUp=await readFile(`${root}supabase/migrations/20261108140000_chat_gainers_ib.sql`,'utf8');
const ibDown=await readFile(`${root}supabase/rollbacks/20261108140000_chat_gainers_ib.down.sql`,'utf8');
const ibSave=(at,rows)=>db.query(`select public.save_chat_gainers_ib($1::timestamptz,$2::jsonb) n`,[at,JSON.stringify(rows)]);
const ibRead=async tickers=>(await db.query(`select ticker,fee_pct::float8 fee,available::float8 avail,available_more more,file_time from chat_gainers_ib_for($1::text[])`,[tickers])).rows;
eq((await ibSave('2026-11-06T14:42:10Z',[{ticker:'AEHL',fee_pct:1390.3435,rebate_pct:-1386.4635,available:70000,available_more:false},{ticker:'NEWT',fee_pct:0.25,rebate_pct:3.63,available:10000000,available_more:true},{ticker:'GONE',fee_pct:null,rebate_pct:null,available:0,available_more:false}])).rows[0].n,3,'three saved');
eq((await ibRead(['AEHL','NEWT','GONE','NONE'])).map(r=>[r.ticker,r.fee,r.avail,r.more]),[['AEHL',1390.3435,70000,false],['GONE',null,0,false],['NEWT',0.25,10000000,true]],'read back by ticker');
eq((await ibSave('2026-11-06T14:27:10Z',[{ticker:'AEHL',fee_pct:5,rebate_pct:1,available:5,available_more:false}])).rows[0].n,0,'an older file changes nothing');
eq((await ibRead(['AEHL']))[0].fee,1390.3435,'newer row kept');
await ibSave('2026-11-06T14:57:10Z',[{ticker:'AEHL',fee_pct:1124.1943,rebate_pct:-1120,available:50000,available_more:false}]);
eq((await ibRead(['AEHL'])).map(r=>[r.fee,r.avail,r.file_time.toISOString()]),[[1124.1943,50000,'2026-11-06T14:57:10.000Z']],'a newer file replaces');
await assert.rejects(ibSave('2026-11-06T15:00:00Z',[{ticker:'bad',available:1}]),/check/);checks++;
await assert.rejects(ibSave('2026-11-06T15:00:00Z',[{ticker:'AEHL',available:-1}]),/check/);checks++;
await assert.rejects(ibSave('2026-11-06T15:00:00Z',[{ticker:'AEHL',available:null,available_more:true}]),/check/);checks++;
await assert.rejects(ibSave('2026-11-06T15:00:00Z',{ticker:'AEHL'}),/bad rows/);checks++;

// Members never read the table or call the functions themselves.
await db.exec(`set role authenticated`);
await assert.rejects(db.query('select * from chat_gainers_ib'),/permission denied/);checks++;
await assert.rejects(ibRead(['AEHL']),/permission denied/);checks++;
await assert.rejects(ibSave('2026-11-06T15:00:00Z',[]),/permission denied/);checks++;
await assert.rejects(db.query('select * from chat_gainers_facts'),/permission denied/);checks++;
await assert.rejects(db.query(`select * from chat_gainers_table('2026-11-06')`),/permission denied/);checks++;
await assert.rejects(save('NEWT','x',1,1,false,1),/permission denied/);checks++;
await db.exec(`reset role`);

// Rollback, then the migration again.
await db.exec(ibDown);
eq((await one(`select to_regclass('public.chat_gainers_ib') r`)).r,null,'IB rolled back');
await db.exec(ibUp+"\n-- again");
eq((await one('select count(*)::int n from chat_gainers_ib')).n,0,'IB re-applies');
await db.exec(down);
eq((await one(`select to_regclass('public.chat_gainers_facts') r`)).r,null,'rolled back');
await db.exec(up+"\n-- again");
eq((await one('select count(*)::int n from chat_gainers_facts')).n,331,'re-applies');
console.log(`chat-gainers-table database: ${checks} checks passed`);
process.exit(0);
