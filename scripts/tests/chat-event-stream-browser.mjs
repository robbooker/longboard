// EVENT-STREAM step 1 (docs/chat-event-stream.md) over a faked Ably, on the shared synthetic
// fixture (localhost:3394, database 127.0.0.1:54594). The Next server runs with
// CHAT_ABLY_API_KEY=fake.key:secret CHAT_ABLY_ROLLOUT=all CHAT_EVENT_STREAM=all and
// chat-event-stream-preload.mjs, which sends its Ably REST publishes to the hub here on
// 127.0.0.1:54597; the hub hands them to the pages' faked Ably sockets (as chat-typing does).
//
// Checks: numbered live delivery with no reads, a lost publish caught up from the cursor, a
// write that was never published, a hard delete, a dropped connection caught up after the
// reconnect, the room history reader no longer polling while in step (beside a window with the
// per-session kill switch, which keeps the old minute timer), and the delivery lag.
// Step 2: a reply and an edit merged into the open thread with no thread read (only the one
// reply count re-read), a pin reaching another window through the cursor, a reconnect and a tab
// coming back caught up with no history/thread/counts/pins re-read, and those readers idle at
// most once per five minutes (the kill-switch window keeps its minute timers).
// Step 3: a reaction taken in order from its numbered signal (only that message's reactions
// re-read), a lost reaction publish caught up from the cursor, a pause reaching another window
// through one catch-up, a reopen nobody published noticed at the next event, the reactions and
// room status readers idle at most once per five minutes, and CHAT-TIMING's stream tag ("on" for
// the stream window's samples while in step, "off" for the kill-switch window's).
// --minutes N stretches the idle window used for the reads-per-minute measurement (default 1.1);
// --baseline swaps the two windows (Alice on the kill switch) to measure the same account before/after.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import msgpack from '@ably/msgpack-js';
const base='http://localhost:3394',rest='http://127.0.0.1:54594';
const minutes=Number(process.argv[process.argv.indexOf('--minutes')+1]||0)||1.1;
const baseline=process.argv.includes('--baseline');
// CI sets CHAT_TIMING_SCALE=3 for its slower runners; every wait budget below follows it.
const SCALE=Number(process.env.CHAT_TIMING_SCALE)||1;
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(check,timeout,what){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await sleep(50);}throw Error(`Timed out: ${what}`);}

// --- Fake Ably realtime (as chat-typing-browser.mjs; maxIdleInterval 0, since this hub sends no
// heartbeats and Ably would otherwise drop the connection every 25 s) plus the server's REST publishes. ---
const conns=new Map();let serial=0,dropNext=0;const published=[];const beacons=[];
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
  // The transport drops (as a lost network does): Ably reconnects on a new socket.
  window.__ablyFakeDrop=()=>{for(const s of [...open.values()]){s.readyState=3;open.delete(s.id);window.__ablyFake(s.id,'close','');s.onclose?.({code:1006,wasClean:false});}};
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
// The server's REST publishes (redirected here by the preload).
const hub=createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
 const match=req.url.match(/^\/channels\/([^/]+)\/messages/);
 if(req.method!=='POST'||!match){res.writeHead(404);return res.end();}
 const channel=decodeURIComponent(match[1]),raw=Buffer.concat(chunks);
 const body=String(req.headers['content-type']).includes('msgpack')?msgpack.decode(raw):JSON.parse(raw.toString());
 const messages=(Array.isArray(body)?body:[body]).map(x=>({...x,data:typeof x.data==='string'||Buffer.isBuffer(x.data)?String(x.data):JSON.stringify(x.data),encoding:typeof x.data==='string'||Buffer.isBuffer(x.data)?x.encoding:'json',id:`s${++serial}:0`,timestamp:Date.now()}));
 const at=Date.now();
 for(const x of messages)published.push({channel,at,name:x.name,data:JSON.parse(x.data)});
 res.writeHead(201,{'content-type':'application/json'});res.end('{}');
 if(dropNext>0){dropNext--;return;}
 for(const conn of conns.values())if(conn.channels.has(channel))deliver(conn,{action:15,channel,id:`p${serial}`,connectionId:'server',timestamp:at,messages});
});}).listen(54597,'127.0.0.1');

// --- Reads each page makes (resources inside the batched /api/chat/updates count one each). ---
const reads=new Map();
function track(page,who){
 reads.set(who,[]);
 page.on('request',request=>{
  const url=new URL(request.url());if(!url.pathname.startsWith('/api/chat'))return;
  const log=reads.get(who),at=Date.now();
  log.push({at,path:url.pathname,http:true});
  // CHAT-TIMING beacons (every page here is a sampled session).
  if(url.pathname==='/api/chat/timings'&&request.method()==='POST'){try{beacons.push({who,at,batch:JSON.parse(request.postData())});}catch{}return;}
  // Step 3: which messages a reactions read asks for.
  if(url.pathname==='/api/chat/message-reactions'){let body={};try{body=JSON.parse(request.postData());}catch{}return void log.push({at,path:url.pathname,action:body.action,ids:body.messageIds??[body.messageId]});}
  if(url.pathname!=='/api/chat/updates')return void log.push({at,path:url.pathname+url.search});
  try{for(const path of JSON.parse(request.postData()).paths)log.push({at,path});}catch{}
 });
}
// Resources read (each path inside a batch counts once), and HTTP requests made.
const since=(who,t,pattern)=>reads.get(who).filter(r=>r.at>=t&&!r.http&&pattern.test(r.path));
const httpSince=(who,t)=>reads.get(who).filter(r=>r.at>=t&&r.http).length;

async function login(email,width,query=''){
 const context=await browser.createBrowserContext(),page=await context.newPage(),who=email.split('@')[0];
 await page.setViewport({width,height:900});page.on('pageerror',e=>errors.push(`${email}: ${e.stack}`));
 // CHAT-TIMING: every window records timings (step 3 checks their stream tag).
 await page.evaluateOnNewDocument(()=>{try{sessionStorage.setItem('longboard-chat-timings-v1','1');}catch{}
  // Keep each beacon's text in the page as well (a beacon sent while the page stays may not show as a request).
  window.__beacons=[];const send=navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon=(url,data)=>{const entry={url:String(url)};window.__beacons.push(entry);data?.text?.().then(t=>entry.body=t);return send(url,data);};});
 await fakeAbly(page,who);track(page,who);
 await page.goto(`${base}/login?next=%2Fchat`);await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.waitForFunction(()=>{const form=document.querySelector('#li-email')?.form;return form&&Object.keys(form).some(key=>key.startsWith('__reactProps$')&&typeof form[key]?.onSubmit==='function');});
 await page.type('#li-email',email);await page.type('#li-password','demo-only');await page.click('button[type="submit"]');
 await page.waitForSelector('textarea[aria-label^="Message "]');
 if(query||!await page.$('textarea[aria-label="Message SOCIAL" i]')){await page.goto(`${base}/chat?room=social${query.replace('?','&')}`);await page.waitForSelector('textarea[aria-label="Message SOCIAL" i]');}
 await waitFor(()=>[...conns.values()].some(c=>c.page===page&&c.channels.has('private:chat:room:social')),20000*SCALE,`${who} Ably attach`);
 return page;
}
async function api(page,path,body){return page.evaluate(async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json().catch(()=>null)};},path,body);}
async function fixture(path,body,method=body?'POST':'GET'){const r=await fetch(rest+'/rest/v1/'+path,{method,headers:{authorization:'Bearer test-service-role','Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,await r.clone().text());return r.json();}
const shown=(page,text)=>page.waitForFunction(t=>[...document.querySelectorAll('[id^="chat-message-"]')].some(e=>e.textContent.includes(t)),{timeout:15000*SCALE},text);
const gone=(page,id)=>page.waitForFunction(id=>!document.getElementById(`chat-message-${id}`),{timeout:15000*SCALE},id);
const pct=(list,p)=>{const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.ceil(p*s.length)-1)];};
// The server refuses a member's send within 1.5 s of their last one (by the stored time, which
// on a slow runner can be well after the request left), so pace from each answer and retry a burst refusal.
let lastSend=0;
async function send(page,body,replyTo){
 for(let attempt=0;;attempt++){
  const wait=lastSend+1700-Date.now();if(wait>0)await sleep(wait);
  const r=await api(page,'/api/chat',{action:'send',room:'social',body,clientId:crypto.randomUUID(),...(replyTo?{replyTo}:{})});
  lastSend=Date.now();
  if(r.status===429&&r.data?.error==='rate_limited'&&attempt<3)continue;
  assert.equal(r.status,200,JSON.stringify(r.data));return r.data.message;
 }
}
const events=(who,t)=>since(who,t,/^\/api\/chat\/events/);
const history=(who,t)=>since(who,t,/^\/api\/chat\/history/);
const thread=(who,t)=>since(who,t,/^\/api\/chat\/thread\?/);
const counts=(who,t)=>since(who,t,/^\/api\/chat\/thread-counts/);
const pinReads=(who,t)=>since(who,t,/^\/api\/chat\/message-pins/);
// Every reader of the room the stream stands in for (step 1 and 2).
const roomReads=(who,t)=>since(who,t,/^\/api\/chat\/(history|thread\?|thread-counts|message-pins)/);
// Step 3: the reactions reader (reads only, not our own sets) and the room status reader.
const reactionReads=(who,t)=>since(who,t,/^\/api\/chat\/message-reactions/).filter(r=>r.action==='read');
const statusReads=(who,t)=>since(who,t,/^\/api\/chat\?room=/);
const step3Reads=(who,t)=>reactionReads(who,t).length+statusReads(who,t).length;
// The reaction chip for one emoji on a message in the room's list, with this count.
const reacted=(page,id,emoji,count)=>page.waitForFunction((id,label)=>[...document.querySelectorAll(`[role="log"] [data-reaction-message="${id}"] [aria-label]`)].some(e=>e.getAttribute('aria-label').includes(label)),{timeout:15000*SCALE},id,`${emoji} reaction, ${count}.`);
const pausedNow=page=>page.evaluate(()=>!!document.querySelector('[role="log"] [role="status"]')?.textContent.includes('CHAT PAUSED'));
const attachedNow=page=>[...conns.values()].filter(c=>c.page===page&&c.channels.has('private:chat:room:social')).map(c=>c.key);
// Reopen a window on the room with a conversation open (a fresh page, Ably socket and cursor).
async function openThread(page,who,root,query=''){
 const before=new Set([...conns.values()]);
 await page.goto(`${base}/chat?room=social&thread=${root}${query}`,{waitUntil:'domcontentloaded'});
 await page.waitForSelector(`${panel} [aria-label="Original comment"]`,{timeout:20000*SCALE});
 await waitFor(()=>[...conns.values()].some(c=>c.page===page&&!before.has(c)&&c.channels.has('private:chat:room:social')),20000*SCALE,`${who} Ably attach`);
 // The previous document's sockets never said goodbye: forget them.
 for(const [key,c] of conns)if(c.page===page&&before.has(c))conns.delete(key);
}
const panel='aside[aria-label="Comment replies"]';
const inPanel=(page,id)=>page.waitForSelector(`${panel} [data-thread-message-id="${id}"]`,{timeout:15000*SCALE});
// Hide and show the tab (the coordinator and the stream both listen for visibilitychange).
async function hideAndShow(page,ms){
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 await sleep(ms);
 const at=Date.now();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
 return at;
}

try{
 // The fixture seeds 80 of Bob's messages a moment ago, which the send rate limit counts: move them back an hour.
 await fixture(`longboard_chat_messages?author_label=eq.Bob&created_at=gte.${new Date(Date.now()-3600e3).toISOString()}`,{created_at:new Date(Date.now()-3600e3).toISOString()},'PATCH');
 // Alice: the stream on. Mallory: the same page with the per-session kill switch (the old timers).
 const alice=await login('alice@example.test',1440,baseline?'?eventStream=off':''),bob=await login('bob@example.test',1440),mallory=await login('mallory@example.test',1440,baseline?'':'?eventStream=off');
 // Step 2: Alice and Mallory keep one conversation open throughout (its reader is measured too).
 const root=await send(bob,`Thread root ${crypto.randomUUID().slice(0,6)}`);
 const opened=Date.now();
 await openThread(alice,'alice',root.id,baseline?'&eventStream=off':'');await openThread(mallory,'mallory',root.id,baseline?'':'&eventStream=off');
 if(!baseline){await waitFor(()=>events('alice',opened).length>0,15000*SCALE,'first sync');
 assert.equal(events('alice',opened)[0].path,'/api/chat/events?room=social','a fresh cursor asks only for the head');
 assert.equal(events('mallory',0).length,0,'the kill switch never asks');
 assert.equal(events('bob',0).filter(r=>r.path.includes('after=')).length,0);
 // The fresh cursor is confirmed by one full history read; let it land before counting.
 const synced=events('alice',opened)[0].at;await waitFor(()=>history('alice',synced).length>0,15000*SCALE,'confirming history read');}
 // Settle: nothing read for 2 s (slow runners finish the opening reads late).
 for(let quiet=Date.now();Date.now()-quiet<2000*SCALE;){const n=reads.get('alice').length;await sleep(250);if(reads.get('alice').some((r,i)=>i>=n&&/history|thread|message-pins/.test(r.path)))quiet=Date.now();}

 // 1. Live, in order: shown with no read at all, and timed.
 const lag=[],push=[];let t=Date.now();
 for(let i=0;i<10;i++){
  const text=`Numbered live ${i} ${crypto.randomUUID().slice(0,6)}`;await sleep(Math.max(0,lastSend+1700-Date.now()));const sentAt=Date.now();
  const message=await send(bob,text);await shown(alice,text);const paintedAt=Date.now();
  assert.equal(typeof message.event_seq,'number','the sent row carries its number');
  lag.push(paintedAt-sentAt);push.push(paintedAt-published.findLast(p=>p.data.row?.id===message.id).at);
 }
 assert.equal(events('alice',t).length,0,'in-order events need no catch-up');
 if(baseline)assert.equal(events('alice',0).length,0,'the kill switch never asks');
 if(!baseline)assert.equal(history('alice',t).length,0,`nor a history read: ${history('alice',t).map(r=>`${r.at-t}ms ${r.path.slice(0,50)}`)} (sends ${t}..${Date.now()})`);
 const live=published.filter(p=>p.channel==='private:chat:room:social'&&p.name==='message').at(-1);
 assert.equal(live.data.head,undefined,'a plain send publishes no head (no extra read before it goes)');

 // --baseline (measurement only): Alice runs on the kill switch, so the checks below are skipped.
 let reconnect,visible;
 if(!baseline){
 // 2. A lost publish: the next message shows the gap; only the missing row is asked for.
 t=Date.now();dropNext=1;
 const lost=`Lost publish ${crypto.randomUUID().slice(0,6)}`,after=`After the gap ${crypto.randomUUID().slice(0,6)}`;
 const lostRow=await send(bob,lost);await send(bob,after);
 await shown(alice,after);await shown(alice,lost);
 const gap=events('alice',t);
 assert.equal(gap.length,1,'one catch-up');assert.equal(gap[0].path,`/api/chat/events?room=social&after=${lostRow.event_seq-1}`);
 assert.equal(history('alice',t).length,0,'no history read for a gap');

 // 3. A write that was never published (a direct database insert), noticed at the next event.
 t=Date.now();
 const members=await fixture('longboard_chat_members?select=id,user_id');const bobMember=members.find(m=>m.user_id==='00000000-0000-4000-8000-000000000002').id;
 const silent=`Never published ${crypto.randomUUID().slice(0,6)}`;
 await fixture('longboard_chat_messages',{guest_id:bobMember,member_id:bobMember,author_label:'Bob',body:silent,room_slug:'social'});
 await send(bob,`Next one ${crypto.randomUUID().slice(0,6)}`);
 await shown(alice,silent);
 assert.equal(events('alice',t).length,1);assert.equal(history('alice',t).length,0);

 // 4a. Deleting your own message (soft): the row comes live with the room's head; nothing to fetch.
 t=Date.now();
 const own=await send(bob,`Own delete ${crypto.randomUUID().slice(0,6)}`);await shown(alice,'Own delete');
 const soft=await api(bob,'/api/chat/message',{action:'delete',room:'social',messageId:own.id,expectedRevision:0});
 assert.equal(soft.status,200,JSON.stringify(soft.data));
 await alice.waitForFunction(id=>!document.getElementById(`chat-message-${id}`)?.textContent.includes('Own delete'),{timeout:15000*SCALE},own.id);
 const update=published.findLast(p=>p.name==='message');
 assert.equal(update.data.eventType,'UPDATE');assert.equal(typeof update.data.head,'number','an edit/delete carries the head');
 assert.equal(events('alice',t).length,0,'in order: no catch-up');assert.equal(history('alice',t).length,0);

 // 4b. A moderator removal deletes the row: only a signal with the head goes out; the tombstone comes in the catch-up.
 t=Date.now();
 const doomed=await send(bob,`Moderated ${crypto.randomUUID().slice(0,6)}`);await shown(alice,'Moderated');
 const removed=await api(alice,'/api/chat/message',{action:'delete',room:'social',messageId:doomed.id,expectedRevision:0});
 assert.equal(removed.status,200,JSON.stringify(removed.data));assert.equal(removed.data.message,null,'hard delete');
 await gone(alice,doomed.id);
 const signal=published.findLast(p=>p.name==='changed');assert.equal(typeof signal?.data.head,'number','the signal carries the head');
 assert.equal(events('alice',t).length,1,'the delete arrived as one catch-up');
 assert.equal(history('alice',t).length,0,'instead of a history read');
 await gone(mallory,doomed.id);
 assert.ok(history('mallory',t).length>=1,'the kill-switch window reloads history for it');

 // 7. Step 2, a reply: merged into Alice's open thread from the row (no thread read, no catch-up);
 // only the reply count it moves is re-read. Mallory (kill switch) re-reads the thread.
 await sleep(500);t=Date.now();
 const reply=await send(bob,`Live reply ${crypto.randomUUID().slice(0,6)}`,root.id);
 await inPanel(alice,reply.id);await inPanel(mallory,reply.id);
 await alice.waitForFunction(id=>/(^|\D)1 repl/.test(document.getElementById(`chat-message-${id}`)?.textContent??''),{timeout:15000*SCALE},root.id);
 await sleep(1000*SCALE);
 assert.equal(thread('alice',t).length,0,'the reply is merged from the row, not re-read');
 // The room's count for the root is re-read once; the thread's own counts start for the new reply.
 assert.equal(counts('alice',t).filter(r=>r.path.includes(root.id)).length,1,`only the reply count it moves is re-read, once: ${counts('alice',t).map(r=>r.path)}`);
 assert.ok(counts('alice',t).every(r=>r.path.includes(root.id)||r.path.includes(reply.id)));
 assert.equal(pinReads('alice',t).length,0,'pins are not re-read for a reply');
 assert.equal(events('alice',t).length,0);assert.equal(history('alice',t).length,0);
 assert.ok(thread('mallory',t).length>=1,'the kill-switch window re-reads the thread');
 // An edit of the reply: also merged from the row.
 t=Date.now();const edit=`Edited reply ${crypto.randomUUID().slice(0,6)}`;
 const edited=await api(bob,'/api/chat/message',{action:'edit',room:'social',messageId:reply.id,body:edit,expectedBody:reply.body,expectedRevision:reply.revision??0});
 assert.equal(edited.status,200,JSON.stringify(edited.data));
 await alice.waitForFunction((p,id,text)=>document.querySelector(`${p} [data-thread-message-id="${id}"]`)?.textContent.includes(text),{timeout:15000*SCALE},panel,reply.id,edit);
 await sleep(500*SCALE);
 assert.equal(thread('alice',t).length,0,'an edit in the thread is merged too');assert.equal(roomReads('alice',t).length,counts('alice',t).length);
 assert.equal(events('alice',t).length,0,'in order: no catch-up');

 // 8. A pin, made by Alice: Bob's window (stream) hears a numbered signal, catches up once and
 // re-reads its pins; Mallory's (kill switch) re-reads its pins from the signal.
 await sleep(500);t=Date.now();
 const pinned=await api(alice,'/api/chat/message-pins',{room:'social',messageId:root.id,action:'pin'});
 assert.equal(pinned.status,200,JSON.stringify(pinned.data));
 for(const page of [bob,mallory])await page.waitForSelector(`[data-pinned-message-id="${root.id}"]`,{timeout:15000*SCALE});
 const pinSignal=published.findLast(p=>p.name==='changed');assert.deepEqual(pinSignal.data.topics,['pins']);assert.equal(typeof pinSignal.data.head,'number','a pin change is numbered');
 await sleep(500*SCALE);
 assert.equal(events('bob',t).length,1,'one catch-up for the pin');assert.ok(pinReads('bob',t).length>=1);
 assert.equal(history('bob',t).length,0);assert.equal(counts('bob',t).length,0);
 assert.equal(events('mallory',t).length,0);assert.ok(pinReads('mallory',t).length>=1);

 // 10. Step 3, a reaction (Bob hearts a message on every screen): Alice's window takes the numbered
 // signal in order (no catch-up) and re-reads just that message's reactions. Mallory (kill
 // switch) re-reads it from the plain signal, as before.
 await sleep(500);
 const target=await send(bob,`React to me ${crypto.randomUUID().slice(0,6)}`);
 // On screen (reactions are read only for messages in view).
 for(const page of [alice,mallory]){await page.waitForSelector(`[role="log"] [data-reaction-message="${target.id}"]`,{timeout:15000*SCALE});await page.evaluate(id=>document.getElementById(`chat-message-${id}`).scrollIntoView({block:'center'}),target.id);}
 for(const who of ['alice','mallory'])await waitFor(()=>reactionReads(who,0).some(r=>r.ids.includes(target.id)),15000*SCALE,`${who} reads the new message's reactions`);
 await sleep(1000*SCALE);t=Date.now();
 const react=(emoji)=>api(bob,'/api/chat/message-reactions',{kind:'room',room:'social',messageId:target.id,action:'set',emoji,active:true});
 const hearted=await react('heart');assert.equal(hearted.status,200,JSON.stringify(hearted.data));
 for(const page of [alice,mallory])await reacted(page,target.id,'heart',1);
 const reactionSignal=published.findLast(p=>p.name==='changed');
 assert.deepEqual(reactionSignal.data.topics,['reactions']);assert.equal(typeof reactionSignal.data.seq,'number','a reaction signal carries its own number');
 await sleep(500*SCALE);
 assert.equal(events('alice',t).length,0,'in order: no catch-up');
 assert.deepEqual(reactionReads('alice',t).map(r=>r.ids),[[target.id]],'only that message\'s reactions are re-read, once');
 assert.equal(roomReads('alice',t).length,0,'no thread, counts or pins re-read for a reaction');
 assert.equal(roomReads('bob',t).length,0,'nor in the reacting window');
 assert.ok(reactionReads('mallory',t).some(r=>r.ids.includes(target.id)));

 // 11. A lost reaction publish: the next event shows the gap and the catch-up names the message.
 await sleep(500);t=Date.now();dropNext=1;
 const laughed=await react('laugh');assert.equal(laughed.status,200,JSON.stringify(laughed.data));
 await send(bob,`After the lost reaction ${crypto.randomUUID().slice(0,6)}`);
 await reacted(alice,target.id,'laugh',1);
 assert.equal(events('alice',t).length,1,'one catch-up for the lost reaction');
 assert.ok(reactionReads('alice',t).length>=1&&reactionReads('alice',t).every(r=>r.ids.length===1&&r.ids[0]===target.id),`only that message is re-read: ${JSON.stringify(reactionReads('alice',t).map(r=>r.ids))}`);
 assert.equal(history('alice',t).length,0);

 // 12. A pause, by Alice (an owner): Bob's window (stream) catches up once and re-reads the room's
 // status; Mallory's (kill switch) re-reads it from the signal.
 const aliceId='00000000-0000-4000-8000-000000000001';
 if(!(await fixture(`longboard_chat_owners?user_id=eq.${aliceId}&select=user_id`)).length)await fixture('longboard_chat_owners',{user_id:aliceId});
 await sleep(500);t=Date.now();
 const paused=await api(alice,'/api/chat/admin?room=social',{action:'set_room_open',isOpen:false,reason:'Synthetic pause'});
 assert.equal(paused.status,200,JSON.stringify(paused.data));
 for(const page of [bob,mallory])await waitFor(()=>pausedNow(page),15000*SCALE,'the pause reaches the window');
 const pauseSignal=published.findLast(p=>p.name==='changed');
 assert.deepEqual(pauseSignal.data.topics,['status']);assert.equal(typeof pauseSignal.data.head,'number','a pause carries the head');
 await sleep(500*SCALE);
 assert.equal(events('bob',t).length,1,'one catch-up for the pause');assert.equal(statusReads('bob',t).length,1,'and one status read');
 assert.equal(roomReads('bob',t).length,0);
 assert.equal(events('mallory',t).length,0);assert.ok(statusReads('mallory',t).length>=1);
 // 12b. Reopened by a write nobody publishes: Bob's window notices at the next event.
 await sleep(500);t=Date.now();
 await fixture('longboard_chat_room_state?room_slug=eq.social',{is_open:true,paused_at:null,paused_by:null,pause_reason:null,updated_at:new Date().toISOString()},'PATCH');
 // (Bob's own message: an author his window already has badges for, so the row needs no history read.)
 await send(bob,`Open again ${crypto.randomUUID().slice(0,6)}`);
 await waitFor(async()=>!await pausedNow(bob),15000*SCALE,'the reopen reaches Bob at the next event');
 assert.equal(events('bob',t).length,1,'one catch-up');assert.equal(statusReads('bob',t).length,1);
 assert.equal(history('bob',t).length,0,`no history read: ${JSON.stringify(since('bob',t,/./).map(r=>[r.at-t,r.path.slice(0,70)]))}`);

 // 5. The connection drops; a message sent meanwhile is fetched after the reconnect. Step 2: the
 // reconnect re-reads none of the room's readers (Mallory, dropped alongside, re-reads them all).
 await sleep(500);t=Date.now();
 const beforeDrop=Math.max(...reads.get('alice').filter(r=>/after=/.test(r.path)).map(r=>Number(r.path.split('after=')[1])),0);
 const dropped=new Set([...conns.values()].filter(c=>c.page===alice||c.page===mallory));
 await Promise.all([alice.evaluate(()=>window.__ablyFakeDrop()),mallory.evaluate(()=>window.__ablyFakeDrop())]);
 // Ably reconnects on a new socket at once; wait for the old ones to be gone.
 await waitFor(()=>![...conns.values()].some(c=>dropped.has(c)),5000*SCALE,'Alice and Mallory disconnected');
 const missed=`While away ${crypto.randomUUID().slice(0,6)}`;await send(bob,missed);
 await waitFor(()=>[alice,mallory].every(page=>[...conns.values()].some(c=>c.page===page&&!dropped.has(c)&&c.channels.has('private:chat:room:social'))),30000*SCALE,'Alice and Mallory reconnected');
 const back=Date.now();
 await shown(alice,missed);await shown(mallory,missed);
 const resumed=events('alice',t);
 assert.ok(resumed.length>=1&&resumed.every(r=>/after=\d+/.test(r.path)),`catch-up after the cursor, not a fresh sync: ${resumed.map(r=>r.path)}`);
 assert.ok(Number(resumed[0].path.split('after=')[1])>=beforeDrop);
 await sleep(3000*SCALE);
 // The 2-second offline cadence can land one read in the moment before the reconnect is noticed.
 // Reported: the whole episode (the drop's offline re-read, the fallback cadence, the reconnect)
 // and what follows the reconnect itself.
 reconnect={episode:{alice:roomReads('alice',t).length,mallory:roomReads('mallory',t).length},afterReconnect:{alice:roomReads('alice',back+500).length,mallory:roomReads('mallory',back).length},
  step3Episode:{alice:step3Reads('alice',t),mallory:step3Reads('mallory',t)},step3AfterReconnect:{alice:step3Reads('alice',back+500)}};
 assert.equal(roomReads('alice',back+500).length,0,`no re-read of history, thread, counts or pins after the reconnect: ${roomReads('alice',back+500).map(r=>r.path.slice(0,40))}`);
 // (Mallory may be back before Alice, so hers count from the drop: the offline re-read and the reconnect's.)
 assert.ok(history('mallory',t).length>=2,`the kill-switch window re-reads its history: back at ${back-t} ms, ${JSON.stringify(since('mallory',t,/./).map(r=>[r.at-t,r.path.slice(0,50)]))}`);
 assert.equal(step3Reads('alice',back+500),0,`no reactions or status re-read after the reconnect: ${since('alice',back+500,/message-reactions|chat\?room=/).map(r=>r.path)}`);
 assert.ok(step3Reads('mallory',t)>=4,'the kill-switch window re-reads its reactions and status (offline and again on the reconnect)');

 // 9. The tab hidden and shown again: one catch-up instead of re-reading every reader.
 await sleep(1000);t=Date.now();
 const [shownAt]=await Promise.all([hideAndShow(alice,1500),hideAndShow(mallory,1500)]);
 await sleep(2500*SCALE);
 visible={alice:{events:events('alice',shownAt).length,room:roomReads('alice',shownAt).length,step3:step3Reads('alice',shownAt)},mallory:{room:roomReads('mallory',shownAt).length,step3:step3Reads('mallory',shownAt)}};
 assert.equal(visible.alice.events,1,'one catch-up when the tab is back');
 assert.equal(visible.alice.room,0,'and no reader re-read');
 assert.ok(visible.mallory.room>=3,'the kill-switch window re-reads history, thread, counts and pins');
 assert.equal(visible.alice.step3,0,'nor reactions or status');assert.ok(visible.mallory.step3>=2,'which the kill-switch window re-reads');

 }
 // 6. Idle and live: Alice's history reader stops polling; Mallory's keeps its minute.
 await sleep(3000);t=Date.now();
 await sleep(minutes*60000);
 const idleOf=who=>({history:history(who,t).length,thread:thread(who,t).length,counts:counts(who,t).length,pins:pinReads(who,t).length,reactions:reactionReads(who,t).length,status:statusReads(who,t).length,events:events(who,t).length,http:httpSince(who,t)});
 const idle={alice:idleOf('alice'),mallory:idleOf('mallory')};
 const all=who=>since(who,t,/./).reduce((m,r)=>(m[r.path.split('?')[0]]=(m[r.path.split('?')[0]]||0)+1,m),{});
 if(process.env.ES_DEBUG)console.log('DEBUG',t,JSON.stringify(reads.get('alice').filter(r=>!r.http&&/history|events/.test(r.path)).map(r=>[r.at-t,r.path.slice(0,60)])));
 const perMinute=v=>Math.round(v/minutes*10)/10;
 console.log('MEASURE '+JSON.stringify({
  idleMinutes:minutes,baseline,
  [baseline?'alice (kill switch)':'alice (stream)']:{historyPerMin:perMinute(idle.alice.history),roomReadersPerMin:perMinute(idle.alice.history+idle.alice.thread+idle.alice.counts+idle.alice.pins),reactionsPerMin:perMinute(idle.alice.reactions),statusPerMin:perMinute(idle.alice.status),httpPerMin:perMinute(idle.alice.http),resources:all('alice')},
  [baseline?'mallory (stream)':'mallory (kill switch)']:{historyPerMin:perMinute(idle.mallory.history),roomReadersPerMin:perMinute(idle.mallory.history+idle.mallory.thread+idle.mallory.counts+idle.mallory.pins),reactionsPerMin:perMinute(idle.mallory.reactions),statusPerMin:perMinute(idle.mallory.status),httpPerMin:perMinute(idle.mallory.http),resources:all('mallory')},
  ...(baseline?{}:{reconnectRoomReads:reconnect,visibleRoomReads:visible}),
  sendToPaintMs:{p50:pct(lag,0.5),p95:pct(lag,0.95),max:Math.max(...lag)},
  publishToPaintMs:{p50:pct(push,0.5),p95:pct(push,0.95),max:Math.max(...push)},
 }));
 if(!baseline){// The 5-minute confirming read lands at a random phase, so a short window can hold one.
 for(const reader of ['history','thread','counts','pins']){
  // Two reply-count readers are mounted (the room list's and the open thread's own).
  const readers=reader==='counts'?2:1;
  assert.ok(idle.alice[reader]<=readers*Math.ceil(minutes/5),`${reader} reads while in step: ${idle.alice[reader]} (at most one per reader per 5 minutes)`);
  assert.ok(idle.mallory[reader]>=Math.floor(minutes),`the kill-switch window polls ${reader} every minute`);
 }
 // Step 3: the reactions reader (one per window) and the room status reader.
 // (The five-minute confirming history read can redraw rows, which then read their reactions once more.)
 assert.ok(idle.alice.reactions<=2*Math.ceil(minutes/5),`reactions reads while in step: ${idle.alice.reactions} ${JSON.stringify(since('alice',t,/./).map(r=>[r.at-t,r.path.slice(0,40),r.ids?.length]))}`);
 assert.ok(idle.mallory.reactions>=Math.floor(minutes*2),`the kill-switch window reads reactions every 30 s: ${idle.mallory.reactions}`);
 assert.ok(idle.alice.status<=Math.ceil(minutes/5),`status reads while in step: ${idle.alice.status}`);
 assert.ok(idle.mallory.status>=Math.floor(minutes),`the kill-switch window reads the status every minute: ${idle.mallory.status}`);
 assert.equal(idle.alice.events,0,'and no event reads while nothing happens');}
 // CHAT-TIMING stream tag: hide both windows (a sampled session sends its batch); every row says
 // whether the stream was on for it, and nothing else about the window is added.
 const hideAt=Date.now();
 for(const page of [alice,mallory])await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 const pageOf={alice,mallory};
 await waitFor(async()=>{for(const who of ['alice','mallory'])for(const body of await pageOf[who].evaluate(()=>window.__beacons.splice(0).map(b=>b.body).filter(Boolean)))beacons.push({who,at:Date.now(),batch:JSON.parse(body)});return ['alice','mallory'].every(who=>beacons.some(b=>b.who===who&&b.at>=hideAt));},10000*SCALE,'timing beacons');
 const tagged=who=>beacons.filter(b=>b.who===who).flatMap(b=>b.batch.rows);
 for(const who of ['alice','mallory'])for(const row of tagged(who))assert.deepEqual(Object.keys(row).sort(),['m','r','s','v'],JSON.stringify(row));
 const streamWho=baseline?'mallory':'alice',killedWho=baseline?'alice':'mallory';
 assert.ok(tagged(streamWho).some(r=>r.s==='on'),`the stream window's samples are tagged on: ${JSON.stringify(tagged(streamWho))}`);
 assert.ok(tagged(killedWho).every(r=>r.s==='off'),'the kill-switch window\'s are all off');
 const sent=beacons.filter(b=>b.at>=hideAt).flatMap(b=>b.batch.rows);
 let stored=[];for(let i=0;i<40;i++){stored=await fixture('chat_timings?select=metric,value,room,stream&order=id');if(sent.every(r=>stored.some(x=>x.metric===r.m&&x.value===r.v&&x.stream===r.s)))break;await sleep(250);}
 assert.ok(sent.every(r=>stored.some(x=>x.metric===r.m&&x.value===r.v&&x.room===r.r&&x.stream===r.s)),'stored with their tag');
 const timingTags={stream:tagged(streamWho).reduce((m,r)=>(m[r.s]=(m[r.s]||0)+1,m),{}),killSwitch:tagged(killedWho).reduce((m,r)=>(m[r.s]=(m[r.s]||0)+1,m),{})};
 console.log('TIMING-TAGS '+JSON.stringify(timingTags));
 assert.ok(pct(lag,0.95)<2000*SCALE,`send to the other screen p95 ${pct(lag,0.95)} ms`);
 assert.deepEqual(errors,[]);
 console.log('chat event stream browser check passed');
}finally{hub.close();await browser.close();}
