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
const writes=[],paths=[];let blockedSend;
const activity={mentions:[],dms:[],mentionCount:0,dmCount:0,mentionThrough:0,dmThrough:0,roomCounts:{},roomThrough:{},roomMessageCounts:{main:1,shortscout:1},roomMessageThrough:{main:1,shortscout:1}};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import QuadChat from './components/chat/QuadChat';import PublicChat from './components/chat/PublicChat';const params=new URLSearchParams(location.search);const room=params.get('room')||'main';const Shell=params.has('single')||location.pathname==='/chat'?PublicChat:QuadChat;createRoot(document.getElementById('root')).render(<Shell accountId="test-account" bootstrap={${JSON.stringify({accountId:'test-account',room:'main',member,roomState,messages:[],reactions:[],counts:{},featureChannel:false})}} allowedRooms={${JSON.stringify(rooms)}} serverSession={false} room={room} popout={params.has('popout')} fontVariableClass="" appVersion="test"/>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:join(dir,'bundle.js'),define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'test-platform',setup(b){
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
 return {};
}
const server=createServer(async(req,res)=>{
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.url.startsWith('/chat/quad')||req.url.startsWith('/chat?')){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script>');}
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
 browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});console.log("Browser launched");const p=await browser.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('pageerror:',e.message);});p.on('console',m=>{if(m.type()==='error')console.log('console:',m.text());});
 await p.setViewport({width:1440,height:1000});await p.goto(base+'/chat/quad');await p.waitForSelector('select');console.log('Pickers loaded');
 const pane=i=>`section[aria-label^="Pane ${i+1}:"]`;
 const input=i=>i>=2?`${pane(i)} textarea[placeholder="Write a private message…"]`:`${pane(i)} textarea`;
 await p.select(`${pane(2)} select`,`dm:${conversations[0].id}`);await p.select(`${pane(3)} select`,`dm:${conversations[1].id}`);
 await p.waitForSelector(`${pane(2)} section[aria-label="Private conversation"] textarea`,{visible:true});await p.waitForSelector(`${pane(3)} section[aria-label="Private conversation"] textarea`,{visible:true});await p.waitForFunction(()=>document.body.textContent.includes('Welcome to main'));
 for(const [i,text] of [[0,'LB isolated send'],[1,'SS isolated send'],[2,'Bob isolated send'],[3,'Carol isolated send']]){await p.type(input(i),text);await p.$eval(input(i),e=>e.form.requestSubmit());await p.waitForFunction((t)=>[...document.querySelectorAll('article')].some(e=>e.textContent.includes(t)),{},text);}
 assert.deepEqual(writes.filter(w=>w.path==='/api/chat').map(w=>w.body.room),['main','shortscout']);assert.deepEqual(writes.filter(w=>w.path==='/api/chat/inbox'&&w.body.action==='send').map(w=>w.body.target),conversations.map(c=>c.id));
 await p.type(`${pane(0)} textarea`,'Remember room draft');await p.type(input(2),'Remember DM draft');
 await p.click(`${pane(0)} button[aria-label="Expand pane 1"]`);assert.equal(await p.$$eval('section[aria-label^="Pane "]:not([hidden])',e=>e.length),1);await p.click(`${pane(0)} button[aria-label="Restore four panes"]`);
 // Threads stay inside the originating pane and leave URL unchanged.
 const url=p.url();await p.click(`${pane(0)} article button[aria-expanded]`);await p.waitForSelector(`${pane(0)} aside[aria-label="Comment replies"]`);assert.equal(p.url(),url);
 const bounds=await p.$eval(`${pane(0)}`,e=>{const a=e.getBoundingClientRect(),b=e.querySelector('aside[aria-label="Comment replies"]').getBoundingClientRect();return {inside:b.left>=a.left&&b.right<=a.right&&b.bottom<=a.bottom};});assert.ok(bounds.inside);
 await p.$$eval(`${pane(0)} aside header button`,bs=>bs.at(-1).click());
 await p.select(`${pane(1)} select`,'room:gainers');await p.waitForFunction(s=>document.querySelector(s)?.textContent.includes('Welcome to gainers'),{},pane(1));assert.equal(await p.$(`${pane(1)} textarea`),null);
 // A real Gainers popup stays live and read-only, and leaves the quad intact.
 const quadUrl=p.url();const popupPromise=new Promise(resolve=>p.once('popup',resolve));
 await p.click(`${pane(1)} button[aria-label="Pop out Gainers"]`);
 const popup=await popupPromise;await popup.waitForFunction(()=>document.body.textContent.includes('Welcome to gainers'));
 assert.ok(popup.url().includes('room=gainers'));assert.equal(p.url(),quadUrl);
 assert.equal(await popup.$('textarea'),null);assert.equal(await popup.evaluate(()=>window.opener),null);
 messages.gainers.push({id:randomUUID(),room_slug:'gainers',member_id:conversations[0].otherId,author_label:'Gainers',body:'Fresh popout alert',created_at:new Date().toISOString(),unread_seq:2});
 await popup.waitForFunction(()=>document.body.textContent.includes('Fresh popout alert'),{timeout:45000});
 await popup.click('button[aria-label="Chat settings"]');await popup.waitForSelector('a[href="/chat?room=gainers"]');
 assert.match(await popup.$eval('a[href="/chat?room=gainers"]',e=>e.textContent),/Return to Gainers/);
 await popup.click('a[href="/chat?room=gainers"]');await popup.waitForSelector('button[aria-label="Pop out Gainers"]');
 await popup.setViewport({width:320,height:800});assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await popup.close();assert.equal(p.isClosed(),false);
 await p.evaluate(()=>{window.savedOpen=window.open;window.open=()=>null;});
 await p.click(`${pane(1)} button[aria-label="Pop out Gainers"]`);await p.waitForFunction(()=>document.body.textContent.includes('Allow popups and try again'));
 await p.evaluate(()=>{window.open=window.savedOpen;});
 for(const width of [1440,900,390,320]){await p.setViewport({width,height:900});await new Promise(r=>setTimeout(r,150));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await p.$$eval('section[aria-label^="Pane "]:not([hidden])',e=>e.length),width>760?4:1);await p.screenshot({path:`/tmp/quad-${width}.png`});}
 await p.setViewport({width:390,height:850});
 const beforeHidden=writes.length;for(const c of conversations)dms[c.id].push({id:randomUUID(),seq:10,sender_id:c.otherId,body:'Hidden incoming',created_at:new Date().toISOString()});
 await p.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));await new Promise(r=>setTimeout(r,500));assert.equal(writes.slice(beforeHidden).some(w=>w.path==='/api/chat/inbox'&&w.body.action==='read'),false);
 await p.click('nav[aria-label="Choose visible conversation"] button:nth-child(3)');assert.equal(await p.$eval(input(2),e=>e.value),'Remember DM draft');
 await p.setViewport({width:1440,height:1000});await p.evaluate(()=>window.dispatchEvent(new Event('chat-before-refresh',{cancelable:true})));await p.reload();await p.waitForSelector(input(2));assert.equal(await p.$eval(input(2),e=>e.value),'Remember DM draft');assert.equal(await p.$eval(`${pane(0)} textarea`,e=>e.value),'Remember room draft');
 // Pending sends prevent unmount/replacement.
 await p.$eval(`${pane(0)} textarea`,e=>{const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(e,'Hold send');e.dispatchEvent(new Event('input',{bubbles:true}));});await p.$eval(`${pane(0)} textarea`,e=>e.form.requestSubmit());await new Promise(r=>setTimeout(r,100));await p.select(`${pane(0)} select`,'room:shortscout');assert.equal(await p.$eval(`${pane(0)} select`,e=>e.value),'room:main');blockedSend?.();blockedSend=null;
 // Revoked choices disappear and cannot be resurrected by saved browser state.
 availableRooms=['main','gainers'];availableDms=[conversations[1]];await p.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));await p.waitForFunction(s=>document.querySelector(s)?.value==='',{},`${pane(2)} select`);
 await p.evaluate(async selector=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const blob=await new Promise(r=>canvas.toBlob(r));const data=new DataTransfer();data.items.add(new File([blob],'quad.png',{type:'image/png'}));const input=document.querySelector(selector);input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));},`${pane(0)} input[type=file]`);
 await p.waitForSelector(`${pane(0)} [aria-label="Remove quad.png"]`);await p.select(`${pane(0)} select`,'');assert.equal(await p.$eval(`${pane(0)} select`,e=>e.value),'room:main');await p.click(`${pane(0)} [aria-label="Remove quad.png"]`);
 assert.equal(await p.evaluate(()=>window.testChannels.filter(n=>n.startsWith('chat-updates-')).length),1);await p.goto(base+'/chat/quad?single');await p.waitForSelector('button[aria-label="Chat settings"]');await p.click('button[aria-label="Chat settings"]');await p.waitForSelector('a[href="/chat/quad"]');await p.keyboard.press('Escape');await p.waitForSelector('textarea[aria-label="Message LB"]');await p.type('textarea[aria-label="Message LB"]','Single view regression');await p.$eval('textarea[aria-label="Message LB"]',e=>e.form.requestSubmit());await p.waitForFunction(()=>[...document.querySelectorAll('article')].some(e=>e.textContent.includes('Single view regression')));assert.deepEqual(errors,[]);console.log('Quad actual-component browser checks passed: isolated sends, pane threads, layouts, drafts, pending sends, revoked choices.');
}catch(e){console.error(e);throw e;}finally{blockedSend?.();server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
