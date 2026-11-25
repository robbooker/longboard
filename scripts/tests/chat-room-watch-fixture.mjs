// #496: synthetic PGlite + Supabase realtime protocol adapter (as chat-updates-fixture) on its own
// ports, for chat-room-watch-browser.mjs. No production credentials or data.
//   /test/bindings  which tables each open realtime channel watches now (a leave removes it)
//   /test/message   Bob posts to a room (?room=main&body=…) and it is broadcast as a Postgres change
//   /test/dm        a change on the DM table is broadcast (the page only re-reads its inbox)
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-room-watch-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54404','54696').replaceAll('3204','3496');
source=source.replace('createServer((req,res)=>','const server=createServer((req,res)=>');
source=source.replace(" const chunks=[];",` if(url.pathname==='/test/bindings')return send([...peers.values()].flatMap(channels=>[...channels].map(([topic,bindings])=>({topic,tables:bindings.map(b=>b.table)}))));
 if(url.pathname==='/test/message'){
  await db.exec('reset role');
  const row=(await db.query("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Bob',$2,$3) returning *",[people[1].member.id,url.searchParams.get('body')||'Synthetic realtime message',url.searchParams.get('room')||'main'])).rows[0];
  return send({row,delivered:broadcast('longboard_chat_messages',row)});
 }
 if(url.pathname==='/test/dm')return send({delivered:broadcast('longboard_chat_direct_messages',{id:crypto.randomUUID()})});
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
 }else if(message.event==='phx_leave'){channels.delete(message.topic);send({topic:message.topic,event:'phx_reply',ref:message.ref,join_ref:message.join_ref,payload:{status:'ok',response:{}}});}
 else if(message.event==='heartbeat')send({topic:message.topic,event:'phx_reply',ref:message.ref,join_ref:message.join_ref,payload:{status:'ok',response:{}}});
});});
function broadcast(table,row){let n=0;for(const [socket,channels]of peers)for(const [topic,bindings]of channels){const ids=bindings.filter(b=>b.table===table).map(b=>b.id);if(ids.length){n++;const packet={topic,event:'postgres_changes',payload:{ids,data:{schema:'public',table,type:'INSERT',commit_timestamp:new Date().toISOString(),record:row,old_record:{},columns:[]}}};socket.send(JSON.stringify(channels.array?[null,null,topic,packet.event,packet.payload]:packet));}}return n;}
`;
await writeFile(target,source);
try{await import(target.href);}finally{await unlink(target);}
