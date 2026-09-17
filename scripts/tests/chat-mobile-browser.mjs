// Run against the isolated fixture described in docs/chat-mobile-replies.md.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.setViewport({width:375,height:812});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const panel='aside[aria-label="Comment replies"]';
 const parentId='20000000-0000-4000-8000-000000000001';
 const open=async()=>{await page.click(`#chat-message-${parentId} button[aria-expanded]`);await page.waitForSelector('#thread-reply');};
 const ordered=()=>page.$eval(panel,e=>{const original=e.querySelector('[aria-label="Original comment"]'),replies=e.querySelector('[aria-label="Replies to this comment"]'),form=e.querySelector('form');return !!(original.compareDocumentPosition(replies)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(replies.compareDocumentPosition(form)&Node.DOCUMENT_POSITION_FOLLOWING)&&original.getBoundingClientRect().bottom<=replies.getBoundingClientRect().top&&replies.getBoundingClientRect().bottom<=form.getBoundingClientRect().top;});
 const closed=()=>page.waitForSelector(panel,{hidden:true});
 const back=async()=>{await page.evaluate(()=>history.back());};
 await page.goto('http://localhost:3204/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');
 await page.waitForSelector('textarea[aria-label="Message LB"]');await page.waitForSelector(`#chat-message-${parentId}`);
 await page.type('textarea[aria-label="Message LB"]','Keep my room draft');
 await open();await page.type('#thread-reply','Keep my reply draft');
 assert.equal(await page.$eval('section[aria-label="Longboard Chat"]',e=>e.inert),true);
 await back();await closed();assert.equal(await page.$eval('textarea[aria-label="Message LB"]',e=>e.value),'Keep my room draft');
 await page.evaluate(()=>history.forward());await page.waitForSelector('#thread-reply');assert.equal(await page.$eval('#thread-reply',e=>e.value),'Keep my reply draft');
 async function send(text){
  await page.$eval('#thread-reply',e=>e.select());await page.type('#thread-reply',text);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/chat')&&r.request().method()==='POST');
  await page.evaluate(()=>Array.from(document.querySelectorAll('aside button')).find(b=>b.textContent==='Send reply').click());
  const response=await pending;assert.equal(response.status(),200,await response.text());const result=await response.json();
  await page.waitForFunction(()=>document.querySelector('#thread-reply')?.value==='');return result.message;
 }
 // A failed send must retain the editable draft.
 await page.setRequestInterception(true);let failOnce=true;
 const intercept=request=>{if(failOnce&&request.url().endsWith('/api/chat')&&request.method()==='POST'){failOnce=false;void request.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Try again shortly.'})});}else void request.continue();};
 page.on('request',intercept);
 await page.evaluate(()=>Array.from(document.querySelectorAll('aside button')).find(b=>b.textContent==='Send reply').click());
 await page.waitForSelector('aside [role="alert"]');assert.equal(await page.$eval('#thread-reply',e=>e.value),'Keep my reply draft');
 await page.setRequestInterception(false);page.off('request',intercept);
 const child=await send('A mobile reply');assert.equal(child.reply_to_id,parentId);assert.equal(await ordered(),true);
 await page.type('#thread-reply','Root draft retained');
 await page.evaluate(()=>Array.from(document.querySelectorAll('aside article')).find(e=>e.textContent.includes('A mobile reply')).querySelector('button').click());
 await page.waitForFunction(()=>document.querySelector('article[aria-label="Original comment"]')?.textContent.includes('A mobile reply'));
 // API throttles consecutive human messages; ordinary user typing exceeds 1.5s.
 await page.type('#thread-reply','A nested mobile reply',{delay:90});
 const grandchild=await send('A nested mobile reply');assert.equal(grandchild.reply_to_id,child.id);
 await page.type('#thread-reply','Child draft retained');
 await page.click('button[aria-label="Back to previous comment"]');
 await page.waitForFunction(()=>document.querySelector('#thread-reply')?.value==='Root draft retained');
 await page.evaluate(()=>Array.from(document.querySelectorAll('aside article')).find(e=>e.textContent.includes('A mobile reply')).querySelector('button').click());
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
 await page.$eval(`#chat-message-${parentId}`,e=>e.parentElement.scrollTop-=120);
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
 assert.deepEqual(errors,[]);console.log('PASS mobile back/forward, nested parent linkage, drafts, room scroll, responsive sizes, reduced motion, desktop coexistence, no page errors');
}finally{await browser.close();}
