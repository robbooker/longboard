// #407 one theme for every view: Quad and Six reach the single chat's theme control (since #420 the
// Look section of Profile settings, opened from their toolbar), a change repaints
// every card heading and every card at once, Terminal keeps DMs (and everything around them) dark,
// and the choice is the same app-wide setting (this device's storage and the first-paint cookie).
// The actual React components with synthetic, in-memory API responses (the chat-six-browser harness);
// never connects to production services.
//
// Checks, on a computer (1920x1080) and a phone (390x844):
//  - Six opened in Terminal draws every card header, the toolbar and both DM cards dark in Terminal;
//    DM messages (yours and theirs) sit on dark blocks with light text, like a room;
//  - the theme control in Six switches Light and back to Terminal without leaving the view, and every
//    card header follows at once; the choice is saved (storage and cookie);
//  - Quad has the same control; a DM pane stays dark in Terminal; the choice made in Six is what Quad opens in;
//  - a colour combination (#420) reaches every card and pane too, and one of the four themes clears it;
//  - a reload (as after signing out and in on this device) keeps the theme.
//
// Usage: node scripts/tests/chat-multiview-theme-browser.mjs [--shots <dir>] [--root <checkout> --before]
//   --shots writes t407-six-desktop.png, t407-six-phone.png, t407-dm-desktop.png, t407-dm-phone.png,
//   t407-quad-menu-desktop.png and t407-quad-menu-phone.png (with --before: t407-before-*.png, no checks).
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer';
const args=process.argv.slice(2),arg=n=>args.includes(n)?args[args.indexOf(n)+1]:null,shots=arg('--shots'),before=args.includes('--before'),quadShotOnly=false;
// --root <checkout> bundles another checkout's components (used for before pictures; --before skips the checks).
const root=arg('--root')||new URL('../../',import.meta.url).pathname,dir=await mkdtemp(join(tmpdir(),'six-test-'));
const member={id:'11111111-1111-4111-8111-111111111111',display_name:'Alice',accepts_requests:true};
const conversations=['Bob','Carol'].map((name,i)=>({id:`22222222-2222-4222-8222-22222222222${i}`,otherId:`33333333-3333-4333-8333-33333333333${i}`,otherName:name,status:'accepted',incoming:false,blockedByMe:false,unavailable:false,unread:0,lastBody:'Hi',updatedAt:new Date().toISOString()}));
const roomState={isOpen:true,notice:null,pausedAt:null,updatedAt:new Date().toISOString()};
const rooms=['main','social','shortscout','gainers'];
let gainersTable=true,layoutStatus=200,saved=[{type:'room',source:'gainers'},{type:'room',source:'main'},{type:'dm',source:'22222222-2222-4222-8222-222222222220'},{type:'dm',source:'22222222-2222-4222-8222-222222222221'},{type:'gainers-table',source:''},{type:'room',source:'social'}];
const messages=Object.fromEntries(rooms.map(room=>[room,[{id:randomUUID(),room_slug:room,member_id:conversations[0].otherId,guest_id:null,author_label:'Bob',body:`Welcome to ${room}`,created_at:new Date(Date.now()-60000).toISOString(),unread_seq:1}]]));
const dms=Object.fromEntries(conversations.map(c=>[c.id,[
 {id:randomUUID(),seq:1,sender_id:c.otherId,body:`Hello from ${c.otherName}`,created_at:new Date(Date.now()-300000).toISOString()},
 {id:randomUUID(),seq:2,sender_id:member.id,body:'Thanks! I shorted some at 1.08',created_at:new Date(Date.now()-200000).toISOString()},
 {id:randomUUID(),seq:3,sender_id:c.otherId,body:'Nice. I should have made that more clear in the webinar!',created_at:new Date(Date.now()-100000).toISOString()},
]]));
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
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const shot=async(p,name)=>{if(shots)await p.screenshot({path:join(shots,(before?'t407-before-':'t407-')+name+'.png')});};
const TERMINAL={header:'rgb(26, 29, 36)',font:/JetBrains/};
// Relative luminance of a computed colour: dark surfaces stay well under 0.1.
const lum=`const lum=c=>{const [r,g,b]=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;};`;
const look=p=>p.evaluate(new Function(`${lum}
 const bg=e=>getComputedStyle(e).backgroundColor;
 const root=document.querySelector('[data-theme]');
 return {
  theme:root?.dataset.theme,
  headers:[...document.querySelectorAll('section[data-card] > header, section[aria-label^="Pane "] > header')].filter(e=>e.checkVisibility()).map(e=>({bg:bg(e),font:getComputedStyle(e.querySelector('h2,select')).fontFamily,lum:lum(bg(e))})),
  page:lum(bg(root)),
  dm:[...document.querySelectorAll('[data-theme] article')].filter(e=>e.checkVisibility()&&/Hello from|shorted some|more clear/.test(e.textContent)).map(e=>({bg:lum(bg(e)),text:lum(getComputedStyle(e).color)})),
  themes:[...document.querySelectorAll('[data-theme]')].filter(e=>!e.closest('[data-look]')).map(e=>e.dataset.theme),
 };`));
// #420: the themes live in Profile settings (its Look section), opened from the view's toolbar.
const openMenu=async p=>{await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.checkVisibility()&&b.textContent.trim()==='Profile settings').click());await p.waitForSelector('dialog[open] [role="group"][aria-label="Colour combination"] button',{visible:true});};
const pick=async(p,label)=>{await (await p.evaluateHandle(l=>[...document.querySelectorAll('dialog[open] [data-look]')].find(b=>b.textContent.trim()===l),label)).click();};
// Every themed surface shows this theme (and combination); the swatches in the Look section are previews.
const allAre=(p,theme,palette='')=>p.waitForFunction((theme,palette)=>{const e=[...document.querySelectorAll('[data-theme]')].filter(x=>!x.closest('[data-look]'));return e.length>1&&e.every(x=>x.dataset.theme===theme&&(x.dataset.palette??'')===palette);},{timeout:10000},theme,palette);
const dmShown=p=>p.waitForFunction(()=>[...document.querySelectorAll('[data-theme] article')].filter(e=>e.checkVisibility()&&/more clear/.test(e.textContent)).length>0,{timeout:20000});
function terminal(l,where){
 assert.ok(l.themes.every(t=>t==='terminal'),`${where}: every surface in Terminal (${l.themes})`);
 assert.ok(l.headers.length>0,`${where}: card headers`);
 for(const h of l.headers){assert.equal(h.bg,TERMINAL.header,`${where}: card header ${JSON.stringify(h)}`);assert.match(h.font,TERMINAL.font,`${where}: header font`);}
 assert.ok(l.page<0.02,`${where}: dark page`);
 assert.ok(l.dm.length>0,`${where}: DM messages on screen`);
 for(const m of l.dm){assert.ok(m.bg<0.05,`${where}: DM message background dark (${m.bg})`);assert.ok(m.text>0.6,`${where}: DM text light (${m.text})`);}
}
try{
 browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const ctx=await browser.createBrowserContext();
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('pageerror:',e.message);});
 await p.setViewport({width:1920,height:1080});
 await p.goto(base+'/chat/quad');await p.evaluate(()=>localStorage.setItem('longboard-public-chat-theme-v1','terminal'));
 // Six in Terminal: two rooms, two DMs, the Gainers Table and Social (Rob's layout).
 await p.goto(base+'/chat/six');await p.waitForSelector('section[data-card="6"]');await dmShown(p);await pause(700);
 await shot(p,'six-desktop');
 if(!before){
  terminal(await look(p),'Six');
  // Change the theme from inside Six: every heading follows at once, and back again.
  await openMenu(p);await pick(p,'Light');
  await allAre(p,'light');
  const light=await look(p);
  assert.ok(light.headers.every(h=>h.lum>0.8),`Light headers ${JSON.stringify(light.headers)}`);
  assert.equal(await p.evaluate(()=>localStorage.getItem('longboard-public-chat-theme-v1')),'light');
  assert.ok((await ctx.cookies(base+'/chat')).some(c=>c.name==='longboard-chat-theme'&&c.value==='light'),'the first-paint cookie follows');
  // #420: a colour combination reaches every card heading and card too, on the standard look...
  await pick(p,'Ocean');
  await allAre(p,'dark','ocean');
  const ocean=await look(p);
  assert.ok(ocean.headers.length>0&&new Set(ocean.headers.map(h=>h.bg)).size===1&&ocean.headers[0].bg!==TERMINAL.header,`Ocean headers ${JSON.stringify(ocean.headers)}`);
  assert.equal(await p.evaluate(()=>localStorage.getItem('longboard-chat-palette-v1')),'ocean');
  assert.ok((await ctx.cookies(base+'/chat')).some(c=>c.name==='longboard-chat-palette'&&c.value==='ocean'),'the first-paint cookie carries the combination');
  // ...and one of the four themes clears it.
  await pick(p,'Terminal');
  await allAre(p,'terminal');
  assert.equal(await p.evaluate(()=>localStorage.getItem('longboard-chat-palette-v1')),null);
  assert.ok(!(await ctx.cookies(base+'/chat')).some(c=>c.name==='longboard-chat-palette'),'no combination cookie under Terminal');
  assert.deepEqual(await p.$$eval('dialog[open] [data-look][aria-pressed="true"]',b=>b.map(x=>x.textContent.trim())),['Terminal']);
  await p.keyboard.press('Escape');await pause(300);
  terminal(await look(p),'Six after switching back');
 }
 // A Terminal DM up close: a DM card on its own.
 await p.evaluate(()=>document.querySelector('section[data-card="3"]')?.scrollIntoView());
 await p.setViewport({width:1280,height:860});await pause(400);
 await (await p.$('section[data-card="3"]')).screenshot({path:shots?join(shots,(before?'t407-before-':'t407-')+'dm-desktop.png'):join(dir,'x.png')});
 // Quad: the same control, opened; a DM pane stays dark.
 await p.setViewport({width:1440,height:1000});
 await p.goto(base+'/chat/quad');await p.waitForSelector('select');
 await p.select('section[aria-label^="Pane 3:"] select',`dm:${conversations[0].id}`);await dmShown(p);await pause(500);
 if(!before){
  terminal(await look(p),'Quad (the theme chosen in Six)');
  await openMenu(p);
  assert.deepEqual(await p.$$eval('dialog[open] [role="group"][aria-label="Chat theme"] button',bs=>bs.map(b=>b.textContent.trim())),['Dark','Light','Blade Runner','Terminal']);
  assert.equal(await p.$('[data-view-theme-menu]'),null,'the toolbar no longer carries its own theme menu (#420)');
  await pause(300);await shot(p,'quad-menu-desktop');
  await pick(p,'Blade Runner');
  await allAre(p,'blade-runner');
  await pick(p,'Terminal');await allAre(p,'terminal');
  await p.keyboard.press('Escape');
  // Back from another view or after signing out and in on this device: the saved theme comes back.
  await p.reload();await p.waitForSelector('select');await dmShown(p);await pause(300);
  terminal(await look(p),'Quad after a reload');
 }else{await shot(p,'quad-menu-desktop');}
 // A phone: one card at a time, the same control in the toolbar.
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await p.goto(base+'/chat/six');await p.waitForSelector('section[data-card="6"]');
 await p.click('nav[aria-label="Choose visible card"] button:nth-child(3)');await dmShown(p);await pause(500);
 await shot(p,'dm-phone');
 if(!before){
  terminal(await look(p),'Six on a phone');
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no sideways scroll');
  await openMenu(p);await pause(300);await shot(p,'six-phone');
  const box=await p.$eval('dialog[open]',e=>{const r=e.getBoundingClientRect(),b=[...e.querySelectorAll('[data-look]')].map(x=>x.getBoundingClientRect());return {l:r.left,r:r.right,inside:b.length>4&&b.every(x=>x.left>=r.left&&x.right<=r.right),wide:e.scrollWidth-e.clientWidth};});
  assert.ok(box.l>=0&&box.r<=390&&box.inside&&box.wide<=0,`the themes and colours fit a phone ${JSON.stringify(box)}`);
  await p.keyboard.press('Escape');
  await p.goto(base+'/chat/quad');await p.waitForSelector('select');await openMenu(p);await pause(300);await shot(p,'quad-menu-phone');
 }else{await shot(p,'six-phone');await p.goto(base+'/chat/quad');await p.waitForSelector('select');await pause(500);await shot(p,'quad-menu-phone');}
 if(!before)assert.deepEqual(errors,[]);
 console.log(before?'Before pictures saved.':'Multi-view theme checks passed: Terminal headers and DMs in Six and Quad, theme control in both views, saved and restored, phone and desktop.');
}catch(e){console.error(e);process.exitCode=1;}finally{server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
