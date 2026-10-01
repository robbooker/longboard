// Synthetic PGlite + realtime protocol adapter. No production credentials/data.
import {recordingMigrations} from './chat-recordings-migrations.mjs';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-shortscout-authorization-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54404',process.env.CHAT_FIXTURE_PORT||'54555').replaceAll('3204',process.env.CHAT_APP_PORT||'3355');
source=source.replace("function user(p)",`for(const file of ${JSON.stringify(recordingMigrations.filter(f=>f!=='20260917195530_chat_room_unread.sql'))})await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));\nfunction user(p)`);
source=source.replace("v.slice(1,-1).split(',').map(bind).join(',')","v.slice(1,-1)?v.slice(1,-1).split(',').map(bind).join(','):'null'");
source=source.replace("['chat_thread_counts','search_longboard_chat'","['chat_member_membership_sources','chat_member_memberships','longboard_chat_dm_directory','chat_thread_counts','search_longboard_chat'");
source=source.replace("if(op!=='eq')throw Error('bad or');return ident(column)+'='+bind(val)","if(op==='is'&&val==='null')return ident(column)+' is null';if(!['eq','neq'].includes(op))throw Error('bad or');return ident(column)+(op==='neq'?'<>':'=')+bind(val)");
// PostgREST many-to-one projection used by reaction detail privacy checks.
source=source.replace("x==='*'?'*':",`x==='person:longboard_chat_members(display_name)'?'(select jsonb_build_object(\\'display_name\\',p.display_name) from public.longboard_chat_members p where p.id=chat_message_reaction_choices.member_id) as person':x==='person:longboard_chat_guests(display_name)'?'(select jsonb_build_object(\\'display_name\\',p.display_name) from public.longboard_chat_guests p where p.id=longboard_chat_reactions.guest_id) as person':x==='*'?'*':`);
// Current DM opening reader uses symmetric block pairs in nested OR/AND filters.
source=source.replace("if(key==='or'){", `if(key==='or'&&value.startsWith('(and(')){
 const pairs=value.slice(1,-1).split('),and(').map((part,i)=>(i===0?part.slice(4):part).replace(/\\)$/,'').split(','));
 filters.push('('+pairs.map(pair=>'('+pair.map(term=>{const [column,op,val]=term.split('.');if(op!=='eq')throw Error('bad nested filter');return ident(column)+'='+bind(val);}).join(' and ')+')').join(' or ')+')');continue;
 }if(key==='or'){`);
source=source.replace("function user(p)",`for(const file of ['20261001161221_chat_delete_replies.sql','20261001170025_chat_notification_formatting.sql','20261001170041_chat_visible_notification_reads.sql','20261001190002_chat_shortscout_authorization.sql'])await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));
const {membershipExportHandler}=await import(process.env.CHAT_AUTH_SOURCE_HANDLER||new URL('../../../shortscout-chat-auth-renewal/supabase/functions/chat-membership-export/handler.ts',import.meta.url).href);
let sourceLevel='mastermind',sourceUnavailable=false,sourceCalls=0;
const signedSource=membershipExportHandler({key:'synthetic-test-key-never-a-production-secret',lookup:async subjects=>subjects.map(subject=>({subject,state:'update',level:'mastermind'})),authorize:async subjects=>{sourceCalls++;if(sourceUnavailable)throw Error('fixture unavailable');return subjects.map(subject=>sourceLevel==='free'?{subject,state:'deny',level:null}:{subject,state:'allow',level:sourceLevel});}});
await db.query("update profiles set role='user' where id=$1",[people[0].id]);
await db.query("update chat_provider_identities set verified_at=now()-interval '2 days' where account_id=$1",[scoutId]);
function user(p)`);
source=source.replace(" if(url.pathname.startsWith('/auth/v1/'))", `
 if(url.pathname==='/test/source'){
  if(payload.level)sourceLevel=payload.level;if(typeof payload.unavailable==='boolean')sourceUnavailable=payload.unavailable;
  if(payload.expire){await db.exec('reset role');await db.exec("update chat_shortscout_authorization set valid_until=now(),retry_after=null,requested_at=now()-interval '7 seconds'");}
  return send({level:sourceLevel,unavailable:sourceUnavailable,calls:sourceCalls});
 }
 if(url.pathname==='/test/sql'){await db.exec('reset role');return send((await db.query(payload.sql,payload.args||[])).rows);}
 if(url.pathname==='/test/membership-export'){
  const result=await signedSource(new Request('https://source.example.test/export',{method:'POST',headers:req.headers,body}));res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());return;
 }
 if(url.pathname==='/test/identity')return send({scoutId,scoutToken,scoutMember,people:people.map(p=>({id:p.id,token:p.token,email:p.email,member:p.member}))});
 if(url.pathname.startsWith('/auth/v1/'))`);
source=source.replace('createServer((req,res)=>','const server=createServer((req,res)=>');
source=source.replace(" const chunks=[];",` if(url.pathname==='/test/disconnect'){for(const socket of peers.keys())socket.close();return send({ok:true});}
 if(url.pathname==='/test/message'){
  await db.exec('reset role');
  const row=(await db.query("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Bob',$2,'social') returning *",[people[1].member.id,url.searchParams.get('body')||'Synthetic realtime message'])).rows[0];
  broadcast('longboard_chat_messages',row);return send({id:row.id});
 }
 const chunks=[];`);
source+=`\nconst {WebSocketServer}=await import('ws');
const peers=new Map();
const ws=new WebSocketServer({server});
ws.on('connection',socket=>{const channels=new Map();peers.set(socket,channels);socket.on('close',()=>peers.delete(socket));socket.on('message',bytes=>{
 const raw=JSON.parse(bytes.toString());channels.array=Array.isArray(raw);
 const message=channels.array?{join_ref:raw[0],ref:raw[1],topic:raw[2],event:raw[3],payload:raw[4]}:raw;
 const send=packet=>socket.send(JSON.stringify(channels.array?[packet.join_ref??null,packet.ref??null,packet.topic,packet.event,packet.payload]:packet));
 if(message.event==='phx_join'){
  const bindings=(message.payload.config?.postgres_changes||[]).map((filter,index)=>({...filter,id:index+1}));channels.set(message.topic,bindings);
  send({topic:message.topic,event:'phx_reply',ref:message.ref,join_ref:message.join_ref,payload:{status:'ok',response:{postgres_changes:bindings}}});
  send({topic:message.topic,event:'presence_state',payload:{}});
 }else if(message.event==='heartbeat'||message.event==='phx_leave')send({topic:message.topic,event:'phx_reply',ref:message.ref,join_ref:message.join_ref,payload:{status:'ok',response:{}}});
});});
function broadcast(table,row){for(const [socket,channels]of peers)for(const [topic,bindings]of channels){const ids=bindings.filter(b=>b.table===table).map(b=>b.id);if(ids.length){const packet={topic,event:'postgres_changes',payload:{ids,data:{schema:'public',table,type:'INSERT',commit_timestamp:new Date().toISOString(),record:row,old_record:{},columns:[]}}};socket.send(JSON.stringify(channels.array?[null,null,topic,packet.event,packet.payload]:packet));}}}
`;
await writeFile(target,source);
try{await import(target.href);}finally{await unlink(target);}
