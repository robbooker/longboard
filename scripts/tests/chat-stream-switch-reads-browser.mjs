// STREAM-DOUBLE-READS (#351, docs/chat-event-stream.md section 12): a room switch on the event
// stream reads history, pins, reply counts and room status once each, and a message that lands
// during the switch is still not missed. Synthetic fixture, faked Ably (as
// chat-event-stream-browser.mjs): localhost:3394, database 127.0.0.1:54594, hub 127.0.0.1:54597.
//
// Checks: the reads of every kind of switch (a room not mounted, the kept room) counted beside a
// kill-switch window; a message written before the head read and never published (the reads must
// carry it); one written after the reads and never published (the cursor must notice it at the next
// event, by one catch-up from the right number); one published while the answer is on its way; the
// cursor in step after each (the next message needs no catch-up); wrong_landing 0.
import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import msgpack from '@ably/msgpack-js';
const base='http://localhost:3394',rest='http://127.0.0.1:54594';
const SCALE=Number(process.env.CHAT_TIMING_SCALE)||1;
// Pin the windows' timer phase so the five-minute stream confirm cannot land in a counted window.
const CONFIRM=5*60*1000,PHASE=(((Date.now()-1000)%CONFIRM)+CONFIRM)%CONFIRM/CONFIRM;
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(check,timeout,what){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await sleep(50);}throw Error(`Timed out: ${what}`);}
// Every wait and page call has its own bound, so a stuck step fails with its name instead of
// running into the runner's budget; STEP lines say how far a run got (the runner quotes the last).
const within=(promise,ms,what)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Timed out after ${ms}ms: ${what}`)),ms);})]).finally(()=>clearTimeout(timer));};
const started=Date.now(),step=what=>console.log(`STEP ${what} (${Math.round((Date.now()-started)/1000)}s)`);

// --- Fake Ably and the server's REST publishes (as chat-event-stream-browser.mjs). ---
const conns=new Map();let serial=0;
const decode=token=>JSON.parse(Buffer.from(token.replace(/^fake\./,''),'base64url').toString());
function deliver(conn,f){void conn.page.evaluate((id,f)=>window.__ablyFakeDeliver(id,f),conn.id,JSON.stringify(f)).catch(()=>{});}
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
const hub=createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
 const match=req.url.match(/^\/channels\/([^/]+)\/messages/);
 if(req.method!=='POST'||!match){res.writeHead(404);return res.end();}
 const channel=decodeURIComponent(match[1]),raw=Buffer.concat(chunks);
 const body=String(req.headers['content-type']).includes('msgpack')?msgpack.decode(raw):JSON.parse(raw.toString());
 const messages=(Array.isArray(body)?body:[body]).map(x=>({...x,data:typeof x.data==='string'||Buffer.isBuffer(x.data)?String(x.data):JSON.stringify(x.data),encoding:typeof x.data==='string'||Buffer.isBuffer(x.data)?x.encoding:'json',id:`s${++serial}:0`,timestamp:Date.now()}));
 res.writeHead(201,{'content-type':'application/json'});res.end('{}');
 for(const conn of conns.values())if(conn.channels.has(channel))deliver(conn,{action:15,channel,id:`p${serial}`,connectionId:'server',timestamp:Date.now(),messages});
});}).listen(54597,'127.0.0.1');

// --- Requests: resources inside a batch count one each, and remember their batch. ---
const reads=new Map();let batches=0;
function track(page,who){
 reads.set(who,[]);
 page.on('request',request=>{
  const url=new URL(request.url());if(!url.pathname.startsWith('/api/chat'))return;
  const log=reads.get(who),at=Date.now();
  if(url.pathname==='/api/chat/message-reactions'){let body={};try{body=JSON.parse(request.postData());}catch{}if(body.action==='read')log.push({at,path:url.pathname});return;}
  if(url.pathname!=='/api/chat/updates')return void log.push({at,path:url.pathname+url.search});
  const batch=++batches;try{for(const path of JSON.parse(request.postData()).paths)log.push({at,path,batch});}catch{}
 });
}
const KINDS={history:/^\/api\/chat\/history/,pins:/^\/api\/chat\/message-pins/,counts:/^\/api\/chat\/thread-counts/,status:/^\/api\/chat\?room=/,events:/^\/api\/chat\/events/,reactions:/^\/api\/chat\/message-reactions/};
const since=(who,t,room)=>reads.get(who).filter(r=>r.at>=t&&(!room||r.path.includes(`room=${room}`)||KINDS.reactions.test(r.path)));
const count=(who,t,room)=>Object.fromEntries(Object.entries(KINDS).map(([kind,pattern])=>[kind,since(who,t,room).filter(r=>pattern.test(r.path)).length]));
// No read for ms in a row. Bounded: a window that never goes quiet fails and names what kept reading.
const quiet=async(who,ms=2000*SCALE,limit=60000*SCALE)=>{const begun=Date.now();let n=reads.get(who).length,at=begun;while(Date.now()-at<ms){if(Date.now()-begun>limit)throw Error(`${who} never went ${ms}ms without a read in ${limit}ms; last reads: ${JSON.stringify(reads.get(who).slice(-8).map(r=>r.path))}`);await sleep(100);if(reads.get(who).length!==n){n=reads.get(who).length;at=Date.now();}}};
// The five-minute stream confirm re-reads the room on purpose. With the pinned phase it lands
// every CONFIRM from about a second before the start (the coordinator's nextDue). On CI the run
// passes five minutes (#359: steps 3 and 4 sit right on it, and every read there counted twice),
// so before each counted window, wait out a confirm that would land in it.
const WINDOW=30000*SCALE;
const nextConfirm=()=>{const offset=PHASE*CONFIRM;return (Math.floor((Date.now()-offset)/CONFIRM)+1)*CONFIRM+offset;};
async function clearOfConfirm(){
 const at=nextConfirm();if(at-Date.now()>WINDOW)return;
 step(`waiting ${Math.round((at-Date.now())/1000)}s for the stream confirm`);
 await sleep(at-Date.now()+1000);await quiet('alice');await quiet('mallory',500);
}

async function login(email,query=''){
 const context=await browser.createBrowserContext(),page=await context.newPage(),who=email.split('@')[0];
 await page.setViewport({width:1440,height:900});page.on('pageerror',e=>errors.push(`${email}: ${e.stack}`));
 await page.evaluateOnNewDocument(phase=>{try{sessionStorage.setItem('longboard-chat-timings-v1','1');sessionStorage.setItem('longboard-chat-update-phase',String(phase));}catch{}
  window.__beacons=[];const send=navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon=(url,data)=>{const entry={url:String(url)};window.__beacons.push(entry);data?.text?.().then(t=>entry.body=t);return send(url,data);};
  // A switch's batch can be held, before it is sent or before its answer reaches the page.
  const real=window.fetch.bind(window);window.__hold=null;
  window.fetch=async(url,init)=>{
   const hold=window.__hold,hit=hold&&String(url).includes('/api/chat/updates')&&String(init?.body).includes(`/api/chat/events?room=${hold.room}"`);
   if(!hit)return real(url,init);
   window.__hold=null;hold.reached=true;window.__held=hold;
   if(hold.when==='before')await hold.gate;
   const response=await real(url,init);
   if(hold.when==='answer'){hold.answered=true;await hold.gate;}
   return response;
  };},PHASE);
 await fakeAbly(page,who);track(page,who);
 await signIn(page,base,email);
 if(query||!await page.$('textarea[aria-label="Message SOCIAL" i]')){await page.goto(`${base}/chat?room=social${query.replace('?','&')}`);await page.waitForSelector('textarea[aria-label="Message SOCIAL" i]');}
 await waitFor(()=>[...conns.values()].some(c=>c.page===page&&c.channels.has('private:chat:room:social')),20000*SCALE,`${who} Ably attach`);
 return page;
}
const PAGE_CALL=15000*SCALE;
const hold=(page,room,when)=>within(page.evaluate((room,when)=>{let open;const gate=new Promise(r=>open=r);window.__hold={room,when,gate,open};},room,when),PAGE_CALL,`hold the ${room} switch`);
const holdState=page=>within(page.evaluate(()=>({reached:!!window.__held?.reached,answered:!!window.__held?.answered})),PAGE_CALL,'read the hold');
const release=page=>within(page.evaluate(()=>{window.__held?.open();window.__held=null;}),PAGE_CALL,'release the hold');
const clickRoom=(page,room)=>within(page.evaluate(room=>{[...document.querySelectorAll(`a[href*="room=${room}"]`)].find(a=>a.checkVisibility()&&new URL(a.href).searchParams.get('room')===room).click();},room),PAGE_CALL,`click ${room}`);
async function fixture(path,body,method=body?'POST':'GET'){const r=await fetch(rest+'/rest/v1/'+path,{signal:AbortSignal.timeout(PAGE_CALL),method,headers:{authorization:'Bearer test-service-role','Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,await r.clone().text());return r.json();}
async function api(page,path,body){return within(page.evaluate(async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json().catch(()=>null)};},path,body),PAGE_CALL,`POST ${path}`);}
const shown=(page,text)=>page.waitForFunction(t=>[...document.querySelectorAll('[id^="chat-message-"]')].some(e=>e.checkVisibility()&&e.textContent.includes(t)),{timeout:15000*SCALE},text);
let lastSend=0;
async function send(page,room,body){
 for(let attempt=0;;attempt++){
  const wait=lastSend+1700-Date.now();if(wait>0)await sleep(wait);
  const r=await api(page,'/api/chat',{action:'send',room,body,clientId:crypto.randomUUID()});
  lastSend=Date.now();
  if(r.status===429&&attempt<3)continue;
  assert.equal(r.status,200,JSON.stringify(r.data));return r.data.message;
 }
}
const tag=()=>crypto.randomUUID().slice(0,6);

try{
 await fixture(`longboard_chat_messages?author_label=eq.Bob&created_at=gte.${new Date(Date.now()-3600e3).toISOString()}`,{created_at:new Date(Date.now()-3600e3).toISOString()},'PATCH');
 step('sign in');const alice=await login('alice@example.test'),mallory=await login('mallory@example.test','?eventStream=off');
 const members=await fixture('longboard_chat_members?select=id,user_id');const bobMember=members.find(m=>m.user_id==='00000000-0000-4000-8000-000000000002').id;
 // A direct write: numbered by the database, published to nobody (as a lost publish).
 const write=(room,body)=>fixture('longboard_chat_messages',{guest_id:bobMember,member_id:bobMember,author_label:'Bob',body,room_slug:room});
 // Alice's own, so it leaves her nothing unread and the switch is a plain one (no landing read).
 const aliceMember=members.find(m=>m.user_id==='00000000-0000-4000-8000-000000000001').id;
 const writeOwn=(room,body)=>fixture('longboard_chat_messages',{guest_id:aliceMember,member_id:aliceMember,author_label:'Alice',body,room_slug:room});
 await write('main',`Room has a conversation ${tag()}`);await write('developers',`Unread for both windows ${tag()}`);await quiet('alice',3000*SCALE);await quiet('mallory',500);
 const measured={};

 // 1. Counted switches, the same rooms in both windows. A room with unread messages first (its
 // opening asks for the landing spot and reads again, with the stream or without it); then a room
 // already read, not mounted; then the kept room, both ways.
 await write('lb-review',`Unread in the other room ${tag()}`);await sleep(300);
 const SWITCHES=[['unread','developers'],['unreadOther','lb-review'],['leftRoom','social'],['readRoom','developers'],['kept','social'],['keptBack','developers'],['keptAgain','social']];
 for(const [label,room] of SWITCHES){
  await clearOfConfirm();step(`1. switch ${label} (${room})`);const t=Date.now();await clickRoom(alice,room);
  await waitFor(()=>count('alice',t,room).events>0,15000*SCALE,`${label}: ${room} head read`);await quiet('alice');
  measured[label]=count('alice',t,room);
  const m=Date.now();await clickRoom(mallory,room);
  await waitFor(()=>count('mallory',m,room).history>0,15000*SCALE,`${label}: kill-switch history read`);await quiet('mallory');
  measured[`${label}KillSwitch`]=count('mallory',m,room);
  measured[`${label}Batches`]=[...new Set(since('alice',t,room).flatMap(r=>r.batch?[r.batch]:[]))].length;
 }
 console.log('MEASURE '+JSON.stringify(measured));
 for(const [label] of SWITCHES){
  const on=measured[label],off=measured[`${label}KillSwitch`],shown=JSON.stringify({on,off});
  assert.equal(on.events,1,`${label}: one head read: ${shown}`);assert.equal(on.status,1,`${label}: status once: ${shown}`);
  // Stream off: no head read at all, and every reader still reads.
  assert.equal(off.events,0,`${label}: the kill switch never asks`);assert.ok(off.history>=1&&off.pins>=1&&off.status>=1,`${label}: kill-switch reads ${shown}`);
  // The stream adds nothing to what the same switch reads without it.
  assert.ok(on.history<=off.history,`${label}: history: ${shown}`);assert.ok(on.pins<=off.pins,`${label}: pins: ${shown}`);
  if(label.startsWith('unread'))continue;
  assert.equal(on.history,1,`${label}: history once: ${shown}`);assert.equal(on.pins,1,`${label}: pins once: ${shown}`);
  assert.ok(on.counts<=1,`${label}: counts once: ${shown}`);
 }

 // 2. Written before the head read and published to nobody: only the switch's own reads can bring
 // it. The reads run after the head on the server, so the cursor's promise holds with one of each.
 step('2. written before the head');await clickRoom(alice,'main');await shown(alice,'Room has a conversation');await quiet('alice');await clickRoom(alice,'developers');await quiet('alice');await clickRoom(alice,'main');await quiet('alice');
 await clearOfConfirm();await hold(alice,'social','before');let t=Date.now();await clickRoom(alice,'social');
 await waitFor(async()=>(await holdState(alice)).reached,15000*SCALE,'the switch batch is held');
 const early=`Written before the head ${tag()}`;await writeOwn('social',early);await release(alice);
 await shown(alice,early);await quiet('alice');
 const before=count('alice',t,'social');console.log('BEFORE-HEAD '+JSON.stringify(before));
 assert.equal(before.history,1,`the switch's one history read carries it: ${JSON.stringify(before)}`);assert.equal(before.events,1,'and no catch-up was needed');
 // In step: the next message's number follows the head, so it needs no catch-up.
 t=Date.now();const next=`Next in order ${tag()}`;await send(alice,'social',next);await shown(alice,next);await quiet('alice',1000*SCALE);
 assert.equal(count('alice',t,'social').events,0,'the cursor is in step after the switch');

 // 3. Written after the reads and published to nobody: this answer does not carry it. The cursor
 // holds a head below it, so the next event shows the gap and one catch-up brings exactly that row.
 step('3. written after the reads');await clickRoom(alice,'main');await quiet('alice');
 await clearOfConfirm();await hold(alice,'social','answer');t=Date.now();await clickRoom(alice,'social');
 await waitFor(async()=>(await holdState(alice)).answered,15000*SCALE,'the switch answer is held');
 const late=`Written after the reads ${tag()}`;const [lateRow]=await writeOwn('social',late);await release(alice);
 await quiet('alice');
 const after=count('alice',t,'social');
 assert.equal(after.history,1,`one history read: ${JSON.stringify(after)}`);assert.equal(after.events,1,JSON.stringify(after));
 t=Date.now();const gapped=`After the gap ${tag()}`;await send(alice,'social',gapped);
 await shown(alice,gapped);await shown(alice,late);await quiet('alice',1000*SCALE);
 const gap=since('alice',t,'social').filter(r=>KINDS.events.test(r.path));
 assert.deepEqual(gap.map(r=>r.path),[`/api/chat/events?room=social&after=${lateRow.event_seq-1}`],'one catch-up from the head the switch read');
 assert.equal(count('alice',t,'social').history,0,'no history read for it');

 // 4. Published while the answer is on its way: applied live, and still there after the answer lands.
 step('4. published during the switch');await clickRoom(alice,'main');await quiet('alice');
 await clearOfConfirm();await hold(alice,'social','answer');t=Date.now();await clickRoom(alice,'social');
 await waitFor(async()=>(await holdState(alice)).answered,15000*SCALE,'the switch answer is held');
 const during=`Published during the switch ${tag()}`;await send(mallory,'social',during);await sleep(300);await release(alice);
 await shown(alice,during);await quiet('alice');
 console.log('PUBLISHED-DURING '+JSON.stringify(count('alice',t,'social')));
 assert.ok(await alice.evaluate(t=>[...document.querySelectorAll('[id^="chat-message-"]')].filter(e=>e.checkVisibility()&&e.textContent.includes(t)).length===1,during),'shown exactly once');
 t=Date.now();const inOrder=`In order again ${tag()}`;await send(alice,'social',inOrder);await shown(alice,inOrder);await quiet('alice',1000*SCALE);
 assert.equal(count('alice',t,'social').events,0,'in step again');

 // 5. wrong_landing stays 0 across all of these switches.
 step('5. wrong_landing');
 await alice.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await sleep(500);
 const rows=(await alice.evaluate(()=>window.__beacons.map(b=>b.body).filter(Boolean))).flatMap(body=>JSON.parse(body).rows);
 const landings=rows.filter(r=>r.m==='wrong_landing'),switches=rows.filter(r=>r.m==='room_switch');
 console.log('TIMINGS '+JSON.stringify({landings:landings.map(r=>r.v),switches:switches.map(r=>r.v)}));
 assert.ok(landings.length>=1,'landings were judged');assert.ok(landings.every(r=>r.v===0),`wrong_landing: ${JSON.stringify(landings)}`);
 assert.deepEqual(errors,[]);
 step('done');console.log('chat stream switch reads check passed');
}finally{hub.close();await browser.close();}
