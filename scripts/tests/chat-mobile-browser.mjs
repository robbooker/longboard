// Run against the isolated fixture described in docs/chat-mobile-replies.md.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.setViewport({width:375,height:812});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const panel='aside[aria-label="Comment replies"]';
 const parentId='20000000-0000-4000-8000-000000000001';
 const open=async()=>{const reply=`#chat-message-${parentId} button[aria-expanded]`;await page.waitForFunction(s=>{const e=document.querySelector(s);return e&&Object.keys(e).some(k=>k.startsWith('__reactProps$'));},{},reply);
 // A press while the room is still settling (layout change, menu closing) can be lost; press again if no thread opens.
 // AVATARS-REST: on a phone the empty "↳ Reply" link is hidden; Reply is in the message's ••• menu (or a swipe).
 const press=async()=>{if(await page.$eval(reply,e=>e.getClientRects().length>0))return page.click(reply);const menu=`#chat-message-${parentId} summary`;await page.click(menu);await page.waitForSelector(`#chat-message-${parentId} [data-menu-reply]`,{visible:true});await page.click(`#chat-message-${parentId} [data-menu-reply]`);};
 for(let i=0;i<3&&!(await page.$('#thread-reply'));i++){await press();await page.waitForSelector('#thread-reply',{timeout:5000}).catch(()=>{});}await page.waitForSelector('#thread-reply');};
 const ordered=()=>page.$eval(panel,e=>{const original=e.querySelector('[aria-label="Original comment"]'),replies=e.querySelector('[aria-label="Replies to this comment"]'),form=e.querySelector('form');return !!(original.compareDocumentPosition(replies)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(replies.compareDocumentPosition(form)&Node.DOCUMENT_POSITION_FOLLOWING)&&original.getBoundingClientRect().bottom<=replies.getBoundingClientRect().top&&replies.getBoundingClientRect().bottom<=form.getBoundingClientRect().top;});
 const closed=()=>page.waitForSelector(panel,{hidden:true});
 const back=async()=>{await page.evaluate(()=>history.back());};
 await page.goto('http://localhost:3204/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');
 await page.waitForSelector('textarea[aria-label="Message LB"]');await page.waitForSelector(`#chat-message-${parentId}`);
 // The room is server-rendered; text typed before React takes over the composer is dropped.
 await page.waitForFunction(()=>Object.keys(document.querySelector('textarea[aria-label="Message LB"]')).some(k=>k.startsWith('__reactProps')));
 await page.type('textarea[aria-label="Message LB"]','Keep my room draft');
 assert.equal(await page.$eval('nav[aria-label="Chat rooms"]',e=>getComputedStyle(e).display),'none');
 await page.click('button[aria-label="Open room navigation"]');
 await page.waitForFunction(()=>document.querySelector('nav[aria-label="Chat rooms"]').getBoundingClientRect().width>0);
 assert.equal(await page.$eval('section[aria-label="Longboard Chat"]',e=>e.inert),true);
 await page.screenshot({path:'/tmp/mobile-room-navigation.png'});
 await page.click('nav[aria-label="Chat rooms"] a[aria-current="page"]');
 assert.equal(await page.$eval('textarea[aria-label="Message LB"]',e=>e.value),'Keep my room draft');
 await page.click('button[aria-label="Open room navigation"]');await page.keyboard.press('Escape');
 assert.equal(await page.$eval('button[aria-label="Open room navigation"]',e=>document.activeElement===e),true);
 await page.click('button[aria-label="Open room navigation"]');await page.setViewport({width:1280,height:900});
 await page.waitForFunction(()=>!document.querySelector('section[aria-label="Longboard Chat"]').inert);
 assert.equal(await page.$eval('nav[aria-label="Chat rooms"]',e=>getComputedStyle(e).display),'flex');
 await page.setViewport({width:375,height:812});
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('nav[aria-label="Chat rooms"]')).display==='none');
 await page.click('button[aria-label="Open room navigation"]');
 await page.click('nav a[href="/chat?room=social"]');await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');
 assert.equal(await page.$eval('nav[aria-label="Chat rooms"]',e=>getComputedStyle(e).display),'none');
 await page.click('button[aria-label="Open room navigation"]');await page.click('nav a[href="/chat?room=main"]');
 await page.waitForSelector('textarea[aria-label="Message LB"]');
 assert.equal(await page.$eval('textarea[aria-label="Message LB"]',e=>e.value),'Keep my room draft');
 for(const width of [320,375,768]){
  await page.setViewport({width,height:812});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.click('button[aria-label="Open room navigation"]');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.click('nav button');
 }
 await page.setViewport({width:375,height:812});
 await open();await page.type('#thread-reply','Keep my reply draft');
 assert.equal(await page.$eval('section[aria-label="Longboard Chat"]',e=>e.inert),true);
 await back();await closed();assert.equal(await page.$eval('textarea[aria-label="Message LB"]',e=>e.value),'Keep my room draft');
 await page.evaluate(()=>history.forward());await page.waitForSelector('#thread-reply');assert.equal(await page.$eval('#thread-reply',e=>e.value),'Keep my reply draft');
 async function send(text){
  await page.$eval('#thread-reply',e=>e.select());await page.type('#thread-reply',text);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/chat')&&r.request().method()==='POST');
  await page.evaluate(()=>Array.from(document.querySelectorAll('aside button')).find(b=>b.getAttribute('aria-label')==='Send reply').click());
  const response=await pending;assert.equal(response.status(),200,await response.text());const result=await response.json();
  await page.waitForFunction(()=>document.querySelector('#thread-reply')?.value==='');return result.message;
 }
 // A failed send keeps the reply in the thread, marked Not sent, with Retry (#308).
 await page.$eval('#thread-reply',e=>e.select());await page.type('#thread-reply','A mobile reply');
 await page.setRequestInterception(true);let failOnce=true;
 const intercept=request=>{if(failOnce&&request.url().endsWith('/api/chat')&&request.method()==='POST'){failOnce=false;void request.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Try again shortly.'})});}else void request.continue();};
 page.on('request',intercept);
 await page.evaluate(()=>Array.from(document.querySelectorAll('aside button')).find(b=>b.getAttribute('aria-label')==='Send reply').click());
 await page.waitForSelector('aside article[data-send-state="failed"] [role="alert"]');
 assert.equal(await page.$eval('aside article[data-send-state="failed"]',e=>e.textContent.includes('A mobile reply')),true);
 await page.setRequestInterception(false);page.off('request',intercept);
 const retried=page.waitForResponse(r=>r.url().endsWith('/api/chat')&&r.request().method()==='POST');
 await page.evaluate(()=>Array.from(document.querySelectorAll('aside button')).find(b=>b.textContent==='Retry reply').click());
 const retry=await retried;assert.equal(retry.status(),200,await retry.text());
 const child=(await retry.json()).message;assert.equal(child.reply_to_id,parentId);assert.equal(await page.$(`#chat-message-${child.id}`),null);
 await page.waitForFunction(id=>document.querySelector(`#chat-message-${id} button[aria-expanded]`)?.textContent.includes('1 reply'),{},parentId);assert.equal(await ordered(),true);
 await page.type('#thread-reply','Root draft retained');
 await page.evaluate(()=>Array.from(Array.from(document.querySelectorAll('aside article')).find(e=>e.textContent.includes('A mobile reply')).querySelectorAll('button')).find(b=>b.textContent.includes('Reply')).click());
 await page.waitForFunction(()=>document.querySelector('article[aria-label="Original comment"]')?.textContent.includes('A mobile reply'));
 // API throttles consecutive human messages; ordinary user typing exceeds 1.5s.
 await page.type('#thread-reply','A nested mobile reply',{delay:90});
 const grandchild=await send('A nested mobile reply');assert.equal(grandchild.reply_to_id,child.id);
 await page.type('#thread-reply','Child draft retained');
 await page.click('button[aria-label="Back to previous comment"]');
 await page.waitForFunction(()=>document.querySelector('#thread-reply')?.value==='Root draft retained');
 await page.evaluate(()=>Array.from(Array.from(document.querySelectorAll('aside article')).find(e=>e.textContent.includes('A mobile reply')).querySelectorAll('button')).find(b=>b.textContent.includes('Reply')).click());
 await page.waitForFunction(()=>document.querySelector('#thread-reply')?.value==='Child draft retained');
 await page.waitForFunction(()=>document.querySelector('[aria-label="Replies to this comment"]')?.textContent.includes('A nested mobile reply'));
 for(const [width,height] of [[320,568],[375,812],[390,844],[768,1024],[844,390]]){
  await page.setViewport({width,height});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.$eval(panel,e=>Math.abs(e.getBoundingClientRect().width-innerWidth)<1),true);
 }
 await page.setViewport({width:390,height:844});
 await page.$eval(`${panel} button`,e=>e.focus());await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');assert.equal(await page.evaluate(()=>document.activeElement===Array.from(document.querySelector('aside[aria-label="Comment replies"]').querySelectorAll('button:not(:disabled),textarea:not(:disabled)')).at(-1)),true);
 await page.screenshot({path:'/tmp/mobile-reply-focused.png'});
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);assert.equal(await page.$eval(panel,e=>getComputedStyle(e).animationName),'none');
 await page.click('button[aria-label="Close replies"]');await closed();
 assert.equal(await page.$eval('textarea[aria-label="Message LB"]',e=>e.value),'Keep my room draft');
 // Preserve a manually selected point in the mounted room while opening/closing.
 // A wheel turn marks it as the reader's own scroll; a bare scrollTop change is not one and the room keeps following.
 await page.$eval(`#chat-message-${parentId}`,e=>{const s=e.parentElement;s.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));s.scrollTop-=120;s.dispatchEvent(new Event('scroll'));});await new Promise(r=>setTimeout(r,300));
 const roomScroll=await page.$eval(`#chat-message-${parentId}`,e=>e.parentElement.scrollTop);
 await page.$eval(`#chat-message-${parentId} button[aria-expanded]`,e=>e.click());await page.waitForSelector('#thread-reply');
 await page.keyboard.press('Escape');await closed();
 assert.equal(await page.$eval(`#chat-message-${parentId}`,e=>e.parentElement.scrollTop),roomScroll);
 for(const width of [1100,1280,1920]){
  await page.setViewport({width,height:900});await open();
  assert.equal(await page.$eval('section[aria-label="Longboard Chat"]',e=>e.inert),false);assert.equal(await ordered(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.click('button[aria-label="Close replies"]');await closed();
 }
 await page.reload();await page.waitForSelector(`#chat-message-${parentId}`);
 assert.equal(await page.$(`#chat-message-${child.id}`),null);
 await page.waitForFunction(id=>document.querySelector(`#chat-message-${id} button[aria-expanded]`)?.textContent.includes('1 reply'),{},parentId);
 await open();await page.waitForFunction(()=>document.querySelector('aside[aria-label="Comment replies"]')?.textContent.includes('A mobile reply'));const geometry=await page.evaluate(()=>({chatRight:document.querySelector('section[aria-label="Longboard Chat"]').getBoundingClientRect().right,threadLeft:document.querySelector('aside[aria-label="Comment replies"]').getBoundingClientRect().left}));assert.ok(geometry.threadLeft>=geometry.chatRight-1);
 await page.screenshot({path:'/tmp/desktop-thread-only.png'});
 const history=await page.evaluate(async()=>await (await fetch('/api/chat/history?room=main')).json());assert.ok(history.messages.length>0);assert.ok(history.messages.every(m=>!m.reply_to_id));
 await page.click('button[aria-label="Close replies"]');await closed();
 await page.evaluate(id=>{location.hash=`chat-message-${id}`;},child.id);await page.waitForSelector('#thread-reply');
 await page.waitForFunction(()=>document.querySelector('aside[aria-label="Comment replies"]')?.textContent.includes('A mobile reply'));
 assert.deepEqual(errors,[]);console.log('PASS mobile back/forward, nested parent linkage, drafts, room scroll, responsive sizes, reduced motion, desktop coexistence, no page errors');
}finally{await browser.close();}
