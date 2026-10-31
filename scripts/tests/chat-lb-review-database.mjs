// #340 LB Review database check on the full migration chain from the mobile fixture (synthetic data):
// who has the room, the bot's limit, the daily pages table, member-visible reads, and the rollback
// restoring every function to its exact previous body, then the migration re-applying cleanly.
// Usage: node scripts/tests/chat-lb-review-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-lb-review-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m)=>{await assert.rejects(p,re,m);checks++;};
const has=async(account,room)=>(await one('select public.chat_account_has_room($1,$2) ok',[account,room])).ok;
const eligible=async(account,room)=>(await one('select public.chat_account_room_recipient_eligible($1,$2) ok',[account,room])).ok;
const [alice,bob]=people;
const up=await readFile(`${root}supabase/migrations/20261031120000_chat_lb_review.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/20261031120000_chat_lb_review.down.sql`,'utf8');

// The room: every member, not an unknown account.
eq(await has(bob.id,'lb-review'),true,'member has it');eq(await eligible(bob.id,'lb-review'),true,'member can be tagged');
eq(await has(alice.id,'lb-review'),true,'admin has it');
const ghost='99999999-9999-4999-8999-999999999999';eq(await has(ghost,'lb-review'),false,'unknown account');
eq(await has(bob.id,'admins'),false,'other rooms keep their rules');
eq((await one(`select count(*)::int n from longboard_chat_room_state where room_slug='lb-review' and id=12`)).n,1,'room row');

// A member's message goes in, and search and embeddings treat it as a conversation room.
const m=await one('select id from longboard_chat_members where user_id=$1',[bob.id]);
const msg=await one(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'lb-review','Bob','Reviewing the gainers tonight') returning id`,[m.id]);
eq((await one('select count(*)::int n from longboard_chat_embeddings where message_id=$1',[msg.id])).n,1,'queued for search');
eq((await db.query(`select id from public.search_longboard_chat('gainers','lb-review')`)).rows.map(r=>r.id),[msg.id],'keyword search');

// The bot: this room only, however it's asked.
const botId='00000000-0000-4000-8000-0000000000bb';
await db.query('insert into auth.users(id) values($1)',[botId]);
await db.query(`insert into profiles(id,email,role) values($1,'b@bot.longboard.invalid','user')`,[botId]);
await db.query('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[botId]);
await db.query(`insert into chat_bot_accounts(account_id,allowed_rooms) values($1,array['lb-review'])`,[botId]);
eq(await has(botId,'lb-review'),true,'bot has its room');
for(const room of ['main','social','shortscout','gainers','developers','whats-new','admins','lb-announcements'])eq(await has(botId,room),false,`bot has no ${room}`);

// The pages table: RLS on, no policies, service role only, one row per day.
eq((await one(`select relrowsecurity r from pg_class where oid='chat_gainers_pages'::regclass`)).r,true,'RLS');
eq((await db.query(`select 1 from pg_policies where tablename='chat_gainers_pages'`)).rows,[],'no policies');
for(const role of ['anon','authenticated'])for(const right of ['select','insert','update'])eq((await one(`select has_table_privilege($1,'chat_gainers_pages',$2) s`,[role,right])).s,false,`${role} ${right}`);
for(const right of ['select','insert','update'])eq((await one(`select has_table_privilege('service_role','chat_gainers_pages',$1) s`,[right])).s,true,`service_role ${right}`);
eq((await one(`select has_table_privilege('service_role','chat_gainers_pages','delete') s`)).s,false,'no delete');
for(const role of ['anon','authenticated'])eq((await one(`select has_function_privilege($1,'public.chat_gainers_day_bounds(date)','execute') e`,[role])).e,false,`${role} bounds`);
await rejects(db.query(`insert into chat_gainers_pages(trading_day,data) values('2026-10-30','[]')`),/check/,'data must be an object');
const put=(n)=>db.query(`insert into chat_gainers_pages(trading_day,data) values('2026-10-30',$1) on conflict(trading_day) do update set data=excluded.data`,[JSON.stringify({n})]);
await put(1);await put(2);
eq((await db.query('select data from chat_gainers_pages')).rows,[{data:{n:2}}],'a rerun replaces');
// Eastern day bounds, across a clock change.
const iso=(v)=>new Date(v).toISOString();
const b1=(await one(`select public.chat_gainers_day_bounds('2026-10-30') b`)).b;eq([iso(b1.start),iso(b1.finish)],['2026-10-30T04:00:00.000Z','2026-10-31T04:00:00.000Z'],'summer day');
const b2=(await one(`select public.chat_gainers_day_bounds('2026-11-01') b`)).b;eq([iso(b2.start),iso(b2.finish)],['2026-11-01T04:00:00.000Z','2026-11-02T05:00:00.000Z'],'25-hour day');

// Rollback: every function exactly as the migration chain had it before, room and table gone.
const names=[...up.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map(x=>x[1]);
eq(names.length,11,'eleven functions changed');
const body=(text,name)=>{const start=text.indexOf(`FUNCTION public.${name}(`);assert(start>=0,name);const open=text.indexOf('$function$',start),close=text.indexOf('$function$',open+10);return text.slice(open,close);};
const faq=await readFile(`${root}supabase/migrations/20261030220000_chat_faq.sql`,'utf8');
for(const name of names){
 eq(body(down,name),body(faq,name),`rollback body of ${name} is its previous definition`);
 eq(body(up,name).replaceAll(`'developers','lb-review'`,`'developers'`),body(faq,name),`migration only adds the room to ${name}`);
}
await db.exec('delete from chat_bot_accounts where account_id=\''+botId+'\'');
await db.exec(await readFile(`${root}supabase/rollbacks/20261031150000_chat_runner_watch.down.sql`,'utf8'));
await db.exec(down);
eq((await one(`select to_regclass('public.chat_gainers_pages') t`)).t,null,'table gone');
eq((await db.query(`select 1 from pg_proc where proname='chat_gainers_day_bounds'`)).rows,[],'function gone');
eq((await db.query(`select 1 from longboard_chat_room_state where room_slug='lb-review'`)).rows,[],'room gone');
eq((await db.query(`select 1 from longboard_chat_messages where room_slug='lb-review'`)).rows,[],'messages gone');
eq(await has(bob.id,'lb-review'),false,'nobody has it');eq(await has(bob.id,'developers'),true,'Developers stays');
assert(!(await one(`select qual from pg_policies where policyname='members read chat messages'`)).qual.includes('lb-review'),'policy restored');checks++;
await rejects(db.query(`insert into longboard_chat_room_state(id,room_slug) values(12,'lb-review')`),/room_slug_check/,'constraint restored');

// And it applies again.
await db.exec(up+'\n-- again');
eq(await has(bob.id,'lb-review'),true,'re-applied');
console.log(`PASS ${checks} LB Review database assertions.`);
await db.close();
