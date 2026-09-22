// Synthetic PGlite + realtime protocol adapter. No production credentials/data.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-membership-alignment-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54404','54535').replaceAll('3204','3335');
source=source.replace('const objects=new Map()',`for(const file of ['20260917231136_chat_dm_message_actions.sql','20260918001755_chat_dm_media.sql','20260918182625_chat_voice_messages.sql'])await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));
const objects=new Map()`);
source=source.replace("v.slice(1,-1).split(',').map(bind).join(',')","v.slice(1,-1)?v.slice(1,-1).split(',').map(bind).join(','):'null'");
source=source.replace("function user(p)","await db.exec(await readFile(root+'/supabase/migrations/20260917231038_chat_announcement_member_reactions.sql','utf8'));await db.exec(await readFile(root+'/supabase/migrations/20260918182733_chat_message_reaction_choices.sql','utf8'));\nfunction user(p)");
source=source.replace("function user(p)","for(const file of ['20260918115352_chat_dm_directory.sql','20260918140909_chat_reply_notifications.sql','20260918141732_chat_ss_mastermind_access.sql','20260918160518_chat_admin_public_room_access.sql','20260918172508_chat_dm_sound_cursor.sql','20260918211138_chat_buddy_async_queue.sql','20260918211147_chat_s03_dm_ack.sql','20260921202321_chat_shortscout_membership_links.sql','20260922195023_chat_membership_badge_sources.sql'])await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));\nfunction user(p)");
source=source.replace("['chat_thread_counts','search_longboard_chat'","['chat_member_membership_sources','chat_member_memberships','longboard_chat_dm_directory','chat_thread_counts','search_longboard_chat'");
source=source.replace('createServer((req,res)=>','const server=createServer((req,res)=>');
source=source.replace(" const chunks=[];",` if(url.pathname==='/test/disconnect'){for(const socket of peers.keys())socket.close();return send({ok:true});}
 if(url.pathname==='/test/message'){
  await db.exec('reset role');
  const row=(await db.query("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Bob',$2,'social') returning *",[people[1].member.id,url.searchParams.get('body')||'Synthetic realtime message'])).rows[0];
  broadcast('longboard_chat_messages',row);return send({id:row.id});
 }
 const chunks=[];`);
source=source.replace("function user(p)","await db.query(\"insert into chat_provider_identities(provider,subject,account_id,membership_level,verified_at) values('shortscout',$1,$1,'mastermind',now()-interval '30 days')\",[people[1].id]);\nfunction user(p)");
source=source.replace("function user(p)", "let exportState='update';const {createHmac}=await import('node:crypto');\nfunction user(p)");
source=source.replace(" if(url.pathname.startsWith('/auth/v1/'))", `
 if(url.pathname==='/test/membership-state'){exportState=payload.state;return send({ok:true});}
 if(url.pathname==='/test/membership-export'){
  const key='synthetic-test-key-never-a-production-secret',nonce=req.headers['x-chat-membership-nonce'],stamp=req.headers['x-chat-membership-timestamp'];
  const sign=text=>createHmac('sha256',key).update(text).digest('hex');
  if(req.headers['x-chat-membership-signature']!==sign('request\\n'+stamp+'\\n'+nonce+'\\n'+body))return send({},401);
  if(exportState==='error')return send({},503);
  const records=payload.subjects.map(subject=>({subject,state:exportState,level:exportState==='update'?'mastermind':exportState==='revoke'?'free':null}));
  const raw=JSON.stringify({version:1,nonce,requestDigest:createHash('sha256').update(body).digest('hex'),records}),timestamp=String(Math.floor(Date.now()/1000));
  res.setHeader('x-chat-membership-timestamp',timestamp);res.setHeader('x-chat-membership-signature',sign('response\\n'+timestamp+'\\n'+nonce+'\\n'+raw));
  res.setHeader('Content-Type','application/json');res.end(raw);return;
 }
 if(url.pathname.startsWith('/auth/v1/'))`);
// The current incremental DM reader checks symmetric blocks using nested PostgREST OR/AND.
source=source.replace("if(key==='or'){", `if(key==='or'&&value.startsWith('(and(')){
 const pairs=value.slice(1,-1).split('),and(').map((part,i)=>(i===0?part.slice(4):part).replace(/\\)$/,'').split(','));
 filters.push('('+pairs.map(pair=>'('+pair.map(term=>{const [column,op,val]=term.split('.');if(op!=='eq')throw Error('bad nested filter');return ident(column)+'='+bind(val);}).join(' and ')+')').join(' or ')+')');continue;
 }if(key==='or'){`);
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
