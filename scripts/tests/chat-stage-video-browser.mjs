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
// #503, telling the room it is live (same stand-ins; no phone notification is really sent):
//  - pressing Start posts nothing; when the broadcast arrives the room gets one "LB is live now"
//    message with a "Watch live" link, Bob gets one bell entry ("LB – Live
//    Video") and one queued phone notification; Alice (whose player reported it) and Mallory (not in
//    LB) get nothing; repeated and simultaneous LiveKit webhooks add nothing;
//  - "Watch live" in the message opens the stage in place; the bell entry opens it too; on a phone
//    the message reads "Watch on a computer for now." with no link;
//  - Alice ends it: the same message says the live video has ended and Bob's bell entry is gone;
//  - a later broadcast (reported by a webhook alone) is announced again, to Bob and Alice, not to
//    someone who muted LB or to a bot; a drop and return inside 10 minutes tells nobody again.
// #504: the player is sized around a true 16:9 picture, never wider than 1280px and never taller
// than the window (member and admin, 1280 to 2560 wide and a short 1440x700 window), with the blocks
// under it the same width; the notice's sender is shown as "Live Video" (initials LV), live and ended.
// CHAT_SHOT_DIR also saves member-<width>x<height>.png and admin-<width>x<height>.png for those sizes.
// CHAT_SHOT_DIR saves member-room-live.png, member-stage.png, admin-start.png, admin-stage-live.png,
// and room-message-live.png, bell.png, phone-room-message.png, room-message-ended.png.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {AccessToken} from 'livekit-server-sdk';
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
const lk={ingresses:new Map(),publishing:false,calls:[],deletedRooms:[],startedAt:Date.now()-20*60000};
// `started_at`: when this broadcast began, in nanoseconds, as LiveKit reports it (#503 names the notice by it).
const info=(room,i)=>({ingress_id:i.id,name:room,stream_key:FAKE_KEY,url:FAKE_ADDRESS,input_type:'RTMP_INPUT',room_name:room,participant_identity:'stage-broadcast',reusable:true,state:{status:lk.publishing?'ENDPOINT_PUBLISHING':'ENDPOINT_INACTIVE',room_id:'RM_fake',...(lk.publishing?{started_at:String(BigInt(lk.startedAt)*1000000n)}:{})}});
// #503: a LiveKit webhook, signed with the manifest's made-up key and secret as LiveKit signs its own.
const WEBHOOK_KEY='APIsyntheticNeverReal',WEBHOOK_SECRET='synthetic-livekit-secret-never-a-production-secret';
let webhookNumber=0;
const webhook=async(event,identity,id=`EV_test_${++webhookNumber}`)=>{const body=JSON.stringify({event,id,room:{name:'chat-main'},...(identity?{participant:{identity}}:{})}),signer=new AccessToken(WEBHOOK_KEY,WEBHOOK_SECRET);
 signer.sha256=createHash('sha256').update(body).digest('base64');
 const r=await fetch(base+'/api/chat/stage/livekit-webhook',{method:'POST',headers:{'content-type':'application/webhook+json',authorization:await signer.toJwt()},body});assert.equal(r.status,200,`webhook ${event}`);};
const ALICE='00000000-0000-4000-8000-000000000001',BOB='00000000-0000-4000-8000-000000000002',MALLORY='00000000-0000-4000-8000-000000000003',BOT='00000000-0000-4000-8000-000000000099';
const LIVE_TEXT='🔴 LB is live now. Watch live: https://chat.robbooker.com/chat?room=main&stage=1',ENDED_TEXT='The live video in LB has ended.';
const notices=()=>sql("select id,body,edited_at from longboard_chat_messages where room_slug='main' and bot_slug='longboard' order by created_at,unread_seq");
const alerted=async id=>(await sql('select account_id from chat_room_mentions where message_id=$1 order by account_id',[id])).map(r=>r.account_id);
const until=async(check,what,ms=30000)=>{for(let waited=0;;waited+=200){const value=await check();if(value)return value;assert(waited<ms*scale,`timed out: ${what}`);await sleep(200);}};
const bell='button[aria-label^="Chat notifications,"]',bellPanel='section[aria-label="Chat notifications"]';
const noticeText=page=>page.evaluate(()=>[...document.querySelectorAll('article[id^="chat-message-"]')].filter(a=>a.checkVisibility()&&/Live Video/.test(a.textContent)).map(a=>a.querySelector('[class*="bodyBlock"]')?.innerText.replace(/\s+/g,' ').trim()));
// #504: who the notice is shown as sent by: the name line and the initials tile of each notice in view.
const noticeSender=page=>page.evaluate(()=>[...document.querySelectorAll('article[id^="chat-message-"]')].filter(a=>a.checkVisibility()&&a.querySelector('[data-stage-notice]')).map(a=>({name:a.querySelector('[class*="_messageIdentity__"]')?.innerText.replace(/\s+/g,' ').trim()??'',tile:a.querySelector('[data-avatar="initials"]')?.textContent.trim()??'',old:/Longboard Bot/.test(a.innerText)})));
// #504: the player at one window size. The picture's box is 16:9 to the pixel, at most 1280px wide,
// inside its column; the whole player is on screen; every block under it is the same width, centred.
const STAGE_SIZES=[[1280,800],[1440,900],[1920,1080],[2560,1440],[1440,700]];
const playerSize=async(page,who,[width,height])=>{
 await page.setViewport({width,height});await sleep(300);
 const m=await page.evaluate(()=>{const r=e=>{const b=e.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height,right:b.right,bottom:b.bottom};},column=document.querySelector('[data-stage-column="stage"]');column.scrollTo(0,0);
  const feed=document.querySelector('[data-stage-video-feed]');
  return {area:r(document.querySelector('[data-stage-video-area]')),player:r(document.querySelector('[data-stage-video]')),column:r(column),feed:feed&&!feed.hidden?{...r(feed),fit:getComputedStyle(feed).objectFit}:null,
   blocks:[...column.children].filter(e=>!e.matches('[data-stage-video]')&&e.checkVisibility()).map(r),sideways:document.documentElement.scrollWidth>window.innerWidth,height:window.innerHeight};});
 if(shots)await page.screenshot({path:`${shots}/${who}-${width}x${height}.png`});
 const at=`${who} ${width}x${height}: ${JSON.stringify(m)}`;
 assert(Math.abs(m.area.w-m.area.h*16/9)<=2,`the picture's box is 16:9: ${at}`);
 assert(m.area.w<=1280.5,`the picture is never wider than 1280px: ${at}`);
 assert(m.area.w>=480,`and never tiny: ${at}`);
 assert(m.player.x>=m.column.x&&m.player.right<=m.column.right+0.5,`the player is inside its column: ${at}`);
 assert(m.player.bottom<=m.height+0.5,`the whole player is on screen: ${at}`);
 assert(Math.abs(m.player.w-m.area.w-4)<=1,`the player is its picture plus the border, no wider: ${at}`);
 if(m.feed){assert.equal(m.feed.fit,'contain');assert(Math.abs(m.feed.w-m.area.w)<=1&&Math.abs(m.feed.h-m.area.h)<=1,`the picture fills its box, no bars: ${at}`);}
 for(const block of m.blocks){assert(Math.abs(block.w-m.player.w-12)<=1,`a block under the player is as wide as the player and its glow: ${at}`);assert(Math.abs(block.x-(m.player.x-6))<=1,`and lines up with it: ${at}`);}
 assert(!m.sideways,`no sideways scroll: ${at}`);
 return m;};
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
 // #507: the status also reads the room's metadata (the stock on screen); this test sets none.
 if(call==='RoomService/ListRooms')return send({rooms:[]});
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
// #503: one phone of Bob's (a made-up endpoint; nothing is sent, the test has no push keys).
await sql("insert into chat_push_subscriptions(account_id,endpoint,p256dh,auth) values($1,'https://fcm.googleapis.com/fcm/send/synthetic-bob','k','a')",[BOB]);
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
  if(answer){
   // The room is ready, or (a stage link while it is live) the stage has already taken the room header's place.
   await Promise.any([ready(page),page.waitForSelector('[data-stage-root]',{timeout:60000*scale})]);await sleep(300);return JSON.parse(answer.slice(answer.indexOf('{'))).state;}
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
 // #503: pressing Start tells nobody anything.
 await sleep(1500);
 assert.deepEqual(await notices(),[],'Start alone posts no message');
 assert.deepEqual(await sql("select 1 from chat_room_mentions n join longboard_chat_messages m on m.id=n.message_id where m.bot_slug='longboard'"),[],'and no bell entry');
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
 assert(await a.$('[data-stage-column="trades"]'));assert(await a.$('[data-stage-chapter]'));
 assert.equal(await a.$eval('[data-stage-overlay]',e=>e.childElementCount),0,'#507: nothing sits on top of the picture, for an admin either');
 assert.match(await a.$eval('[data-stage-column="trades"]',e=>e.textContent),/Trade tape · sample.*Question queue · sample/s);
 if(shots){await a.evaluate(()=>document.querySelector('[data-stage-column="stage"]').scrollTo(0,0));await a.waitForFunction(()=>document.querySelector('[data-stage-video-feed]').videoWidth>0);await a.screenshot({path:`${shots}/admin-stage-live.png`});}
 // #504: the admin's three columns: the same widescreen player, in a narrower column.
 await a.waitForFunction(()=>document.querySelector('[data-stage-video-feed]').videoWidth>0);
 for(const size of STAGE_SIZES)await playerSize(a,'admin',size);
 await a.setViewport({width:1440,height:900});await sleep(300);

 // #503: the room is told, once. Alice's player reported the broadcast; LiveKit's webhooks then
 // arrive too: one of them twice (a retry) and five more at the same moment.
 const b=bob.page;
 const [notice]=await until(async()=>{const rows=await notices();return rows.length?rows:null;},'the live message');
 assert.equal(notice.body,LIVE_TEXT);
 await until(async()=>(await alerted(notice.id)).length,'the bell entries');
 await webhook('ingress_started',null,'EV_retry');await webhook('ingress_started',null,'EV_retry');
 await Promise.all([webhook('room_started'),webhook('track_published','stage-broadcast'),webhook('track_published','stage-broadcast'),webhook('ingress_started'),webhook('participant_joined','stage-broadcast')]);
 await sleep(2500);
 assert.deepEqual((await notices()).map(n=>n.body),[LIVE_TEXT],'one message, however many times the broadcast is reported');
 assert.deepEqual(await alerted(notice.id),[BOB],'Bob is told once; not Alice (her player reported it), not Mallory (not in LB)');
 assert.deepEqual(await sql("select j.kind,s.account_id from chat_push_jobs j join chat_push_subscriptions s on s.id=j.subscription_id"),[{kind:'room',account_id:BOB}],'one phone notification queued, for Bob');
 assert.equal((await sql("select public.chat_push_target('room',(select id from chat_room_mentions where message_id=$1),$2) t",[notice.id,BOB]))[0].t,`/chat?room=main&thread=${notice.id}`,'the address the phone notification is recognised by');
 // The member: the message, the bell, the LIVE button, then the stage.
 await sleep(1700); // the server's few seconds' memory of "waiting"
 assert.equal(await openRoom(bob),'live');
 await b.waitForSelector('[data-stage-notice]',{visible:true,timeout:30000*scale});
 assert.deepEqual(await noticeText(b),['🔴 LB is live now. Watch live']);
 // #504: sent by "Live Video" (tile LV), not "Longboard Bot".
 {const [sender,...more]=await noticeSender(b);assert.equal(more.length,0);assert.match(sender.name,/^Live Video\b/,JSON.stringify(sender));assert.equal(sender.tile,'LV');assert.equal(sender.old,false,'no "Longboard Bot" on the notice');}
 assert.equal(await b.$eval('[data-stage-notice-watch]',a=>a.getAttribute('href')),'/chat?room=main&stage=1');
 assert.equal(await b.$eval('[data-stage-notice] span[class*="stagePhoneHint"]',e=>e.checkVisibility()),false,'no phone line on a computer');
 if(shots)await b.screenshot({path:`${shots}/room-message-live.png`});
 await (await shown(b,bell)).click();
 await b.waitForSelector(`${bellPanel} [data-stage-notice-alert="main"]`,{visible:true,timeout:30000*scale});
 assert.equal(await b.$eval(`${bellPanel} [data-stage-notice-alert] strong`,e=>e.textContent),'LB – Live Video');
 assert(!(await b.$eval(bellPanel,e=>e.innerText)).includes('Longboard Bot'),'the bell never names Longboard Bot for it');
 assert.equal(await b.$eval(`${bellPanel} [data-stage-notice-alert] [class*="preview"]`,e=>e.textContent),'LB is live now. Watch live');
 assert.equal(await b.$$eval(`${bellPanel} article`,a=>a.length),1,'one bell entry');
 if(shots)await b.screenshot({path:`${shots}/bell.png`});
 // The bell entry opens the stage.
 await b.click(`${bellPanel} [data-stage-notice-alert] button`);
 await b.waitForSelector('[data-stage-root]',{timeout:60000*scale});
 await waitPlayer(b,'live');
 assert.equal(new URL(b.url()).searchParams.get('stage'),'1');
 // A phone: the same message, with a line instead of the link (there is no stage on a phone yet).
 {const phone=await newPage();await phone.page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await signIn(phone.page,base,'bob@example.test',{composer:LB,next:'/chat?room=main'});
  await phone.page.waitForSelector('[data-stage-notice]',{visible:true,timeout:60000*scale});
  assert.deepEqual(await noticeText(phone.page),['🔴 LB is live now. Watch on a computer for now.']);
  assert.equal(await phone.page.$eval('[data-stage-notice-watch]',a=>a.checkVisibility()),false,'no Watch live link on a phone');
  assert.equal(await phone.page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  await sleep(600);
  if(shots)await phone.page.screenshot({path:`${shots}/phone-room-message.png`});
  assert.deepEqual(phone.errors,[]);await phone.context.close();}
 console.log('PASS told once: one room message, one bell entry and one queued phone notification for the member; the bell entry opens the stage; a phone reads sensibly');
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
 // #504: a normal widescreen player at every size, the blocks under it the same width.
 {const sizes={};for(const size of STAGE_SIZES)sizes[size.join('x')]=await playerSize(b,'member',size);
  assert.equal(Math.round(sizes['2560x1440'].area.w),1280,'a big window: the picture stops at 1280px');
  assert.equal(Math.round(sizes['1920x1080'].area.w),1280);
  assert(sizes['1440x700'].area.w<sizes['1440x900'].area.w,'a short window: the picture is smaller, so the player still fits');
  assert(sizes['1920x1080'].blocks.length>=1,'the stock panel is under the player');}
 await b.setViewport({width:1440,height:900});await sleep(300);
 // Leaving and coming back by link while it is live.
 await b.click('[data-stage-exit]');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-root]'));
 assert.equal(new URL(b.url()).searchParams.get('stage'),null);
 assert(await visible(b,'[data-stage-watch-live]'),'back in the room, the LIVE button is still there');
 assert.equal(await b.evaluate(()=>window.__stageFeed.closed),1,'leaving the stage closes the connection');
 // #503: "Watch live" in the room message opens the stage where the member is, without loading the page again.
 await b.evaluate(()=>{window.__samePage=true;});
 await (await shown(b,'[data-stage-notice-watch]')).click();
 await b.waitForSelector('[data-stage-root]',{timeout:60000*scale});
 await waitPlayer(b,'live');
 assert.equal(await b.evaluate(()=>window.__samePage),true,'opened in place');
 assert.equal(new URL(b.url()).searchParams.get('stage'),'1');
 await b.click('[data-stage-exit]');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-root]'));
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
 // #503: the same message now says it ended, and the bell entry is gone with it.
 assert.deepEqual((await notices()).map(n=>n.body),[ENDED_TEXT]);
 assert.deepEqual(await alerted(notice.id),[],'the alert is taken back when the broadcast ends');
 assert.deepEqual(await noticeText(b),[ENDED_TEXT]);
 assert(await b.evaluate(text=>[...document.querySelectorAll('article[id^="chat-message-"]')].some(a=>a.checkVisibility()&&a.innerText.includes(text)&&/Live Video/.test(a.innerText)&&!/Longboard Bot/.test(a.innerText)),ENDED_TEXT),'the ended message is from "Live Video" too');
 assert.equal(await b.$('[data-stage-notice-watch]'),null,'no Watch live link once it has ended');
 assert.deepEqual(await b.evaluate(async id=>((await (await fetch('/api/chat/activity?fresh='+Date.now(),{cache:'no-store'})).json()).mentions??[]).filter(m=>m.messageId===id),notice.id),[],'Bob\'s bell no longer lists it');
 if(shots)await b.screenshot({path:`${shots}/room-message-ended.png`});
 for(const page of [alice,bob])assert.deepEqual(page.errors,[]);
 for(const answer of bob.everyAnswer){assert(!answer.includes(FAKE_KEY),'no answer to the member carries the stream key');assert(!answer.includes(FAKE_ADDRESS),'nor the stream address');}
 assert(alice.everyAnswer.some(x=>x.includes(FAKE_KEY)),'(the admin\'s answers do carry it)');
 console.log('PASS end: the ingress and room are deleted, viewers see "The broadcast has ended", the member\'s room is as before');

 // #503: a later broadcast, reported by LiveKit's webhook alone (no admin's page involved).
 // Mallory joins LB but has muted it; a bot account can read LB; neither is told.
 await sql("insert into user_tags(user_id,tag) values($1,'boardroom-cohort-1')",[MALLORY]);
 await sql("insert into chat_room_notification_levels(account_id,room_slug,level) values($1,'main','muted')",[MALLORY]);
 await sql("insert into chat_bot_accounts(account_id,allowed_rooms) values($1,array['main'])",[BOT]);
 assert.deepEqual(await sql("select public.chat_account_room_recipient_eligible($1,'main') a,public.chat_account_room_recipient_eligible($2,'main') b",[MALLORY,BOT]),[{a:true,b:true}],'both can read LB now');
 // The first broadcast ended 11 minutes ago.
 await sql("update longboard_chat_messages set edited_at=now()-interval '11 minutes' where id=$1",[notice.id]);
 lk.ingresses.set('chat-main',{id:'IN_fake_later'});lk.publishing=true;lk.startedAt=Date.now()-3000;
 await Promise.all([webhook('ingress_started'),webhook('track_published','stage-broadcast'),webhook('room_started')]);
 const second=await until(async()=>(await notices())[1],'the second broadcast\'s message');
 await until(async()=>(await alerted(second.id)).length,'its bell entries');
 await sleep(1500);
 assert.deepEqual((await notices()).map(n=>n.body),[ENDED_TEXT,LIVE_TEXT],'a new broadcast gets its own message');
 assert.deepEqual(await alerted(second.id),[ALICE,BOB],'everyone in LB is told (no admin started this one), except the muted member and the bot');
 assert.equal((await sql("select count(*)::int n from chat_push_jobs j join chat_push_subscriptions s on s.id=j.subscription_id where s.account_id=$1",[BOB]))[0].n,2,'Bob\'s phone: one notification per broadcast');
 // StreamYard drops; LiveKit says so. After the few seconds' grace the message says it ended...
 lk.publishing=false;
 await webhook('participant_left','stage-broadcast');
 await sleep(3000);
 assert.equal((await notices())[1].body,LIVE_TEXT,'a drop is not the end straight away');
 await until(async()=>(await notices())[1].body===ENDED_TEXT,'the message says it ended after the grace',40000);
 assert.deepEqual(await alerted(second.id),[]);
 // ...and it comes back a moment later: the same message says live again, and nobody is told twice.
 lk.publishing=true;lk.startedAt=Date.now();
 await Promise.all([webhook('ingress_started'),webhook('track_published','stage-broadcast')]);
 await until(async()=>(await notices())[1].body===LIVE_TEXT,'the message says live again');
 await sleep(1500);
 assert.equal((await notices()).length,2,'no third message for a reconnect');
 assert.deepEqual(await alerted(second.id),[],'no new bell entries for a reconnect');
 assert.equal((await sql('select count(*)::int n from chat_push_jobs'))[0].n,2,'and no new phone notification');
 // The ingress goes (an admin's End, as LiveKit reports it): ended at once.
 lk.ingresses.clear();lk.publishing=false;
 await webhook('ingress_ended');
 await until(async()=>(await notices())[1].body===ENDED_TEXT,'ended at once without an ingress',8000);
 console.log('PASS later broadcast: announced again by the webhook alone, not to a muted member or a bot; a drop and return inside 10 minutes tells nobody again');
}finally{await browser.close();stub.close();}
