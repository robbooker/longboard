// Actual React components and transport with synthetic, in-memory API responses.
// Never connects to production services or sends member messages.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer';
const root=new URL('../../',import.meta.url).pathname,dir=await mkdtemp(join(tmpdir(),'quad-test-'));
const member={id:'11111111-1111-4111-8111-111111111111',display_name:'Alice',accepts_requests:true};
const conversations=['Bob','Carol'].map((name,i)=>({id:`22222222-2222-4222-8222-22222222222${i}`,otherId:`33333333-3333-4333-8333-33333333333${i}`,otherName:name,status:'accepted',incoming:false,blockedByMe:false,unavailable:false,unread:0,lastBody:'Hi',updatedAt:new Date().toISOString()}));
const roomState={isOpen:true,notice:null,pausedAt:null,updatedAt:new Date().toISOString()};
const rooms=['main','shortscout','gainers'];
let availableRooms=rooms,availableDms=conversations;
const messages=Object.fromEntries(rooms.map(room=>[room,[{id:randomUUID(),room_slug:room,member_id:conversations[0].otherId,guest_id:null,author_label:'Bob',body:`Welcome to ${room}`,created_at:new Date().toISOString(),unread_seq:1}]]));
const dms=Object.fromEntries(conversations.map(c=>[c.id,[{id:randomUUID(),seq:1,sender_id:c.otherId,body:`Hello from ${c.otherName}`,created_at:new Date().toISOString()}]]));
const writes=[],paths=[];let blockedSend;let failLatest=false,failDm=false;
for(const room of rooms)messages[room]=Array.from({length:80},(_,i)=>({...messages[room][0],id:randomUUID(),body:`${room} message ${i+1} with enough content to scroll`,unread_seq:i+1}));
for(const c of conversations)dms[c.id]=Array.from({length:80},(_,i)=>({...dms[c.id][0],id:randomUUID(),body:`${c.otherName} message ${i+1}`,seq:i+1}));
const activity={mentions:[],dms:[],mentionCount:0,dmCount:0,mentionThrough:0,dmThrough:0,roomCounts:{},roomThrough:{},roomMessageCounts:{main:1,shortscout:1},roomMessageThrough:{main:80,shortscout:80}};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import QuadChat from './components/chat/QuadChat';import PublicChat from './components/chat/PublicChat';const params=new URLSearchParams(location.search);const room=params.get('room')||'main';const Shell=params.has('single')||location.pathname==='/chat'?PublicChat:QuadChat;createRoot(document.getElementById('root')).render(<Shell accountId="test-account" bootstrap={${JSON.stringify({accountId:'test-account',room:'main',member,roomState,messages:[],reactions:[],counts:{},featureChannel:false})}} allowedRooms={${JSON.stringify(rooms)}} serverSession={false} room={room} popout={params.has('popout')} fontVariableClass="" appVersion="test"/>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:join(dir,'bundle.js'),define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'test-platform',setup(b){
 b.onResolve({filter:/^(next\/(link|image|dynamic|navigation)|@\/lib\/supabase\/client)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'tsx',resolveDir:root,contents:a.path==='next/dynamic'?`import React from 'react';export default function dynamic(load){const C=React.lazy(load);return props=><React.Suspense fallback={<p>Loading…</p>}><C {...props}/></React.Suspense>;}`:a.path==='next/navigation'?`export const useRouter=()=>({push:url=>location.href=url,refresh:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;`:a.path.includes('supabase')?`export function createClient(){const channel={on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},track:async()=>{},presenceState:()=>({})};return {channel:(name)=>{window.testChannels??=[];window.testChannels.push(name);return channel},removeChannel:()=>{},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}`:`import React from 'react';export default function Component({children,unoptimized,fill,priority,scroll,...props}){return React.createElement(${a.path==='next/link'?"'a'":"'img'"},props,children);}`}));
}}]});
function read(path){paths.push(path);const u=new URL(path,'http://localhost');const room=u.searchParams.get('room')||'main';
 if(u.pathname==='/api/chat/quad-options')return {accountId:'test-account',rooms:availableRooms,conversations:availableDms};
 if(u.pathname==='/api/chat/history')return {messages:(messages[room]||[]).slice(u.searchParams.has('anchor')?0:40,u.searchParams.has('anchor')?40:80),reactions:[],hasMore:false};
 if(u.pathname==='/api/chat/pins')return {pins:[]};
 if(u.pathname==='/api/chat/favorite')return {favorite:null};
 if(u.pathname==='/api/chat/thread-counts')return {counts:{}};
 if(u.pathname==='/api/chat/opening')return {messageId:u.searchParams.has('conversation')?dms[u.searchParams.get('conversation')]?.[10]?.id:messages[room]?.[10]?.id,readThrough:10};
 if(u.pathname==='/api/chat/thread')return {parent:messages[room][0],replies:[],hasMore:false};
 if(u.pathname==='/api/chat/inbox'){const id=u.searchParams.get('conversation');return id?{messages:(dms[id]||[]).slice(u.searchParams.has('around')?0:40,u.searchParams.has('around')?40:80),hasMore:!u.searchParams.has('around'),hasNewer:u.searchParams.has('around')}:{conversations:availableDms};}
 if(u.pathname==='/api/chat/activity')return activity;
 if(u.pathname==='/api/chat')return roomState;
 if(u.pathname==='/api/chat/app-version')return {version:'test'};
 return {};
}
const server=createServer(async(req,res)=>{
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.url.startsWith('/chat/quad')||req.url.startsWith('/chat?')){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script>');}
 if(['/bundle.js','/bundle.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');return res.end(await readFile(join(dir,req.url.slice(1))));}
 if(req.url==='/chat-sw.js'){res.setHeader('Content-Type','text/javascript');return res.end('');}
 if(failDm&&req.method!=='POST'&&req.url.startsWith('/api/chat/inbox?conversation='))return send({error:'Could not load latest DM'},503);
 if(failLatest&&req.method!=='POST'&&req.url.startsWith('/api/chat/history'))return send({error:'failed'},503);
 if(req.method!=='POST')return send(read(req.url));
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
 if(req.url==='/api/chat/updates')return send({results:body.paths.map(path=>({path,status:200,data:read(path)}))});
 if(req.url==='/api/chat/message-reactions')return send({messages:{}});
 writes.push({path:req.url,body});
 if(req.url==='/api/chat'&&body.body){const message={id:randomUUID(),room_slug:body.room,member_id:member.id,guest_id:member.id,author_label:'Alice',body:body.body,created_at:new Date().toISOString(),client_id:body.clientId};messages[body.room].push(message);if(body.body==='Hold send')return void(blockedSend=()=>send({message}));return send({message});}
 if(req.url==='/api/chat/inbox'&&body.action==='send'){const message={id:randomUUID(),sender_id:member.id,body:body.body,seq:dms[body.target].length+1,client_id:body.clientId,created_at:new Date().toISOString()};dms[body.target].push(message);return send({message});}
 return send({});
});
await new Promise(r=>server.listen(3347,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
let browser;console.log("Fixture ready",base);
try{
 browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});console.log("Browser launched");const p=await browser.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('pageerror:',e.stack);});p.on('console',m=>{if(m.type()==='error')console.log('console:',m.text());});
 await p.setViewport({width:1440,height:1000});await p.goto(base+'/chat/quad');await p.waitForSelector('select');console.log('Pickers loaded');
 const pane=i=>`section[aria-label^="Pane ${i+1}:"]`;
 const input=i=>i>=2?`${pane(i)} textarea[placeholder="Write a private message…"]`:`${pane(i)} textarea`;
 await p.select(`${pane(2)} select`,`dm:${conversations[0].id}`);await p.select(`${pane(3)} select`,`dm:${conversations[1].id}`);
 await p.waitForSelector(`${pane(2)} section[aria-label="Private conversation"] textarea`,{visible:true});await p.waitForSelector(`${pane(3)} section[aria-label="Private conversation"] textarea`,{visible:true});await p.waitForFunction(()=>document.body.textContent.includes('main message 11'));
 const skip='button[aria-label="Skip to Most Recent Message"]';
 const lastRoom=()=>messages.main.at(-1),lastDm=()=>dms[conversations[0].id].at(-1);
 const roomPane=`${pane(0)} [aria-live="polite"][aria-busy]`,dmPane=`${pane(2)} [aria-live="polite"][aria-busy]`;
 const bottom=async selector=>p.$eval(selector,e=>e.scrollHeight-e.clientHeight-e.scrollTop<3);
 await p.waitForSelector(`${pane(0)} ${skip}:not(:disabled)`);
 await p.waitForFunction(s=>document.querySelector(s)?.getAttribute('aria-busy')==='false',{},dmPane);
 assert.equal(await bottom(roomPane),false,'Opening room stays at unread anchor');
 const before=writes.length;
 await p.click(`${pane(0)} ${skip}`);
 await p.waitForFunction((s,id)=>!!document.querySelector(s)?.querySelector(`[id="chat-message-${id}"]`),{},pane(0),lastRoom().id);
 await p.waitForFunction(s=>{const e=document.querySelector(s);return e.scrollHeight-e.clientHeight-e.scrollTop<3;},{},roomPane);
 await new Promise(r=>setTimeout(r,300));
 assert.ok(writes.slice(before).some(w=>w.path==='/api/chat/activity'&&w.body.room==='main'&&w.body.roomThrough===80),'Room marks fresh latest read');
 assert.equal(writes.slice(before).some(w=>w.body.room==='shortscout'&&w.body.roomThrough===80),false,'Other room remains unread');
 const beforeDm=writes.length;
 await p.click(`${pane(2)} ${skip}`);
 await p.waitForFunction((s,id)=>!!document.querySelector(s)?.querySelector(`[data-message-id="${id}"]`),{},pane(2),lastDm().id);
 await p.waitForFunction(s=>{const e=document.querySelector(s);return e.scrollHeight-e.clientHeight-e.scrollTop<3;},{},dmPane);
 await new Promise(r=>setTimeout(r,300));
 assert.ok(writes.slice(beforeDm).some(w=>w.body.action==='read'&&w.body.target===conversations[0].id&&w.body.clientId===lastDm().id),'DM latest read is exact canonical ID');
 assert.equal(writes.slice(beforeDm).some(w=>w.body.action==='read'&&w.body.target===conversations[1].id&&w.body.clientId===dms[conversations[1].id].at(-1).id),false,'Other DM is not marked read');
 // Failed latest fetch leaves current historical viewport/read marker unchanged.
 await p.$eval(roomPane,e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'));});failLatest=true;
 const failedWrites=writes.length;await p.click(`${pane(0)} ${skip}`);
 await p.waitForFunction(()=>document.body.textContent.includes('Could not load the most recent message'));
 assert.equal(await bottom(roomPane),false);assert.equal(writes.slice(failedWrites).some(w=>w.path==='/api/chat/activity'),false);failLatest=false;
 // Single-view desktop/mobile placement and keyboard activation, including unchanged latest history.
 await p.goto(base+'/chat/quad?single');await p.waitForSelector(`${skip}:not(:disabled)`);
 assert.equal(await p.$eval(skip,e=>e.nextElementSibling?.getAttribute('aria-label')),'Search chat');
 await p.focus(skip);await p.keyboard.press('Enter');
 await p.waitForFunction(()=>document.querySelectorAll('article[id^="chat-message-"]').length===40);
 await new Promise(r=>setTimeout(r,200));
 const singlePane='[aria-live="polite"][aria-busy]';await p.$eval(singlePane,e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'));});
 await p.click(skip);await p.waitForFunction(s=>{const e=document.querySelector(s);return e.scrollHeight-e.clientHeight-e.scrollTop<3;},{},singlePane);
 for(const width of [390,320]){await p.setViewport({width,height:850});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await p.$eval(skip,e=>e.title),'Skip to Most Recent Message');assert.equal(await p.$eval(skip,e=>{const b=e.getBoundingClientRect();return b.width===b.height;}),true,'Skip control is square');await p.screenshot({path:`/tmp/skip-latest-${width}.png`});}
 await p.setViewport({width:1440,height:1000});
 await p.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),conversations[1].id);
 await p.waitForSelector('section[aria-label="Private conversation"] textarea',{visible:true});
 const singleDm='section[aria-label="Private conversation"] [aria-live="polite"][aria-busy]';
 await p.waitForFunction(s=>document.querySelector(s)?.getAttribute('aria-busy')==='false',{},singleDm);
 failDm=true;const failedDmWrites=writes.length;await p.click(skip);
 await p.waitForFunction(()=>document.body.textContent.includes('Could not load latest DM'));
 assert.equal(writes.slice(failedDmWrites).some(w=>w.body.action==='read'&&w.body.clientId===dms[conversations[1].id].at(-1).id),false);failDm=false;
 await p.click(skip);await p.waitForFunction((s,id)=>!!document.querySelector(s)?.querySelector(`[data-message-id="${id}"]`),{},singleDm,dms[conversations[1].id].at(-1).id);
 await p.waitForFunction(s=>{const e=document.querySelector(s);return e.scrollHeight-e.clientHeight-e.scrollTop<3;},{},singleDm);
 assert.equal(await p.evaluate(()=>document.body.textContent.includes('Could not load latest DM')),false,'Successful retry clears its own error');
 await p.setViewport({width:320,height:850});await p.screenshot({path:'/tmp/skip-latest-dm-320.png'});
 assert.deepEqual(errors,[]);console.log('Skip latest browser checks passed: anchored room/DM, exact reads, quad isolation, failed fetch, unchanged history, keyboard, mobile.');
}catch(e){console.error(e);throw e;}finally{blockedSend?.();server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
