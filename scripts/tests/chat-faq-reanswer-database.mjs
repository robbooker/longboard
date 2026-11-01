// #344 FAQ re-answer database check on the full migration chain from the mobile fixture (synthetic in-memory
// data only). A re-answer never reaches the FAQ by itself: not while waiting, not after a rejection, and on an
// approved question the public answer stays until the new one is approved. The rollback restores what was
// there. Usage: node scripts/tests/chat-faq-reanswer-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-faq-reanswer-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m)=>{await assert.rejects(p,re,m);checks++;};
const [,bobP]=people;
const guest=await one('insert into longboard_chat_guests(display_name,token_hash) values($1,$2) returning id',[bobP.name,'c'.repeat(64)]);
const bob=await one('insert into longboard_chat_members(user_id,display_name,id) values($1,$2,$3) on conflict(user_id) do update set display_name=excluded.display_name returning id',[bobP.id,bobP.name,guest.id]);
const suggest=async(text)=>{await db.query(`update chat_faq_suggestions set created_at=created_at-interval '2 days'`);return (await one('select public.post_chat_faq_suggestion($1,$2) r',[bob.id,text])).r.suggestionId;};
const review=async(id,action,who='Rob',text={})=>(await one('select public.review_chat_faq_suggestion($1,$2,$3,$4,$5,$6,$7) r',[id,action,who,`ref-${who}`,text.question??null,text.topic??null,text.answer??null])).r;
const reanswer=async(id,answer,note=null,who='Liz')=>(await one('select public.reanswer_chat_faq_suggestion($1,$2,$3,$4,$5,$6) r',[id,who,`ref-${who}`,note,'New Topic',answer])).r;
const row=(id)=>one('select status,ai_status,ai_topic,ai_answer,reanswer_pending from chat_faq_suggestions where id=$1',[id]);
const item=(id)=>one('select question,topic,answer,position from chat_faq_items where suggestion_id=$1',[id]);
const itemCount=async()=>(await one('select count(*)::int n from chat_faq_items')).n;
const events=async(id)=>(await db.query('select action,actor_name,note,answer from chat_faq_suggestion_events where suggestion_id=$1 order by created_at,id',[id])).rows;
const upBefore=await readFile(`${root}supabase/migrations/20261031100000_chat_faq_review.sql`,'utf8');
const up=await readFile(`${root}supabase/migrations/20261101100000_chat_faq_reanswer.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/20261101100000_chat_faq_reanswer.down.sql`,'utf8');
const START=await itemCount();
const text={question:'How do I pin?',topic:'Pinning',answer:'Published answer'};

// 1. Waiting: the new answer replaces the draft, publishes nothing, and history keeps who and why.
const waiting=await suggest('How do I pin a DM?');
await db.query(`update chat_faq_suggestions set ai_status='ready',ai_topic='Old',ai_answer='Old answer' where id=$1`,[waiting]);
eq(await reanswer(waiting,'Second answer'),{outcome:'reanswered',status:'pending',reanswerPending:false},'no note');
eq(await row(waiting),{status:'pending',ai_status:'ready',ai_topic:'New Topic',ai_answer:'Second answer',reanswer_pending:false});
await reanswer(waiting,'Third answer','  Use the ••• menu  ');
eq((await row(waiting)).ai_answer,'Third answer','replaces again');
eq((await events(waiting)).map((e)=>[e.action,e.note]),[['submitted',null],['reanswered',null],['reanswered','Use the ••• menu']]);
eq(await itemCount(),START,'nothing public');

// 2. A late first draft can't overwrite a re-answer (the drafter's own filter).
eq((await db.query(`update chat_faq_suggestions set ai_answer='late' where id=$1 and status='pending' and ai_status='pending' returning id`,[waiting])).rows,[],'late draft does nothing');

// 3. Approving it publishes what the admin sent, once, as before.
eq((await review(waiting,'approve','Rob',text)).outcome,'approved');
eq((await item(waiting)).answer,'Published answer');
eq(await itemCount(),START+1);
const position=(await item(waiting)).position;

// 4. Approved: re-answering leaves the public answer exactly as it is, and it waits for review.
const before=await item(waiting);
eq(await reanswer(waiting,'Better answer','It changed'),{outcome:'reanswered',status:'approved',reanswerPending:true});
eq(await item(waiting),before,'public answer untouched');
eq(await row(waiting),{status:'approved',ai_status:'ready',ai_topic:'New Topic',ai_answer:'Better answer',reanswer_pending:true});
eq(await itemCount(),START+1,'no second item');

// 5. Discarding it keeps the public answer and the approval.
eq(await review(waiting,'reject','Liz'),{outcome:'discarded',status:'approved'});
eq(await item(waiting),before,'public answer still untouched');
eq((await row(waiting)).reanswer_pending,false);
eq((await row(waiting)).status,'approved');
const repeat=await review(waiting,'reject','Liz');
eq([repeat.outcome,repeat.status,repeat.by],['already','approved','Rob'],'a repeat changes nothing, and names the approver');

// 6. Approving a new answer updates the same item, in place, with history. A repeat changes nothing.
await reanswer(waiting,'Better answer');
const better={question:'How do I pin a chat?',topic:'Pinning',answer:'Better, edited'};
eq((await review(waiting,'approve','Rob',better)).outcome,'approved');
eq(await item(waiting),{...better,position},'updated in place');
eq(await itemCount(),START+1);
eq((await row(waiting)).reanswer_pending,false);
eq((await review(waiting,'approve','Liz',{...better,answer:'A stale form'})).outcome,'already','double click');
eq((await item(waiting)).answer,'Better, edited');
eq((await events(waiting)).at(-1).action,'approved');

// 7. An approved question whose item an admin removed comes back only when the new answer is approved.
await db.query('delete from chat_faq_items where suggestion_id=$1',[waiting]);
await reanswer(waiting,'Back again');
eq(await item(waiting),undefined,'still not public');
eq((await review(waiting,'approve','Rob',{...better,answer:'Back again'})).outcome,'approved');
eq((await item(waiting)).answer,'Back again');

// 8. Rejected: a re-answer puts it back in the queue and publishes nothing; it must still be approved.
const refused=await suggest('Please reject me');
await review(refused,'reject','Rob');
const count=await itemCount();
eq(await reanswer(refused,'A second chance'),{outcome:'reanswered',status:'pending',reanswerPending:false});
eq((await row(refused)).status,'pending');
eq(await itemCount(),count,'nothing public');
eq((await review(refused,'approve','Rob',{question:'Q',topic:'T',answer:'A second chance'})).outcome,'approved');
eq(await itemCount(),count+1);

// 9. Refusals: bad input, unknown id, and only the service role can reach it.
for(const bad of [[waiting,' ','r',null,'T','A'],[waiting,'Rob',' ',null,'T','A'],[waiting,'Rob','r',null,' ','A'],[waiting,'Rob','r',null,'T',' '],[waiting,'Rob','r','x'.repeat(1001),'T','A']])
 await rejects(db.query('select public.reanswer_chat_faq_suggestion($1,$2,$3,$4,$5,$6)',bad),/invalid_faq_reanswer/,JSON.stringify(bad).slice(0,60));
await rejects(reanswer('99999999-9999-4999-8999-999999999999','A'),/faq_suggestion_not_found/);
for(const role of ['anon','authenticated'])eq((await one(`select has_function_privilege($1,'public.reanswer_chat_faq_suggestion(uuid,text,text,text,text,text)','execute') e`,[role])).e,false,`${role} can't re-answer`);
eq((await one(`select has_function_privilege('service_role','public.reanswer_chat_faq_suggestion(uuid,text,text,text,text,text)','execute') e`)).e,true);
await rejects(db.query(`update chat_faq_suggestion_events set note='x'`),/faq_history_is_append_only/,'history stays append-only');

// 10. The feed shows the flag and the note, and still nothing private.
await db.exec('set role service_role');
const rows=(await one('select public.chat_faq_suggestions_feed(1000) f')).f;
await db.exec('reset role');
const fed=rows.find((r)=>r.id===waiting);
eq(fed.reanswer_pending,false);
assert(fed.events.some((e)=>e.note==='It changed'));checks++;
assert(!JSON.stringify(rows).includes(bob.id)&&!JSON.stringify(rows).includes('ref-'),'no member id or actor ref');checks++;

// 11. Rollback: gone, and the old functions behave as before on the rows left behind.
await reanswer(waiting,'Waiting when rolled back');
await db.exec(down);
eq((await db.query(`select 1 from pg_proc where proname='reanswer_chat_faq_suggestion'`)).rows,[]);
eq((await db.query(`select 1 from information_schema.columns where table_name='chat_faq_suggestions' and column_name='reanswer_pending'`)).rows,[]);
eq((await db.query(`select 1 from information_schema.columns where table_name='chat_faq_suggestion_events' and column_name='note'`)).rows,[]);
eq((await db.query(`select 1 from chat_faq_suggestion_events where action in ('reanswered','discarded')`)).rows,[]);
await rejects(db.query(`update chat_faq_suggestion_events set actor_name='x'`),/faq_history_is_append_only/,'the trigger is back on');
eq((await item(waiting)).answer,'Back again','the FAQ keeps what was approved');
eq((await review(waiting,'approve','Liz',text)).outcome,'already','old review function');
await db.exec('set role service_role');
const old=(await one('select public.chat_faq_suggestions_feed(1) f')).f[0];
await db.exec('reset role');
eq(Object.keys(old).sort(),['ai_answer','ai_status','ai_topic','created_at','events','id','name','status','topic'],'old feed fields');
const original=upBefore.match(/create function public\.review_chat_faq_suggestion[\s\S]*?end \$\$;/)[0].replace('create function','create or replace function');
assert(down.includes(original),'rollback holds the previous review body');checks++;

// 12. Applying again after a rollback works.
await db.exec(up+'\n-- again');
eq((await row(waiting)).reanswer_pending,false);
console.log(`PASS ${checks} FAQ re-answer database assertions.`);
await db.close();
