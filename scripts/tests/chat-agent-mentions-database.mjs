// #455 Agents: mention alerts, database check on the full migration chain from the mobile
// fixture: mentions recorded at post time (case, word edges, names with spaces, a longer member
// name wins), edits add and remove them, the agent's own posts never count, the read keeps only
// rooms the agent may read (ceiling and owner settings) and live messages, the cursor, browser
// roles denied, and the rollback. Synthetic data only.
// Usage: node scripts/tests/chat-agent-mentions-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-agent-mentions-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const r=async(sql,args=[])=>(await one(`select ${sql} r`,args)).r;
const account=async p=>(await one('select id from chat_accounts where longboard_user_id=$1',[p.id])).id;
const [alice,bob,mallory]=[await account(people[0]),await account(people[1]),await account(people[2])];
await db.query("update longboard_chat_messages set created_at=created_at-interval '1 hour'");
// Each post moves into the past, so send limits and the 2-second settle never come into it.
let clock=9000;
const past=id=>db.query(`update longboard_chat_messages set created_at=created_at-($2 * interval '1 second') where id=$1`,[id,clock-=10]);
const settle=()=>db.query("update chat_agent_mentions set created_at=created_at-interval '10 seconds'");
const human=async(p,room,body,reply=null)=>{const s=await r('send_chat_room_message($1,$2,$3,$4,$5,$6)',[p.id,room,body,reply,[],randomUUID()]);assert.equal(s.status,'sent',JSON.stringify(s));await past(s.message.id);return s.message.id;};
const send=async(agent,room,body)=>{const s=await r('send_chat_agent_message($1,$2,$3,$4,$5,$6)',[agent,room,body,null,[],randomUUID()]);assert.equal(s.status,'sent',JSON.stringify(s));await past(s.message.id);return s.message.id;};
const recorded=async agent=>(await db.query('select message_id from chat_agent_mentions where agent_id=$1 order by seq',[agent])).rows.map(x=>x.message_id);
const since=(agent,rooms,after=null,limit=50)=>r('chat_agent_mentions_since($1,$2,$3,$4)',[agent,rooms,after,limit]);

await db.query('insert into chat_api_access(account_id) values($1),($2),($3)',[alice,bob,mallory]);
const luke=(await r('chat_agent_create($1,$2)',[bob,'Luke'])).agent.id;
const desk=(await r('chat_agent_create($1,$2)',[mallory,'Desk Helper'])).agent.id;
await db.query("update longboard_chat_members set display_name='Luke Smith' where id=$1",[people[2].member.id]);

// 1. Matching at post time.
const hit=await human(people[0],'developers','hey @luke, can you look?');
const capsHit=await human(people[0],'developers','(@LUKE) and @Desk Helper too');
const warm=await human(people[0],'developers','this is @Lukewarm and mail@Luke and @@Luke and @Luke_2');
const member=await human(people[0],'developers','@Luke Smith is a person, not the agent');
const spaced=await human(people[0],'developers','ping @desk helper.');
const notSpaced=await human(people[0],'developers','ping @Desk Helpers');
assert.deepEqual(await recorded(luke),[hit,capsHit]);
assert.deepEqual(await recorded(desk),[capsHit,spaced]);
assert.ok(![warm,member,notSpaced].some(id=>[hit,capsHit,spaced].includes(id)));

// 2. The agent's own posts never count; another agent's post does.
const own=await send(luke,'developers','I am @Luke');
const fromDesk=await send(desk,'developers','@Luke over to you');
assert.deepEqual(await recorded(luke),[hit,capsHit,fromDesk]);
assert.ok(!(await recorded(luke)).includes(own));

// 3. Edits: adding a mention records it, removing it deletes it, an unchanged one stays put.
await db.query("update longboard_chat_messages set body='now @Luke please' where id=$1",[member]);
await db.query("update longboard_chat_messages set body='never mind' where id=$1",[hit]);
const before=(await one('select seq from chat_agent_mentions where agent_id=$1 and message_id=$2',[luke,capsHit])).seq;
await db.query("update longboard_chat_messages set body='(@LUKE) and @Desk Helper too!' where id=$1",[capsHit]);
assert.equal((await one('select seq from chat_agent_mentions where agent_id=$1 and message_id=$2',[luke,capsHit])).seq,before,'kept, not re-sent');
assert.deepEqual(await recorded(luke),[capsHit,fromDesk,member]);

// 4. Reading: only rooms the agent may read (passed in AND its effective rooms), live messages.
await db.query('update chat_agent_settings set read_rooms=$1,post_rooms=$1',[['developers','social','agents']]);
const social=await human(people[0],'social','@Luke in social');
const removed=await human(people[0],'developers','@Luke soon removed');
const deleted=await human(people[0],'developers','@Luke soon deleted');
await db.query('update longboard_chat_messages set removed=true where id=$1',[removed]);
await db.query('update longboard_chat_messages set deleted_at=now() where id=$1',[deleted]);
const reply=await human(people[1],'developers','@Luke in a thread',fromDesk);
// Not settled yet: nothing is returned, and the cursor doesn't move past it.
let page=await since(luke,['developers','social'],0);
assert.deepEqual(page.mentions,[]);assert.equal(page.cursor,0);
await settle();
page=await since(luke,['developers','social'],0);
assert.deepEqual(page.mentions.map(x=>x.id),[capsHit,fromDesk,member,social,reply]);
const last=(await one('select max(seq)::int n from chat_agent_mentions where agent_id=$1',[luke])).n;
assert.equal(Number(page.cursor),last,'past the skipped removed and deleted rows too');assert.equal(page.more,false);
const r0=page.mentions.find(x=>x.id===reply);
assert.equal(r0.room,'developers');assert.equal(r0.author,'Bob');assert.equal(r0.replyTo,fromDesk);assert.equal(r0.authorAgentId,null);
assert.equal(r0.body,'@Luke in a thread');assert.ok(r0.createdAt);
assert.equal(page.mentions.find(x=>x.id===fromDesk).authorAgentId,desk);
assert.equal(page.mentions.find(x=>x.id===fromDesk).author,'Desk Helper');
// The app's rooms (the owner's) narrow it...
assert.deepEqual((await since(luke,['developers'],0)).mentions.map(x=>x.id),[capsHit,fromDesk,member,reply]);
// ...and so do the owner's settings and the ceiling, whatever the app passes.
await r('chat_agent_update($1,$2,$3)',[bob,luke,JSON.stringify({readRooms:['developers']})]);
assert.deepEqual((await since(luke,['developers','social','admins'],0)).mentions.map(x=>x.id),[capsHit,fromDesk,member,reply]);
await r('chat_agent_update($1,$2,$3)',[bob,luke,JSON.stringify({readRooms:null})]);
await db.query('update chat_agent_settings set read_rooms=$1,post_rooms=$1',[['social','agents']]);
assert.deepEqual((await since(luke,['developers','social'],0)).mentions.map(x=>x.id),[social]);
await db.query('update chat_agent_settings set read_rooms=$1,post_rooms=$1',[['developers','agents']]);

// 5. The cursor: pages, then nothing new, then the next mention.
const p1=await since(luke,['developers'],0,2);
assert.deepEqual(p1.mentions.map(x=>x.id),[capsHit,fromDesk]);assert.equal(p1.more,true);
const p2=await since(luke,['developers'],p1.cursor,2);
assert.deepEqual(p2.mentions.map(x=>x.id),[member]);assert.equal(p2.more,true,'a full page, one row skipped (social)');
const p3=await since(luke,['developers'],p2.cursor,2);
assert.deepEqual(p3.mentions,[]);assert.equal(p3.more,true,'removed and deleted: an empty page, but the cursor moves on');
assert.ok(Number(p3.cursor)>Number(p2.cursor));
let p4=await since(luke,['developers'],p3.cursor,2);
assert.deepEqual(p4.mentions.map(x=>x.id),[reply]);
assert.equal(p4.more,false);
const quiet=await since(luke,['developers'],p4.cursor);
assert.deepEqual(quiet.mentions,[]);assert.equal(quiet.cursor,p4.cursor);
const next=await human(people[0],'developers','@Luke one more');await settle();
const fresh=await since(luke,['developers'],quiet.cursor);
assert.deepEqual(fresh.mentions.map(x=>x.id),[next]);assert.ok(Number(fresh.cursor)>Number(quiet.cursor));
// No cursor: the last day only; with nothing in it, the cursor is the newest row.
await db.query("update chat_agent_mentions set created_at=created_at-interval '2 days' where message_id<>$1",[next]);
assert.deepEqual((await since(luke,['developers'])).mentions.map(x=>x.id),[next]);
await db.query("update chat_agent_mentions set created_at=created_at-interval '2 days'");
{const p=await since(luke,['developers']);assert.deepEqual(p.mentions,[]);assert.equal(Number(p.cursor),Number(fresh.cursor));}
await assert.rejects(since(luke,['developers'],0,0),/invalid_query/);
await assert.rejects(since(luke,['developers'],0,101),/invalid_query/);

// 6. A hard-deleted message takes its mention rows with it.
await db.query('delete from longboard_chat_messages where id=$1',[next]);
assert.ok(!(await recorded(luke)).includes(next));

// The migration's one-time backfill finds the same mentions again (agents made a day ago).
{const migration=await readFile(`${root}/supabase/migrations/20261113120000_chat_agent_mentions.sql`,'utf8');
 const backfill=migration.slice(migration.indexOf('insert into public.chat_agent_mentions(agent_id,message_id)\nselect'));
 const want=await recorded(luke);
 await db.query('delete from chat_agent_mentions');
 await db.query("update chat_agents set created_at=now()-interval '1 day'");
 await db.exec(backfill);
 assert.deepEqual((await recorded(luke)).sort(),[...want,social,removed,deleted].filter((x,i,a)=>a.indexOf(x)===i).sort());
 assert.ok(!(await recorded(luke)).includes(own));}

// 7. Browser roles can't read the table or call the functions.
for(const role of ['anon','authenticated']){
 for(const sql of ['select count(*) from public.chat_agent_mentions',`select public.chat_agent_mentions_since('${luke}','{developers}',0,10)`,"select public.chat_agent_mention_scan('@Luke')"]){
  await assert.rejects(db.exec(`set role ${role};${sql};`),/permission denied/,`${role}: ${sql}`);await db.exec('reset role');
 }
}

// 8. The rollback runs cleanly, and posting still works.
await db.exec(await readFile(`${root}/supabase/rollbacks/20261113120000_chat_agent_mentions.down.sql`,'utf8'));
assert.equal((await one("select count(*)::int n from information_schema.tables where table_name='chat_agent_mentions'")).n,0);
assert.equal((await one("select count(*)::int n from pg_proc where proname in ('chat_agent_mention_scan','record_chat_agent_mentions','chat_agent_mentions_since')")).n,0);
await human(people[0],'developers','@Luke after the rollback');
await send(luke,'developers','still posting');
await db.close();
console.log('PASS chat agent mentions: recorded at post time (case, word edges, spaces, longer member names), own posts left out, edits add and remove, readable rooms only (app, owner, ceiling), removed and deleted left out, settle, cursor paging, browser roles denied, rollback clean');
