// #363: synthetic PGlite + realtime protocol adapter (from chat-thread-edit-fixture). No production
// credentials or data. /test/reply inserts a reply from Bob and broadcasts it, as Postgres changes would.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-thread-live-replies-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54404','54663').replaceAll('3204','3463');
source=source.replace("v.slice(1,-1).split(',').map(bind).join(',')","v.slice(1,-1)?v.slice(1,-1).split(',').map(bind).join(','):'null'");
source=source.replace('createServer((req,res)=>','const server=createServer((req,res)=>');
source=source.replace(" const chunks=[];",` if(url.pathname==='/test/reply'){
  await db.exec('reset role');
  const row=(await db.query("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id) values($1,$1,'Bob',$2,'main',$3) returning *",[people[1].member.id,url.searchParams.get('body')||'Synthetic live reply',url.searchParams.get('root')])).rows[0];
  broadcast('longboard_chat_messages',row);return send({id:row.id,unread_seq:row.unread_seq});
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
