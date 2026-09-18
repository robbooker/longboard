import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base='http://localhost:3280';
await writeFile('/tmp/s03-dm.gif',Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const post=(page,body)=>page.evaluate(async body=>{const r=await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},body);
const get=(page,path)=>page.evaluate(async path=>(await fetch(path)).json(),path);
async function login(p,email){await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label^="Message "]');await p.waitForNetworkIdle({idleTime:500});}
const click=async(p,text)=>{const found=await p.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);b?.click();return Boolean(b);},text);assert.ok(found,text);};
async function select(p,id,name){await p.bringToFront();await p.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),id);await p.waitForFunction(name=>document.querySelector('header[data-dm="true"] h1')?.textContent===name,{},name);await p.waitForSelector('#dm-body',{visible:true});await p.waitForFunction(()=>document.activeElement?.id==='dm-body');}
try{
 const p=await browser.newPage();await p.setViewport({width:1440,height:1000});await login(p,'alice@example.test');
 const list=await get(p,'/api/chat/inbox'),a=list.conversations.find(c=>c.otherName==='Bob');assert.ok(a);if(a.status==='pending')assert.equal((await post(p,{action:'accept',target:a.id})).status,200);
 const mallory=(await get(p,'/api/chat/dm-members?q=Mallory')).members[0];const bResult=await post(p,{action:'request',target:mallory.id,body:'S03 synthetic setup',clientId:randomUUID()});assert.equal(bResult.status,200);const b=bResult.data.conversationId;
 const other=await browser.createBrowserContext(),otherPage=await other.newPage();await login(otherPage,'mallory@example.test');const otherList=await get(otherPage,'/api/chat/inbox');if(otherList.conversations.find(c=>c.id===b)?.status==='pending')assert.equal((await post(otherPage,{action:'accept',target:b})).status,200);await other.close();
 let mode='pass',freeze=false;const cached=new Map(),held=[],sent=[],reads=[],deletes=[];
 await p.setRequestInterception(true);p.on('request',async r=>{
  if(r.url().includes('/api/chat/attachments/')&&r.method()==='DELETE')deletes.push(r.url());
  if(!r.url().startsWith(base+'/api/chat/inbox'))return r.continue();
  const u=new URL(r.url());
  if(r.method()==='GET'){
   if(freeze&&cached.has(r.url()))return r.respond({status:200,contentType:'application/json',body:cached.get(r.url())});
   const response=await fetch(r.url(),{headers:r.headers()}),body=await response.text();if(response.ok)cached.set(r.url(),body);return r.respond({status:response.status,contentType:'application/json',body});
  }
  const payload=JSON.parse(r.postData()||'{}');if(payload.action==='read')reads.push(payload);
  if(!['send','request'].includes(payload.action)||mode==='pass')return r.continue();
  sent.push(payload);const selectedMode=mode;
  const result=fetch(r.url(),{method:'POST',headers:r.headers(),body:r.postData()}).then(async response=>({status:response.status,body:await response.text()}));
  if(selectedMode==='lost'){await result;return r.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic lost acknowledgement. Retry safely.'})});}
  let release;const gate=new Promise(resolve=>release=resolve);held.push({payload,result,release});await gate;const response=await result;return r.respond({status:response.status,contentType:'application/json',body:response.body});
 });
 console.log('setup complete');await select(p,a.id,'Bob');console.log('DM selected');await p.waitForNetworkIdle({idleTime:500});freeze=true;mode='hold';const timings=[];
 for(let i=0;i<20;i++){
  const body='S03 optimistic '+i;await p.type('#dm-body',body);
  timings.push(await p.evaluate(body=>new Promise((resolve,reject)=>{const start=performance.now(),timeout=setTimeout(()=>reject(Error('Optimistic row missing')),1000);const observer=new MutationObserver(()=>{const row=[...document.querySelectorAll('[data-client-id]')].find(e=>e.textContent.includes(body));if(row){observer.disconnect();requestAnimationFrame(()=>{clearTimeout(timeout);resolve(performance.now()-start);});}});observer.observe(document.body,{childList:true,subtree:true});document.querySelector('#dm-body').form.requestSubmit();}),body));
  assert.equal(await p.$eval('#dm-body',e=>e.value),'');assert.equal(await p.$eval('#dm-body',e=>e.disabled),false);assert.equal(await p.evaluate(()=>document.activeElement?.id),'dm-body');
 }
 const sorted=[...timings].sort((a,b)=>a-b),p95=sorted[Math.ceil(.95*sorted.length)-1];assert.ok(p95<100,JSON.stringify({timings,p95}));console.log('Optimistic20 p95ms',p95.toFixed(1));
 assert.equal(await p.$$eval('[data-client-id] [data-message-id],[data-client-id] [aria-label="Message reactions"],[data-client-id] [aria-label="Message actions"]',e=>e.length),0);
 await p.type('#dm-body','Newer draft survives acknowledgements');while(held.length<20)await new Promise(r=>setTimeout(r,20));for(const item of [...held].reverse()){assert.equal((await item.result).status,200);item.release();}held.length=0;
 await p.waitForFunction(()=>document.querySelectorAll('[data-client-id]').length===0);assert.equal(await p.$eval('#dm-body',e=>e.value),'Newer draft survives acknowledgements');
 assert.ok(reads.every(r=>!sent.some(s=>s.clientId===r.clientId)),'No pending client IDs are marked read');
 await p.$eval('#dm-body',e=>e.select());await p.keyboard.press('Backspace');await (await p.$('section[aria-label="Selected conversation"] input[type=file]')).uploadFile('/tmp/s03-dm.gif');await p.waitForFunction(()=>document.querySelector('ul[aria-label="Attachment drafts"]')?.textContent.includes('Ready to send'));mode='lost';await p.type('#dm-body','S03 lost ack');await p.$eval('#dm-body',e=>e.form.requestSubmit());await p.waitForSelector('[data-send-state="failed"]');const failed=sent.at(-1);assert.equal(failed.attachmentIds.length,1);assert.equal(await p.$('ul[aria-label="Attachment drafts"]'),null);assert.equal(deletes.length,0);mode='hold';await click(p,'Retry message');while(!held.length)await new Promise(r=>setTimeout(r,20));assert.equal(held[0].payload.clientId,failed.clientId);assert.deepEqual(held[0].payload.attachmentIds,failed.attachmentIds);held.shift().release();await p.waitForFunction(()=>document.querySelectorAll('[data-client-id]').length===0);
 freeze=false;const saved=await get(p,'/api/chat/inbox?conversation='+a.id);assert.equal(saved.messages.filter(m=>m.client_id===failed.clientId).length,1);assert.equal(deletes.length,0);freeze=true;
 await p.type('#dm-body','S03 scope isolation');await p.$eval('#dm-body',e=>e.form.requestSubmit());while(!held.length)await new Promise(r=>setTimeout(r,20));await select(p,b,'Mallory');await p.type('#dm-body','Other conversation draft');held.shift().release();await new Promise(r=>setTimeout(r,250));assert.equal(await p.$eval('#dm-body',e=>e.value),'Other conversation draft');assert.equal(await p.$$eval('[data-client-id]',els=>els.some(e=>e.textContent.includes('scope isolation'))),false);
 await p.setViewport({width:390,height:844});await p.screenshot({path:'/tmp/s03-dm-mobile.png'});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 // Race an introductory request with another session creating the same pair.
 mode='pass';freeze=false;await p.click('button[aria-label="Back to LB room"]');await p.click('button[aria-label="Open room navigation"]');await click(p,'＋ Start New DM');await p.type('dialog input[type=search]','Scout');await p.waitForSelector('ul[aria-label="Members"] button');const scout=(await get(p,'/api/chat/dm-members?q=Scout')).members[0];await click(p,'Scout Tester');await p.waitForFunction(()=>document.querySelector('header[data-dm="true"] h1')?.textContent==='Scout Tester'&&document.body.textContent.includes('Start with a request.'));await p.waitForSelector('#dm-body');await post(p,{action:'request',target:scout.id,body:'Other session introduction',clientId:randomUUID()});
 mode='hold';await p.type('#dm-body','S03 introductory request');await p.$eval('#dm-body',e=>e.form.requestSubmit());await p.waitForSelector('[data-client-id]');assert.equal(await p.$('#dm-body'),null,'No second introduction while sending');while(!held.length)await new Promise(r=>setTimeout(r,20));const intro=held.shift(),introResult=JSON.parse((await intro.result).body);assert.equal(introResult.message,null);intro.release();await p.waitForFunction(()=>document.querySelectorAll('[data-client-id]').length===0);await p.waitForFunction(()=>document.body.textContent.includes('Other session introduction'));assert.equal(await p.$('#dm-body'),null,'Request waits for acceptance');assert.equal(await p.$$eval('[data-message-id]',els=>els.some(e=>e.textContent.includes('S03 introductory request'))),false,'No invented introductory message');
 console.log('PASS delayed POST optimistic DM rendering/continued typing, stable retry lostack SQL dedupe, out-of-order acks, no local read/actions, scope isolation/new draft, mobile, single request gating and null-ack navigation.');
}catch(e){console.error(e);for(const p of await browser.pages())if(p.url().includes('/chat'))await p.screenshot({path:'/tmp/s03-dm-failure.png'});throw e;}finally{await browser.close();}
