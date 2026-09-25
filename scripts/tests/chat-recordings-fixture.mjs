// Synthetic PGlite + realtime protocol adapter. No production credentials/data.
import {recordingMigrations} from './chat-recordings-migrations.mjs';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-recordings-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54404',process.env.CHAT_FIXTURE_PORT||'54544').replaceAll('3204',process.env.CHAT_APP_PORT||'3344');
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
