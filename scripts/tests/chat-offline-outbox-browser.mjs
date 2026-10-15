// OFFLINE-OUTBOX: messages typed with no connection wait on the device and send, once and in
// order, when the signal returns. Run against the isolated chat-mobile-fixture.mjs with
// `next dev --port 3204` (see docs/chat-mobile-replies.md). SHOTS=<dir> also saves phone screenshots.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3204',shots=process.env.SHOTS;
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.setViewport({width:390,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // next dev reloads the page when a hot update can't be fetched (as happens offline); keep its
 // update socket closed so only the app's own behaviour is under test.
 await page.evaluateOnNewDocument(()=>{const Real=window.WebSocket;window.WebSocket=new Proxy(Real,{construct(T,args){if(String(args[0]).includes('/_next/webpack-hmr')){const fake=new EventTarget();Object.assign(fake,{readyState:0,send(){},close(){},url:String(args[0])});return fake;}return Reflect.construct(T,args);}});});
 const composer='textarea[aria-label="Message LB"]';
 // Every room/DM send the browser makes, by clientId.
 const sends=[];let dropSends=false;
 const ready=async()=>{await page.waitForSelector(composer);await page.waitForFunction(c=>Object.keys(document.querySelector(c)).some(k=>k.startsWith('__reactProps')),{},composer);};
 await page.goto(`${base}/login?next=%2Fchat`);await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');
 await ready();
 await page.setRequestInterception(true);
 page.on('request',r=>{let body=null;try{body=JSON.parse(r.postData()||'null');}catch{}
  if(r.method()==='POST'&&/\/api\/chat(\/inbox)?$/.test(new URL(r.url()).pathname)&&body?.action==='send'){sends.push({path:new URL(r.url()).pathname,clientId:body.clientId,body:body.body});if(dropSends)return void r.abort('internetdisconnected');}
  void r.continue();});
 const memberKey=await page.evaluate(()=>Object.keys(localStorage).find(k=>k.startsWith('longboard-chat-outbox-v1:'))??null);
 assert.equal(memberKey,null,'nothing queued at the start');
 const send=async text=>{await page.click(composer);await page.type(composer,text);await page.$eval(composer,e=>e.form.requestSubmit());await page.waitForFunction(c=>document.querySelector(c).value==='',{},composer);};
 const roomOrder=texts=>page.$$eval('article',(els,texts)=>els.filter(e=>!e.parentElement.closest('article')).flatMap(e=>texts.filter(t=>e.textContent.includes(t))),texts);

 // A: airplane mode -> type 3 messages -> they wait -> reconnect -> all 3 appear once, in order.
 const stamp=Date.now().toString(36),texts=[1,2,3].map(i=>`Offline ${stamp} number ${i}`);
 await page.setOfflineMode(true);
 await page.waitForSelector('[data-chat-offline]');
 for(const [i,t] of texts.entries()){
  await send(t);
  if(i===1&&shots){
   await page.waitForFunction(()=>document.querySelectorAll('article[data-send-queued]').length===2);await new Promise(r=>setTimeout(r,400));
   await page.screenshot({path:`${shots}/outbox-room-dark.png`});
   await page.click('button[aria-label="Chat settings"]');await page.waitForSelector('[role="group"][aria-label="Chat theme"] button');
   await page.$$eval('[role="group"][aria-label="Chat theme"] button',bs=>bs.find(b=>b.textContent.includes('Light')).click());
   await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('main[data-theme]')?.dataset.theme==='light');await page.evaluate(()=>document.activeElement?.blur());await new Promise(r=>setTimeout(r,400));
   await page.screenshot({path:`${shots}/outbox-room-light.png`});
   await page.click('button[aria-label="Chat settings"]');await page.waitForSelector('[role="group"][aria-label="Chat theme"] button');
   await page.$$eval('[role="group"][aria-label="Chat theme"] button',bs=>bs.find(b=>b.textContent.includes('Dark')).click());
   await page.keyboard.press('Escape');
  }
 }
 await page.waitForFunction(()=>document.querySelectorAll('article[data-send-queued]').length===3);
 assert.deepEqual(await page.$$eval('article[data-send-queued]',els=>els.map(e=>e.querySelector('[data-send-waiting] p').textContent.trim())),Array(3).fill('Waiting for connection. It will send when you’re back online.'));
 assert.deepEqual(await roomOrder(texts),texts,'queued in the order typed');
 const stored=await page.evaluate(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('longboard-chat-outbox-v1:')&&!k.includes(':lock:'));return k?JSON.parse(localStorage.getItem(k)):[];});
 assert.deepEqual(stored.map(i=>i.body),texts,'kept on the device');assert.ok(stored.every(i=>i.kind==='room'&&i.target==='main'&&i.clientId&&i.memberId));
 assert.equal(sends.length,0,'nothing tried while offline');
 await page.setOfflineMode(false);
 await page.waitForFunction(()=>!document.querySelector('article[data-send-queued], article[data-pending]'),{timeout:20000});
 assert.deepEqual(await roomOrder(texts),texts,'all three appear once, in order');
 assert.deepEqual([...new Set(sends.map(s=>s.clientId))],stored.map(i=>i.clientId),'sent in order with the clientIds given when typed');
 assert.equal(sends.length,3,'each sent once (queued sends are spaced to the room rate limit)');
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('longboard-chat-outbox-v1:')&&!k.includes(':lock:'))),false,'outbox emptied');
 await page.reload();await ready();await page.waitForFunction(t=>document.body.textContent.includes(t),{},texts[2]);
 assert.deepEqual(await roomOrder(texts),texts,'after reload: still exactly once, in order');
 console.log('PASS room: 3 offline messages wait, then send once in order on reconnect');

 // B: the connection drops mid-send (online flag still true) -> it waits, survives a reload, sends later.
 sends.length=0;dropSends=true;const lost=`Lost signal ${stamp}`;
 await send(lost);
 await page.waitForSelector('article[data-send-queued]');
 assert.equal(await page.$('article[data-send-failed]'),null,'a connection drop is not "Not sent"');
 await page.reload();await ready();
 await page.waitForFunction(t=>[...document.querySelectorAll('article[data-send-queued]')].some(e=>e.textContent.includes(t)),{},lost);
 const lostIds=new Set(sends.map(s=>s.clientId));assert.equal(lostIds.size,1,'every attempt reuses one clientId');
 dropSends=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await page.waitForFunction(()=>!document.querySelector('article[data-send-queued], article[data-pending]'),{timeout:20000});
 assert.equal((await roomOrder([lost])).length,1,'shown once');
 assert.equal(new Set(sends.map(s=>s.clientId)).size,1,'still the same clientId');
 await page.reload();await ready();await page.waitForFunction(t=>document.body.textContent.includes(t),{},lost);
 assert.equal((await roomOrder([lost])).length,1,'stored once on the server');
 console.log('PASS room: dropped send waits, is restored after reload, and sends once');

 // C: DMs typed offline wait and send in order.
 const conversation=await page.evaluate(async()=>{const list=await(await fetch('/api/chat/inbox')).json();const c=list.conversations.find(c=>c.otherName==='Bob');if(c.status==='pending')await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'accept',target:c.id})});return c.id;});
 await page.reload();await ready();
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),conversation);
 await page.waitForSelector('#dm-body',{visible:true});
 await page.waitForSelector('section[aria-label="Private conversation"] [aria-label="Loading messages"]',{hidden:true}).catch(()=>{});
 await new Promise(r=>setTimeout(r,800));
 await page.waitForFunction(()=>Object.keys(document.querySelector('#dm-body')).some(k=>k.startsWith('__reactProps')));
 sends.length=0;const dms=[1,2].map(i=>`DM offline ${stamp} ${i}`);
 await page.setOfflineMode(true);
 for(const t of dms){await page.click('#dm-body');await page.type('#dm-body',t);await page.$eval('#dm-body',e=>e.form.requestSubmit());await page.waitForFunction(()=>document.querySelector('#dm-body').value==='');}
 await page.waitForFunction(()=>document.querySelectorAll('[data-send-state="waiting"]').length===2);
 assert.ok((await page.$eval('[data-send-state="waiting"]',e=>e.textContent)).includes('Waiting for connection'));
 assert.equal(sends.length,0);
 await page.setOfflineMode(false);
 await page.waitForFunction(()=>!document.querySelector('[data-client-id]'),{timeout:20000});
 const dmOrder=await page.$$eval('[data-message-id]',(els,dms)=>els.flatMap(e=>dms.filter(t=>e.textContent.includes(t))),dms);
 assert.deepEqual(dmOrder,dms,'DMs appear once, in order');
 assert.equal(new Set(sends.map(s=>s.clientId)).size,2);assert.equal(sends.length,2,'each DM sent once');
 assert.deepEqual(sends.map(s=>s.body),dms);
 console.log('PASS DM: offline messages wait, then send once in order');

 assert.deepEqual(errors,[]);
 console.log('PASS chat offline outbox');
}catch(e){const p=(await browser.pages()).at(-1);if(p&&process.env.FAILSHOT)await p.screenshot({path:process.env.FAILSHOT}).catch(()=>{});throw e;}finally{await browser.close();}
