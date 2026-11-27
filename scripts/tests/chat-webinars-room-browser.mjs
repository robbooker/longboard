// #537 The Webinars room: open chat for all-member webinars, announced in every room, with its
// recordings under Recordings > Booker Stock Club (localhost:3537, database 127.0.0.1:54737).
// Nothing real is reached and no real key exists here:
//  - the server's LiveKit calls go to this test's own stand-in on 127.0.0.1:54633 (the manifest's
//    `livekit` preset points LIVEKIT_URL at it); LiveKit's webhooks are sent by the test, signed
//    with the manifest's made-up key and secret; the player's connection is a stand-in too;
//  - Ably is a hub in this test (127.0.0.1:54837, as chat-polls-browser.mjs): the server's publishes
//    reach the pages through it, so "without a reload" is the real signal path.
// Synthetic members and messages only. "Webinar Host" (Alice) is a chat admin; "Sample Member"
// (Bob) and "Second Member" (Mallory) are members.
//  1. signed out, /chat?room=webinars&stage=1 goes to /chat/login?room=webinars; signed in with
//     nothing live, the same link shows the room, with its composer; the sidebar has Webinars
//     under Booker Stock Club and "Booker Stock Club" in the Recordings group;
//  2. the broadcast goes live: the room's notice appears without a reload; the member posts and
//     replies; the stage link now opens the stage, where the member raises a hand and posts from
//     the chat beside the video; a phone has the room, the viewing room, the hand and the chat;
//  3. every other member room has the bot's notice (Social shown, on a page that was not
//     reloaded), with a Watch live link that opens the Webinars stage; the copies wrote no bell
//     entry and no phone job, and each member has one bell entry in all; Booker Stock Club has the
//     notice and is still read-only for members; Gainers and Admins have none;
//  4. a short drop posts nothing again; the end: every notice says it ended, without a reload;
//  5. an admin posts the recording in Recordings > Booker Stock Club: the Webinars notice and
//     every copy link it; a member cannot post in the recordings room.
// CHAT_SHOT_DIR saves webinars-sidebar.png, webinars-live-desktop.png, webinars-live-stage.png,
// webinars-live-phone.png, webinars-live-phone-viewing-room.png, webinars-notice-in-social.png,
// webinars-notice-in-club.png, webinars-ended-in-social.png and webinars-recordings-room.png.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import msgpack from '@ably/msgpack-js';
import {AccessToken} from 'livekit-server-sdk';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3537',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54737',STUB='http://127.0.0.1:54633';
for(const url of [base,fixture,STUB])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,scale=Number(process.env.CHAT_TIMING_SCALE||1);
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);const j=JSON.parse(text);return j.rows??j;};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(check,what,ms=30000)=>{for(let waited=0;;waited+=200){const value=await check();if(value)return value;assert(waited<ms*scale,`timed out: ${what}`);await sleep(200);}};
// For "nothing happens": the check must hold for the whole stretch (it is looked at every 200ms).
const stays=async(check,what,ms=2000)=>{for(let waited=0;waited<ms;waited+=200){assert(await check(),`did not stay so: ${what}`);await sleep(200);}};
const ALICE='00000000-0000-4000-8000-000000000001',BOB='00000000-0000-4000-8000-000000000002',MALLORY='00000000-0000-4000-8000-000000000003';
const READ_ONLY='Booker Stock Club is a read-only channel.',ADMINS_ONLY='Only admins can post in announcement and recording channels.';
// The 20 seconds a stopped broadcast is given to come back (lib/chatStageNotify.ts STAGE_DROP_GRACE_MS).
const GRACE_MS=20_000;

// The stand-in LiveKit: Twirp over JSON, as livekit-server-sdk speaks it. One ingress per room, and
// the people in the Webinars video room: identity -> {name, attributes}.
const lk={rooms:new Map(),people:new Map(),calls:[]};
const ns=ms=>String(BigInt(ms)*1000000n);
const info=(room,i)=>({ingress_id:i.id,name:room,stream_key:i.key,url:'rtmps://fake-livekit.example.test/x',input_type:'RTMP_INPUT',room_name:room,participant_identity:'stage-broadcast',reusable:true,
 state:{status:i.publishing?'ENDPOINT_PUBLISHING':'ENDPOINT_INACTIVE',room_id:'RM_fake',...(i.startedAt?{started_at:ns(i.startedAt)}:{}),...(i.endedAt?{ended_at:ns(i.endedAt)}:{})}});
const person=([identity,p])=>({sid:'PA_'+identity.slice(-8),identity,name:p.name,attributes:p.attributes});
const stub=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);
 const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify(value));};
 const url=new URL(req.url,STUB),live=lk.rooms.get('chat-webinars');
 // The page's stand-in player: join, leave, and "what is the room like now".
 if(url.pathname==='/test/join'){const tab=url.searchParams.get('tab');lk.people.set(url.searchParams.get('identity'),{name:url.searchParams.get('name'),joinedAt:Date.now(),attributes:tab?{tab}:{}});return send({});}
 if(url.pathname==='/test/leave'){lk.people.delete(url.searchParams.get('identity'));return send({});}
 if(url.pathname==='/test/state')return send({started:!!live,publishing:!!live?.publishing,
  hands:[...lk.people].filter(([,p])=>p.attributes.hand).map(([identity,p])=>({identity,name:p.name,hand:p.attributes.hand}))});
 const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'):{};
 const call=req.url.replace('/twirp/livekit.',''),room=body.room_name??body.roomName??body.room;lk.calls.push(`${call} ${room??''}`.trim());
 assert.match(req.headers.authorization??'',/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,'the server signs its LiveKit calls');
 if(call==='Ingress/ListIngress')return send({items:[...lk.rooms].filter(([name])=>!room||name===room).map(([name,i])=>info(name,i))});
 if(call==='Ingress/CreateIngress'){const i={id:`IN_fake_${lk.rooms.size+1}`,key:`FAKE-STREAM-KEY-for-tests-only-${lk.rooms.size+1}`,publishing:false};lk.rooms.set(room,i);return send(info(room,i));}
 if(call==='RoomService/ListRooms')return send({rooms:[]});
 // #522: the room is closed half a minute after a broadcast stops.
 if(call==='RoomService/DeleteRoom'){if(room==='chat-webinars')lk.people.clear();return send({});}
 if(call==='RoomService/GetParticipant'){const found=room==='chat-webinars'?lk.people.get(body.identity):null;
  return found?send({...person([body.identity,found]),joined_at_ms:String(found.joinedAt)}):send({code:'not_found',msg:'participant does not exist'},404);}
 if(call==='RoomService/ListParticipants')return room==='chat-webinars'&&live?send({participants:[...lk.people].map(person)}):send({code:'not_found',msg:'requested room does not exist'},404);
 if(call==='RoomService/UpdateParticipant'){const found=room==='chat-webinars'?lk.people.get(body.identity):null;
  if(!found)return send({code:'not_found',msg:'participant does not exist'},404);
  // As LiveKit does: an attribute set to "" is removed.
  for(const [key,value] of Object.entries(body.attributes??{})){if(value)found.attributes[key]=value;else delete found.attributes[key];}
  return send(person([body.identity,found]));}
 return send({code:'unimplemented',msg:call},501);
});
await new Promise(r=>stub.listen(54633,'127.0.0.1',r));
const WEBHOOK_KEY='APIsyntheticNeverReal',WEBHOOK_SECRET='synthetic-livekit-secret-never-a-production-secret';
let webhookNumber=0;
const webhook=async(event,room)=>{const body=JSON.stringify({event,id:`EV_webinars_${++webhookNumber}`,room:{name:`chat-${room}`}}),signer=new AccessToken(WEBHOOK_KEY,WEBHOOK_SECRET);
 signer.sha256=createHash('sha256').update(body).digest('base64');
 const r=await fetch(base+'/api/chat/stage/livekit-webhook',{method:'POST',headers:{'content-type':'application/webhook+json',authorization:await signer.toJwt()},body});assert.equal(r.status,200,`webhook ${event}`);};
const starts=async room=>{const i=lk.rooms.get(`chat-${room}`);assert(i,`${room} has its key`);Object.assign(i,{publishing:true,startedAt:Date.now()-1500,endedAt:0});await webhook('ingress_started',room);};
const stops=async room=>{Object.assign(lk.rooms.get(`chat-${room}`),{publishing:false,endedAt:Date.now()});await webhook('ingress_ended',room);};
const raisedIn=()=>[...lk.people].filter(([,p])=>p.attributes.hand).map(([identity])=>identity).sort();

// The page's stand-in for the LiveKit connection (see components/chat/stage/stageFeed.ts).
const fakeFeed=stubUrl=>{
 window.__stageFeed={identities:[]};
 window.__chatStageFeedForTests=async({token,video,events})=>{
  const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))),identity=claims.sub;
  window.__stageFeed.identities.push(identity);
  const tell=path=>fetch(`${stubUrl}/test/${path}?identity=${encodeURIComponent(identity)}&name=${encodeURIComponent(claims.name??'')}&tab=${encodeURIComponent(claims.attributes?.tab??'')}`,{keepalive:true}).catch(()=>{});
  await tell('join');
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');let tick=0;
  const draw=()=>{tick++;const g=ctx.createLinearGradient(0,0,1280,720);g.addColorStop(0,'#16324f');g.addColorStop(1,'#3b1f4a');ctx.fillStyle=g;ctx.fillRect(0,0,1280,720);
   ctx.fillStyle='rgba(255,255,255,.14)';ctx.fillRect((tick*9)%1280,0,90,720);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='700 64px sans-serif';ctx.fillText('TEST VIDEO',640,340);
   ctx.font='400 30px sans-serif';ctx.fillText('A drawn picture standing in for the webinar',640,400);};
  draw();const drawing=setInterval(draw,100),stream=canvas.captureStream(10);
  let on=false,closed=false,told='[]';
  events.connection('connected');events.audioBlocked(false);events.viewers(3);
  const poll=setInterval(async()=>{
   const state=await fetch(stubUrl+'/test/state').then(r=>r.json()).catch(()=>null);if(closed||!state)return;
   if(!state.started){events.hands?.([]);events.video(false);events.connection('ended');clearInterval(poll);return;}
   if(state.publishing&&!on){on=true;video.srcObject=stream;void video.play().catch(()=>{});events.video(true);}
   else if(!state.publishing&&on){on=false;video.srcObject=null;events.video(false);}
   const hands=JSON.stringify(state.hands);if(hands!==told){told=hands;events.hands?.(state.hands);}
  },200);
  return {startAudio:async()=>{},setVolume:()=>{},close:()=>{closed=true;clearInterval(poll);clearInterval(drawing);void tell('leave');}};
 };
};

// --- Fake Ably realtime (as chat-polls-browser.mjs) plus the server's REST publishes. ---
const conns=new Map();let serial=0;const published=[];
const decode=token=>JSON.parse(Buffer.from(token.replace(/^fake\./,''),'base64url').toString());
function deliver(conn,frame){void conn.page.evaluate((id,f)=>window.__ablyFakeDeliver(id,f),conn.id,JSON.stringify(frame)).catch(()=>{});}
function connected(conn){deliver(conn,{action:4,connectionId:`c${conn.key}:${++serial}`,connectionDetails:{clientId:conn.clientId,connectionKey:`k${conn.key}:${serial}`,maxMessageSize:65536,maxFrameSize:524288,maxInboundRate:250,connectionStateTtl:120000,maxIdleInterval:0,serverId:'fake'}});}
function grant(conn,token){const t=decode(token);conn.clientId=t.clientId;conn.capability=JSON.parse(t.capability);}
function frame(page,who,id,kind,data){
 const key=`${who}:${id}`;
 if(kind==='open'){const conn={page,who,id,key,channels:new Set()};grant(conn,new URL(data).searchParams.get('access_token'));conns.set(key,conn);connected(conn);return;}
 const conn=conns.get(key);if(!conn)return;
 if(kind==='close'){conns.delete(key);return;}
 const m=JSON.parse(data),can=op=>conn.capability[m.channel]?.includes(op);
 if(m.action===0)return deliver(conn,{action:0});
 if(m.action===17){grant(conn,m.auth.accessToken);return connected(conn);}
 if(m.action===10){if(!can('subscribe'))return deliver(conn,{action:9,channel:m.channel,error:{code:40160,statusCode:401,message:'Channel denied'}});conn.channels.add(m.channel);return deliver(conn,{action:11,channel:m.channel,flags:(can('publish')?131072:0)|262144});}
 if(m.action===12){conn.channels.delete(m.channel);return deliver(conn,{action:13,channel:m.channel});}
 if(m.action===7)return deliver(conn,{action:8});
 if(m.action===15)return deliver(conn,{action:1,msgSerial:m.msgSerial,count:m.messages.length});
}
async function fakeAbly(page,who){
 await page.exposeFunction('__ablyFake',(id,kind,data)=>frame(page,who,id,kind,data));
 await page.evaluateOnNewDocument(()=>{
  const Real=window.WebSocket,open=new Map();let n=0;
  window.__ablyFakeDeliver=(id,f)=>open.get(id)?.onmessage?.({data:f});
  class Fake{
   static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
   constructor(url,protocols){
    if(!String(url).includes('ably'))return new Real(url,protocols);
    this.url=String(url);this.readyState=0;this.id=++n;this.binaryType='blob';open.set(this.id,this);
    setTimeout(()=>{this.readyState=1;this.onopen?.({});window.__ablyFake(this.id,'open',this.url);},0);
   }
   send(data){window.__ablyFake(this.id,'frame',String(data));}
   close(){if(this.readyState===3)return;this.readyState=3;open.delete(this.id);window.__ablyFake(this.id,'close','');setTimeout(()=>this.onclose?.({code:1000,wasClean:true}),0);}
  }
  window.WebSocket=Fake;
 });
 await page.setRequestInterception(true);
 page.on('request',request=>{
  if(!request.url().includes('/requestToken'))return void request.continue();
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(request.method()==='OPTIONS')return void request.respond({status:204,headers:cors});
  const body=JSON.parse(request.postData()),token='fake.'+Buffer.from(JSON.stringify({clientId:body.clientId,capability:body.capability})).toString('base64url');
  void request.respond({status:200,contentType:'application/json',headers:cors,body:JSON.stringify({token,keyName:body.keyName,issued:Date.now(),expires:Date.now()+3600e3,capability:body.capability,clientId:body.clientId})});
 });
}
const hub=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
 const match=req.url.match(/^\/channels\/([^/]+)\/messages/);
 if(req.method!=='POST'||!match){res.writeHead(404);return res.end();}
 const channel=decodeURIComponent(match[1]),raw=Buffer.concat(chunks);
 const body=String(req.headers['content-type']).includes('msgpack')?msgpack.decode(raw):JSON.parse(raw.toString());
 const messages=(Array.isArray(body)?body:[body]).map(x=>({...x,data:typeof x.data==='string'||Buffer.isBuffer(x.data)?String(x.data):JSON.stringify(x.data),encoding:typeof x.data==='string'||Buffer.isBuffer(x.data)?x.encoding:'json',id:`s${++serial}:0`,timestamp:Date.now()}));
 const at=Date.now();
 for(const x of messages)published.push({channel,at,name:x.name,data:JSON.parse(x.data)});
 res.writeHead(201,{'content-type':'application/json'});res.end('{}');
 for(const conn of conns.values())if(conn.channels.has(channel))deliver(conn,{action:15,channel,id:`p${serial}`,connectionId:'server',timestamp:at,messages});
});});
await new Promise(r=>hub.listen(54837,'127.0.0.1',r));
const channelOf=room=>`private:chat:room:${room}`;
const attached=(who,room)=>until(()=>[...conns.values()].some(c=>c.who===who&&c.channels.has(channelOf(room))),`${who} joined ${room}'s Ably channel`);

await sql("update profiles set role='admin' where email='alice@example.test'");
await sql("update profiles set role='user' where email in ('bob@example.test','mallory@example.test')");
// Neutral chat names for the pictures.
await sql(`update longboard_chat_members m set display_name=n.name from (values('alice@example.test','Webinar Host'),('bob@example.test','Sample Member'),('mallory@example.test','Second Member')) n(email,name),profiles p where p.email=n.email and m.user_id=p.id`);
const members=Object.fromEntries((await sql('select user_id,id from longboard_chat_members where user_id=any($1::uuid[])',[[ALICE,BOB,MALLORY]])).map(r=>[r.user_id,r.id]));
const HOST_POST='Welcome to the Webinars room! Tonight\'s session starts at 7 PM Central. Say hello below.';
const hostPost=(await sql(`select send_chat_room_message($1,'webinars',$2,null,'{}'::uuid[],$3) r`,[ALICE,HOST_POST,'00000000-0000-4000-8000-000000537001']))[0].r;
assert.equal(hostPost.status,'sent',JSON.stringify(hostPost));
const hostPostId=hostPost.message.id;
const rowsOf=room=>sql(`select id,member_id,bot_slug,body,reply_to_id,deleted_at from longboard_chat_messages where room_slug=$1 and not removed order by created_at,unread_seq`,[room]);
const LIVE_RE=/Webinars is live now/,ENDED_TEXT='The live video in Webinars has ended. The recording will follow.';
const YT='https://www.youtube.com/watch?v=dQw4w9WgXcQ';
// Every member room but Webinars itself, Admins and Gainers.
const COPY_ROOMS=['main','social','shortscout','lb-announcements','ss-announcements','lb-recordings','ss-recordings','club-recordings','whats-new','developers','lb-review','runner-watch','club','ai-insights'];
const notices=()=>sql(`select room_slug,id,body from longboard_chat_messages where bot_slug='longboard' and (body like '%Webinars is live now%' or body like 'The live video in Webinars has ended%') order by room_slug`);

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const COMPOSER='textarea[aria-label="Message Webinars"]';
const DESKTOP={width:1440,height:900},PHONE={width:390,height:844,isMobile:true,hasTouch:true};
const seen=(page,selector)=>page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility({visibilityProperty:true})),selector);
const shown=(page,selector)=>page.evaluateHandle(s=>[...document.querySelectorAll(s)].find(e=>e.checkVisibility({visibilityProperty:true}))??null,selector);
const ready=page=>page.waitForFunction(()=>{const b=[...document.querySelectorAll('button[aria-label="Chat settings"]')].find(e=>e.checkVisibility());return b&&Object.keys(b).some(k=>k.startsWith('__reactProps$'));},{timeout:60000*scale});
// The read-only footer under the room, as its two parts (null when the composer is there instead).
const footer=page=>page.evaluate(()=>{const strong=[...document.querySelectorAll('strong')].find(e=>e.checkVisibility()&&e.textContent==='Read-only');return strong?.parentElement?.innerText.replace(/\s+/g,' ')??null;});
const rowWith=(page,text)=>page.evaluate(text=>{const a=[...document.querySelectorAll('article[id^="chat-message-"]')].find(e=>e.checkVisibility()&&e.innerText.includes(text));
 if(!a)return null;return {pending:!!a.dataset.pending,failed:!!a.dataset.sendFailed,reply:[...a.querySelectorAll('button')].some(b=>/repl/i.test(b.textContent)&&b.checkVisibility()),actions:[...a.querySelectorAll('details button')].some(b=>/^(Edit|Delete)$/.test(b.textContent.trim())),card:!!a.querySelector('[data-club-card]')};},text);
const waitRow=(page,text)=>page.waitForFunction(text=>[...document.querySelectorAll('article[id^="chat-message-"]:not([data-pending])')].some(a=>a.checkVisibility()&&a.innerText.includes(text)),{timeout:30000*scale},text);
const sideways=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
// The pictures leave out the Next.js dev-mode badge (not part of the app).
const shot=async(page,name)=>{if(!shots)return;await sleep(600);await page.evaluate(()=>document.querySelectorAll('nextjs-portal').forEach(e=>e.remove()));await page.screenshot({path:`${shots}/${name}.png`});};
const api=(page,path,payload)=>page.evaluate(async(p,b)=>{const r=await fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const body=await r.json().catch(()=>null);return [r.status,body?.error??'ok'];},path,payload);
// The send rate limit is 1.5 seconds between one member's posts: every send here waits it out first.
const sendApi=async(page,room,body)=>{await sleep(1700);return api(page,'/api/chat',{room,action:'send',clientId:crypto.randomUUID(),...body});};
const change=(page,room,body)=>api(page,'/api/chat/message',{room,...body});
const react=(page,room,messageId,active=true)=>api(page,'/api/chat',{room,action:'react',messageId,active});
// The composer is typed into only once it really has the focus (a page still settling can take it back).
const typeAndSend=async(page,selector,text,tap=false)=>{const field=await shown(page,selector);assert(field.asElement(),`nothing on screen for ${selector}`);
 for(let i=0;;i++){await (tap?field.asElement().tap():field.asElement().click());await sleep(150);if(await field.asElement().evaluate(e=>document.activeElement===e))break;assert(i<20,'the composer never took the focus');}
 await page.keyboard.type(text);await page.keyboard.press('Enter');};
// A page that has not been reloaded still carries what was put on its window.
const mark=page=>page.evaluate(()=>{window.__notReloaded=true;});
const unreloaded=page=>page.evaluate(()=>window.__notReloaded===true);
const newPage=async(who,viewport=DESKTOP)=>{const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>{errors.push(`a browser dialog opened: ${d.message()}`);void d.dismiss().catch(()=>{});});
 await fakeAbly(page,who);
 await page.setViewport(viewport);await page.evaluateOnNewDocument(fakeFeed,STUB);return {who,context,page,errors};};
const noticeRow=(page,re)=>page.evaluate(source=>{const a=[...document.querySelectorAll('article[id^="chat-message-"]')].find(e=>e.checkVisibility()&&new RegExp(source).test(e.innerText));
 if(!a)return null;const link=a.querySelector('[data-stage-notice-watch]');return {text:a.innerText.replace(/\s+/g,' '),href:link?.getAttribute('href')??null,label:link?.textContent??null};},re.source);
const waitNotice=(page,re,ms=60000)=>page.waitForFunction(source=>[...document.querySelectorAll('article[id^="chat-message-"]')].some(e=>e.checkVisibility()&&new RegExp(source).test(e.innerText)),{timeout:ms*scale},re.source);
const openRoom=async(person,room,wait)=>{const page=person.page;
 if(!page.url().startsWith(base))await signIn(page,base,`${person.who.split('-')[0]}@example.test`);
 await page.goto(`${base}/chat?room=${room}`,{waitUntil:'domcontentloaded'});
 await ready(page);await attached(person.who,room);if(wait)await wait(page);await mark(page);};

try{
 // 1. Signed out: the stage link goes through the chat's sign-in, for this room.
 {const out=await newPage('nobody');
  await out.page.goto(`${base}/chat?room=webinars&stage=1`,{waitUntil:'domcontentloaded'});
  await out.page.waitForFunction(()=>location.pathname==='/chat/login',{timeout:60000*scale});
  assert.equal(new URL(out.page.url()).searchParams.get('room'),'webinars','signed out: /chat/login?room=webinars');
  await out.context.close();}
 const alice=await newPage('alice'),bob=await newPage('bob'),bobSocial=await newPage('bob-social');
 const a=alice.page,b=bob.page,c=bobSocial.page;
 await openRoom(alice,'webinars',page=>waitRow(page,'Say hello below'));
 // The host sets the room up once (its stream address and key). Nothing is posted for that.
 assert.deepEqual(await api(a,'/api/chat/stage/live',{room:'webinars',action:'open'}),[200,'ok']);
 assert.equal((await notices()).length,0,'setting the room up announces nothing');
 // Nothing live: the stage link is just the room, with its composer.
 await signIn(b,base,'bob@example.test');
 await b.goto(`${base}/chat?room=webinars&stage=1`,{waitUntil:'domcontentloaded'});
 await ready(b);await attached('bob','webinars');await waitRow(b,'Say hello below');await mark(b);
 await b.waitForFunction(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility()),{timeout:45000*scale},COMPOSER);
 assert.equal(await b.$('[data-stage-root]'),null,'no stage while nothing is live: the link shows the room');
 assert.equal(await footer(b),null,'the room is not read-only');
 // The sidebar: Webinars right under Booker Stock Club; "Booker Stock Club" in the Recordings group.
 const nav=await b.evaluate(()=>{const links=[...document.querySelectorAll('nav[aria-label="Chat rooms"] a[href*="room="]')].filter(e=>e.checkVisibility());
  return links.map(e=>[new URL(e.href).searchParams.get('room'),e.innerText.replace(/\s+/g,' ').trim(),e.dataset.locked??null]);});
 const order=nav.map(r=>r[0]);
 assert.equal(order.indexOf('webinars'),order.indexOf('club')+1,`Webinars is right under Booker Stock Club: ${order}`);
 assert.match(nav.find(r=>r[0]==='webinars')[1],/^Webinars/);assert.equal(nav.find(r=>r[0]==='webinars')[2],null,'not locked for a member');
 const recordingsRow=nav.find(r=>r[0]==='club-recordings');
 assert(recordingsRow,'the recordings room is in the sidebar');assert.match(recordingsRow[1],/^Booker Stock Club\b/);assert.doesNotMatch(recordingsRow[1],/Recordings$/,'the group heading already says Recordings');
 assert.equal(recordingsRow[2],null,'not locked for a member');
 assert(order.indexOf('club-recordings')>order.indexOf('club'),'in its own group, after the rooms');
 if(shots){await sleep(600);await b.evaluate(()=>document.querySelectorAll('nextjs-portal').forEach(e=>e.remove()));await (await b.$('nav[aria-label="Chat rooms"]')).screenshot({path:`${shots}/webinars-sidebar.png`});}
 await openRoom(bobSocial,'social');
 console.log('PASS at rest: signed out goes to /chat/login?room=webinars; the stage link shows the room; the sidebar has both rooms');

 // 2. The broadcast goes live.
 await starts('webinars');
 await waitNotice(b,LIVE_RE);
 assert.equal(await unreloaded(b),true,'the member\'s page was not reloaded');
 {const n=await noticeRow(b,LIVE_RE);assert.equal(n.href,'/chat?room=webinars&stage=1');assert.equal(n.label,'Watch live');assert.match(n.text,/Live Video/);}
 const FIRST='Hello from the webinar! Can everyone hear the host?';
 await typeAndSend(b,COMPOSER,FIRST);
 await waitRow(b,FIRST);
 const first=(await rowsOf('webinars')).find(r=>r.body===FIRST);
 assert(first,'the member\'s post is saved');assert.deepEqual([first.member_id,first.bot_slug],[members[BOB],null],'as the member\'s own post');
 await waitRow(a,FIRST);
 assert.equal((await rowWith(b,FIRST)).actions,true,'the member can change their own post');
 assert.deepEqual(await sendApi(b,'webinars',{body:'Looking forward to it. Thanks for hosting!',replyTo:hostPostId}),[200,'ok'],'a member replies in a thread');
 assert.deepEqual(await react(b,'webinars',hostPostId),[200,'ok'],'and reacts');
 assert.deepEqual(await change(b,'webinars',{messageId:first.id,action:'edit',body:FIRST+' (Yes, loud and clear.)',expectedBody:FIRST}),[200,'ok'],'and edits their own post');
 assert.deepEqual(await change(b,'webinars',{messageId:hostPostId,action:'delete'}),[403,'message_forbidden'],'never someone else\'s');
 await waitRow(b,'loud and clear');
 await b.evaluate(()=>document.activeElement?.blur());
 assert(await sideways(b)<=0,'no sideways scroll');
 await shot(b,'webinars-live-desktop');
 // The stage link now opens the stage: the video, the hand, and the room's chat beside it.
 const bobStage=await newPage('bob-stage');const s=bobStage.page;
 await signIn(s,base,'bob@example.test');
 await s.goto(`${base}/chat?room=webinars&stage=1`);
 await s.waitForSelector('[data-stage-root]',{timeout:60000*scale});
 await s.waitForFunction(()=>document.querySelector('[data-stage-video]')?.dataset.stageVideoState==='live',{timeout:45000*scale});
 await s.waitForSelector('[data-stage-hand]',{timeout:30000*scale});
 await s.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility()),{timeout:45000*scale},COMPOSER);
 assert.equal(await s.$eval('[data-stage-hand]',e=>e.getAttribute('aria-pressed')),'false');
 await s.click('[data-stage-hand]');
 await s.waitForFunction(()=>document.querySelector('[data-stage-hand]')?.getAttribute('aria-pressed')==='true',{timeout:20000*scale});
 const bobIdentity=await s.evaluate(()=>window.__stageFeed.identities.at(-1));
 assert.match(bobIdentity,new RegExp(`^${members[BOB]}#0000000[12]$`));
 assert.deepEqual(raisedIn(),[bobIdentity],'the hand is up on the member\'s own LiveKit participant');
 await s.waitForFunction(()=>/1 hand up/.test(document.querySelector('[data-stage-hand-count]')?.textContent??''),{timeout:20000*scale});
 const STAGE_POST='Posting from beside the video.';
 await sleep(1700);
 await typeAndSend(s,COMPOSER,STAGE_POST);
 await waitRow(s,STAGE_POST);
 await s.waitForFunction(()=>document.querySelector('[data-stage-video-feed]')?.videoWidth>0,{timeout:30000*scale});
 await s.evaluate(()=>document.activeElement?.blur());
 await shot(s,'webinars-live-stage');
 await s.click('[data-stage-hand]');
 await s.waitForFunction(()=>document.querySelector('[data-stage-hand]')?.getAttribute('aria-pressed')==='false',{timeout:20000*scale});
 assert.deepEqual(raisedIn(),[]);
 console.log('PASS live: the notice arrives without a reload; a member posts, replies, reacts, edits; on the stage they raise a hand and post');

 // A phone: the room with its composer; the viewing room with the hand and the chat.
 const mallory=await newPage('mallory',PHONE);const m=mallory.page;
 await signIn(m,base,'mallory@example.test');
 await m.goto(`${base}/chat?room=webinars`,{waitUntil:'domcontentloaded'});
 await m.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility({visibilityProperty:true})),{timeout:90000*scale},COMPOSER);
 await waitRow(m,'loud and clear');
 assert(await sideways(m)<=0,'phone: no sideways scroll');
 await shot(m,'webinars-live-phone');
 await m.goto(`${base}/chat?room=webinars&stage=1`);
 const ROOT='[data-stage-root][data-stage-phone]';
 await m.waitForSelector(ROOT,{timeout:60000*scale});
 await m.waitForFunction(r=>document.querySelector(r)?.dataset.stageVideoState==='live',{timeout:45000*scale},ROOT);
 // The controls fade while the video plays: a tap on the picture brings them back.
 const wake=async()=>{if(await m.$eval(ROOT,e=>e.dataset.stageChrome)==='hidden'){const v=m.viewport();await m.touchscreen.tap(v.width/2,v.height/4);await m.waitForFunction(r=>document.querySelector(r).dataset.stageChrome==='shown',{},ROOT);await sleep(250);}};
 const tap=async selector=>{await wake();const el=await shown(m,selector);assert(el.asElement(),`nothing on screen for ${selector}`);await el.asElement().tap();};
 await m.waitForFunction(()=>[...document.querySelectorAll('[data-stage-hand]')].some(e=>e.checkVisibility()),{timeout:30000*scale});
 await tap('[data-stage-hand]');
 await m.waitForFunction(()=>[...document.querySelectorAll('[data-stage-hand="up"]')].length>0,{timeout:20000*scale});
 const malloryIdentity=await m.evaluate(()=>window.__stageFeed.identities.at(-1));
 assert.match(malloryIdentity,new RegExp(`^${members[MALLORY]}#0000000[12]$`));
 assert.deepEqual(raisedIn(),[malloryIdentity],'a member raises a hand from the phone\'s viewing room');
 await tap('[data-stage-phone-chat]');
 await m.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility({visibilityProperty:true})),{timeout:30000*scale},COMPOSER);
 const PHONE_POST='Watching on my phone. Great session!';
 await typeAndSend(m,COMPOSER,PHONE_POST,true);
 await waitRow(m,PHONE_POST);
 assert((await rowsOf('webinars')).some(r=>r.body===PHONE_POST&&r.member_id===members[MALLORY]),'the phone\'s post is saved');
 assert(await sideways(m)<=0,'phone viewing room: no sideways scroll');
 await shot(m,'webinars-live-phone-viewing-room');
 console.log('PASS a phone: the room has its composer; the viewing room has Raise hand and the chat with its composer');

 // 3. Every other member room has the notice.
 await waitNotice(c,LIVE_RE);
 assert.equal(await unreloaded(c),true,'Social was not reloaded: the notice arrived by itself');
 {const n=await noticeRow(c,LIVE_RE);assert.equal(n.href,'/chat?room=webinars&stage=1','the notice in Social links to the Webinars stage');assert.equal(n.label,'Watch live');assert.match(n.text,/Live Video/);
  assert.match(n.text,/Webinars is live now\. Watch live$/);}
 await c.evaluate(()=>document.activeElement?.blur());
 await shot(c,'webinars-notice-in-social');
 let all=await until(async()=>{const rows=await notices();return rows.length===COPY_ROOMS.length+1&&rows;},'one notice in Webinars and one copy in every other member room');
 assert.deepEqual(all.map(r=>r.room_slug).sort(),[...COPY_ROOMS,'webinars'].sort());
 assert(all.every(r=>LIVE_RE.test(r.body)&&r.body.endsWith('/chat?room=webinars&stage=1')),'each with the link to the webinar');
 const noticeId=all.find(r=>r.room_slug==='webinars').id,copyIds=all.filter(r=>r.room_slug!=='webinars').map(r=>r.id);
 // Silent copies: one bell entry per member in all (from the Webinars notice), nothing for a copy.
 await until(async()=>(await sql('select count(*)::int n from chat_room_mentions where message_id=$1 and account_id=$2',[noticeId,BOB]))[0].n===1,'Bob has the room notice\'s bell entry');
 assert.equal((await sql('select count(*)::int n from chat_room_mentions where message_id=any($1::uuid[])',[copyIds]))[0].n,0,'no bell entry for any copy');
 assert.equal((await sql('select count(*)::int n from chat_push_jobs j join chat_room_mentions n on n.id=j.source_id where n.message_id=any($1::uuid[])',[copyIds]))[0].n,0,'no phone job for any copy');
 for(const who of [BOB,MALLORY])assert.equal((await sql('select count(*)::int n from chat_room_mentions where account_id=$1 and message_id=any($2::uuid[])',[who,[noticeId,...copyIds]]))[0].n,1,'one bell entry in all for a member');
 // The link works: followed from Social, it opens the Webinars stage.
 await c.evaluate(()=>{window.location.assign(document.querySelector('[data-stage-notice-watch]').getAttribute('href'));});
 await c.waitForSelector('[data-stage-root]',{timeout:60000*scale});
 await c.waitForFunction(()=>document.querySelector('[data-stage-video]')?.dataset.stageVideoState==='live',{timeout:45000*scale});
 assert.equal(new URL(c.url()).searchParams.get('room'),'webinars');
 // Booker Stock Club: the notice is there, and the room is as read-only for members as ever.
 await openRoom(bobSocial,'club',page=>waitNotice(page,LIVE_RE));
 assert.equal(await seen(c,'textarea[aria-label^="Message "]'),false,'no composer for a member in the club');
 assert((await footer(c))?.startsWith('Read-only'),'the club still says Read-only');
 assert.deepEqual(await sendApi(c,'club',{body:'Can I post here now?'}),[403,READ_ONLY],'a member cannot post in the club while a webinar is live');
 const clubNotice=all.find(r=>r.room_slug==='club').id;
 assert.equal((await sendApi(c,'club',{body:'a reply',replyTo:clubNotice}))[0],403,'nor reply under the notice there');
 await c.evaluate(()=>document.activeElement?.blur());
 await shot(c,'webinars-notice-in-club');
 // Back to Social for the end.
 await openRoom(bobSocial,'social',page=>waitNotice(page,LIVE_RE));
 console.log(`PASS every room: ${COPY_ROOMS.length} silent copies, each with a working Watch live link; one bell entry per member; the club is still read-only`);

 // 4. A short drop posts nothing again. Then the end reaches every notice.
 await stops('webinars');await sleep(1500);await starts('webinars');
 await stays(async()=>(await notices()).length===COPY_ROOMS.length+1&&(await notices()).every(r=>LIVE_RE.test(r.body)),'a short drop: the same notices, still live',6000);
 await stops('webinars');
 await until(async()=>{const rows=await notices();return rows.length===COPY_ROOMS.length+1&&rows.every(r=>r.body===ENDED_TEXT);},'every notice says the webinar ended',(GRACE_MS+60000));
 await waitNotice(c,/The live video in Webinars has ended\. The recording will follow\./,(GRACE_MS+60000));
 await waitNotice(b,/The live video in Webinars has ended\. The recording will follow\./,(GRACE_MS+60000));
 assert.equal(await unreloaded(c),true,'Social was not reloaded');assert.equal(await unreloaded(b),true,'nor Webinars');
 assert.equal(await noticeRow(c,LIVE_RE),null,'no "live now" left in Social');
 assert.equal(await c.$('[data-stage-notice-watch]'),null,'no Watch live once it has ended');
 assert.equal((await sql('select count(*)::int n from chat_room_mentions where message_id=$1',[noticeId]))[0].n,0,'the bell entries are taken back');
 await c.evaluate(()=>document.activeElement?.blur());
 await shot(c,'webinars-ended-in-social');
 // The room's chat is as open after the webinar as during it.
 assert.deepEqual(await sendApi(b,'webinars',{body:'Thank you, that was great!'}),[200,'ok'],'chat stays open after the webinar');
 assert.equal(await seen(b,COMPOSER),true);
 console.log('PASS a short drop repeats nothing; the end reaches the room\'s notice and every copy, without a reload');

 // 5. The recording, posted in Recordings > Booker Stock Club.
 assert.deepEqual(await sendApi(b,'club-recordings',{body:`My own recording ${YT}`}),[403,ADMINS_ONLY],'a member cannot post in the recordings room');
 assert.deepEqual(await sendApi(a,'club-recordings',{body:`Tonight's webinar: ${YT}`}),[200,'ok'],'an admin posts the recording');
 const RECORDED=`The live video in Webinars has ended. Watch the recording: ${YT}`;
 await until(async()=>{const rows=await notices();return rows.length===COPY_ROOMS.length+1&&rows.every(r=>r.body===RECORDED);},'the Webinars notice and every copy link the recording');
 await waitNotice(c,/Watch the recording/);
 assert.equal(await unreloaded(c),true);
 // An admin has the recording control on the room's own notice, not on a copy in another room.
 await a.waitForSelector('[data-stage-recording-control]',{visible:true,timeout:30000*scale});
 const aliceSocial=await newPage('alice-social');
 await openRoom(aliceSocial,'social',page=>waitNotice(page,/Watch the recording/));
 assert.equal(await aliceSocial.page.$('[data-stage-recording-control]'),null,'no recording control on a copy');
 // The recordings room, as a member sees it.
 await openRoom(bob,'club-recordings',page=>waitRow(page,'Tonight\'s webinar'));
 assert.equal(await seen(b,'textarea[aria-label^="Message "]'),false,'no composer for a member in the recordings room');
 await b.evaluate(()=>document.activeElement?.blur());
 await shot(b,'webinars-recordings-room');
 console.log('PASS the recording posted under Recordings > Booker Stock Club is linked from the Webinars notice and every copy');

 for(const person of [alice,bob,bobSocial,bobStage,mallory,aliceSocial])assert.deepEqual(person.errors,[],`${person.who}: no page errors`);
 console.log('PASS chat-webinars-room');
}finally{await browser.close();stub.close();hub.close();}
