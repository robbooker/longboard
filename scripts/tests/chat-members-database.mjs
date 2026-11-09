// #384 database check: the members tables and the one access check. Runs on the full migration
// chain from the mobile fixture. Synthetic data only.
//  - no entitlement rows: every existing account's rooms and request contexts are unchanged
//    (apart from the new empty 'member' list);
//  - an active 'gainers' entitlement opens the Gainers room (and nothing else) for a club-only
//    account; expired, not yet started or revoked ones don't; a bot never has any;
//  - a Longboard member who buys gets the entitlements through their profile email;
//  - member_open_chat_session: no purchase / Longboard email / no active access are refused; the
//    first sign-up makes one chat account and links it, the second reuses it; the session works
//    in chat_session_request_context; the club member can take a name (longboard_chat_link_member);
//  - the rollback restores the exact previous function bodies and the migration re-applies.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`\nexport {db,people};`;
const target=new URL(`.chat-members-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
// #386 (20261109120000_chat_stock_club.sql) is stacked on this migration and changes two of the same
// functions; its rollback comes first, so this file checks #384 on its own. chat-stock-club-database.mjs
// checks the two together.
await db.exec(await readFile(`${root}/supabase/rollbacks/20261109120000_chat_stock_club.down.sql`,'utf8'));
const [alice,bob,mallory]=people.map(p=>p.id);
const scout='00000000-0000-4000-8000-000000000099';
const rooms=['main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','admins'];
const has=async(who,room)=>(await one('select chat_account_has_room($1,$2) r',[who,room])).r;
const eligible=async(who,room)=>(await one('select chat_account_room_recipient_eligible($1,$2) r',[who,room])).r;
const answers=async who=>{const out={};for(const w of who)for(const room of rooms)out[w+room]=[await has(w,room),await eligible(w,room)];return out;};
const functions=['chat_account_has_room','chat_account_room_recipient_eligible','longboard_chat_link_member','chat_api_request_context','chat_longboard_request_context','chat_session_request_context'];
const definitions=async()=>(await db.query(`select proname,pg_get_functiondef(oid) d from pg_proc where proname=any($1) order by proname`,[functions])).rows;
const keys=async who=>(await one('select member_account_entitlements($1) r',[who])).r;
const hash=v=>createHash('sha256').update(v).digest('hex');

// 1. Rollback and re-apply.
const migration='20261109100000_members_stripe';
const up=await readFile(`${root}/supabase/migrations/${migration}.sql`,'utf8');
const down=await readFile(`${root}/supabase/rollbacks/${migration}.down.sql`,'utf8');
const after=await definitions();assert.equal(after.length,functions.length);
const everyone=[alice,bob,mallory,scout];
const withMigration=await answers(everyone);
await db.exec(down);
const before=await definitions();
assert.notDeepEqual(before,after,'the migration changes the functions');
assert.equal((await one(`select to_regclass('public.member_people') r`)).r,null,'the rollback removes the tables');
const beforeAnswers=await answers(everyone);
const lbBefore=(await one('select chat_longboard_request_context($1,$2) r',[bob,people[1].session])).r;
await db.exec(up+'\n-- again');
assert.deepEqual(await definitions(),after,'the migration re-applies cleanly');
assert.deepEqual(await answers(everyone),beforeAnswers,'no entitlements: nobody\'s rooms change');
assert.deepEqual(withMigration,beforeAnswers);
const lbAfter=(await one('select chat_longboard_request_context($1,$2) r',[bob,people[1].session])).r;
assert.deepEqual(lbAfter.member,[],'the context carries an empty member list');
delete lbAfter.member;assert.deepEqual(lbAfter,lbBefore,'and nothing else in it changes');

// 2. Seeded product map.
assert.deepEqual((await db.query(`select entitlement_key from member_product_entitlements where product_key='booker-stock-club' order by 1`)).rows.map(r=>r.entitlement_key),['club-room','gainers','reader']);
// RLS on, no client grants.
for(const t of ['member_people','member_purchases','member_entitlements','member_products','member_product_entitlements','member_product_stripe_ids','member_stripe_events','member_login_codes']){
 assert.equal((await one(`select relrowsecurity r from pg_class where relname=$1`,[t])).r,true,`${t} has RLS`);
 assert.equal((await one(`select count(*)::int n from pg_policies where tablename=$1`,[t])).n,0,`${t} has no policies`);
 for(const role of ['anon','authenticated'])assert.equal((await one(`select has_table_privilege($1,$2,'select') r`,[role,'public.'+t])).r,false,`${role} can't read ${t}`);
}

// 3. A club buyer (no chat account yet), a purchase and its entitlements.
const person=(await one(`insert into member_people(email,name) values('buyer@example.test','Bea Buyer') returning id`)).id;
await assert.rejects(db.query(`insert into member_people(email) values('Mixed@Example.test')`),/check/,'emails are stored normalized');
const purchase=(await one(`insert into member_purchases(person_id,product_key,kind,status,stripe_subscription_id) values($1,'booker-stock-club','subscription','active','sub_test1') returning id`,[person])).id;
const grant=(key,extra='')=>db.query(`insert into member_entitlements(person_id,entitlement_key,product_key,purchase_id,granted_by${extra?','+extra.split('=')[0]:''}) values($1,$2,'booker-stock-club',$3,'stripe'${extra?','+extra.split('=')[1]:''})`,[person,key,purchase]);
for(const key of ['gainers','reader','club-room'])await grant(key);
await assert.rejects(grant('gainers'),/duplicate|unique/,'one row per purchase and key');
assert.deepEqual((await one(`select member_email_entitlements(' BUYER@example.test ') r`)).r,['club-room','gainers','reader']);

// 4. Sign-up: refused cases first.
const session=()=>randomBytes(32).toString('base64url');
const open=async(email,token)=>(await one(`select member_open_chat_session($1,$2,now()+interval '30 days') r`,[email,hash(token)])).r;
assert.equal((await open('nobody@example.test',session())).status,'no_purchase');
const first=session(),opened=await open('Buyer@Example.test',first);
assert.equal(opened.status,'ok');assert.equal(opened.member,false);
const club=opened.account;
assert.equal((await one('select chat_account_id from member_people where id=$1',[person])).chat_account_id,club,'the person is linked');
assert.equal((await open('buyer@example.test',session())).account,club,'a second sign-in reuses the account');
assert.equal((await one('select count(*)::int n from chat_sessions where account_id=$1',[club])).n,2);
await assert.rejects(db.query(`select member_open_chat_session('buyer@example.test','not-a-hash',now())`),/invalid_session/);

// 5. The club account's rooms: Gainers only.
for(const room of rooms){assert.equal(await has(club,room),room==='gainers',`has_room ${room}`);assert.equal(await eligible(club,room),room==='gainers',`eligible ${room}`);}
assert.deepEqual(await keys(club),['club-room','gainers','reader']);
assert.equal((await one(`select member_account_has_entitlement($1,'reader') r`,[club])).r,true);
assert.equal((await one(`select member_account_has_entitlement($1,'nope') r`,[club])).r,false);
const ctx=(await one('select chat_session_request_context($1) r',[hash(first)])).r;
assert.equal(ctx.mode,'ok');assert.equal(ctx.account,club);assert.equal(ctx.longboard,false);
assert.deepEqual(ctx.shortscout,{mode:'absent'});assert.deepEqual(ctx.member,['club-room','gainers','reader']);
// A name, without Social.
const member=(await one(`select longboard_chat_link_member($1,'Bea Buyer',null) r`,[club])).r;
assert.equal(member.display_name,'Bea Buyer');
assert.equal((await open('buyer@example.test',session())).member,true);

// 6. Expiry, future start and revocation.
await db.query(`update member_entitlements set ends_at=now()-interval '1 minute' where person_id=$1 and entitlement_key='gainers'`,[person]);
assert.equal(await has(club,'gainers'),false,'an ended entitlement closes the room');
assert.deepEqual(await keys(club),['club-room','reader']);
await db.query(`update member_entitlements set ends_at=now()+interval '1 day',starts_at=now()+interval '1 hour' where person_id=$1 and entitlement_key='gainers'`,[person]);
assert.equal(await has(club,'gainers'),false,'not started yet');
await db.query(`update member_entitlements set starts_at=now()-interval '1 day' where person_id=$1 and entitlement_key='gainers'`,[person]);
assert.equal(await has(club,'gainers'),true);
await db.query(`update member_entitlements set revoked_at=now(),revoked_by='admin' where person_id=$1`,[person]);
assert.equal(await has(club,'gainers'),false,'revoked');
assert.deepEqual(await keys(club),[]);
assert.equal((await open('buyer@example.test',session())).status,'no_access','no active access: no new session');
await assert.rejects(db.query(`update member_entitlements set revoked_at=now(),revoked_by=null where person_id=$1`,[person]),/check/,'revoked_by goes with revoked_at');
await db.query(`update member_entitlements set revoked_at=null,revoked_by=null where person_id=$1`,[person]);

// 7. A Longboard member who buys: matched by profile email, refused on the club sign-up.
const mal=(await one(`insert into member_people(email) values('mallory@example.test') returning id`)).id;
await db.query(`insert into member_entitlements(person_id,entitlement_key,granted_by,note) values($1,'reader','admin','comp')`,[mal]);
assert.deepEqual(await keys(mallory),['reader']);
assert.deepEqual((await one('select chat_longboard_request_context($1,$2) r',[mallory,people[2].session])).r.member,['reader']);
assert.equal((await open('mallory@example.test',session())).status,'longboard_account');
// Mallory keeps the Gainers room she already had (as a Longboard member), with or without it.
assert.equal(await has(mallory,'gainers'),true);
// Alice (admin) and Bob are unchanged.
for(const room of rooms)assert.deepEqual([await has(bob,room),await eligible(bob,room)],beforeAnswers[bob+room]);

// 8. A bot never has entitlements, even with a matching email.
const wren='00000000-0000-4000-8000-0000000000aa';
await db.query('insert into auth.users(id) values($1)',[wren]);
await db.query(`insert into public.profiles(id,email,role) values($1,'wren@bot.longboard.invalid','user')`,[wren]);
await db.query('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[wren]);
await db.query(`insert into chat_bot_accounts(account_id,allowed_rooms) values($1,'{developers}')`,[wren]);
const wp=(await one(`insert into member_people(email) values('wren@bot.longboard.invalid') returning id`)).id;
await db.query(`insert into member_entitlements(person_id,entitlement_key,granted_by) values($1,'gainers','admin')`,[wp]);
assert.deepEqual(await keys(wren),[]);assert.equal(await has(wren,'gainers'),false);
// Stripe rows need a purchase; admin rows don't.
await assert.rejects(db.query(`insert into member_entitlements(person_id,entitlement_key,granted_by) values($1,'gainers','stripe')`,[wp]),/check/);

// 9. Stripe event ids: one row each.
await db.query(`insert into member_stripe_events(event_id,type) values('evt_test_1','checkout.session.completed')`);
await assert.rejects(db.query(`insert into member_stripe_events(event_id,type) values('evt_test_1','checkout.session.completed')`),/duplicate|unique/);

// 10. Rollback with data in place, then re-apply.
await db.exec(down+'\n-- with rows');
assert.deepEqual(await definitions(),before);
assert.equal(await has(club,'gainers'),false,'after the rollback a club-only account reaches no room');
await db.exec(up+'\n-- once more');
assert.deepEqual(await definitions(),after);
console.log('chat-members-database: ok');
process.exit(0);
