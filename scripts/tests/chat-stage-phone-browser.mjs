// #509 Stage mode on a phone: the viewing room (localhost:3509, database 127.0.0.1:54509).
// No real LiveKit is reached and no real key exists here: the server's LiveKit calls go to this
// test's own stand-in on 127.0.0.1:54643 (the manifest's `livekitPhone` preset), and in the page
// the player's connection is a stand-in too (stageFeed.ts lets a test supply one outside a
// production build): a drawn test picture. Synthetic members and messages only.
// Alice is a chat admin, Bob a member. Bob's phone is 390x844 (upright) and 844x390 (on its side).
//  - not live: Bob's phone has no LIVE button, /chat?room=main&stage=1 is just the room, and no
//    viewing-room or LiveKit code is downloaded; one status request per room opening;
//  - live: the room header shows the LIVE pill and the room's message has a real "Watch live"
//    button (no "Watch on a computer" wording); still nothing downloaded until one is tapped;
//  - the viewing room: only the video (contained, playsInline, silent until "Tap for sound") and
//    its controls; none of the computer stage's panels; the controls fade and return on a tap;
//  - a message that arrives while the chat is closed puts a count on the Chat button;
//  - Chat: the room's real chat under the docked video (no overlap), the same <video> still
//    playing on the same connection; a real message is sent; the typing line does not cover the
//    newest message; with the keyboard up the video stays on screen and the composer is visible;
//    a reply thread opens inside the panel; Close gives the screen back to the video;
//  - on its side: the same video and connection (no restart); the chat is a see-through panel over
//    the right half with its composer on screen; closed, the video has the whole screen;
//  - back (the button, and the phone's own back) returns to the room; the message button and the
//    stage link open the viewing room; a failed connection says so and "Try again" works;
//  - #511's rule: the broadcast stops without End: after the grace the connection is closed and it
//    says the broadcast has ended; nothing connects while only waiting; live again, it reconnects;
//  - ended: "The broadcast has ended" with a button back to the room, and the LIVE pill goes;
//  - set up but not broadcasting: an admin's phone waits for it with no connection (#512) and connects
//    when it is live; a member's is just the room;
//  - a computer still gets the computer's stage.
// CHAT_SHOT_DIR saves phone-room-live.png, phone-video.png, phone-chat-open.png, phone-keyboard.png,
// phone-thread.png, phone-landscape-chat.png, phone-landscape-video.png, phone-ended.png.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {AccessToken} from 'livekit-server-sdk';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3509',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54509',STUB='http://127.0.0.1:54643';
for(const url of [base,fixture,STUB])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,scale=Number(process.env.CHAT_TIMING_SCALE||1);
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(check,what,ms=30000)=>{for(let waited=0;;waited+=200){const value=await check();if(value)return value;assert(waited<ms*scale,`timed out: ${what}`);await sleep(200);}};

// The stand-in LiveKit: Twirp over JSON, as livekit-server-sdk speaks it. One ingress per room.
const lk={ingresses:new Map(),publishing:false,startedAt:Date.now()-60000};
const info=(room,i)=>({ingress_id:i.id,name:room,stream_key:'FAKE-STREAM-KEY-for-tests-only',url:'rtmps://fake-livekit.example.test/x',input_type:'RTMP_INPUT',room_name:room,participant_identity:'stage-broadcast',reusable:true,state:{status:lk.publishing?'ENDPOINT_PUBLISHING':'ENDPOINT_INACTIVE',room_id:'RM_fake',...(lk.publishing?{started_at:String(BigInt(lk.startedAt)*1000000n)}:{})}});
const WEBHOOK_KEY='APIsyntheticNeverReal',WEBHOOK_SECRET='synthetic-livekit-secret-never-a-production-secret';
let webhookNumber=0;
const webhook=async(event,identity)=>{const body=JSON.stringify({event,id:`EV_phone_${++webhookNumber}`,room:{name:'chat-main'},...(identity?{participant:{identity}}:{})}),signer=new AccessToken(WEBHOOK_KEY,WEBHOOK_SECRET);
 signer.sha256=createHash('sha256').update(body).digest('base64');
 const r=await fetch(base+'/api/chat/stage/livekit-webhook',{method:'POST',headers:{'content-type':'application/webhook+json',authorization:await signer.toJwt()},body});assert.equal(r.status,200,`webhook ${event}`);};
const stub=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'):{};
 const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify(value));};
 if(req.url==='/test/state')return send({started:lk.ingresses.size>0,publishing:lk.ingresses.size>0&&lk.publishing});
 const call=req.url.replace('/twirp/livekit.',''),room=body.room_name??body.roomName??body.room;
 if(call==='Ingress/ListIngress')return send({items:[...lk.ingresses].filter(([name])=>!room||name===room).map(([name,i])=>info(name,i))});
 if(call==='RoomService/DeleteRoom')return send({});
 return send({code:'unimplemented',msg:call},501);
});
await new Promise(r=>stub.listen(54643,'127.0.0.1',r));
const goLive=async()=>{lk.ingresses.set('chat-main',{id:`IN_fake${Date.now()}`});lk.publishing=true;lk.startedAt=Date.now()-3000;await Promise.all([webhook('ingress_started'),webhook('track_published','stage-broadcast')]);};

// The page's stand-in for the LiveKit connection (see components/chat/stage/stageFeed.ts).
const fakeFeed=stubUrl=>{
 window.__stageFeed={connects:[],closed:0};
 window.__chatStageFeedForTests=async({url,token,video,events})=>{
  window.__stageFeed.connects.push({url,token});
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');let tick=0;
  const draw=()=>{tick++;const g=ctx.createLinearGradient(0,0,1280,720);g.addColorStop(0,'#16324f');g.addColorStop(1,'#3b1f4a');ctx.fillStyle=g;ctx.fillRect(0,0,1280,720);
   ctx.fillStyle='rgba(255,255,255,.14)';ctx.fillRect((tick*9)%1280,0,90,720);ctx.strokeStyle='#fff';ctx.lineWidth=6;ctx.strokeRect(3,3,1274,714);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='700 64px sans-serif';ctx.fillText('TEST VIDEO',640,340);
   ctx.font='400 30px sans-serif';ctx.fillText('A drawn picture standing in for the broadcast',640,400);};
  draw();const drawing=setInterval(draw,100),stream=canvas.captureStream(10);
  let on=false,closed=false;
  events.connection('connected');events.audioBlocked(true);events.viewers(3);
  const poll=setInterval(async()=>{
   const state=await fetch(stubUrl+'/test/state').then(r=>r.json()).catch(()=>null);if(closed||!state)return;
   if(!state.started){events.video(false);events.connection('ended');clearInterval(poll);return;}
   if(state.publishing&&!on){on=true;video.srcObject=stream;void video.play().catch(()=>{});events.video(true);}
   else if(!state.publishing&&on){on=false;video.srcObject=null;events.video(false);}
  },250);
  return {startAudio:async()=>{window.__stageFeed.audioStarted=true;},setVolume:v=>{window.__stageFeed.volume=v;},close:()=>{closed=true;window.__stageFeed.closed++;clearInterval(poll);clearInterval(drawing);}};
 };
};

await sql("update profiles set role='admin' where email='alice@example.test'");
await sql("update profiles set role='user' where email='bob@example.test'");
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const LB='textarea[aria-label="Message LB"]',ROOT='[data-stage-root][data-stage-phone]',CHAT='[data-stage-root] ~ section';
const UPRIGHT={width:390,height:844,isMobile:true,hasTouch:true},SIDEWAYS={width:844,height:390,isMobile:true,hasTouch:true,isLandscape:true};
// On screen for real: laid out, not visibility:hidden.
const seen=(page,selector)=>page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility({visibilityProperty:true})),selector);
const shown=(page,selector)=>page.evaluateHandle(s=>[...document.querySelectorAll(s)].find(e=>e.checkVisibility({visibilityProperty:true}))??null,selector);
const tap=async(page,selector)=>{const el=await shown(page,selector);assert(el.asElement(),`nothing on screen for ${selector}`);await el.asElement().tap();};
const box=(page,selector)=>page.evaluate(s=>{const e=[...document.querySelectorAll(s)].find(x=>x.checkVisibility({visibilityProperty:true}));if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),right:Math.round(r.right),bottom:Math.round(r.bottom)};},selector);
// The controls fade while the video plays: a tap on the picture brings them back.
const wake=async page=>{if(await page.$eval(ROOT,e=>e.dataset.stageChrome)==='hidden'){const v=page.viewport();await page.touchscreen.tap(v.width/2,v.height/2);await page.waitForFunction(r=>document.querySelector(r).dataset.stageChrome==='shown',{},ROOT);await sleep(250);}};
const view=page=>page.$eval(ROOT,e=>e.dataset.stageVideoState);
const waitView=(page,state)=>page.waitForFunction((r,s)=>document.querySelector(r)?.dataset.stageVideoState===s,{timeout:40000*scale},ROOT,state);
const playing=page=>page.waitForFunction(()=>{const v=document.querySelector('[data-stage-video-feed]');return v&&!v.hidden&&v.videoWidth===1280&&!v.paused;},{timeout:30000*scale});
const downloaded=page=>page.evaluate(()=>performance.getEntriesByType('resource').some(e=>/StagePhone|StageMode|livekit/i.test(e.name)));
const saved=(page,text)=>page.evaluate(async t=>{const r=await fetch('/api/chat/history?room=main',{cache:'no-store'});const body=await r.json();return (body.messages??[]).some(m=>m.body===t);},text);
// The composer is typed into only once it really has the focus (a page still settling can take it back).
const typeAndSend=async(page,text)=>{const field=await shown(page,LB);
 for(let i=0;;i++){await field.asElement().click();await sleep(150);if(await field.asElement().evaluate(e=>document.activeElement===e))break;assert(i<20,'the composer never took the focus');}
 await page.keyboard.type(text);await page.keyboard.press('Enter');
 await page.waitForFunction(t=>[...document.querySelectorAll('article[id^="chat-message-"]:not([data-pending])')].some(a=>a.textContent.includes(t)),{timeout:30000*scale},text);};
const newPage=async viewport=>{const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],stageAnswers=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',async r=>{if(!r.url().includes('/api/chat/stage/'))return;stageAnswers.push(`${r.status()} ${r.url().replace(base,'')} ${await r.text().catch(()=>'')}`);});
 await page.setViewport(viewport);await page.evaluateOnNewDocument(fakeFeed,STUB);
 // The dev server's own corner badge sits where the phone's sound button is: it is not part of the app.
 await page.evaluateOnNewDocument(()=>{document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='nextjs-portal{display:none!important}';document.head.append(style);});});return {context,page,errors,stageAnswers};};
// Opens the room afresh and waits for its one status answer.
const openRoom=async(who,path='/chat?room=main')=>{
 const page=who.page;await page.goto('about:blank');await sleep(100);who.stageAnswers.length=0;
 await page.goto(base+path);
 for(let waited=0;;waited+=100){const answer=who.stageAnswers.find(x=>/^200 \/api\/chat\/stage\/status\?room=main \{/.test(x));
  if(answer){await sleep(400);return JSON.parse(answer.slice(answer.indexOf('{'))).state;}
  assert(waited<90000*scale,`no status answer: ${who.stageAnswers.join(' | ')}`);await sleep(100);}};
const shot=async(page,name)=>{if(shots)await page.screenshot({path:`${shots}/${name}.png`});};
try{
 const bob=await newPage(UPRIGHT),alice=await newPage({width:1440,height:900});
 const b=bob.page,a=alice.page;
 await signIn(a,base,'alice@example.test',{composer:LB,next:'/chat?room=main'});
 assert.equal(await a.$('[data-stage-root]'),null,'an admin\'s room does not open the stage by itself');
 // (Spaced out: the room allows only so many messages in a row.)
 for(const text of ['Morning all.','Futures are up.','Coffee first.']){await typeAndSend(a,text);await sleep(1500);}
 await signIn(b,base,'bob@example.test',{composer:LB,next:'/chat?room=main'});

 // Not live: nothing at all on a member's phone.
 assert.equal(await openRoom(bob),'off');
 await b.waitForSelector(LB,{visible:true,timeout:60000*scale});
 assert.equal(await b.$('[data-stage-watch-live]'),null,'no LIVE pill while nothing is live');
 assert.equal(await openRoom(bob,'/chat?room=main&stage=1'),'off');
 await sleep(800);
 assert.equal(await b.$('[data-stage-root]'),null,'the stage link is just the room while it is not live');
 assert(await seen(b,LB));
 assert(!(await downloaded(b)),'no viewing-room or LiveKit code is downloaded');
 await sleep(1500);
 assert.equal(bob.stageAnswers.filter(x=>x.includes('/status')).length,1,`one status request for a room opening: ${bob.stageAnswers.join('\n')}`);
 console.log('PASS not live: a phone sees no change, downloads nothing and asks the status once');

 // Live: the pill in the header and a real button in the room's message.
 await goLive();
 await until(async()=>(await sql("select 1 from longboard_chat_messages where room_slug='main' and bot_slug='longboard' and body like '%is live now%'")).length,'the live message');
 await sleep(1700); // the server's few seconds' memory of the status
 assert.equal(await openRoom(bob),'live');
 await b.waitForSelector('[data-stage-watch-live]',{visible:true,timeout:30000*scale});
 assert.match(await b.$eval('[data-stage-watch-live]',e=>e.textContent),/LIVE · Watch/);
 {const pill=await box(b,'[data-stage-watch-live]'),header=await box(b,'header[data-phone="true"]');
  assert(pill.x>=0&&pill.right<=390&&pill.y>=header.y&&pill.bottom<=header.bottom,`the pill sits inside the phone header: ${JSON.stringify({pill,header})}`);}
 await b.waitForSelector('[data-stage-notice]',{visible:true,timeout:30000*scale});
 assert.equal(await b.$eval('[data-stage-notice]',e=>e.innerText.replace(/\s+/g,' ').trim()),'🔴 LB is live now. Watch live');
 assert(await seen(b,'[data-stage-notice-watch]'),'the message has a real Watch live button on a phone');
 assert(!(await b.evaluate(()=>document.body.innerText.includes('Watch on a computer'))),'no "Watch on a computer" wording');
 assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 assert(!(await downloaded(b)),'the pill and the button alone download nothing');
 await sleep(600);await shot(b,'phone-room-live');

 // The viewing room: only the video and its controls.
 await tap(b,'[data-stage-watch-live]');
 await b.waitForSelector(ROOT,{timeout:90000*scale});
 await waitView(b,'live');await playing(b);
 assert.equal(new URL(b.url()).searchParams.get('stage'),'1');
 assert.equal(await b.$eval(ROOT,e=>e.dataset.stageChat),'closed');
 assert(!(await seen(b,CHAT)),'the chat is not on screen until Chat is tapped');
 assert(!(await seen(b,LB)));assert(!(await seen(b,'header[data-phone="true"]')),'the room header is hidden');assert(!(await seen(b,'#chat-room-navigation')));
 assert.deepEqual(await box(b,'[data-stage-video-feed]'),{x:0,y:0,w:390,h:844,right:390,bottom:844},'the video has the whole screen');
 assert.deepEqual(await b.$eval('[data-stage-video-feed]',v=>[getComputedStyle(v).objectFit,v.playsInline,v.muted,v.autoplay,v.disablePictureInPicture]),['contain',true,true,true,false],'contained (never cropped), inline, and free to go to the phone\'s own full screen or picture in picture');
 assert.match(await b.$eval(ROOT,e=>e.innerText),/# LB/);
 assert.equal(await b.$eval(`${ROOT} [data-stage-viewers]`,e=>e.textContent),'3 watching');
 assert(await seen(b,`${ROOT} [data-stage-live]`));
 for(const selector of ['[data-stage-column]','[data-stage-stock]','[data-stage-chapter]','[data-stage-question]','[data-stage-overlay-card]','[data-stage-broadcast]','[data-stage-key]','[data-stage-elapsed]'])assert.equal(await b.$(selector),null,`the phone's viewing room has no ${selector}`);
 {const text=await b.$eval(ROOT,r=>r.innerText);for(const made of ['Trade tape','Question queue','Chapters','Raise hand','sample','Sample','Start live video','End live video','Stream key'])assert(!text.includes(made),`no "${made}" on a phone`);}
 {const names=await b.$$eval(`${ROOT} button`,bs=>bs.filter(x=>x.checkVisibility({visibilityProperty:true})).map(x=>({name:(x.getAttribute('aria-label')||x.textContent).trim(),w:Math.round(x.getBoundingClientRect().width),h:Math.round(x.getBoundingClientRect().height)})));
  for(const c of names){assert(c.name);assert(c.h>=44&&c.w>=44,`"${c.name}" is ${c.w}x${c.h}`);}
  for(const wanted of ['Back to the room','Tap for sound','Turn sound on','Full screen','Chat'])assert(names.some(c=>c.name===wanted),`a "${wanted}" control: ${names.map(c=>c.name).join(' | ')}`);}
 await shot(b,'phone-video');
 // Sound starts off, with a clear prompt.
 assert.equal(await b.evaluate(()=>window.__stageFeed.volume),0,'silent until tapped');
 await tap(b,'[data-stage-sound]');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-sound]')&&window.__stageFeed.volume===1&&window.__stageFeed.audioStarted===true);
 await wake(b);
 await tap(b,'[data-stage-phone-bottom] [data-stage-phone-mute]');
 await b.waitForFunction(()=>window.__stageFeed.volume===0&&!!document.querySelector('[data-stage-sound]'));
 await tap(b,'[data-stage-sound]');
 await b.waitForFunction(()=>window.__stageFeed.volume===1);
 // The controls fade, the Chat button stays, and a tap brings them back.
 await b.waitForFunction(r=>document.querySelector(r).dataset.stageChrome==='hidden',{timeout:15000*scale},ROOT);
 await sleep(500);
 assert(!(await seen(b,'[data-stage-exit]')));assert(await seen(b,'[data-stage-phone-chat]'),'the Chat button stays');
 await b.touchscreen.tap(195,420);
 await b.waitForFunction(r=>document.querySelector(r).dataset.stageChrome==='shown',{},ROOT);
 assert(await seen(b,'[data-stage-exit]'));
 console.log('PASS viewing room: only the video and its controls, contained and inline, silent until tapped, controls fade and return');

 // A message arrives while the chat is closed.
 assert.equal(await b.$('[data-stage-phone-unread]'),null,'no count to begin with');
 await typeAndSend(a,'Is everyone seeing the video?');
 await b.waitForSelector('[data-stage-phone-unread]',{timeout:80000*scale});
 assert.equal(await b.$eval('[data-stage-phone-unread]',e=>e.textContent),'1');
 assert.equal(await b.$eval('[data-stage-phone-chat]',e=>e.getAttribute('aria-label')),'Chat, 1 new message');
 // Chat: the real room chat under the docked video.
 await b.$eval('[data-stage-video-feed]',v=>{window.__sameVideo=v;});
 await tap(b,'[data-stage-phone-chat]');
 await b.waitForFunction(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility({visibilityProperty:true})),{},LB);
 const upright=async()=>({video:await box(b,'[data-stage-video-feed]'),bar:await box(b,'[data-stage-phone-chat-bar]'),chat:await box(b,CHAT),composer:await box(b,LB),log:await box(b,`${CHAT} [role="log"]`)});
 {const l=await upright();
  assert.deepEqual(l.video,{x:0,y:0,w:390,h:219,right:390,bottom:219},'the video docks to the top at 16:9');
  assert.equal(l.bar.y,l.video.bottom);assert.equal(l.chat.y,l.bar.bottom,'the chat starts under the video: nothing overlaps');
  assert.equal(l.chat.bottom,844);assert.equal(l.chat.w,390);assert(l.chat.h>=422,`the chat has half the screen or more: ${JSON.stringify(l)}`);
  assert(l.composer.bottom<=844&&l.composer.y>l.log.y,'the composer is on screen under the list');}
 assert.equal(await b.$('[data-stage-phone-unread]'),null);assert.equal(await b.$('[data-stage-phone-chat]'),null,'the Chat button gives way to Close');
 // It opens on the newest message (a room left part-way through its unread messages catches up here).
 await b.waitForFunction(s=>[...document.querySelectorAll(`${s} article[id^="chat-message-"]`)].at(-1)?.textContent.includes('Is everyone seeing the video?'),{timeout:30000*scale},CHAT);
 assert.equal(await b.evaluate(()=>window.__sameVideo===document.querySelector('[data-stage-video-feed]')&&!window.__sameVideo.paused),true,'the same video keeps playing');
 assert.equal(await b.evaluate(()=>window.__stageFeed.connects.length),1);
 // The list rests on its newest message.
 const pinned=()=>b.$eval(`${CHAT} [role="log"]`,e=>Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop)<=2);
 await until(pinned,'the list rests on the newest message',15000);
 await typeAndSend(b,'Watching on my phone.');
 assert(await saved(b,'Watching on my phone.'),'a message from the viewing room is a real room message');
 await until(pinned,'still on the newest message after sending',5000);
 // The typing line (filled in by hand here: the fixture has no typing signal) is clear of the newest message.
 {const clear=await b.evaluate(s=>{const typing=document.querySelector(`${s} [class*="_typing__"]`);if(!typing)return 'no typing line';typing.textContent='Alice is typing…';
   const t=typing.getBoundingClientRect(),rows=[...document.querySelectorAll(`${s} article[id^="chat-message-"]`)],last=rows.at(-1).getBoundingClientRect();typing.textContent='';
   return t.height>0&&t.top>=last.bottom-1?true:JSON.stringify({typing:[t.top,t.bottom],last:[last.top,last.bottom]});},CHAT);
  assert.equal(clear,true,`the typing line does not cover the newest message: ${clear}`);}
 await b.evaluate(()=>document.activeElement?.blur());await sleep(300);
 await shot(b,'phone-chat-open');
 // The keyboard (the visible part of the screen gets shorter while the composer has focus).
 await (await shown(b,LB)).asElement().click();
 await b.setViewport({...UPRIGHT,height:500});
 await b.waitForFunction(()=>document.querySelector('main').style.getPropertyValue('--chat-visual-height')==='500px',{timeout:10000*scale});
 await sleep(900);
 {const l=await upright();
  assert(l.video.y===0&&l.video.h>=150&&l.video.bottom<500,`the video stays on screen, smaller: ${JSON.stringify(l)}`);
  assert(l.composer.bottom<=500&&l.composer.y>l.video.bottom,`the composer sits above the keyboard: ${JSON.stringify(l)}`);
  assert.equal(await b.evaluate(()=>window.scrollY),0,'the page itself has not scrolled');
  assert(await pinned(),'the list is still on its newest message');
  assert.equal(await b.evaluate(()=>window.__sameVideo===document.querySelector('[data-stage-video-feed]')&&!window.__sameVideo.paused),true);}
 await shot(b,'phone-keyboard');
 await b.evaluate(()=>document.activeElement?.blur());await b.setViewport(UPRIGHT);await sleep(900);
 // A reply thread opens inside the panel, with the video still above it.
 {const row=await b.evaluateHandle(s=>[...document.querySelectorAll(`${s} article[id^="chat-message-"]`)].find(x=>x.textContent.includes('Is everyone seeing the video?')),CHAT);
  await row.asElement().evaluate(e=>e.scrollIntoView({block:'center'}));await sleep(300);
  // The row's ••• menu, then Reply.
  await (await row.asElement().$('summary')).tap();
  const reply=await b.waitForFunction(r=>[...r.querySelectorAll('details[open] button')].find(x=>/^Reply/.test(x.textContent.trim())&&x.checkVisibility({visibilityProperty:true})),{timeout:15000*scale},row);
  {const menu=await reply.asElement().evaluate(e=>{const r=e.getBoundingClientRect();return {y:Math.round(r.top),bottom:Math.round(r.bottom),x:Math.round(r.left),right:Math.round(r.right)};});
   assert(menu.x>=0&&menu.right<=390&&menu.y>=0&&menu.bottom<=844,`the message menu is on screen: ${JSON.stringify(menu)}`);}
  await sleep(300);await reply.asElement().tap();
  await b.waitForFunction(()=>document.querySelector('aside[aria-label="Comment replies"]')?.checkVisibility({visibilityProperty:true}),{timeout:30000*scale});
  await sleep(500);
  const thread=await box(b,'aside[aria-label="Comment replies"]'),video=await box(b,'[data-stage-video-feed]');
  assert.deepEqual([thread.x,thread.y,thread.right,thread.bottom],[0,267,390,844],`the thread takes the chat panel's place: ${JSON.stringify(thread)}`);
  assert.equal(video.bottom,219);assert(!(await seen(b,CHAT)),'the room chat is behind the thread');
  await shot(b,'phone-thread');
  await tap(b,'aside[aria-label="Comment replies"] button[aria-label="Back to chat"]');
  await b.waitForFunction(()=>!document.querySelector('aside[aria-label="Comment replies"]'),{timeout:15000*scale});
  assert(await seen(b,LB),'back from the thread, the room chat is there again');assert(await b.$(ROOT),'and the viewing room is still open');}
 console.log('PASS chat upright: the real room chat under the docked video, sending works, typing line and keyboard leave the video and newest message in view, threads open in the panel');

 // On its side: the same video; the chat is a see-through panel over the right half.
 await b.setViewport(SIDEWAYS);await sleep(900);
 assert(await b.$(ROOT),'turning the phone keeps the viewing room');
 assert.equal(await b.evaluate(()=>window.__sameVideo===document.querySelector('[data-stage-video-feed]')&&!window.__sameVideo.paused),true,'turning the phone does not restart the video');
 assert.deepEqual(await b.evaluate(()=>[window.__stageFeed.connects.length,window.__stageFeed.closed]),[1,0],'one connection, never closed');
 {const video=await box(b,'[data-stage-video-feed]'),chat=await box(b,CHAT),bar=await box(b,'[data-stage-phone-chat-bar]'),composer=await box(b,LB);
  assert.deepEqual(video,{x:0,y:0,w:844,h:390,right:844,bottom:390},'the video keeps the whole screen');
  assert.deepEqual([chat.x,chat.right,chat.bottom,bar.x,bar.y,chat.y],[422,844,390,422,0,bar.bottom],`the chat is the right half: ${JSON.stringify({chat,bar})}`);
  assert(composer.x>=422&&composer.right<=844&&composer.bottom<=390&&composer.y>=chat.y,`the composer is on screen inside the panel: ${JSON.stringify(composer)}`);
  const look=await b.$eval(CHAT,e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,blur:s.backdropFilter||s.webkitBackdropFilter};});
  const alpha=Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(look.background)?.[1]??1);
  assert(alpha>=0.8&&alpha<1,`see-through, and dark enough to read over any picture: ${JSON.stringify(look)}`);assert.match(look.blur,/blur/);
  assert.equal(await b.$eval('[data-stage-video-feed]',v=>getComputedStyle(v).objectPosition),'0% 50%','the picture moves left, out from under the chat');}
 await typeAndSend(b,'And sideways.');
 await b.evaluate(()=>document.activeElement?.blur());await sleep(300);
 await shot(b,'phone-landscape-chat');
 await tap(b,'[data-stage-phone-chat-close]');
 await b.waitForFunction(r=>document.querySelector(r).dataset.stageChat==='closed',{},ROOT);
 assert(!(await seen(b,CHAT)));assert(!(await seen(b,LB)));
 assert.deepEqual(await box(b,'[data-stage-video-feed]'),{x:0,y:0,w:844,h:390,right:844,bottom:390});
 assert.equal(await b.$eval('[data-stage-video-feed]',v=>getComputedStyle(v).objectPosition),'50% 50%');
 await sleep(400);await shot(b,'phone-landscape-video');
 await typeAndSend(a,'Sound is good here.');await sleep(1500);await typeAndSend(a,'Chart looks clean.');
 // (Without a live connection the fixture's rooms hear of new messages on a timer: allow for a slow turn.)
 await b.waitForFunction(()=>document.querySelector('[data-stage-phone-unread]')?.textContent==='2',{timeout:80000*scale});
 await b.setViewport(UPRIGHT);await sleep(900);
 assert.equal(await b.evaluate(()=>window.__sameVideo===document.querySelector('[data-stage-video-feed]')&&!window.__sameVideo.paused),true);
 assert.deepEqual(await box(b,'[data-stage-video-feed]'),{x:0,y:0,w:390,h:844,right:390,bottom:844},'closed, the video has the whole screen again');
 assert.equal(await b.$eval('[data-stage-phone-unread]',e=>e.textContent),'2');
 console.log('PASS on its side: no restart, the chat overlays the right half with its composer on screen, Close gives the screen back, new messages are counted');

 // Back to the room: the button, then the phone's own back.
 await wake(b);
 await tap(b,'[data-stage-exit]');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-root]'),{timeout:15000*scale});
 await b.waitForFunction(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility({visibilityProperty:true})),{},LB);
 assert.equal(new URL(b.url()).searchParams.get('stage'),null);assert.equal(new URL(b.url()).searchParams.get('room'),'main');
 assert(await seen(b,'[data-stage-watch-live]'),'back in the room, the LIVE pill is still there');assert(await seen(b,'header[data-phone="true"]'));
 assert.equal(await b.evaluate(()=>window.__stageFeed.closed),1,'leaving closes the connection');
 // The room's message opens it in place.
 await b.evaluate(()=>{window.__samePage=true;});
 const tabs=(await bob.context.pages()).length;
 await (await shown(b,'[data-stage-notice-watch]')).asElement().evaluate(e=>e.scrollIntoView({block:'center'}));await sleep(300);
 await tap(b,'[data-stage-notice-watch]');
 await b.waitForSelector(ROOT,{timeout:60000*scale});await waitView(b,'live');
 assert.equal(await b.evaluate(()=>window.__samePage),true,'opened in place, not a new page');assert.equal((await bob.context.pages()).length,tabs,'and not in a new tab');
 await b.goBack();
 await b.waitForFunction(()=>!document.querySelector('[data-stage-root]'),{timeout:15000*scale});
 await sleep(400);
 assert(await seen(b,LB),'the phone\'s own back returns to the room, not the room list');
 assert.equal(new URL(b.url()).searchParams.get('stage'),null);
 // The stage link (the bell entry and the phone notification point here); the first connection fails.
 await b.setRequestInterception(true);
 let failing=true;const refuse=request=>{if(request.url().includes('/api/chat/stage/token')&&failing)void request.respond({status:500,contentType:'application/json',body:'{"error":"test"}'});else void request.continue();};
 b.on('request',refuse);
 assert.equal(await openRoom(bob,'/chat?room=main&stage=1'),'live');
 await b.waitForSelector(ROOT,{timeout:90000*scale});
 await waitView(b,'error');
 assert.match(await b.$eval('[data-stage-video-message]',e=>e.innerText),/Couldn’t connect to the live video/);
 failing=false;
 await tap(b,'[data-stage-video-retry]');
 await waitView(b,'live');await playing(b);
 b.off('request',refuse);await b.setRequestInterception(false);
 // Coming back from the background asks the status again and keeps the picture moving.
 {const before=bob.stageAnswers.filter(x=>x.includes('/status')).length;
  await b.$eval('[data-stage-video-feed]',v=>v.pause());
  await b.waitForSelector('[data-stage-phone-play]',{visible:true});
  await b.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await b.waitForFunction(()=>!document.querySelector('[data-stage-video-feed]').paused&&!document.querySelector('[data-stage-phone-play]'),{timeout:10000*scale});
  await until(()=>bob.stageAnswers.filter(x=>x.includes('/status')).length>before,'the status is asked again on return',10000);}
 console.log('PASS ways in and out: back button, the phone\'s back, the message button, the stage link; a failed connection can be tried again; returning from the background resumes');

 // #511's rule on a phone too: the broadcast stops (nobody presses End). The viewing room rides out the
 // grace, then lets go of its connection and says the broadcast has ended; nothing connects while the
 // room is only waiting, not even on coming back to the page; live again, it reconnects by itself.
 {const feed=()=>b.evaluate(()=>({connects:window.__stageFeed.connects.length,closed:window.__stageFeed.closed,token:window.__stageFeed.connects.at(-1)?.token}));
  // This test runs without Ably: the room's "stage" signal is sent to the page by hand.
  const signal=()=>b.evaluate(()=>{window.dispatchEvent(new CustomEvent('chat-stage-event',{detail:{room:'main'}}));});
  const was=await feed();
  lk.publishing=false;const stopped=Date.now();
  await webhook('participant_left','stage-broadcast');await signal();
  await waitView(b,'stopped');
  assert.match(await b.$eval('[data-stage-video-message]',e=>e.innerText),/The broadcast has stopped/);
  await sleep(5000);
  assert.deepEqual([(await feed()).closed,await view(b)],[was.closed,'stopped'],'a short drop is ridden out: still connected');
  await b.waitForFunction(n=>window.__stageFeed.closed===n,{timeout:60000*scale},was.closed+1);
  const held=Date.now()-stopped;assert(held>=20000&&held<45000*scale,`let go after the grace (about 25 seconds), not ${held}ms`);
  await waitView(b,'ended');
  assert.match(await b.$eval('[data-stage-video-message]',e=>e.innerText),/The broadcast has ended\s*Back to the room/);
  assert.equal(await b.$('[data-stage-video-feed]'),null,'no video element once disconnected');
  await signal();await b.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await sleep(6500);
  assert.equal((await feed()).connects,was.connects,'nothing connects while the room is only waiting, not even on coming back to the page');
  assert.equal(await view(b),'ended');
  // Live again.
  lk.publishing=true;lk.startedAt=Date.now();
  await Promise.all([webhook('ingress_started'),webhook('track_published','stage-broadcast')]);await sleep(1700);await signal();
  await waitView(b,'live');await playing(b);
  const now=await feed();assert.deepEqual([now.connects,now.closed],[was.connects+1,was.closed+1],'connected again by itself, once');
  assert.notEqual(now.token,was.token,'with a fresh token');
  console.log('PASS broadcast stops: the phone lets go of its connection after the grace, opens none while waiting, and reconnects when live again');}

 // A computer still gets the computer's stage.
 assert.equal(await openRoom(alice,'/chat?room=main&stage=1'),'live');
 await a.waitForSelector('[data-stage-root] [data-stage-column="stage"]',{timeout:90000*scale});
 assert.equal(await a.$('[data-stage-phone]'),null,'no phone viewing room on a computer');
 assert.equal(await a.$eval('[data-stage-root]',e=>e.dataset.stageColumns),'3');
 await a.click('[data-stage-exit]');await a.waitForFunction(()=>!document.querySelector('[data-stage-root]'));
 await a.waitForSelector('[data-stage-watch-live]',{visible:true});
 assert.match(await a.$eval('[data-stage-watch-live]',e=>e.textContent),/LIVE\s*Watch live/);

 // Ended.
 lk.ingresses.clear();lk.publishing=false;await webhook('ingress_ended');
 await waitView(b,'ended');
 assert.match(await b.$eval('[data-stage-video-message]',e=>e.innerText),/The broadcast has ended\s*Back to the room/);
 assert.equal(await b.$(`${ROOT} [data-stage-live]`),null);
 await sleep(300);await shot(b,'phone-ended');
 await tap(b,'[data-stage-phone-ended-back]');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-root]'),{timeout:15000*scale});
 await b.waitForFunction(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility({visibilityProperty:true})),{},LB);
 await b.waitForFunction(()=>!document.querySelector('[data-stage-watch-live]'),{timeout:30000*scale});
 await until(async()=>(await sql("select 1 from longboard_chat_messages where room_slug='main' and bot_slug='longboard' and body like '%has ended%'")).length,'the message says it ended');
 await sleep(4200);
 assert.equal(await openRoom(bob),'off');
 await b.waitForSelector(LB,{visible:true,timeout:60000*scale});
 assert.equal(await b.$('[data-stage-notice-watch]'),null,'the ended message has no Watch live button');assert.equal(await b.$('[data-stage-watch-live]'),null);
 console.log('PASS ended: "The broadcast has ended" with a button back to the room; the LIVE pill and the message button go');

 // Set up, not broadcasting yet: an admin's phone may wait for it; a member's is just the room.
 lk.ingresses.set('chat-main',{id:'IN_fake_waiting'});lk.publishing=false;
 await sleep(4200);
 assert.equal(await openRoom(bob,'/chat?room=main&stage=1'),'waiting');
 await sleep(800);
 assert.equal(await b.$('[data-stage-root]'),null,'a member cannot open it before the broadcast');assert.equal(await b.$('[data-stage-watch-live]'),null);
 await a.setViewport(UPRIGHT);
 assert.equal(await openRoom(alice,'/chat?room=main&stage=1'),'waiting');
 await a.waitForSelector(ROOT,{timeout:90000*scale});
 await waitView(a,'waiting');
 assert.match(await a.$eval('[data-stage-video-message]',e=>e.innerText),/Waiting for the broadcast to start/);
 for(const selector of ['[data-stage-broadcast]','[data-stage-start]','[data-stage-column]'])assert.equal(await a.$(selector),null,`an admin's phone has no ${selector}`);
 // #512: waiting is no reason to connect, for an admin either: no video element, no token, no connection.
 await sleep(1500);
 assert.equal(await a.$(`${ROOT} video`),null,'no video element while the room is only waiting');
 assert.equal(await a.evaluate(()=>window.__stageFeed.connects.length),0,'an admin\'s phone holds no connection while the room is only waiting');
 assert(!alice.stageAnswers.some(x=>x.includes('/api/chat/stage/token')),`no token asked for while waiting: ${alice.stageAnswers.join(' | ')}`);
 // The broadcast arrives: LiveKit's webhook tells the server, the room's signal tells the page, and only then does it connect.
 lk.publishing=true;lk.startedAt=Date.now();
 await webhook('ingress_started');await a.evaluate(()=>{window.dispatchEvent(new CustomEvent('chat-stage-event',{detail:{room:'main'}}));});
 await waitView(a,'live');
 assert.equal(await a.evaluate(()=>window.__stageFeed.connects.length),1,'connected once the room is live');
 lk.publishing=false;
 await waitView(a,'stopped');
 assert.match(await a.$eval('[data-stage-video-message]',e=>e.innerText),/The broadcast has stopped/);
 console.log('PASS waiting: an admin\'s phone waits for the broadcast and follows it; a member\'s phone is just the room until it is live');
 for(const who of [alice,bob])assert.deepEqual(who.errors,[]);
}finally{await browser.close();stub.close();}
