// #496: the old Postgres room watch is off while Ably is live. Run with chat-room-watch-fixture.mjs
// (a realtime protocol adapter on 127.0.0.1:54696 that reports each channel's tables) and a dev server
// on :3496 started with CHAT_ABLY_API_KEY=fake.key:secret CHAT_ABLY_ROLLOUT=all. Ably is faked in the
// page, as in chat-typing-browser.mjs; nothing real is reached.
//
// Checks: with Ably live the window holds no Postgres subscription on the room tables (a room write
// reaches no Postgres subscriber, and a room event over Ably still lands); Ably dropping re-attaches
// the room tables and a room write reaches the page over Postgres; Ably back detaches them again; a
// tab hidden past its drop delay (shortened here) holds no channel at all; shown again, it reopens
// only the DM channel, shows the message posted while it was away, and a DM change still re-reads
// its inbox.
import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
const base='http://localhost:3496',rest='http://127.0.0.1:54696';
const SCALE=Number(process.env.CHAT_TIMING_SCALE)||1;
const HIDDEN_DROP_MS=2000;
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(check,timeout,what){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await sleep(100);}throw Error(`Timed out: ${what}`);}
const step=what=>console.log(`STEP ${what}`);

// --- Fake Ably (as chat-event-stream-browser.mjs: maxIdleInterval 0, since this hub sends no
// heartbeats). While `ablyDown`, a new connection is dropped at once, as a lost network would. ---
const conns=new Map();let serial=0,ablyDown=false;
const decode=token=>JSON.parse(Buffer.from(token.replace(/^fake\./,''),'base64url').toString());
function deliver(conn,frame){void conn.page.evaluate((id,f)=>window.__ablyFakeDeliver(id,f),conn.id,JSON.stringify(frame)).catch(()=>{});}
function connected(conn){deliver(conn,{action:4,connectionId:`c${conn.key}:${++serial}`,connectionDetails:{clientId:conn.clientId,connectionKey:`k${conn.key}:${serial}`,maxMessageSize:65536,maxFrameSize:524288,maxInboundRate:250,connectionStateTtl:120000,maxIdleInterval:0,serverId:'fake'}});}
function grant(conn,token){const t=decode(token);conn.clientId=t.clientId;conn.capability=JSON.parse(t.capability);}
function frame(page,who,id,kind,data){
 const key=`${who}:${id}`;
 if(kind==='open'){
  if(ablyDown)return void page.evaluate(id=>window.__ablyFakeDrop(id),id).catch(()=>{});
  const conn={page,who,id,key,channels:new Set()};grant(conn,new URL(data).searchParams.get('access_token'));conns.set(key,conn);connected(conn);return;
 }
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
  // The transport drops (one socket, or all): Ably retries on a new socket.
  window.__ablyFakeDrop=only=>{for(const s of [...open.values()]){if(only!==undefined&&s.id!==only)continue;s.readyState=3;open.delete(s.id);window.__ablyFake(s.id,'close','');s.onclose?.({code:1006,wasClean:false});}};
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

// --- The fixture's realtime channels (one page here, so every channel is this page's). ---
// The room's presence channel (useRoomPresence) watches no table and is not counted.
const bindings=async()=>(await (await fetch(rest+'/test/bindings')).json()).filter(c=>c.tables.length);
const ROOM_TABLES=['longboard_chat_messages','longboard_chat_reactions'],DM_TABLES=['longboard_chat_direct_messages','longboard_chat_conversations'];
const tables=async()=>new Set((await bindings()).flatMap(c=>c.tables));
const watchesRooms=async()=>{const t=await tables();return ROOM_TABLES.some(x=>t.has(x));};
const watchesDms=async()=>{const t=await tables();return DM_TABLES.every(x=>t.has(x));};
const post=async(body,room='main')=>(await fetch(`${rest}/test/message?room=${room}&body=${encodeURIComponent(body)}`)).json();
const shows=(page,text)=>page.evaluate(t=>[...document.querySelectorAll('article')].some(e=>e.checkVisibility()&&e.textContent.includes(t)),text);
const ablyLive=page=>[...conns.values()].some(c=>c.page===page&&c.channels.has('private:chat:room:main'));
async function setHidden(page,hidden){
 await page.evaluate(h=>{Object.defineProperty(document,'visibilityState',{value:h?'hidden':'visible',configurable:true});Object.defineProperty(document,'hidden',{value:h,configurable:true});document.dispatchEvent(new Event('visibilitychange'));},hidden);
}

try{
 const context=await browser.createBrowserContext(),page=await context.newPage();
 await page.setViewport({width:1280,height:900});page.on('pageerror',e=>errors.push(e.stack));
 await fakeAbly(page,'alice');
 // A shorter hidden-tab drop delay for this session (components/chat/ChatUpdates.tsx).
 await page.evaluateOnNewDocument(ms=>{try{sessionStorage.setItem('longboard-chat-postgres-hidden-drop-ms',String(ms));}catch{}},HIDDEN_DROP_MS);
 const inbox=[];
 page.on('request',r=>{if(new URL(r.url()).pathname==='/api/chat/updates'){try{if(JSON.parse(r.postData()).paths.some(p=>p.startsWith('/api/chat/inbox')))inbox.push(Date.now());}catch{}}});
 await signIn(page,base,'alice@example.test');

 step('Ably live: only the DM tables over Postgres');
 await waitFor(()=>ablyLive(page),30000*SCALE,'Ably connection');
 await waitFor(watchesDms,30000*SCALE,'the DM channel');
 // On a cold dev server the first token can take longer than the page waits for it, so the room
 // tables may have been joined first; they must be gone once Ably is up.
 await waitFor(async()=>!(await watchesRooms()),10000*SCALE,'no room tables while Ably is live');
 await sleep(1500*SCALE);
 assert.equal(await watchesRooms(),false,'the room tables stay off while Ably is live');
 {
  const {row,delivered}=await post('Sent over Ably only');
  assert.equal(delivered,0,'a room write reaches no Postgres subscriber');
  const data=JSON.stringify({kind:'message',eventType:'INSERT',row});
  for(const conn of conns.values())if(conn.page===page&&conn.channels.has('private:chat:room:main'))
   deliver(conn,{action:15,channel:'private:chat:room:main',id:`p${++serial}`,connectionId:'server',timestamp:Date.now(),messages:[{id:`s${serial}:0`,name:'message',data,encoding:'json',timestamp:Date.now()}]});
  await waitFor(()=>shows(page,'Sent over Ably only'),15000*SCALE,'the Ably room event on screen');
 }

 step('Ably drops: the room tables come back');
 ablyDown=true;
 const droppedAt=Date.now();
 await page.evaluate(()=>window.__ablyFakeDrop());
 await waitFor(watchesRooms,5000*SCALE,'the room tables re-attached after Ably dropped');
 console.log(`room tables re-attached ${Date.now()-droppedAt} ms after the drop`);
 assert.equal(await watchesDms(),true,'the DM channel is untouched');
 {
  // The channel reports subscribed a moment after it joins.
  await sleep(500);
  const {delivered}=await post('Sent while Ably is down');
  assert.ok(delivered>=1,'a room write reaches the page over Postgres');
  await waitFor(()=>shows(page,'Sent while Ably is down'),15000*SCALE,'the Postgres room event on screen');
 }

 step('Ably back: the room tables go again');
 ablyDown=false;
 await waitFor(()=>ablyLive(page),60000*SCALE,'Ably reconnected');
 await waitFor(async()=>!(await watchesRooms()),10000*SCALE,'no room tables once Ably is back');
 assert.equal(await watchesDms(),true,'the DM channel stays');

 step('Hidden tab: every channel dropped');
 await setHidden(page,true);
 await waitFor(async()=>(await bindings()).length===0,(HIDDEN_DROP_MS+10000)*SCALE,'no Postgres change channel while hidden');
 const away=await post('Sent while the tab was away');
 assert.equal(away.delivered,0,'a hidden tab has no Postgres subscriber');

 step('Shown again: the DM channel back, the missed message on screen, DMs still arrive');
 await setHidden(page,false);
 await waitFor(watchesDms,10000*SCALE,'the DM channel after the tab came back');
 await waitFor(()=>shows(page,'Sent while the tab was away'),20000*SCALE,'the message sent while away');
 assert.equal(await watchesRooms(),false,'still no room tables (Ably is live)');
 await sleep(1500*SCALE);
 const before=Date.now();
 const dm=await (await fetch(rest+'/test/dm')).json();
 assert.ok(dm.delivered>=1,'a DM change reaches the page over Postgres');
 await waitFor(()=>inbox.some(t=>t>=before),10000*SCALE,'the inbox re-read after a DM change');

 assert.deepEqual(errors,[]);
 console.log('Room watch browser checks passed: no room tables while Ably is live, re-attached on a drop and detached on return, hidden tab drops its channels and recovers.');
}finally{await browser.close();}
