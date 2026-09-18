import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const origin='http://localhost:3251';
try{
 const context=await browser.createBrowserContext();
 await context.setCookie({name:'lb-chat-session',value:'s'.repeat(43),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.emulateTimezone('Asia/Tokyo');
 await page.setJavaScriptEnabled(false);await page.goto(origin+'/chat?room=shortscout');
 assert.match(await page.content(),/Welcome to the SS member room/);assert.ok(await page.$('textarea[aria-label="Message SS ↘"]')||await page.$('textarea'));
 await page.setJavaScriptEnabled(true);await page.setViewport({width:390,height:844});await page.reload();
 await page.waitForFunction(()=>localStorage.getItem('longboard-public-chat-theme-v1'));
 assert.match(await page.$eval('body',e=>e.innerText),/Welcome to the SS member room/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/s02-mobile.png'});
 // Removing the synthetic HttpOnly cookie simulates an expired/revoked session.
 await context.deleteCookie(...(await context.cookies()).filter(c=>c.name==='lb-chat-session')); 
 await page.waitForFunction(()=>location.pathname==='/chat/login',{timeout:15000});
 assert.equal(await page.$('article'),null);
 assert.deepEqual(errors,[]);console.log('PASS: cookie-only server HTML, mobile hydration in Tokyo timezone, no overflow, expired-session redirect and private content removal.');
}finally{await browser.close();}
