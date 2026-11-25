// #502 Stage mode's live video, open to members (localhost:3503, database 127.0.0.1:54503).
// No real LiveKit is reached and no real key exists here:
//  - the server's LiveKit calls (list/create/delete ingress, delete room) go to this test's own
//    stand-in on 127.0.0.1:54633 (the manifest's `livekit` preset points LIVEKIT_URL at it);
//  - in the page, the player's connection is a stand-in too (stageFeed.ts lets a test supply one
//    outside a production build): it plays a drawn test picture while the stand-in is "publishing".
// Synthetic members, messages and alerts only. Alice is a chat admin, Bob a member.
//  - not started: Bob's room has no LIVE button and no "Go live" item, /chat?room=main&stage=1 is
//    just the room, and he downloads no stage code;
//  - Alice opens the stage: the player says live video is not started; "Start live video" shows the
//    stream address and the stream key, masked until "Show"; the player waits for the broadcast;
//    Bob (room re-opened) still sees no LIVE button, because nothing is broadcasting yet;
//  - the broadcast starts: Alice's player is live, the top bar counts who is watching; Bob's room
//    (re-opened) shows the red LIVE / "Watch live" button; it opens his stage: two columns (video,
//    room chat), the player live with a real <video>, "Tap for sound", working pause and mute, and
//    NO sample trades, questions, chapters, host line, overlay card, Raise hand or broadcast card;
//    his token is watch-only for chat-main; he can chat from the stage; his stage link opens it;
//  - with no rows on today's Gainers Table a member has no stock panel (no sample row); once a stock
//    alerts, the panel shows that real row;
//  - Bob is never sent the stream key (no answer his page received contains it; the admin API
//    refuses him);
//  - Alice ends it: the ingress is deleted, Bob's player says the broadcast has ended, and back in
//    the room the LIVE button is gone and the stage link is just the room again.
// CHAT_SHOT_DIR saves member-room-live.png, member-stage.png, admin-start.png, admin-stage-live.png.
import assert from 'node:assert/strict';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3503',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54503',STUB='http://127.0.0.1:54633';
for(const url of [base,fixture,STUB])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,scale=Number(process.env.CHAT_TIMING_SCALE||1);
const FAKE_KEY='FAKE-STREAM-KEY-for-tests-only',FAKE_ADDRESS='rtmps://fake-livekit.example.test/x';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// One stock on today's Gainers Table (the manifest's fake Polygon prices it), for the stock panel.
const alert=(sym,secondsAgo,vol)=>sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[1,new Date(Date.now()-secondsAgo*1000).toISOString(),`🚨 ${sym} (+41.0%)\nPrice: $2.50\nVolume: ${vol.toLocaleString('en-US')}\nMarket Cap: 12.5M`]);

// The stand-in LiveKit: Twirp over JSON, as livekit-server-sdk speaks it. One ingress per room.
const lk={ingresses:new Map(),publishing:false,calls:[],deletedRooms:[]};
const info=(room,i)=>({ingress_id:i.id,name:room,stream_key:FAKE_KEY,url:FAKE_ADDRESS,input_type:'RTMP_INPUT',room_name:room,participant_identity:'stage-broadcast',reusable:true,state:{status:lk.publishing?'ENDPOINT_PUBLISHING':'ENDPOINT_INACTIVE',room_id:'RM_fake'}});
const stub=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'):{};
 const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify(value));};
 // The page's stand-in player asks whether the broadcast is on.
 if(req.url==='/test/state')return send({started:lk.ingresses.size>0,publishing:lk.ingresses.size>0&&lk.publishing});
 const call=req.url.replace('/twirp/livekit.','');lk.calls.push(call);
 assert.match(req.headers.authorization??'',/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,'the server signs its LiveKit calls');
 const room=body.room_name??body.roomName??body.room;
 if(call==='Ingress/ListIngress')return send({items:[...lk.ingresses].filter(([name])=>!room||name===room).map(([name,i])=>info(name,i))});
 if(call==='Ingress/CreateIngress'){assert.equal(body.participant_identity??body.participantIdentity,'stage-broadcast');const i={id:`IN_fake${lk.ingresses.size+1}`};lk.ingresses.set(room,i);return send(info(room,i));}
 if(call==='Ingress/DeleteIngress'){const id=body.ingress_id??body.ingressId;for(const [name,i] of lk.ingresses)if(i.id===id){lk.ingresses.delete(name);return send(info(name,i));}return send({code:'not_found',msg:'no such ingress'},404);}
 if(call==='RoomService/DeleteRoom'){lk.deletedRooms.push(room);return send({});}
 return send({code:'unimplemented',msg:call},501);
});
await new Promise(r=>stub.listen(54633,'127.0.0.1',r));

// The page's stand-in for the LiveKit connection (see components/chat/stage/stageFeed.ts).
const fakeFeed=stubUrl=>{
 window.__stageFeed={connects:[],closed:0};
 window.__chatStageFeedForTests=async({url,token,video,events})=>{
  window.__stageFeed.connects.push({url,token});
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');let tick=0;
  const draw=()=>{tick++;const g=ctx.createLinearGradient(0,0,1280,720);g.addColorStop(0,'#16324f');g.addColorStop(1,'#3b1f4a');ctx.fillStyle=g;ctx.fillRect(0,0,1280,720);
   ctx.fillStyle='rgba(255,255,255,.14)';ctx.fillRect((tick*9)%1280,0,90,720);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='700 64px sans-serif';ctx.fillText('TEST VIDEO',640,340);
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
const LB='textarea[aria-label="Message LB"]';
const shown=(page,selector)=>page.evaluateHandle(s=>[...document.querySelectorAll(s)].find(e=>e.checkVisibility())??null,selector);
const visible=(page,selector)=>page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility()),selector);
const ready=page=>page.waitForFunction(()=>{const b=[...document.querySelectorAll('button[aria-label="Chat settings"]')].find(e=>e.checkVisibility());return b&&Object.keys(b).some(k=>k.startsWith('__reactProps$'));},{timeout:60000*scale});
const openMenu=async page=>{await ready(page);await (await shown(page,'button[aria-label="Chat settings"]')).click();await page.waitForSelector('#chat-settings-panel',{visible:true});
 return page.$$eval('#chat-settings-panel :is(button,a)',items=>items.filter(e=>e.checkVisibility()).map(e=>e.textContent.trim()));};
const send=async(page,text)=>{const box=await shown(page,LB);await box.click();await page.keyboard.type(text);await page.keyboard.press('Enter');
 await page.waitForFunction(t=>[...document.querySelectorAll('article[id^="chat-message-"]:not([data-pending])')].some(a=>a.checkVisibility()&&a.textContent.includes(t)),{timeout:30000*scale},text);};
const saved=(page,text)=>page.evaluate(async t=>{const r=await fetch('/api/chat/history?room=main',{cache:'no-store'});const body=await r.json();return (body.messages??[]).some(m=>m.body===t);},text);
// Opens the room afresh and waits for its one status answer (`who` is newPage()'s result).
const openRoom=async(who,path='/chat?room=main')=>{
 const page=who.page;await page.goto('about:blank');await sleep(100);who.stageAnswers.length=0;
 await page.goto(base+path);await page.waitForSelector(LB,{visible:true,timeout:60000*scale});
 for(let waited=0;;waited+=100){const answer=who.stageAnswers.find(x=>/^200 \/api\/chat\/stage\/status\?room=main \{/.test(x));
  if(answer){await ready(page);await sleep(300);return JSON.parse(answer.slice(answer.indexOf('{'))).state;}
  assert(waited<60000*scale,`no status answer: ${who.stageAnswers.join(' | ')}`);await sleep(100);}};
const playerState=page=>page.$eval('[data-stage-video]',e=>e.dataset.stageVideoState);
const waitPlayer=(page,state)=>page.waitForFunction(s=>document.querySelector('[data-stage-video]')?.dataset.stageVideoState===s,{timeout:30000*scale},state);
const newPage=async()=>{const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],stageAnswers=[];
 page.on('pageerror',e=>errors.push(e.message));
 const everyAnswer=[];
 page.on('response',async r=>{if(!r.url().includes('/api/chat/stage/'))return;const line=`${r.status()} ${r.url().replace(base,'')} ${await r.text().catch(()=>'')}`;stageAnswers.push(line);everyAnswer.push(line);});
 await page.setViewport({width:1440,height:900});await page.evaluateOnNewDocument(fakeFeed,STUB);return {context,page,errors,stageAnswers,everyAnswer};};
try{
 const bob=await newPage(),alice=await newPage();
 // Not started: nothing at all for a member.
 await signIn(bob.page,base,'bob@example.test',{composer:LB,next:'/chat?room=main'});
 await send(bob.page,'Morning all.');
 assert.equal(await openRoom(bob),'off');
 assert.equal(await bob.page.$('[data-stage-watch-live]'),null,'no LIVE button while nothing is live');
 {const items=await openMenu(bob.page);assert(items.includes('Pop out chat'));assert(!items.some(t=>/go live/i.test(t)),`a member has no Go live item: ${items.join(' | ')}`);await bob.page.keyboard.press('Escape');}
 assert.equal(await openRoom(bob,'/chat?room=main&stage=1'),'off');
 await sleep(800);
 assert.equal(await bob.page.$('[data-stage-root]'),null,'a member\'s stage link is just the room while it is not live');
 assert(await visible(bob.page,'#chat-room-navigation'));
 assert(!(await bob.page.evaluate(()=>performance.getEntriesByType('resource').some(e=>/StageMode|livekit/i.test(e.name)))),'a member downloads no stage or LiveKit code');
 await sleep(1500);
 assert.equal(bob.stageAnswers.filter(a=>a.includes('/status')).length,1,`one status request for a room opening: ${bob.stageAnswers.join('\n')}`);
 console.log('PASS not started: a member sees no change, and asks the status once per room opening');

 // The admin starts live video.
 const a=alice.page;
 await signIn(a,base,'alice@example.test',{composer:LB,next:'/chat?room=main'});
 assert((await openMenu(a)).includes('Go live (preview)'));
 await a.click('[data-stage-go-live]');
 await a.waitForSelector('[data-stage-broadcast]',{timeout:60000*scale});
 assert.equal(await playerState(a),'preview');
 assert.match(await a.$eval('[data-stage-video-placeholder]',e=>e.textContent),/Start live video below/);
 assert.equal(await a.$('[data-stage-root] video'),null,'no video element before it is started');
 assert.equal(await a.$eval('[data-stage-broadcast]',e=>e.dataset.stageBroadcast),'off');
 await a.waitForFunction(()=>!document.querySelector('[data-stage-start]').disabled);
 assert.deepEqual(lk.calls.filter(c=>c!=='Ingress/ListIngress'),[],'nothing is created before Start');
 await a.click('[data-stage-start]');
 await a.waitForSelector('[data-stage-key]',{timeout:30000*scale});
 assert.equal(await a.$eval('[data-stage-address]',i=>i.value),FAKE_ADDRESS);
 assert.deepEqual(await a.$eval('[data-stage-key]',i=>[i.type,i.value,i.readOnly]),['password',FAKE_KEY,true],'the key is masked until shown');
 assert(!(await a.$eval('[data-stage-root]',r=>r.innerText)).includes(FAKE_KEY),'the key is not readable on the page while masked');
 assert.equal(await a.$eval('[data-stage-broadcast]',e=>e.dataset.stageBroadcast),'started');
 assert.match(await a.$eval('[data-stage-broadcast]',e=>e.textContent),/Waiting for StreamYard/);
 for(const name of ['stream address','stream key'])assert(await a.$(`[data-stage-copy="${name}"]`),`a copy button for the ${name}`);
 assert.deepEqual([...lk.ingresses.keys()],['chat-main'],'the ingress is for the LiveKit room chat-main');
 await waitPlayer(a,'waiting');
 assert.match(await a.$eval('[data-stage-video-message]',e=>e.textContent),/Waiting for the broadcast to start/);
 assert.equal(await a.$('[data-stage-live]'),null,'the top bar does not say LIVE before the broadcast');
 if(shots){await a.evaluate(()=>document.querySelector('[data-stage-column="stage"]').scrollTo(0,0));await sleep(200);await a.screenshot({path:`${shots}/admin-start.png`});}
 await a.click('[data-stage-key-reveal]');
 assert.equal(await a.$eval('[data-stage-key]',i=>i.type),'text','Show reveals the key');
 await a.click('[data-stage-key-reveal]');
 assert.equal(await a.$eval('[data-stage-key]',i=>i.type),'password');
 // Starting again (a reload) reuses the same ingress.
 assert.equal(lk.calls.filter(c=>c==='Ingress/CreateIngress').length,1);
 // Started but not broadcasting: still nothing for a member.
 assert.equal(await openRoom(bob),'waiting');
 assert.equal(await bob.page.$('[data-stage-watch-live]'),null,'no LIVE button until the broadcast is on');
 {const refused=await bob.page.evaluate(async()=>{const r=await fetch('/api/chat/stage/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'main'})});return [r.status,await r.text()];});
  assert.equal(refused[0],409,'no watch token for a member before it is live');assert(!/token"/.test(refused[1]));}
 console.log('PASS admin start: address and masked key for the admin; nothing for members until the broadcast is on');

 // The broadcast starts.
 lk.publishing=true;
 await waitPlayer(a,'live');
 await a.waitForSelector('[data-stage-live]');
 assert.equal(await a.$eval('[data-stage-viewers]',e=>e.textContent),'3 watching','the top bar counts who is watching');
 await a.waitForFunction(()=>document.querySelector('[data-stage-broadcast]').dataset.stageBroadcast==='live');
 assert.match(await a.$eval('[data-stage-broadcast]',e=>e.textContent),/members of this room can watch/);
 assert(await a.$eval('[data-stage-video-feed]',v=>!v.hidden&&v.srcObject!==null));
 // The admin still has the sample panels, marked as samples.
 assert(await a.$('[data-stage-column="trades"]'));assert(await a.$('[data-stage-chapter]'));assert(await a.$('[data-stage-overlay-card]'));
 assert.match(await a.$eval('[data-stage-column="trades"]',e=>e.textContent),/Trade tape · sample.*Question queue · sample/s);
 if(shots){await a.evaluate(()=>document.querySelector('[data-stage-column="stage"]').scrollTo(0,0));await a.waitForFunction(()=>document.querySelector('[data-stage-video-feed]').videoWidth>0);await a.screenshot({path:`${shots}/admin-stage-live.png`});}

 // The member: the LIVE button, then the stage.
 const b=bob.page;
 await sleep(4200); // the server's few seconds' memory of "waiting"
 assert.equal(await openRoom(bob),'live');
 await b.waitForSelector('[data-stage-watch-live]',{visible:true});
 assert.match(await b.$eval('[data-stage-watch-live]',e=>e.textContent),/LIVE\s*Watch live/);
 assert(!(await b.evaluate(()=>performance.getEntriesByType('resource').some(e=>/StageMode|livekit/i.test(e.name)))),'the LIVE button alone downloads no stage code');
 {const items=await openMenu(b);assert(!items.some(t=>/go live/i.test(t)),'a member never has Go live');await b.keyboard.press('Escape');}
 if(shots)await b.screenshot({path:`${shots}/member-room-live.png`});
 await b.click('[data-stage-watch-live]');
 await b.waitForSelector('[data-stage-root]',{timeout:60000*scale});
 await waitPlayer(b,'live');
 assert.equal(new URL(b.url()).searchParams.get('stage'),'1');
 const layout=()=>b.evaluate(()=>{const box=s=>{const e=[...document.querySelectorAll(s)].find(x=>x.checkVisibility());if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),right:Math.round(r.right),bottom:Math.round(r.bottom)};};
  return {bar:box('[data-stage-root] > header'),stage:box('[data-stage-column="stage"]'),chat:box('[data-stage-root] ~ section'),video:box('[data-stage-video]'),sideways:document.documentElement.scrollWidth>window.innerWidth,width:window.innerWidth,height:window.innerHeight};});
 {const l=await layout();
  assert(l.bar&&l.stage&&l.chat&&l.video,JSON.stringify(l));
  assert.equal(l.stage.x,0);assert.equal(l.stage.right+1,l.chat.x,`the chat sits right beside the stage (no empty middle column): ${JSON.stringify(l)}`);
  assert.equal(l.chat.w,340);assert.equal(l.chat.right,l.width);assert(!l.sideways);
  assert(l.video.bottom<=l.height,`the whole player fits the window: ${JSON.stringify(l)}`);}
 // Nothing made up is shown to a member.
 const stageText=await b.$eval('[data-stage-root]',r=>r.innerText);
 for(const made of ['QBTZ','MLNK','VXRT','Trade tape','Question queue','Chapters','Raise hand','Rob Booker','Trading the open','sample','Sample','WATCH','Admin','Stream key','Start live video','End live video'])
  assert(!stageText.includes(made),`a member's stage does not show "${made}"`);
 for(const selector of ['[data-stage-column="trades"]','[data-stage-chapter]','[data-stage-question]','[data-stage-overlay-card]','[data-stage-broadcast]','[data-stage-elapsed]','[data-stage-host-sample]','[data-stage-key]'])
  assert.equal(await b.$(selector),null,`a member's stage has no ${selector}`);
 assert.equal(await b.$eval('[data-stage-overlay]',e=>e.childElementCount),0,'the overlay layer is there, empty');
 const bar=await b.$eval('[data-stage-root] > header',h=>h.innerText);
 for(const text of ['# LB','LIVE','3 watching','Back to the room'])assert(bar.includes(text),`the member's top bar has "${text}": ${bar}`);
 assert.match(await b.$eval('[data-stage-video]',e=>e.innerText),/LIVE VIDEO\s*# LB/,'the player names the room');
 // No rows on today's Gainers Table: no stock panel at all (the admin's sample row is not shown to members).
 assert.equal(await b.$('[data-stage-stock]'),null,'no sample stock for a member');
 // A stock alerts: the panel appears with the table's real row (the next 15-second read).
 await alert('AEHL',52,300000);
 await b.waitForSelector('[data-stage-stock][data-stage-stock-source="table"]',{timeout:40000*scale});
 assert.equal(await b.$eval('[data-stage-stock]',e=>e.dataset.stageStock),'AEHL');assert.equal(await b.$('[data-stage-sample]'),null);
 assert.equal(await b.$eval('[data-stage-stat="price"] dd',d=>d.textContent),'$2.50');
 {const l=await layout();assert(!l.sideways,'the stock panel fits the member\'s stage');}
 // The player: a real video element showing the picture, with working controls.
 await b.waitForFunction(()=>{const v=document.querySelector('[data-stage-video-feed]');return v&&!v.hidden&&v.videoWidth===1280&&!v.paused;},{timeout:20000*scale});
 assert.equal(await b.$eval('[data-stage-video-feed]',v=>v.muted),true,'the picture itself is silent: the sound has its own element');
 await b.waitForFunction(()=>document.querySelector('[data-stage-video-quality]')?.textContent==='720p');
 await b.click('[data-stage-sound]');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-sound]'));
 assert.equal(await b.evaluate(()=>window.__stageFeed.audioStarted),true,'Tap for sound starts the audio');
 await b.click('[data-stage-video] button[aria-label="Pause"]');
 assert.equal(await b.$eval('[data-stage-video-feed]',v=>v.paused),true);assert.equal(await b.evaluate(()=>window.__stageFeed.volume),0,'paused is silent');
 await b.click('[data-stage-video] button[aria-label="Play"]');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-video-feed]').paused&&window.__stageFeed.volume===1);
 await b.click('[data-stage-video] button[aria-label="Mute"]');
 assert.equal(await b.evaluate(()=>window.__stageFeed.volume),0);
 await b.click('[data-stage-video] button[aria-label="Unmute"]');
 await b.waitForFunction(()=>window.__stageFeed.volume===1);
 assert(await b.$('[data-stage-video] input[aria-label="Volume"]'));assert(await b.$('[data-stage-video] button[aria-label="Full screen"]'));
 await b.click('[data-stage-video] button[aria-label="Full screen"]');
 await b.waitForFunction(()=>document.fullscreenElement?.contains(document.querySelector('[data-stage-overlay]')),{timeout:10000*scale});
 await b.evaluate(()=>document.exitFullscreen());await b.waitForFunction(()=>!document.fullscreenElement);
 const controls=await b.$$eval('[data-stage-root] button',bs=>bs.map(x=>({name:(x.getAttribute('aria-label')||x.textContent).trim(),h:Math.round(x.getBoundingClientRect().height)})));
 for(const c of controls){assert(c.name);assert(c.h>=44,`"${c.name}" is ${c.h}px tall`);}
 // His token: for chat-main, watch only, in his name; sent to the address the server named.
 {const connects=await b.evaluate(()=>window.__stageFeed.connects);assert.equal(connects.length,1,'one connection');
  assert.equal(connects[0].url,'ws://127.0.0.1:54633');
  const claims=JSON.parse(Buffer.from(connects[0].token.split('.')[1],'base64url').toString('utf8'));
  assert.deepEqual(claims.video,{room:'chat-main',roomJoin:true,canSubscribe:true,canPublish:false,canPublishData:false,canUpdateOwnMetadata:false});
  assert.match(claims.sub,/^[0-9a-f-]{36}#[0-9a-f]{8}$/);assert(claims.name);assert(claims.exp-Math.floor(Date.now()/1000)<=600);}
 // The room's real chat, from the stage.
 assert(await b.evaluate(()=>[...document.querySelectorAll('[data-stage-root] ~ section article[id^="chat-message-"]')].some(x=>x.textContent.includes('Morning all.'))));
 await send(b,'Watching from the stage.');
 assert(await saved(b,'Watching from the stage.'),'a message from the stage is a real room message');
 if(shots)await b.screenshot({path:`${shots}/member-stage.png`});
 // A 1280px laptop keeps the two columns; narrower stacks video over chat.
 await b.setViewport({width:1280,height:800});await sleep(300);
 {const l=await layout();assert.equal(l.stage.right+1,l.chat.x);assert.equal(l.chat.right,1280);assert(!l.sideways);}
 await b.setViewport({width:1000,height:800});await sleep(300);
 {const l=await layout();assert(l.stage.y<l.chat.y&&l.chat.x===0,`stacked: video, then chat: ${JSON.stringify(l)}`);assert(!l.sideways);}
 await b.setViewport({width:1440,height:900});await sleep(300);
 // Leaving and coming back by link while it is live.
 await b.click('[data-stage-exit]');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-root]'));
 assert.equal(new URL(b.url()).searchParams.get('stage'),null);
 assert(await visible(b,'[data-stage-watch-live]'),'back in the room, the LIVE button is still there');
 assert.equal(await b.evaluate(()=>window.__stageFeed.closed),1,'leaving the stage closes the connection');
 assert.equal(await openRoom(bob,'/chat?room=main&stage=1'),'live');
 await b.waitForSelector('[data-stage-root]',{timeout:60000*scale});
 await waitPlayer(b,'live');
 // The stream key never reached the member.
 {const refused=await b.evaluate(async()=>{const out=[];for(const init of [undefined,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'main',action:'start'})},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'main',action:'end'})}]){const r=await fetch('/api/chat/stage/live?room=main',init);out.push([r.status,await r.text()]);}return out;});
  for(const [status,text] of refused){assert.equal(status,403);assert.equal(text,'{"error":"admin_only"}');}
  assert(lk.ingresses.has('chat-main'),'a member cannot end it');}
 console.log('PASS live: LIVE button, the member\'s stage (video and chat, no samples), watch-only token, chat, link');

 // The admin ends it.
 await a.evaluate(()=>document.querySelector('[data-stage-end]').scrollIntoView({block:'center'}));
 await a.click('[data-stage-end]');
 await a.waitForSelector('[data-stage-end-confirm]');
 assert(lk.ingresses.has('chat-main'),'the first click only asks');
 await a.click('[data-stage-end-confirm]');
 await a.waitForFunction(()=>document.querySelector('[data-stage-broadcast]').dataset.stageBroadcast==='off',{timeout:30000*scale});
 assert.equal(lk.ingresses.size,0,'the ingress is deleted');assert.deepEqual(lk.deletedRooms,['chat-main'],'the LiveKit room is closed');
 assert.equal(await a.$('[data-stage-key]'),null,'the key is gone from the admin\'s page');
 await waitPlayer(a,'ended');
 await waitPlayer(b,'ended');
 assert.match(await b.$eval('[data-stage-video-message]',e=>e.textContent),/The broadcast has ended/);
 await b.waitForFunction(()=>!document.querySelector('[data-stage-live]'),{timeout:20000*scale});
 await b.click('[data-stage-exit]');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-root]'));
 await b.waitForFunction(()=>!document.querySelector('[data-stage-watch-live]'),{timeout:20000*scale});
 await sleep(4200);
 assert.equal(await openRoom(bob,'/chat?room=main&stage=1'),'off');
 await sleep(800);
 assert.equal(await b.$('[data-stage-root]'),null,'after the end, the stage link is just the room again');
 assert.equal(await b.$('[data-stage-watch-live]'),null);
 for(const page of [alice,bob])assert.deepEqual(page.errors,[]);
 for(const answer of bob.everyAnswer){assert(!answer.includes(FAKE_KEY),'no answer to the member carries the stream key');assert(!answer.includes(FAKE_ADDRESS),'nor the stream address');}
 assert(alice.everyAnswer.some(x=>x.includes(FAKE_KEY)),'(the admin\'s answers do carry it)');
 console.log('PASS end: the ingress and room are deleted, viewers see "The broadcast has ended", the member\'s room is as before');
}finally{await browser.close();stub.close();}
