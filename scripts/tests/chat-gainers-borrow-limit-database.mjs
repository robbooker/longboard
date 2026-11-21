// #480 Gainers Table: TradeZero's daily quote limit ('limit' borrow status), on the full migration chain
// from the mobile fixture (synthetic data). A 'limit' answer is saved for a ticker with no row yet or
// over an error row, never over a real result; a real result later replaces it; the old statuses save
// exactly as before; the status checks refuse odd 'limit' rows; the function keeps its settings and
// grants; and the rollback (a 'limit' row becomes an error row) then the migration re-applying.
// Usage: node scripts/tests/chat-gainers-borrow-limit-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-gainers-borrow-limit-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db;try{({db}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const refuses=async(sql,args,m)=>{await assert.rejects(db.query(sql,args),m);checks++;};
const up=await readFile(`${root}supabase/migrations/20261121120000_chat_gainers_borrow_limit.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/20261121120000_chat_gainers_borrow_limit.down.sql`,'utf8');
const DAY='2026-11-06';
const save=(ticker,status,etb=null,price=null,type=null)=>db.query(`select public.save_chat_gainers_borrow($1::date,$2,$3,$4,$5,$6)`,[DAY,ticker,status,etb,price,type]);
const row=(ticker)=>one(`select status,etb,price_per_share::float8 price,locate_type,checked_at is not null checked from public.chat_gainers_borrow_day($1::date) where ticker=$2`,[DAY,ticker]);
const acl=async()=>one(`select p.proacl::text acl,p.proconfig::text cfg,p.prosecdef def from pg_proc p where p.oid='public.save_chat_gainers_borrow(date,text,text,boolean,numeric,text)'::regprocedure`);
const before=await acl();
eq(before.cfg,'{"search_path=\\"\\""}','search_path empty');
eq(before.def,false,'security invoker');

// A new ticker after the limit: saved as 'limit', with a checked time (it's an answer, not an error).
await save('LIMA','limit');
eq(await row('LIMA'),{status:'limit',etb:null,price:null,locate_type:null,checked:true},'limit saved');
// Its quote was refused after easy to borrow said no: etb false is kept.
await save('LIMB','limit',false);
eq(await row('LIMB'),{status:'limit',etb:false,price:null,locate_type:null,checked:true},'limit with etb false');
// An error row for the day becomes 'limit'.
await save('ERRA','error',false);
eq(await row('ERRA'),{status:'error',etb:false,price:null,locate_type:null,checked:false},'error saved as before');
await save('ERRA','limit',false);
eq((await row('ERRA')).status,'limit','an error row becomes limit');
// A real result is never replaced by 'limit'.
await save('OFFA','offered',false,0.04,'Locate');
await save('OFFA','limit');
eq(await row('OFFA'),{status:'offered',etb:false,price:0.04,locate_type:'Locate',checked:true},'offered kept');
await save('ETBA','etb',true);
await save('ETBA','limit');
eq((await row('ETBA')).status,'etb','etb kept');
await save('NONA','none',false);
await save('NONA','limit');
eq((await row('NONA')).status,'none','none kept');
// A real result later replaces 'limit'; an error never does.
await save('LIMA','error');
eq((await row('LIMA')).status,'limit','an error keeps limit');
await save('LIMA','offered',false,0.12,'PreBorrow');
eq(await row('LIMA'),{status:'offered',etb:false,price:0.12,locate_type:'PreBorrow',checked:true},'a real result replaces limit');
// Odd 'limit' rows are refused by the table itself.
await refuses(`insert into public.chat_gainers_borrow(day,ticker,status,etb,price_per_share,locate_type,checked_at) values($1,'BADA','limit',false,0.04,'Locate',now())`,[DAY],/check/i,'limit with a price');
await refuses(`insert into public.chat_gainers_borrow(day,ticker,status,etb,checked_at) values($1,'BADB','limit',true,now())`,[DAY],/check/i,'limit with etb true');
await refuses(`insert into public.chat_gainers_borrow(day,ticker,status,checked_at) values($1,'BADC','maybe',now())`,[DAY],/check/i,'unknown status');
eq(await acl(),before,'same settings and grants');

// Rollback: 'limit' rows become error rows; the four old statuses only; the old function.
await db.exec(down);
eq(await row('LIMB'),{status:'error',etb:false,price:null,locate_type:null,checked:false},'limit rolled back to error');
eq((await row('OFFA')).status,'offered','real results untouched');
await refuses(`select public.save_chat_gainers_borrow($1::date,'NEWA','limit',null,null,null)`,[DAY],/check/i,'no limit after rollback');
eq(await acl(),before,'rollback keeps settings and grants');
await db.exec(up+"\n-- again");
await save('NEWA','limit');
eq((await row('NEWA')).status,'limit','re-applies');
console.log(`chat-gainers-borrow-limit database: ${checks} checks passed`);
process.exit(0);
