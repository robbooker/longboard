// #482 AI Insights database check on the full migration chain from the mobile fixture (synthetic data):
// who has the room (the SS members and admins), who may start a post (the AI and admins) and who may
// reply (every member who has it), the AI's one write-up and one SS note a day, answers at most once
// per reply with the daily limits, and the rollback restoring every function to its exact previous body,
// then the migration re-applying cleanly.
// Usage: node scripts/tests/chat-ai-insights-database.mjs
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,unlink,readdir} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-ai-insights-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m)=>{await assert.rejects(p,re,m);checks++;};
const has=async(account,room)=>(await one('select public.chat_account_has_room($1,$2) ok',[account,room])).ok;
const eligible=async(account,room)=>(await one('select public.chat_account_room_recipient_eligible($1,$2) ok',[account,room])).ok;
const NAME='20261121130000_chat_ai_insights';
const up=await readFile(`${root}supabase/migrations/${NAME}.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/${NAME}.down.sql`,'utf8');
const [alice,bob]=people;
const scout=(await one(`select m.user_id account,m.id member from longboard_chat_members m where m.display_name='Scout Tester'`));
assert(scout,'the fixture has a ShortScout mastermind member');

// The room: SS members and admins, nobody else.
eq((await one(`select count(*)::int n from longboard_chat_room_state where room_slug='ai-insights' and id=15`)).n,1,'room row');
eq(await has(scout.account,'ai-insights'),true,'SS member has it');eq(await has(scout.account,'shortscout'),true,'and SS');
eq(await has(alice.id,'ai-insights'),true,'admin has it');
eq(await has(bob.id,'ai-insights'),false,'LB member without SS does not');eq(await has(bob.id,'shortscout'),false,'(nor SS)');
eq(await has('99999999-9999-4999-8999-999999999999','ai-insights'),false,'unknown account');
eq([await eligible(scout.account,'ai-insights'),await eligible(bob.id,'ai-insights'),await eligible(alice.id,'ai-insights')],[true,false,true],'recipients: the same people');
const allRooms=['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','lb-review','club','runner-watch','admins','ai-insights','not-a-room'];
const compare=async()=>one(`select count(*)::int accounts,count(*) filter (where by_room is distinct from by_list)::int mismatched,
 count(*) filter (where 'ai-insights'=any(by_list))::int readers,
 count(*) filter (where ('ai-insights'=any(by_list)) is distinct from ('shortscout'=any(by_list)))::int differ
 from (select a.id,array(select r from unnest($1::text[]) r where public.chat_account_has_room(a.id,r)) by_room,
  public.chat_account_rooms(a.id,$1::text[]) by_list from public.chat_accounts a) checked`,[allRooms]);
let cmp=await compare();
eq([cmp.mismatched,cmp.differ],[0,0],`chat_account_rooms agrees with chat_account_has_room, and AI Insights goes with SS (${cmp.accounts} accounts)`);
assert(cmp.readers>=2,'some readers');checks++;
eq((await one(`select public.longboard_chat_room_member_count($1,'ai-insights')::int n`,[scout.account])).n>=2,true,'member count works');
await rejects(db.query(`select public.longboard_chat_room_member_count($1,'ai-insights')`,[bob.id]),/room_access_required/,'member count refuses outsiders');

// Tables: RLS on, no policies, service role only. Functions: service role only.
for(const table of ['chat_ai_insights_days','chat_ai_insights_answers']){
 eq((await one(`select relrowsecurity r from pg_class where oid=$1::regclass`,[table])).r,true,`${table} RLS`);
 eq((await db.query(`select 1 from pg_policies where tablename=$1`,[table])).rows,[],`${table} no policies`);
 for(const role of ['anon','authenticated'])for(const right of ['select','insert','update','delete'])eq((await one(`select has_table_privilege($1,$2,$3) s`,[role,table,right])).s,false,`${table} ${role} ${right}`);
 eq((await one(`select has_table_privilege('service_role',$1,'delete') s`,[table])).s,false,`${table} no delete`);
}
for(const fn of ['public.post_chat_ai_insights_writeup(date,text,integer,text)','public.post_chat_ai_insights_note(date,text)','public.claim_chat_ai_insights_answer(uuid,integer,integer)','public.post_chat_ai_insights_answer(uuid,text)','public.fail_chat_ai_insights_answer(uuid)']){
 for(const role of ['anon','authenticated'])eq((await one(`select has_function_privilege($1,$2,'execute') e`,[role,fn])).e,false,`${role} can't run ${fn}`);
 eq((await one(`select has_function_privilege('service_role',$1,'execute') e`,[fn])).e,true,`service role runs ${fn}`);
}

// The AI's bot_slug: only in AI Insights and SS, and only rows the functions wrote.
const bot=(room,extra='')=>db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug${extra?','+extra.split('=')[0]:''}) values($1,'AI Insights','probe','ai-insights'${extra?','+extra.split('=')[1]:''}) returning id`,[room]);
for(const room of ['main','social','gainers','developers','lb-review','runner-watch','admins','whats-new','club'])await rejects(bot(room),/./,`the AI can't write in ${room}`);
for(const room of ['ai-insights','shortscout'])await rejects(bot(room),/ai_insights_read_only/,`no stray AI posts in ${room}`);
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug,guest_id,member_id) values('ai-insights','AI Insights','x','ai-insights',$1,$1)`,[scout.member]),/actor_check|ai_insights_read_only/,'the AI is never a member');

// The write-up: once per day.
const day='2026-11-20';
const writeup=async(d=day,body='**AI Insights · Friday, Nov 20**\nA test write-up.')=>(await one(`select public.post_chat_ai_insights_writeup($1,$2,42,'claude-opus-5-5') r`,[d,body])).r;
const note=async(d=day,body='Today\'s AI Insights are ready 👉 AI Insights: https://x.test/chat?room=ai-insights')=>(await one(`select public.post_chat_ai_insights_note($1,$2) r`,[d,body])).r;
eq((await note()).status,'no_writeup','no note without a write-up');
eq((await one(`select count(*)::int n from longboard_chat_messages where room_slug='shortscout' and bot_slug='ai-insights'`)).n,0,'nothing in SS');
let w=await writeup();eq(w.status,'posted','write-up posts');
const post=await one(`select * from longboard_chat_messages where id=$1`,[w.messageId]);
eq([post.room_slug,post.author_label,post.bot_slug,post.member_id,post.reply_to_id],['ai-insights','AI Insights','ai-insights',null,null],'as the AI, a new post');
eq((await writeup()).status,'duplicate','a second run the same day');
eq((await writeup(day,'different words')).messageId,w.messageId,'still the first post');
eq(new Set((await Promise.all([writeup('2026-11-19'),writeup('2026-11-19')])).map(r=>r.status)),new Set(['posted','duplicate']),'two at once post once');
eq((await one(`select count(*)::int n from longboard_chat_messages where bot_slug='ai-insights' and room_slug='ai-insights'`)).n,2,'one post per day');
eq((await one(`select message_count,model from chat_ai_insights_days where day=$1`,[day])),{message_count:42,model:'claude-opus-5-5'},'recorded');
await rejects(db.query(`select public.post_chat_ai_insights_writeup($1,'  ',1,'m')`,['2026-11-18']),/invalid_ai_insights_post/,'empty body');

// The note in SS: after the write-up, once.
let n=await note();eq(n.status,'posted','note posts');
eq((await one(`select room_slug,author_label,reply_to_id from longboard_chat_messages where id=$1`,[n.messageId])),{room_slug:'shortscout',author_label:'AI Insights',reply_to_id:null},'in SS, as the AI');
eq((await note()).status,'duplicate','one note a day');
eq((await one(`select note_message_id from chat_ai_insights_days where day=$1`,[day])).note_message_id,n.messageId,'recorded with the day');
eq((await one(`select count(*)::int n from longboard_chat_messages where room_slug='shortscout' and bot_slug='ai-insights'`)).n,1,'one note in SS');
// Members' rules in SS are unchanged: they still post there, Bob still can't.
await db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'shortscout','Scout Tester','still my room')`,[scout.member]);checks++;
await rejects(db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'shortscout','Bob','not mine')`,[bob.member.id]),/chat_room_forbidden/,'Bob still not in SS');

// Members reply, never start a post. Admins start posts. Agents never.
const say=(member,label,body,reply=null,room='ai-insights')=>db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,$2,$3,$4,$5) returning *`,[member,room,label,body,reply]).then(r=>r.rows[0]);
await rejects(say(scout.member,'Scout Tester','a new post'),/ai_insights_read_only/,'a member can\'t start a post');
// The send function's rate limit counts recent posts: move them back a minute first.
const cool=()=>db.query(`update longboard_chat_messages set created_at=created_at-interval '1 minute' where guest_id=$1`,[scout.member]);
await cool();
await rejects(db.query(`select public.send_chat_room_message($1,'ai-insights','a new post',null,'{}',$2)`,[scout.account,randomUUID()]),/ai_insights_read_only/,'not through the send function either');
await cool();
const sent=(await one(`select public.send_chat_room_message($1,'ai-insights','What was the SSR price?',$2,'{}',$3) r`,[scout.account,w.messageId,randomUUID()])).r;
eq(sent.status,'sent','a member replies through the send function');
const q1=sent.message;eq(q1.reply_to_id,w.messageId,'under the write-up');
const adminPost=await say(alice.member.id,'Alice','An admin note');eq(adminPost.reply_to_id,null,'an admin starts a post');checks++;
await rejects(say(bob.member.id,'Bob','not in the room',w.messageId),/chat_room_forbidden/,'no access, no reply');
await rejects(db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,agent_id) select $1,$1,'ai-insights','Scout Tester','agent',id from chat_agents limit 1`,[scout.member]).then(r=>{if(!r.rowCount)throw Error('ai_insights_read_only (no agent row)');}),/ai_insights_read_only|agent/,'agents never post');
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('ai-insights','Runner Risk Watch','x','runner-watch')`),/./,'other bots never');
// Reactions: members react to the write-up.
await db.query(`insert into longboard_chat_reactions(message_id,guest_id,active) values($1,$2,true)`,[w.messageId,scout.member]);checks++;
// The AI's posts never change; an admin can still delete one.
await rejects(db.query(`update longboard_chat_messages set body='changed' where id=$1`,[w.messageId]),/ai_insights_read_only/,'write-up never changes');
await rejects(db.query(`update longboard_chat_messages set room_slug='social' where id=$1`,[q1.id]),/ai_insights_read_only|immutable/,'rows never move out');
await rejects(db.query(`update longboard_chat_messages set room_slug='ai-insights',reply_to_id=null where id=(select id from longboard_chat_messages where room_slug='shortscout' and bot_slug is null limit 1)`),/ai_insights_read_only|immutable/,'rows never move in');
// A member edits their own reply.
eq((await one(`select public.change_chat_message($1,$2,'ai-insights','edit','What was the SSR price on ANT?',$3) r`,[scout.account,q1.id,q1.body])).r.body,'What was the SSR price on ANT?','a member edits their reply');

// Answers: at most once per reply, as a reply in the same thread.
const claim=async(id,mc=20,rc=200)=>(await one(`select public.claim_chat_ai_insights_answer($1,$2,$3) r`,[id,mc,rc])).r;
const answer=async(id,body='The SSR line was $87.30.')=>(await one(`select public.post_chat_ai_insights_answer($1,$2) r`,[id,body])).r;
let c=await claim(q1.id);eq([c.status,c.rootId],['answer',w.messageId],'claimed');
eq((await claim(q1.id)).status,'duplicate','claimed once');
let a=await answer(q1.id);eq(a.status,'posted','answer posted');
const reply=await one(`select * from longboard_chat_messages where id=$1`,[a.messageId]);
eq([reply.reply_to_id,reply.answered_id,reply.author_label,reply.bot_slug],[w.messageId,q1.id,'AI Insights','ai-insights'],'in the same thread, answering that reply');
eq((await answer(q1.id)).status,'not_pending','answered once');
eq((await one(`select category from chat_room_mentions where message_id=$1 and account_id=$2`,[a.messageId,scout.account]))?.category,'reply','the member gets a reply alert');
eq((await claim(a.messageId)).status,'not_eligible','never answers itself');
eq((await claim(w.messageId)).status,'not_eligible','not the write-up');
eq((await claim(adminPost.id)).status,'not_eligible','not a new post');
eq((await claim(randomUUID())).status,'not_eligible','unknown message');
// A claimed answer that fails stays answered-once.
const q2=await say(scout.member,'Scout Tester','Another question',w.messageId);
eq((await claim(q2.id)).status,'answer','claimed');await db.query('select public.fail_chat_ai_insights_answer($1)',[q2.id]);
eq([(await claim(q2.id)).status,(await answer(q2.id)).status],['duplicate','not_pending'],'a failed one is not tried again');
// A deleted reply gets no answer.
const q3=await say(scout.member,'Scout Tester','Deleted soon',w.messageId);eq((await claim(q3.id)).status,'answer','claimed');
await db.query(`select public.change_chat_message($1,$2,'ai-insights','delete') r`,[scout.account,q3.id]);
eq((await answer(q3.id)).status,'trigger_gone','its reply was deleted');
// Limits: per member per day (one limit note, then nothing) and per room per day.
await db.exec('delete from chat_ai_insights_answers');
const ask=async()=> (await say(scout.member,'Scout Tester',`q ${randomUUID()}`,w.messageId)).id;
const outcomes=[];for(let i=0;i<5;i++)outcomes.push((await claim(await ask(),2,200)).status);
eq(outcomes,['answer','answer','limit_note','capped','capped'],'two answers, one limit note, then quiet');
const limitId=(await one(`select trigger_message_id from chat_ai_insights_answers where kind='limit_note'`)).trigger_message_id;
eq((await answer(limitId,"That's my limit for today.")).status,'posted','the limit note posts');
const adminAsk=(await say(alice.member.id,'Alice','admin q',w.messageId)).id;
eq((await claim(adminAsk,2,200)).status,'answer','another member has their own limit');
eq((await claim(await ask(),20,4)).status,'room_capped','the room limit');
eq((await one(`select count(*)::int n from chat_ai_insights_answers where kind='skipped' and status='skipped'`)).n,3,'skips recorded');
// The day is New York's: a reply at 11 PM New York is that day, not the next UTC day.
const late=await say(scout.member,'Scout Tester','late q',w.messageId);
await db.query(`update longboard_chat_messages set created_at='2026-11-21 04:30:00+00' where id=$1`,[late.id]);
eq((await claim(late.id)).day,'2026-11-20','New York day');
// Concurrency: one reply claimed twice at once is claimed once.
const both=await ask();eq((await Promise.all([claim(both),claim(both)])).map(r=>r.status).sort(),['answer','duplicate'],'two at once');
await rejects(db.query(`select public.claim_chat_ai_insights_answer($1,0,200)`,[both]),/invalid_ai_insights_claim/,'limits checked');

// An admin can delete the AI's post (moderation), which the guard allows.
const deleted=(await one(`select public.change_chat_message($1,$2,'ai-insights','delete',null,null,true) r`,[alice.id,w.messageId])).r;
eq(deleted.deletedId,w.messageId,'admin deletes a write-up');
eq((await one(`select count(*)::int n from chat_ai_insights_days where day=$1`,[day])).n,1,'the day stays recorded, so it does not post again');
eq((await writeup()).status,'duplicate','still once per day');

// Every function the migration changes: only the room added, and the rollback is the previous body.
const names=[...up.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map(x=>x[1]);
eq(names,['chat_account_has_room','chat_account_room_recipient_eligible','chat_account_rooms','longboard_chat_room_member_count','longboard_chat_room_member_names','longboard_chat_room_members','longboard_chat_room_members_ordered','queue_chat_push'],'eight existing functions changed');
const body=(text,name)=>{const start=text.indexOf(`FUNCTION public.${name}(`);assert(start>=0,name);const open=text.indexOf('$function$',start),close=text.indexOf('$function$',open+10);assert(open>start&&close>open,`${name} body`);return text.slice(open,close);};
const earlier=(await readdir(`${root}supabase/migrations`)).filter(f=>f.endsWith('.sql')&&f<NAME).sort();
const chain={};for(const f of earlier)chain[f]=await readFile(`${root}supabase/migrations/${f}`,'utf8');
const previous=(name)=>{const f=earlier.filter(f=>new RegExp(`create or replace function public\\.${name}\\(`,'i').test(chain[f])).at(-1);assert(f,name);return body(chain[f],name);};
const norm=s=>s.replace(/\s+/g,' ').trim();
for(const name of names){
 eq(norm(body(up,name).replaceAll(`,'ai-insights'`,'')),norm(previous(name)),`migration only adds the room to ${name}`);
 eq(norm(body(down,name)),norm(previous(name)),`rollback body of ${name} is its previous definition`);
}
const actorDef=async()=>(await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname='longboard_chat_messages_actor_check'`)).d;
for(const kept of [`'club'::text`,`'chat-improvements'::text`,`'runner-watch'::text`,`'longboard'::text`])assert((await actorDef()).includes(kept),`actor check keeps ${kept}`),checks++;

// Rollback, then the migration again.
const fnText=async(sig)=>(await one(`select pg_get_functiondef($1::regprocedure) d`,[sig])).d;
await db.exec(down);
for(const t of ['chat_ai_insights_days','chat_ai_insights_answers'])eq((await one(`select to_regclass($1) t`,['public.'+t])).t,null,`${t} gone`);
for(const fn of ['post_chat_ai_insights_writeup','post_chat_ai_insights_note','claim_chat_ai_insights_answer','post_chat_ai_insights_answer','fail_chat_ai_insights_answer','enforce_chat_ai_insights_post'])eq((await db.query(`select 1 from pg_proc where proname=$1`,[fn])).rows,[],`${fn} gone`);
eq((await db.query(`select 1 from longboard_chat_room_state where room_slug='ai-insights'`)).rows,[],'room gone');
eq((await db.query(`select 1 from longboard_chat_messages where room_slug='ai-insights' or bot_slug='ai-insights'`)).rows,[],'every AI post gone, the SS note too');
eq((await one(`select count(*)::int n from longboard_chat_messages where room_slug='shortscout' and body='still my room'`)).n,1,'members\' SS posts stay');
eq([await has(scout.account,'ai-insights'),await has(scout.account,'shortscout')],[false,true],'nobody has it; SS stays');
await rejects(db.query(`insert into longboard_chat_room_state(id,room_slug) values(15,'ai-insights')`),/room_slug_check/,'constraint restored');
await rejects(bot('shortscout'),/actor_check/,'actor check restored');
assert(!(await one(`select qual from pg_policies where policyname='members read chat messages'`)).qual.includes('ai-insights'),'policy restored');checks++;
assert(!(await fnText('public.chat_account_rooms(uuid,text[])')).includes('ai-insights'),'chat_account_rooms restored');checks++;
cmp=await compare();eq([cmp.mismatched,cmp.readers],[0,0],'after the rollback the two rules still agree, and nobody has AI Insights');
await db.exec(up+'\n-- again (the fixture runs a migration-sized text once)');
eq(await has(scout.account,'ai-insights'),true,'the migration applies again');
eq((await writeup()).status,'posted','and posts again');
console.log(`chat-ai-insights-database: ${checks} checks passed`);
process.exit(0);
