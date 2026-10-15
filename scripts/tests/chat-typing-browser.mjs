// Typing indicator over a faked Ably connection. Run with chat-typing-fixture.mjs and a dev server on
// :3390 started with CHAT_ABLY_API_KEY=fake.key:secret CHAT_ABLY_ROLLOUT=all (no real Ably is used:
// the page's WebSocket to Ably and its token exchange are answered here, enforcing token rights
// and stamping each message with the token's clientId, as Ably does).
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.CHAT_TEST_URL||'http://localhost:3390';
const shots=process.env.CHAT_TYPING_SHOTS||'';
if(shots)await mkdir(shots,{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];
const dm='section[aria-label="Private conversation"]',typing='p[data-chat-typing="true"]';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// --- Fake Ably: one hub for every page. ---
const conns=new Map(),log=[];let serial=0;
const decode=token=>JSON.parse(Buffer.from(token.replace(/^fake\./,''),'base64url').toString());
function deliver(conn,frame){void conn.page.evaluate((id,f)=>window.__ablyFakeDeliver(id,f),conn.id,JSON.stringify(frame)).catch(()=>{});}
function connected(conn){deliver(conn,{action:4,connectionId:`c${conn.key}`,connectionDetails:{clientId:conn.clientId,connectionKey:`k${conn.key}`,maxMessageSize:65536,maxFrameSize:524288,maxInboundRate:250,connectionStateTtl:120000,maxIdleInterval:15000,serverId:'fake'}});}
function grant(conn,token){const t=decode(token);conn.clientId=t.clientId;conn.capability=JSON.parse(t.capability);}
function frame(page,who,id,kind,data){
 const key=`${who}:${id}`;
 if(kind==='open'){const conn={page,who,id,key,channels:new Set()};grant(conn,new URL(data).searchParams.get('access_token'));conns.set(key,conn);connected(conn);return;}
 const conn=conns.get(key);if(!conn)return;
 if(kind==='close'){conns.delete(key);return;}
 const m=JSON.parse(data),can=(op)=>conn.capability[m.channel]?.includes(op);
 if(m.action===0)return deliver(conn,{action:0});
 if(m.action===17){grant(conn,m.auth.accessToken);conn.reauthorized=(conn.reauthorized||0)+1;return connected(conn);}
 if(m.action===10){if(!can('subscribe'))return deliver(conn,{action:9,channel:m.channel,error:{code:40160,statusCode:401,message:'Channel denied'}});conn.channels.add(m.channel);return deliver(conn,{action:11,channel:m.channel,flags:(can('publish')?131072:0)|262144});}
 if(m.action===12){conn.channels.delete(m.channel);return deliver(conn,{action:13,channel:m.channel});}
 if(m.action===7)return deliver(conn,{action:8});
 if(m.action===15){
  if(!can('publish'))return deliver(conn,{action:2,msgSerial:m.msgSerial,count:m.messages.length,error:{code:40160,statusCode:401,message:'Publish denied'}});
  deliver(conn,{action:1,msgSerial:m.msgSerial,count:m.messages.length});
  const messages=m.messages.map(x=>{log.push({who:conn.who,clientId:conn.clientId,channel:m.channel,at:Date.now(),message:x});return {...x,id:`s${++serial}`,clientId:conn.clientId,connectionId:`c${conn.key}`,timestamp:Date.now()};});
  for(const other of conns.values())if(other.channels.has(m.channel))deliver(other,{action:15,channel:m.channel,id:`p${serial}`,connectionId:`c${conn.key}`,timestamp:Date.now(),messages});
 }
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

// --- App helpers (as in the DM sidebar test). ---
async function login(email,width,theme='dark'){
 const context=await browser.createBrowserContext(),page=await context.newPage();
 await page.setViewport({width,height:900});page.on('pageerror',e=>errors.push(`${email}: ${e.stack}`));
 await fakeAbly(page,email.split('@')[0]);
 await page.evaluateOnNewDocument(t=>{try{if(!localStorage.getItem('longboard-public-chat-theme-v1'))localStorage.setItem('longboard-public-chat-theme-v1',t);}catch{}},theme);
 await page.goto(`${base}/login?next=%2Fchat`);await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email',email);await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label^="Message "]');
 await live(page);return page;
}
const live=page=>(waitFor(()=>[...conns.values()].some(c=>c.page===page&&c.channels.size>0),20000,'Ably connection'));
async function waitFor(check,timeout,what){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await sleep(100);}throw Error(`Timed out: ${what}`);}
// Phones show the room list as its own screen, so move by URL there; DMs open by id everywhere.
async function room(page,slug,label){
 if(await page.$(`textarea[aria-label="Message ${label}"]`))return;
 const nav=await page.$('nav[aria-label="Chat rooms"]');
 if(nav&&await nav.evaluate(e=>getComputedStyle(e).display!=='none')){await page.click(`nav[aria-label="Chat rooms"] a[href="/chat?room=${slug}"]`);}
 else{await page.goto(`${base}/chat?room=${slug}`);await live(page);}
 await page.waitForSelector(`textarea[aria-label="Message ${label}"]`,{visible:true});
}
async function openDm(page,id){
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),id);
 await page.waitForSelector('#dm-body',{visible:true});
}
const label=(page,scope='')=>page.$eval(`${scope} p[data-chat-typing]`.trim(),e=>e.textContent).catch(()=>null);
const sent=(who,channel)=>log.filter(x=>x.who===who&&(!channel||x.channel===channel));
async function shot(page,name){if(shots)await page.screenshot({path:`${shots}/${name}.png`});}
const rights=page=>page.evaluate(async()=>(await (await fetch('/api/chat/realtime-token')).json()));

try{
 const alice=await login('alice@example.test',1440),bob=await login('bob@example.test',390);
 const lb='private:chat:room:main.typing';

 // Server-issued rights: publish only where the member may post; sender pinned to the member.
 const bobToken=await rights(bob),aliceToken=await rights(alice),bobCap=JSON.parse(bobToken.capability);
 assert.match(bobToken.clientId,/^chat:m:[0-9a-f-]{36}$/);
 assert.deepEqual(bobCap[lb],['publish','subscribe']);
 assert.deepEqual(bobCap['private:chat:room:lb-announcements.typing'],['subscribe'],'readers of announcements cannot signal');
 assert.deepEqual(bobCap['private:chat:room:gainers.typing'],['subscribe']);
 assert.deepEqual(bobCap['private:chat:room:main'],['subscribe'],'room channels stay subscribe-only');
 assert.deepEqual(JSON.parse(aliceToken.capability)['private:chat:room:lb-announcements.typing'],['publish','subscribe'],'admins post announcements');
 assert.equal(Object.keys(bobCap).some(k=>k.startsWith('private:chat:room:dm.')),false,'a pending request grants no DM typing');

 // Room: Bob types; Alice sees his member-list name; Bob never sees himself.
 await shot(alice,'room-dark-desktop-before');
 await bob.type('textarea[aria-label="Message LB"]','Morning all',{delay:40});
 await alice.waitForSelector(typing,{timeout:10000});
 assert.equal(await label(alice),'Bob is typing…');
 await shot(alice,'room-dark-desktop-after');
 assert.equal(await bob.$(typing),null,'never your own typing');
 const first=sent('bob',lb);
 assert.equal(first.length,1,'one signal for a burst of typing');
 assert.equal(first[0].clientId,bobToken.clientId,'the sender is the pinned login');
 assert.equal(first[0].message.data,undefined,'the signal carries no name or text');
 assert.equal(first[0].message.extras?.ephemeral,true,'nothing stored');

 // Expiry ~6 s after the last signal.
 const last=first.at(-1).at;
 await alice.waitForFunction(()=>!document.querySelector('p[data-chat-typing="true"]'),{timeout:10000});
 const gone=Date.now()-last;assert.ok(gone>=5500&&gone<8000,`cleared after ${gone} ms`);

 // Rate limit: ~7 s of steady typing sends at most one signal per 3 s.
 const before=sent('bob',lb).length;
 await bob.type('textarea[aria-label="Message LB"]',' and a much longer thought about the open today',{delay:150});
 const burst=sent('bob',lb).slice(before);
 assert.ok(burst.length>=2&&burst.length<=3,`burst sent ${burst.length}`);
 for(let i=1;i<burst.length;i++)assert.ok(burst[i].at-burst[i-1].at>=2900,'≥3 s apart');

 // Their message arriving clears them at once.
 await alice.waitForSelector(typing);
 const bobMember=bobToken.clientId.slice('chat:m:'.length);
 await alice.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-room-event',{detail:{eventType:'INSERT',new:{id:crypto.randomUUID(),member_id:id,guest_id:id,room_slug:'main',author_label:'Bob',body:'Morning all',bot_slug:null,reply_to_id:null,created_at:new Date().toISOString(),edited_at:null,deleted_at:null,removed:false,revision:1,attachment_ids:[]},old:{}}})),bobMember);
 await alice.waitForFunction(()=>!document.querySelector('p[data-chat-typing="true"]'),{timeout:1500});

 // Hidden tab and offline: nothing is sent.
 await sleep(3100);
 let count=sent('bob').length;
 await bob.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
 await bob.type('textarea[aria-label="Message LB"]','x');await sleep(400);
 assert.equal(sent('bob').length,count,'no signal while hidden');
 await bob.evaluate(()=>delete document.hidden);
 await bob.setOfflineMode(true);
 await bob.evaluate(()=>window.dispatchEvent(new Event('offline')));
 await bob.type('textarea[aria-label="Message LB"]','y');await sleep(400);
 assert.equal(sent('bob').length,count,'no signal while offline');
 await bob.setOfflineMode(false);
 await bob.evaluate(()=>window.dispatchEvent(new Event('online')));

 // Two typers in SOCIAL.
 const mallory=await login('mallory@example.test',1440);
 await room(alice,'social','SOCIAL');await room(bob,'social','SOCIAL');await room(mallory,'social','SOCIAL');
 await sleep(3100);
 await bob.type('textarea[aria-label="Message SOCIAL"]','hi',{delay:30});
 await mallory.type('textarea[aria-label="Message SOCIAL"]','hello',{delay:30});
 await alice.waitForFunction(()=>/and .* are typing…$/.test(document.querySelector('p[data-chat-typing="true"]')?.textContent||''),{timeout:10000});
 assert.match(await label(alice),/^(Bob and Mallory|Mallory and Bob) are typing…$/);
 await shot(alice,'room-two-dark-desktop-after');
 await mallory.close();

 // DM: once accepted, both get DM rights by refreshing their token (no reload).
 const inbox=async(page,body)=>page.evaluate(async body=>{const r=await fetch('/api/chat/inbox',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json()};},body);
 const conversation=(await inbox(alice)).data.conversations.find(c=>c.otherName==='Bob');
 assert.equal((await inbox(alice,{action:'accept',target:conversation.id})).status,200);
 const dmChannel=`private:chat:room:dm.${conversation.id}.typing`;
 await alice.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));
 await bob.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));
 await openDm(alice,conversation.id);await openDm(bob,conversation.id);
 await waitFor(()=>[...conns.values()].some(c=>c.who==='alice'&&c.channels.has(dmChannel))&&[...conns.values()].some(c=>c.who==='bob'&&c.capability[dmChannel]),15000,'DM rights after token refresh');
 await shot(alice,'dm-dark-desktop-before');
 await bob.type('#dm-body','Thanks for accepting',{delay:40});
 await alice.waitForSelector(`${dm} ${typing}`,{timeout:10000});
 assert.equal(await label(alice,dm),'Bob is typing…');
 await shot(alice,'dm-dark-desktop-after');
 assert.equal(await bob.$(`${dm} ${typing}`),null,'never your own typing in a DM');
 assert.ok(sent('bob',dmChannel).every(x=>x.clientId===bobToken.clientId));

 // Screenshots: both themes, desktop and phone, room and DM.
 if(shots){
  const signal=async(page,selector)=>{await sleep(3100);await page.type(selector,'.',{delay:10});};
  for(const theme of ['dark','light'])for(const [width,size] of [[1440,'desktop'],[390,'phone']]){
   if(theme==='dark'&&size==='desktop')continue;
   await alice.evaluate(t=>localStorage.setItem('longboard-public-chat-theme-v1',t),theme);
   await alice.setViewport({width,height:size==='phone'?844:900});
   await alice.reload();await alice.waitForSelector('textarea[aria-label^="Message "]');
   await live(alice);
   await room(alice,'main','LB');await bob.goto(`${base}/chat?room=main`);await live(bob);await bob.waitForSelector('textarea[aria-label="Message LB"]',{visible:true});
   await sleep(800);await shot(alice,`room-${theme}-${size}-before`);
   await signal(bob,'textarea[aria-label="Message LB"]');await alice.waitForSelector(typing,{timeout:10000});
   await shot(alice,`room-${theme}-${size}-after`);
   await openDm(alice,conversation.id);await openDm(bob,conversation.id);
   await waitFor(()=>[...conns.values()].some(c=>c.page===alice&&c.channels.has(dmChannel)),15000,'DM attach');
   await alice.waitForFunction(()=>!document.querySelector('p[data-chat-typing="true"]'),{timeout:10000});
   await shot(alice,`dm-${theme}-${size}-before`);
   await signal(bob,'#dm-body');await alice.waitForSelector(`${dm} ${typing}`,{timeout:10000});
   await shot(alice,`dm-${theme}-${size}-after`);
   assert.equal(await alice.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
  }
 }
 assert.deepEqual(errors,[]);
 console.log('PASS typing: server rights (publish only where posting, announcements subscribe-only, no DM before accept); member-pinned sender; name from member list; never self; one signal per 3 s; ephemeral and empty; ~6 s expiry; cleared by their message; silent when hidden or offline; two typers; DM after accept via token refresh; no page errors.');
}finally{await browser.close();}
