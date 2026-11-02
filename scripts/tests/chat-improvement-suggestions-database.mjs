// #352 Suggest an Improvement, database check on the full migration chain from the mobile fixture
// (synthetic in-memory data only): the table's locks, the post to Admins naming the member from the
// members table, no mentions, no read access for a member, the rate limit, the bot confined to the
// room, and the rollback keeping posted messages readable and re-applying cleanly.
// Usage: node scripts/tests/chat-improvement-suggestions-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-improve-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m)=>{await assert.rejects(p,re,m);checks++;};
const member=async(person,tail)=>{const guest=await one('insert into longboard_chat_guests(display_name,token_hash) values($1,$2) returning id',[person.name,tail.repeat(64)]);return one('insert into longboard_chat_members(user_id,display_name,id) values($1,$2,$3) on conflict(user_id) do update set display_name=excluded.display_name returning id,user_id,display_name',[person.id,person.name,guest.id]);};
const [aliceP,bobP]=people;
const alice=await member(aliceP,'a'),bob=await member(bobP,'b');
const suggest=(by,text)=>one('select public.post_chat_improvement_suggestion($1,$2) r',[by,text]);
const HEADER=(name)=>`${name} suggested a chat improvement from the Suggest an Improvement button in What's New: `;

// 1. The table and function: service role only.
eq((await one(`select relrowsecurity r from pg_class where oid='chat_improvement_suggestions'::regclass`)).r,true,'RLS');
eq((await db.query(`select 1 from pg_policies where tablename='chat_improvement_suggestions'`)).rows,[],'no policies');
for(const role of ['anon','authenticated']){
 eq((await one(`select has_table_privilege($1,'chat_improvement_suggestions','select') s`,[role])).s,false,`${role} can't read`);
 eq((await one(`select has_function_privilege($1,'public.post_chat_improvement_suggestion(uuid,text)','execute') e`,[role])).e,false,`${role} can't post`);
}

// 2. A member's words reach Admins exactly, named from the members table, with the database's time.
const WORDS="Add <b>bold</b> for @Alice @admins\nsecond line https://example.com";
const posted=await suggest(bob.id,`  ${WORDS}\n`);
const row=await one(`select room_slug,author_label,body,bot_slug,member_id,guest_id,reply_to_id,created_at>now()-interval '1 minute' fresh from longboard_chat_messages where id=$1`,[posted.r.messageId]);
eq(row,{room_slug:'admins',author_label:'Chat Improvements',body:HEADER(bob.display_name)+WORDS,bot_slug:'chat-improvements',member_id:null,guest_id:null,reply_to_id:null,fresh:true});
eq((await db.query(`select 1 from chat_room_mentions where message_id=$1`,[posted.r.messageId])).rows,[],'raises no mentions');
eq((await db.query(`select 1 from longboard_chat_messages where bot_slug='chat-improvements' and room_slug<>'admins'`)).rows,[],'in no other room');
eq((await db.query(`select 1 from chat_faq_suggestions`)).rows,[],'not on the FAQ review queue');

// 3. Direct reads through the policy: an admin sees it; the member who sent it does not.
const as=async(role,person,fn)=>{await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[person?.id||'']);try{return await fn();}finally{await db.exec('reset role');}};
const visible=(person)=>as('authenticated',person,async()=>(await db.query(`select id from longboard_chat_messages where room_slug='admins'`)).rows.length);
eq(await visible(aliceP),1,'admin reads');
eq(await visible(bobP),0,'the sender reads nothing');
eq((await one(`select public.chat_account_has_room($1,'admins') ok`,[bob.user_id])).ok,false,'sending gave no access');

// 4. The longest name and text fit the room's message limit.
await db.query(`update longboard_chat_members set display_name=$1 where id=$2`,['N'.repeat(28),alice.id]);
await suggest(alice.id,'y'.repeat(450));checks++;

// 5. The bot is confined to the room; the other Admins bot still works.
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('social','Chat Improvements','x','chat-improvements')`),/actor_check/,'not in other rooms');
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('whats-new','Chat Improvements','x','chat-improvements')`),/actor_check|announcement_admin_only/,'not in What\'s New');
await db.query(`select public.post_chat_faq_suggestion($1,'A FAQ topic')`,[bob.id]);checks++;

// 6. Rate limit: 1 a minute, 5 a day, per member; bad input and unknown members refused.
const count=async()=>(await one(`select count(*)::int n from longboard_chat_messages where bot_slug='chat-improvements'`)).n;
const start=await count();
await rejects(suggest(bob.id,'too soon'),/improvement_suggestion_rate_limited/,'one a minute');
eq(await count(),start,'the refused one posted nothing');
const age=()=>db.query(`update chat_improvement_suggestions set created_at=created_at-interval '2 minutes'`);
for(let i=2;i<=5;i++){await age();await suggest(bob.id,`idea ${i}`);}
await age();await rejects(suggest(bob.id,'sixth'),/improvement_suggestion_rate_limited/,'five a day');
await db.query(`update chat_improvement_suggestions set created_at=created_at-interval '2 days'`);
await suggest(bob.id,'next day');checks++;
await rejects(suggest(bob.id,' \n '),/invalid_improvement_suggestion/,'empty');
await rejects(suggest(bob.id,'x'.repeat(451)),/invalid_improvement_suggestion/,'too long');
await rejects(suggest('99999999-9999-4999-8999-999999999999','x'),/member_required/,'unknown member');

// 7. Rollback: the function and table go, the messages stay readable, the old rule is back.
const up=await readFile(`${root}supabase/migrations/20261102180000_chat_improvement_suggestions.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/20261102180000_chat_improvement_suggestions.down.sql`,'utf8');
const before=(await one(`select count(*)::int n from longboard_chat_messages where room_slug='admins'`)).n;
await db.exec(down);
eq((await one(`select to_regclass('public.chat_improvement_suggestions') t`)).t,null,'table gone');
eq((await db.query(`select 1 from pg_proc where proname='post_chat_improvement_suggestion'`)).rows,[],'function gone');
eq((await one(`select count(*)::int n from longboard_chat_messages where room_slug='admins'`)).n,before,'messages kept');
eq((await one(`select body from longboard_chat_messages where id=$1`,[posted.r.messageId])).body,HEADER(bob.display_name)+WORDS,'words kept');
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('admins','x','x','chat-improvements')`),/actor_check/,'old rule back');

// 8. And it applies again.
// (The fixture's exec skips a file it has already run, so this one differs by a comment.)
await db.exec(`${up}\n-- again`);
await suggest(bob.id,'after re-applying');checks++;
console.log(`PASS chat-improvement-suggestions-database (${checks} checks)`);
process.exit(0);
