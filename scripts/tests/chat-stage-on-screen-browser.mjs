// #507 Stage mode: the host sets the stock on screen for everyone (localhost:3507, database 127.0.0.1:54707).
// Nothing real is reached: LiveKit is this test's own stand-in on 127.0.0.1:54633 (as in
// chat-stage-video-browser.mjs, plus the room's metadata), the player's connection is a stand-in,
// Ably is a hub in this test (127.0.0.1:54739, as chat-polls-browser.mjs) and Polygon is the Gainers
// Table tests' fake (AEHL and NEWT are on today's table; FRSH has a price but never alerted; ZZZT
// is unknown to it). Alice is a chat admin (the host); Bob and Mallory are members.
//  - #512: the admin's ticker box is ready once the room has its stream key (no Start button), before
//    anything is broadcast; her player connects only when LiveKit's webhook says the broadcast is on;
//  - a member has no ticker box, no Set and no Clear, and the server refuses a member who asks;
//  - Alice types a ticker and presses Enter: it is saved in the LiveKit room chat-main, and Bob's
//    open stage shows it within a couple of seconds as "On screen now" (nothing is drawn on top of
//    the video picture); Mallory, who opens the stage afterwards, sees it too;
//  - Bob clicks another chip: only his own view changes (Mallory's does not, nothing is saved), and
//    he gets a "Now on screen" button back to the host's stock;
//  - Alice clicks a chip: that stock is on screen for everyone; a member who is looking at another
//    chip is not moved, and is told what is on screen now;
//  - a ticker that is not on today's Gainers Table shows only Polygon's price, % today, volume and
//    market cap and "—" for everything else; a ticker Polygon does not know is all "—";
//  - nothing in the panel says where its numbers come from (no source link, label or note);
//  - something that is not a ticker is refused in the box; Clear returns everyone to the default.
// CHAT_SHOT_DIR saves admin-set-ticker.png, member-on-screen.png, member-not-on-table.png.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import msgpack from '@ably/msgpack-js';
import {AccessToken} from 'livekit-server-sdk';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
import {checkStageLooks,contrastOf} from './stage-theme-checks.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3507',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54707',STUB='http://127.0.0.1:54633';
for(const url of [base,fixture,STUB])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,scale=Number(process.env.CHAT_TIMING_SCALE||1);
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const alert=(sym,secondsAgo,vol)=>sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[secondsAgo,new Date(Date.now()-secondsAgo*1000).toISOString(),`🚨 ${sym} (+41.0%)\nPrice: $2.50\nVolume: ${vol.toLocaleString('en-US')}\nMarket Cap: 12.5M`]);
const MALLORY='00000000-0000-4000-8000-000000000003';
// #512: a LiveKit webhook, signed with the manifest's made-up key and secret as LiveKit signs its own
// (as chat-stage-video-browser.mjs). It is how the room learns the broadcast has started.
const webhook=async event=>{const body=JSON.stringify({event,id:`EV_on_screen_${event}`,room:{name:'chat-main'}}),signer=new AccessToken('APIsyntheticNeverReal','synthetic-livekit-secret-never-a-production-secret');
 signer.sha256=createHash('sha256').update(body).digest('base64');
 const r=await fetch(base+'/api/chat/stage/livekit-webhook',{method:'POST',headers:{'content-type':'application/webhook+json',authorization:await signer.toJwt()},body});assert.equal(r.status,200,`webhook ${event}`);};

// The stand-in LiveKit: Twirp over JSON, as livekit-server-sdk speaks it. One ingress and one room.
const lk={ingresses:new Map(),rooms:new Map(),publishing:false,calls:[]};
const info=(room,i)=>({ingress_id:i.id,name:room,stream_key:'FAKE-STREAM-KEY-for-tests-only',url:'rtmps://fake-livekit.example.test/x',input_type:'RTMP_INPUT',room_name:room,participant_identity:'stage-broadcast',reusable:true,state:{status:lk.publishing?'ENDPOINT_PUBLISHING':'ENDPOINT_INACTIVE',room_id:'RM_fake'}});
const roomInfo=name=>({sid:'RM_fake',name,metadata:lk.rooms.get(name)??''});
const stub=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'):{};
 const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify(value));};
 if(req.url==='/test/state')return send({started:lk.ingresses.size>0,publishing:lk.ingresses.size>0&&lk.publishing});
 const call=req.url.replace('/twirp/livekit.','');lk.calls.push(call);
 assert.match(req.headers.authorization??'',/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,'the server signs its LiveKit calls');
 const room=body.room_name??body.roomName??body.room;
 if(call==='Ingress/ListIngress')return send({items:[...lk.ingresses].filter(([name])=>!room||name===room).map(([name,i])=>info(name,i))});
 if(call==='Ingress/CreateIngress'){const i={id:`IN_fake${lk.ingresses.size+1}`};lk.ingresses.set(room,i);return send(info(room,i));}
 if(call==='Ingress/DeleteIngress'){const id=body.ingress_id??body.ingressId;for(const [name,i] of lk.ingresses)if(i.id===id){lk.ingresses.delete(name);return send(info(name,i));}return send({code:'not_found',msg:'no such ingress'},404);}
 if(call==='RoomService/DeleteRoom'){lk.rooms.delete(room);return send({});}
 // #507: the room's metadata. A room nobody joined does not exist until it is made.
 if(call==='RoomService/ListRooms'){const names=body.names??[];return send({rooms:[...lk.rooms.keys()].filter(name=>!names.length||names.includes(name)).map(roomInfo)});}
 if(call==='RoomService/UpdateRoomMetadata'){if(!lk.rooms.has(room))return send({code:'not_found',msg:'requested room does not exist'},404);lk.rooms.set(room,body.metadata??'');return send(roomInfo(room));}
 if(call==='RoomService/CreateRoom'){if(!lk.rooms.has(body.name))lk.rooms.set(body.name,body.metadata??'');return send(roomInfo(body.name));}
 return send({code:'unimplemented',msg:call},501);
});
await new Promise(r=>stub.listen(54633,'127.0.0.1',r));
const saved=()=>{const text=lk.rooms.get('chat-main');return text?JSON.parse(text):null;};

// The page's stand-in for the LiveKit connection (see components/chat/stage/stageFeed.ts).
const fakeFeed=stubUrl=>{
 window.__chatStageFeedForTests=async({video,events})=>{
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');let tick=0;
  const draw=()=>{tick++;const g=ctx.createLinearGradient(0,0,1280,720);g.addColorStop(0,'#16324f');g.addColorStop(1,'#3b1f4a');ctx.fillStyle=g;ctx.fillRect(0,0,1280,720);
   ctx.fillStyle='rgba(255,255,255,.14)';ctx.fillRect((tick*9)%1280,0,90,720);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='700 64px sans-serif';ctx.fillText('TEST VIDEO',640,340);
   ctx.font='400 30px sans-serif';ctx.fillText('A drawn picture standing in for the broadcast',640,400);};
  draw();const drawing=setInterval(draw,100),stream=canvas.captureStream(10);
  let on=false,closed=false;
  events.connection('connected');events.audioBlocked(false);events.viewers(3);
  const poll=setInterval(async()=>{
   const state=await fetch(stubUrl+'/test/state').then(r=>r.json()).catch(()=>null);if(closed||!state)return;
   if(!state.started){events.video(false);events.connection('ended');clearInterval(poll);return;}
   if(state.publishing&&!on){on=true;video.srcObject=stream;void video.play().catch(()=>{});events.video(true);}
   else if(!state.publishing&&on){on=false;video.srcObject=null;events.video(false);}
  },250);
  return {startAudio:async()=>{},setVolume:()=>{},close:()=>{closed=true;clearInterval(poll);clearInterval(drawing);}};
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
await new Promise(r=>hub.listen(54739,'127.0.0.1',r));
const signals=()=>published.filter(p=>p.channel==='private:chat:room:main'&&p.data?.onScreen).map(p=>p.data.onScreen.symbol);

await sql("update profiles set role='admin' where email='alice@example.test'");
await sql("update profiles set role='user' where email='bob@example.test'");
// Mallory joins LB (she is not in it in the shared fixture).
await sql("insert into user_tags(user_id,tag) values($1,'boardroom-cohort-1')",[MALLORY]);
// Today's Gainers Table: NEWT alerted most recently, then AEHL.
await alert('AEHL',95,300000);await alert('NEWT',40,850000);
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const LB='textarea[aria-label="Message LB"]';
const shown=(page,selector)=>page.evaluateHandle(s=>[...document.querySelectorAll(s)].find(e=>e.checkVisibility())??null,selector);
const ready=page=>page.waitForFunction(()=>{const b=[...document.querySelectorAll('button[aria-label="Chat settings"]')].find(e=>e.checkVisibility());return b&&Object.keys(b).some(k=>k.startsWith('__reactProps$'));},{timeout:60000*scale});
const waitPlayer=(page,state)=>page.waitForFunction(s=>document.querySelector('[data-stage-video]')?.dataset.stageVideoState===s,{timeout:30000*scale},state);
const attached=who=>{const end=Date.now()+30000*scale;return (async()=>{while(Date.now()<end){if([...conns.values()].some(c=>c.who===who&&c.channels.has('private:chat:room:main')))return;await sleep(50);}assert.fail(`${who} never joined the room's Ably channel`);})();};
const newPage=async who=>{const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().includes('/api/chat/stage/on-screen'))posts.push(r.status());});
 await fakeAbly(page,who);
 await page.setViewport({width:1440,height:900});await page.evaluateOnNewDocument(fakeFeed,STUB);return {who,context,page,errors,posts};};
// The member's (or admin's) stage for LB, opened by its link while the room is live.
const openStage=async person=>{const page=person.page;
 if(page.url()==='about:blank')await signIn(page,base,`${person.who}@example.test`,{composer:LB,next:'/chat?room=main&stage=1'});
 else{await page.goto('about:blank');await page.goto(base+'/chat?room=main&stage=1');}
 await page.waitForSelector('[data-stage-root]',{timeout:60000*scale});await waitPlayer(page,'live');await attached(person.who);
 await page.waitForSelector('[data-stage-stock]:not([data-stage-stock=""])',{timeout:40000*scale});};
// What the "On screen now" panel says, and how many things sit on top of the video picture (none).
const panel=page=>page.evaluate(()=>{const e=document.querySelector('[data-stage-stock]');if(!e)return null;const text=s=>e.querySelector(s)?.textContent.replace(/\s+/g,' ').trim()??null;return {
 shown:e.dataset.stageStock,source:e.dataset.stageStockSource,host:e.dataset.stageHost,following:e.dataset.stageFollowing==='true',
 heading:text('h2'),now:text('[data-stage-now]'),links:e.querySelectorAll('a:not([data-stage-news-item] a)').length,words:e.innerText,
 chips:[...e.querySelectorAll('[data-stage-chip]')].map(c=>c.dataset.stageChip+(c.dataset.stageChipOnScreen?'*':'')+(c.getAttribute('aria-pressed')==='true'?'!':'')),
 stats:Object.fromEntries([...e.querySelectorAll('[data-stage-stat]')].map(s=>[s.dataset.stageStat,s.querySelector('dd').textContent])),
 news:e.querySelector('[data-stage-news]')?.dataset.stageNews??null,
 onVideo:document.querySelector('[data-stage-overlay]').childElementCount};});
// Waits until the panel passes `check` (within `ms`), and says how long it took.
const until=async(page,check,what,ms=8000)=>{const began=Date.now();let last;while(Date.now()-began<ms*scale){last=await panel(page);if(last&&check(last))return {...last,took:Date.now()-began};await sleep(50);}assert.fail(`${what}: ${JSON.stringify(last)}`);};
const DASH='—';
const shot=async(page,name)=>{if(!shots)return;await page.evaluate(()=>document.querySelector('[data-stage-stock]').scrollIntoView({block:'end'}));await page.waitForFunction(()=>document.querySelector('[data-stage-video-feed]')?.videoWidth>0);await sleep(400);await page.screenshot({path:`${shots}/${name}.png`});};
try{
 const alice=await newPage('alice'),bob=await newPage('bob'),mallory=await newPage('mallory');
 const a=alice.page,b=bob.page,m=mallory.page;
 // #512: the admin opens the stage. The room gets its stream key (no Start button), and from then
 // on the ticker box works, before anything is broadcast.
 await signIn(a,base,'alice@example.test',{composer:LB,next:'/chat?room=main&stage=1'});
 await a.waitForSelector('[data-stage-broadcast]',{timeout:60000*scale});
 await a.waitForSelector('[data-stage-on-screen-control]',{timeout:40000*scale});
 await a.waitForSelector('[data-stage-key]',{timeout:30000*scale});
 assert.equal(await a.$('[data-stage-start]'),null,'no Start button');
 await a.waitForFunction(()=>!document.querySelector('[data-stage-on-screen-input]').disabled,{timeout:20000*scale});
 assert.match(await a.$eval('[data-stage-on-screen-control]',e=>e.textContent),/type any ticker, to put it on screen for everyone/,'the ticker box is ready as soon as the room has its key');
 assert.equal(lk.rooms.size,0,'nothing is saved until the host sets a stock');
 // The broadcast arrives. Nothing in the admin's page is connected to LiveKit while it waits: it
 // hears from LiveKit's webhook, through the room's signal, and connects then.
 await waitPlayer(a,'waiting');await attached('alice');
 assert.equal(await a.$('[data-stage-root] video'),null,'the admin holds no connection while nothing is broadcasting');
 // The room getting its key was itself a "stage" signal, and a page that hears one asks the status
 // again about 5 seconds later (useStageStatus). That second look must be over before the broadcast
 // starts here, or it finds the room live and the admin connects before "the room is told" below.
 {let last=Date.now();const seen=r=>{if(r.url().includes('/api/chat/stage/status'))last=Date.now();};a.on('request',seen);
  last=Date.now();while(Date.now()-last<6500)await sleep(100);a.off('request',seen);}
 lk.publishing=true;
 await sleep(1500);
 assert.equal(await a.$('[data-stage-root] video'),null,'and still none until the room is told');
 await webhook('ingress_started');
 await waitPlayer(a,'live');
 await a.waitForFunction(()=>!document.querySelector('[data-stage-on-screen-input]').disabled,{timeout:20000*scale});
 await sleep(4200); // the server's few seconds' memory of "waiting", so Bob's first answer is "live"
 await openStage(bob);
 // Nothing set: as before. The newest stock leads, nothing is marked as the host's, no card for a member.
 {const p=await panel(b);
  assert.deepEqual([p.shown,p.source,p.host,p.following,p.heading,p.now,p.onVideo],['NEWT','table','',true,'On screen now',null,0],JSON.stringify(p));
  assert.deepEqual(p.chips,['NEWT!','AEHL']);
  assert.equal(p.links,0,'no link saying where the numbers come from');assert(!/From the Gainers Table|#gainers/.test(p.words),p.words);}
 // A member has no way to set it.
 for(const selector of ['[data-stage-on-screen-control]','[data-stage-on-screen-input]','[data-stage-on-screen-set]','[data-stage-on-screen-clear]'])assert.equal(await b.$(selector),null,`a member's stage has no ${selector}`);
 assert.equal(await b.$$eval('[data-stage-root] input:not([type="range"])',i=>i.length),0,'a member has no box to type in on the stage');
 {const refused=await b.evaluate(async()=>{const out=[];for(const symbol of ['NEWT',null]){const r=await fetch('/api/chat/stage/on-screen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'main',symbol})});out.push([r.status,await r.text()]);}return out;});
  assert.deepEqual(refused,[[403,'{"error":"admin_only"}'],[403,'{"error":"admin_only"}']]);assert.equal(lk.rooms.size,0);assert.deepEqual(signals(),[]);}
 console.log('PASS before: nothing set is as before; a member has no box, and the server refuses a member');

 // Not a ticker: refused in the box, nothing sent.
 await a.type('[data-stage-on-screen-input]','12$');await a.keyboard.press('Enter');
 await a.waitForSelector('[data-stage-on-screen-control] [role="alert"]');
 assert.match(await a.$eval('[data-stage-on-screen-control] [role="alert"]',e=>e.textContent),/That isn’t a ticker/);
 assert.deepEqual(alice.posts.filter(s=>s!==409),[],'nothing is sent for something that is not a ticker');
 await a.$eval('[data-stage-on-screen-input]',i=>i.select());await a.keyboard.press('Backspace');
 // The host types a ticker (lower case) and presses Enter.
 await a.type('[data-stage-on-screen-input]','aehl');
 const typedAt=Date.now();await a.keyboard.press('Enter');
 {const p=await until(b,x=>x.host==='AEHL','the member\'s open stage shows the host\'s stock',3000);
  console.log(`  (Bob's stage showed it ${Date.now()-typedAt} ms after Enter)`);
  assert(Date.now()-typedAt<3000*scale,'within a couple of seconds, with no reload');
  assert.deepEqual([p.shown,p.source,p.following,p.heading,p.now],['AEHL','table',true,'On screen now',null],JSON.stringify(p));
  assert.deepEqual(p.chips,['NEWT','AEHL*!'],'the chip on screen for everyone is marked');
  assert.equal(p.stats.price,'$2.50');assert.equal(p.stats.marketCap,'$12.4M');
  assert.equal(p.onVideo,0,'nothing is drawn on top of the video picture');}
 assert.equal(saved().onScreen,'AEHL','saved in the LiveKit room chat-main');assert(saved().at>=typedAt-5000);
 assert.deepEqual(signals(),['AEHL'],'one signal on the room\'s channel, carrying the ticker');
 {const p=await until(a,x=>x.host==='AEHL','the host\'s own stage');
  assert.deepEqual(p.chips,['NEWT','AEHL*!']);assert.equal(p.onVideo,0,'no card on the host\'s video either');
  assert.equal(await a.$eval('[data-stage-on-screen-input]',i=>i.value),'','the box is emptied once it is set');
  assert.match(await a.$eval('[data-stage-on-screen-control]',e=>e.textContent),/AEHL is on screen for everyone/);}
 await shot(a,'admin-set-ticker');await shot(b,'member-on-screen');
 // #510: the "On screen" chip (dark on the theme's accent), the admin's box for setting the stock and
 // the member's stock panel, in every theme and colour combination.
 await checkStageLooks(a,{each:async look=>{const chip=await contrastOf(a,'[data-stage-chip="AEHL"] span');assert(chip!==null,`${look.id}: the On screen chip is showing`);assert(chip>=4.5,`${look.id}: the On screen chip is ${chip}:1`);
  const hint=await contrastOf(a,'[data-stage-on-screen-input]','::placeholder');if(hint!==null)assert(hint>=4.5,`${look.id}: the ticker box's placeholder is ${hint}:1`);
  if(shots&&look.id==='light'){await a.evaluate(()=>document.querySelector('[data-stage-stock]').scrollIntoView({block:'end'}));await a.screenshot({path:`${shots}/admin-set-ticker-light.png`});}}});
 await checkStageLooks(b);
 // Someone who opens the stage afterwards reads it from the room's status.
 await openStage(mallory);
 {const p=await until(m,x=>x.host==='AEHL','a member joining afterwards sees it');
  assert.deepEqual([p.shown,p.heading,p.chips.join(' ')],['AEHL','On screen now','NEWT AEHL*!']);}
 console.log('PASS set: typed by the host, on the member\'s open stage inside a couple of seconds, and there for a member who joins afterwards');

 // A member's own chip changes only their own view.
 await b.click('[data-stage-chip="NEWT"]');
 {const p=await until(b,x=>x.shown==='NEWT','Bob looks at NEWT');
  assert.deepEqual([p.host,p.following,p.heading,p.now],['AEHL',false,'You’re looking at','Now on screen: AEHL'],JSON.stringify(p));
  assert.deepEqual(p.chips,['NEWT!','AEHL*']);assert.equal(p.stats.price,'$0.4512');}
 await sleep(1500);
 for(const page of [m,a]){const p=await panel(page);assert.deepEqual([p.shown,p.host],['AEHL','AEHL'],'a member\'s click changes nothing for anyone else');}
 assert.equal(saved().onScreen,'AEHL');assert.deepEqual(signals(),['AEHL']);assert.deepEqual(bob.posts,[403,403],'Bob\'s click sent nothing to the server');
 // The way back.
 await b.click('[data-stage-now]');
 {const p=await until(b,x=>x.shown==='AEHL'&&x.following,'back to what is on screen');assert.equal(p.now,null);assert.equal(p.heading,'On screen now');}
 console.log('PASS member chip: only that member\'s view changes, with a button back to what is on screen');

 // The host clicks a chip: on screen for everyone. Bob is following and moves; Mallory is looking
 // at another chip, stays where she is, and is told.
 await m.click('[data-stage-chip="NEWT"]');
 await until(m,x=>x.shown==='NEWT'&&!x.following,'Mallory looks at NEWT');
 await a.click('[data-stage-chip="NEWT"]');
 {const p=await until(b,x=>x.host==='NEWT','the host\'s chip click reaches the member',3000);
  assert.deepEqual([p.shown,p.following,p.heading,p.chips.join(' ')],['NEWT',true,'On screen now','NEWT*! AEHL'],JSON.stringify(p));
  console.log(`  (Bob's stage followed the host's chip in ${p.took} ms)`);}
 assert.equal(saved().onScreen,'NEWT');assert.deepEqual(signals(),['AEHL','NEWT']);
 // Mallory was already looking at NEWT, which is now the host's stock: she is following again.
 {const p=await until(m,x=>x.host==='NEWT','Mallory hears of it');assert.deepEqual([p.shown,p.following,p.now],['NEWT',true,null]);}
 await m.click('[data-stage-chip="AEHL"]');
 await until(m,x=>x.shown==='AEHL'&&!x.following,'Mallory looks at AEHL');
 console.log('PASS admin chip: the host\'s click on a chip puts that stock on screen for everyone');

 // A stock that is not on today's Gainers Table: Polygon's four numbers, dashes for the rest.
 await a.type('[data-stage-on-screen-input]','FRSH');await a.click('[data-stage-on-screen-set]');
 {const p=await until(b,x=>x.host==='FRSH'&&x.stats.price!==DASH,'the member sees a stock that is not on the table');
  assert.deepEqual([p.shown,p.source,p.following,p.heading],['FRSH','lookup',true,'On screen now']);
  assert.deepEqual(p.stats,{price:'$10.00',change:'+100.0%',volume:'12.3M',borrow:DASH,marketCap:'$1.2B',float:DASH,cash:DASH,instOwn:DASH,minutes:DASH,updated:DASH},'only what Polygon really says; nothing invented');
  assert.deepEqual(p.chips,['FRSH*!','NEWT','AEHL'],'its chip leads the row, marked');
  // No press releases were ever collected for it: the section is left out rather than saying "none".
  await sleep(1500);assert.equal((await panel(b)).news,null);
  assert.equal(await b.$('[data-stage-sample]'),null);
  // Nothing says where the numbers come from, or why some are missing.
  const q=await panel(b);assert.equal(q.links,0,'no source link');
  for(const word of ['Gainers Table','#gainers','Polygon','DilutionTracker','host','Not on','From the','source'])assert(!q.words.includes(word),`the panel does not say "${word}": ${q.words}`);}
 await shot(b,'member-not-on-table');
 // Mallory, looking at AEHL, is not moved: she is told what is on screen now, and can go there.
 {const p=await until(m,x=>x.host==='FRSH','Mallory is told');
  assert.deepEqual([p.shown,p.following,p.heading,p.now],['AEHL',false,'You’re looking at','Now on screen: FRSH'],JSON.stringify(p));
  await m.click('[data-stage-now]');
  const q=await until(m,x=>x.shown==='FRSH'&&x.stats.price!==DASH,'Mallory goes to what is on screen');assert.equal(q.stats.volume,'12.3M');}
 // A ticker Polygon does not know either: every number is a dash.
 await a.type('[data-stage-on-screen-input]','zzzt');await a.keyboard.press('Enter');
 {const p=await until(b,x=>x.host==='ZZZT','an unknown ticker');await sleep(2500);const q=await panel(b);
  assert.deepEqual([q.shown,q.source],['ZZZT','lookup']);assert.deepEqual([...new Set(Object.values(q.stats))],[DASH],`no invented values: ${JSON.stringify(q.stats)}`);
  assert.equal(q.heading,'On screen now');assert(!/Gainers Table|Not on/.test(q.words),q.words);assert.equal(p.host,'ZZZT');}
 // A member cannot read the lookup for anything that is not a clean ticker.
 assert.deepEqual(await b.evaluate(async()=>Promise.all(['frsh','FRSH,AEHL','A1'].map(async t=>(await fetch('/api/chat/stage/stock?ticker='+encodeURIComponent(t))).status))),[400,400,400]);
 console.log('PASS not on the table: price, % today, volume and market cap, dashes for the rest and no words about sources; an unknown ticker is all dashes');

 // Clear: everyone is back to the default.
 await a.click('[data-stage-on-screen-clear]');
 for(const page of [b,m,a]){const p=await until(page,x=>x.host==='','cleared for everyone',5000);
  assert.deepEqual([p.shown,p.source,p.following,p.heading,p.now],['NEWT','table',true,'On screen now',null],JSON.stringify(p));assert.deepEqual(p.chips,['NEWT!','AEHL']);}
 assert.deepEqual(saved().onScreen,null);assert.deepEqual(signals(),['AEHL','NEWT','FRSH','ZZZT',null]);
 assert.equal(await a.$eval('[data-stage-on-screen-clear]',x=>x.disabled),true,'nothing left to clear');
 // And for someone who opens the stage after the clear.
 await openStage(bob);
 {const p=await panel(b);assert.deepEqual([p.shown,p.host,p.heading,p.onVideo],['NEWT','','On screen now',0]);}
 assert.deepEqual(alice.posts.filter(s=>s!==200&&s!==409),[],'every change the host made was taken');
 for(const person of [alice,bob,mallory])assert.deepEqual(person.errors,[],`${person.who}: ${person.errors.join(' | ')}`);
 console.log('PASS clear: back to the default for everyone, and for a member who joins afterwards');
}finally{await browser.close();stub.close();hub.close();}
