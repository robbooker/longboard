// HEALTH-2026-10-19-3 database check: the faster bell (chat_activity_inbox) and the ShortScout
// identity helpers return exactly what the previous definitions returned, on the full migration
// chain from the mobile fixture. The previous definitions are loaded from the rollback file under
// fixture_old_* names and compared for several people, room lists and room levels. Synthetic data only.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
// Keep the database setup and every migration; drop the HTTP server.
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-activity-inbox-fast-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const q=async(sql,args=[])=>(await db.query(sql,args)).rows,one=async(sql,args=[])=>(await q(sql,args))[0];

// The new definitions are plpgsql (cached plans); the old ones come back from the rollback file.
for(const fn of ['chat_activity_inbox','chat_shortscout_binding','chat_shortscout_authorized_identity','chat_shortscout_identity'])
 assert.equal((await one("select l.lanname from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=$1::regproc",['public.'+fn])).lanname,'plpgsql',fn);
const rollback=await readFile(`${root}/supabase/rollbacks/20261019150000_chat_activity_inbox_fast.down.sql`,'utf8');
const old=rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION'))
 .replace(/public\.(chat_activity_inbox|chat_shortscout_binding|chat_shortscout_authorized_identity|chat_shortscout_identity)\(/g,'public.fixture_old_$1(');
await db.exec(old);

const account=async p=>(await one('select id from chat_accounts where longboard_user_id=$1',[p.id])).id;
const [alice,bob,mallory]=await Promise.all(people.map(account));
const [aliceMember,bobMember,malloryMember]=people.map(p=>p.member.id);
// A ShortScout-only account (no Longboard profile) with an allowed mastermind authorization.
const ss='00000000-0000-4000-8000-0000000000aa',ssSubject='10000000-0000-4000-8000-0000000000aa';
await q('insert into chat_accounts(id) values($1)',[ss]);
await q("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$2,'mastermind')",[ssSubject,ss]);
await q("insert into chat_shortscout_authorization(subject,decision,membership_level,valid_until) values($1,'allow','mastermind',now()+interval '1 day') on conflict(subject) do update set decision=excluded.decision,membership_level=excluded.membership_level,valid_until=excluded.valid_until",[ssSubject]);
const ssMember=(await one("select longboard_chat_link_member($1,'SS member',null) m",[ss])).m.id;

const post=(member,name,room,body,reply=null)=>one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id) values($1,$1,$2,$3,$4,$5) returning id",[member,name,body,room,reply]);
const react=(message,member)=>q("insert into longboard_chat_reactions(message_id,guest_id,active) values($1,$2,true)",[message,member]);
// Mentions in several rooms, a thread with replies, an announcement for everyone.
await post(bobMember,'Bob','main','@Alice main check');
await post(bobMember,'Bob','social','@Alice @Mallory social check');
await post(malloryMember,'Mallory','social','@Alice from Mallory');
const root1=await post(aliceMember,'Alice','social','Alice thread root');
await post(bobMember,'Bob','social','Bob replies',root1.id);
await post(malloryMember,'Mallory','social','Mallory replies',root1.id);
await post(aliceMember,'Alice','lb-announcements','Announcement for everyone');
await post(ssMember,'SS member','shortscout','@Alice shortscout check');
const malloryRoot=await post(malloryMember,'Mallory','social','Mallory thread root');
await post(aliceMember,'Alice','social','Alice replies to Mallory',malloryRoot.id);
await post(bobMember,'Bob','social','Bob replies to Mallory too',malloryRoot.id);
// Reactions on Alice's and Bob's messages.
const aliceMain=await post(aliceMember,'Alice','main','React to Alice');
const bobSocial=await post(bobMember,'Bob','social','React to Bob');
for(const m of [bobMember])await react(aliceMain.id,m);
const aliceSocial=await post(aliceMember,'Alice','social','React to Alice in social');
for(const m of [bobMember,malloryMember,ssMember])await react(aliceSocial.id,m);
for(const m of [aliceMember,malloryMember])await react(bobSocial.id,m);
await q("update chat_room_mentions set read_at=now() where id=(select id from chat_room_mentions where account_id=$1 order by seq limit 1)",[alice]);
// DMs: accepted (both ways), pending, one with a member Alice will block; pins on two of them.
// The fixture already has Bob's request to Alice: reuse a pair's conversation when there is one.
const dm=async(a,b,status='accepted')=>(await one("update longboard_chat_conversations set status=$3 where least(requester_id,recipient_id)=least($1::uuid,$2::uuid) and greatest(requester_id,recipient_id)=greatest($1::uuid,$2::uuid) returning id",[a,b,status]))?.id
 ??(await one("insert into longboard_chat_conversations(requester_id,recipient_id,status) values($1,$2,$3) returning id",[a,b,status])).id;
const send=(c,sender,body)=>one('insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,$3,gen_random_uuid()) returning *',[c,sender,body]);
const ab=await dm(aliceMember,bobMember),am=await dm(malloryMember,aliceMember),bm=await dm(bobMember,malloryMember,'pending');
const fromAlice=await send(ab,aliceMember,'Hi Bob');await send(ab,bobMember,'Hi Alice');await send(ab,bobMember,'Are you there?');
await send(am,malloryMember,'Hello from Mallory');await send(bm,bobMember,'Hello Mallory');
for(const c of [ab,am])await q('insert into chat_conversation_pins(account_id,conversation_id) values($1,$2)',[alice,c]);
await q("insert into chat_reaction_notifications(account_id,reactor_member_id,dm_message_id,emoji) values($1,$2,$3,'heart')",[alice,bobMember,fromAlice.id]);

const all8=['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings'];
const roomLists=[all8,['main','social','lb-announcements','gainers','lb-recordings'],['social','shortscout','ss-announcements','gainers','ss-recordings'],['main','gainers'],['social'],[],null,['social','nope',null]];
const actors=[alice,bob,mallory,ss,'00000000-0000-4000-8000-0000000000ff'];
const level=(who,room,l)=>l==='all'?q('delete from chat_room_notification_levels where account_id=$1 and room_slug=$2',[who,room]):q("insert into chat_room_notification_levels(account_id,room_slug,level) values($1,$2,$3) on conflict(account_id,room_slug) do update set level=excluded.level",[who,room,l]);
let checks=0;
const compare=async label=>{
 for(const who of actors)for(const rooms of roomLists){
  const row=await one('select chat_activity_inbox($1,$2) new,fixture_old_chat_activity_inbox($1,$2) old',[who,rooms]);
  assert.deepEqual(row.new,row.old,`${label}: ${who} ${JSON.stringify(rooms)}`);checks++;
 }
};
await compare('no levels, no blocks');
const a=(await one('select chat_activity_inbox($1,$2) r',[alice,all8])).r;
assert.ok(a.mentions.length>0&&a.mentionCount>0&&a.reactions.length>0&&a.reactionCount>0&&a.dms.length>0&&Object.keys(a.pinnedDmUnread).length===2,'fixture covers every part of the bell');
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[aliceMember,malloryMember]);
await compare('Alice blocks Mallory');
await level(alice,'social','muted');await level(alice,'main','mentions');await level(alice,'lb-announcements','mentions');await level(bob,'social','mentions');
await compare('room levels and a block');
await q('delete from longboard_chat_blocks');await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[bobMember,aliceMember]);
await q('update chat_reaction_notifications set read_at=now() where account_id=$1 and room_message_id is not null',[alice]);
await compare('Bob blocks Alice, room reactions read');
await q('update chat_shortscout_authorization set valid_until=now()-interval \'1 minute\' where subject=$1',[ssSubject]);
await compare('ShortScout authorization expired');

// The helpers: same answers for every account, with and without a valid authorization.
await q('update chat_shortscout_authorization set valid_until=now()+interval \'1 day\' where subject=$1',[ssSubject]);
for(const fn of ['chat_shortscout_binding','chat_shortscout_authorized_identity','chat_shortscout_identity']){
 const rows=await q(`select a.id,public.${fn}(a.id) new,public.fixture_old_${fn}(a.id) old from chat_accounts a union all select null,public.${fn}(null),public.fixture_old_${fn}(null)`);
 for(const r of rows){assert.deepEqual(r.new,r.old,`${fn} ${r.id}`);checks++;}
}
assert.equal((await one('select public.chat_shortscout_identity($1) i',[ss])).i.membership_level,'mastermind');

const time=async fn=>{for(let i=0;i<20;i++)await q(`select ${fn}($1,$2)`,[alice,all8]);const t=performance.now();for(let i=0;i<200;i++)await q(`select ${fn}($1,$2)`,[alice,all8]);return (performance.now()-t)/200;};
const before=await time('fixture_old_chat_activity_inbox'),after=await time('chat_activity_inbox');
console.log(`bell call (PGlite, 200 runs): before ${before.toFixed(2)} ms, after ${after.toFixed(2)} ms`);
console.log(`PASS fast bell: ${checks} comparisons identical to the previous definitions (people x room lists x levels/blocks/authorization), helpers identical`);
