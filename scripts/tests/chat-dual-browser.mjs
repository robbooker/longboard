// #492/#493 Dual view: actual React components and transport with synthetic, in-memory API responses.
// Never connects to production services or sends member messages.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer';
const root=new URL('../../',import.meta.url).pathname,dir=await mkdtemp(join(tmpdir(),'dual-test-'));
const member={id:'11111111-1111-4111-8111-111111111111',display_name:'Alice',accepts_requests:true};
const conversations=['Bob','Carol'].map((name,i)=>({id:`22222222-2222-4222-8222-22222222222${i}`,otherId:`33333333-3333-4333-8333-33333333333${i}`,otherName:name,status:'accepted',incoming:false,blockedByMe:false,unavailable:false,unread:0,lastBody:'Hi',updatedAt:new Date().toISOString()}));
const roomState={isOpen:true,notice:null,pausedAt:null,updatedAt:new Date().toISOString()};
const rooms=['main','shortscout','gainers'];
let availableRooms=rooms,availableDms=conversations;
const messages=Object.fromEntries(rooms.map(room=>[room,[{id:randomUUID(),room_slug:room,member_id:conversations[0].otherId,guest_id:null,author_label:'Bob',body:`Welcome to ${room}`,created_at:new Date().toISOString(),unread_seq:1}]]));
const dms=Object.fromEntries(conversations.map(c=>[c.id,[{id:randomUUID(),seq:1,sender_id:c.otherId,body:`Hello from ${c.otherName}`,created_at:new Date().toISOString()}]]));
const writes=[],paths=[];let blockedSend;
const activity={mentions:[],dms:[],mentionCount:0,dmCount:0,mentionThrough:0,dmThrough:0,roomCounts:{},roomThrough:{},roomMessageCounts:{main:1,shortscout:1},roomMessageThrough:{main:1,shortscout:1}};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import QuadChat from './components/chat/QuadChat';import PublicChat from './components/chat/PublicChat';const params=new URLSearchParams(location.search);const room=params.get('room')||'main';const Shell=params.has('single')||location.pathname==='/chat'?PublicChat:QuadChat;createRoot(document.getElementById('root')).render(<Shell dual={location.pathname==='/chat/dual'} accountId="test-account" bootstrap={${JSON.stringify({accountId:'test-account',room:'main',member,roomState,messages:[],reactions:[],counts:{},featureChannel:false})}} allowedRooms={${JSON.stringify(rooms)}} serverSession={false} room={room} popout={params.has('popout')} fontVariableClass="" appVersion="test"/>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:join(dir,'bundle.js'),define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'test-platform',setup(b){
 b.onResolve({filter:/^(next\/(link|image|dynamic|navigation)|@\/lib\/supabase\/client)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'tsx',resolveDir:root,contents:a.path==='next/dynamic'?`import React from 'react';export default function dynamic(load){const C=React.lazy(load);return props=><React.Suspense fallback={<p>Loading…</p>}><C {...props}/></React.Suspense>;}`:a.path==='next/navigation'?`export const useRouter=()=>({push:url=>location.href=url,refresh:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;`:a.path.includes('supabase')?`export function createClient(){const channel={on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},track:async()=>{},presenceState:()=>({})};return {channel:(name)=>{window.testChannels??=[];window.testChannels.push(name);return channel},removeChannel:()=>{},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}`:`import React from 'react';export default function Component({children,unoptimized,fill,priority,scroll,...props}){return React.createElement(${a.path==='next/link'?"'a'":"'img'"},props,children);}`}));
}}]});
function read(path){paths.push(path);const u=new URL(path,'http://localhost');const room=u.searchParams.get('room')||'main';
 if(u.pathname==='/api/chat/quad-options')return {accountId:'test-account',rooms:availableRooms,conversations:availableDms};
 if(u.pathname==='/api/chat/history')return {messages:messages[room]||[],reactions:[],hasMore:false};
 if(u.pathname==='/api/chat/thread-counts')return {counts:{}};
 if(u.pathname==='/api/chat/opening')return {messageId:null,readThrough:0};
 if(u.pathname==='/api/chat/thread')return {parent:messages[room][0],replies:[],hasMore:false};
 if(u.pathname==='/api/chat/inbox'){const id=u.searchParams.get('conversation');return id?{messages:dms[id]||[],hasMore:false}:{conversations:availableDms};}
 if(u.pathname==='/api/chat/activity')return activity;
 if(u.pathname==='/api/chat')return roomState;
 if(u.pathname==='/api/chat/app-version')return {version:'test'};
 if(u.pathname==='/api/chat/pins')return {pins:[]};
 return {};
}
const server=createServer(async(req,res)=>{
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.url.startsWith('/chat/quad')||req.url.startsWith('/chat/dual')||req.url.startsWith('/chat?')||req.url==='/chat'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script>');}
 if(['/bundle.js','/bundle.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');return res.end(await readFile(join(dir,req.url.slice(1))));}
 if(req.url==='/chat-sw.js'){res.setHeader('Content-Type','text/javascript');return res.end('');}
 if(req.method!=='POST')return send(read(req.url));
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
 if(req.url==='/api/chat/updates')return send({results:body.paths.map(path=>({path,status:200,data:read(path)}))});
 if(req.url==='/api/chat/message-reactions')return send({messages:{}});
 writes.push({path:req.url,body});
 if(req.url==='/api/chat'&&body.body){const message={id:randomUUID(),room_slug:body.room,member_id:member.id,guest_id:member.id,author_label:'Alice',body:body.body,created_at:new Date().toISOString(),client_id:body.clientId};messages[body.room].push(message);if(body.body==='Hold send')return void(blockedSend=()=>send({message}));return send({message});}
 if(req.url==='/api/chat/inbox'&&body.action==='send'){const message={id:randomUUID(),sender_id:member.id,body:body.body,seq:dms[body.target].length+1,client_id:body.clientId,created_at:new Date().toISOString()};dms[body.target].push(message);return send({message});}
 return send({});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
let browser;console.log("Fixture ready",base);
try{

 browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const p=await browser.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('pageerror:',e.message);});
 const shots=process.env.DUAL_SHOTS;const shot=async name=>{if(shots){await new Promise(r=>setTimeout(r,1500));await p.screenshot({path:`${shots}/${name}.png`});}};
 const pane=i=>`section[aria-label^="Pane ${i+1}:"]`,visiblePanes=()=>p.$$eval('section[aria-label^="Pane "]:not([hidden])',e=>e.length);
 const noSideScroll=async()=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const settle=()=>new Promise(r=>setTimeout(r,250));
 // 1. Desktop: two panes side by side, and opening Dual view turns it on for this device.
 await p.setViewport({width:1440,height:900});await p.goto(base+'/chat/dual');await p.waitForSelector('select');
 assert.equal(await p.$eval('h1',e=>e.textContent),'Dual view');assert.equal(await p.$$eval('section[aria-label^="Pane "]',e=>e.length),2);
 assert.equal(await p.evaluate(()=>localStorage.getItem('rb-chat-view-v1')),'dual');
 assert.equal(await p.$('a[href="/chat/six"]'),null);
 await p.waitForFunction(()=>document.body.textContent.includes('Welcome to main')&&document.body.textContent.includes('Welcome to shortscout'));
 await p.select(`${pane(1)} select`,`dm:${conversations[0].id}`);
 await p.waitForSelector(`${pane(1)} section[aria-label="Private conversation"] textarea`,{visible:true});const dmInput=`${pane(1)} textarea[placeholder="Write a private message…"]`;
 const side=await p.$$eval('section[aria-label^="Pane "]',e=>e.map(s=>s.getBoundingClientRect()).map(r=>({left:r.left,right:r.right,top:r.top,w:r.width})));
 assert.ok(side[1].left>=side[0].right&&Math.abs(side[0].top-side[1].top)<1&&side[0].w>500,'side by side');
 for(const [sel,text] of [[`${pane(0)} textarea`,'Room from dual'],[dmInput,'DM from dual']]){await p.type(sel,text);await p.$eval(sel,e=>e.form.requestSubmit());await p.waitForFunction(t=>[...document.querySelectorAll('article')].some(e=>e.textContent.includes(t)),{},text);}
 assert.deepEqual(writes.filter(w=>w.path==='/api/chat').map(w=>w.body.room),['main']);assert.deepEqual(writes.filter(w=>w.path==='/api/chat/inbox'&&w.body.action==='send').map(w=>w.body.target),[conversations[0].id]);
 await p.click(`${pane(0)} button[aria-label="Expand pane 1"]`);assert.equal(await visiblePanes(),1);await p.click(`${pane(0)} button[aria-label="Restore two panes"]`);assert.equal(await visiblePanes(),2);
 await noSideScroll();await shot('1-dual-desktop');
 // 2. An open folding phone (Galaxy Fold inner screen): still two chats side by side, no tabs.
 await p.setViewport({width:690,height:830,isMobile:true,hasTouch:true,deviceScaleFactor:2});await settle();
 assert.equal(await visiblePanes(),2);assert.equal(await p.$eval('nav[aria-label="Choose visible conversation"]',e=>getComputedStyle(e).display),'none');
 const fold=await p.$$eval('section[aria-label^="Pane "]',e=>e.map(s=>s.getBoundingClientRect()).map(r=>({left:r.left,right:r.right,top:r.top})));assert.ok(fold[1].left>=fold[0].right&&Math.abs(fold[0].top-fold[1].top)<1);
 await noSideScroll();await shot('2-fold-open');
 // 3. Closing it (the outside screen): one chat at a time, nothing cut off, the draft kept.
 await p.waitForSelector(dmInput,{visible:true});await p.type(dmInput,'Draft across folds');
 await p.setViewport({width:344,height:880,isMobile:true,hasTouch:true,deviceScaleFactor:2});await settle();
 assert.equal(await visiblePanes(),1);await noSideScroll();await shot('3-fold-closed');
 await p.click('nav[aria-label="Choose visible conversation"] button:nth-child(2)');assert.equal(await p.$eval(dmInput,e=>e.value),'Draft across folds');
 // 4. Opening it again brings both back.
 await p.setViewport({width:690,height:830,isMobile:true,hasTouch:true,deviceScaleFactor:2});await settle();assert.equal(await visiblePanes(),2);
 // 5. The layout is remembered.
 await p.evaluate(()=>window.dispatchEvent(new Event('chat-before-refresh',{cancelable:true})));await p.reload();await p.waitForSelector(dmInput);assert.equal(await p.$eval(`${pane(1)} select`,e=>e.value),`dm:${conversations[0].id}`);
 // 6. Single chat turns Dual view off; the menu offers it only where two chats fit.
 await p.$eval(dmInput,e=>{const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));});
 await p.click('a[href="/chat"]');await p.waitForFunction(()=>location.pathname==='/chat');await p.waitForSelector('button[aria-label="Chat settings"]');
 assert.equal(await p.evaluate(()=>localStorage.getItem('rb-chat-view-v1')),null);
 await p.click('button[aria-label="Chat settings"]');await p.waitForSelector('a[href="/chat/dual"]');assert.ok(await p.$eval('a[href="/chat/dual"]',e=>e.getBoundingClientRect().height>0));await shot('4-menu-fold-open');
 await p.keyboard.press('Escape');
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2});await settle();
 // A regular phone's chat has no Dual view entry showing anywhere.
 assert.equal(await p.$$eval('a[href="/chat/dual"]',e=>e.filter(x=>x.getClientRects().length>0&&getComputedStyle(x).display!=='none').length),0);
 // 7. Dual view off: opening the phone wide doesn't switch anything.
 await p.setViewport({width:690,height:830,isMobile:true,hasTouch:true});await settle();assert.equal(await p.evaluate(()=>location.pathname),'/chat');
 // 8. Dual view on, single chat on the closed phone: opening the phone goes to Dual view.
 await p.setViewport({width:344,height:880,isMobile:true,hasTouch:true});await settle();await p.evaluate(()=>localStorage.setItem('rb-chat-view-v1','dual'));
 await p.setViewport({width:690,height:830,isMobile:true,hasTouch:true});await p.waitForFunction(()=>location.pathname==='/chat/dual',{timeout:10000});await p.waitForSelector('select');
 // ...but not while a message is still sending.
 await p.click('a[href="/chat"]');await p.waitForFunction(()=>location.pathname==='/chat');await p.waitForSelector('textarea[aria-label="Message LB"]');
 await p.evaluate(()=>localStorage.setItem('rb-chat-view-v1','dual'));await p.setViewport({width:344,height:880,isMobile:true,hasTouch:true});await settle();
 await p.$eval('textarea[aria-label="Message LB"]',e=>{const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(e,'Hold send');e.dispatchEvent(new Event('input',{bubbles:true}));});await p.$eval('textarea[aria-label="Message LB"]',e=>e.form.requestSubmit());await settle();
 await p.setViewport({width:690,height:830,isMobile:true,hasTouch:true});await settle();await settle();assert.equal(await p.evaluate(()=>location.pathname),'/chat');blockedSend?.();blockedSend=null;
 assert.deepEqual(errors,[]);console.log('chat-dual-browser: all checks passed');
}catch(e){console.error(e);process.exitCode=1;}finally{blockedSend?.();server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
