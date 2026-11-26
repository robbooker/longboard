// #508 Stage mode: "Raise hand" for everyone watching (localhost:3508, database 127.0.0.1:54708).
// Nothing real is reached: LiveKit is this test's own stand-in on 127.0.0.1:54633 (as in
// chat-stage-video-browser.mjs, plus the room's participants and their attributes), and the player's
// connection is a stand-in too: it joins that stand-in room under the identity in its viewer token,
// and tells the page who has a hand up, as LiveKit does. Alice is a chat admin (the host); Bob and
// Mallory are members. The broadcast is started and ended in the stand-in itself, not through the
// admin's "Live video" card (that card is another test's business).
//  - someone who cannot read the room is refused; a member cannot raise or lower anyone else's
//    hand, cannot "lower all", and cannot raise a hand while the room is not live;
//  - everyone watching has a real "Raise hand" button (aria-pressed); the old sample button is gone;
//  - Bob raises: his button reads "Lower hand", pressed, with "1 hand up"; Alice's "Hands up" list
//    shows his chat name and how long ago; Mallory sees "1 hand up", and pressing that count opens
//    the same list for her, read-only (no Lower buttons), laid over the top of the room chat: it
//    does not cover the video and moves nothing;
//  - Mallory raises: Alice's list and Mallory's are Bob then Mallory (oldest first); everyone counts 2;
//  - Bob watching in a second tab with a hand up there too still counts once;
//  - Alice lowers Bob's hand (both tabs): Bob's button is back to "Raise hand"; Mallory lowers her own;
//  - "Lower all" clears every hand;
//  - a member who leaves the stage takes their hand with them, and comes back with it down;
//  - when the broadcast ends every hand is gone, and the next broadcast starts with none.
// CHAT_SHOT_DIR saves member-raise.png, member-raised.png, member-hands-list.png and admin-hands-list.png.
import assert from 'node:assert/strict';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
import {checkStageLooks} from './stage-theme-checks.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3508',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54708',STUB='http://127.0.0.1:54633';
for(const url of [base,fixture,STUB])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,scale=Number(process.env.CHAT_TIMING_SCALE||1);
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ALICE='00000000-0000-4000-8000-000000000001',BOB='00000000-0000-4000-8000-000000000002',MALLORY='00000000-0000-4000-8000-000000000003';

// The stand-in LiveKit: Twirp over JSON, as livekit-server-sdk speaks it. One ingress, and the
// people in the room chat-main: identity -> {name, attributes}.
const lk={ingresses:new Map(),publishing:false,people:new Map(),calls:[],updates:[]};
const info=(room,i)=>({ingress_id:i.id,name:room,stream_key:'FAKE-STREAM-KEY-for-tests-only',url:'rtmps://fake-livekit.example.test/x',input_type:'RTMP_INPUT',room_name:room,participant_identity:'stage-broadcast',reusable:true,state:{status:lk.publishing?'ENDPOINT_PUBLISHING':'ENDPOINT_INACTIVE',room_id:'RM_fake'}});
const person=([identity,p])=>({sid:'PA_'+identity.slice(-8),identity,name:p.name,attributes:p.attributes});
const stub=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);
 const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify(value));};
 const url=new URL(req.url,STUB);
 // The page's stand-in player: join, leave, and "what is the room like now".
 // (#522: a member's two tabs sit in the member's two seats; the server asks who holds each one.)
 if(url.pathname==='/test/join'){const tab=url.searchParams.get('tab');lk.people.set(url.searchParams.get('identity'),{name:url.searchParams.get('name'),joinedAt:Date.now(),attributes:tab?{tab}:{}});return send({});}
 if(url.pathname==='/test/leave'){lk.people.delete(url.searchParams.get('identity'));return send({});}
 if(url.pathname==='/test/state')return send({started:lk.ingresses.size>0,publishing:lk.ingresses.size>0&&lk.publishing,
  hands:[...lk.people].filter(([,p])=>p.attributes.hand).map(([identity,p])=>({identity,name:p.name,hand:p.attributes.hand}))});
 const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'):{};
 const call=req.url.replace('/twirp/livekit.','');lk.calls.push(call);
 assert.match(req.headers.authorization??'',/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,'the server signs its LiveKit calls');
 const room=body.room_name??body.roomName??body.room;
 if(call==='Ingress/ListIngress')return send({items:[...lk.ingresses].filter(([name])=>!room||name===room).map(([name,i])=>info(name,i))});
 if(call==='RoomService/ListRooms')return send({rooms:[]});
 if(call==='RoomService/GetParticipant'){const found=room==='chat-main'?lk.people.get(body.identity):null;
  return found?send({...person([body.identity,found]),joined_at_ms:String(found.joinedAt)}):send({code:'not_found',msg:'participant does not exist'},404);}
 if(call==='RoomService/ListParticipants')return room==='chat-main'&&lk.ingresses.size?send({participants:[...lk.people].map(person)}):send({code:'not_found',msg:'requested room does not exist'},404);
 if(call==='RoomService/UpdateParticipant'){
  const found=room==='chat-main'?lk.people.get(body.identity):null;
  lk.updates.push({identity:body.identity,attributes:body.attributes,keys:Object.keys(body).sort().join(',')});
  if(!found)return send({code:'not_found',msg:'participant does not exist'},404);
  // As LiveKit does: an attribute set to "" is removed.
  for(const [key,value] of Object.entries(body.attributes??{})){if(value)found.attributes[key]=value;else delete found.attributes[key];}
  return send(person([body.identity,found]));}
 return send({code:'unimplemented',msg:call},501);
});
await new Promise(r=>stub.listen(54633,'127.0.0.1',r));
// The broadcast, switched in the stand-in. Ending it empties the LiveKit room, as deleting it does.
const startBroadcast=()=>{lk.ingresses.set('chat-main',{id:'IN_fake1'});lk.publishing=true;};
const endBroadcast=()=>{lk.ingresses.clear();lk.publishing=false;lk.people.clear();};
const raisedIn=()=>[...lk.people].filter(([,p])=>p.attributes.hand).map(([identity])=>identity).sort();

// The page's stand-in for the LiveKit connection (see components/chat/stage/stageFeed.ts).
const fakeFeed=stubUrl=>{
 window.__stageFeed={identities:[]};
 window.__chatStageFeedForTests=async({token,video,events})=>{
  const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))),identity=claims.sub;
  window.__stageFeed.identities.push(identity);window.__stageFeed.grant=claims.video;
  const tell=path=>fetch(`${stubUrl}/test/${path}?identity=${encodeURIComponent(identity)}&name=${encodeURIComponent(claims.name??'')}&tab=${encodeURIComponent(claims.attributes?.tab??'')}`,{keepalive:true}).catch(()=>{});
  await tell('join');
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');let tick=0;
  const draw=()=>{tick++;const g=ctx.createLinearGradient(0,0,1280,720);g.addColorStop(0,'#16324f');g.addColorStop(1,'#3b1f4a');ctx.fillStyle=g;ctx.fillRect(0,0,1280,720);
   ctx.fillStyle='rgba(255,255,255,.14)';ctx.fillRect((tick*9)%1280,0,90,720);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='700 64px sans-serif';ctx.fillText('TEST VIDEO',640,340);
   ctx.font='400 30px sans-serif';ctx.fillText('A drawn picture standing in for the broadcast',640,400);};
  draw();const drawing=setInterval(draw,100),stream=canvas.captureStream(10);
  let on=false,closed=false,told='[]';
  events.connection('connected');events.audioBlocked(false);events.viewers(3);
  const poll=setInterval(async()=>{
   const state=await fetch(stubUrl+'/test/state').then(r=>r.json()).catch(()=>null);if(closed||!state)return;
   if(!state.started){events.hands?.([]);events.video(false);events.connection('ended');clearInterval(poll);return;}
   if(state.publishing&&!on){on=true;video.srcObject=stream;void video.play().catch(()=>{});events.video(true);}
   else if(!state.publishing&&on){on=false;video.srcObject=null;events.video(false);}
   // Like LiveKit: told only when someone's hand changes.
   const hands=JSON.stringify(state.hands);if(hands!==told){told=hands;events.hands?.(state.hands);}
  },150);
  return {startAudio:async()=>{},setVolume:()=>{},close:()=>{closed=true;clearInterval(poll);clearInterval(drawing);void tell('leave');}};
 };
};

await sql("update profiles set role='admin' where email='alice@example.test'");
await sql("update profiles set role='user' where email in ('bob@example.test','mallory@example.test')");
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const LB='textarea[aria-label="Message LB"]';
const waitPlayer=(page,state)=>page.waitForFunction(s=>document.querySelector('[data-stage-video]')?.dataset.stageVideoState===s,{timeout:30000*scale},state);
const newPage=async who=>{const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:900});await page.evaluateOnNewDocument(fakeFeed,STUB);return {who,context,page,errors};};
// The stage for LB, opened by its link while the room is live.
const openStage=async person=>{const page=person.page;
 if(!page.url().startsWith(base))await signIn(page,base,`${person.who}@example.test`,{composer:LB,next:'/chat?room=main&stage=1'});
 else{await page.goto('about:blank');await page.goto(base+'/chat?room=main&stage=1');}
 await page.waitForSelector('[data-stage-root]',{timeout:60000*scale});await waitPlayer(page,'live');
 await page.waitForSelector('[data-stage-hand]',{timeout:20000*scale});};
// This page's own connection to the stand-in room (the newest one).
const identityOf=page=>page.evaluate(()=>window.__stageFeed.identities.at(-1));
// What the top bar says about hands, and (an admin) the "Hands up" list.
const hands=page=>page.evaluate(()=>{const text=e=>e?.textContent.replace(/\s+/g,' ').trim()??null,button=document.querySelector('[data-stage-hand]'),list=document.querySelector('[data-stage-hands]');
 return {button:text(button),pressed:button?.getAttribute('aria-pressed')??null,tag:button?.tagName??null,count:text(document.querySelector('[data-stage-hand-count]'))??'',
  bar:document.querySelector('[data-stage-root] header').innerText.replace(/\s+/g,' '),
  list:list&&{names:[...list.querySelectorAll('[data-stage-hand-name]')].map(text),ago:[...list.querySelectorAll('[data-stage-hand-ago]')].map(text),
   lowerAll:!!list.querySelector('[data-stage-hands-lower-all]'),lowers:list.querySelectorAll('[data-stage-hand-lower]').length,title:text(list.querySelector('h2')),words:list.innerText.replace(/\s+/g,' '),column:list.closest('[data-stage-column]')?.dataset.stageColumn??null}};});
const until=async(page,check,what,ms=8000)=>{const began=Date.now();let last;while(Date.now()-began<ms*scale){last=await hands(page);if(check(last))return last;await sleep(50);}assert.fail(`${what}: ${JSON.stringify(last)}`);};
const ask=(page,body)=>page.evaluate(async b=>{const r=await fetch('/api/chat/stage/hand',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return [r.status,(await r.json().catch(()=>({}))).error??null];},body);
const shot=async(page,name)=>{if(!shots)return;await page.waitForFunction(()=>document.querySelector('[data-stage-video-feed]')?.videoWidth>0);await sleep(400);await page.screenshot({path:`${shots}/${name}.png`});};
try{
 const alice=await newPage('alice'),bob=await newPage('bob'),mallory=await newPage('mallory');
 const a=alice.page,b=bob.page,m=mallory.page;
 startBroadcast();
 // Mallory is not in LB yet: she cannot read the room, so she has no say about hands in it.
 await signIn(m,base,'mallory@example.test');
 assert.deepEqual(await ask(m,{room:'main',identity:`${'0'.repeat(8)}#0000000a`,raised:true}),[403,'room_forbidden'],'someone who cannot read the room is refused');
 assert.deepEqual(await ask(m,{room:'main',all:true,raised:false}),[403,'room_forbidden']);
 assert.deepEqual(lk.calls.filter(c=>/Participant/.test(c)),[],'and LiveKit is asked nothing about hands for her');
 await sql("insert into user_tags(user_id,tag) values($1,'boardroom-cohort-1') on conflict do nothing",[MALLORY]);
 console.log('PASS someone who cannot read the room is refused');

 await openStage(alice);await openStage(bob);await openStage(mallory);
 const members=Object.fromEntries((await sql('select user_id,id,display_name from longboard_chat_members where user_id=any($1::uuid[])',[[ALICE,BOB,MALLORY]])).map(r=>[r.user_id,r]));
 const bobName=members[BOB].display_name,malloryName=members[MALLORY].display_name;
 assert(bobName&&malloryName&&bobName!==malloryName);
 const bobId=await identityOf(b),malloryId=await identityOf(m),aliceId=await identityOf(a);
 assert.match(bobId,new RegExp(`^${members[BOB].id}#[0-9a-f]{8}$`),'a viewer is in the LiveKit room as their member id plus a connection suffix');
 // Watch-only, as before: a viewer's token cannot change their own details or send data.
 for(const page of [a,b,m])assert.deepEqual(await page.evaluate(()=>{const g=window.__stageFeed.grant;return [g.room,g.canPublish,g.canPublishData,g.canUpdateOwnMetadata];}),['chat-main',false,false,false]);

 // Everyone watching has the button; nobody has a hand up.
 for(const [who,page] of [['Alice',a],['Bob',b],['Mallory',m]]){const h=await hands(page);
  assert.deepEqual([h.button,h.pressed,h.tag,h.count],['Raise hand','false','BUTTON',''],`${who}: ${JSON.stringify(h)}`);
  assert(!/sample|preview/i.test(h.button));}
 assert.equal((await hands(b)).list,null,'no list to open while nobody has a hand up');assert.equal((await hands(m)).list,null);assert.equal(await m.$('[data-stage-hands-toggle]'),null);
 {const h=await hands(a);assert.equal(h.list.column,'trades','the admin\'s list is in the middle column, off the video');assert.equal(h.list.title,'Hands up');assert.deepEqual(h.list.names,[]);assert.match(h.list.words,/Nobody has a hand up/);assert(!/sample/i.test(h.list.words),'the list is not a sample');}
 assert.equal(await b.$('[data-stage-column="trades"]'),null,'a member still has no trades, questions or chapters');
 assert.match(await a.$eval('[data-stage-column="trades"]',e=>e.textContent),/Trade tape · sample.*Question queue · sample/s);
 await shot(b,'member-raise');
 console.log('PASS everyone watching has a real Raise hand button; the admin has the Hands up list in the middle column');

 // A member cannot act for anyone else.
 assert.deepEqual(await ask(b,{room:'main',identity:malloryId,raised:true}),[403,'not_your_hand'],'a member cannot raise someone else\'s hand');
 assert.deepEqual(await ask(b,{room:'main',identity:aliceId,raised:true}),[403,'not_your_hand']);
 assert.deepEqual(await ask(b,{room:'main',identities:[bobId,malloryId],raised:false}),[403,'not_your_hand']);
 assert.deepEqual(await ask(b,{room:'main',all:true,raised:false}),[403,'admin_only'],'a member cannot lower all');
 assert.deepEqual(await ask(b,{room:'main',identity:'stage-broadcast',raised:true}),[400,'invalid_identity']);
 assert.deepEqual(lk.updates,[],'none of that reached LiveKit');
 assert.deepEqual(await ask(a,{room:'main',identity:bobId,raised:true}),[403,'not_your_hand'],'an admin cannot raise someone else\'s hand either');

 // Bob raises his hand.
 const before=Date.now();
 await b.click('[data-stage-hand]');
 {const h=await until(b,h=>h.pressed==='true'&&h.count==='1 hand up','Bob\'s hand is up');assert.equal(h.button,'Lower hand');assert.equal(h.list,null);}
 assert.deepEqual(raisedIn(),[bobId],'saved on Bob\'s own LiveKit participant');
 {const [update]=lk.updates;assert.equal(update.identity,bobId);assert.match(update.attributes.hand,/^\d{13}$/);assert(Number(update.attributes.hand)>=before-1000&&Number(update.attributes.hand)<=Date.now()+1000,'the hand holds when it was raised');
  assert(!/metadata|permission|name/.test(update.keys),`only the hand is changed: ${update.keys}`);}
 {const h=await until(a,h=>h.list.names.length===1,'Alice sees one hand');assert.deepEqual(h.list.names,[bobName],'by the name he has in chat');assert.equal(h.list.title,'Hands up · 1');assert.match(h.list.ago[0],/^(just now|\d+ sec ago)$/);assert.equal(h.list.lowerAll,false,'no "Lower all" for one hand');
  assert.equal(h.count,'1 hand up','the admin\'s top bar counts too');assert.equal(h.pressed,'false','the admin\'s own hand is not up');}
 {const h=await until(m,h=>h.count==='1 hand up','Mallory sees the count');assert.deepEqual([h.button,h.pressed,h.list],['Raise hand','false',null]);
  assert.equal(await m.$('[data-stage-hand-lower],[data-stage-hands-lower-all]'),null);}
 // A member opens the list from the count: the same names, read-only, over the top of the room chat.
 {const boxes=()=>m.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {x:Math.round(b.left),y:Math.round(b.top),right:Math.round(b.right),bottom:Math.round(b.bottom)};};
   return {panel:r('[data-stage-hands-panel]'),video:r('[data-stage-video]'),stage:r('[data-stage-column="stage"]'),chat:r('[data-stage-root] ~ section'),log:r('[data-stage-root] ~ section [role="log"]'),bar:r('[data-stage-root] > header'),width:window.innerWidth,sideways:document.documentElement.scrollWidth>window.innerWidth};});
  const closed=await boxes();assert.equal(closed.panel,null);
  assert.equal(await m.$eval('[data-stage-hands-toggle]',e=>e.getAttribute('aria-expanded')),'false');
  await m.click('[data-stage-hands-toggle]');
  const h=await until(m,h=>h.list?.names.length===1,'Mallory opens the list');
  assert.deepEqual(h.list.names,[bobName],'a member sees who has a hand up, by the name he has in chat');assert.match(h.list.ago[0],/^(just now|\d+ sec ago)$/);assert.equal(h.list.title,'Hands up · 1');
  assert.deepEqual([h.list.lowers,h.list.lowerAll],[0,false],'read-only for a member: no Lower, no Lower all');
  assert.equal(await m.$eval('[data-stage-hands-toggle]',e=>e.getAttribute('aria-expanded')),'true');
  const open=await boxes(),at=JSON.stringify(open);
  assert(open.panel.x>=open.stage.right&&open.panel.right<=open.width,`the list sits over the room chat column, off the video: ${at}`);
  assert(open.panel.x>=open.video.right,`it does not cover the video: ${at}`);assert(open.panel.y>=open.bar.bottom,at);
  for(const part of ['video','stage','chat','log','bar'])assert.deepEqual(open[part],closed[part],`opening the list moves nothing (${part}): ${at}`);
  assert(!open.sideways);}
 await shot(b,'member-raised');
 console.log('PASS a member raises: their own button, a count, and the names for everyone watching (read-only for members)');

 // Mallory raises after him: oldest first.
 await sleep(1100);
 await m.click('[data-stage-hand]');
 {const h=await until(a,h=>h.list.names.length===2,'Alice sees two hands');assert.deepEqual(h.list.names,[bobName,malloryName],'in the order raised, oldest first');assert.equal(h.list.title,'Hands up · 2');assert.equal(h.list.lowerAll,true);assert.equal(h.count,'2 hands up');}
 {const h=await until(b,h=>h.count==='2 hands up','Bob counts two');assert.deepEqual([h.button,h.pressed,h.list],['Lower hand','true',null]);}
 // Mallory's open list follows along: oldest first, and still nothing to lower with.
 {const h=await until(m,h=>h.count==='2 hands up'&&h.list?.names.length===2,'Mallory\'s list has two');assert.deepEqual([h.button,h.pressed],['Lower hand','true']);
  assert.deepEqual(h.list.names,[bobName,malloryName],'oldest first for a member too');assert.deepEqual([h.list.lowers,h.list.lowerAll],[0,false]);}
 await shot(m,'member-hands-list');
 // #510: a member's open hands list and count, in every theme and colour combination.
 await checkStageLooks(m,{ring:false});
 assert.equal((await hands(m)).list?.names.length,2,'the list stays open through the theme changes');
 await m.click('[data-stage-hands-close]');
 await m.waitForFunction(()=>!document.querySelector('[data-stage-hands-panel]'));
 assert.equal(await m.$eval('[data-stage-hands-toggle]',e=>e.getAttribute('aria-expanded')),'false');
 // Bob is also watching in a second tab, with a hand up there too: still one Bob, still first.
 const bobTab=`${members[BOB].id}#0000beef`;
 lk.people.set(bobTab,{name:bobName,attributes:{hand:String(Date.now())}});
 await sleep(1200);
 {const h=await hands(a);assert.deepEqual(h.list.names,[bobName,malloryName],'two tabs, one hand');assert.equal(h.count,'2 hands up');assert.equal((await hands(m)).count,'2 hands up');}
 await a.evaluate(()=>document.querySelector('[data-stage-hands]').scrollIntoView({block:'nearest'}));
 await shot(a,'admin-hands-list');
 // #510: the admin's hands list (two rows, the first tinted, Lower and Lower all) in every look.
 await checkStageLooks(a,{each:async look=>{const rows=await a.$$eval('[data-stage-hand-of]',r=>r.length);assert.equal(rows,2,`${look.id}: both hands are listed`);if(shots&&look.id==='light')await a.screenshot({path:`${shots}/admin-hands-list-light.png`});}});
 console.log('PASS a second hand: oldest first for everyone, a count of 2, two tabs count once');

 // The admin lowers Bob's hand: in both of his tabs.
 await a.click(`[data-stage-hand-of="${members[BOB].id}"] [data-stage-hand-lower]`);
 {const h=await until(a,h=>h.list.names.length===1,'Bob is off the list');assert.deepEqual(h.list.names,[malloryName]);assert.equal(h.count,'1 hand up');}
 assert.deepEqual(raisedIn(),[malloryId],'lowered in LiveKit, in both of Bob\'s tabs');
 {const h=await until(b,h=>h.pressed==='false','Bob\'s button is back');assert.deepEqual([h.button,h.count],['Raise hand','1 hand up']);}
 // Mallory lowers her own.
 await m.click('[data-stage-hand]');
 {const h=await until(m,h=>h.pressed==='false'&&h.count==='','Mallory\'s hand is down');assert.equal(h.button,'Raise hand');}
 {const h=await until(a,h=>h.list.names.length===0&&h.count==='','nobody on the list');assert.match(h.list.words,/Nobody has a hand up/);}
 assert.deepEqual(raisedIn(),[]);
 console.log('PASS the admin lowers one hand; a member lowers their own');

 // Lower all.
 lk.people.delete(bobTab);
 await b.click('[data-stage-hand]');await until(a,h=>h.list.names.length===1,'Bob again');
 await sleep(1100);
 await m.click('[data-stage-hand]');await until(a,h=>h.list.names.length===2,'and Mallory');
 await a.click('[data-stage-hands-lower-all]');
 await until(a,h=>h.list.names.length===0&&h.count==='','all lowered');
 for(const page of [b,m]){const h=await until(page,h=>h.pressed==='false'&&h.count==='','a member\'s hand is down');assert.equal(h.button,'Raise hand');}
 assert.deepEqual(raisedIn(),[]);
 console.log('PASS Lower all clears every hand');

 // Leaving takes the hand with you; coming back starts with it down.
 await b.click('[data-stage-hand]');await until(a,h=>h.list.names.length===1,'Bob\'s hand is up again');
 await b.click('[data-stage-exit]');
 await b.waitForFunction(()=>!document.querySelector('[data-stage-root]'),{timeout:20000*scale});
 {const h=await until(a,h=>h.list.names.length===0&&h.count==='','Bob left, and his hand with him');assert.match(h.list.words,/Nobody has a hand up/);}
 assert.equal((await until(m,h=>h.count==='','Mallory\'s count is empty too')).button,'Raise hand');
 assert.equal(lk.people.has(bobId),false,'his participant left the LiveKit room with him');
 const leftAt=Date.now();
 await openStage(bob);
 // #522: he is back in one of his own two seats (so possibly under the same identity), as a NEW
 // participant: it joined after he left, and it has no hand.
 const bobAgain=await identityOf(b);assert.match(bobAgain,new RegExp(`^${bobId.split('#')[0]}#0000000[12]$`),'a member\'s connection is always in one of their two seats');
 assert(lk.people.get(bobAgain).joinedAt>=leftAt&&!lk.people.get(bobAgain).attributes.hand,'a new connection is a new participant, hand down');
 {const h=await hands(b);assert.deepEqual([h.button,h.pressed,h.count],['Raise hand','false',''],'back with the hand down');}
 console.log('PASS a hand goes when its owner disconnects, and a fresh connection starts with it down');

 // The broadcast ends: every hand is gone, and the next one starts with none.
 await b.click('[data-stage-hand]');await sleep(1100);await m.click('[data-stage-hand]');
 await until(a,h=>h.list.names.length===2,'two hands before the end');
 endBroadcast();
 await until(a,h=>h.list.names.length===0,'the admin\'s list is empty when the broadcast ends');
 for(const page of [b,m])await page.waitForFunction(()=>!document.querySelector('[data-stage-hand]'),{timeout:20000*scale});
 await sleep(4300); // the server's few seconds' memory of the room's state
 assert.deepEqual(await ask(b,{room:'main',identity:bobAgain,raised:true}),[409,'not_live'],'no hand can be raised while the room is not live');
 await sleep(4300);
 startBroadcast();
 await openStage(mallory);await openStage(alice);
 {const h=await hands(m);assert.deepEqual([h.button,h.pressed,h.count],['Raise hand','false',''],'the next broadcast starts with no hands');}
 {const h=await hands(a);assert.deepEqual(h.list.names,[]);assert.equal(h.count,'');}
 assert.deepEqual(raisedIn(),[]);
 console.log('PASS the end of the broadcast clears every hand');

 for(const person of [alice,bob,mallory])assert.deepEqual(person.errors,[],`${person.who}: no page errors`);
 console.log('PASS chat-stage-hand');
}finally{await browser.close();stub.close();}
