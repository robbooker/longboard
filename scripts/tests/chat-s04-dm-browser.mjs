import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base='http://localhost:3282';
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

 let delay=true,deny=false;await p.setRequestInterception(true);p.on('request',async r=>{
  if(r.url().endsWith('/api/chat/updates')&&r.method()==='POST'&&JSON.parse(r.postData()||'{}').paths?.some(path=>path.includes('/api/chat/inbox?conversation='))){
   const response=await fetch(r.url(),{method:'POST',headers:r.headers(),body:r.postData()}),body=await response.json();await new Promise(resolve=>setTimeout(resolve,delay?650:0));
   if(deny)for(const item of body.results??[])if(item.path.includes('conversation='+a.id)){item.status=403;item.data={error:'Synthetic access revoked'};}
   try{return await r.respond({status:response.status,contentType:'application/json',body:JSON.stringify(body)});}catch{return;}
  }
  return r.continue();
 });
 // Seed enough actual authorized history for a meaningful restored scroll position.
 for(let i=0;i<8;i++)assert.equal((await post(p,{action:'send',target:a.id,body:'S04 private history '+i+' '+('long history '.repeat(70)),clientId:randomUUID()})).status,200);
 await p.bringToFront();await p.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),a.id);await p.waitForSelector('[role=status][aria-label="Loading messages"]');await p.waitForFunction(()=>document.body.textContent.includes('S04 private history 7'));await select(p,a.id,'Bob');await p.type('#dm-body','Bob text draft');await p.$eval('[aria-label="Selected conversation"] [aria-live=polite]',e=>{e.scrollTop=35;e.dispatchEvent(new Event('scroll'));});
 await select(p,b,'Mallory');await p.waitForFunction(()=>!document.querySelector('[aria-label="Loading messages"]'));await p.type('#dm-body','Mallory draft');
 const timings=[];for(let i=0;i<20;i++){
 const id=i%2===0?a.id:b,name=i%2===0?'Bob':'Mallory',draft=i%2===0?'Bob text draft':'Mallory draft';
 timings.push(await p.evaluate(({id,name,draft})=>new Promise((resolve,reject)=>{const start=performance.now(),timer=setTimeout(()=>reject(Error('Warm switch delayed '+JSON.stringify({name,actual:document.querySelector('header[data-dm=true] h1')?.textContent,draft,actualDraft:document.querySelector('#dm-body')?.value,loading:!!document.querySelector('[aria-label="Loading messages"]')}))),500);const observer=new MutationObserver(()=>{if(document.querySelector('header[data-dm=true] h1')?.textContent===name&&document.querySelector('#dm-body')?.value===draft&&!document.querySelector('[aria-label="Loading messages"]')){observer.disconnect();requestAnimationFrame(()=>{clearTimeout(timer);resolve(performance.now()-start);});}});observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id}));}),{id,name,draft}));
 if(name==='Bob')assert.ok(Math.abs(await p.$eval('[aria-label="Selected conversation"] [aria-live=polite]',e=>e.scrollTop)-35)<3,'Restored older-history scroll');
 }
 const sorted=[...timings].sort((a,b)=>a-b),p95=sorted[Math.ceil(sorted.length*.95)-1];assert.ok(p95<150,JSON.stringify(timings));console.log('DM warm20 p95ms',p95.toFixed(1));
 await p.setViewport({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:'/tmp/s04-dm-mobile.png'});
 deny=true;await select(p,a.id,'Bob');await p.waitForFunction(()=>document.body.textContent.includes('Synthetic access revoked'));assert.equal(await p.$$eval('[data-message-id]',e=>e.length),0);assert.equal(await p.$eval('#dm-body',e=>e.value),'');await select(p,b,'Mallory');await select(p,a.id,'Bob');assert.equal(await p.$$eval('[data-message-id]',e=>e.length),0,'Forbidden cache cannot restore old private history');
 console.log('PASS cold skeleton,20 delayed-GET warm switches, per-DM text draft and scroll, mobile layout, revoked-access private-history clearing.');
}catch(e){await (await browser.pages()).at(-1)?.screenshot({path:'/tmp/s04-dm-failure.png'});throw e;}finally{await browser.close();}
