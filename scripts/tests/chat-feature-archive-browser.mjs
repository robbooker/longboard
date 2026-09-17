import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1280,height:1000});
 const login=async(p,email)=>{await p.goto('http://localhost:3204/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type="submit"]');await p.waitForSelector('textarea[aria-label="Message LB"]');};
 await login(page,'alice@example.test');
 const post=body=>page.evaluate(async body=>{const r=await fetch('/api/chat/features',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},body);
 const {data:{id}}=await post({action:'create',content:'Archive browser fixture'});
 assert.equal((await post({action:'proposal',id,revision:1,content:'Cancelable proposal'})).status,200);
 assert.equal((await post({action:'approve',id,revision:2})).status,200);
 await page.goto(`http://localhost:3204/chat/features?request=${id}`);await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='Archive ticket'));
 await page.setViewport({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'/tmp/archive-mobile.png',fullPage:true});
 assert.equal((await post({action:'archive',id,revision:1})).status,409);
 assert.equal((await post({action:'archive',id,revision:0})).status,400);
 const context=await browser.createBrowserContext(),participant=await context.newPage();await login(participant,'bob@example.test');
 await participant.goto(`http://localhost:3204/chat/features?request=${id}`);await participant.waitForSelector('nav[aria-label="Feature requests"] button');
 assert.equal(await participant.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='Archive ticket')?.disabled),true);
 assert.equal(await participant.evaluate(async id=>(await fetch('/api/chat/features',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'archive',id,revision:2})})).status,id),403);await context.close();
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='Archive ticket').click());
 await page.waitForFunction(()=>![...document.querySelectorAll('nav[aria-label="Feature requests"] button')].some(b=>b.textContent.includes('Archive browser fixture')));
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('nav[aria-label="Feature requests"] button')].some(b=>b.textContent.includes('Archive browser fixture'))),false);
 await page.waitForFunction(()=>location.pathname==='/chat/features'&&!location.search);await page.reload({waitUntil:'networkidle0'});assert.equal(await page.evaluate(()=>[...document.querySelectorAll('nav[aria-label="Feature requests"] button')].some(b=>b.textContent.includes('Archive browser fixture'))),false);
 const hidden=await page.evaluate(async id=>{const r=await fetch('/api/chat/features?id='+id);return r.json();},id);assert.equal(hidden.view,'archive');assert.equal(hidden.selected.id,id);assert.equal(hidden.selected.status,'archived');assert.ok(hidden.messages.length>0);
 assert.deepEqual(errors,[]);console.log('PASS real browser → API → SQL archive, persisted removal, mobile layout, stale revision, participant UI/API denial and archived deep-link retrieval.');
}finally{await browser.close();}
