import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:1000});
 await page.goto('http://localhost:3204/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 let posts=0;
 page.on('request',request=>{if(request.url().endsWith('/api/chat')&&request.method()==='POST')posts++;});
 const open=async()=>{await page.evaluate(()=>[...document.querySelectorAll('article button')].find(e=>e.textContent.trim()==='↳ Reply').click());await page.waitForSelector('#thread-reply');await page.waitForFunction(()=>document.activeElement?.id==='thread-reply');};
 for(const width of [1440,390]) {
  await page.setViewport({width,height:1000});await open();
  const message=`Keyboard reply ${width}`;
  await page.type('#thread-reply',message);
  await page.keyboard.down('Shift');await page.keyboard.press('Enter');await page.keyboard.up('Shift');await page.keyboard.type('second line');
  assert.equal(posts,width===1440?0:1);
  assert.equal(await page.$eval('#thread-reply',e=>e.value),`${message}\nsecond line`);
  // Composition-confirmation Enter and held-key repeats must never submit.
  for(const props of [{isComposing:true},{keyCode:229},{repeat:true}]) await page.$eval('#thread-reply',(e,props)=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...props})),props);
  assert.equal(posts,width===1440?0:1);
  await page.keyboard.press('Enter');
  // Repeated submit events in the same turn must produce exactly one request.
  await page.evaluate(()=>{const form=document.querySelector('#thread-reply').form;form.requestSubmit();form.requestSubmit();});
  await page.waitForFunction(()=>document.activeElement?.id==='thread-reply'&&!document.querySelector('#thread-reply').disabled&&document.querySelector('#thread-reply').value==='');
  await page.waitForFunction(text=>[...document.querySelectorAll('[aria-label="Replies to this comment"] article p')].some(e=>e.textContent===text),{},`${message}\nsecond line`);
  assert.equal(posts,width===1440?1:2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.click('button[aria-label="Close replies"]');
  await new Promise(resolve=>setTimeout(resolve,1600));
 }
 // Failure preserves the draft and returns focus. Moving focus outside the
 // panel during a slow request must not be undone when the request completes.
 await page.setViewport({width:1440,height:1000});await open();
 await page.setRequestInterception(true);
 page.on('request',request=>{if(request.url().endsWith('/api/chat')&&request.method()==='POST')setTimeout(()=>request.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Test send failure'})}),400);else void request.continue();});
 await page.type('#thread-reply','Keep this failed draft');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.activeElement?.id==='thread-reply'&&!document.querySelector('#thread-reply').disabled);
 assert.equal(await page.$eval('#thread-reply',e=>e.value),'Keep this failed draft');
 assert.match(await page.$eval('aside[aria-label="Comment replies"]',e=>e.textContent),/Test send failure/);
 await page.keyboard.press('Enter');await page.click('textarea[aria-label="Message LB"]');
 await page.waitForFunction(()=>!document.querySelector('#thread-reply').disabled);
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Message LB');
 assert.deepEqual(errors,[]);
 console.log('PASS desktop/mobile open focus, Shift+Enter newline, composition and repeat safety, Enter send, duplicate protection, cleared/refocused composer, failure draft/focus and external focus preservation.');
} finally {await browser.close();}
