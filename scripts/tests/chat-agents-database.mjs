// #450 Agents in chat database check, on the full migration chain from the mobile fixture:
// agent identities and tokens, the ceiling and owner settings (always the intersection),
// pause switches, the per-minute and per-day limits, the back-and-forth limit, mutes, browser
// roles denied, and the rollback. Synthetic data only.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-agents-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const r=async(sql,args=[])=>(await one(`select ${sql} r`,args)).r;
const account=async p=>(await one('select id from chat_accounts where longboard_user_id=$1',[p.id])).id;
const [alice,bob,mallory]=[await account(people[0]),await account(people[1]),await account(people[2])];
const make=()=>{const token='lbc_'+randomBytes(32).toString('base64url');return {token,hash:createHash('sha256').update(token).digest('hex'),hint:token.slice(-4)};};
// As the app does: a personal token first, then an agent token.
const context=async t=>{const p=await r('chat_api_request_context($1)',[t.hash]);return p.mode==='unauthenticated'?r('chat_agent_request_context($1)',[t.hash]):p;};
const send=(agent,room,body,reply=null,files=[])=>r('send_chat_agent_message($1,$2,$3,$4,$5,$6)',[agent,room,body,reply,files,randomUUID()]);
const human=async(p,room,body,reply=null)=>(await r('send_chat_room_message($1,$2,$3,$4,$5,$6)',[p.id,room,body,reply,[],randomUUID()]));
const age=(id,seconds)=>db.query(`update longboard_chat_messages set created_at=created_at-($2 * interval '1 second') where id=$1`,[id,seconds]);
// Posts in the back-and-forth checks are moved into the past in order (one every 10 seconds, all
// over 10 minutes ago), so the owner's own send limits don't come into it.
let clock=9000;const past=id=>age(id,clock-=10);
// The fixture's own messages are recent: move them out of the owner's 10-minute window.
await db.query("update longboard_chat_messages set created_at=created_at-interval '1 hour'");

// 1. Invite-only, at most 3 agents, names unique against agents and members.
assert.equal((await r('chat_agent_create($1,$2)',[bob,'Scout Bot'])).status,'no_access');
assert.deepEqual((await r('chat_agent_list($1)',[bob])).agents,[]);
await db.query('insert into chat_api_access(account_id) values($1),($2)',[bob,mallory]);
const made=await r('chat_agent_create($1,$2)',[bob,'  Desk Helper ']);
assert.equal(made.status,'created');assert.equal(made.agent.name,'Desk Helper');
const desk=made.agent.id;
assert.equal((await r('chat_agent_create($1,$2)',[mallory,'desk helper'])).status,'name_taken','another agent has it');
assert.equal((await r('chat_agent_create($1,$2)',[mallory,'alice'])).status,'name_taken','a member has it');
assert.equal((await r('chat_agent_create($1,$2)',[mallory,'x'])).status,'invalid_name');
assert.equal((await r('chat_agent_create($1,$2)',[bob,'Second Helper'])).status,'created');
assert.equal((await r('chat_agent_create($1,$2)',[bob,'Third Helper'])).status,'created');
assert.equal((await r('chat_agent_create($1,$2)',[bob,'Fourth Helper'])).status,'limit');
const other=(await r('chat_agent_create($1,$2)',[mallory,'Echo Helper'])).agent.id;

// 2. Tokens: own table, hash only, 3 per agent, owner-only.
const t1=make();
assert.equal((await r('chat_agent_token_create($1,$2,$3,$4,$5)',[mallory,desk,'x',t1.hash,t1.hint])).status,'not_found','not your agent');
const tok=await r('chat_agent_token_create($1,$2,$3,$4,$5)',[bob,desk,'laptop',t1.hash,t1.hint]);
assert.equal(tok.status,'created');
assert.equal((await one('select count(*)::int n from chat_api_tokens where token_hash=$1',[t1.hash])).n,0,'kept apart from personal tokens');
for(let i=0;i<2;i++){const t=make();assert.equal((await r('chat_agent_token_create($1,$2,$3,$4,$5)',[bob,desk,'more',t.hash,t.hint])).status,'created');}
{const t=make();assert.equal((await r('chat_agent_token_create($1,$2,$3,$4,$5)',[bob,desk,'fourth',t.hash,t.hint])).status,'limit');}
assert.equal((await r('chat_agent_list($1)',[bob])).agents[0].tokens.length,3);

// 3. Context: the owner's account as a plain user (never admin), with the agent's permissions.
let c=await context(t1);
assert.equal(c.mode,'ok');assert.equal(c.user.id,bob);assert.equal(c.user.role,'user');
assert.equal(c.agent.id,desk);assert.equal(c.agent.ownerId,bob);
assert.deepEqual(c.agent.readRooms,['agents','developers']);assert.deepEqual(c.agent.postRooms,['agents','developers']);
assert.equal(c.agent.dm,false);assert.equal(c.agent.react,true);assert.equal(c.agent.thread,true);
assert.equal(c.agent.perMinute,6);assert.equal(c.agent.perDay,300);assert.equal(c.agent.maxTurns,6);
// An admin's agent is still role 'user'.
await db.query('insert into chat_api_access(account_id) values($1)',[alice]);
const aliceAgent=(await r('chat_agent_create($1,$2)',[alice,'Admin Helper'])).agent.id;
const ta=make();await r('chat_agent_token_create($1,$2,$3,$4,$5)',[alice,aliceAgent,'a',ta.hash,ta.hint]);
assert.equal((await context(ta)).user.role,'user');

// 4. Owner settings narrow only; the effective value is always the intersection.
const upd=(who,agent,patch)=>r('chat_agent_update($1,$2,$3)',[who,agent,JSON.stringify(patch)]);
assert.equal((await upd(bob,desk,{postRooms:['social']})).status,'outside_ceiling');
assert.equal((await upd(bob,desk,{dm:true})).status,'outside_ceiling');
assert.equal((await upd(bob,desk,{perMinute:7})).status,'outside_ceiling');
assert.equal((await upd(mallory,desk,{name:'Mine Now'})).status,'not_found');
let u=await upd(bob,desk,{postRooms:['developers'],react:false,perMinute:3});
assert.equal(u.status,'updated');assert.deepEqual(u.agent.effective.postRooms,['developers']);
assert.equal(u.agent.effective.react,false);assert.equal(u.agent.effective.perMinute,3);
// The admin widens the ceiling: the owner's narrower choice still holds.
assert.equal((await r('chat_agent_ceiling_update($1,$2)',[bob,JSON.stringify({postRooms:['social']})])).status,'forbidden','owners are not admins');
let ceil=await r('chat_agent_ceiling_update($1,$2)',[alice,JSON.stringify({readRooms:['developers','social','agents'],postRooms:['developers','social','agents']})]);
assert.equal(ceil.status,'updated');
c=await context(t1);assert.deepEqual(c.agent.postRooms,['developers']);assert.deepEqual(c.agent.readRooms,['agents','developers','social']);
// Post rooms are always also read rooms.
assert.equal((await upd(bob,desk,{postRooms:null,readRooms:['developers']})).status,'updated');
c=await context(t1);assert.deepEqual(c.agent.postRooms,['developers'],'social is postable by the ceiling but not readable by this agent');
// The admin narrows the ceiling: every agent narrows at once.
await r('chat_agent_ceiling_update($1,$2)',[alice,JSON.stringify({react:false,thread:false,perMinute:2})]);
c=await context(t1);assert.equal(c.agent.thread,false);assert.equal(c.agent.perMinute,2);
assert.equal((await r('chat_agent_effective($1)',[other])).thread,false);
assert.equal((await r('chat_agent_ceiling_update($1,$2)',[alice,JSON.stringify({postRooms:['admins']})])).status,'invalid');
assert.equal((await r('chat_agent_ceiling_update($1,$2)',[alice,JSON.stringify({perMinute:0})])).status,'invalid');
await r('chat_agent_ceiling_update($1,$2)',[alice,JSON.stringify({react:true,thread:true,perMinute:6,readRooms:['developers','agents'],postRooms:['developers','agents']})]);
await upd(bob,desk,{readRooms:null,postRooms:null,react:true,perMinute:null});

// 5. Posting: recorded as the agent, on the owner's member; only through send_chat_agent_message.
const p1=await send(desk,'developers','Build finished.');
assert.equal(p1.status,'sent',JSON.stringify(p1));
assert.equal(p1.message.author_label,'Desk Helper');assert.equal(p1.message.agent.owner,'Bob');assert.equal(p1.message.agent.id,desk);
const row=await one('select * from longboard_chat_messages where id=$1',[p1.message.id]);
assert.equal(row.agent_id,desk);assert.equal(row.member_id,people[1].member.id,'the owner is on the row');assert.equal(row.author_label,'Desk Helper');
await assert.rejects(db.query("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,agent_id) values($1,$1,'x','y','developers',$2)",[people[1].member.id,desk]),/agent_send_required/);
await db.query('update longboard_chat_messages set agent_id=null where id=$1',[p1.message.id]);
assert.equal((await one('select agent_id from longboard_chat_messages where id=$1',[p1.message.id])).agent_id,desk,'agent_id never changes');
assert.equal((await send(desk,'social','Hello')).status,'room_not_allowed');
assert.equal((await send(desk,'developers','file',null,[randomUUID()])).status,'files_not_allowed');
const ids=await db.query('select * from chat_agent_message_identities($1)',[[p1.message.id,row.id]]);
assert.equal(ids.rows.length,1);assert.equal(ids.rows[0].name,'Desk Helper');assert.equal(ids.rows[0].owner_name,'Bob');
// Thread replies follow the switch.
await upd(bob,desk,{thread:false});
assert.equal((await send(desk,'developers','reply',p1.message.id)).status,'threads_not_allowed');
await upd(bob,desk,{thread:true});

// 6. Rate limits per agent: per minute, then per day.
await db.query('delete from longboard_chat_messages where agent_id is not null');
await upd(bob,desk,{perMinute:2,perDay:3});
const spaced=async(agent,room,body,reply)=>{const s=await send(agent,room,body,reply);if(s.message)await age(s.message.id,2);return s;};
assert.equal((await spaced(desk,'developers','a')).status,'sent');
assert.equal((await spaced(desk,'developers','b')).status,'sent');
let lim=await send(desk,'developers','c');assert.equal(lim.status,'agent_rate_limited');assert.equal(lim.reason,'minute');
await db.query("update longboard_chat_messages set created_at=created_at-interval '2 minutes' where agent_id=$1",[desk]);
assert.equal((await spaced(desk,'developers','c')).status,'sent');
await db.query("update longboard_chat_messages set created_at=created_at-interval '2 minutes' where agent_id=$1",[desk]);
lim=await send(desk,'developers','d');assert.equal(lim.status,'agent_rate_limited');assert.equal(lim.reason,'day');
await db.query("update longboard_chat_messages set created_at=created_at-interval '1 day' where agent_id=$1",[desk]);
assert.equal((await spaced(desk,'developers','e')).status,'sent','a new day');
await upd(bob,desk,{perMinute:null,perDay:null});
await db.query("update longboard_chat_messages set created_at=created_at-interval '2 days' where agent_id is not null");

// 7. Back-and-forth: two agents in a thread, 6 agent turns in a row, then a person resets it.
await r('chat_agent_ceiling_update($1,$2)',[alice,JSON.stringify({perMinute:60})]);
const top=await human(people[2],'developers','Can your agents compare notes?');
assert.equal(top.status,'sent');await past(top.message.id);
const turn=async(agent,i)=>{const s=await send(agent,'developers',`turn ${i}`,top.message.id);if(s.message)await past(s.message.id);return s;};
for(let i=0;i<6;i++)assert.equal((await turn(i%2?other:desk,i)).status,'sent',`turn ${i}`);
const stop=await turn(desk,6);assert.equal(stop.status,'agent_turn_limit');assert.equal(stop.limit,6);
assert.equal((await turn(other,6)).status,'agent_turn_limit','either agent');
// A person replies: the chain is broken.
const person=await human(people[0],'developers','Carry on.',top.message.id);assert.equal(person.status,'sent');await past(person.message.id);
assert.equal((await turn(desk,7)).status,'sent');
// One agent alone, in the room's main timeline, is held by its rate limits only.
await db.query("update longboard_chat_messages set created_at=created_at-interval '2 days' where agent_id is not null");
const human2=await human(people[2],'developers','Room note');await past(human2.message.id);
for(let i=0;i<7;i++){const s=await send(desk,'developers',`solo ${i}`);assert.equal(s.status,'sent',`solo ${i}: ${JSON.stringify(s)}`);await past(s.message.id);}
// Naming another agent there counts the run.
assert.equal((await send(desk,'developers','@Echo Helper what do you think?')).status,'agent_turn_limit');
// The limit is a global setting.
await r('chat_agent_ceiling_update($1,$2)',[alice,JSON.stringify({maxTurns:10})]);
{const s=await send(desk,'developers','@Echo Helper what do you think?');assert.equal(s.status,'sent');await past(s.message.id);}
await r('chat_agent_ceiling_update($1,$2)',[alice,JSON.stringify({maxTurns:6,perMinute:6})]);

// 8. Off switches: owner pause and admin pause stop the tokens at once; owners can't lift an admin pause.
await upd(bob,desk,{paused:true});
c=await context(t1);assert.equal(c.mode,'agent_paused');assert.equal(c.agent.pausedBy,'owner');
assert.equal((await send(desk,'developers','paused')).status,'agent_paused');
await upd(bob,desk,{paused:false});assert.equal((await context(t1)).mode,'ok');
assert.equal((await r('chat_agent_admin_pause($1,$2,$3)',[bob,desk,true])).status,'forbidden');
assert.equal((await r('chat_agent_admin_pause($1,$2,$3)',[alice,desk,true])).status,'updated');
c=await context(t1);assert.equal(c.mode,'agent_paused');assert.equal(c.agent.pausedBy,'admin');
await upd(bob,desk,{paused:false});assert.equal((await context(t1)).mode,'agent_paused','owner cannot lift an admin pause');
const adminList=await r('chat_agent_admin_list($1)',[alice]);
assert.equal(adminList.status,'ok');assert.ok(adminList.agents.find(a=>a.id===desk).adminPaused);
assert.equal((await r('chat_agent_admin_list($1)',[bob])).status,'forbidden');
await r('chat_agent_admin_pause($1,$2,$3)',[alice,desk,false]);assert.equal((await context(t1)).mode,'ok');

// 9. Losing developer access, revoking and deleting all stop the token.
await db.query('delete from chat_api_access where account_id=$1',[bob]);assert.equal((await context(t1)).mode,'unauthenticated');
await db.query('insert into chat_api_access(account_id) values($1)',[bob]);assert.equal((await context(t1)).mode,'ok');
assert.equal(await r('chat_agent_token_revoke($1,$2)',[mallory,tok.token.id]),false);
assert.equal(await r('chat_agent_token_revoke($1,$2)',[bob,tok.token.id]),true);
assert.equal((await context(t1)).mode,'unauthenticated');
const t2=make();await r('chat_agent_token_create($1,$2,$3,$4,$5)',[mallory,other,'m',t2.hash,t2.hint]);
assert.equal(await r('chat_agent_delete($1,$2)',[mallory,other]),true);
assert.equal((await context(t2)).mode,'unauthenticated');
assert.equal((await r('chat_agent_create($1,$2)',[mallory,'Echo Helper'])).status,'created','a deleted agent frees its name');
// Personal tokens are unchanged.
{const p=make();await r('create_chat_api_token($1,$2,$3,$4)',[bob,'cli',p.hash,p.hint]);const pc=await context(p);assert.equal(pc.mode,'ok');assert.equal(pc.agent,undefined);}

// 10. Mutes.
assert.equal(await r('chat_agent_mute_set($1,$2,$3)',[alice,desk,true]),true);
assert.deepEqual(await r('chat_agent_mutes_list($1)',[alice]),[desk]);
await r('chat_agent_mute_set($1,$2,$3)',[alice,desk,false]);assert.deepEqual(await r('chat_agent_mutes_list($1)',[alice]),[]);

// #444's profile merge knows every new account column.
{const cols=(await db.query("select table_name::text t,column_name c,action from chat_merge_account_columns() where table_name::text like 'chat_agent%'")).rows.map(r=>`${r.t}.${r.c}:${r.action}`).sort();
 assert.deepEqual(cols,['chat_agent_mutes.account_id:move','chat_agent_settings.updated_by:keep','chat_agents.admin_paused_by:keep','chat_agents.owner_id:keep']);}

// 11. Browser roles can't read agents or call the functions.
for(const role of ['anon','authenticated']){
 for(const sql of ['select count(*) from public.chat_agents','select count(*) from public.chat_agent_tokens','select count(*) from public.chat_agent_settings',
  `select public.chat_agent_list('${bob}')`,`select public.chat_agent_request_context('${t1.hash}')`,`select public.chat_agent_ceiling_update('${alice}','{}')`]){
  await assert.rejects(db.exec(`set role ${role};${sql};`),/permission denied/,`${role}: ${sql}`);await db.exec('reset role');
 }
}

// 12. The rollback runs cleanly on top, and personal tokens still work.
// Later migrations built on the agents tables are rolled back first, newest first, as at a real rollback.
await db.exec(await readFile(`${root}/supabase/rollbacks/20261113120000_chat_agent_mentions.down.sql`,'utf8'));
await db.exec(await readFile(`${root}/supabase/rollbacks/20261112120000_chat_agents.down.sql`,'utf8'));
assert.equal((await one("select count(*)::int n from information_schema.tables where table_name like 'chat_agent%'")).n,0);
assert.equal((await one("select count(*)::int n from pg_proc where proname like '%chat_agent%'")).n,0);
assert.equal((await one("select count(*)::int n from information_schema.columns where table_name='longboard_chat_messages' and column_name='agent_id'")).n,0);
assert.equal((await r('chat_api_request_context($1)',[t1.hash])).mode,'unauthenticated');
assert.ok((await db.query('select * from chat_merge_account_columns()')).rows.length>0,'the merge classification works again without the agent tables');
{const p=make();await r('create_chat_api_token($1,$2,$3,$4)',[bob,'cli2',p.hash,p.hint]);assert.equal((await context(p)).mode,'ok');}
await db.close();
console.log('PASS chat agents: invite-only, 3 agents, unique names, own hashed tokens, owner-as-user context, settings narrow the ceiling, stamped posts, rooms/threads/files checks, per-minute and per-day limits, back-and-forth limit, owner and admin pause, revoke/delete/uninvite stop, mutes, browser roles denied, rollback clean');
