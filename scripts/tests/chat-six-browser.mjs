// #379 Six view: the actual React components and transport with synthetic, in-memory API responses.
// Never connects to production services or sends member messages.
//
// Checks: Six opens as three across and two down at 1920x1080; cards are chosen with the picker
// (mouse and keyboard only) as two rooms, a DM and the Gainers Table; the layout is sent to the
// server and a reload restores it; the server copy wins over this browser's, and this browser's
// copy is used when the server can't be read; losing Gainers clears that card; narrower windows
// fall back (two across, then one card with tabs); Quad still works, with its own saved layout.
//
// Usage: node scripts/tests/chat-six-browser.mjs [--shots <dir>] [--quad-shot-only]
//   --shots writes t379-six.png, t379-picker.png and t379-before.png (Quad) into <dir>.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer';
const args=process.argv.slice(2),shots=args.includes('--shots')?args[args.indexOf('--shots')+1]:null,quadShotOnly=args.includes('--quad-shot-only');
const root=new URL('../../',import.meta.url).pathname,dir=await mkdtemp(join(tmpdir(),'six-test-'));
const member={id:'11111111-1111-4111-8111-111111111111',display_name:'Alice',accepts_requests:true};
const conversations=['Bob','Carol'].map((name,i)=>({id:`22222222-2222-4222-8222-22222222222${i}`,otherId:`33333333-3333-4333-8333-33333333333${i}`,otherName:name,status:'accepted',incoming:false,blockedByMe:false,unavailable:false,unread:0,lastBody:'Hi',updatedAt:new Date().toISOString()}));
const roomState={isOpen:true,notice:null,pausedAt:null,updatedAt:new Date().toISOString()};
const rooms=['main','social','shortscout','gainers'];
let gainersTable=true,layoutStatus=200,saved=null;
const messages=Object.fromEntries(rooms.map(room=>[room,[{id:randomUUID(),room_slug:room,member_id:conversations[0].otherId,guest_id:null,author_label:'Bob',body:`Welcome to ${room}`,created_at:new Date(Date.now()-60000).toISOString(),unread_seq:1}]]));
const dms=Object.fromEntries(conversations.map(c=>[c.id,[{id:randomUUID(),seq:1,sender_id:c.otherId,body:`Hello from ${c.otherName}`,created_at:new Date().toISOString()}]]));
const minutesAgo=m=>new Date(Date.now()-m*60000).toISOString();
const table={day:'2026-11-08',rows:[
 {sym:'ABCD',lastAlertAt:minutesAgo(3),alerts:2,country:'United States',countryChecked:true,cashUsd:12500000,cashMonthsLeft:8,cashFlowPositive:false,cashChecked:true,instOwnPct:4.2,instOwnChecked:true,notFound:false,quote:{price:3.42,changePct:48.7,volume:18250000}},
 {sym:'WXYZ',lastAlertAt:minutesAgo(11),alerts:1,country:'China',countryChecked:true,cashUsd:null,cashMonthsLeft:null,cashFlowPositive:true,cashChecked:true,instOwnPct:0.8,instOwnChecked:true,notFound:false,quote:{price:1.07,changePct:22.1,volume:6400000}},
 {sym:'QRST',lastAlertAt:minutesAgo(26),alerts:3,country:null,countryChecked:false,cashUsd:null,cashMonthsLeft:null,cashFlowPositive:false,cashChecked:false,instOwnPct:null,instOwnChecked:false,notFound:false,quote:{price:7.9,changePct:-3.4,volume:2100000}},
]};
const writes=[];
const activity={mentions:[],dms:[],mentionCount:0,dmCount:0,mentionThrough:0,dmThrough:0,roomCounts:{},roomThrough:{},roomMessageCounts:{},roomMessageThrough:{}};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import QuadChat from './components/chat/QuadChat';${quadShotOnly?'const SixChat=QuadChat;':"import SixChat from './components/chat/SixChat';"}const Shell=location.pathname==='/chat/six'?SixChat:QuadChat;createRoot(document.getElementById('root')).render(<Shell accountId="test-account" bootstrap={${JSON.stringify({accountId:'test-account',room:'main',member,roomState,messages:[],reactions:[],counts:{},featureChannel:false})}} allowedRooms={${JSON.stringify(rooms)}} serverSession={false} room="main" popout fontVariableClass="" appVersion="test"/>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:join(dir,'bundle.js'),define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'test-platform',setup(b){
 b.onResolve({filter:/^(next\/(link|image|dynamic|navigation)|@\/lib\/supabase\/client)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'tsx',resolveDir:root,contents:a.path==='next/dynamic'?`import React from 'react';export default function dynamic(load){const C=React.lazy(load);return props=><React.Suspense fallback={<p>Loading…</p>}><C {...props}/></React.Suspense>;}`:a.path==='next/navigation'?`export const useRouter=()=>({push:url=>location.href=url,refresh:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;`:a.path.includes('supabase')?`export function createClient(){const channel={on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},track:async()=>{},presenceState:()=>({})};return {channel:()=>channel,removeChannel:()=>{},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}`:`import React from 'react';export default function Component({children,unoptimized,fill,priority,scroll,...props}){return React.createElement(${a.path==='next/link'?"'a'":"'img'"},props,children);}`}));
}}]});
function read(path){const u=new URL(path,'http://localhost');const room=u.searchParams.get('room')||'main';
 if(u.pathname==='/api/chat/quad-options')return {accountId:'test-account',rooms,conversations,gainersTable};
 if(u.pathname==='/api/chat/history')return {messages:messages[room]||[],reactions:[],hasMore:false};
 if(u.pathname==='/api/chat/thread-counts')return {counts:{}};
 if(u.pathname==='/api/chat/opening')return {messageId:null,readThrough:0};
 if(u.pathname==='/api/chat/inbox'){const id=u.searchParams.get('conversation');return id?{messages:dms[id]||[],hasMore:false}:{conversations};}
 if(u.pathname==='/api/chat/activity')return activity;
 if(u.pathname==='/api/chat')return roomState;
 if(u.pathname==='/api/chat/app-version')return {version:'test'};
 if(u.pathname==='/api/chat/pins')return {pins:[]};
 if(u.pathname==='/api/chat/gainers/table')return table;
 return {};
}
// The server's check, as the real route does it for this member (unit-tested in chatCardLayoutRoute.test.ts).
const allowed=c=>c===null||(c.type==='room'&&rooms.includes(c.source))||(c.type==='dm'&&conversations.some(d=>d.id===c.source))||(c.type==='gainers-table'&&c.source===''&&gainersTable);
const server=createServer(async(req,res)=>{
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.url.startsWith('/chat/quad')||req.url.startsWith('/chat/six')){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script>');}
 if(['/bundle.js','/bundle.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');return res.end(await readFile(join(dir,req.url.slice(1))));}
 if(req.url==='/chat-sw.js'){res.setHeader('Content-Type','text/javascript');return res.end('');}
 if(req.url.startsWith('/api/chat/card-layout')){
  if(layoutStatus!==200)return send({error:'layout_unavailable'},layoutStatus);
  if(req.method==='GET')return send({layout:saved?saved.map(c=>allowed(c)?c:null):null,saved:!!saved});
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');writes.push({path:'/api/chat/card-layout',body});
  saved=body.layout.map(c=>allowed(c)?c:null);return send({layout:saved,saved:true});
 }
 if(req.method!=='POST')return send(read(req.url));
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
 if(req.url==='/api/chat/updates')return send({results:body.paths.map(path=>({path,status:200,data:read(path)}))});
 if(req.url==='/api/chat/message-reactions')return send({messages:{}});
 writes.push({path:req.url,body});
 if(req.url==='/api/chat'&&body.body){const message={id:randomUUID(),room_slug:body.room,member_id:member.id,guest_id:member.id,author_label:'Alice',body:body.body,created_at:new Date().toISOString(),client_id:body.clientId};messages[body.room].push(message);return send({message});}
 return send({});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const card=i=>`section[data-card="${i}"]`,pause=ms=>new Promise(r=>setTimeout(r,ms));
const titles=p=>p.$$eval('section[data-card] h2',hs=>hs.map(h=>h.textContent.replace(/^Card \d+: /,'').trim()));
const noSideScroll=p=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
try{
 browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('pageerror:',e.message);});p.on('console',m=>{if(m.type()==='error')console.log('console:',m.text());});
 await p.setViewport({width:1920,height:1080});
 if(quadShotOnly){
  await p.goto(base+'/chat/quad');await p.waitForSelector('select');await p.waitForFunction(()=>document.body.textContent.includes('Welcome to gainers'));await pause(600);
  await p.screenshot({path:join(shots,'t379-before.png')});console.log('Quad screenshot saved');
 }else{
 // Quad's saved panes seed a first Six.
 await p.goto(base+'/chat/quad');await p.waitForSelector('select');
 await p.select('section[aria-label^="Pane 3:"] select',`dm:${conversations[1].id}`);await pause(200);
 await p.goto(base+'/chat/six');await p.waitForSelector(`${card(6)}`);await p.waitForFunction(()=>!document.body.textContent.includes('Loading your cards'));
 assert.deepEqual(await titles(p),['#LB','#Social','DMCarol','#Gainers','Gainers Table','#SS'],'Quad layout first, then the Gainers Table, then rooms');
 // Three across, two down, filling the window.
 const boxes=await p.$$eval('section[data-card]',s=>s.map(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:r.width,h:r.height,b:r.bottom};}));
 assert.equal(new Set(boxes.map(b=>b.x)).size,3);assert.equal(new Set(boxes.map(b=>b.y)).size,2);
 assert.ok(boxes.every(b=>b.w>550&&b.h>420),'cards fill a 1920x1080 screen');assert.ok(Math.max(...boxes.map(b=>b.b))<=1080);assert.ok(await noSideScroll(p));
 // Clear every card, then choose two rooms, a DM and the Gainers Table.
 for(let i=1;i<=6;i++)await p.click(`${card(i)} button[aria-label="Remove card ${i}"]`);
 assert.deepEqual(await titles(p),Array(6).fill('Empty card'));
 assert.ok(writes.at(-1).body.layout.every(c=>c===null),'clearing is saved');
 const choose=async(i,type,source)=>{await p.click(`${card(i)} button[aria-label="Choose card ${i}"]`);await p.waitForSelector(`${card(i)} [data-card-picker]`);await p.click(`${card(i)} [data-card-picker] input[value="${type}"]`);if(source!==undefined)await p.select(`${card(i)} [data-card-picker] select`,source);await p.click(`${card(i)} [data-card-picker] button[type=submit]`);await p.waitForSelector(`${card(i)} [data-card-picker]`,{hidden:true});};
 await choose(1,'room','main');await choose(2,'room','shortscout');
 // The picker greys out what's already on another card.
 await p.click(`${card(3)} button[aria-label="Choose card 3"]`);await p.click(`${card(3)} [data-card-picker] input[value="room"]`);
 assert.deepEqual(await p.$$eval(`${card(3)} [data-card-picker] option:disabled`,o=>o.map(e=>e.value)),['main','shortscout']);
 await p.click(`${card(3)} [data-card-picker] input[value="gainers-table"]`);
 assert.equal(await p.$(`${card(3)} [data-card-picker] select`),null,'the Gainers Table has nothing to choose');
 if(shots)await p.screenshot({path:join(shots,'t379-picker.png')});
 await p.click(`${card(3)} [data-card-picker] button[type=submit]`);await p.waitForSelector(`${card(3)} [data-gainers-table]`);
 // Card 4 by keyboard only: open, arrow to "Direct message", pick Bob, apply; focus comes back.
 await p.focus(`${card(4)} button[aria-label="Choose card 4"]`);await p.keyboard.press('Enter');await p.waitForSelector(`${card(4)} [data-card-picker]`);
 assert.equal(await p.evaluate(()=>document.activeElement?.value),'room','focus starts on the selected card type');
 await p.keyboard.press('ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement?.value),'dm');
 await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement?.tagName),'SELECT');
 assert.equal(await p.$eval(`${card(4)} [data-card-picker] select`,s=>s.value),conversations[0].id);
 await p.keyboard.press('Tab');await p.keyboard.press('Tab');await p.keyboard.press('Enter');
 await p.waitForSelector(`${card(4)} [data-card-picker]`,{hidden:true});await pause(50);
 assert.equal(await p.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Change card 4','focus returns to the card header');
 // Escape closes the picker without changing the card.
 await p.focus(`${card(4)} button[aria-label="Change card 4"]`);await p.keyboard.press('Enter');await p.waitForSelector(`${card(4)} [data-card-picker]`);await p.keyboard.press('Escape');await p.waitForSelector(`${card(4)} [data-card-picker]`,{hidden:true});
 await choose(5,'dm',conversations[1].id);await choose(6,'room','social');
 const expected=[{type:'room',source:'main'},{type:'room',source:'shortscout'},{type:'gainers-table',source:''},{type:'dm',source:conversations[0].id},{type:'dm',source:conversations[1].id},{type:'room',source:'social'}];
 assert.deepEqual(writes.at(-1).body,{view:'six',layout:expected});
 // Every card shows its own thing.
 await p.waitForFunction(s=>document.querySelector(s)?.textContent.includes('Welcome to main'),{},card(1));
 await p.waitForFunction(s=>document.querySelector(s)?.textContent.includes('Welcome to shortscout'),{},card(2));
 await p.waitForFunction(s=>document.querySelector(s)?.textContent.includes('Hello from Bob'),{},card(4));
 await p.waitForFunction(s=>document.querySelector(s)?.textContent.includes('Hello from Carol'),{},card(5));
 assert.deepEqual(await p.$$eval(`${card(3)} [data-gainers-row]`,r=>r.map(e=>e.dataset.gainersRow)),['ABCD','WXYZ','QRST']);
 assert.ok(await p.$eval(`${card(3)} [data-card-gainers]`,e=>e.scrollWidth<=e.parentElement.clientWidth+1||getComputedStyle(e).overflow==='auto'));
 // A message sent from a room card goes to that room only.
 await p.type(`${card(2)} textarea`,'Six card send');await p.$eval(`${card(2)} textarea`,e=>e.form.requestSubmit());
 await p.waitForFunction(s=>document.querySelector(s)?.textContent.includes('Six card send'),{},card(2));
 assert.deepEqual(writes.filter(w=>w.path==='/api/chat').map(w=>w.body.room),['shortscout']);
 await pause(400);if(shots)await p.screenshot({path:join(shots,'t379-six.png')});
 // Reload keeps it (the server copy).
 await p.evaluate(()=>window.dispatchEvent(new Event('chat-before-refresh',{cancelable:true})));
 await p.reload();await p.waitForSelector(`${card(3)} [data-gainers-table]`);
 assert.deepEqual(await titles(p),['#LB','#SS','Gainers Table','DMBob','DMCarol','#Social']);
 // The server copy wins over this browser's; this browser's is the fallback when the server can't answer.
 await p.evaluate(()=>localStorage.setItem('rb-chat-six-v1:test-account',JSON.stringify([{type:'room',source:'social'}])));
 await p.reload();await p.waitForSelector(`${card(3)} [data-gainers-table]`);assert.equal((await titles(p))[0],'#LB');
 layoutStatus=503;await p.reload();await p.waitForFunction(()=>document.body.textContent.includes("showing this browser's copy"));
 assert.equal((await titles(p))[0],'#LB','the browser copy was refreshed from the server on the last open');
 layoutStatus=200;
 // Losing Gainers empties that card in place; the others stay put.
 gainersTable=false;await p.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));
 await p.waitForFunction(s=>document.querySelector(s)?.dataset.cardType==='',{},card(3));
 assert.deepEqual(await titles(p),['#LB','#SS','Empty card','DMBob','DMCarol','#Social']);
 await p.click(`${card(3)} button[aria-label="Choose card 3"]`);
 assert.deepEqual(await p.$$eval(`${card(3)} [data-card-picker] input[type=radio]`,r=>r.map(e=>e.value)),['room','dm'],'no Gainers Table without Gainers');
 await p.keyboard.press('Escape');gainersTable=true;
 // Narrower windows: two across below 1100px, one card with tabs on a phone; never sideways scroll.
 await p.setViewport({width:1000,height:900});await pause(150);
 assert.equal(new Set(await p.$$eval('section[data-card]',s=>s.map(e=>Math.round(e.getBoundingClientRect().left)))).size,2);assert.ok(await noSideScroll(p));
 await p.setViewport({width:390,height:844});await pause(150);
 assert.equal(await p.$$eval('section[data-card]:not([hidden])',e=>e.length),1);assert.ok(await noSideScroll(p));
 await p.click('nav[aria-label="Choose visible card"] button:nth-child(5)');assert.equal(await p.$eval('section[data-card]:not([hidden])',e=>e.dataset.card),'5');
 // The Six entry in Quad shows on a monitor only.
 await p.setViewport({width:1440,height:1000});await p.goto(base+'/chat/quad');await p.waitForSelector('select');
 assert.ok(await p.$eval('a[href="/chat/six"]',e=>e.checkVisibility()));
 await p.setViewport({width:1000,height:900});assert.equal(await p.$eval('a[href="/chat/six"]',e=>e.checkVisibility()),false);
 // Quad still works with its own saved layout.
 await p.setViewport({width:1440,height:1000});
 assert.equal(await p.$eval('section[aria-label^="Pane 3:"] select',e=>e.value),`dm:${conversations[1].id}`);
 await p.waitForFunction(()=>document.body.textContent.includes('Hello from Carol'));
 await p.select('section[aria-label^="Pane 2:"] select','room:gainers');await p.waitForFunction(()=>document.querySelector('section[aria-label^="Pane 2:"]')?.textContent.includes('Welcome to gainers'));
 await p.reload();await p.waitForSelector('select');assert.equal(await p.$eval('section[aria-label^="Pane 2:"] select',e=>e.value),'room:gainers');
 assert.equal(await p.$$eval('section[aria-label^="Pane "]:not([hidden])',e=>e.length),4);
 assert.deepEqual(errors,[]);
 console.log('Six view browser checks passed: 3x2 grid, picker by mouse and keyboard, rooms/DMs/Gainers Table cards, server save and reload, browser fallback, revoked Gainers, narrow fallbacks, Quad unchanged.');
 }
}catch(e){console.error(e);process.exitCode=1;}finally{server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
