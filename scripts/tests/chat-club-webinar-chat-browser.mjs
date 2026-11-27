// #535 Booker Stock Club: the chat opens to everyone in the room while a webinar is live there, and
// is read-only for members again when it ends (localhost:3535, database 127.0.0.1:54735).
// Nothing real is reached and no real key exists here:
//  - the server's LiveKit calls go to this test's own stand-in on 127.0.0.1:54633 (the manifest's
//    `livekit` preset points LIVEKIT_URL at it); LiveKit's webhooks are sent by the test, signed
//    with the manifest's made-up key and secret; the player's connection is a stand-in too;
//  - Ably is a hub in this test (127.0.0.1:54835, as chat-polls-browser.mjs): the server's publishes
//    reach the pages through it, so "without a reload" is the real signal path.
// Synthetic members and messages only. "Club Host" (Alice) is a chat admin; "Sample Member" (Bob)
// and "Second Member" (Mallory) are members.
//  1. no webinar: a member sees the read-only notice, which says chat opens during a live webinar;
//     the server refuses a post, a reply and an edit;
//  2. the broadcast goes live: the composer appears on the member's page without a reload; the
//     member posts, replies in a thread (the reply panel has its composer), reacts and edits their
//     own post; a stock-pick card takes no reply and cannot be changed; the host sees the post arrive;
//  3. the stage: the member raises a hand while watching, with the room's chat and its composer
//     beside the video; on a phone the room has its composer, and the phone's viewing room has the
//     hand button and the chat with its composer;
//  4. a short drop (the broadcast stops and is back within a few seconds) never locks the chat;
//  5. the broadcast ends: the composer stays for the 20 seconds a broadcast is given to come back,
//     then gives way to the read-only notice without a reload; what was said is still there; the
//     member can no longer post, reply, edit or delete, and is told the webinar has ended;
//     reactions still work; the host still posts, and can remove a member's post but never a card.
// CHAT_SHOT_DIR saves club-locked-member.png, club-live-member.png, club-live-member-reply.png,
// club-live-member-stage.png, club-live-phone.png, club-live-phone-viewing-room.png and
// club-locked-again-member.png.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import msgpack from '@ably/msgpack-js';
import {AccessToken} from 'livekit-server-sdk';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3535',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54735',STUB='http://127.0.0.1:54633';
for(const url of [base,fixture,STUB])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,scale=Number(process.env.CHAT_TIMING_SCALE||1);
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);const j=JSON.parse(text);return j.rows??j;};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(check,what,ms=30000)=>{for(let waited=0;;waited+=200){const value=await check();if(value)return value;assert(waited<ms*scale,`timed out: ${what}`);await sleep(200);}};
// For "nothing happens": the check must hold for the whole stretch (it is looked at every 200ms).
const stays=async(check,what,ms=2000)=>{for(let waited=0;waited<ms;waited+=200){assert(await check(),`did not stay so: ${what}`);await sleep(200);}};
const ALICE='00000000-0000-4000-8000-000000000001',BOB='00000000-0000-4000-8000-000000000002',MALLORY='00000000-0000-4000-8000-000000000003';
const READ_ONLY='Booker Stock Club is a read-only channel.',ENDED='The webinar has ended, so Booker Stock Club is read-only again. Your message was not posted.';
const OPENS_LIVE='Chat opens here for everyone during a live webinar.';
// The 20 seconds a stopped broadcast is given to come back (lib/chatStageNotify.ts STAGE_DROP_GRACE_MS).
const GRACE_MS=20_000;

// The stand-in LiveKit: Twirp over JSON, as livekit-server-sdk speaks it. One ingress per room, and
// the people in the club's video room: identity -> {name, attributes}.
const lk={rooms:new Map(),people:new Map(),calls:[]};
const ns=ms=>String(BigInt(ms)*1000000n);
const info=(room,i)=>({ingress_id:i.id,name:room,stream_key:i.key,url:'rtmps://fake-livekit.example.test/x',input_type:'RTMP_INPUT',room_name:room,participant_identity:'stage-broadcast',reusable:true,
 state:{status:i.publishing?'ENDPOINT_PUBLISHING':'ENDPOINT_INACTIVE',room_id:'RM_fake',...(i.startedAt?{started_at:ns(i.startedAt)}:{}),...(i.endedAt?{ended_at:ns(i.endedAt)}:{})}});
const person=([identity,p])=>({sid:'PA_'+identity.slice(-8),identity,name:p.name,attributes:p.attributes});
const stub=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);
 const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify(value));};
 const url=new URL(req.url,STUB),club=lk.rooms.get('chat-club');
 // The page's stand-in player: join, leave, and "what is the room like now".
 if(url.pathname==='/test/join'){const tab=url.searchParams.get('tab');lk.people.set(url.searchParams.get('identity'),{name:url.searchParams.get('name'),joinedAt:Date.now(),attributes:tab?{tab}:{}});return send({});}
 if(url.pathname==='/test/leave'){lk.people.delete(url.searchParams.get('identity'));return send({});}
 if(url.pathname==='/test/state')return send({started:!!club,publishing:!!club?.publishing,
  hands:[...lk.people].filter(([,p])=>p.attributes.hand).map(([identity,p])=>({identity,name:p.name,hand:p.attributes.hand}))});
 const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'):{};
 const call=req.url.replace('/twirp/livekit.',''),room=body.room_name??body.roomName??body.room;lk.calls.push(`${call} ${room??''}`.trim());
 assert.match(req.headers.authorization??'',/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,'the server signs its LiveKit calls');
 if(call==='Ingress/ListIngress')return send({items:[...lk.rooms].filter(([name])=>!room||name===room).map(([name,i])=>info(name,i))});
 if(call==='Ingress/CreateIngress'){const i={id:`IN_fake_${lk.rooms.size+1}`,key:`FAKE-STREAM-KEY-for-tests-only-${lk.rooms.size+1}`,publishing:false};lk.rooms.set(room,i);return send(info(room,i));}
 if(call==='RoomService/ListRooms')return send({rooms:[]});
 // #522: the room is closed half a minute after a broadcast stops.
 if(call==='RoomService/DeleteRoom'){if(room==='chat-club')lk.people.clear();return send({});}
 if(call==='RoomService/GetParticipant'){const found=room==='chat-club'?lk.people.get(body.identity):null;
  return found?send({...person([body.identity,found]),joined_at_ms:String(found.joinedAt)}):send({code:'not_found',msg:'participant does not exist'},404);}
 if(call==='RoomService/ListParticipants')return room==='chat-club'&&club?send({participants:[...lk.people].map(person)}):send({code:'not_found',msg:'requested room does not exist'},404);
 if(call==='RoomService/UpdateParticipant'){const found=room==='chat-club'?lk.people.get(body.identity):null;
  if(!found)return send({code:'not_found',msg:'participant does not exist'},404);
  // As LiveKit does: an attribute set to "" is removed.
  for(const [key,value] of Object.entries(body.attributes??{})){if(value)found.attributes[key]=value;else delete found.attributes[key];}
  return send(person([body.identity,found]));}
 return send({code:'unimplemented',msg:call},501);
});
await new Promise(r=>stub.listen(54633,'127.0.0.1',r));
const WEBHOOK_KEY='APIsyntheticNeverReal',WEBHOOK_SECRET='synthetic-livekit-secret-never-a-production-secret';
let webhookNumber=0;
const webhook=async(event,room)=>{const body=JSON.stringify({event,id:`EV_club_chat_${++webhookNumber}`,room:{name:`chat-${room}`}}),signer=new AccessToken(WEBHOOK_KEY,WEBHOOK_SECRET);
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
await new Promise(r=>hub.listen(54835,'127.0.0.1',r));
const CLUB_CHANNEL='private:chat:room:club';
const stageSignals=()=>published.filter(p=>p.channel===CLUB_CHANNEL&&Array.isArray(p.data?.topics)&&p.data.topics.includes('stage')).length;
const attached=who=>until(()=>[...conns.values()].some(c=>c.who===who&&c.channels.has(CLUB_CHANNEL)),`${who} joined the club's Ably channel`);

// The club's pick for today (the card), posted the way the morning run posts it.
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const start=Date.parse(`${day}T13:30:00Z`);
const points=Array.from({length:40},(_,i)=>[start+i*120_000,Number((2.1+Math.sin(i/5)*0.12+i*0.012).toFixed(3))]);
const pick={ticker:'CNAA',name:'China Alpha Holdings',day,at:new Date().toISOString(),source:'auto',from:'report',price:2.5,changePct:60,volume:800_000,marketCap:20_000_000,
 country:'China',instOwnPct:12.5,borrow:null,levels:[{kind:'missed',price:2.84,label:'Missed pivot Nov 3'},{kind:'cmp',price:3.1,label:'CMP'},{kind:'sma200',price:3.6,label:'200 SMA'}],chart:{start,points}};
const posted=(await sql(`select post_chat_club_pick($1,$2,'auto',$3,$4::jsonb) r`,[day,'CNAA','#1 stock of the day: CNAA (China Alpha Holdings)',JSON.stringify(pick)]))[0].r;
assert.equal(posted.posted,true,JSON.stringify(posted));
const cardId=posted.messageId;
await sql("update profiles set role='admin' where email='alice@example.test'");
await sql("update profiles set role='user' where email in ('bob@example.test','mallory@example.test')");
// Neutral chat names for the pictures.
await sql(`update longboard_chat_members m set display_name=n.name from (values('alice@example.test','Club Host'),('bob@example.test','Sample Member'),('mallory@example.test','Second Member')) n(email,name),profiles p where p.email=n.email and m.user_id=p.id`);
const members=Object.fromEntries((await sql('select user_id,id from longboard_chat_members where user_id=any($1::uuid[])',[[ALICE,BOB,MALLORY]])).map(r=>[r.user_id,r.id]));
const HOST_POST='Welcome! Tonight\'s webinar starts at 7 PM Central. Chat opens here when we go live.';
const hostPost=(await sql(`select send_chat_room_message($1,'club',$2,null,'{}'::uuid[],$3) r`,[ALICE,HOST_POST,'00000000-0000-4000-8000-000000535001']))[0].r;
assert.equal(hostPost.status,'sent',JSON.stringify(hostPost));
const hostPostId=hostPost.message.id;
const clubRows=()=>sql(`select id,member_id,bot_slug,body,reply_to_id,deleted_at from longboard_chat_messages where room_slug='club' and not removed order by created_at,unread_seq`);

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const COMPOSER='textarea[aria-label="Message Booker Stock Club"]';
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
const sendApi=async(page,body)=>{await sleep(1700);return api(page,'/api/chat',{room:'club',action:'send',clientId:crypto.randomUUID(),...body});};
const change=(page,body)=>api(page,'/api/chat/message',{room:'club',...body});
const react=(page,messageId,active=true)=>api(page,'/api/chat',{room:'club',action:'react',messageId,active});
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
const openClub=async person=>{const page=person.page;
 if(!page.url().startsWith(base))await signIn(page,base,`${person.who.split('-')[0]}@example.test`);
 await page.goto(`${base}/chat?room=club`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-club-card="CNAA"]')].some(e=>e.checkVisibility()),{timeout:90000*scale});
 await ready(page);await attached(person.who);await mark(page);};

try{
 const alice=await newPage('alice'),bob=await newPage('bob');
 const a=alice.page,b=bob.page;
 await openClub(alice);await openClub(bob);
 // The host sets the room up once (its stream address and key). Nothing is posted for that.
 assert.deepEqual(await api(a,'/api/chat/stage/live',{room:'club',action:'open'}),[200,'ok']);

 // 1. No webinar: read-only for a member, and it says when chat opens.
 await waitRow(b,'Chat opens here when we go live');
 assert.equal(await seen(b,'textarea[aria-label^="Message "]'),false,'no composer for a member at rest');
 {const text=await footer(b);assert(text,'the read-only notice');assert(text.startsWith('Read-only'),text);assert(text.includes(OPENS_LIVE),`it says when chat opens: ${text}`);assert(text.includes('You can react.'),text);}
 assert.equal(await seen(a,COMPOSER),true,'the host has the composer, as before');
 assert.deepEqual(await sendApi(b,{body:'too early'}),[403,READ_ONLY]);
 assert.deepEqual(await sendApi(b,{body:'too early',replyTo:hostPostId}),[403,READ_ONLY]);
 assert.deepEqual(await change(b,{messageId:hostPostId,action:'delete'}),[403,READ_ONLY]);
 assert.deepEqual(await react(b,hostPostId),[200,'ok'],'a member reacts at rest, as before');
 // A member's row at rest: the replies can be opened, nothing can be changed.
 assert.equal((await rowWith(b,'China Alpha')).reply,false,'a stock-pick card takes no reply');
 await shot(b,'club-locked-member');
 console.log('PASS no webinar: the read-only notice says chat opens during a live webinar; the server refuses a member');

 // 2. The broadcast goes live: the composer appears without a reload.
 const signalsBefore=stageSignals();
 await starts('club');
 await b.waitForFunction(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility()),{timeout:45000*scale},COMPOSER);
 assert.equal(await unreloaded(b),true,'the member\'s page was not reloaded');
 assert(stageSignals()>signalsBefore,'the room was told over Ably');
 assert.equal(await footer(b),null,'the read-only notice is gone');
 await b.waitForFunction(()=>[...document.querySelectorAll('article[id^="chat-message-"]')].some(e=>e.checkVisibility()&&/is live now/.test(e.innerText)),{timeout:45000*scale});
 const FIRST='Hello from the webinar! Can everyone hear the host?';
 await typeAndSend(b,COMPOSER,FIRST);
 await waitRow(b,FIRST);
 const first=(await clubRows()).find(r=>r.body===FIRST);
 assert(first,'the member\'s post is saved');assert.deepEqual([first.member_id,first.bot_slug],[members[BOB],null],'as the member\'s own post');
 await waitRow(a,FIRST);
 assert.equal(await unreloaded(a),true,'the host sees it arrive without a reload');
 assert.equal((await rowWith(b,FIRST)).actions,true,'the member can change their own post while it is live');
 // Replies: under a person's post yes (through the reply panel), under the card never.
 await b.evaluate(text=>{const row=[...document.querySelectorAll('article[id^="chat-message-"]')].find(e=>e.checkVisibility()&&e.innerText.includes(text));[...row.querySelectorAll('button')].find(x=>/repl/i.test(x.textContent)&&x.checkVisibility()).click();},'Chat opens here when we go live');
 const REPLY_BOX='aside[aria-label="Comment replies"] textarea';
 await b.waitForFunction(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility()&&!e.disabled),{timeout:30000*scale},REPLY_BOX);
 assert.equal(await b.evaluate(()=>document.querySelector('aside[aria-label="Comment replies"]').innerText.includes('read-only')),false,'the reply panel is not read-only');
 const REPLY='Looking forward to it. Thanks for hosting!';
 await sleep(1700);
 await typeAndSend(b,REPLY_BOX,REPLY);
 await until(async()=>(await clubRows()).some(r=>r.body===REPLY&&r.reply_to_id===hostPostId&&r.member_id===members[BOB]),'the member\'s reply is saved under the host\'s post');
 await b.waitForFunction(text=>document.querySelector('aside[aria-label="Comment replies"]')?.innerText.includes(text),{timeout:30000*scale},REPLY);
 await shot(b,'club-live-member-reply');
 await (await shown(b,'button[aria-label="Close replies"]')).asElement().click();
 await b.waitForFunction(()=>![...document.querySelectorAll('aside[aria-label="Comment replies"]')].some(e=>e.checkVisibility()),{timeout:15000*scale});
 assert.deepEqual(await sendApi(b,{body:'reply to the card',replyTo:cardId}),[403,'Replies are off under the stock-pick cards.']);
 assert.deepEqual(await change(b,{messageId:cardId,action:'edit',body:'my card now',expectedBody:'#1 stock of the day: CNAA (China Alpha Holdings)'}),[403,'message_forbidden'],'a card is never a member\'s to edit');
 assert.deepEqual(await change(b,{messageId:cardId,action:'delete'}),[403,'message_forbidden'],'nor to delete');
 assert.deepEqual(await change(b,{messageId:hostPostId,action:'delete'}),[403,'message_forbidden'],'nor an admin\'s post');
 assert.deepEqual(await react(b,first.id),[200,'ok']);assert.deepEqual(await react(b,cardId),[200,'ok'],'reactions as before');
 assert.deepEqual(await change(b,{messageId:first.id,action:'edit',body:FIRST+' (Yes, loud and clear.)',expectedBody:FIRST}),[200,'ok'],'a member edits their own post while it is live');
 await waitRow(b,'loud and clear');
 // Polls stay the admins' in the club: a member's attachment menu has none.
 assert.equal(await b.evaluate(()=>[...document.querySelectorAll('button,[role="menuitem"]')].some(e=>/Poll/.test(e.textContent))),false,'no poll for a member in the club');
 await b.evaluate(()=>document.activeElement?.blur());
 assert(await sideways(b)<=0,'no sideways scroll');
 await shot(b,'club-live-member');
 console.log('PASS live: the composer appears without a reload; a member posts, replies, reacts and edits their own; cards stay untouchable');

 // 3. The stage: a member raises a hand while watching, with the room's chat beside the video.
 const bobStage=await newPage('bob-stage');const s=bobStage.page;
 await signIn(s,base,'bob@example.test');
 await s.goto(`${base}/chat?room=club&stage=1`);
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
 await shot(s,'club-live-member-stage');
 // Lowering it works too.
 await s.click('[data-stage-hand]');
 await s.waitForFunction(()=>document.querySelector('[data-stage-hand]')?.getAttribute('aria-pressed')==='false',{timeout:20000*scale});
 assert.deepEqual(raisedIn(),[]);
 console.log('PASS the stage: a member raises and lowers a hand, and posts from the chat beside the video');

 // On a phone: the room has its composer; the viewing room has the hand button and the chat with its composer.
 const mallory=await newPage('mallory',PHONE);const m=mallory.page;
 await signIn(m,base,'mallory@example.test');
 await m.goto(`${base}/chat?room=club`,{waitUntil:'domcontentloaded'});
 await m.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility({visibilityProperty:true})),{timeout:90000*scale},COMPOSER);
 await waitRow(m,'loud and clear');
 assert(await sideways(m)<=0,'phone: no sideways scroll');
 await shot(m,'club-live-phone');
 await m.goto(`${base}/chat?room=club&stage=1`);
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
 assert((await clubRows()).some(r=>r.body===PHONE_POST&&r.member_id===members[MALLORY]),'the phone\'s post is saved');
 assert(await sideways(m)<=0,'phone viewing room: no sideways scroll');
 await shot(m,'club-live-phone-viewing-room');
 await waitRow(b,PHONE_POST);
 console.log('PASS a phone: the room has its composer; the viewing room has Raise hand and the chat with its composer');

 // 4. A short drop: the broadcast stops and is back within a few seconds. The chat never locks.
 await stops('club');
 await sleep(1000);
 assert.equal(await seen(b,COMPOSER),true,'the composer stays when the broadcast stops');
 assert.deepEqual(await sendApi(b,{body:'Did the video freeze for anyone else?'}),[200,'ok'],'a post during a short drop goes through');
 await starts('club');
 await stays(()=>seen(b,COMPOSER),'the composer through a short drop',(GRACE_MS+8000));
 assert.equal(await footer(b),null);
 assert.equal((await sql("select count(*)::int n from longboard_chat_messages where room_slug='club' and bot_slug='longboard'"))[0].n,1,'still one live notice');
 assert.deepEqual(await sendApi(b,{body:'Back now, thanks.'}),[200,'ok']);
 assert.equal(await unreloaded(b),true);
 console.log('PASS a short drop never locks the chat');

 // 5. The broadcast ends: the composer stays for the grace, then the room is read-only again.
 const DRAFT='half a sentence that was never sent';
 await sleep(1700);
 await typeAndSend(b,COMPOSER,'One last question before we finish?');
 await waitRow(b,'One last question before we finish?');
 const lockSignalsBefore=stageSignals();
 await stops('club');const stoppedAt=Date.now();
 await sleep(3000);
 assert.equal(await seen(b,COMPOSER),true,'the composer is still there a few seconds after the broadcast stops');
 assert.deepEqual(await sendApi(b,{body:'Thank you, that was great!'}),[200,'ok'],'and a post in those seconds still goes through');
 await b.waitForFunction(()=>[...document.querySelectorAll('strong')].some(e=>e.checkVisibility()&&e.textContent==='Read-only'),{timeout:(GRACE_MS+60000)*scale});
 const lockedAfter=Date.now()-stoppedAt;
 // Never early (a slow machine only makes it later): the notice waits the whole grace before it says ended.
 assert(lockedAfter>=GRACE_MS-2000,`the chat locked ${lockedAfter}ms after the stop: not before the ${GRACE_MS}ms a broadcast is given to come back`);
 assert.equal(await unreloaded(b),true,'the member\'s page was not reloaded');
 assert(stageSignals()>lockSignalsBefore,'the room was told when the chat locked');
 assert.equal(await seen(b,'textarea[aria-label^="Message "]'),false,'the composer is gone');
 assert((await footer(b)).includes(OPENS_LIVE));
 await until(async()=>/has ended/.test((await sql("select body from longboard_chat_messages where room_slug='club' and bot_slug='longboard'"))[0].body),'the notice says the broadcast ended');
 // What was said is still there, on the page and in the database.
 for(const text of ['loud and clear','Watching on my phone','One last question','Thank you, that was great!'])assert(await rowWith(b,text),`still on the page: ${text}`);
 assert.equal((await rowWith(b,'loud and clear')).actions,false,'a member can no longer change their own post');
 assert.equal((await rowWith(b,'One last question')).failed,false);
 const kept=await clubRows();
 for(const text of [FIRST+' (Yes, loud and clear.)',REPLY,STAGE_POST,PHONE_POST,'Thank you, that was great!'])assert(kept.some(r=>r.body===text&&!r.deleted_at),`still saved: ${text}`);
 // The server refuses, and says why.
 assert.deepEqual(await sendApi(b,{body:DRAFT}),[403,ENDED]);
 assert.deepEqual(await sendApi(b,{body:DRAFT,replyTo:hostPostId}),[403,ENDED]);
 assert.deepEqual(await change(b,{messageId:first.id,action:'edit',body:'changed afterwards',expectedBody:FIRST+' (Yes, loud and clear.)'}),[403,ENDED],'no edits after the lock');
 assert.deepEqual(await change(b,{messageId:first.id,action:'delete'}),[403,ENDED],'no deletes after the lock');
 assert.deepEqual(await react(b,first.id,false),[200,'ok'],'reactions still work, as before');
 assert.equal((await clubRows()).find(r=>r.id===first.id).body,FIRST+' (Yes, loud and clear.)','the post is unchanged');
 assert.deepEqual(await api(s,'/api/chat/stage/hand',{room:'club',identity:bobIdentity,raised:true}),[409,'not_live'],'no hand once it is over');
 // The reply panel says so too.
 await b.evaluate(text=>{const row=[...document.querySelectorAll('article[id^="chat-message-"]')].find(e=>e.checkVisibility()&&e.innerText.includes(text));[...row.querySelectorAll('button')].find(x=>/repl/i.test(x.textContent)&&x.checkVisibility()).click();},'Chat opens here when we go live');
 await b.waitForFunction(()=>[...document.querySelectorAll('aside[aria-label="Comment replies"]')].some(e=>e.checkVisibility()&&e.innerText.includes('Booker Stock Club is read-only. Replies open here during a live webinar.')),{timeout:30000*scale});
 // The member's reply is still in the thread (the replies load a moment after the panel opens).
 await b.waitForFunction(text=>[...document.querySelectorAll('aside[aria-label="Comment replies"]')].some(e=>e.checkVisibility()&&e.innerText.includes(text)),{timeout:30000*scale},REPLY);
 await (await shown(b,'button[aria-label="Close replies"]')).asElement().click();
 await b.waitForFunction(()=>![...document.querySelectorAll('aside[aria-label="Comment replies"]')].some(e=>e.checkVisibility()),{timeout:15000*scale});
 await b.evaluate(()=>document.activeElement?.blur());
 await shot(b,'club-locked-again-member');
 // The host: still posts, removes a member's post, never a card.
 assert.equal(await seen(a,COMPOSER),true,'the host keeps the composer');
 assert.deepEqual(await api(a,'/api/chat',{room:'club',action:'send',body:'Thanks everyone. The recording will follow.',clientId:crypto.randomUUID()}),[200,'ok']);
 const phonePost=(await clubRows()).find(r=>r.body===PHONE_POST);
 assert.deepEqual(await change(a,{messageId:phonePost.id,action:'delete'}),[200,'ok'],'the host removes a member\'s post');
 assert.equal((await clubRows()).some(r=>r.id===phonePost.id),false);
 assert.deepEqual(await change(a,{messageId:cardId,action:'delete'}),[403,'message_forbidden'],'never a stock-pick card');
 assert.equal((await clubRows()).some(r=>r.id===cardId),true,'the card is still there');
 console.log(`PASS it ends: the chat locked ${Math.round(lockedAfter/1000)}s after the stop, without a reload; the messages stay; the member is told the webinar has ended`);

 for(const person of [alice,bob,bobStage,mallory])assert.deepEqual(person.errors,[],`${person.who}: no page errors`);
 console.log('PASS chat-club-webinar-chat');
}finally{await browser.close();stub.close();hub.close();}
