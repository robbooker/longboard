import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:390,height:844});
 await page.goto(`${process.env.CHAT_TEST_URL||'http://localhost:3204'}/login?next=%2Fchat`);await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 const nav='nav[aria-label="Chat rooms"]',feature='button[aria-label^="Feature notifications"]',inbox='button[data-active]';
 for(const width of [320,390,768,1099]) {
  await page.setViewport({width,height:900});
  await page.waitForSelector(`${nav} ${feature}`);
  assert.equal(await page.$(`header ${feature}`),null);
  assert.equal(await page.$(`header ${inbox}`),null);
  for(const selector of ['button[aria-label="Search chat"]','button[aria-label^="Chat notifications"]','button[aria-label="Chat settings"]']) assert.ok(await page.$eval(selector,e=>e.getBoundingClientRect().width>0));
  await page.click('button[aria-label="Open room navigation"]');await page.waitForSelector(`${nav} ${feature}`,{visible:true});
  await page.click(`${nav} ${feature}`);await page.waitForSelector('section[aria-label="Feature notifications"]',{visible:true});
  const bounds=await page.$eval('section[aria-label="Feature notifications"]',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};});assert.ok(bounds.left>=0&&bounds.right<=bounds.width);
  await page.click('button[aria-label="Close notifications"]');
  await page.click(`${nav} ${inbox}`);await page.waitForSelector('section[aria-label="Private conversation"]',{visible:true});
  await page.evaluate(()=>[...document.querySelectorAll('section[aria-label="Private conversation"] button')].find(e=>e.textContent==='Back to room').click());await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open room navigation');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await page.setViewport({width:390,height:844});await page.screenshot({path:'/tmp/mobile-header-compact.png'});
 await page.click('button[aria-label="Open room navigation"]');await page.screenshot({path:'/tmp/mobile-header-nav.png'});
 await page.click(`${nav} ${inbox}`);await page.waitForSelector('section[aria-label="Private conversation"]',{visible:true});
 await page.setViewport({width:1440,height:900});await page.waitForSelector('section[aria-label="Private conversation"]',{visible:true});assert.ok(await page.$(`header ${feature}`));assert.equal(await page.$('dialog[open]'),null);
 await page.setViewport({width:390,height:844});await page.waitForSelector('section[aria-label="Private conversation"]',{visible:true});await page.evaluate(()=>[...document.querySelectorAll('section[aria-label="Private conversation"] button')].find(e=>e.textContent==='Back to room').click());
 assert.deepEqual(errors,[]);console.log('PASS mobile header/nav placement, notifications panel bounds, main-area DM, close focus, desktop relocation, resize with DM open, no overflow/runtime errors.');
} finally {await browser.close();}
