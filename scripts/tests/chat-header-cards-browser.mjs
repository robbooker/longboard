import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:1000});
 await page.goto('http://localhost:3204/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 const dmButton='nav[aria-label="Chat rooms"] button[data-active]';
 await page.waitForSelector(dmButton);await page.type('textarea[aria-label="Message LB"]','Retain this room draft');
 assert.match(await page.$eval(dmButton,e=>e.textContent),/Bob/);
 assert.match(await page.$eval(dmButton,e=>e.textContent),/1/);
 await page.click(dmButton);await page.waitForSelector('section[aria-label="Private inbox"]',{visible:true});await page.waitForFunction(()=>document.querySelector('section[aria-label="Private inbox"]')?.textContent.includes('Hi Alice!'));
 assert.equal(await page.$('dialog[open]'),null);
 assert.equal(await page.$eval('textarea[aria-label="Message LB"]',e=>e.getBoundingClientRect().width),0);
 const clickText=async(text,root='section[aria-label="Private inbox"]')=>{const handles=await page.$$(`${root} button`);for(const h of handles){if((await h.evaluate(e=>e.textContent))===text){await h.click();return;}}throw Error(`Missing button ${text}`);};
 await clickText('Accept request');await page.waitForSelector('#dm-body',{visible:true});
 await page.type('#dm-body','Desktop center DM test');await clickText('Send message');await page.waitForFunction(()=>document.querySelector('section[aria-label="Private inbox"]')?.textContent.includes('Desktop center DM test'));
 for(const width of [1100,1280,1440,1920]){
  await page.setViewport({width,height:1000});
  const g=await page.evaluate(()=>{const nav=document.querySelector('nav[aria-label="Chat rooms"]').getBoundingClientRect(),dm=document.querySelector('section[aria-label="Private inbox"]').getBoundingClientRect(),header=document.querySelector('h1').getBoundingClientRect();return {navRight:nav.right,dmLeft:dm.left,dmWidth:dm.width,headerBottom:header.bottom,dmTop:dm.top,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert.ok(g.dmLeft>=g.navRight);assert.ok(g.dmWidth>500);assert.ok(g.dmTop>g.headerBottom);assert.equal(g.overflow,false);
 }
 await page.setViewport({width:1440,height:1000});await page.screenshot({path:'/tmp/chat-header-dm-desktop.png'});
 await page.click('nav a[href="/chat?room=main"]');await page.waitForSelector('textarea[aria-label="Message LB"]',{visible:true});assert.equal(await page.$eval('textarea[aria-label="Message LB"]',e=>e.value),'Retain this room draft');
 await page.click('button[aria-label="Search chat"]');await page.waitForFunction(()=>document.querySelector('button[aria-label="Search chat"]')?.getAttribute('aria-pressed')==='true');
 await page.click('nav a[href="/chat?room=main"]');await page.waitForSelector('textarea[aria-label="Message LB"]',{visible:true});
 await page.click('nav a[href="/chat?room=social"]');await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');assert.equal(await page.$eval('h1',e=>e.textContent),'Social');await page.click('nav a[href="/chat?room=main"]');await page.waitForSelector('textarea[aria-label="Message LB"]');assert.equal(await page.$eval('textarea[aria-label="Message LB"]',e=>e.value),'Retain this room draft');
 await page.screenshot({path:'/tmp/chat-header-rooms-desktop.png'});
 await page.click(dmButton);await page.waitForSelector('#dm-body',{visible:true});await page.type('#dm-body','Resize draft');
 await page.setViewport({width:390,height:844});await page.waitForSelector('dialog[open] #dm-body',{visible:true});assert.equal(await page.$eval('#dm-body',e=>e.value),'Resize draft');
 await page.setViewport({width:1280,height:900});await page.waitForSelector('section[aria-label="Private inbox"] #dm-body',{visible:true});assert.equal(await page.$eval('#dm-body',e=>e.value),'Resize draft');
 await page.keyboard.press('Escape');await page.waitForSelector('textarea[aria-label="Message LB"]',{visible:true});
 for(const width of [320,390,768]){
  await page.setViewport({width,height:900});await page.waitForSelector('button[aria-label="Open room navigation"]',{visible:true});await page.click('button[aria-label="Open room navigation"]');await page.waitForSelector(dmButton,{visible:true});await page.click(dmButton);await page.waitForSelector('dialog[open] #dm-body',{visible:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.click('button[aria-label="Close inbox"]');await page.waitForSelector('textarea[aria-label="Message LB"]',{visible:true});
 }
 assert.deepEqual(errors,[]);console.log('PASS sidebar unread cards, center DM request acceptance/send, room draft and room/search switching, desktop geometry, mobile navigation and inbox, resize draft retention, no page errors');
} finally {await browser.close();}
