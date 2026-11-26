// #502 Stage mode's live video, open to members (localhost:3503, database 127.0.0.1:54503).
// No real LiveKit is reached and no real key exists here:
//  - the server's LiveKit calls (list/create/delete ingress) go to this test's own
//    stand-in on 127.0.0.1:54633 (the manifest's `livekit` preset points LIVEKIT_URL at it);
//  - in the page, the player's connection is a stand-in too (stageFeed.ts lets a test supply one
//    outside a production build): it plays a drawn test picture while the stand-in is "publishing".
// Synthetic members, messages and alerts only. Alice is a chat admin, Bob a member.
//  - not started: Bob's room has no LIVE button and no "Go live" item, /chat?room=main&stage=1 is
//    just the room, and he downloads no stage code;
//  - #512, Alice opens the stage: the "Live video" card shows the room's stream address and the
//    stream key (masked until "Show") straight away, with no Start and no End button; the room's
//    ingress is made that first time only; leaving and coming back, and a reload, show the same key;
//    while nothing is broadcasting her player says "Waiting for the broadcast to start" and holds
//    NO connection (no token asked for, none given if she asks); Bob still sees no LIVE button;
//  - #512, Reset key: a confirmation in the card (never a browser dialog) says the old key stops
//    working at once, a broadcast using it is cut off and the new key goes into StreamYard; "Keep
//    this key" changes nothing; confirming shows a different key, which is then the room's;
//  - the broadcast starts (LiveKit's webhook, and the room's signal): Alice's player connects and is
//    live, the top bar counts who is watching; Bob's room
//    (re-opened) shows the red LIVE / "Watch live" button; it opens his stage: two columns (video,
//    room chat), the player live with a real <video>, "Tap for sound", working pause and mute, and
//    NO sample trades, questions, chapters, host line, overlay card or broadcast card (#508: he
//    does have Raise hand, which is real: chat-stage-hand-browser.mjs);
//    his token is watch-only for chat-main; he can chat from the stage; his stage link opens it;
//  - with no rows on today's Gainers Table a member has no stock panel (no sample row); once a stock
//    alerts, the panel shows that real row;
//  - Bob is never sent the stream key (no answer his page received contains it; the admin API
//    refuses him);
//  - #511/#512: the broadcast stops (StreamYard stops; there is no End): Bob's player rides out the
//    grace, then closes its connection and says the broadcast has ended, and so does Alice's (an
//    admin waits connected no longer than a member); nothing connects while the room is only
//    waiting; live again, both are reconnected, Bob with a fresh token;
//  - #512, it stops again, and this time LiveKit's webhook is lost and no admin is watching: Bob's
//    player still lets go, the LIVE button goes, the stage link is just the room again, and the
//    room's message says it ended, all from the status noticing; the ingress and its key are untouched.
// #503, telling the room it is live (same stand-ins; no phone notification is really sent):
//  - a room having its key posts nothing; when the broadcast arrives the room gets one "LB is live
//    now" message with a "Watch live" link, Bob and Alice get one bell entry each ("LB – Live
//    Video") and Bob one queued phone notification; Mallory (not in LB) gets nothing; repeated and
//    simultaneous LiveKit webhooks add nothing;
//  - "Watch live" in the message and the bell entry open the stage (#505: in a tab of its own, see
//    below); a phone has the same button and a LIVE pill in its header (#509: they open its
//    viewing room in place, which is chat-stage-phone-browser.mjs);
//  - it stops: the same message says the live video has ended and the bell entries are gone;
//  - a later broadcast on the same key is announced again, to Bob and Alice, not to someone who
//    muted LB or to a bot; a drop and return inside 10 minutes tells nobody again; Alice's player
//    connects for it, lets go when it stops and connects again when it is back;
//  - #512: Reset key during a broadcast cuts it off: the message says it ended.
// #505, Watch live opens in its own tab (same stand-ins):
//  - the bell entry, the header's LIVE button and the room message's Watch live all open the stage
//    in a new tab named for the room; Bob's own tab keeps its address, room and scroll position and
//    is not loaded again; a second press brings the same tab forward without loading it again, and
//    after "Back to the room" in that tab a press puts the stage back in it; an admin's opens a tab too;
//  - Dual, Quad and Six view: the card of the room that is live has the LIVE button, the other cards
//    have none, the page asks the status once for all its cards, and the button opens the stage tab
//    while the view stays as it was; a pop-out window of the room has the button as well;
//  - /chat?room=main&stage=1 opened directly is the stage in that tab, as before.
// #504: the player is sized around a true 16:9 picture, never wider than 1280px and never taller
// than the window (member and admin, 1280 to 2560 wide and a short 1440x700 window), with the blocks
// under it the same width; the notice's sender is shown as "Live Video" (initials LV), live and ended.
// CHAT_SHOT_DIR also saves member-<width>x<height>.png and admin-<width>x<height>.png for those sizes.
// CHAT_SHOT_DIR saves stage-new-tab.png, quad-live-button.png, six-live-button.png, dual-live-button.png,
// member-room-live.png, member-stage.png, admin-panel.png, admin-reset-confirm.png, admin-stage-live.png,
// and room-message-live.png, bell.png, phone-room-message.png, room-message-ended.png.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {AccessToken} from 'livekit-server-sdk';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
import {LOOKS,checkStageLooks} from './stage-theme-checks.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3503',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54503',STUB='http://127.0.0.1:54633';
for(const url of [base,fixture,STUB])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,scale=Number(process.env.CHAT_TIMING_SCALE||1);
const FAKE_KEY='FAKE-STREAM-KEY-for-tests-only',FAKE_KEY_2='FAKE-STREAM-KEY-for-tests-only-2',FAKE_KEY_3='FAKE-STREAM-KEY-for-tests-only-3',FAKE_ADDRESS='rtmps://fake-livekit.example.test/x';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// One stock on today's Gainers Table (the manifest's fake Polygon prices it), for the stock panel.
const alert=(sym,secondsAgo,vol)=>sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[1,new Date(Date.now()-secondsAgo*1000).toISOString(),`🚨 ${sym} (+41.0%)\nPrice: $2.50\nVolume: ${vol.toLocaleString('en-US')}\nMarket Cap: 12.5M`]);

// The stand-in LiveKit: Twirp over JSON, as livekit-server-sdk speaks it. One ingress per room; each
// one made has its own (made-up) key: FAKE_KEY, then FAKE_KEY_2, FAKE_KEY_3.
const lk={ingresses:new Map(),made:0,publishing:false,calls:[],deletedRooms:[],startedAt:Date.now()-20*60000};
const count=call=>lk.calls.filter(c=>c===call).length;
// `started_at`: when this broadcast began, in nanoseconds, as LiveKit reports it (#503 names the notice by it).
const info=(room,i)=>({ingress_id:i.id,name:room,stream_key:i.key,url:FAKE_ADDRESS,input_type:'RTMP_INPUT',room_name:room,participant_identity:'stage-broadcast',reusable:true,state:{status:lk.publishing?'ENDPOINT_PUBLISHING':'ENDPOINT_INACTIVE',room_id:'RM_fake',...(lk.publishing?{started_at:String(BigInt(lk.startedAt)*1000000n)}:{})}});
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
 if(req.url==='/test/state')return send({publishing:lk.ingresses.size>0&&lk.publishing});
 const call=req.url.replace('/twirp/livekit.','');lk.calls.push(call);
 assert.match(req.headers.authorization??'',/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,'the server signs its LiveKit calls');
 const room=body.room_name??body.roomName??body.room;
 if(call==='Ingress/ListIngress')return send({items:[...lk.ingresses].filter(([name])=>!room||name===room).map(([name,i])=>info(name,i))});
 if(call==='Ingress/CreateIngress'){assert.equal(body.participant_identity??body.participantIdentity,'stage-broadcast');const n=++lk.made,i={id:`IN_fake${n}`,key:n===1?FAKE_KEY:`${FAKE_KEY}-${n}`};lk.ingresses.set(room,i);return send(info(room,i));}
 if(call==='Ingress/DeleteIngress'){const id=body.ingress_id??body.ingressId;for(const [name,i] of lk.ingresses)if(i.id===id){lk.ingresses.delete(name);lk.publishing=false;/* its broadcast is cut off */return send(info(name,i));}return send({code:'not_found',msg:'no such ingress'},404);}
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
// This test runs without Ably: the room's "stage" signal (what LiveKit's webhook makes the server
// send) is given to a page by hand, exactly as components/chat/hooks/useAblyRoomEvents.ts does.
const signal=page=>page.evaluate(()=>{window.dispatchEvent(new CustomEvent('chat-stage-event',{detail:{room:'main'}}));});
const feedOf=page=>page.evaluate(()=>({connects:window.__stageFeed.connects.length,closed:window.__stageFeed.closed}));
const keyShown=page=>page.$eval('[data-stage-key]',i=>i.value);
const playerState=page=>page.$eval('[data-stage-video]',e=>e.dataset.stageVideoState);
const waitPlayer=(page,state)=>page.waitForFunction(s=>document.querySelector('[data-stage-video]')?.dataset.stageVideoState===s,{timeout:30000*scale},state);
const newPage=async()=>{const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],stageAnswers=[];
 page.on('pageerror',e=>errors.push(e.message));
 // #512: nothing here may ask through a browser dialog (confirm/alert/prompt).
 page.on('dialog',d=>{errors.push(`a browser dialog opened: ${d.message()}`);void d.dismiss().catch(()=>{});});
 const everyAnswer=[];
 page.on('response',async r=>{if(!r.url().includes('/api/chat/stage/'))return;const line=`${r.status()} ${r.url().replace(base,'')} ${await r.text().catch(()=>'')}`;stageAnswers.push(line);everyAnswer.push(line);});
 await page.setViewport({width:1440,height:900});await page.evaluateOnNewDocument(fakeFeed,STUB);return {context,page,errors,stageAnswers,everyAnswer};};
// #505: the tabs of one browser context, and the stage tab a press opens (or already has open).
const stageTabs=async who=>(await who.context.pages()).filter(p=>/[?&]stage=1/.test(p.url())&&p!==who.page);
// Presses `press` and returns the one new tab it opened, with the stand-in player put in it (the
// tab is loaded once more for that: a new tab's first load cannot be reached by a test in time).
const opensStageTab=async(who,press)=>{const before=new Set(await who.context.pages());await press();
 const tab=await until(async()=>(await who.context.pages()).find(p=>!before.has(p)&&/[?&]room=main&stage=1/.test(p.url())),'a new tab with the stage address');
 assert.equal((await who.context.pages()).length,before.size+1,'one new tab');
 await tab.setViewport({width:1440,height:900});await tab.evaluateOnNewDocument(fakeFeed,STUB);
 await tab.waitForFunction(()=>document.readyState==='complete'&&/stage=1/.test(location.search),{timeout:60000*scale});await tab.reload();
 const errors=[];tab.on('pageerror',e=>errors.push(e.message));
 await tab.waitForSelector('[data-stage-root="main"]',{timeout:60000*scale});return {tab,errors};};
// What must not change in the tab the member pressed Watch live in.
const mark=page=>page.evaluate(()=>{window.__samePage=true;});
const where=page=>page.evaluate(()=>{const list=[...document.querySelectorAll('article[id^="chat-message-"]')].find(a=>a.checkVisibility());let scroller=list?.parentElement;
 while(scroller&&!(scroller.scrollHeight>scroller.clientHeight+4&&/auto|scroll/.test(getComputedStyle(scroller).overflowY)))scroller=scroller.parentElement;
 return {url:location.href,room:[...document.querySelectorAll('main[data-chat-view]')].find(e=>e.checkVisibility())?.dataset.room??null,samePage:window.__samePage===true,stage:!!document.querySelector('[data-stage-root]'),scroll:scroller?Math.round(scroller.scrollTop):null,composer:!!document.querySelector('textarea[aria-label="Message LB"]')};});
// Waits until the room on screen has stopped moving: its place the same for a second and a half.
const settled=async page=>{let last,same=0;for(const began=Date.now();same<3;){const now=(await where(page)).scroll;same=now===last?same+1:0;last=now;assert(Date.now()-began<30000*scale,'the room never settled');await sleep(500);}};
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

 // #512: the admin opens the stage. The room's address and key are there straight away.
 const a=alice.page;
 await signIn(a,base,'alice@example.test',{composer:LB,next:'/chat?room=main'});
 assert((await openMenu(a)).includes('Go live (preview)'));
 assert.deepEqual(lk.calls.filter(c=>c!=='Ingress/ListIngress'&&c!=='RoomService/ListRooms'),[],'nothing is made for a room nobody has opened the stage of');
 await a.click('[data-stage-go-live]');
 // On a machine with no time to spare the press can land while the menu is still opening and do
 // nothing (once in 20 soak runs, under heavy load): if the stage has not appeared, it is pressed again.
 for(let tries=0;!(await a.waitForSelector('[data-stage-root]',{timeout:15000*scale}).catch(()=>null));tries++){assert(tries<3,'Go live never opened the stage');
  if(!(await visible(a,'[data-stage-go-live]')))await openMenu(a);await (await shown(a,'[data-stage-go-live]')).click();}
 await a.waitForSelector('[data-stage-broadcast]',{timeout:60000*scale});
 await a.waitForSelector('[data-stage-key]',{timeout:30000*scale});
 for(const gone of ['[data-stage-start]','[data-stage-end]','[data-stage-end-confirm]'])assert.equal(await a.$(gone),null,`no ${gone}`);
 {const text=await a.$eval('[data-stage-root]',r=>r.innerText);for(const words of ['Start live video','End live video','End for everyone'])assert(!text.includes(words),`the stage no longer says "${words}"`);}
 assert.equal(await a.$eval('[data-stage-address]',i=>i.value),FAKE_ADDRESS);
 assert.deepEqual(await a.$eval('[data-stage-key]',i=>[i.type,i.value,i.readOnly]),['password',FAKE_KEY,true],'the key is masked until shown');
 assert(!(await a.$eval('[data-stage-root]',r=>r.innerText)).includes(FAKE_KEY),'the key is not readable on the page while masked');
 assert.equal(await a.$eval('[data-stage-broadcast]',e=>e.dataset.stageBroadcast),'ready');
 assert.match(await a.$eval('[data-stage-broadcast]',e=>e.textContent),/Waiting for StreamYard/);
 assert.match(await a.$eval('[data-stage-broadcast]',e=>e.textContent),/stay the\s+same for this room/);
 for(const name of ['stream address','stream key'])assert(await a.$(`[data-stage-copy="${name}"]`),`a copy button for the ${name}`);
 assert.deepEqual([...lk.ingresses.keys()],['chat-main'],'the ingress is for the LiveKit room chat-main');
 await waitPlayer(a,'waiting');
 assert.match(await a.$eval('[data-stage-video-message]',e=>e.textContent),/Waiting for the broadcast to start/);
 assert.equal(await a.$('[data-stage-live]'),null,'the top bar does not say LIVE before the broadcast');
 // Waiting is not a reason to connect: no video element, no token asked for, no connection.
 const noConnection=async(who,why)=>{assert.equal(await who.page.$('[data-stage-root] video'),null,`no video element ${why}`);assert.equal((await feedOf(who.page)).connects,0,`no LiveKit connection ${why}`);
  assert(!who.stageAnswers.some(x=>x.includes('/api/chat/stage/token')),`no token asked for ${why}: ${who.stageAnswers.join(' | ')}`);};
 await sleep(1500);await noConnection(alice,'while the room is only waiting');
 {const refused=await a.evaluate(async()=>{const r=await fetch('/api/chat/stage/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'main'})});return [r.status,await r.text()];});
  assert.deepEqual(refused,[409,'{"error":"not_live","state":"waiting"}'],'an admin is given no watch token either while nothing is broadcasting');alice.stageAnswers.length=0;}
 if(shots){await a.evaluate(()=>document.querySelector('[data-stage-broadcast]').scrollIntoView({block:'center'}));await sleep(200);await a.screenshot({path:`${shots}/admin-panel.png`});}
 await a.click('[data-stage-key-reveal]');
 assert.equal(await a.$eval('[data-stage-key]',i=>i.type),'text','Show reveals the key');
 await a.click('[data-stage-key-reveal]');
 assert.equal(await a.$eval('[data-stage-key]',i=>i.type),'password');
 // Leaving and coming back, and a fresh load of the page: the same address and key, nothing made again.
 await a.click('[data-stage-exit]');await a.waitForFunction(()=>!document.querySelector('[data-stage-root]'));
 await openMenu(a);await a.click('[data-stage-go-live]');
 await a.waitForSelector('[data-stage-key]',{timeout:30000*scale});
 assert.equal(await keyShown(a),FAKE_KEY,'opening the stage again shows the same key');
 assert.equal(await openRoom(alice,'/chat?room=main&stage=1'),'waiting');
 await a.waitForSelector('[data-stage-key]',{timeout:60000*scale});
 assert.deepEqual([await a.$eval('[data-stage-address]',i=>i.value),await keyShown(a)],[FAKE_ADDRESS,FAKE_KEY],'and so does loading the page again');
 assert.deepEqual([count('Ingress/CreateIngress'),count('Ingress/DeleteIngress')],[1,0],'one ingress, made once, never replaced by opening the card');
 await waitPlayer(a,'waiting');await sleep(1000);await noConnection(alice,'after coming back');
 // Set up but not broadcasting: still nothing for a member.
 assert.equal(await openRoom(bob),'waiting');
 assert.equal(await bob.page.$('[data-stage-watch-live]'),null,'no LIVE button until the broadcast is on');
 {const refused=await bob.page.evaluate(async()=>{const r=await fetch('/api/chat/stage/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'main'})});return [r.status,await r.text()];});
  assert.equal(refused[0],409,'no watch token for a member before it is live');
  assert.equal(await bob.page.evaluate(()=>window.__stageFeed.connects.length),0,'and a member opens no connection while the room is only waiting');assert(!/token"/.test(refused[1]));}
 assert.equal(await openRoom(bob,'/chat?room=main&stage=1'),'waiting');
 await sleep(800);
 assert.equal(await bob.page.$('[data-stage-root]'),null,'a member\'s stage link is still just the room while nothing is broadcasting');
 // #503: a room having its key tells nobody anything.
 await sleep(1500);
 assert.deepEqual(await notices(),[],'the key alone posts no message');
 assert.deepEqual(await sql("select 1 from chat_room_mentions n join longboard_chat_messages m on m.id=n.message_id where m.bot_slug='longboard'"),[],'and no bell entry');
 console.log('PASS admin opens the stage: address and masked key at once, no Start or End, the same key every time, no connection while waiting; nothing for members');

 // #512: Reset key. The first click only asks, in the card.
 await a.evaluate(()=>document.querySelector('[data-stage-key-reset]').scrollIntoView({block:'center'}));
 await a.click('[data-stage-key-reset]');
 await a.waitForSelector('[data-stage-key-reset-confirm]');
 {const warning=await a.$eval('[data-stage-key-reset-warning]',e=>e.textContent.replace(/\s+/g,' '));
  for(const said of [/old key stops working immediately/,/any broadcast using it is cut off/,/new key must be pasted into StreamYard/])assert.match(warning,said);}
 assert.equal(count('Ingress/DeleteIngress'),0,'the first click only asks');assert.equal(await keyShown(a),FAKE_KEY);
 if(shots){await a.evaluate(()=>document.querySelector('[data-stage-broadcast]').scrollIntoView({block:'center'}));await sleep(200);await a.screenshot({path:`${shots}/admin-reset-confirm.png`});}
 await a.click('[data-stage-key-reset-cancel]');
 await a.waitForSelector('[data-stage-key-reset]');
 assert.equal(await a.$('[data-stage-key-reset-confirm]'),null);
 assert.deepEqual([await keyShown(a),count('Ingress/DeleteIngress'),count('Ingress/CreateIngress')],[FAKE_KEY,0,1],'"Keep this key" changes nothing');
 await a.click('[data-stage-key-reveal]'); // shown, to see that a new key comes back masked
 await a.click('[data-stage-key-reset]');
 await a.waitForSelector('[data-stage-key-reset-confirm]');
 await a.click('[data-stage-key-reset-confirm]');
 await a.waitForFunction(old=>document.querySelector('[data-stage-key]')?.value!==old&&!document.querySelector('[data-stage-key-reset-confirm]'),{timeout:30000*scale},FAKE_KEY);
 assert.deepEqual(await a.$eval('[data-stage-key]',i=>[i.type,i.value]),['password',FAKE_KEY_2],'a different key, masked again');
 assert.match(await a.$eval('[data-stage-key-reset-done]',e=>e.textContent),/new stream key.*Paste it into StreamYard/s);
 assert.deepEqual([count('Ingress/DeleteIngress'),count('Ingress/CreateIngress'),[...lk.ingresses.values()].map(i=>i.key)],[1,2,[FAKE_KEY_2]],'the old ingress is deleted and a new one made');
 assert.deepEqual(lk.deletedRooms,[],'the LiveKit room is left alone');
 assert.equal(await openRoom(alice,'/chat?room=main&stage=1'),'waiting');
 await a.waitForSelector('[data-stage-key]',{timeout:60000*scale});
 assert.equal(await keyShown(a),FAKE_KEY_2,'the new key is the room\'s from now on');
 assert.equal(count('Ingress/CreateIngress'),2);
 await waitPlayer(a,'waiting');
 console.log('PASS reset key: asked in the card, cancel changes nothing, confirming gives a different key that then stays');

 // Bob's tab is put away until he opens the room again below: a room left open on screen reads the
 // "live now" message as soon as it arrives, and a read alert has no phone notification address.
 // (Depending on when that tab last asked for news, that is what failed on CI: "the address the
 // phone notification is recognised by" was null.)
 await bob.page.goto('about:blank');
 // The broadcast starts: StreamYard goes live. LiveKit's webhook tells the server, the server tells
 // the room, and only then does the admin's player connect.
 lk.publishing=true;
 await sleep(1500);
 await noConnection(alice,'until the room is told the broadcast is on');
 await webhook('ingress_started');await signal(a);
 await waitPlayer(a,'live');
 assert.equal((await feedOf(a)).connects,1,'the admin\'s player connects once the room is live');
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
 // #510: the admin's live stage (the "Live video" card with its address and key, the empty hands
 // list, the sample panels) in a light, a dark, both Terminal and the most colourful looks, changed
 // while it plays. (Every look on an admin's stage: chat-stage-mode, -hand and -on-screen.)
 await checkStageLooks(a,{looks:LOOKS.filter(look=>['light','dark','blade-runner','terminal','paper-terminal'].includes(look.id)),each:async look=>{if(shots&&['light','paper-terminal'].includes(look.id))await a.screenshot({path:`${shots}/admin-stage-live-${look.id}.png`});}});
 assert(await a.$eval('[data-stage-video-feed]',v=>!v.hidden&&v.srcObject!==null&&!v.paused),'the video played on through every theme change');
 // #504: the admin's three columns: the same widescreen player, in a narrower column.
 await a.waitForFunction(()=>document.querySelector('[data-stage-video-feed]').videoWidth>0);
 for(const size of STAGE_SIZES)await playerSize(a,'admin',size);
 await a.setViewport({width:1440,height:900});await sleep(300);

 // #503: the room is told, once. LiveKit's webhook reported the broadcast; more arrive: one of them
 // twice (a retry) and five more at the same moment.
 const b=bob.page;
 const [notice]=await until(async()=>{const rows=await notices();return rows.length?rows:null;},'the live message');
 assert.equal(notice.body,LIVE_TEXT);
 await until(async()=>(await alerted(notice.id)).length,'the bell entries');
 await webhook('ingress_started',null,'EV_retry');await webhook('ingress_started',null,'EV_retry');
 await Promise.all([webhook('room_started'),webhook('track_published','stage-broadcast'),webhook('track_published','stage-broadcast'),webhook('ingress_started'),webhook('participant_joined','stage-broadcast')]);
 await sleep(2500);
 assert.deepEqual((await notices()).map(n=>n.body),[LIVE_TEXT],'one message, however many times the broadcast is reported');
 assert.deepEqual(await alerted(notice.id),[ALICE,BOB],'everyone in LB is told once (no admin\'s action started it); not Mallory (not in LB)');
 assert.deepEqual(await sql("select j.kind,s.account_id from chat_push_jobs j join chat_push_subscriptions s on s.id=j.subscription_id"),[{kind:'room',account_id:BOB}],'one phone notification queued, for Bob');
 assert.equal((await sql("select public.chat_push_target('room',(select id from chat_room_mentions where message_id=$1 and account_id=$2),$2) t",[notice.id,BOB]))[0].t,`/chat?room=main&thread=${notice.id}`,'the address the phone notification is recognised by');
 // The member: the message, the bell, the LIVE button, then the stage.
 assert.equal(await openRoom(bob),'live');
 await b.waitForSelector('[data-stage-notice]',{visible:true,timeout:30000*scale});
 assert.deepEqual(await noticeText(b),['🔴 LB is live now. Watch live']);
 // #504: sent by "Live Video" (tile LV), not "Longboard Bot".
 {const [sender,...more]=await noticeSender(b);assert.equal(more.length,0);assert.match(sender.name,/^Live Video\b/,JSON.stringify(sender));assert.equal(sender.tile,'LV');assert.equal(sender.old,false,'no "Longboard Bot" on the notice');}
 assert.equal(await b.$eval('[data-stage-notice-watch]',a=>a.getAttribute('href')),'/chat?room=main&stage=1');
 if(shots)await b.screenshot({path:`${shots}/room-message-live.png`});
 await (await shown(b,bell)).click();
 await b.waitForSelector(`${bellPanel} [data-stage-notice-alert="main"]`,{visible:true,timeout:30000*scale});
 assert.equal(await b.$eval(`${bellPanel} [data-stage-notice-alert] strong`,e=>e.textContent),'LB – Live Video');
 assert(!(await b.$eval(bellPanel,e=>e.innerText)).includes('Longboard Bot'),'the bell never names Longboard Bot for it');
 assert.equal(await b.$eval(`${bellPanel} [data-stage-notice-alert] [class*="preview"]`,e=>e.textContent),'LB is live now. Watch live');
 assert.equal(await b.$$eval(`${bellPanel} article`,a=>a.length),1,'one bell entry');
 if(shots)await b.screenshot({path:`${shots}/bell.png`});
 // #505: the bell entry is a link that opens the stage in a tab of its own; Bob's room is untouched.
 assert.deepEqual(await b.$eval(`${bellPanel} [data-stage-notice-alert] a`,a=>[a.getAttribute('href'),a.target]),['/chat?room=main&stage=1','stage-main']);
 await settled(b);await mark(b);
 const bellBefore=await where(b);
 const stage=await opensStageTab(bob,()=>b.click(`${bellPanel} [data-stage-notice-alert] a`)),s=stage.tab;
 await waitPlayer(s,'live');
 assert.equal(new URL(s.url()).searchParams.get('stage'),'1');
 assert.deepEqual(await s.evaluate(()=>[window.name,window.opener]),['stage-main',null],'the tab is named for the room and has no handle on the tab that opened it');
 assert.deepEqual(await where(b),bellBefore,'the bell entry leaves Bob\'s own tab as it was');
 assert.equal(bellBefore.stage,false);assert.equal(bellBefore.samePage,true);assert.equal(new URL(bellBefore.url).searchParams.get('stage'),null);
 await until(async()=>(await sql('select count(*)::int n from chat_room_mentions where message_id=$1 and account_id=$2 and read_at is null',[notice.id,BOB]))[0].n===0,'the entry is marked read');
 await b.bringToFront();await b.keyboard.press('Escape');
 // A phone: the same message and button (#509), and the LIVE pill in its header.
 {const phone=await newPage();await phone.page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await signIn(phone.page,base,'bob@example.test',{composer:LB,next:'/chat?room=main'});
  await phone.page.waitForSelector('[data-stage-notice]',{visible:true,timeout:60000*scale});
  assert.deepEqual(await noticeText(phone.page),['🔴 LB is live now. Watch live']);
  assert.equal(await phone.page.$eval('[data-stage-notice-watch]',a=>a.checkVisibility()),true,'the Watch live button on a phone');
  await phone.page.waitForSelector('header[data-phone="true"] [data-stage-watch-live]',{visible:true,timeout:30000*scale});
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
 // #505: the header's button is a link too. Bob has scrolled up in a short window; pressing it
 // brings the stage tab forward (the one the bell entry opened: not a second tab, not loaded again)
 // and his own tab keeps its address, room and scroll position.
 assert.deepEqual(await b.$eval('[data-stage-watch-live]',a=>[a.tagName,a.getAttribute('href'),a.target,a.dataset.stageWatchLive]),['A','/chat?room=main&stage=1','stage-main','main']);
 await b.bringToFront();
 // One tall message (14 lines), so the room has something to scroll.
 {const box=await shown(b,LB);await box.click();for(let n=1;n<=13;n++){await b.keyboard.type(`Line ${n} of a long note.`);await b.keyboard.down('Shift');await b.keyboard.press('Enter');await b.keyboard.up('Shift');}
  await b.keyboard.type('The last line of a long note.');await b.keyboard.press('Enter');
  await b.waitForFunction(()=>[...document.querySelectorAll('article[id^="chat-message-"]:not([data-pending])')].some(a=>a.checkVisibility()&&a.textContent.includes('The last line of a long note.')),{timeout:30000*scale});}
 await b.setViewport({width:1440,height:420});await sleep(400);
 await b.evaluate(()=>{const list=[...document.querySelectorAll('article[id^="chat-message-"]')].find(a=>a.checkVisibility());let scroller=list.parentElement;
  while(scroller&&!(scroller.scrollHeight>scroller.clientHeight+4&&/auto|scroll/.test(getComputedStyle(scroller).overflowY)))scroller=scroller.parentElement;
  scroller.scrollTop=Math.max(1,Math.floor((scroller.scrollHeight-scroller.clientHeight)/2));});
 await sleep(600);await mark(b);await s.evaluate(()=>{window.__sameStage=true;});
 const headerBefore=await where(b);
 assert(headerBefore.scroll>0,`Bob is scrolled up: ${JSON.stringify(headerBefore)}`);
 const tabsBefore=(await bob.context.pages()).length;
 assert.equal(await b.evaluate(()=>document.visibilityState),'visible');
 await b.click('[data-stage-watch-live]');
 await sleep(1500);
 assert.equal(await s.evaluate(()=>document.visibilityState),'visible','the stage tab is brought forward');
 assert.equal((await bob.context.pages()).length,tabsBefore,'a second press opens no second tab');
 assert.deepEqual((await stageTabs(bob)).map(t=>t===s),[true],'the one stage tab is the same tab');
 assert.equal(await s.evaluate(()=>window.__sameStage),true,'and it was not loaded again');
 assert.deepEqual(await where(b),headerBefore,'the header button leaves Bob\'s own tab as it was (address, room, scroll)');
 assert.equal(headerBefore.stage,false);assert.equal(headerBefore.composer,true);
 await b.setViewport({width:1440,height:900});
 await s.bringToFront();
 await waitPlayer(s,'live');
 if(shots)await s.screenshot({path:`${shots}/stage-new-tab.png`});
 const layout=()=>s.evaluate(()=>{const box=s=>{const e=[...document.querySelectorAll(s)].find(x=>x.checkVisibility());if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),right:Math.round(r.right),bottom:Math.round(r.bottom)};};
  return {bar:box('[data-stage-root] > header'),stage:box('[data-stage-column="stage"]'),chat:box('[data-stage-root] ~ section'),video:box('[data-stage-video]'),sideways:document.documentElement.scrollWidth>window.innerWidth,width:window.innerWidth,height:window.innerHeight};});
 {const l=await layout();
  assert(l.bar&&l.stage&&l.chat&&l.video,JSON.stringify(l));
  assert.equal(l.stage.x,0);assert.equal(l.stage.right+1,l.chat.x,`the chat sits right beside the stage (no empty middle column): ${JSON.stringify(l)}`);
  assert.equal(l.chat.w,340);assert.equal(l.chat.right,l.width);assert(!l.sideways);
  assert(l.video.bottom<=l.height,`the whole player fits the window: ${JSON.stringify(l)}`);}
 // Nothing made up is shown to a member.
 const stageText=await s.$eval('[data-stage-root]',r=>r.innerText);
 for(const made of ['QBTZ','MLNK','VXRT','Trade tape','Question queue','Chapters','Rob Booker','Trading the open','sample','Sample','WATCH','Admin','Stream key','Stream address','Reset key','StreamYard'])
  assert(!stageText.includes(made),`a member's stage does not show "${made}"`);
 for(const selector of ['[data-stage-column="trades"]','[data-stage-chapter]','[data-stage-question]','[data-stage-overlay-card]','[data-stage-broadcast]','[data-stage-elapsed]','[data-stage-host-sample]','[data-stage-key]','[data-stage-address]','[data-stage-key-reset]'])
  assert.equal(await s.$(selector),null,`a member's stage has no ${selector}`);
 assert.equal(await s.$eval('[data-stage-overlay]',e=>e.childElementCount),0,'the overlay layer is there, empty');
 const bar=await s.$eval('[data-stage-root] > header',h=>h.innerText);
 for(const text of ['# LB','LIVE','3 watching','Back to the room'])assert(bar.includes(text),`the member's top bar has "${text}": ${bar}`);
 assert.match(await s.$eval('[data-stage-video]',e=>e.innerText),/LIVE VIDEO\s*# LB/,'the player names the room');
 // No rows on today's Gainers Table: no stock panel at all (the admin's sample row is not shown to members).
 assert.equal(await s.$('[data-stage-stock]'),null,'no sample stock for a member');
 // A stock alerts: the panel appears with the table's real row (the next 15-second read).
 await alert('AEHL',52,300000);
 await s.waitForSelector('[data-stage-stock][data-stage-stock-source="table"]',{timeout:40000*scale});
 assert.equal(await s.$eval('[data-stage-stock]',e=>e.dataset.stageStock),'AEHL');assert.equal(await s.$('[data-stage-sample]'),null);
 assert.equal(await s.$eval('[data-stage-stat="price"] dd',d=>d.textContent),'$2.50');
 {const l=await layout();assert(!l.sideways,'the stock panel fits the member\'s stage');}
 // The player: a real video element showing the picture, with working controls.
 await s.waitForFunction(()=>{const v=document.querySelector('[data-stage-video-feed]');return v&&!v.hidden&&v.videoWidth===1280&&!v.paused;},{timeout:20000*scale});
 assert.equal(await s.$eval('[data-stage-video-feed]',v=>v.muted),true,'the picture itself is silent: the sound has its own element');
 await s.waitForFunction(()=>document.querySelector('[data-stage-video-quality]')?.textContent==='720p');
 await s.click('[data-stage-sound]');
 await s.waitForFunction(()=>!document.querySelector('[data-stage-sound]'));
 assert.equal(await s.evaluate(()=>window.__stageFeed.audioStarted),true,'Tap for sound starts the audio');
 await s.click('[data-stage-video] button[aria-label="Pause"]');
 assert.equal(await s.$eval('[data-stage-video-feed]',v=>v.paused),true);assert.equal(await s.evaluate(()=>window.__stageFeed.volume),0,'paused is silent');
 await s.click('[data-stage-video] button[aria-label="Play"]');
 await s.waitForFunction(()=>!document.querySelector('[data-stage-video-feed]').paused&&window.__stageFeed.volume===1);
 await s.click('[data-stage-video] button[aria-label="Mute"]');
 assert.equal(await s.evaluate(()=>window.__stageFeed.volume),0);
 await s.click('[data-stage-video] button[aria-label="Unmute"]');
 await s.waitForFunction(()=>window.__stageFeed.volume===1);
 assert(await s.$('[data-stage-video] input[aria-label="Volume"]'));assert(await s.$('[data-stage-video] button[aria-label="Full screen"]'));
 await s.click('[data-stage-video] button[aria-label="Full screen"]');
 await s.waitForFunction(()=>document.fullscreenElement?.contains(document.querySelector('[data-stage-overlay]')),{timeout:10000*scale});
 await s.evaluate(()=>document.exitFullscreen());await s.waitForFunction(()=>!document.fullscreenElement);
 const controls=await s.$$eval('[data-stage-root] button',bs=>bs.map(x=>({name:(x.getAttribute('aria-label')||x.textContent).trim(),h:Math.round(x.getBoundingClientRect().height)})));
 for(const c of controls){assert(c.name);assert(c.h>=44,`"${c.name}" is ${c.h}px tall`);}
 // His token: for chat-main, watch only, in his name; sent to the address the server named.
 {const connects=await s.evaluate(()=>window.__stageFeed.connects);assert.equal(connects.length,1,'one connection');
  assert.equal(connects[0].url,'ws://127.0.0.1:54633');
  const claims=JSON.parse(Buffer.from(connects[0].token.split('.')[1],'base64url').toString('utf8'));
  assert.deepEqual(claims.video,{room:'chat-main',roomJoin:true,canSubscribe:true,canPublish:false,canPublishData:false,canUpdateOwnMetadata:false});
  assert.match(claims.sub,/^[0-9a-f-]{36}#[0-9a-f]{8}$/);assert(claims.name);assert(claims.exp-Math.floor(Date.now()/1000)<=600);}
 // The room's real chat, from the stage.
 assert(await s.evaluate(()=>[...document.querySelectorAll('[data-stage-root] ~ section article[id^="chat-message-"]')].some(x=>x.textContent.includes('Morning all.'))));
 await send(s,'Watching from the stage.');
 assert(await saved(s,'Watching from the stage.'),'a message from the stage is a real room message');
 if(shots)await s.screenshot({path:`${shots}/member-stage.png`});
 // #510: the member's stage, in the tab Watch live opened, in every theme and colour combination:
 // the columns and the room chat take the theme, the player and its frame stay dark, LIVE stays red.
 {const connects=await s.evaluate(()=>window.__stageFeed.connects.length);
  await checkStageLooks(s,{each:async look=>{if(shots)await s.screenshot({path:`${shots}/member-stage-${look.id}.png`});}});
  assert.equal(await s.evaluate(()=>window.__stageFeed.connects.length),connects,'a theme change opens no new video connection');
  assert(await s.$eval('[data-stage-video-feed]',v=>!v.hidden&&!v.paused),'the video plays on through every theme change');}
 // A 1280px laptop keeps the two columns; narrower stacks video over chat.
 await s.setViewport({width:1280,height:800});await sleep(300);
 {const l=await layout();assert.equal(l.stage.right+1,l.chat.x);assert.equal(l.chat.right,1280);assert(!l.sideways);}
 await s.setViewport({width:1000,height:800});await sleep(300);
 {const l=await layout();assert(l.stage.y<l.chat.y&&l.chat.x===0,`stacked: video, then chat: ${JSON.stringify(l)}`);assert(!l.sideways);}
 // #504: a normal widescreen player at every size, the blocks under it the same width.
 {const sizes={};for(const size of STAGE_SIZES)sizes[size.join('x')]=await playerSize(s,'member',size);
  assert.equal(Math.round(sizes['2560x1440'].area.w),1280,'a big window: the picture stops at 1280px');
  assert.equal(Math.round(sizes['1920x1080'].area.w),1280);
  assert(sizes['1440x700'].area.w<sizes['1440x900'].area.w,'a short window: the picture is smaller, so the player still fits');
  assert(sizes['1920x1080'].blocks.length>=1,'the stock panel is under the player');}
 await s.setViewport({width:1440,height:900});await sleep(300);
 console.log('STEP leaving the stage in its own tab');
 // Leaving the stage in its own tab: "Back to the room" is the room, in that same tab.
 await s.click('[data-stage-exit]');
 await s.waitForFunction(()=>!document.querySelector('[data-stage-root]'));
 assert.equal(new URL(s.url()).searchParams.get('stage'),null);
 assert(await visible(s,'[data-stage-watch-live]'),'back in the room, the LIVE button is still there');
 assert.equal(await s.evaluate(()=>window.__stageFeed.closed),1,'leaving the stage closes the connection');
 // #505: "Watch live" in the room message, pressed in Bob's own tab: the stage goes back into the
 // same stage tab (no third tab), and Bob's tab is not loaded again and does not move.
 console.log('STEP the room message in Bob\'s own tab');
 await b.bringToFront();
 assert.deepEqual(await (await shown(b,'[data-stage-notice-watch]')).evaluate(a=>[a.getAttribute('href'),a.target]),['/chat?room=main&stage=1','stage-main']);
 await (await shown(b,'[data-stage-notice-watch]')).evaluate(a=>a.scrollIntoView({block:'center'}));await sleep(600);
 await settled(b);await mark(b);
 const noticeBefore=await where(b),tabsNow=(await bob.context.pages()).length;
 await (await shown(b,'[data-stage-notice-watch]')).click();
 await s.waitForSelector('[data-stage-root="main"]',{timeout:60000*scale});
 await waitPlayer(s,'live');
 assert.equal((await bob.context.pages()).length,tabsNow,'the room message reuses the stage tab');
 assert.deepEqual(await where(b),noticeBefore,'the room message\'s Watch live leaves Bob\'s own tab as it was');
 assert.equal(noticeBefore.stage,false);assert.equal(noticeBefore.samePage,true);
 console.log('STEP pressed again');
 // Pressed again while the stage is showing: brought forward only.
 await s.evaluate(()=>{window.__sameStage=true;});
 await b.bringToFront();
 const again=await shown(b,'[data-stage-notice-watch]');
 await again.click();
 await sleep(1500);
 assert.equal((await bob.context.pages()).length,tabsNow);assert.equal(await s.evaluate(()=>window.__sameStage),true,'the stage is not loaded again');
 console.log('STEP in the stage tab itself');
 // In the stage tab itself, the message's Watch live has nothing to do: no new tab, no reload.
 await s.bringToFront();
 await (await shown(s,'[data-stage-notice-watch]')).click();
 await sleep(1000);
 assert.equal((await bob.context.pages()).length,tabsNow);assert.equal(await s.evaluate(()=>window.__sameStage&&!!document.querySelector('[data-stage-root="main"]')),true);
 assert.deepEqual(stage.errors,[]);
 await s.close();await b.bringToFront();
 console.log('PASS own tab: the bell entry, the header button and the room message open one stage tab for the room and leave the member\'s tab alone');
 // The stage link opened directly (a phone notification on a computer, a pasted link) is the stage in that tab, as before.
 assert.equal(await openRoom(bob,'/chat?room=main&stage=1'),'live');
 await b.waitForSelector('[data-stage-root]',{timeout:60000*scale});
 await waitPlayer(b,'live');
 // The stream key never reached the member.
 {const refused=await b.evaluate(async()=>{const out=[];for(const init of [undefined,...['open','reset','refresh','start','end'].map(action=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'main',action})}))]){const r=await fetch('/api/chat/stage/live?room=main',init);out.push([r.status,await r.text()]);}return out;});
  for(const [status,text] of refused){assert.equal(status,403);assert.equal(text,'{"error":"admin_only"}');}
  assert.deepEqual([[...lk.ingresses.values()].map(i=>i.key),count('Ingress/DeleteIngress'),count('Ingress/CreateIngress')],[[FAKE_KEY_2],1,2],'a member cannot read, make or reset the key');}
 console.log('PASS live: LIVE button, the member\'s stage (video and chat, no samples), watch-only token, chat, link');

 // #511: the broadcast stops (StreamYard leaves; there is no End). Bob's player stays connected for
 // the grace, then lets go of its connection and says the broadcast has ended; signals while the
 // room is only "waiting" open nothing; when it is live again he is connected again by himself.
 // #512: the admin's player does exactly the same (it no longer waits connected for the next one).
 {const feed=()=>b.evaluate(()=>({connects:window.__stageFeed.connects.length,closed:window.__stageFeed.closed,token:window.__stageFeed.connects.at(-1)?.token}));
  const was=await feed();assert.deepEqual([was.connects,was.closed],[1,0]);
  assert.deepEqual(await feedOf(a),{connects:1,closed:0});
  lk.publishing=false;const stopped=Date.now();
  await webhook('participant_left','stage-broadcast');await signal(b);await signal(a);
  await waitPlayer(b,'waiting');
  assert.match(await b.$eval('[data-stage-video-message]',e=>e.textContent),/The broadcast has stopped/);
  await sleep(5000);
  assert.deepEqual([(await feed()).closed,await playerState(b)],[0,'waiting'],'a short drop is ridden out: still connected');
  await b.waitForFunction(()=>window.__stageFeed.closed===1,{timeout:60000*scale});
  const held=Date.now()-stopped;assert(held>=20000&&held<45000*scale,`let go after the grace (about 25 seconds), not ${held}ms`);
  await waitPlayer(b,'ended');
  assert.match(await b.$eval('[data-stage-video-message]',e=>e.textContent),/The broadcast has ended/);
  assert.equal(await b.$('[data-stage-video-feed]'),null,'no video element once disconnected');
  await a.waitForFunction(()=>window.__stageFeed.closed===1,{timeout:60000*scale});
  await waitPlayer(a,'ended');
  assert.equal(await a.$('[data-stage-video-feed]'),null,'the admin\'s player has let go too: an admin waits with no connection');
  await signal(b);await signal(a);await sleep(6500);
  assert.equal((await feed()).connects,1,'a member opens no connection while the room is only waiting');
  assert.equal((await feedOf(a)).connects,1,'and neither does an admin');
  assert.equal(await playerState(b),'ended');
  // Live again.
  lk.publishing=true;lk.startedAt=Date.now();
  await Promise.all([webhook('ingress_started'),webhook('track_published','stage-broadcast')]);await signal(b);await signal(a);
  await waitPlayer(b,'live');await waitPlayer(a,'live');
  const now=await feed();assert.deepEqual([now.connects,now.closed],[2,1],'connected again by itself, once');
  assert.notEqual(now.token,was.token,'with a fresh token');
  assert.deepEqual(await feedOf(a),{connects:2,closed:1},'the admin is connected again too');
  await b.waitForFunction(()=>{const v=document.querySelector('[data-stage-video-feed]');return v&&!v.hidden&&!v.paused;},{timeout:20000*scale});
  await until(async()=>(await notices())[0].body===LIVE_TEXT,'the room message says live again');
  console.log('PASS broadcast stops: the connections (member and admin) are closed after the grace, nothing connects while waiting, and both reconnect when live again');}

 // #505: Dual, Quad and Six view. LB is live and sits on the second card; the other cards' rooms are not live.
 {const m=await bob.context.newPage(),errors=[],asked=[];m.on('pageerror',e=>errors.push(e.message));
  m.on('request',r=>{if(r.url().includes('/api/chat/stage/status'))asked.push(r.url().replace(base,''));});
  await m.setViewport({width:1440,height:900});
  const others=await b.evaluate(async()=>(await (await fetch('/api/chat/quad-options',{cache:'no-store'})).json()).rooms.filter(r=>r!=='main'));
  assert(others.length>=3,`Bob reads at least four rooms: ${others}`);
  // The cards' layouts are saved before any of the page's own code runs, on every load of this tab.
  // (Written into an open Quad view instead, they could be lost: in its first second the page reads
  // its options again and saves its own layout, LB first, which could land on top of them. That is
  // what failed on CI: "only the live room's card has the button", with LB on the first card.)
  await m.evaluateOnNewDocument((origin,id,o)=>{if(location.origin!==origin)return;
   try{localStorage.setItem('rb-chat-quad-v1:'+id,JSON.stringify(['room:'+o[0],'room:main','room:'+o[1],'room:'+o[2]]));
    localStorage.setItem('rb-chat-dual-v1:'+id,JSON.stringify(['room:'+o[0],'room:main']));
    localStorage.setItem('rb-chat-six-v1:'+id,JSON.stringify([{type:'room',source:o[0]},{type:'room',source:'main'},{type:'room',source:o[1]},{type:'room',source:o[2]},null,null]));}catch{}},new URL(base).origin,BOB,others);
  const panes=()=>m.$$eval('section[aria-label^="Pane"] select',list=>list.filter(x=>x.checkVisibility()).map(x=>x.value));
  const button='[data-stage-watch-live="main"]';
  const open=async path=>{await m.bringToFront();await m.goto('about:blank');asked.length=0;await m.goto(base+path);await m.waitForSelector(button,{visible:true,timeout:60000*scale});await sleep(2500);
   assert.equal(asked.length,1,`one status request for the whole page, not one per card: ${asked.join(' | ')}`);
   const rooms=new URL(base+asked[0]).searchParams.get('rooms')?.split(',')??[];
   return rooms;};
  const cards=selector=>m.$$eval(selector,list=>list.filter(c=>c.checkVisibility()).map(c=>{const a=c.querySelector('[data-stage-watch-live]'),head=c.querySelector('header');
   return {live:a?a.dataset.stageWatchLive:null,text:a?a.textContent.replace(/\s+/g,' ').trim():null,link:a?[a.tagName,a.getAttribute('href'),a.target]:null,fits:head.scrollWidth<=head.clientWidth+1&&(!a||a.getBoundingClientRect().right<=head.getBoundingClientRect().right)};}));
  const link=['A','/chat?room=main&stage=1','stage-main'];
  console.log('STEP Quad view');
  assert.deepEqual((await open('/chat/quad')).sort(),[others[0],'main',others[1],others[2]].sort(),'the one request names the four cards\' rooms');
  assert.deepEqual(await panes(),['room:'+others[0],'room:main','room:'+others[1],'room:'+others[2]],'the cards are the ones this test laid out: LB on the second');
  {const c=await cards('section[aria-label^="Pane"]');assert.equal(c.length,4);
   assert.deepEqual(c.map(x=>x.live),[null,'main',null,null],'only the live room\'s card has the button');
   assert.deepEqual(c[1].link,link);assert.match(c[1].text,/^LIVE ?Watch$/);assert(c.every(x=>x.fits),`the button fits the card header: ${JSON.stringify(c)}`);}
  if(shots)await m.screenshot({path:`${shots}/quad-live-button.png`});
  await mark(m);
  const quadBefore=await m.evaluate(()=>({url:location.href,panes:[...document.querySelectorAll('section[aria-label^="Pane"] select')].map(x=>x.value),samePage:window.__samePage===true}));
  const opened=await opensStageTab({context:bob.context,page:m},()=>m.click(button)),q=opened.tab;
  await waitPlayer(q,'live');
  assert.deepEqual(await q.evaluate(()=>[window.name,window.opener]),['stage-main',null]);
  assert.deepEqual(await m.evaluate(()=>({url:location.href,panes:[...document.querySelectorAll('section[aria-label^="Pane"] select')].map(x=>x.value),samePage:window.__samePage===true})),quadBefore,'Quad view is as it was');
  assert.equal(new URL(quadBefore.url).pathname,'/chat/quad');assert.equal(await m.$('[data-stage-root]'),null);
  const tabs=(await bob.context.pages()).length;
  await q.evaluate(()=>{window.__sameStage=true;});
  await m.bringToFront();await m.click(button);await sleep(1500);
  assert.equal((await bob.context.pages()).length,tabs,'pressed again in Quad view: the same stage tab');assert.equal(await q.evaluate(()=>window.__sameStage),true);
  console.log('STEP Six view');
  assert.deepEqual((await open('/chat/six')).sort(),[others[0],'main',others[1],others[2]].sort());
  {const c=await cards('section[data-card]');assert.equal(c.length,6);
   assert.deepEqual(c.map(x=>x.live),[null,'main',null,null,null,null],'only the live room\'s card has the button');
   assert.deepEqual(c[1].link,link);assert(c.every(x=>x.fits),`the button fits the narrow card header: ${JSON.stringify(c)}`);}
  if(shots)await m.screenshot({path:`${shots}/six-live-button.png`});
  await mark(m);await m.bringToFront();
  await m.click(button);await sleep(1500);
  assert.equal((await bob.context.pages()).length,tabs,'Six view uses the same stage tab');assert.equal(await q.evaluate(()=>window.__sameStage),true);
  assert.deepEqual(await m.evaluate(()=>[location.pathname,window.__samePage===true,document.querySelectorAll('section[data-card]').length,!!document.querySelector('[data-stage-root]')]),['/chat/six',true,6,false],'Six view is as it was');
  console.log('STEP Dual view');
  assert.deepEqual((await open('/chat/dual')).sort(),[others[0],'main'].sort());
  assert.deepEqual(await panes(),['room:'+others[0],'room:main']);
  {const c=await cards('section[aria-label^="Pane"]');assert.equal(c.length,2);assert.deepEqual(c.map(x=>x.live),[null,'main']);assert.match(c[1].text,/^LIVE ?Watch$/);assert(c.every(x=>x.fits));}
  if(shots)await m.screenshot({path:`${shots}/dual-live-button.png`});
  await mark(m);await m.bringToFront();
  await m.click(button);await sleep(1500);
  assert.equal((await bob.context.pages()).length,tabs,'Dual view uses the same stage tab');
  assert.deepEqual(await m.evaluate(()=>[location.pathname,window.__samePage===true,!!document.querySelector('[data-stage-root]')]),['/chat/dual',true,false],'Dual view is as it was');
  console.log('STEP a phone-sized Quad view, then a pop-out');
  // A phone-sized Quad view has no button and asks nothing (a phone watches from the room itself, #509).
  await m.bringToFront();await m.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await m.goto('about:blank');asked.length=0;
  await m.goto(base+'/chat/quad');await m.waitForSelector('select',{timeout:60000*scale});await sleep(2500);
  assert.equal(await m.$('[data-stage-watch-live]'),null,'no button on a phone');assert.deepEqual(asked,[]);
  // A pop-out window of the room has the button too (one status request, as a room has).
  await m.setViewport({width:460,height:780});await m.goto('about:blank');asked.length=0;
  await m.goto(base+'/chat?popout=1&room=main');await m.waitForSelector(button,{visible:true,timeout:60000*scale});await sleep(1500);
  assert.deepEqual(asked,['/api/chat/stage/status?room=main']);
  assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'the pop-out does not scroll sideways');
  await mark(m);await m.bringToFront();await m.click(button);await sleep(1500);
  assert.equal((await bob.context.pages()).length,tabs,'the pop-out uses the same stage tab');
  assert.deepEqual(await m.evaluate(()=>[location.search,window.__samePage===true,!!document.querySelector('[data-stage-root]')]),['?popout=1&room=main',true,false]);
  assert.deepEqual(errors,[]);assert.deepEqual(opened.errors,[]);
  await q.close();await m.close();await b.bringToFront();
  // Dual view was opened on this device, which a plain /chat now follows: put that back for the rest.
  await b.evaluate(()=>{for(const key of Object.keys(localStorage))if(localStorage.getItem(key)==='dual')localStorage.removeItem(key);});}
 console.log('PASS multi view: a live room\'s card has the button in Dual, Quad and Six view (one status request per page), it opens the stage tab, and the view stays put');

 // #505: an admin's Watch live opens a tab of its own as well (the admin's stage: three columns).
 {const a2=await alice.context.newPage();await a2.setViewport({width:1440,height:900});
  await a2.goto(base+'/chat?room=main');await a2.waitForSelector('[data-stage-watch-live="main"]',{visible:true,timeout:60000*scale});await ready(a2);
  // A room that has just opened is still settling (it keeps itself at the newest message while
  // late rows and pictures arrive), so "as it was" is measured once it has stopped moving: its
  // place has been the same for a second and a half. (Taken too early, the place it settled at a
  // moment later read as the tab having moved: 59px, twice in ten runs.)
  await settled(a2);
  await mark(a2);const before=await where(a2),had=new Set(await alice.context.pages());
  await a2.click('[data-stage-watch-live="main"]');
  const tab=await until(async()=>(await alice.context.pages()).find(p=>!had.has(p)&&/[?&]room=main&stage=1/.test(p.url())),'the admin\'s stage tab');
  await tab.waitForSelector('[data-stage-root="main"][data-stage-columns="3"]',{timeout:60000*scale});
  assert.deepEqual(await where(a2),before,'the admin\'s own tab is as it was');assert.equal(before.stage,false);
  await tab.close();await a2.close();await a.bringToFront();}
 console.log('PASS admin: Watch live opens the admin\'s stage in its own tab');

 // #512: the broadcast stops for good. Nobody presses anything (there is no End); here LiveKit's
 // webhook is lost too and no admin is watching, so the only thing that notices is the status.
 await a.click('[data-stage-exit]');await a.waitForFunction(()=>!document.querySelector('[data-stage-root]'));
 assert.deepEqual(await feedOf(a),{connects:2,closed:2},'leaving the stage closes the admin\'s connection');
 const bobFeed=await feedOf(b);
 const statusReads=()=>bob.stageAnswers.filter(x=>x.includes('/api/chat/stage/status?room=main')).length,readsBefore=statusReads();
 lk.publishing=false;
 await waitPlayer(b,'waiting');
 assert.match(await b.$eval('[data-stage-video-message]',e=>e.textContent),/The broadcast has stopped/);
 // A short drop is ridden out; then the player lets go of its connection by itself, and asks the
 // status again: that is what tells the server (and his top bar) that the broadcast is over.
 assert.equal((await feedOf(b)).closed,bobFeed.closed,'still connected a moment after it stops');
 await b.waitForFunction(n=>window.__stageFeed.closed===n+1,{timeout:60000*scale},bobFeed.closed);
 assert.equal(await b.$('[data-stage-video-feed]'),null,'no video element once let go');
 await waitPlayer(b,'ended');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-live]'),{timeout:20000*scale});
 assert.equal((await feedOf(b)).connects,bobFeed.connects,'and nothing connects again while the room is only waiting');
 // The room's message says it ended, with no End, no webhook and no admin: the status noticed.
 // #521: the only status reads this depends on are Bob's own, from the page he is still on: one as
 // his player lets go (above) and one more 30 seconds later. The look at the message that a status
 // answer starts runs after the response and can be lost (on CI it was: the admin's stage tab,
 // closed a moment earlier, still had a status request on its way when the broadcast stopped, so
 // that look never ran and nothing ever asked again). A lost look is run again by the next status
 // answer, so the longest this takes from here is Bob's second read (30 s) and, when the server
 // did not see the stop itself, the 20 s the broadcast is given to come back; plus a margin.
 await until(async()=>(await notices())[0].body===ENDED_TEXT,'the message says it ended once the broadcast has stopped',30000+20000+10000);
 await until(async()=>statusReads()>=readsBefore+3,'three status reads from Bob\'s page since the stop: as the picture went, as his player let go, and once more 30 seconds later',45000);
 await b.click('[data-stage-exit]');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-root]'));
 await b.waitForFunction(()=>!document.querySelector('[data-stage-watch-live]'),{timeout:20000*scale});
 assert.equal(await openRoom(bob,'/chat?room=main&stage=1'),'waiting');
 await sleep(800);
 assert.equal(await b.$('[data-stage-root]'),null,'after it stops, the stage link is just the room again');
 assert.equal(await b.$('[data-stage-watch-live]'),null);
 // Nothing was tidied away that the next broadcast needs: the same ingress, the same key.
 assert.deepEqual([[...lk.ingresses.values()].map(i=>i.key),count('Ingress/DeleteIngress'),count('Ingress/CreateIngress'),lk.deletedRooms],[[FAKE_KEY_2],1,2,[]],'the room keeps its ingress and key when a broadcast stops');
 // #503: the same message now says it ended, and the bell entry is gone with it.
 assert.deepEqual((await notices()).map(n=>n.body),[ENDED_TEXT]);
 assert.deepEqual(await alerted(notice.id),[],'the alerts are taken back when the broadcast ends');
 assert.deepEqual(await noticeText(b),[ENDED_TEXT]);
 assert(await b.evaluate(text=>[...document.querySelectorAll('article[id^="chat-message-"]')].some(a=>a.checkVisibility()&&a.innerText.includes(text)&&/Live Video/.test(a.innerText)&&!/Longboard Bot/.test(a.innerText)),ENDED_TEXT),'the ended message is from "Live Video" too');
 assert.equal(await b.$('[data-stage-notice-watch]'),null,'no Watch live link once it has ended');
 assert.deepEqual(await b.evaluate(async id=>((await (await fetch('/api/chat/activity?fresh='+Date.now(),{cache:'no-store'})).json()).mentions??[]).filter(m=>m.messageId===id),notice.id),[],'Bob\'s bell no longer lists it');
 if(shots)await b.screenshot({path:`${shots}/room-message-ended.png`});
 for(const page of [alice,bob])assert.deepEqual(page.errors,[]);
 for(const answer of bob.everyAnswer){assert(!answer.includes(FAKE_KEY),'no answer to the member carries a stream key (old or new)');assert(!answer.includes(FAKE_ADDRESS),'nor the stream address');}
 assert(alice.everyAnswer.some(x=>x.includes(FAKE_KEY)),'(the admin\'s answers do carry it)');
 console.log('PASS the broadcast stops (no End, no webhook): the member\'s player lets go, the LIVE button goes, the message says it ended, the key stays');

 // #503: a later broadcast on the same key. The admin has the stage open again, waiting, unconnected.
 await openMenu(a);await a.click('[data-stage-go-live]');
 await a.waitForSelector('[data-stage-key]',{timeout:30000*scale});
 assert.equal(await keyShown(a),FAKE_KEY_2,'still the same key, broadcast after broadcast');
 await waitPlayer(a,'waiting');await sleep(1000);
 assert.deepEqual(await feedOf(a),{connects:2,closed:2},'the admin holds no connection between broadcasts');
 // Mallory joins LB but has muted it; a bot account can read LB; neither is told.
 await sql("insert into user_tags(user_id,tag) values($1,'boardroom-cohort-1')",[MALLORY]);
 await sql("insert into chat_room_notification_levels(account_id,room_slug,level) values($1,'main','muted')",[MALLORY]);
 await sql("insert into chat_bot_accounts(account_id,allowed_rooms) values($1,array['main'])",[BOT]);
 assert.deepEqual(await sql("select public.chat_account_room_recipient_eligible($1,'main') a,public.chat_account_room_recipient_eligible($2,'main') b",[MALLORY,BOT]),[{a:true,b:true}],'both can read LB now');
 // The first broadcast ended 11 minutes ago.
 await sql("update longboard_chat_messages set edited_at=now()-interval '11 minutes' where id=$1",[notice.id]);
 lk.publishing=true;lk.startedAt=Date.now()-3000;
 await Promise.all([webhook('ingress_started'),webhook('track_published','stage-broadcast'),webhook('room_started')]);await signal(a);
 await waitPlayer(a,'live');
 assert.deepEqual(await feedOf(a),{connects:3,closed:2},'the admin\'s player connects for the broadcast');
 const second=await until(async()=>(await notices())[1],'the second broadcast\'s message');
 await until(async()=>(await alerted(second.id)).length,'its bell entries');
 await sleep(1500);
 assert.deepEqual((await notices()).map(n=>n.body),[ENDED_TEXT,LIVE_TEXT],'a new broadcast gets its own message');
 assert.deepEqual(await alerted(second.id),[ALICE,BOB],'everyone in LB is told (no admin started this one), except the muted member and the bot');
 assert.equal((await sql("select count(*)::int n from chat_push_jobs j join chat_push_subscriptions s on s.id=j.subscription_id where s.account_id=$1",[BOB]))[0].n,2,'Bob\'s phone: one notification per broadcast');
 // StreamYard drops; LiveKit says so. After the few seconds' grace the message says it ended...
 lk.publishing=false;
 await webhook('participant_left','stage-broadcast');await signal(a);
 await waitPlayer(a,'waiting');
 assert.match(await a.$eval('[data-stage-video-message]',e=>e.textContent),/The broadcast has stopped/);
 await sleep(3000);
 assert.equal((await notices())[1].body,LIVE_TEXT,'a drop is not the end straight away');
 await until(async()=>(await notices())[1].body===ENDED_TEXT,'the message says it ended after the grace',40000);
 assert.deepEqual(await alerted(second.id),[]);
 // The admin's player has let go too: stopped is not a reason to stay connected.
 await a.waitForFunction(()=>window.__stageFeed.closed===3,{timeout:60000*scale});
 assert.equal(await a.$('[data-stage-video-feed]'),null);await waitPlayer(a,'ended');
 // ...and it comes back a moment later: the same message says live again, and nobody is told twice.
 lk.publishing=true;lk.startedAt=Date.now();
 await Promise.all([webhook('ingress_started'),webhook('track_published','stage-broadcast')]);await signal(a);
 await waitPlayer(a,'live');
 assert.deepEqual(await feedOf(a),{connects:4,closed:3},'and connects again when it is back');
 await until(async()=>(await notices())[1].body===LIVE_TEXT,'the message says live again');
 await sleep(1500);
 assert.equal((await notices()).length,2,'no third message for a reconnect');
 assert.deepEqual(await alerted(second.id),[],'no new bell entries for a reconnect');
 assert.equal((await sql('select count(*)::int n from chat_push_jobs'))[0].n,2,'and no new phone notification');
 // #512: Reset key while it is live. The broadcast using the old key is cut off: the card shows a new
 // key, the player says it stopped, and after the same few seconds' grace the message says it ended.
 await a.evaluate(()=>document.querySelector('[data-stage-key-reset]').scrollIntoView({block:'center'}));
 await a.click('[data-stage-key-reset]');await a.waitForSelector('[data-stage-key-reset-confirm]');
 assert.equal(lk.publishing,true,'asking cuts nothing off');
 await a.click('[data-stage-key-reset-confirm]');
 await a.waitForFunction(old=>document.querySelector('[data-stage-key]')?.value!==old,{timeout:30000*scale},FAKE_KEY_2);
 assert.equal(await keyShown(a),FAKE_KEY_3);
 assert.deepEqual([lk.publishing,[...lk.ingresses.values()].map(i=>i.key),lk.deletedRooms],[false,[FAKE_KEY_3],[]],'the old ingress is gone, and its broadcast with it');
 await waitPlayer(a,'waiting');
 await a.waitForFunction(()=>document.querySelector('[data-stage-broadcast]').dataset.stageBroadcast==='ready',{timeout:20000*scale});
 await until(async()=>(await notices())[1].body===ENDED_TEXT,'the message says it ended after a reset',60000);
 assert.deepEqual(alice.errors,[]);
 console.log('PASS later broadcast: announced again on the same key, not to a muted member or a bot; a drop and return inside 10 minutes tells nobody again; the admin connects only while it is live; a reset cuts it off');
}finally{await browser.close();stub.close();}
