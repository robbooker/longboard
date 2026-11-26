// #506 A Dual, Quad or Six view card that is just a room's live video (the webinar).
// The actual React components and transport with synthetic, in-memory API responses, as the other
// multi-view tests (chat-quad, chat-six, chat-dual). No real LiveKit is reached: the page's player
// connection is a stand-in (stageFeed.ts lets a test supply one outside a production build) that
// plays a drawn test picture, and the "stage" signal the page gets over Ably is sent as the window
// event useAblyRoomEvents turns it into. Never connects to production services.
//
// Alice can read LB, SS and Gainers, and not Social.
//  - Quad: each pane's picker offers "Live video only" for the rooms she can read and not for Social;
//    a pane set to LB's live video says LB isn't live, with no player, no token and no connection,
//    after one status read and no more (no timer); the other panes stay chats and still send;
//  - LB goes live: the player appears in that pane by itself, alone (no chat, no stock panel, no
//    admin card), with a LIVE label and the room's name, sound off until "Tap for sound", working
//    mute, and full screen; its picture is 16:9, as large as fits and centred inside the pane, at
//    the pane's own size, expanded, on a narrow window and on a phone;
//  - the choice survives a reload; the broadcast dropping or ending puts the pane back to "isn't
//    live" and closes the connection; a saved choice for a room she can't read is cleared;
//  - Six: the card picker has a "Live video" type listing the same rooms; the choice is saved on the
//    server and survives a reload; the card plays at 16:9 at its even width and widened;
//  - Dual: the same choice, playing, at the desktop size and on an open folding phone (where the
//    volume slider gives way and mute stays).
// CHAT_SHOT_DIR saves quad-video-card.png, card-not-live.png, picker.png, six-video-card-wide.png
// and dual-video-card.png.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer';
import {checkVideoCardLooks} from './stage-theme-checks.mjs';
const shots=process.env.CHAT_SHOT_DIR,scale=Number(process.env.CHAT_TIMING_SCALE||1);
const root=new URL('../../',import.meta.url).pathname,dir=await mkdtemp(join(tmpdir(),'video-card-test-'));
const member={id:'11111111-1111-4111-8111-111111111111',display_name:'Alice',accepts_requests:true};
const roomState={isOpen:true,notice:null,pausedAt:null,updatedAt:new Date().toISOString()};
// What Alice can read. Social exists and she is not in it.
const rooms=['main','shortscout','gainers'];
const messages=Object.fromEntries(rooms.map(room=>[room,[{id:randomUUID(),room_slug:room,member_id:'33333333-3333-4333-8333-333333333330',guest_id:null,author_label:'Bob',body:`Welcome to ${room}`,created_at:new Date(Date.now()-60000).toISOString(),unread_seq:1}]]));
const activity={mentions:[],dms:[],mentionCount:0,dmCount:0,mentionThrough:0,dmThrough:0,roomCounts:{},roomThrough:{},roomMessageCounts:{},roomMessageThrough:{}};
// The stand-in server's live video: each room's state, and what the page asked.
const stage={main:'off'},statusReads=[],tokens=[],writes=[];
let saved=null,savedWidths=null;
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import QuadChat from './components/chat/QuadChat';import SixChat from './components/chat/SixChat';const six=location.pathname==='/chat/six';const Shell=six?SixChat:QuadChat;createRoot(document.getElementById('root')).render(<Shell dual={location.pathname==='/chat/dual'} accountId="test-account" bootstrap={${JSON.stringify({accountId:'test-account',room:'main',member,roomState,messages:[],reactions:[],counts:{},featureChannel:false})}} allowedRooms={${JSON.stringify(rooms)}} serverSession={false} isAdmin room="main" popout fontVariableClass="" appVersion="test"/>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:join(dir,'bundle.js'),define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'test-platform',setup(b){
 b.onResolve({filter:/^(next\/(link|image|dynamic|navigation)|@\/lib\/supabase\/client)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'tsx',resolveDir:root,contents:a.path==='next/dynamic'?`import React from 'react';export default function dynamic(load){const C=React.lazy(load);return props=><React.Suspense fallback={null}><C {...props}/></React.Suspense>;}`:a.path==='next/navigation'?`export const useRouter=()=>({push:url=>location.href=url,refresh:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;`:a.path.includes('supabase')?`export function createClient(){const channel={on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},track:async()=>{},presenceState:()=>({})};return {channel:()=>channel,removeChannel:()=>{},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}`:`import React from 'react';export default function Component({children,unoptimized,fill,priority,scroll,...props}){return React.createElement(${a.path==='next/link'?"'a'":"'img'"},props,children);}`}));
}}]});
function read(path){const u=new URL(path,'http://localhost');const room=u.searchParams.get('room')||'main';
 // stageVideo: live video is set up on this (stand-in) server, as lib/chatCardOptions.server.ts says it.
 if(u.pathname==='/api/chat/quad-options')return {accountId:'test-account',rooms,conversations:[],gainersTable:false,apps:[],stageVideo:true};
 if(u.pathname==='/api/chat/history')return {messages:messages[room]||[],reactions:[],hasMore:false};
 if(u.pathname==='/api/chat/thread-counts')return {counts:{}};
 if(u.pathname==='/api/chat/opening')return {messageId:null,readThrough:0};
 if(u.pathname==='/api/chat/inbox')return {conversations:[]};
 if(u.pathname==='/api/chat/activity')return activity;
 if(u.pathname==='/api/chat')return roomState;
 if(u.pathname==='/api/chat/app-version')return {version:'test'};
 if(u.pathname==='/api/chat/pins')return {pins:[]};
 return {};
}
// The server's checks, as the real routes do them for this member (unit-tested in chatStageRoutes and chatCards).
const allowed=c=>c===null||((c.type==='room'||c.type==='video')&&rooms.includes(c.source));
const server=createServer(async(req,res)=>{
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(/^\/chat\/(quad|six|dual)/.test(req.url)){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script>');}
 if(['/bundle.js','/bundle.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');return res.end(await readFile(join(dir,req.url.slice(1))));}
 if(req.url==='/chat-sw.js'){res.setHeader('Content-Type','text/javascript');return res.end('');}
 if(req.url.startsWith('/api/chat/stage/status')){const room=new URL(req.url,'http://localhost').searchParams.get('room');statusReads.push(room);
  return rooms.includes(room)?send({state:stage[room]??'off',video:true}):send({error:'room_forbidden'},403);}
 if(req.url.startsWith('/api/chat/card-layout')){
  if(req.method==='GET')return send({layout:saved?saved.map(c=>allowed(c)?c:null):null,saved:!!saved,widths:savedWidths});
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');writes.push({path:'/api/chat/card-layout',body});
  saved=body.layout.map(c=>allowed(c)?c:null);if('widths' in body)savedWidths=body.widths;return send({layout:saved,saved:true});
 }
 if(req.method!=='POST')return send(read(req.url));
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
 if(req.url==='/api/chat/updates')return send({results:body.paths.map(path=>({path,status:200,data:read(path)}))});
 if(req.url==='/api/chat/message-reactions')return send({messages:{}});
 if(req.url==='/api/chat/stage/token'){const live=rooms.includes(body.room)&&stage[body.room]==='live';tokens.push({room:body.room,live});
  return live?send({url:'ws://127.0.0.1:1/never-reached',token:'fake-viewer-token',state:'live'}):send({error:'not_live',state:stage[body.room]??'off'},409);}
 writes.push({path:req.url,body});
 if(req.url==='/api/chat'&&body.body){const message={id:randomUUID(),room_slug:body.room,member_id:member.id,guest_id:member.id,author_label:'Alice',body:body.body,created_at:new Date().toISOString(),client_id:body.clientId};messages[body.room].push(message);return send({message});}
 return send({});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;

// The page's stand-in for the LiveKit connection (see components/chat/stage/stageFeed.ts).
const fakeFeed=()=>{
 const feed=window.__stageFeed={connects:[],closed:0,open:0,audioStarted:0,volume:null};
 window.__chatStageFeedForTests=async({url,token,video,events})=>{
  feed.connects.push({url,token});feed.open++;
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');let tick=0;
  const draw=()=>{tick++;const g=ctx.createLinearGradient(0,0,1280,720);g.addColorStop(0,'#16324f');g.addColorStop(1,'#3b1f4a');ctx.fillStyle=g;ctx.fillRect(0,0,1280,720);
   ctx.fillStyle='rgba(255,255,255,.14)';ctx.fillRect((tick*9)%1280,0,90,720);ctx.strokeStyle='#fff';ctx.lineWidth=6;ctx.strokeRect(3,3,1274,714);
   ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='700 64px sans-serif';ctx.fillText('TEST VIDEO',640,340);
   ctx.font='400 30px sans-serif';ctx.fillText('A drawn picture standing in for the webinar',640,400);};
  draw();const drawing=setInterval(draw,100);
  events.connection('connected');events.audioBlocked(false);events.viewers(2);
  video.srcObject=canvas.captureStream(10);void video.play().catch(()=>{});events.video(true);
  return {startAudio:async()=>{feed.audioStarted++;},setVolume:v=>{feed.volume=v;},close:()=>{feed.closed++;feed.open--;clearInterval(drawing);}};
 };
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const T={timeout:30000*scale};
let browser;
try{
 browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('pageerror:',e.message);});
 await p.evaluateOnNewDocument(fakeFeed);
 const shot=async name=>{if(shots){await sleep(400);await p.screenshot({path:`${shots}/${name}.png`});}};
 const feed=()=>p.evaluate(()=>({...window.__stageFeed,connects:window.__stageFeed.connects.length}));
 // What useAblyRoomEvents does when the room's "stage" signal arrives on the page's Ably connection.
 const signal=room=>p.evaluate(r=>window.dispatchEvent(new CustomEvent('chat-stage-event',{detail:{room:r}})),room);
 const setStage=async(room,state)=>{stage[room]=state;await signal(room);};
 const off='[data-card-live-video="main"] [data-card-live-video-off]',playing='[data-card-live-video="main"] [data-stage-video-fill][data-stage-video-state="live"]';
 const noSideScroll=async()=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no sideways scroll');
 // The player inside a card: its picture is 16:9, as large as fits above the control bar, centred,
 // never outside the card; the picture itself is contained (never cropped or stretched).
 const fits=async(card,where)=>{
  await p.waitForSelector(`${card} ${playing}`,{visible:true,...T});await sleep(250);
  const m=await p.evaluate(sel=>{const r=e=>{const b=e.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height,right:b.right,bottom:b.bottom};};
   const box=document.querySelector(sel+' [data-card-live-video]'),player=box.querySelector('[data-stage-video-fill]'),video=player.querySelector('[data-stage-video-feed]');
   return {body:r(box.parentElement),box:r(box),player:r(player),area:r(player.querySelector('[data-stage-video-area]')),controls:r(player.lastElementChild),label:r(player.firstElementChild),
    video:{...r(video),fit:getComputedStyle(video).objectFit,hidden:video.hidden,picture:[video.videoWidth,video.videoHeight]}};},card);
  const at=`${where}: ${JSON.stringify(m)}`,near=(a,b,by=1)=>Math.abs(a-b)<=by;
  assert(near(m.box.w,m.body.w)&&near(m.box.h,m.body.h)&&near(m.player.w,m.box.w)&&near(m.player.h,m.box.h),`the player covers the card's body: ${at}`);
  assert(near(m.area.w,m.area.h*16/9,2),`the picture's box is 16:9: ${at}`);
  assert(m.area.x>=m.box.x-0.5&&m.area.right<=m.box.right+0.5&&m.area.y>=m.box.y-0.5&&m.controls.bottom<=m.box.bottom+0.5,`the picture and its controls are inside the card: ${at}`);
  assert(near(m.controls.y,m.area.bottom)&&near(m.controls.w,m.area.w)&&near(m.controls.x,m.area.x),`the controls sit under the picture, the same width: ${at}`);
  assert(near(m.area.w,m.box.w)||near(m.area.h+m.controls.h,m.box.h),`the picture is as large as fits: ${at}`);
  assert(near(m.area.x-m.box.x,m.box.right-m.area.right)&&near(m.area.y-m.box.y,m.box.bottom-m.controls.bottom),`and centred: ${at}`);
  assert.equal(m.video.fit,'contain');assert.equal(m.video.hidden,false);assert.deepEqual(m.video.picture,[1280,720]);
  assert(near(m.video.w,m.area.w)&&near(m.video.h,m.area.h),`the video fills its 16:9 box: ${at}`);
  assert(m.label.x>=m.area.x&&m.label.right<=m.area.right&&m.label.y>=m.area.y&&m.label.bottom<=m.area.bottom,`the label is on the picture: ${at}`);
  return m;};
 // Only the video: none of the room's chat or the stage's other panels.
 const onlyVideo=async card=>{
  const found=await p.evaluate(sel=>{const c=document.querySelector(sel+' [data-card-live-video]');return ['textarea','[role="log"]','article','[data-stage-root]','[data-stage-broadcast]','[data-stage-column]','[data-stage-overlay-card]','[data-stage-host-sample]','[data-stage-start]'].filter(s=>c.querySelector(s));},card);
  assert.deepEqual(found,[],'the card holds only the video');};

 // ---- Quad ----
 const pane=i=>`section[aria-label^="Pane ${i+1}:"]`;
 await p.setViewport({width:1440,height:1000});await p.goto(base+'/chat/quad');await p.waitForSelector('select');
 await p.waitForFunction(()=>document.body.textContent.includes('Welcome to main'),T);
 const offered=await p.$eval(`${pane(1)} select`,s=>[...s.querySelectorAll('optgroup[label="Live video only"] option')].map(o=>[o.value,o.textContent.trim()]));
 assert.deepEqual(offered,[['video:main','LB live video'],['video:shortscout','SS live video'],['video:gainers','Gainers live video']],'live video is offered for the rooms she can read, and no other');
 assert.equal(await p.$('option[value="video:social"]'),null,'a room she cannot read is not offered');
 assert.deepEqual(statusReads,[],'a page with no video card asks nothing about live video');
 await p.select(`${pane(1)} select`,'video:main');
 await p.waitForSelector(`${pane(1)} ${off}`,{visible:true,...T});
 await p.waitForFunction(s=>/LB isn.t live right now/.test(document.querySelector(s)?.textContent??''),T,`${pane(1)} ${off}`);
 assert.equal(await p.$eval(`${pane(1)}`,e=>e.getAttribute('aria-label')),'Pane 2: LB live video');
 assert.equal(await p.$(`${pane(1)} [data-stage-video]`),null,'no player while the room is not live');
 await onlyVideo(pane(1));
 assert.equal(await p.$(`${pane(1)} button[aria-label="Skip to latest"]`),null,'no chat buttons in the video pane\'s header');
 await sleep(6500);
 assert.deepEqual(statusReads,['main'],'one status read for the card\'s room, and no timer after it');
 assert.deepEqual(tokens,[],'no viewer token is asked for while the room is not live');
 assert.deepEqual(await feed(),{connects:0,closed:0,open:0,audioStarted:0,volume:null},'no video connection while the room is not live');
 await noSideScroll();await shot('card-not-live');
 // #510: the waiting card in every theme and colour combination: the theme's own panel and text.
 await checkVideoCardLooks(p,`${pane(1)} [data-card-live-video]`,{live:false,each:async look=>{if(look.id==='light')await shot('card-not-live-light');}});
 assert.deepEqual(statusReads,['main'],'a theme change reads no status');
 console.log('PASS Quad: live video is offered for readable rooms only; not live = one status read, no player, no connection');

 // The broadcast begins: the player appears by itself.
 await setStage('main','live');
 let m=await fits(pane(1),'Quad pane');
 assert((await feed()).connects===1&&(await feed()).open===1,'one connection');
 assert.deepEqual(tokens,[{room:'main',live:true}],'one viewer token, for LB');
 await onlyVideo(pane(1));
 const label=await p.$eval(`${pane(1)} [data-stage-video-fill]`,e=>e.firstElementChild.innerText.replace(/\s+/g,' ').trim());
 assert.match(label,/^LIVE VIDEO # LB$/,'a small LIVE label with the room\'s name');
 // Sound: off until tapped, then mute and unmute work.
 assert.equal((await feed()).volume,0,'it starts with the sound off');
 assert.match(await p.$eval(`${pane(1)} [data-stage-sound]`,e=>e.textContent),/Tap for sound/);
 await shot('quad-video-card');
 // #510: playing, the card is all video: dark in every theme, with one connection throughout.
 await checkVideoCardLooks(p,`${pane(1)} [data-card-live-video]`,{live:true,each:async look=>{if(look.id==='light')await shot('quad-video-card-light');}});
 assert((await feed()).connects===1&&(await feed()).open===1,'still the one connection after every theme change');
 await p.click(`${pane(1)} [data-stage-sound]`);
 await p.waitForFunction(()=>window.__stageFeed.volume===1&&window.__stageFeed.audioStarted===1,T);
 assert.equal(await p.$(`${pane(1)} [data-stage-sound]`),null,'the prompt goes once sound is on');
 await p.click(`${pane(1)} button[aria-label="Mute"]`);await p.waitForFunction(()=>window.__stageFeed.volume===0,T);
 assert.equal(await p.$(`${pane(1)} [data-stage-sound]`),null,'muting by choice does not bring the prompt back');
 await p.click(`${pane(1)} button[aria-label="Unmute"]`);await p.waitForFunction(()=>window.__stageFeed.volume===1,T);
 assert(await p.$eval(`${pane(1)} input[aria-label="Volume"]`,e=>e.checkVisibility()&&!e.disabled),'a volume slider');
 assert(await p.$eval(`${pane(1)} button[aria-label="Full screen"]`,e=>!e.disabled),'a full screen button');
 assert.equal(!!(await p.$(`${pane(1)} button[aria-label="Picture in picture"]`)),await p.evaluate(()=>!!document.pictureInPictureEnabled),'picture in picture where the browser has it');
 await p.click(`${pane(1)} button[aria-label="Full screen"]`);
 await p.waitForFunction(()=>document.fullscreenElement?.matches('[data-stage-video-area]'),T);
 await p.evaluate(()=>document.exitFullscreen());await p.waitForFunction(()=>!document.fullscreenElement,T);
 // The other panes are still chats.
 await p.type(`${pane(0)} textarea`,'Chat beside the video');await p.$eval(`${pane(0)} textarea`,e=>e.form.requestSubmit());
 await p.waitForFunction(()=>[...document.querySelectorAll('article')].some(e=>e.textContent.includes('Chat beside the video')),T);
 assert.deepEqual(writes.filter(w=>w.path==='/api/chat').map(w=>w.body.room),['main']);
 assert(await p.$eval(pane(2),e=>e.textContent.includes('Welcome to gainers')),'another pane is still a chat');
 // Wide (the pane expanded) and narrow (a small window, then a phone showing one pane).
 await p.click(`${pane(1)} button[aria-label="Expand pane 2"]`);
 const wide=await fits(pane(1),'Quad pane expanded');assert(wide.box.w>1300&&wide.area.w>m.area.w,'expanded, the picture is bigger');
 await p.click(`${pane(1)} button[aria-label="Restore four panes"]`);
 await p.setViewport({width:800,height:900});
 const narrow=await fits(pane(1),'Quad pane on an 800px window');assert(narrow.box.w<420,'a narrow pane');await noSideScroll();
 assert((await feed()).connects===1,'resizing never reconnects');
 // (Switching to a phone reloads the page in this browser, so the phone starts afresh.)
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await p.waitForSelector('nav[aria-label="Choose visible conversation"] button:nth-child(2)',{visible:true,...T});
 await p.click('nav[aria-label="Choose visible conversation"] button:nth-child(2)');
 await fits(pane(1),'Quad on a phone');await noSideScroll();
 await p.setViewport({width:1440,height:1000});await p.waitForSelector('select');await fits(pane(1),'Quad pane, back on a computer');
 console.log('PASS Quad: live = the player alone in its pane, 16:9 and centred at every size, sound after a tap, other panes still chat');

 // The choice survives a reload (and plays again, the room being live).
 await p.reload();await p.waitForSelector('select');
 assert.equal(await p.$eval(`${pane(1)} select`,e=>e.value),'video:main','the choice is remembered');
 m=await fits(pane(1),'Quad pane after a reload');
 assert.equal((await feed()).volume,0,'a new page starts with the sound off again');
 // The broadcast drops: back to "isn't live", connection closed. It returns: the player is back.
 await setStage('main','waiting');
 await p.waitForSelector(`${pane(1)} ${off}`,{visible:true,...T});
 assert.equal(await p.$(`${pane(1)} [data-stage-video]`),null);
 assert.deepEqual(await feed().then(f=>[f.connects,f.open,f.closed]),[1,0,1],'the connection is closed when the broadcast stops');
 await setStage('main','live');await fits(pane(1),'Quad pane, broadcast back');
 // The admin ends it.
 await setStage('main','off');
 await p.waitForSelector(`${pane(1)} ${off}`,{visible:true,...T});
 await p.waitForFunction(s=>/LB isn.t live right now/.test(document.querySelector(s)?.textContent??''),T,`${pane(1)} ${off}`);
 assert.deepEqual(await feed().then(f=>[f.connects,f.open,f.closed]),[2,0,2],'the connection is closed when the broadcast ends');
 assert.equal(await p.$(`${pane(1)} [data-stage-video]`),null);
 // A saved choice for a room she can't read is cleared, not shown.
 await p.evaluate(()=>localStorage.setItem('rb-chat-quad-v1:test-account',JSON.stringify(['room:main','video:main','video:social','room:gainers'])));
 await p.reload();await p.waitForSelector('select');await p.waitForSelector(`${pane(1)} ${off}`,{visible:true,...T});
 assert.deepEqual(await p.$$eval('section[aria-label^="Pane "] select',s=>s.map(e=>e.value)),['room:main','video:main','','room:gainers']);
 assert.equal(await p.$('[data-card-live-video="social"]'),null);assert(!statusReads.includes('social'),'nothing is asked about a room she cannot read');
 console.log('PASS Quad: remembered across a reload; dropped or ended = not live again and the connection closed; an unreadable room is never shown');

 // ---- Six ----
 const card=i=>`section[data-card="${i}"]`;
 saved=[{type:'room',source:'main'},null,{type:'room',source:'shortscout'},null,null,null];
 await p.setViewport({width:1920,height:1080});await p.goto(base+'/chat/six');await p.waitForSelector(card(6));await p.waitForFunction(()=>!document.body.textContent.includes('Loading your cards'),T);
 await p.click(`${card(2)} button[aria-label="Choose card 2"]`);await p.waitForSelector(`${card(2)} [data-card-picker]`);
 assert(await p.$eval(`${card(2)} [data-card-picker]`,e=>/Live video/.test(e.textContent)),'the picker has a Live video type');
 await p.click(`${card(2)} [data-card-picker] input[value="video"]`);
 assert.deepEqual(await p.$$eval(`${card(2)} [data-card-picker] select option`,o=>o.map(e=>[e.value,e.textContent.trim(),e.disabled])),[['main','LB live video',false],['shortscout','SS live video',false],['gainers','Gainers live video',false]],'the rooms she can read; LB\'s video is free though LB\'s chat is on card 1');
 await shot('picker');
 await p.click(`${card(2)} [data-card-picker] button[type=submit]`);await p.waitForSelector(`${card(2)} [data-card-picker]`,{hidden:true});
 await p.waitForSelector(`${card(2)} ${off}`,{visible:true,...T});
 assert.equal(await p.$eval(`${card(2)} h2`,e=>e.textContent),'Card 2: LB live video');
 assert.deepEqual(writes.at(-1).body.layout[1],{type:'video',source:'main'},'the choice is saved on the server');
 assert.equal((await feed()).connects,0);
 await setStage('main','live');
 const even=await fits(card(2),'Six card, even width');await onlyVideo(card(2));
 assert(await p.$(`${card(1)} textarea`),'the card beside it is still LB\'s chat');
 // Widened (the widths as dragging the card's edges saves them) and after a reload.
 savedWidths=[0.2,0.6,0.2,1/3,1/3,1/3];
 await p.reload();await p.waitForSelector(card(6));
 const widened=await fits(card(2),'Six card, widened');
 assert(widened.box.w>even.box.w*1.5&&widened.area.w>even.area.w,`widened, the picture is bigger: ${even.area.w} -> ${widened.area.w}`);
 assert.equal(await p.$eval(card(2),e=>e.dataset.cardType),'video','the choice survives a reload');
 await noSideScroll();await shot('six-video-card-wide');
 await setStage('main','off');await p.waitForSelector(`${card(2)} ${off}`,{visible:true,...T});
 assert.equal((await feed()).open,0,'ended: the connection is closed');
 console.log('PASS Six: a Live video card type for readable rooms, saved on the server, 16:9 at its even width and widened');

 // ---- Dual ----
 stage.main='live';
 await p.setViewport({width:1440,height:900});await p.goto(base+'/chat/dual');await p.waitForSelector('select');
 assert.equal(await p.$(`${pane(1)} option[value="video:social"]`),null);
 await p.select(`${pane(1)} select`,'video:main');
 await fits(pane(1),'Dual pane');await onlyVideo(pane(1));
 assert(await p.$(`${pane(0)} textarea`),'the other pane is a chat');
 await noSideScroll();await shot('dual-video-card');
 // An open folding phone: two narrow panes; the volume slider gives way, mute and full screen stay.
 await p.setViewport({width:690,height:830,isMobile:true,hasTouch:true});await p.waitForSelector('select');
 const fold=await fits(pane(1),'Dual on an open folding phone');assert(fold.box.w<360);
 assert.equal(await p.$eval(`${pane(1)} input[aria-label="Volume"]`,e=>e.checkVisibility()),false,'no volume slider in a narrow card');
 assert(await p.$eval(`${pane(1)} [data-stage-video-fill] button[aria-pressed][aria-label$="ute"]`,e=>e.checkVisibility()),'mute stays');
 assert(await p.$eval(`${pane(1)} button[aria-label="Full screen"]`,e=>e.checkVisibility()),'full screen stays');
 await noSideScroll();
 await p.setViewport({width:1440,height:900});await p.reload();await p.waitForSelector('select');
 assert.equal(await p.$eval(`${pane(1)} select`,e=>e.value),'video:main','Dual remembers it too');
 await setStage('main','off');await p.waitForSelector(`${pane(1)} ${off}`,{visible:true,...T});
 assert.equal((await feed()).open,0);
 console.log('PASS Dual: the same card, playing at 16:9 on a computer and an open folding phone, and remembered');
 assert.deepEqual(errors,[]);console.log('chat-video-card-browser: all checks passed');
}catch(e){console.error(e);process.exitCode=1;}finally{server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
