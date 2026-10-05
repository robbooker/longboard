// Local PGlite/PostgreSQL only. Differential oracle is the published function.
// Timings characterize this synthetic engine; they are not production CPU claims.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createInboxFixture,inboxEfficiencyMigration} from './chat-inbox-fixture.mjs';
const {db,root,accounts,members,q,one}=await createInboxFixture();
const rooms=['main','social','shortscout','lb-announcements','ss-announcements','lb-recordings','ss-recordings','gainers'];
const output=process.env.CHAT_INBOX_EVIDENCE_DIR;
const report={engine:(await one('select version() v')).v,scenarios:[],checks:0};
const equal=(a,b,message="expected fixture result")=>{assert.deepEqual(a,b,message);report.checks++;};
async function parity(label,actor=accounts[1],allowed=rooms){
 const r=await one('select chat_activity_inbox_baseline($1,$2) baseline,chat_activity_inbox($1,$2) candidate',[actor,allowed]);
 equal(r.candidate,r.baseline,label);return r.candidate;
}
const baselineFile=await readFile(root+'/supabase/migrations/20261002152103_chat_notification_list.sql','utf8');
const baseline=baselineFile.slice(baselineFile.indexOf('create or replace function public.chat_activity_inbox'));
const candidate=await readFile(root+'/supabase/migrations/'+inboxEfficiencyMigration,'utf8');
async function plan(sql){
 const body=sql.slice(sql.indexOf('as $$')+5,sql.lastIndexOf('$$;')).replace(/\bactor\b/g,'$1').replace(/\brooms\b/g,'$2');
 return (await one('explain (analyze,buffers,format json) '+body,[accounts[1],rooms]))['QUERY PLAN'][0];
}
function scans(node,rows=[]){
 if(node['Relation Name']||node['Function Name'])rows.push({node:node['Node Type'],relation:node['Relation Name']??node['Function Name'],index:node['Index Name'],rows:node['Actual Rows'],loops:node['Actual Loops'],filtered:node['Rows Removed by Filter']??0});
 for(const child of node.Plans??[])scans(child,rows);return rows;
}
async function measure(label){
 await db.exec('analyze');await parity(label);
 const samples={baseline:[],candidate:[]};
 // Alternate order; two untimed warm-ups per function precede seven samples.
 for(let round=-2;round<7;round++)for(const kind of round%2===0?['baseline','candidate']:['candidate','baseline']){
  const start=performance.now();await one(`select ${kind==='baseline'?'chat_activity_inbox_baseline':'chat_activity_inbox'}($1,$2) value`,[accounts[1],rooms]);
  if(round>=0)samples[kind].push(performance.now()-start);
 }
 const plans={baseline:await plan(baseline),candidate:await plan(candidate)};
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 const scenario={label,samplesMs:samples,medianMs:{baseline:median(samples.baseline),candidate:median(samples.candidate)},plans:Object.fromEntries(Object.entries(plans).map(([key,p])=>[key,{executionMs:p['Execution Time'],scans:scans(p.Plan)}]))};
 report.scenarios.push(scenario);console.log(JSON.stringify({label,medianMs:scenario.medianMs}));
 if(output){await mkdir(output,{recursive:true});for(const [key,p]of Object.entries(plans))await writeFile(`${output}/${label}-${key}-plan.json`,JSON.stringify(p,null,2));}
 return scenario;
}
try{
 // Match production key shapes omitted by the lightweight historical fixture.
 await db.exec('alter table user_tags add primary key(user_id,tag)');
 await measure('empty');
 // Fixture-only trigger suppression isolates read-query cost from fan-out writes.
 await db.exec('alter table longboard_chat_messages disable trigger user; alter table longboard_chat_direct_messages disable trigger user;');
 await q(`insert into longboard_chat_messages(member_id,room_slug,author_label,body) select $1,'main','Admin','Mention history '||i from generate_series(1,2000) i`,[members[0]]);
 await q(`insert into chat_room_mentions(account_id,message_id,room_slug,read_at) select $1,id,'main',now() from longboard_chat_messages`,[accounts[1]]);
 await q(`insert into longboard_chat_messages(member_id,room_slug,author_label,body) select $1,'main','LB member','Reaction history '||i from generate_series(1,2000) i`,[members[1]]);
 await q(`insert into chat_reaction_notifications(account_id,reactor_member_id,room_message_id,emoji,read_at) select $1,$2,id,'heart',now() from longboard_chat_messages where member_id=$3`,[accounts[1],members[0],members[1]]);
 const c=crypto.randomUUID();await q(`insert into longboard_chat_conversations(id,requester_id,recipient_id,status) values($1,$2,$3,'accepted')`,[c,members[1],members[0]]);
 await q(`insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id,created_at) select $1,$2,'DM history '||i,gen_random_uuid(),'2026-01-01'::timestamptz+i*interval '1 second' from generate_series(1,20000) i`,[c,members[0]]);
 await q(`update longboard_chat_conversations set requester_read_seq=(select max(seq)-5 from longboard_chat_direct_messages where conversation_id=$1) where id=$1`,[c]);
 await measure('single-long-thread');
 await db.exec(`create temporary table inbox_peers as select i,gen_random_uuid() account_id,gen_random_uuid() member_id,gen_random_uuid() conversation_id from generate_series(1,110) i;
 insert into auth.users select account_id from inbox_peers;
 insert into profiles select account_id,'peer'||i||'@example.test','user' from inbox_peers;
 insert into chat_accounts(id,longboard_user_id) select account_id,account_id from inbox_peers;
 insert into longboard_chat_guests(id,token_hash,display_name) select member_id,md5(account_id::text)||md5(member_id::text),'History peer '||i from inbox_peers;
 insert into longboard_chat_members(id,user_id,display_name) select member_id,account_id,'History peer '||i from inbox_peers;`);
 await q(`insert into longboard_chat_conversations(id,requester_id,recipient_id,status) select conversation_id,$1,member_id,'accepted' from inbox_peers`,[members[1]]);
 await db.exec(`insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id,created_at)
 select p.conversation_id,p.member_id,'Peer incoming '||message.i,gen_random_uuid(),'2026-02-01'::timestamptz+p.i*interval '1 day'+message.i*interval '1 second' from inbox_peers p cross join generate_series(1,200) message(i);
 update longboard_chat_conversations c set requester_read_seq=(select seq from longboard_chat_direct_messages d where d.conversation_id=c.id order by seq desc offset 3 limit 1);`);
 await q(`update longboard_chat_conversations set requester_read_seq=(select max(seq)-5 from longboard_chat_direct_messages where conversation_id=$1) where id=$1`,[c]);
 await q(`update chat_room_mentions set read_at=null where seq in(select seq from chat_room_mentions order by seq desc limit 5)`);
 await q(`update chat_reaction_notifications set read_at=null where seq in(select seq from chat_reaction_notifications order by seq desc limit 5)`);
 await q(`insert into chat_conversation_pins(account_id,conversation_id) values($1,$2)`,[accounts[1],c]);
 const sparse=await parity('sparse history');equal([sparse.mentionCount,sparse.dmCount,sparse.reactionCount],[5,335,5]);equal([sparse.mentions.length,sparse.reactions.length],[50,50]);
 const readHeavy=await measure('read-heavy');
 // Structural evidence is more stable than a wall-clock speed threshold.
 const beforeDm=readHeavy.plans.baseline.scans.filter(n=>n.relation==='longboard_chat_direct_messages');
 const afterDm=readHeavy.plans.candidate.scans.filter(n=>n.relation==='longboard_chat_direct_messages');
 assert.ok(beforeDm.some(n=>n.rows*n.loops>=20000),'baseline reads full incoming history');report.checks++;
 assert.ok(!afterDm.some(n=>n.rows*n.loops>=20000),'candidate avoids full incoming history scan');report.checks++;
 // Counts are not bounded by the preview limit, including old unread events.
 await db.exec('update chat_room_mentions set read_at=null; update chat_reaction_notifications set read_at=null; update longboard_chat_conversations set requester_read_seq=0;');
 const unread=await parity('all unread');equal([unread.mentionCount,unread.dmCount,unread.reactionCount],[2000,42000,2000]);
 await measure('unread-heavy');
 // Read cursors may be ahead; latest preview still finds the newest surviving
 // incoming message, skipping any newer outgoing or deleted messages.
 await db.exec('update chat_room_mentions set read_at=now(); update chat_reaction_notifications set read_at=now(); update longboard_chat_conversations set requester_read_seq=9223372036854775807;');
 await q(`insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id,created_at) values($1,$2,'New outgoing',gen_random_uuid(),'2026-01-02')`,[c,members[1]]);
 await q(`update longboard_chat_direct_messages set deleted_at=now() where conversation_id=$1 and sender_id=$2 and seq=(select max(seq) from longboard_chat_direct_messages where sender_id=$2)`,[c,members[0]]);
 let current=await parity('ahead cursor/outgoing/deleted');equal(current.dmCount,0);equal(current.dms.length,100);equal(current.dms.some(d=>d.id===c),false);equal(current.pinnedDmUnread[c],0);
 // More than 50 newest ineligible events cannot starve eligible history.
 await q(`update longboard_chat_messages set removed=true where id in(select message_id from chat_room_mentions order by seq desc limit 80)`);
 await q(`update longboard_chat_messages set deleted_at=now() where id in(select room_message_id from chat_reaction_notifications order by seq desc limit 80)`);
 current=await parity('ineligible newest events');equal(current.mentions.length,50);equal(current.reactions.length,50);
 // Mix more than 50 eligible DM reactions into room reactions, then compare
 // exact merged ordering, targets and read flags across the global top 50.
 await q(`insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id,created_at) select $1,$2,'Owned target '||i,gen_random_uuid(),'2026-01-03'::timestamptz+i*interval '1 second' from generate_series(1,70) i`,[c,members[1]]);
 await q(`insert into chat_reaction_notifications(account_id,reactor_member_id,dm_message_id,emoji,read_at) select $1,$2,id,'heart',case when seq%2=0 then now() end from longboard_chat_direct_messages where body like 'Owned target %'`,[accounts[1],members[0]]);
 current=await parity('DM reaction cap');equal(current.reactions.length,50);equal(current.reactionCount,35);
 await q(`insert into chat_reaction_notifications(account_id,reactor_member_id,room_message_id,emoji,read_at)
 select $1,$2,id,'laugh',now() from longboard_chat_messages where member_id=$3 and deleted_at is null and not removed order by created_at,id limit 25`,[accounts[1],members[0],members[1]]);
 current=await parity('mixed reaction kinds');equal(current.reactions.filter(r=>r.kind==='room').length,25);equal(current.reactions.filter(r=>r.kind==='dm').length,25);
 for(const status of ['pending','declined','accepted']){await q('update longboard_chat_conversations set status=$1 where id=$2',[status,c]);await parity('conversation '+status);}
 for(const pair of [[members[1],members[0]],[members[0],members[1]]]){await q('insert into longboard_chat_blocks values($1,$2,now())',pair);await parity('bilateral block');await q('delete from longboard_chat_blocks');}
 await parity('rooms empty',accounts[1],[]);await parity('rooms null',accounts[1],null);await parity('duplicate rooms',accounts[1],['main','main','social']);await parity('null actor',null);await parity('actor with no events',crypto.randomUUID());
 // Full current linked-account gates: direct-vs-bridge preference, strict expiry,
 // denial and link revocation. Both implementations use unchanged real helpers.
 const subject='10000000-0000-4000-8000-000000000003';
 await q(`insert into chat_shortscout_membership_links(lb_account_id,source_account_id,subject) values($1,$2,$3)`,[accounts[1],accounts[2],subject]);
 await q(`insert into chat_shortscout_authorization(subject,decision,membership_level,checked_at,valid_until) values($1,'allow','mastermind',now(),now()+interval '5 minutes')`,[subject]);
 await db.exec(`update chat_shortscout_rollout set legacy_until=now(); update longboard_chat_messages set room_slug='shortscout'; update chat_room_mentions set room_slug='shortscout';`);
 current=await parity('linked allow');equal(current.mentions.length,50);
 for(const update of ["valid_until=now()","valid_until=now()+interval '5 minutes',checked_at=now()-interval '61 seconds'","checked_at=now(),decision='deny',membership_level=null","decision='allow',membership_level='annual'","membership_level='mastermind'"]){await q('update chat_shortscout_authorization set '+update+' where subject=$1',[subject]);await parity('linked authorization '+update);}
 await q('update chat_shortscout_membership_links set revoked_at=now() where lb_account_id=$1',[accounts[1]]);current=await parity('bridge revoked');equal(current.mentions.length,0);
 await q('update chat_shortscout_membership_links set revoked_at=null where lb_account_id=$1',[accounts[1]]);
 const direct=crypto.randomUUID();await q(`insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$2,'annual')`,[direct,accounts[1]]);
 await q(`insert into chat_shortscout_authorization(subject,decision,membership_level,checked_at,valid_until) values($1,'allow','annual',now(),now()+interval '5 minutes')`,[direct]);
 current=await parity('direct identity overrides bridge');equal(current.mentions.length,0);
 // Rollback is replacement of this one function with its previous definition.
 const final=await parity('pre-rollback');await db.exec(baseline);equal((await one('select chat_activity_inbox($1,$2) value',[accounts[1],rooms])).value,final,'rollback parity');
 await db.exec(candidate);await parity('reapply after rollback');
 if(output)await writeFile(`${output}/summary.json`,JSON.stringify(report,null,2));
 console.log(`PASS ${report.checks} long-history differential, structural-plan and rollback checks.`);
}finally{await db.close();}
