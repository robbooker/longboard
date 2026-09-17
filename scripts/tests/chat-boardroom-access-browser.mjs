import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 for(const name of ['alice','bob','mallory']){
 const context=await browser.createBrowserContext(),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3204/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email',name+'@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');
 await page.waitForSelector(`textarea[aria-label="Message ${name==='mallory'?'SOCIAL':'LB'}"]`);
 const results=await page.evaluate(async()=>{
 const get=async path=>{const r=await fetch(path);return {status:r.status,data:await r.json()};};
 const paths=['/api/chat/history?room=main','/api/chat/history?room=lb-announcements','/api/chat/history?room=social','/api/chat/history?room=shortscout','/api/chat/search?room=main&q=hello','/api/chat/activity'];
 return Object.fromEntries(await Promise.all(paths.map(async p=>[p,await get(p)])));
 });
 const permitted=name!=='mallory';assert.equal(results['/api/chat/history?room=main'].status,permitted?200:403);
 assert.equal(results['/api/chat/history?room=lb-announcements'].status,permitted?200:403);
 assert.equal(results['/api/chat/history?room=social'].status,200);assert.equal(results['/api/chat/history?room=shortscout'].status,name==='alice'?200:403);
 if(!permitted){
 assert.equal(results['/api/chat/search?room=main&q=hello'].status,403);
 assert.equal(results['/api/chat/activity'].data.roomMessageCounts.main,undefined);
 const denied=await page.evaluate(async()=>{const r=await fetch('/api/chat?room=main',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'message',body:'Must not be sent',clientId:crypto.randomUUID()})});return r.status;});assert.equal(denied,403);
 await page.screenshot({path:'/tmp/cohort-denied-social.png'});
 }
 assert.deepEqual(errors,[]);console.log('PASS '+name+': server history, restricted announcements, Social/SS, '+(!permitted?'search/activity/write denial':'cohort access'));await context.close();
 }
}finally{await browser.close();}
