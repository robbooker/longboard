// #477: the header's Latest arrow grays out (and does nothing) while the newest message is on
// screen, and looks normal when it isn't: scrolled up, a new message below, or an older page that
// stops short of the newest messages. Rooms, DMs and threads; a computer, a narrow window and a
// phone (whose DM info sheet holds Latest messages). Actual React components with synthetic,
// in-memory API responses; never reaches production. `--shots DIR` saves header pictures.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer';
const root=new URL('../../',import.meta.url).pathname,dir=await mkdtemp(join(tmpdir(),'latest-grayed-'));
const shotsAt=process.argv.indexOf('--shots'),shots=shotsAt>0?process.argv[shotsAt+1]:null;if(shots)await mkdir(shots,{recursive:true});
const member={id:'11111111-1111-4111-8111-111111111111',display_name:'Alice',accepts_requests:true};
const bob={id:'33333333-3333-4333-8333-333333333330',name:'Bob'};
const conversation={id:'22222222-2222-4222-8222-222222222220',otherId:bob.id,otherName:bob.name,status:'accepted',incoming:false,blockedByMe:false,unavailable:false,unread:0,lastBody:'Hi',updatedAt:new Date().toISOString()};
const roomState={isOpen:true,notice:null,pausedAt:null,updatedAt:new Date().toISOString()};
const rooms=['main','shortscout'];
const now=Date.now(),at=i=>new Date(now-(100-i)*60000).toISOString();
const row=(room,i)=>({id:randomUUID(),room_slug:room,member_id:i%2?member.id:bob.id,guest_id:null,author_label:i%2?'Alice':'Bob',body:`${room} message ${i} with enough words in it to take up a line or two of the room`,created_at:at(i),unread_seq:i});
const messages=Object.fromEntries(rooms.map(room=>[room,Array.from({length:80},(_,i)=>row(room,i+1))]));
const dms=[...Array.from({length:60},(_,i)=>({id:randomUUID(),seq:i+1,sender_id:i%2?member.id:bob.id,body:`DM message ${i+1} from ${i%2?'Alice':'Bob'}`,created_at:at(i+1)}))];
const replies=Array.from({length:3},(_,i)=>({...row('main',200+i),id:randomUUID(),reply_to_id:null,body:`Thread reply ${i+1}`}));
// openAt: where /api/chat/opening sends the room (null: the newest message).
let openAt=null;const paths=[];
const activity={mentions:[],dms:[],mentionCount:0,dmCount:0,mentionThrough:0,dmThrough:0,roomCounts:{},roomThrough:{main:80,shortscout:80},roomMessageCounts:{},roomMessageThrough:{main:80,shortscout:80}};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import PublicChat from './components/chat/PublicChat';createRoot(document.getElementById('root')).render(<PublicChat accountId="test-account" bootstrap={${JSON.stringify({accountId:'test-account',room:'main',member,roomState,messages:[],reactions:[],counts:{},featureChannel:false})}} allowedRooms={${JSON.stringify(rooms)}} serverSession={false} room="main" popout={false} fontVariableClass="" appVersion="test"/>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:join(dir,'bundle.js'),define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'test-platform',setup(b){
 b.onResolve({filter:/^(next\/(link|image|dynamic|navigation)|@\/lib\/supabase\/client)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'tsx',resolveDir:root,contents:a.path==='next/dynamic'?`import React from 'react';export default function dynamic(load){const C=React.lazy(load);return props=><React.Suspense fallback={<p>Loading…</p>}><C {...props}/></React.Suspense>;}`:a.path==='next/navigation'?`export const useRouter=()=>({push:url=>location.href=url,refresh:()=>{},replace:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;`:a.path.includes('supabase')?`export function createClient(){const channel={on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},track:async()=>{},presenceState:()=>({})};return {channel:()=>channel,removeChannel:()=>{},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}`:`import React from 'react';export default function Component({children,unoptimized,fill,priority,scroll,...props}){return React.createElement(${a.path==='next/link'?"'a'":"'img'"},props,children);}`}));
}}]});
function read(path){paths.push(path);const u=new URL(path,'http://localhost'),q=u.searchParams,room=q.get('room')||'main',list=messages[room]||[];
 if(u.pathname==='/api/chat/history'){
  const around=q.get('around')||q.get('anchor');
  if(around){const i=Math.max(0,list.findIndex(m=>m.id===around)-10),slice=list.slice(i,i+25);return {messages:slice,reactions:[],hasMore:i>0,hasNewer:i+25<list.length,range:`${slice[0].unread_seq},${slice.at(-1).unread_seq}`};}
  const range=q.get('range');if(range){const [a,b]=range.split(',').map(Number),slice=list.filter(m=>m.unread_seq>=a&&m.unread_seq<=b);return {messages:slice,reactions:[],hasMore:a>1,hasNewer:b<list.at(-1).unread_seq,range};}
  const after=q.get('after');if(after){const slice=list.filter(m=>m.unread_seq>Number(after)).slice(0,25);return {messages:slice,reactions:[],hasMore:true,hasNewer:slice.at(-1)?.unread_seq<list.at(-1).unread_seq,range:`${slice[0]?.unread_seq},${slice.at(-1)?.unread_seq}`};}
  return {messages:list.slice(-40),reactions:[],hasMore:true,hasNewer:false,...(q.get('latest')==='1'?{latestThrough:list.at(-1).unread_seq}:{})};
 }
 if(u.pathname==='/api/chat/opening')return q.has('conversation')?{messageId:null,readThrough:dms.length}:{messageId:openAt,readThrough:80};
 if(u.pathname==='/api/chat/pins')return {pins:[]};
 if(u.pathname==='/api/chat/favorite')return {favorite:null};
 if(u.pathname==='/api/chat/thread-counts')return {counts:{}};
 if(u.pathname==='/api/chat/thread'){const parent=list.find(m=>m.id===q.get('parent')||m.id===q.get('id'))??list.at(-1);return {parent,replies:replies.map(r=>({...r,reply_to_id:parent.id})),hasMore:false};}
 if(u.pathname==='/api/chat/inbox')return q.get('conversation')?{messages:dms.slice(-40),hasMore:true,hasNewer:false}:{conversations:[conversation]};
 if(u.pathname==='/api/chat/activity')return activity;
 if(u.pathname==='/api/chat')return roomState;
 if(u.pathname==='/api/chat/app-version')return {version:'test'};
 return {};
}
const server=createServer(async(req,res)=>{
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.url.startsWith('/chat')){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script>');}
 if(['/bundle.js','/bundle.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');return res.end(await readFile(join(dir,req.url.slice(1))));}
 if(req.url==='/chat-sw.js'){res.setHeader('Content-Type','text/javascript');return res.end('');}
 if(req.method!=='POST')return send(read(req.url));
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
 if(req.url==='/api/chat/updates')return send({results:body.paths.map(path=>({path,status:200,data:read(path)}))});
 if(req.url==='/api/chat/message-reactions')return send({messages:{}});
 return send({});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const skip='header button[aria-label="Skip to Most Recent Message"]';
const roomList='[role="log"][aria-busy]',dmList='section[aria-label="Private conversation"] [aria-live="polite"][aria-busy]';
let browser;
try{
 browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const open=async(viewport)=>{const p=await browser.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('pageerror:',e.stack);});await p.setViewport(viewport);return {p,errors};};
 // Grayed: aria-disabled with the reason as its tooltip, still on screen (dimmed, not hidden).
 const grayed=(p,selector,want)=>p.waitForFunction((s,want)=>{const e=document.querySelector(s);if(!e)return false;const on=e.getAttribute('aria-disabled')==='true';const style=getComputedStyle(e),o=Number(style.opacity);return want?on&&e.title==="You're at the latest message"&&o>0.2&&o<0.8&&style.visibility!=='hidden'&&e.getBoundingClientRect().width>0:!on&&o===1;},{timeout:5000},selector,want).catch(async()=>{const state=await p.$eval(selector,e=>`aria-disabled=${e.getAttribute('aria-disabled')} title=${e.title} opacity=${getComputedStyle(e).opacity}`).catch(()=>'missing');throw new Error(`${selector} should be ${want?'grayed':'normal'}: ${state}`);});
 // A chat-open-dm sent while the DM list is still refreshing can be dropped (its listener is
 // replaced): send it again, as a person taps again, until the conversation shows.
 const openDm=async p=>{for(let i=0;;i++){await p.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),conversation.id);try{return await p.waitForSelector(dmList,{visible:true,timeout:3000});}catch(e){if(i>=8)throw e;}}};
 const atBottom=(p,s)=>p.$eval(s,e=>e.scrollHeight-e.clientHeight-e.scrollTop<3);
 const scrollUp=(p,s,by=600)=>p.$eval(s,(e,by)=>{e.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));e.scrollTop=Math.max(0,e.scrollTop-by);e.dispatchEvent(new Event('scroll'));},by);
 // The conversation's header (the one holding Latest) and the messages just under it.
 const shot=async(p,name)=>{if(!shots)return;const box=await p.$eval(skip,e=>{const b=e.closest('header').getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:Math.min(b.height+260,innerHeight-b.y)};});await p.screenshot({path:join(shots,name),clip:box});};
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const label=`${viewport.width}px`;openAt=null;
  const {p,errors}=await open(viewport);
  await p.goto(base+'/chat?single');
  await p.waitForFunction((s,id)=>!!document.querySelector(s)?.querySelector(`[id="chat-message-${id}"]`),{},roomList,messages.main.at(-1).id);
  await p.waitForSelector(`${roomList}:not([data-positioning])`);
  // 1. The room opens at the newest message: grayed, and pressing it does nothing.
  await grayed(p,skip,true);assert.ok(await atBottom(p,roomList),`${label}: opens at the newest message`);
  await shot(p,`room-at-latest-${viewport.width}.png`);
  const before=paths.length;await p.click(skip);await pause(400);
  assert.equal(paths.slice(before).some(path=>path.startsWith('/api/chat/history')&&path.includes('latest=1')),false,`${label}: grayed Latest fetches nothing`);
  assert.ok(await atBottom(p,roomList),`${label}: still at the newest message`);
  // 2. Scrolled up: normal.
  await scrollUp(p,roomList);await grayed(p,skip,false);
  await shot(p,`room-scrolled-up-${viewport.width}.png`);
  // 3. A new message arrives while scrolled up: still normal, the new row is below the fold.
  const incoming={...row('main',81)};messages.main.push(incoming);activity.roomMessageThrough.main=81;
  await p.evaluate(r=>window.dispatchEvent(new CustomEvent('chat-room-event',{detail:{eventType:'INSERT',new:r,old:{}}})),incoming);
  await p.waitForFunction((s,id)=>!!document.querySelector(s)?.querySelector(`[id="chat-message-${id}"]`),{},roomList,incoming.id);
  await pause(300);await grayed(p,skip,false);
  // 4. Tap: lands on the newest message and grays again.
  await p.click(skip);await p.waitForFunction(s=>{const e=document.querySelector(s);return e.scrollHeight-e.clientHeight-e.scrollTop<3;},{},roomList);
  await grayed(p,skip,true);
  // 5. A new message at the bottom: the room follows it and stays grayed.
  const next={...row('main',82)};messages.main.push(next);activity.roomMessageThrough.main=82;
  await p.evaluate(r=>window.dispatchEvent(new CustomEvent('chat-room-event',{detail:{eventType:'INSERT',new:r,old:{}}})),next);
  await p.waitForFunction((s,id)=>!!document.querySelector(s)?.querySelector(`[id="chat-message-${id}"]`),{},roomList,next.id);
  await pause(300);await grayed(p,skip,true);
  // 6. Thread open: the arrow follows the room beside it.
  await p.$eval(`[id="chat-message-${next.id}"]`,e=>[...e.querySelectorAll('button')].find(b=>/Reply/.test(b.textContent))?.click());
  await p.waitForFunction(()=>document.body.textContent.includes('Thread reply 3'));await pause(300);
  // Narrow windows show the thread over the room (and its header); only a wide one shows both.
  if(await p.$eval(skip,e=>{const b=e.getBoundingClientRect();return b.width>0&&document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')===e;})){
   await grayed(p,skip,await atBottom(p,roomList));
   await scrollUp(p,roomList);await grayed(p,skip,false);
   if(viewport.width===1440)await shot(p,'thread-room-scrolled-up-1440.png');
   await p.click(skip);await p.waitForFunction(s=>{const e=document.querySelector(s);return e.scrollHeight-e.clientHeight-e.scrollTop<3;},{},roomList);
   await grayed(p,skip,true);
  }
  await p.keyboard.press('Escape');await pause(200);
  // 7. A DM: grayed at its newest message, normal scrolled up, a tap returns and grays again.
  await openDm(p);await p.waitForFunction(s=>document.querySelector(s)?.getAttribute('aria-busy')==='false',{},dmList);
  await p.waitForFunction((s,id)=>!!document.querySelector(s)?.querySelector(`[data-message-id="${id}"]`),{},dmList,dms.at(-1).id);
  await p.$eval(dmList,e=>{e.scrollTop=e.scrollHeight;});
  await grayed(p,skip,true);
  await shot(p,`dm-at-latest-${viewport.width}.png`);
  const dmBefore=paths.length;await p.click(skip);await pause(400);
  assert.equal(paths.slice(dmBefore).some(path=>path===`/api/chat/inbox?conversation=${conversation.id}`),false,`${label}: grayed DM Latest fetches nothing`);
  await scrollUp(p,dmList);await grayed(p,skip,false);
  await shot(p,`dm-scrolled-up-${viewport.width}.png`);
  await p.click(skip);await p.waitForFunction(s=>{const e=document.querySelector(s);return e.scrollHeight-e.clientHeight-e.scrollTop<3;},{},dmList);
  await grayed(p,skip,true);
  assert.deepEqual(errors,[]);await p.close();console.log(`PASS ${label}: room, new messages, thread and DM gray Latest only at the newest message`);
 }
 // 8. An older page (a search or unread jump) that stops short of the newest messages: normal,
 // even at the bottom of the page shown.
 {
  openAt=messages.main[20].id;const {p,errors}=await open({width:1440,height:1000});
  await p.goto(base+'/chat?single');
  await p.waitForFunction((s,id)=>!!document.querySelector(s)?.querySelector(`[id="chat-message-${id}"]`),{},roomList,openAt);
  await p.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Newer messages'));
  await pause(500);await grayed(p,skip,false);
  // The last row of that page on screen (moved without a gesture, so no newer page loads): still normal.
  await p.$eval(roomList,e=>{e.scrollTop=e.scrollHeight;});
  await pause(500);
  assert.ok(await p.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Newer messages')),'older page: the newest messages are not loaded');
  assert.ok(await p.$eval(roomList,e=>e.scrollHeight-e.clientHeight-e.scrollTop<3),'older page: at the bottom of the page shown');
  await grayed(p,skip,false);
  await shot(p,'older-page-bottom-1440.png');
  await p.click(skip);await p.waitForFunction((s,id)=>!!document.querySelector(s)?.querySelector(`[id="chat-message-${id}"]`),{},roomList,messages.main.at(-1).id);
  await p.waitForFunction(s=>{const e=document.querySelector(s);return e.scrollHeight-e.clientHeight-e.scrollTop<3;},{},roomList);
  await grayed(p,skip,true);
  assert.deepEqual(errors,[]);await p.close();openAt=null;console.log('PASS older page: normal until the newest messages are loaded and shown');
 }
 // 9. A phone: the DM's info sheet holds Latest messages, grayed the same way.
 {
  const {p,errors}=await open({width:390,height:844,isMobile:true,hasTouch:true});
  await p.goto(base+'/chat?single&room=main');
  await openDm(p);await p.waitForFunction(s=>document.querySelector(s)?.getAttribute('aria-busy')==='false',{},dmList);
  await p.waitForFunction((s,id)=>!!document.querySelector(s)?.querySelector(`[data-message-id="${id}"]`),{},dmList,dms.at(-1).id);
  await p.$eval(dmList,e=>{e.scrollTop=e.scrollHeight;});await pause(300);
  const latestButton=async()=>{await p.click('header button[aria-label="Conversation info"]');await p.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Latest messages')));return p.evaluateHandle(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Latest messages')));};
  const state=b=>b.evaluate(e=>({off:e.getAttribute('aria-disabled')==='true',opacity:Number(getComputedStyle(e).opacity),title:e.title}));
  let b=await latestButton();let s=await state(b);
  assert.ok(s.off&&s.opacity<0.8&&s.opacity>0.2&&s.title==="You're at the latest message",`phone: Latest messages grayed at the newest DM message ${JSON.stringify(s)}`);
  if(shots)await p.screenshot({path:join(shots,'phone-dm-sheet-at-latest.png')});
  await b.click();await pause(200);
  assert.ok(await p.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Latest messages')&&b.getBoundingClientRect().width>0)),'phone: a grayed Latest messages does nothing (the sheet stays open)');
  await p.keyboard.press('Escape');await p.click('button[aria-label="Close conversation info"]').catch(()=>{});await pause(300);
  await scrollUp(p,dmList);await pause(300);
  b=await latestButton();s=await state(b);
  assert.ok(!s.off&&s.opacity===1,`phone: Latest messages normal when scrolled up ${JSON.stringify(s)}`);
  if(shots)await p.screenshot({path:join(shots,'phone-dm-sheet-scrolled-up.png')});
  await b.click();await p.waitForFunction(s=>{const e=document.querySelector(s);return e.scrollHeight-e.clientHeight-e.scrollTop<3;},{},dmList);await pause(300);
  b=await latestButton();s=await state(b);assert.ok(s.off,'phone: grayed again after Latest messages');
  assert.deepEqual(errors,[]);await p.close();console.log('PASS phone: the DM info sheet grays Latest messages at the newest message');
 }
 // 10. Every chat theme: grayed is dimmed but still shown, and normal again once scrolled up.
 for(const theme of ['dark','light','blade-runner','terminal','paper-terminal']){
  const {p,errors}=await open({width:1280,height:900});
  await p.evaluateOnNewDocument(t=>{try{localStorage.setItem('longboard-public-chat-theme-v1',t);}catch{}},theme);
  await p.goto(base+'/chat?single');
  await p.waitForFunction((s,id)=>!!document.querySelector(s)?.querySelector(`[id="chat-message-${id}"]`),{},roomList,messages.main.at(-1).id);
  await grayed(p,skip,true);await shot(p,`theme-${theme}-at-latest.png`);
  await scrollUp(p,roomList);await grayed(p,skip,false);await shot(p,`theme-${theme}-scrolled-up.png`);
  assert.deepEqual(errors,[]);await p.close();
 }
 console.log('PASS every theme: grayed stays visible, normal when scrolled up');
 console.log('Latest grayed browser checks passed.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
