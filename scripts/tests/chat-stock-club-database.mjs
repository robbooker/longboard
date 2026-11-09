// #386 database check: the Booker Stock Club room on top of #384's members tables. Runs on the full
// migration chain from the mobile fixture. Synthetic data only.
//  - the rollback puts back exactly #384's function bodies (and #384's own rollback still works
//    after it); the migration re-applies cleanly;
//  - who has the room: every current Gainers member (Longboard profiles, ShortScout paid tiers, a
//    'gainers' entitlement), an account with only a 'club-room' entitlement, nobody else; a bot only
//    when its list names the room;
//  - post_chat_club_pick: the first automatic pick posts, the same stock never posts twice that day,
//    an admin pick posts and locks the day; nobody else can post, reply or edit in the room.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`\nexport {db,people};`;
const target=new URL(`.chat-stock-club-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const file=async path=>readFile(`${root}/supabase/${path}`,'utf8');
const [alice,bob]=people.map(p=>p.id);
const scout='00000000-0000-4000-8000-000000000099';
const has=async(who,room)=>(await one('select chat_account_has_room($1,$2) r',[who,room])).r;
const eligible=async(who,room)=>(await one('select chat_account_room_recipient_eligible($1,$2) r',[who,room])).r;
const both=async(who,room)=>[await has(who,room),await eligible(who,room)];
const functions=['chat_account_has_room','chat_account_room_recipient_eligible','longboard_chat_room_member_count','longboard_chat_room_member_names','longboard_chat_room_members','longboard_chat_room_members_ordered'];
const definitions=async()=>(await db.query(`select proname,pg_get_functiondef(oid) d from pg_proc where proname=any($1) order by proname`,[functions])).rows;
const club={up:await file('migrations/20261109120000_chat_stock_club.sql'),down:await file('rollbacks/20261109120000_chat_stock_club.down.sql')};
// #341 (20261110140000_chat_runner_watch.sql) is stacked on this one and changes the same functions;
// its rollback comes first, so this file checks #386 and #384 on their own.
await db.exec(await file('rollbacks/20261110140000_chat_runner_watch.down.sql'));
// #390 (20261109130000_member_welcome.sql) has tables that point at #384's, so it goes before #384's rollback.
await db.exec(await file('rollbacks/20261109130000_member_welcome.down.sql'));
const members={up:await file('migrations/20261109100000_members_stripe.sql'),down:await file('rollbacks/20261109100000_members_stripe.down.sql')};

// 1. The stack rolls back and re-applies in order.
const withClub=await definitions();
await db.exec(club.down);
const onlyMembers=await definitions();
assert.notDeepEqual(onlyMembers,withClub,'the club migration changes the functions');
assert.equal((await one(`select to_regclass('public.chat_club_picks') r`)).r,null);
await db.exec(members.down);
const neither=await definitions();
await db.exec(members.up+'\n-- again');
assert.deepEqual(await definitions(),onlyMembers,"the club rollback leaves exactly #384's bodies");
await db.exec(club.up+'\n-- again');
assert.deepEqual(await definitions(),withClub,'the club migration re-applies cleanly');
assert.notDeepEqual(neither,onlyMembers);

// 2. Who has the room.
for(const who of [alice,bob,scout])assert.deepEqual(await both(who,'club'),await both(who,'gainers'),`${who}: the same as Gainers`);
assert.deepEqual(await both(bob,'club'),[true,true],'a Longboard member');
assert.deepEqual(await both(scout,'club'),[true,true],'a ShortScout mastermind');
const buyer=async(email,keys)=>{
 const account=crypto.randomUUID();
 await db.query('insert into chat_accounts(id) values($1)',[account]);
 const person=(await one(`insert into member_people(email,chat_account_id) values($1,$2) returning id`,[email,account])).id;
 for(const key of keys)await db.query(`insert into member_entitlements(person_id,entitlement_key,granted_by) values($1,$2,'admin')`,[person,key]);
 return {account,person};
};
const clubOnly=await buyer('club@example.test',['club-room']);
assert.deepEqual(await both(clubOnly.account,'club'),[true,true],'club-room opens the room');
assert.deepEqual(await both(clubOnly.account,'gainers'),[false,false],'and not Gainers');
const gainersOnly=await buyer('gainers@example.test',['gainers']);
assert.deepEqual(await both(gainersOnly.account,'club'),[true,true],'a gainers entitlement keeps the Gainers rule');
const readerOnly=await buyer('reader@example.test',['reader']);
assert.deepEqual(await both(readerOnly.account,'club'),[false,false],'another entitlement does not');
await db.query(`update member_entitlements set revoked_at=now(),revoked_by='admin' where person_id=$1`,[clubOnly.person]);
assert.deepEqual(await both(clubOnly.account,'club'),[false,false],'revoked');
const bot=crypto.randomUUID();
await db.query('insert into chat_accounts(id) values($1)',[bot]);
await db.query(`insert into chat_bot_accounts(account_id,allowed_rooms) values($1,'{developers}')`,[bot]);
assert.deepEqual(await both(bot,'club'),[false,false],'a bot without the room');

// 3. Posting.
const day='2026-11-06';
const post=(ticker,source)=>one(`select post_chat_club_pick($1,$2,$3,$4,$5::jsonb) r`,[day,ticker,source,`#1 stock of the day: ${ticker}`,JSON.stringify({ticker})]).then(x=>x.r);
const first=await post('AAAA','auto');assert.equal(first.posted,true);
assert.deepEqual(await post('AAAA','auto'),{posted:false,reason:'already_posted'});
assert.equal((await post('BBBB','auto')).posted,true);
assert.deepEqual(await post('AAAA','auto'),{posted:false,reason:'already_posted'},'never the same stock twice in a day');
assert.equal((await post('CCCC','admin')).posted,true,'an admin pick');
assert.deepEqual(await post('DDDD','auto'),{posted:false,reason:'locked'},'locks the day');
assert.equal((await post('AAAA','admin')).posted,true,'an admin can repeat a stock');
const row=await one(`select room_slug,author_label,bot_slug,member_id,guest_id from longboard_chat_messages where id=$1`,[first.messageId]);
assert.deepEqual(row,{room_slug:'club',author_label:'Booker Stock Club',bot_slug:'club',member_id:null,guest_id:null});
await assert.rejects(post('lower','auto'),/invalid_club_pick/);
const bobMember=(await one('select id from longboard_chat_members where user_id=$1',[bob])).id;
await assert.rejects(db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'club','Bob','hi')`,[bobMember]),/club_read_only|check/,'a member cannot post');
await assert.rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('club','Booker Stock Club','forged','club')`),/club_read_only/,'no post without a pick');
await assert.rejects(db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,'social','Bob','reply',$2)`,[bobMember,first.messageId]),/club_read_only/,'no replies, even from another room');
await assert.rejects(db.query(`update longboard_chat_messages set body='edited' where id=$1`,[first.messageId]),/club_read_only/,'no edits');
await db.query('delete from longboard_chat_messages where id=$1',[first.messageId]);

// 4. Rolling back with posts in place, then both migrations back again.
await db.exec(club.down+'\n-- with rows');
assert.deepEqual(await definitions(),onlyMembers);
assert.equal((await one(`select count(*)::int n from longboard_chat_messages where room_slug='club'`)).n,0);
await db.exec(club.up+'\n-- once more');
assert.deepEqual(await definitions(),withClub);
console.log('chat-stock-club-database: ok');
process.exit(0);
