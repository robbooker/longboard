// Isolated PGlite fixture only. Delays browser acknowledgements, never production.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base='http://localhost:3280',rest='http://localhost:54480/rest/v1/';
async function fixture(path,body){const r=await fetch(rest+path,{method:body?'POST':'GET',headers:{authorization:'Bearer test-service-role','content-type':'application/json',prefer:'return=representation'},body:body?JSON.stringify(body):undefined});assert(r.ok,await r.clone().text());return r.json();}
console.log('seed');
const member=(await fixture('longboard_chat_members?user_id=eq.00000000-0000-4000-8000-000000000001'))[0].id;
// Age fixture history so its bulk seed does not consume the real send quota.
await fetch(rest+'longboard_chat_messages?member_id=eq.'+member,{method:'PATCH',headers:{authorization:'Bearer test-service-role','content-type':'application/json'},body:JSON.stringify({created_at:new Date(Date.now()-86400000).toISOString()})});
const root=randomUUID(),nested=randomUUID();
await fixture('longboard_chat_messages',{id:root,guest_id:member,member_id:member,author_label:'Alice',body:'S03 reply parent',room_slug:'social'});
await fixture('longboard_chat_messages',{id:nested,guest_id:member,member_id:member,author_label:'Alice',body:'S03 nested seed',room_slug:'social',reply_to_id:root});
console.log('launch');
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const p=await browser.newPage();await p.setViewport({width:1440,height:1000});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 console.log('login');await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email','alice@example.test');await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label="Message LB"]');
 console.log('thread');await p.goto(base+'/chat?room=social#chat-message-'+nested,{waitUntil:'domcontentloaded'});await p.waitForSelector('#thread-reply');
 const frozenThread=await p.evaluate(async id=>(await fetch('/api/chat/thread?room=social&messageId='+id)).json(),root);
 let mode='hold',freeze=true,lastSend=Date.now();const cache=new Map(),held=[],payloads=[];
 await p.setRequestInterception(true);p.on('request',async r=>{
  if(r.url()===base+'/api/chat/updates'&&r.method()==='POST'){const response=await fetch(r.url(),{method:'POST',headers:r.headers(),body:r.postData()}),data=await response.json();if(freeze)for(const item of data.results??[])if(item.path.startsWith('/api/chat/thread?')&&item.path.includes(root))item.data=frozenThread;return r.respond({status:response.status,contentType:'application/json',body:JSON.stringify(data)});}
  if(r.url().startsWith(base+'/api/chat/thread')){if(freeze&&cache.has(r.url()))return r.respond({status:200,contentType:'application/json',body:cache.get(r.url())});const response=await fetch(r.url(),{headers:r.headers()}),body=await response.text();if(response.ok)cache.set(r.url(),body);return r.respond({status:response.status,contentType:'application/json',body});}
  if(r.url()!==base+'/api/chat'||r.method()!=='POST')return r.continue();const payload=JSON.parse(r.postData()||'{}');if(payload.action!=='send')return r.continue();payloads.push(payload);await new Promise(resolve=>setTimeout(resolve,Math.max(0,1800-(Date.now()-lastSend))));const response=await fetch(r.url(),{method:'POST',headers:r.headers(),body:r.postData()}),body=await response.text();assert.equal(response.status,200,body);lastSend=Date.now();
  if(mode==='lost')return r.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic lost acknowledgement'})});
  let release;const gate=new Promise(resolve=>release=resolve);held.push({release,payload});await gate;return r.respond({status:response.status,contentType:'application/json',body});
 });
 // Seed frozen read before testing missing acknowledgement reconciliation.
 await p.evaluate(async()=>{await fetch('/api/chat/thread?room=social&messageId='+document.querySelector('aside [data-reaction-message]')?.getAttribute('data-reaction-message'));});
 console.log('measure');const timings=[];
 for(let i=0;i<20;i++){
  await p.type('#thread-reply','S03 immediate reply '+i);
  timings.push(await p.evaluate(()=>new Promise((resolve,reject)=>{const start=performance.now(),n=document.querySelectorAll('aside [data-send-state]').length;const timer=setTimeout(()=>reject(Error('No pending reply')),1000);const ob=new MutationObserver(()=>{if(document.querySelectorAll('aside [data-send-state]').length>n){ob.disconnect();requestAnimationFrame(()=>{clearTimeout(timer);resolve(performance.now()-start);});}});ob.observe(document.querySelector('aside[aria-label="Comment replies"]'),{subtree:true,childList:true});document.querySelector('#thread-reply').form.requestSubmit();})));
  assert.equal(await p.$eval('#thread-reply',e=>e.value),'');assert.equal(await p.$eval('#thread-reply',e=>e.disabled),false);await new Promise(r=>setTimeout(r,2100));
 }
 const p95=[...timings].sort((a,b)=>a-b)[18];assert(p95<100,JSON.stringify({timings,p95}));console.log('Reply20 optimistic p95ms',p95.toFixed(1));
 await p.type('#thread-reply','New draft stays');assert.equal(held.length,20);for(const h of [...held].reverse())h.release();held.length=0;await p.waitForFunction(()=>!document.querySelector('aside [data-send-state]'));assert.equal(await p.$eval('#thread-reply',e=>e.value),'New draft stays');
 await p.$eval('#thread-reply',e=>e.select());await p.keyboard.press('Backspace');mode='lost';await p.type('#thread-reply','S03 retry one reply');await p.$eval('#thread-reply',e=>e.form.requestSubmit());await p.waitForSelector('aside [data-send-state="failed"]');const failed=payloads.at(-1);mode='hold';await p.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='Retry reply').click());while(!held.length)await new Promise(r=>setTimeout(r,20));assert.equal(held[0].payload.clientId,failed.clientId);held.shift().release();await p.waitForFunction(()=>!document.querySelector('aside [data-send-state]'));assert.equal((await fixture('longboard_chat_messages?client_id=eq.'+failed.clientId)).length,1);
 await new Promise(r=>setTimeout(r,2100));await p.type('#thread-reply','S03 close while sending');await p.$eval('#thread-reply',e=>e.form.requestSubmit());while(!held.length)await new Promise(r=>setTimeout(r,20));await p.click('button[aria-label="Close replies"]');held.shift().release();await new Promise(r=>setTimeout(r,200));assert.equal(await p.$('#thread-reply'),null);
 freeze=false;await p.click('#chat-message-'+root+' button[aria-expanded]');await p.waitForSelector('#thread-reply');await p.setViewport({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:'/tmp/s03-replies-mobile.png'});assert.deepEqual(errors,[]);console.log('PASS reply optimistic latency, continued typing, out-of-order acknowledgements, same-client lost-ack SQL dedupe, closed-thread late acknowledgement, mobile layout and no page errors.');
}finally{await browser.close();}
