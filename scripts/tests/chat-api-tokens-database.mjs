// CHAT-API database check: invite-only personal tokens, stored as hashes, that sign in as their
// owner until revoked, uninvited, deleted or banned. Runs on the full migration chain from the
// mobile fixture. Synthetic data only.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
// Keep the database setup and every migration; drop the HTTP server.
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-api-tokens-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const account=async p=>(await one('select id from chat_accounts where longboard_user_id=$1',[p.id])).id;
const [alice,bob]=[await account(people[0]),await account(people[1])];
const scout='00000000-0000-4000-8000-000000000099';
const make=()=>{const token='lbc_'+randomBytes(32).toString('base64url');return {token,hash:createHash('sha256').update(token).digest('hex'),hint:token.slice(-4)};};
const create=async(who,label,t=make())=>({t,r:(await one('select create_chat_api_token($1,$2,$3,$4) r',[who,label,t.hash,t.hint])).r});
const context=async t=>(await one('select chat_api_request_context($1) r',[t.hash])).r;
const list=async who=>(await one('select list_chat_api_tokens($1) r',[who])).r;

// 1. Invite-only: no access, no token; a ShortScout-only account can't be invited into v1.
assert.deepEqual(await list(bob),{access:false,tokens:[]});
assert.equal((await create(bob,'Bot')).r.status,'no_access');
await db.query('insert into chat_api_access(account_id,note) values($1,$2),($3,$4)',[bob,'first developer',scout,'not linked to Longboard']);
assert.equal((await create(scout,'Bot')).r.status,'no_access');
assert.equal((await list(scout)).access,false);

// 2. Create: only a hash and a 4-character hint are stored; at most 5 active tokens.
const first=await create(bob,'  Trading bot ');
await assert.rejects(db.query('select create_chat_api_token($1,$2,$3,$4)',[bob,'dup',first.t.hash,first.t.hint]),/unique|duplicate/);
await assert.rejects(db.query('select create_chat_api_token($1,$2,$3,$4)',[bob,'bad','not-a-hash','abcd']),/check/);
assert.equal(first.r.status,'created');assert.equal(first.r.token.label,'Trading bot');assert.equal(first.r.token.hint,first.t.hint);
const stored=await one('select * from chat_api_tokens where id=$1',[first.r.token.id]);
assert.equal(stored.token_hash,first.t.hash);assert.ok(!JSON.stringify(stored).includes(first.t.token),'the token itself is never stored');
for(let i=2;i<=5;i++)assert.equal((await create(bob,`Bot ${i}`)).r.status,'created');
assert.equal((await create(bob,'Bot 6')).r.status,'limit');
assert.equal((await list(bob)).tokens.length,5);assert.equal((await list(bob)).access,true);
await assert.rejects(create(bob,'   ',make()),/invalid_label/);await assert.rejects(create(bob,'x'.repeat(61)),/invalid_label/);


// 3. Sign-in: the token speaks for its owner, in the Longboard context's shape, and notes its use.
let c=await context(first.t);
assert.equal(c.mode,'ok');assert.equal(c.user.id,bob);assert.equal(c.user.email,'bob@example.test');assert.equal(c.user.role,'user');
assert.equal(c.boardroom,true,'Bob is in a Boardroom cohort in the fixture');assert.ok(c.shortscout&&c.shortscout.mode);
assert.ok((await one('select last_used_at from chat_api_tokens where id=$1',[first.r.token.id])).last_used_at);
assert.equal((await context(make())).mode,'unauthenticated','unknown token');
// Last use is written at most once a minute.
await db.query("update chat_api_tokens set last_used_at=now()-interval '30 seconds' where id=$1",[first.r.token.id]);
const before=(await one('select last_used_at from chat_api_tokens where id=$1',[first.r.token.id])).last_used_at;
await context(first.t);assert.deepEqual((await one('select last_used_at from chat_api_tokens where id=$1',[first.r.token.id])).last_used_at,before);

// 4. Revoke: only the owner can, and the token stops at once.
assert.equal((await one('select revoke_chat_api_token($1,$2) ok',[alice,first.r.token.id])).ok,false,'not your token');
assert.equal((await context(first.t)).mode,'ok');
assert.equal((await one('select revoke_chat_api_token($1,$2) ok',[bob,first.r.token.id])).ok,true);
assert.equal((await one('select revoke_chat_api_token($1,$2) ok',[bob,first.r.token.id])).ok,false,'already revoked');
assert.equal((await context(first.t)).mode,'unauthenticated');
assert.equal((await list(bob)).tokens.length,4);assert.equal((await create(bob,'Replacement')).r.status,'created');

// 5. Banned, deleted, profile gone, or uninvited: every token stops.
await db.query('delete from chat_api_tokens where account_id=$1',[bob]);
const second=await create(bob,'Second');assert.equal((await context(second.t)).mode,'ok');
await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[bob]);assert.equal((await context(second.t)).mode,'unauthenticated','banned');
await db.query('update auth.users set banned_until=null,deleted_at=now() where id=$1',[bob]);assert.equal((await context(second.t)).mode,'unauthenticated','deleted');
await db.query('update auth.users set deleted_at=null where id=$1',[bob]);assert.equal((await context(second.t)).mode,'ok');
await db.query('delete from chat_api_access where account_id=$1',[bob]);assert.equal((await context(second.t)).mode,'unauthenticated','invite removed');
assert.equal((await create(bob,'After')).r.status,'no_access');
await db.query('insert into chat_api_access(account_id) values($1)',[bob]);assert.equal((await context(second.t)).mode,'ok','invite restored');

// 6. Browser roles can't read tokens or call the functions.
for(const role of ['anon','authenticated']){
 await assert.rejects(db.exec(`set role ${role};select count(*) from public.chat_api_tokens;`),/permission denied/);await db.exec('reset role');
 await assert.rejects(db.exec(`set role ${role};select public.chat_api_request_context('${second.t.hash}');`),/permission denied/);await db.exec('reset role');
 await assert.rejects(db.exec(`set role ${role};select public.list_chat_api_tokens('${bob}');`),/permission denied/);await db.exec('reset role');
}

// 7. The rollback runs cleanly on top.
await db.exec(await readFile(`${root}/supabase/rollbacks/20261021120000_chat_api_tokens.down.sql`,'utf8'));
assert.equal((await one("select count(*) n from information_schema.tables where table_name in ('chat_api_tokens','chat_api_access')")).n,0);
assert.equal((await one("select count(*) n from pg_proc where proname like '%chat_api%'")).n,0);
await db.close();
console.log('PASS chat API tokens: invite-only, Longboard accounts only, hash-only storage, 5-token limit, owner context, last use throttled, owner-only revoke, banned/deleted/uninvited stop, browser roles denied, rollback clean');
