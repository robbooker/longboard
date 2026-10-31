// #332 FAQ and Admins room database check on the full migration chain from the mobile fixture
// (synthetic in-memory data only): the seed; RLS and grants; the room's access rule for admins,
// members and bots, including one with 'admins' on its list; the read policy; member lists; a
// suggestion from a non-admin reaching the room; the rate limit; the bot's room limit; the rollback
// restoring every function to the exact body of its previous migration, and the migration
// re-applying cleanly.
// Usage: node scripts/tests/chat-faq-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-faq-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m)=>{await assert.rejects(p,re,m);checks++;};
const member=async(person,tail)=>{const guest=await one('insert into longboard_chat_guests(display_name,token_hash) values($1,$2) returning id',[person.name,tail.repeat(64)]);return one('insert into longboard_chat_members(user_id,display_name,id) values($1,$2,$3) on conflict(user_id) do update set display_name=excluded.display_name returning id,user_id,display_name',[person.id,person.name,guest.id]);};
const [aliceP,bobP]=people;
const alice=await member(aliceP,'a'),bob=await member(bobP,'b');
const has=async(account,room)=>(await one('select public.chat_account_has_room($1,$2) ok',[account,room])).ok;
const eligible=async(account,room)=>(await one('select public.chat_account_room_recipient_eligible($1,$2) ok',[account,room])).ok;
const suggest=(by,topic)=>one('select public.post_chat_faq_suggestion($1,$2) r',[by,topic]);

// 1. The seed.
const seeded=(await db.query('select question,answer from chat_faq_items order by position')).rows;
eq(seeded.map(r=>r.question),['How do I get the chat on my phone?','How do I turn on phone notifications?']);
for(const row of seeded)for(const word of ['iPhone','Android'])assert(row.answer.includes(word),`${row.question}: ${word}`),checks++;

// 2. Tables: RLS on, no policies, nothing for anon or authenticated.
for(const table of ['chat_faq_items','chat_faq_suggestions']){
 eq((await one('select relrowsecurity r from pg_class where oid=$1::regclass',[table])).r,true,`${table} RLS`);
 eq((await db.query('select 1 from pg_policies where tablename=$1',[table])).rows,[],`${table} no policies`);
 for(const role of ['anon','authenticated'])eq((await one(`select has_table_privilege($1,$2,'select') s`,[role,table])).s,false,`${role} ${table}`);
}
// The Marketing HQ feed reads suggestions and member names with the service role.
for(const table of ['chat_faq_suggestions','longboard_chat_members'])eq((await one(`select has_table_privilege('service_role',$1,'select') s`,[table])).s,true,`service_role reads ${table}`);
eq((await one(`select count(*)::int n from pg_constraint where contype='f' and conrelid='chat_faq_suggestions'::regclass and confrelid='longboard_chat_members'::regclass`)).n,1,'one link from a suggestion to its member, so the feed\'s join is not ambiguous');
for(const role of ['anon','authenticated'])eq((await one(`select has_function_privilege($1,'public.post_chat_faq_suggestion(uuid,text)','execute') e`,[role])).e,false,`${role} can't post a suggestion`);

// 3. Who has the room: admins only.
const roleOf=async(id)=>(await one('select role from profiles where id=$1',[id]))?.role;
await db.query(`insert into chat_accounts(id,longboard_user_id) values($1,$1),($2,$2) on conflict do nothing`,[aliceP.id,bobP.id]).catch(()=>{});
await db.query(`update profiles set role='admin' where id=$1`,[aliceP.id]);
await db.query(`update profiles set role='user' where id=$1`,[bobP.id]);
eq(await roleOf(aliceP.id),'admin');
eq(await has(aliceP.id,'admins'),true,'admin has the room');
eq(await eligible(aliceP.id,'admins'),true,'admin can be tagged');
eq(await has(bobP.id,'admins'),false,'member does not');
eq(await eligible(bobP.id,'admins'),false,'member cannot be tagged');
eq(await has(bobP.id,'social'),true,'other rooms keep their rules');
eq(await has(aliceP.id,'developers'),true);
const ghost='99999999-9999-4999-8999-999999999999';
eq(await has(ghost,'admins'),false,'unknown account');
await rejects(db.query(`select * from public.longboard_chat_room_members($1,'admins')`,[bobP.id]),/room_access_required/,'member list');
await rejects(db.query(`select public.longboard_chat_room_member_count($1,'admins')`,[bobP.id]),/room_access_required/,'member count');
await rejects(db.query(`select * from public.longboard_chat_room_member_names($1,'admins',array[]::uuid[])`,[bobP.id]),/room_access_required/,'member names');
await rejects(db.query(`select * from public.longboard_chat_room_members_ordered($1,'admins')`,[bobP.id]),/room_access_required/,'ordered member list');
const listed=(await db.query(`select id from public.longboard_chat_room_members($1,'admins')`,[aliceP.id])).rows.map(r=>r.id);
assert(listed.includes(alice.id)&&!listed.includes(bob.id),'only admins are listed');checks++;

// 4. A bot never has it, even with 'admins' on its list.
const botId='77777777-7777-4777-8777-777777777777';
await db.query(`insert into profiles(id,email,role) values($1,'wren@example.test','user')`,[botId]);
await db.query(`insert into auth.users(id) values($1) on conflict do nothing`,[botId]);
await db.query(`insert into chat_accounts(id,longboard_user_id) values($1,$1) on conflict do nothing`,[botId]);
await db.query(`insert into chat_bot_accounts(account_id,allowed_rooms) values($1,array['developers','admins'])`,[botId]);
eq(await has(botId,'admins'),false,'bot refused despite its list');
eq(await eligible(botId,'admins'),false,'bot not a recipient');
eq(await has(botId,'developers'),true,'bot keeps its allowed room');
eq(await has(botId,'social'),false,'bot limit still holds elsewhere');

// 5. A non-admin's suggestion reaches the room, named from the members table.
const posted=await suggest(bob.id,'  Margin\n calls ');
const row=await one(`select room_slug,author_label,body,bot_slug,member_id,guest_id from longboard_chat_messages where id=$1`,[posted.r.messageId]);
eq(row,{room_slug:'admins',author_label:'FAQ Suggestions',body:`${bob.display_name} suggested an FAQ topic: Margin calls`,bot_slug:'faq-suggestions',member_id:null,guest_id:null});
eq((await db.query(`select 1 from chat_faq_items where question ilike '%margin%' or answer ilike '%margin%'`)).rows,[],'never an FAQ item');
eq((await db.query(`select 1 from chat_room_mentions where message_id=$1`,[posted.r.messageId])).rows,[],'raises no mentions');

// 6. Direct reads through the policy: an admin sees it, a member and anon don't.
const as=async(role,person,fn)=>{await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[person?.id||'']);try{return await fn();}finally{await db.exec('reset role');}};
const visible=(role,person)=>as(role,person,async()=>(await db.query(`select id from longboard_chat_messages where room_slug='admins'`)).rows.length);
eq(await visible('authenticated',aliceP),1,'admin reads');
eq(await visible('authenticated',bobP),0,'member reads nothing');
await assert.rejects(visible('anon',null).then(n=>{if(n)throw Error('anon read');throw Error('permission denied')}),/permission denied/);checks++;

// 7. The bot's slug is confined to the room; other bots stay out of it.
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('social','FAQ Suggestions','x','faq-suggestions')`),/actor_check/,'not in other rooms');
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('admins','Bot','x','whats-new')`),/actor_check|whats_new/,'no other bot here');

// 8. Rate limit: 1 a minute, 5 a day, per member; bad input and unknown members refused.
await rejects(suggest(bob.id,'too soon'),/faq_suggestion_rate_limited/,'one a minute');
eq((await one(`select count(*)::int n from longboard_chat_messages where room_slug='admins'`)).n,1,'the refused one posted nothing');
await suggest(alice.id,'another member is not limited by Bob');
const age=()=>db.query(`update chat_faq_suggestions set created_at=created_at-interval '2 minutes'`);
for(let i=2;i<=5;i++){await age();await suggest(bob.id,`topic ${i}`);}
await age();await rejects(suggest(bob.id,'sixth'),/faq_suggestion_rate_limited/,'five a day');
await db.query(`update chat_faq_suggestions set created_at=created_at-interval '2 days'`);
await suggest(bob.id,'next day');checks++;
await rejects(suggest(bob.id,' \n '),/invalid_faq_suggestion/,'empty');
await rejects(suggest(bob.id,'x'.repeat(301)),/invalid_faq_suggestion/,'too long');
await rejects(suggest(ghost,'x'),/member_required/,'unknown member');

// 9. Rollback: everything gone, each function back to the exact body of its previous migration.
const up=await readFile(`${root}supabase/migrations/20261030220000_chat_faq.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/20261030220000_chat_faq.down.sql`,'utf8');
const body=(text,name)=>{const m=text.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(.*?\\$function\\$;\\n`,'s'));assert(m,name);return m[0];};
const dev=await readFile(`${root}supabase/migrations/20261029150000_chat_developers_room.sql`,'utf8');
const bots=await readFile(`${root}supabase/migrations/20261030200000_chat_bot_accounts.sql`,'utf8');
const fromBots=['chat_account_has_room','chat_account_room_recipient_eligible','longboard_chat_room_member_count'];
const fromDev=['longboard_chat_room_members','longboard_chat_room_members_ordered','longboard_chat_room_member_names','queue_chat_push','queue_longboard_chat_embedding','claim_longboard_chat_embeddings','search_longboard_chat','search_longboard_chat_semantic'];
for(const name of fromBots)eq(body(down,name),body(bots,name),`rollback text of ${name}`);
for(const name of fromDev)eq(body(down,name),body(dev,name),`rollback text of ${name}`);
const src=async(name)=>(await db.query('select prosrc from pg_proc where proname=$1',[name])).rows[0].prosrc;
await db.exec('delete from chat_bot_accounts');
await db.exec(await readFile(`${root}supabase/rollbacks/20261031100000_chat_faq_review.down.sql`,'utf8'));
await db.exec(down);
for(const table of ['chat_faq_items','chat_faq_suggestions'])eq((await one('select to_regclass($1) t',[`public.${table}`])).t,null,`${table} gone`);
eq((await db.query(`select 1 from pg_proc where proname='post_chat_faq_suggestion'`)).rows,[]);
eq((await db.query(`select 1 from longboard_chat_room_state where room_slug='admins'`)).rows,[]);
eq((await db.query(`select 1 from longboard_chat_messages where room_slug='admins'`)).rows,[]);
assert(!(await src('chat_account_has_room')).includes('admins'));checks++;
const policy=(await one(`select qual from pg_policies where policyname='members read chat messages'`)).qual;
assert(!policy.includes('admins'),'policy restored');checks++;
await rejects(db.query(`insert into longboard_chat_room_state(id,room_slug) values(11,'admins')`),/room_slug_check/,'constraint restored');

// 10. And it applies again.
await db.exec(up+'\n-- again');
eq((await db.query('select 1 from chat_faq_items')).rows.length,2);
eq(await has(aliceP.id,'admins'),true);
console.log(`PASS ${checks} FAQ and Admins room database assertions.`);
await db.close();
