// #338 FAQ review database check on the full migration chain from the mobile fixture (synthetic
// in-memory data only): a suggestion waits and never reaches the FAQ by itself; approve and reject
// write one history row each; repeats change nothing; the history can't be changed; a suggestion that
// existed before the migration is carried over; the rollback restores the previous function exactly.
// PGlite has a single connection, so "two admins at once" runs one after the other here. Usage:
// node scripts/tests/chat-faq-review-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-faq-review-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m)=>{await assert.rejects(p,re,m);checks++;};
const [aliceP,bobP]=people;
const guest=await one('insert into longboard_chat_guests(display_name,token_hash) values($1,$2) returning id',[bobP.name,'b'.repeat(64)]);
const bob=await one('insert into longboard_chat_members(user_id,display_name,id) values($1,$2,$3) on conflict(user_id) do update set display_name=excluded.display_name returning id',[bobP.id,bobP.name,guest.id]);
const suggest=async(text)=>{await db.query(`update chat_faq_suggestions set created_at=created_at-interval '2 days'`);return (await one('select public.post_chat_faq_suggestion($1,$2) r',[bob.id,text])).r;};
const review=async(id,action,who='Rob',text={})=>(await one('select public.review_chat_faq_suggestion($1,$2,$3,$4,$5,$6,$7) r',[id,action,who,`ref-${who}`,text.question??null,text.topic??null,text.answer??null])).r;
const items=()=>db.query('select question,topic,answer,position,suggestion_id,created_by from chat_faq_items order by position');
const events=async(id)=>(await db.query('select action,actor_name,actor_ref,question,topic,answer from chat_faq_suggestion_events where suggestion_id=$1 order by created_at,action desc',[id])).rows;
const status=async(id)=>(await one('select status from chat_faq_suggestions where id=$1',[id])).status;
const START=(await items()).rows.length;
eq(START,2,'the two starter items');
eq((await items()).rows.map((r)=>r.topic),[null,null],'existing items have no topic');

// 1. A suggestion waits, with its submitted event, and is not a FAQ item.
const first=await suggest('  How do  margin\ncalls work? ');
assert(first.suggestionId&&first.messageId&&first.posted);checks++;
eq(await status(first.suggestionId),'pending');
eq((await one('select ai_status from chat_faq_suggestions where id=$1',[first.suggestionId])).ai_status,'pending','the draft is on its way');
eq(await events(first.suggestionId),[{action:'submitted',actor_name:bobP.name,actor_ref:bob.id,question:null,topic:null,answer:null}]);
eq((await items()).rows.length,START,'nothing posted by submitting');

// 2. A draft arriving posts nothing either.
await db.query(`update chat_faq_suggestions set ai_status='ready',ai_topic='Margin',ai_answer='AI draft' where id=$1`,[first.suggestionId]);
eq((await items()).rows.length,START,'nothing posted by the AI');

// 3. Approving needs a question, topic and answer, and refuses without changing anything.
for(const bad of [{topic:'T',answer:'A'},{question:'Q',answer:'A'},{question:'Q',topic:'T'},{question:' ',topic:'T',answer:'A'},{question:'Q',topic:' ',answer:'A'},{question:'Q',topic:'T',answer:' '},{question:'q'.repeat(201),topic:'T',answer:'A'},{question:'Q',topic:'t'.repeat(61),answer:'A'},{question:'Q',topic:'T',answer:'a'.repeat(5001)}])
 await rejects(review(first.suggestionId,'approve','Rob',bad),/invalid_faq_review/,JSON.stringify(bad).slice(0,60));
await rejects(review(first.suggestionId,'publish'),/invalid_faq_review/,'unknown action');
await rejects(review(first.suggestionId,'reject',' '),/invalid_faq_review/,'nobody acting');
await rejects(review('99999999-9999-4999-8999-999999999999','reject'),/faq_suggestion_not_found/,'unknown suggestion');
eq(await status(first.suggestionId),'pending');
eq((await events(first.suggestionId)).length,1,'no history from a refusal');

// 4. Approve publishes the edited text, at the end, with who did it.
const edited={question:'How do margin calls work?',topic:'Margin Calls',answer:'Edited\nanswer'};
const done=await review(first.suggestionId,'approve','Rob',edited);
eq(done.outcome,'approved');
const posted=(await items()).rows;
eq(posted.length,START+1);
const item=posted[START];
eq([item.question,item.topic,item.answer,item.suggestion_id,item.created_by],[edited.question,edited.topic,edited.answer,first.suggestionId,null]);
assert(item.position>posted[START-1].position);checks++;
eq(await status(first.suggestionId),'approved');
eq((await events(first.suggestionId)).map((e)=>[e.action,e.actor_name,e.actor_ref,e.question,e.topic,e.answer]),[['submitted',bobP.name,bob.id,null,null,null],['approved','Rob','ref-Rob',edited.question,edited.topic,edited.answer]]);

// 5. A double click or a second admin changes nothing and says who acted.
for(const [action,who] of [['approve','Rob'],['approve','Liz'],['reject','Liz']]){
 const again=await review(first.suggestionId,action,who,edited);
 eq([again.outcome,again.status,again.by],['already','approved','Rob'],`${action} by ${who}`);
 assert(again.at);checks++;
}
eq((await items()).rows.length,START+1,'still one item');
eq((await events(first.suggestionId)).length,2,'still one approval in the history');
// The last guard, should the status check ever be bypassed.
await rejects(db.query(`insert into chat_faq_items(question,answer,suggestion_id) values('Q','A',$1)`,[first.suggestionId]),/unique|duplicate/,'one item per suggestion');

// 6. Reject: never on the FAQ, stays in the history, and can't be approved afterwards.
const second=await suggest('Please reject me');
eq((await review(second.suggestionId,'reject','Liz')).outcome,'rejected');
eq(await status(second.suggestionId),'rejected');
const blocked=await review(second.suggestionId,'approve','Rob',edited);
eq([blocked.outcome,blocked.status,blocked.by],['already','rejected','Liz']);
eq((await items()).rows.length,START+1,'nothing posted');
eq((await events(second.suggestionId)).map((e)=>[e.action,e.actor_name]),[['submitted',bobP.name],['rejected','Liz']]);

// 7. A late AI draft can't touch a decided suggestion's status; the route also filters on pending.
eq((await db.query(`update chat_faq_suggestions set ai_status='ready' where id=$1 and status='pending' and ai_status='pending' returning id`,[second.suggestionId])).rows,[],'late draft does nothing');

// 8. The history can't be changed, by the app's role or by anyone.
const asService=async(fn)=>{await db.exec('set role service_role');try{return await fn();}finally{await db.exec('reset role');}};
await rejects(asService(()=>db.query(`update chat_faq_suggestion_events set actor_name='x'`)),/permission denied/,'service role cannot update');
await rejects(asService(()=>db.query(`delete from chat_faq_suggestion_events`)),/permission denied/,'service role cannot delete');
await rejects(db.query(`update chat_faq_suggestion_events set actor_name='x' where action='rejected'`),/faq_history_is_append_only/,'owner cannot update');
await rejects(db.query(`delete from chat_faq_suggestion_events where action='rejected'`),/faq_history_is_append_only/,'owner cannot delete');
await rejects(db.query(`delete from chat_faq_suggestions where id=$1`,[second.suggestionId]),/foreign key|append_only/,'a suggestion with history stays');

// 9. Only the service role can reach it; the app's role can do what it needs.
for(const role of ['anon','authenticated']){
 eq((await one(`select has_function_privilege($1,'public.review_chat_faq_suggestion(uuid,text,text,text,text,text,text)','execute') e`,[role])).e,false,`${role} can't review`);
 eq((await one(`select has_table_privilege($1,'chat_faq_suggestion_events','select') s`,[role])).s,false,`${role} can't read the history`);
}
const third=await asService(async()=>(await one('select public.post_chat_faq_suggestion($1,$2) r',[bob.id,'As the service role'])).r).catch(async()=>{await db.query(`update chat_faq_suggestions set created_at=created_at-interval '2 days'`);return asService(async()=>(await one('select public.post_chat_faq_suggestion($1,$2) r',[bob.id,'As the service role'])).r);});
await asService(()=>db.query(`update chat_faq_suggestions set ai_status='failed' where id=$1`,[third.suggestionId]));
eq((await asService(()=>review(third.suggestionId,'approve','Rob',edited))).outcome,'approved','service role approves');
eq((await asService(()=>db.query(`select e.action,s.status from chat_faq_suggestions s join chat_faq_suggestion_events e on e.suggestion_id=s.id where s.id=$1 order by e.created_at`,[third.suggestionId]))).rows.length,2,'and reads it back');
await db.query(`delete from chat_faq_items where suggestion_id=$1`,[third.suggestionId]);
eq(await status(third.suggestionId),'approved','deleting the FAQ item keeps the history');

// 9b. The feed: newest first, names and history, nothing private; and a gone member keeps a history name.
const feed=async(n=1000)=>(await asService(()=>one('select public.chat_faq_suggestions_feed($1) f',[n]))).f;
const rows=await feed();
eq(rows.map((r)=>r.topic),['As the service role','Please reject me','How do margin calls work?'],'newest first');
eq(rows[2].name,bobP.name);
eq(rows[2].status,'approved');
eq(rows[2].events.map((e)=>[e.action,e.actor_name]),[['submitted',bobP.name],['approved','Rob']]);
eq(rows[2].events[1].answer,edited.answer);
eq(Object.keys(rows[1]).sort(),['ai_answer','ai_status','ai_topic','created_at','events','id','name','reanswer_pending','status','topic'],'only these fields');
assert(!JSON.stringify(rows).includes(bob.id)&&!JSON.stringify(rows).includes('ref-'),'no member id or actor ref');checks++;
eq((await feed(1)).length,1,'the limit holds');
for(const role of ['anon','authenticated'])eq((await one(`select has_function_privilege($1,'public.chat_faq_suggestions_feed(integer)','execute') e`,[role])).e,false,`${role} can't read the feed`);
await db.query('update chat_faq_suggestions set suggested_by=null where id=$1',[second.suggestionId]);
const gone=(await feed()).find((r)=>r.id===second.suggestionId);
eq([gone.name,gone.events[0].actor_name],[null,bobP.name],'name gone from the row, kept in the history');

// 10. Rollback: gone, and post_chat_faq_suggestion back to the exact previous text.
const up=await readFile(`${root}supabase/migrations/20261031100000_chat_faq_review.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/20261031100000_chat_faq_review.down.sql`,'utf8');
const original=await readFile(`${root}supabase/migrations/20261030220000_chat_faq.sql`,'utf8');
const prior=original.match(/declare note_id uuid.*?end \$\$;/s)[0].replace(/end \$\$;$/,'');
assert(down.includes(prior.trim()),'rollback holds the previous body');checks++;
// #344's later migration comes off first; its own test covers it.
await db.exec(await readFile(`${root}supabase/rollbacks/20261101100000_chat_faq_reanswer.down.sql`,'utf8'));
await db.exec(down);
const src=(await one(`select prosrc from pg_proc where proname='post_chat_faq_suggestion'`)).prosrc;
eq(src.trim(),prior.trim()+'\nend','restored body');
eq((await one(`select to_regclass('public.chat_faq_suggestion_events') t`)).t,null);
eq((await db.query(`select 1 from pg_proc where proname in ('review_chat_faq_suggestion','chat_faq_suggestions_feed','chat_faq_suggestion_events_append_only')`)).rows,[]);
eq((await db.query(`select 1 from information_schema.columns where table_name='chat_faq_items' and column_name in ('topic','suggestion_id')`)).rows,[]);
eq((await db.query(`select 1 from information_schema.columns where table_name='chat_faq_suggestions' and column_name in ('status','ai_status','ai_topic','ai_answer')`)).rows,[]);
eq((await one(`select has_table_privilege('service_role','chat_faq_suggestions','update') u`)).u,false,'update grant gone');
eq((await db.query('select question from chat_faq_items where question=$1',[edited.question])).rows.length,1,'an approved question stays, plain');
await db.query(`update chat_faq_suggestions set created_at=created_at-interval '2 days'`);
const back=(await one('select public.post_chat_faq_suggestion($1,$2) r',[bob.id,'Back on the old function'])).r;
eq(Object.keys(back).sort(),['messageId','posted'],'the old return');

// 11. Re-applying carries over everything already there as pending, submitted by whoever sent it.
await db.exec(up+'\n-- again');
const carried=await one(`select s.status,s.ai_status,e.actor_name,e.action,e.created_at=s.created_at same_time from chat_faq_suggestions s join chat_faq_suggestion_events e on e.suggestion_id=s.id where s.message_id=$1`,[back.messageId]);
eq(carried,{status:'pending',ai_status:'none',actor_name:bobP.name,action:'submitted',same_time:true});
console.log(`PASS ${checks} FAQ review database assertions.`);
await db.close();
