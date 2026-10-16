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
const conns=new Map();let serial=0,dropNext=0;const published=[];
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
 reconnect={episode:{alice:roomReads('alice',t).length,mallory:roomReads('mallory',t).length},afterReconnect:{alice:roomReads('alice',back+500).length,mallory:roomReads('mallory',back).length}};
 assert.equal(roomReads('alice',back+500).length,0,`no re-read of history, thread, counts or pins after the reconnect: ${roomReads('alice',back+500).map(r=>r.path.slice(0,40))}`);
 assert.ok(history('mallory',back).length>=1,'the kill-switch window re-reads its history');

 // 9. The tab hidden and shown again: one catch-up instead of re-reading every reader.
 await sleep(1000);t=Date.now();
 const [shownAt]=await Promise.all([hideAndShow(alice,1500),hideAndShow(mallory,1500)]);
 await sleep(2500*SCALE);
 visible={alice:{events:events('alice',shownAt).length,room:roomReads('alice',shownAt).length},mallory:{room:roomReads('mallory',shownAt).length}};
 assert.equal(visible.alice.events,1,'one catch-up when the tab is back');
 assert.equal(visible.alice.room,0,'and no reader re-read');
 assert.ok(visible.mallory.room>=3,'the kill-switch window re-reads history, thread, counts and pins');

 }
 // 6. Idle and live: Alice's history reader stops polling; Mallory's keeps its minute.
 await sleep(3000);t=Date.now();
 await sleep(minutes*60000);
 const idleOf=who=>({history:history(who,t).length,thread:thread(who,t).length,counts:counts(who,t).length,pins:pinReads(who,t).length,events:events(who,t).length,http:httpSince(who,t)});
 const idle={alice:idleOf('alice'),mallory:idleOf('mallory')};
 const all=who=>since(who,t,/./).reduce((m,r)=>(m[r.path.split('?')[0]]=(m[r.path.split('?')[0]]||0)+1,m),{});
 if(process.env.ES_DEBUG)console.log('DEBUG',t,JSON.stringify(reads.get('alice').filter(r=>!r.http&&/history|events/.test(r.path)).map(r=>[r.at-t,r.path.slice(0,60)])));
 const perMinute=v=>Math.round(v/minutes*10)/10;
 console.log('MEASURE '+JSON.stringify({
  idleMinutes:minutes,baseline,
  [baseline?'alice (kill switch)':'alice (stream)']:{historyPerMin:perMinute(idle.alice.history),roomReadersPerMin:perMinute(idle.alice.history+idle.alice.thread+idle.alice.counts+idle.alice.pins),httpPerMin:perMinute(idle.alice.http),resources:all('alice')},
  [baseline?'mallory (stream)':'mallory (kill switch)']:{historyPerMin:perMinute(idle.mallory.history),roomReadersPerMin:perMinute(idle.mallory.history+idle.mallory.thread+idle.mallory.counts+idle.mallory.pins),httpPerMin:perMinute(idle.mallory.http),resources:all('mallory')},
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
 assert.equal(idle.alice.events,0,'and no event reads while nothing happens');}
 assert.ok(pct(lag,0.95)<2000*SCALE,`send to the other screen p95 ${pct(lag,0.95)} ms`);
 assert.deepEqual(errors,[]);
 console.log('chat event stream browser check passed');
}finally{hub.close();await browser.close();}
