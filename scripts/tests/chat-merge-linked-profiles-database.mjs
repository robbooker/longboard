// #444 database check: merging a linked Longboard + ShortScout pair into one chat profile, on the
// full migration chain (the mobile fixture, which runs every migration). Synthetic data only.
// Bob (Longboard) is linked to "Scout Tester" (ShortScout). Seeded: overlapping likes and
// reactions, a DM between the two profiles, both profiles talking to Alice, Scout alone with
// Mallory, mentions, stored tags, name history, read positions, a single-choice poll, a block,
// pins, a push device and a live ShortScout sign-in. Checks: everything moves, no duplicates,
// access, the @ list, the ShortScout sign-in landing on Bob, the guard, the report, a catch-up
// run, and that undo puts every table back exactly.
//   node scripts/tests/chat-merge-linked-profiles-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people,scoutId,scoutToken,scoutMember};`;
const target=new URL(`.chat-merge-profiles-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people,scoutId,scoutToken,scoutMember;try{({db,people,scoutId,scoutToken,scoutMember}=await import(target.href));}finally{await unlink(target);}
const q=async(sql,args=[])=>(await db.query(sql,args)).rows,one=async(sql,args=[])=>(await q(sql,args))[0];
let checks=0;const check=(c,m)=>{assert.ok(c,m??"check failed");checks++;};const eq=(a,b,m)=>{assert.deepEqual(a,b,m??`${JSON.stringify(a)} != ${JSON.stringify(b)}`);checks++;};
const sha=(s)=>createHash('sha256').update(s).digest('hex');

const [alice,bob,mallory]=people;
const am=alice.member.id,bm=bob.member.id,mm=mallory.member.id,sm=scoutMember.id;
// ---- The link (as consume_chat_login writes it when Bob connects ShortScout) ----
await q('insert into chat_accounts(id,longboard_user_id) values($1,$1) on conflict do nothing',[bob.id]);
await q("insert into chat_shortscout_membership_links(lb_account_id,source_account_id,subject) values($1,$2,$2)",[bob.id,scoutId]);
const has=async(account,room)=>(await one('select chat_account_has_room($1,$2) ok',[account,room])).ok;
check(await has(bob.id,'shortscout'),'Bob already gets the SS rooms through the link');

// ---- Seed both profiles' history ----
const post=async(member,name,body,room='social')=>(await one('insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,client_id) values($1,$1,$2,$3,$4,$5) returning id',[member,name,body,room,randomUUID()])).id;
const bobMsg=await post(bm,'Bob','Bob in social');
const scoutMsgs=[await post(sm,'Scout Tester','Scout in social'),await post(sm,'Scout Tester','Scout in the SS room','shortscout')];
const aliceMsg=await post(am,'Alice','Alice says hi');
const sameClient=randomUUID();
await q('update longboard_chat_messages set client_id=$1 where id in ($2,$3)',[sameClient,bobMsg,scoutMsgs[0]]); // the same retry id on both profiles
// Likes: both liked Alice's message (Bob's like is off, Scout's on); Scout alone liked Bob's.
await q('insert into longboard_chat_reactions(message_id,guest_id,active) values($1,$2,false),($1,$3,true),($4,$3,true)',[aliceMsg,bm,sm,bobMsg]);
await q("insert into chat_message_reaction_choices(room_message_id,member_id,emoji,active) values($1,$2,'heart',true),($1,$3,'heart',true),($1,$3,'laugh',true)",[aliceMsg,bm,sm]);
eq(Number((await one('select count(*) n from chat_reaction_notifications where account_id=$1 and reactor_member_id=$2',[bob.id,sm])).n)>0,true,'Scout\'s like alerted Bob');
// Tags and mentions: Alice tagged Scout; the stored tag and Scout's notification.
const tagMsg=await post(am,'Alice','@Scout Tester welcome over');
eq((await q('select member_id from chat_message_tags where message_id=$1',[tagMsg])).map(r=>r.member_id),[sm]);
eq((await q("select account_id from chat_room_mentions where message_id=$1 and category='mention'",[tagMsg])).map(r=>r.account_id),[scoutId]);
// Read positions in the same room (Scout read further) and in the SS room (Scout only).
await q("delete from chat_room_reads where account_id=any($1) and room_slug in ('social','shortscout')",[[bob.id,scoutId]]);
await q("insert into chat_room_reads(account_id,room_slug,through_seq) values($1,'social',5),($2,'social',9),($2,'shortscout',3)",[bob.id,scoutId]);
await q("update chat_room_reads set through_seq=5 where account_id=$1 and room_slug='social'",[bob.id]);
await q("update chat_room_reads set through_seq=9 where account_id=$1 and room_slug='social'",[scoutId]);
// A single-choice poll both voted in.
const poll=await one("insert into chat_polls(message_id,question,multi,created_by) values($1,'Which?',false,$2) returning id",[aliceMsg,am]);
let pollId=null,optA=null,optB=null;
if(poll){pollId=poll.id;
 const opts=await q("insert into chat_poll_options(poll_id,label,position) values($1,'A',0),($1,'B',1) returning id",[pollId]);
 if(opts.length){[optA,optB]=opts.map(o=>o.id);await q('insert into chat_poll_votes(poll_id,option_id,member_id) values($1,$2,$3),($1,$4,$5)',[pollId,optA,bm,optB,sm]);}}
// Pins and a push device on the ShortScout account; a block between the two profiles.
await q("insert into chat_conversation_pins(account_id,room_slug) values($1,'shortscout')",[scoutId]);
await q("insert into chat_push_subscriptions(account_id,endpoint,p256dh,auth) values($1,'https://push.example.test/scout','k','a')",[scoutId]);
await q('insert into longboard_chat_blocks(blocker_id,blocked_id) values($1,$2)',[sm,bm]);
// DMs: Scout <-> Bob (with oneself after the merge), Scout <-> Alice and Bob <-> Alice (one
// conversation after), Scout <-> Mallory (moves as it is).
const conv=async(a,b,status='accepted')=>{const found=await one('select id from longboard_chat_conversations where least(requester_id,recipient_id)=least($1::uuid,$2::uuid) and greatest(requester_id,recipient_id)=greatest($1::uuid,$2::uuid)',[a,b]);
 if(found){await q('update longboard_chat_conversations set status=$2 where id=$1',[found.id,status]);return found.id;}
 return (await one('insert into longboard_chat_conversations(requester_id,recipient_id,status) values($1,$2,$3) returning id',[a,b,status])).id;};
const dm=async(c,sender,body)=>(await one('insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values($1,$2,$3,$4) returning id,seq',[c,sender,randomUUID(),body]));
const selfConv=await conv(sm,bm);await dm(selfConv,sm,'note to my other self');
const bobAlice=await conv(bm,am,'pending');await dm(bobAlice,bm,'Bob to Alice');
const scoutAlice=await conv(am,sm);const sa1=await dm(scoutAlice,am,'Alice to Scout');await dm(scoutAlice,sm,'Scout to Alice');
await q("insert into chat_message_reaction_choices(dm_message_id,member_id,emoji,active) values($1,$2,'heart',true)",[sa1.id,sm]);
await q('update longboard_chat_conversations set requester_read_seq=$2,recipient_read_seq=$2 where id=$1',[scoutAlice,sa1.seq]);
const scoutMallory=await conv(sm,mm);await dm(scoutMallory,mm,'Mallory to Scout');
await q("insert into chat_favorites(account_id,conversation_id) values($1,$2) on conflict do nothing",[scoutId,scoutAlice]).catch(()=>{});

// Bob posted last, so his Longboard name and picture stay (the rule: the profile used most recently).
await post(bm,'Bob','Bob, most recently');

// ---- The read-only report ----
const report=await q(await readFile(`${root}/scripts/sql/chat-merge-linked-profiles-report.sql`,'utf8'));
const row=report.find(r=>r.kept_name==='Bob');
check(row&&row.mode==='merge'&&row.retired_name==='Scout Tester'&&row.name_from==='Longboard','the report lists the pair');
eq([Number(row.dm_between_the_two),Number(row.dm_partners_in_both),Number(row.likes_by_both),Number(row.reactions_by_both),Number(row.read_positions_in_both)>=1],[1,1,1,1,true]);
check(Number(row.rows_to_move)>=20,`rows to move: ${row.rows_to_move}`);

// ---- Snapshot every table, then merge ----
const skip=new Set(['chat_profile_merges','chat_profile_merge_log','chat_activity_counters','longboard_chat_room_event_heads','longboard_chat_room_reaction_events']);
const tables=(await q("select c.oid::regclass::text t from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by 1")).map(r=>r.t).filter(t=>!skip.has(t));
const snapshot=async()=>{const s={};for(const t of tables){s[t]=(await q(`select to_jsonb(x)::text j from ${t} x`)).map(r=>r.j).sort();}return s;};
const before=await snapshot();
const merged=(await one('select chat_merge_next_linked_profile() r')).r;
check(merged&&merged.mode==='merge'&&merged.kept==='Bob'&&merged.retired==='Scout Tester'&&merged.nameFrom==='longboard',JSON.stringify(merged));
eq((await one('select chat_merge_next_linked_profile() r')).r,null,'one pair per call, then nothing left');

// Nothing points at the retired profile any more.
for(const {table_name,column_name} of await q('select table_name::text,column_name from chat_merge_member_columns()'))
 eq(Number((await one(`select count(*) n from ${table_name} where ${column_name}=$1`,[sm])).n),0,`${table_name}.${column_name}`);
for(const {table_name,column_name} of await q("select table_name::text,column_name from chat_merge_account_columns() where action='move'"))
 eq(Number((await one(`select count(*) n from ${table_name} where ${column_name}=$1`,[scoutId])).n),0,`${table_name}.${column_name}`);
// Messages and the projection: Scout's messages are Bob's.
eq((await q('select member_id,guest_id from longboard_chat_messages where id=any($1)',[scoutMsgs])).map(r=>[r.member_id,r.guest_id]),[[bm,bm],[bm,bm]]);
const clients=await q('select client_id from longboard_chat_messages where member_id=$1 and client_id is not null',[bm]);
eq(new Set(clients.map(r=>r.client_id)).size,clients.length,'no duplicate client ids');
// Likes: one per message, on if either had it on. Reactions: no duplicates.
eq(await q('select message_id,active from longboard_chat_reactions where guest_id=$1 and message_id=any($2) order by message_id',[bm,[aliceMsg,bobMsg]]),[{message_id:bobMsg,active:true},{message_id:aliceMsg,active:true}].sort((a,b)=>a.message_id<b.message_id?-1:1));
eq((await q("select emoji from chat_message_reaction_choices where member_id=$1 and room_message_id=$2 order by emoji",[bm,aliceMsg])).map(r=>r.emoji),['heart','laugh']);
eq(Number((await one("select count(*) n from chat_reaction_notifications where account_id=$1 and reactor_member_id=$2",[bob.id,bm])).n),0,'no alert for liking one\'s own message');
// Tags, mentions, names.
eq((await q('select member_id from chat_message_tags where message_id=$1',[tagMsg])).map(r=>r.member_id),[bm]);
eq((await q("select account_id from chat_room_mentions where message_id=$1",[tagMsg])).map(r=>r.account_id),[bob.id]);
eq((await q('select display_name from chat_member_names where member_id=$1 order by display_name',[bm])).map(r=>r.display_name),['Bob','Scout Tester']);
// Read positions: furthest kept; SS room moved.
eq(await q("select room_slug,through_seq::int from chat_room_reads where account_id=$1 and room_slug in ('social','shortscout') order by room_slug",[bob.id]),[{room_slug:'shortscout',through_seq:3},{room_slug:'social',through_seq:9}]);
if(optA)eq((await q('select option_id from chat_poll_votes where poll_id=$1 and member_id=$2',[pollId,bm])).map(r=>r.option_id),[optA],'single-choice poll keeps the Longboard vote');
eq(Number((await one('select count(*) n from longboard_chat_blocks where blocker_id=$1 or blocked_id=$1',[bm])).n),0,'the block between the two is gone');
// DMs.
eq(Number((await one('select count(*) n from longboard_chat_conversations where id=$1',[selfConv])).n),0,'the DM with oneself is removed');
eq(Number((await one('select count(*) n from longboard_chat_conversations where id=$1',[scoutAlice])).n),0);
const ba=await one('select status,requester_read_seq::int r,recipient_read_seq::int c from longboard_chat_conversations where id=$1',[bobAlice]);
eq(ba.status,'accepted','an accepted request stays accepted');
eq((await q('select body from longboard_chat_direct_messages where conversation_id=$1 order by seq',[bobAlice])).map(r=>r.body).slice(-3),['Bob to Alice','Alice to Scout','Scout to Alice']);
check(ba.r>=sa1.seq&&ba.c>=sa1.seq,'read positions take the furthest');
eq(Number((await one("select count(*) n from chat_message_reaction_choices where dm_message_id=$1 and member_id=$2",[sa1.id,bm])).n),1);
eq((await one('select requester_id from longboard_chat_conversations where id=$1',[scoutMallory])).requester_id,bm);
eq(Number((await one('select count(*) n from longboard_chat_conversations where $1 in (requester_id,recipient_id)',[am])).n),1,'Alice has one conversation with the person');
// The retired row stays, marked, on an empty placeholder account.
const retired=await one('select user_id,merged_into,display_name from longboard_chat_members where id=$1',[sm]);
eq([retired.merged_into,retired.display_name],[bm,'Scout Tester']);
check(retired.user_id!==scoutId&&!(await has(retired.user_id,'social')),'no rooms for the placeholder');
eq(await one('select id from longboard_chat_members where user_id=$1',[scoutId]),undefined);

// ---- Access ----
for(const room of ['social','shortscout','ss-announcements','gainers'])check(await has(bob.id,room),`Bob keeps ${room}`);
const ss=(await q("select id from longboard_chat_room_members_ordered($1,'shortscout')",[alice.id])).map(r=>r.id);
check(ss.includes(bm)&&!ss.includes(sm),'the SS member list shows Bob, not the retired profile');
// The live ShortScout sign-in is Bob's now, with ShortScout access only.
const ctx=(await one('select chat_session_request_context($1) c',[sha(scoutToken)])).c;
eq([ctx.mode,ctx.account,ctx.longboard,ctx.role,ctx.boardroom],['ok',bob.id,false,null,false]);
check(['ready','unavailable'].includes(ctx.shortscout.mode)&&ctx.shortscout.binding?.bridged===true,JSON.stringify(ctx.shortscout));
// ---- The @ list: once, found by either name ----
const at=async(text)=>(await q('select display_name,previous_name from chat_tag_suggestions($1,$2,10)',[text,[]]));
eq(await at('Bo'),[{display_name:'Bob',previous_name:null}]);
eq(await at('Scout'),[{display_name:'Bob',previous_name:'Scout Tester'}]);
eq((await q("select member_id from chat_tag_lookup($1,'{social}','{scout tester}','{}')",[alice.id])).length,0,'the old name is no one now');
await db.exec('begin');
const fresh=await post(am,'Alice','@Scout Tester are you there? @Bob yes');
eq((await q('select member_id from chat_message_tags where message_id=$1',[fresh])).map(r=>r.member_id),[bm],'a new tag of the old name is plain text');
await db.exec('rollback');

// ---- A new ShortScout sign-in lands on Bob's profile ----
const login=async(subject)=>{const state=sha(randomUUID()),code=sha(randomUUID()),challenge='c'.repeat(43),session=sha(randomUUID());
 await q("insert into chat_login_requests(state_hash,challenge,return_room,subject,membership_level,code_hash) values($1,$2,'social',$3,'mastermind',$4)",[state,challenge,subject,code]);
 const r=(await one('select consume_chat_login($1,$2,$3,null,$4) r',[state,code,challenge,session])).r;
 return {r,session:await one('select account_id,shortscout_only from chat_sessions where token_hash=$1',[session])};};
await db.exec('begin'); // (rolled back: a sign-in refreshes the identity, which undo doesn't own)
const signed=await login(scoutId);
eq([signed.r.accountId,signed.session.account_id,signed.session.shortscout_only],[bob.id,bob.id,true]);
await assert.rejects(()=>q("select longboard_chat_link_member($1,'Scout Again',null)",[scoutId]),/shortscout_profile_linked/);checks++;
await db.exec('rollback');

// ---- A catch-up run picks up a straggler ----
// The retired profile can't post any more (no rooms); a write that raced the merge is simulated.
await assert.rejects(()=>post(sm,'Scout Tester','too late'),/chat_room_forbidden/);checks++;
await db.exec('set session_replication_role=replica');
const late=await post(sm,'Scout Tester','sent while the merge ran');
await db.exec('set session_replication_role=origin');
const rerun=(await one('select chat_merge_linked_profile($1) r',[bob.id])).r;
check(rerun.rerun&&rerun.mergeId===merged.mergeId&&rerun.moved>=1,JSON.stringify(rerun));
eq((await one('select member_id from longboard_chat_messages where id=$1',[late])).member_id,bm);

// ---- Undo: every table exactly as before (minus what happened after the merge) ----
await db.exec('set session_replication_role=replica');await q('delete from longboard_chat_messages where id=$1',[late]);await db.exec('set session_replication_role=origin');
// (the catch-up run logged the straggler's moves; deleting it first means undo skips those)
const undone=(await one('select chat_unmerge_linked_profile($1) r',[merged.mergeId])).r;
check(undone.restored>20,JSON.stringify(undone));
const after=await snapshot();
for(const t of tables)eq(after[t],before[t],`${t} is back exactly`);
// Merging again after an undo works.
const again=(await one('select chat_merge_next_linked_profile() r')).r;
check(again.mode==='merge'&&again.mergeId!==merged.mergeId);
// ---- adopt: only a ShortScout profile; it moves to the Longboard account as it is ----
const doraLb='00000000-0000-4000-8000-0000000000d4',doraSs='00000000-0000-4000-8000-0000000000d5';
await q('insert into auth.users values($1)',[doraLb]);await q("insert into profiles values($1,'dora@example.test','user')",[doraLb]);
await q('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[doraLb]);await q('insert into chat_accounts(id) values($1)',[doraSs]);
await q("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$1,'mastermind')",[doraSs]);
const doraMember=(await one("select longboard_chat_link_member($1,'Dora',null) m",[doraSs])).m.id;
await q("insert into chat_shortscout_membership_links(lb_account_id,source_account_id,subject) values($1,$2,$2)",[doraLb,doraSs]);
const adopted=(await one('select chat_merge_next_linked_profile() r')).r;
eq([adopted.mode,adopted.kept],['adopt','Dora']);
eq((await one('select user_id from longboard_chat_members where id=$1',[doraMember])).user_id,doraLb,'the profile is the Longboard account\'s now');
await db.exec('begin');
eq((await login(doraSs)).session.account_id,doraLb,'and a ShortScout sign-in finds it there');
await db.exec('rollback');
const undoneDora=(await one('select chat_unmerge_linked_profile($1) r',[adopted.mergeId])).r;
eq([undoneDora.skipped,(await one('select user_id from longboard_chat_members where id=$1',[doraMember])).user_id],[0,doraSs]);
// ---- Which name and picture stay: the profile posted from most recently ----
let nth=0;
const pair=async(lbName,ssName,{lbAvatar=null,ssAvatar=null}={})=>{
 nth++;const lb=`00000000-0000-4000-8000-0000000001${String(nth).padStart(2,'0')}`,ss=`00000000-0000-4000-8000-0000000002${String(nth).padStart(2,'0')}`;
 await q('insert into auth.users values($1)',[lb]);await q("insert into profiles values($1,$2,'user')",[lb,`pair${nth}@example.test`]);
 await q('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[lb]);await q('insert into chat_accounts(id) values($1)',[ss]);
 await q("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$1,'mastermind')",[ss]);
 const k=(await one('select longboard_chat_link_member($1,$2,null) m',[lb,lbName])).m.id,r=(await one('select longboard_chat_link_member($1,$2,null) m',[ss,ssName])).m.id;
 await q('update longboard_chat_members set avatar_path=$2 where id=$1',[k,lbAvatar]);await q('update longboard_chat_members set avatar_path=$2 where id=$1',[r,ssAvatar]);
 await q("insert into chat_shortscout_membership_links(lb_account_id,source_account_id,subject) values($1,$2,$2)",[lb,ss]);
 return {lb,ss,k,r};
};
const erinPic=randomUUID(),erinScoutPic=randomUUID();
const erin=await pair('Erin','Erin Scout',{lbAvatar:erinPic,ssAvatar:erinScoutPic});
const erinOld=await post(erin.k,'Erin','Erin from Longboard, a while ago');
await q("update longboard_chat_messages set created_at=now()-interval '30 days' where id=$1",[erinOld]);
await post(erin.r,'Erin Scout','Erin from ShortScout, recently','shortscout');
const quiet=await pair('Quinn','Quinn Scout'); // neither has posted
const report2=await q(await readFile(`${root}/scripts/sql/chat-merge-linked-profiles-report.sql`,'utf8'));
eq(report2.filter(r=>['Erin Scout','Quinn'].includes(r.kept_name)).map(r=>[r.kept_name,r.retired_name,r.name_from]).sort(),
 [['Erin Scout','Erin','ShortScout'],['Quinn','Quinn Scout','Longboard']],'the report shows the name that will be kept, and from where');
const before2=await snapshot();
const erinMerge=(await one('select chat_merge_linked_profile($1) r',[erin.lb])).r;
eq([erinMerge.kept,erinMerge.retired,erinMerge.nameFrom],['Erin Scout','Erin','shortscout']);
const member=async id=>one('select display_name,avatar_path,merged_into,user_id from longboard_chat_members where id=$1',[id]);
eq(await member(erin.k).then(m=>[m.display_name,m.avatar_path,m.user_id]),['Erin Scout',erinScoutPic,erin.lb],'the Longboard row keeps its id and takes the ShortScout name and picture');
eq(await member(erin.r).then(m=>[m.display_name,m.avatar_path,m.merged_into]),['Erin',erinPic,erin.k],'the retired row holds the other name');
eq((await q('select display_name from chat_member_names where member_id=$1 order by display_name',[erin.k])).map(r=>r.display_name),['Erin','Erin Scout'],'both names in the history');
eq(await at('Erin'),[{display_name:'Erin Scout',previous_name:null}],'once in the @ list');
eq((await q("select distinct author_label from longboard_chat_messages where member_id=$1",[erin.k])).length>0,true);
const quietMerge=(await one('select chat_merge_linked_profile($1) r',[quiet.lb])).r;
eq([quietMerge.kept,quietMerge.retired,quietMerge.nameFrom],['Quinn','Quinn Scout','longboard'],'neither posted: the Longboard name stays');
eq((await member(quiet.k)).display_name,'Quinn');
eq(await at('Quinn S'),[{display_name:'Quinn',previous_name:'Quinn Scout'}],'found by the retired name, shown under the kept one');
// Undo puts both profiles' names and pictures (and everything else) back exactly.
await q('select chat_unmerge_linked_profile($1)',[quietMerge.mergeId]);
const erinUndo=(await one('select chat_unmerge_linked_profile($1) r',[erinMerge.mergeId])).r;
eq(erinUndo.skipped,0);
eq(await member(erin.k).then(m=>[m.display_name,m.avatar_path]),['Erin',erinPic]);
eq(await member(erin.r).then(m=>[m.display_name,m.avatar_path,m.merged_into]),['Erin Scout',erinScoutPic,null]);
const after2=await snapshot();
for(const t of tables)eq(after2[t],before2[t],`${t} is back exactly after the name swap`);

// ---- The rollback: refused while a merge is active, then clean ----
const rollback=await readFile(`${root}/supabase/rollbacks/20261111170000_chat_merge_linked_profiles.down.sql`,'utf8');
await assert.rejects(()=>db.exec(rollback),/active merges/);checks++;
await q('select chat_unmerge_linked_profile($1)',[again.mergeId]);
await db.exec(rollback+"\n-- again"); // (the fixture skips SQL it has already run once)
eq((await one("select to_regproc('public.chat_merge_linked_profile') f, (select count(*)::int from pg_attribute where attrelid='public.chat_sessions'::regclass and attname='shortscout_only') c")),{f:null,c:0});
eq((await at('Scout')).map(r=>r.display_name),['Scout Tester'],'after the rollback the two profiles are as before');
console.log(`PASS #444 merge linked profiles: ${checks} checks (moved ${merged.moved}, removed ${merged.removed}; undo restored ${undone.restored}, skipped ${undone.skipped})`);
process.exit(0);
