// #330 database check: a bot account has only its listed rooms, no DMs, no admin, no browser
// sign-in; ordinary accounts don't change; the rollback restores the exact function bodies.
// Runs on the full migration chain from the mobile fixture. Synthetic data only.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`\nexport {db,people};`;
const target=new URL(`.chat-bot-accounts-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const account=async p=>(await one('select id from chat_accounts where longboard_user_id=$1',[p.id])).id;
const [alice,bob,mallory]=await Promise.all(people.map(account));
const rooms=['main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers'];
const has=async(who,room)=>(await one('select chat_account_has_room($1,$2) r',[who,room])).r;
const eligible=async(who,room)=>(await one('select chat_account_room_recipient_eligible($1,$2) r',[who,room])).r;
const answers=async()=>{const out={};for(const who of [alice,bob,mallory])for(const room of rooms)out[who+room]=[await has(who,room),await eligible(who,room)];return out;};
const functions=['chat_account_has_room','chat_account_room_recipient_eligible','longboard_chat_room_member_count','chat_member_membership_sources','chat_api_request_context','chat_longboard_request_context','chat_session_request_context'];
const definitions=async()=>(await db.query(`select proname,pg_get_functiondef(oid) d from pg_proc where proname=any($1) order by proname`,[functions])).rows;

// The bodies before this migration come from the migration before it: rebuild them by running the
// rollback, then compare with the migration re-applied.
const after=await definitions();assert.equal(after.length,functions.length);
const down=await readFile(`${root}/supabase/rollbacks/20261030200000_chat_bot_accounts.down.sql`,'utf8');
const up=await readFile(`${root}/supabase/migrations/20261030200000_chat_bot_accounts.sql`,'utf8');
await db.exec(down);
const before=await definitions();
const memberCount=async who=>Number((await one('select longboard_chat_room_member_count($1,$2) r',[who,'developers'])).r);
const beforeAnswers=await answers();const beforeCount=await memberCount(bob);
// The fixture skips SQL text it has already run, so each repeat is made a little different.
await db.exec(up+'\n-- again');
assert.deepEqual(await definitions(),after,'the migration re-applies cleanly');
assert.notDeepEqual(before,after,'the migration changes the functions');
assert.deepEqual(await answers(),beforeAnswers,'no bot row: nobody\'s rooms change');
assert.equal(await memberCount(bob),beforeCount,'no bot row: the count doesn\'t change');

// Make Wren the way create-wren.mjs does.
const wren='00000000-0000-4000-8000-0000000000aa';
await db.query('insert into auth.users(id) values($1)',[wren]);
await db.query(`insert into public.profiles(id,email,role) values($1,'wren@bot.longboard.invalid','user') on conflict do nothing`,[wren]);
await db.query('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[wren]);
const member=(await one(`select longboard_chat_link_member($1,'Wren',null) r`,[wren])).r.id;
await db.query(`insert into chat_bot_accounts(account_id,allowed_rooms) values($1,'{developers}')`,[wren]);
await db.query('update longboard_chat_members set accepts_requests=false where user_id=$1',[wren]);
await db.query('insert into chat_api_access(account_id) values($1)',[wren]);
const token='lbc_'+randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
const made=(await one(`select create_chat_api_token($1,'Wren',$2,$3) r`,[wren,hash,token.slice(-4)])).r;
assert.equal(made.status,'created');

// 1. Rooms: Developers and nothing else, even with a Boardroom tag.
await db.query(`insert into user_tags(user_id,tag) values($1,'boardroom-cohort-1')`,[wren]);
for(const room of rooms){
 assert.equal(await has(wren,room),room==='developers',`has_room ${room}`);
 assert.equal(await eligible(wren,room),room==='developers',`eligible ${room}`);
}
// 2. Token context: role user, no Boardroom or ShortScout, just the room list.
const c=(await one('select chat_api_request_context($1) r',[hash])).r;
assert.equal(c.mode,'ok');assert.equal(c.user.id,wren);assert.equal(c.user.role,'user');assert.equal(c.boardroom,false);
assert.deepEqual(c.botRooms,['developers']);assert.deepEqual(c.shortscout,{mode:'absent'});
await db.query(`delete from user_tags where user_id=$1`,[wren]);
// 3. Admin: refused both ways round.
await assert.rejects(db.query(`update profiles set role='admin' where id=$1`,[wren]),/bot_cannot_be_admin/);
assert.equal((await one('select role from profiles where id=$1',[wren])).role,'user');
await assert.rejects(db.query(`insert into chat_bot_accounts(account_id,allowed_rooms) values($1,'{developers}')`,[alice]),/bot_cannot_be_admin/);
await db.query(`update profiles set role='user' where id=$1`,[bob]);// an ordinary change still works
await db.query(`update profiles set role='admin' where id=$1`,[bob]);await db.query(`update profiles set role='user' where id=$1`,[bob]);
// 4. DMs: nobody can start one with Wren and Wren can't start one, whichever way it's tried.
const bobMember=(await one('select id from longboard_chat_members where user_id=$1',[bob])).id;
const dm=(who,other)=>db.query(`select longboard_chat_dm_action($1,'request',$2,'hello',gen_random_uuid())`,[who,other]);
await assert.rejects(dm(bob,member),/requests_unavailable/);
await db.query('update longboard_chat_members set accepts_requests=true where user_id=$1',[wren]);
await assert.rejects(dm(bob,member),/requests_unavailable/,'still refused with requests switched on');
await assert.rejects(dm(wren,bobMember),/member_required/,'the bot has no Social access, so the DM functions refuse it');
await assert.rejects(db.query('insert into longboard_chat_conversations(requester_id,recipient_id) values($1,$2)',[bobMember,member]),/requests_unavailable/);
await db.query('update longboard_chat_members set accepts_requests=false where user_id=$1',[wren]);
assert.equal((await db.query(`select longboard_chat_dm_directory($1,'Wren') r`,[bob])).rows.length,0,'not offered in DM search');
await assert.rejects(db.query(`select longboard_chat_dm_directory($1,'Bo')`,[wren]),/member_required/);
assert.equal((await db.query('select * from longboard_chat_conversations where requester_id=$1 or recipient_id=$1',[member])).rows.length,0);
// 5. Not counted as a member, no LB/SS badge, flagged as bot; still listed in Developers only.
assert.equal(await memberCount(bob),beforeCount,'not counted');
const sources=(await db.query('select * from chat_member_membership_sources($1)',[[member,bobMember]])).rows;
assert.equal(sources.find(r=>r.member_id===member).bot,true);assert.equal(sources.find(r=>r.member_id===member).longboard,false);
assert.equal(sources.find(r=>r.member_id===bobMember).bot,false);
const listed=async room=>(await db.query('select id from longboard_chat_room_members($1,$2,null,$3)',[bob,room,'Wren'])).rows.length;
assert.equal(await listed('developers'),1);assert.equal(await listed('social'),0);
// 6. Browser sign-in: refused for the bot, however the session looks; other people unaffected.
const session='00000000-0000-4000-8000-0000000000ab';
await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,wren]);
assert.equal((await one('select chat_longboard_request_context($1,$2) r',[wren,session])).r.mode,'unauthenticated');
const chatToken='a'.repeat(64);
await db.query(`insert into chat_sessions(account_id,token_hash,expires_at) values($1,$2,now()+interval '1 day')`,[wren,chatToken]);
assert.equal((await one('select chat_session_request_context($1) r',[chatToken])).r.mode,'unauthenticated');
// 8. Revoking stops it at once.
assert.equal((await one('select revoke_chat_api_token($1,$2) r',[wren,made.token.id])).r,true);
assert.equal((await one('select chat_api_request_context($1) r',[hash])).r.mode,'unauthenticated');
// 9. Browser roles can't read the table.
for(const role of ['anon','authenticated']){await assert.rejects(db.exec(`set role ${role};select count(*) from public.chat_bot_accounts;`),/permission denied/);await db.exec('reset role');}
// 10. Ordinary accounts answer as before throughout.
assert.deepEqual(await answers(),beforeAnswers,'nobody else\'s rooms changed');
// 11. Rollback with the bot present: exact bodies back, its token and invite gone, table gone.
const again=(await one(`select create_chat_api_token($1,'Wren2',$2,$3) r`,[wren,createHash('sha256').update('x').digest('hex'),'abcd'])).r;assert.equal(again.status,'created');
await db.exec(down+'\n-- again');
assert.deepEqual(await definitions(),before,'rollback restores every function');
assert.equal((await one('select count(*)::int n from chat_api_tokens where account_id=$1',[wren])).n,0);
assert.equal((await one('select count(*)::int n from chat_api_access where account_id=$1',[wren])).n,0);
assert.equal((await one(`select count(*)::int n from information_schema.tables where table_name='chat_bot_accounts'`)).n,0);
await db.close();
console.log('PASS chat bot accounts: Developers only, no admin, no DMs, not counted, no browser sign-in, revoke stops it, ordinary accounts unchanged, rollback exact');
