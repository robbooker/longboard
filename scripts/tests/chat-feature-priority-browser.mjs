import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
 async function login(p,email){await p.goto('http://localhost:3204/login?next=%2Fchat%2Ffeatures');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type="submit"]');await p.waitForSelector('#feature-title');}
 await login(page,'alice@example.test');await page.waitForSelector('select[aria-label="New ticket priority"]');
 await page.type('#feature-title','Emergency browser check');await page.select('select[aria-label="New ticket priority"]','0');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Start discussion').click());
 await page.waitForFunction(()=>document.querySelector('h2')?.textContent==='Emergency browser check');
 await page.waitForFunction(()=>document.querySelector('select[aria-label="Ticket priority"]')?.value==='0');
 assert.ok((await page.$eval('nav[aria-label="Feature requests"] button',e=>e.textContent)).includes('Emergency browser check'));
 const id=new URL(page.url()).searchParams.get('request');
 await page.select('select[aria-label="Ticket priority"]','3');
 await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].some(e=>e.textContent.includes('Priority saved')));
 const saved=await page.evaluate(async id=>(await(await fetch('/api/chat/features?id='+id)).json()).requests.find(r=>r.id===id),id);
 assert.equal(saved.priority,3);assert.equal(saved.status,'discussion');assert.equal(saved.revision,1);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('select[aria-label="Ticket priority"]')?.value==='3');
 await page.setViewport({width:390,height:844});await page.select('select[aria-label="Ticket priority"]','1');
 await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].some(e=>e.textContent.includes('Priority saved')));
 await page.screenshot({path:'/tmp/priority-mobile.png',fullPage:true});
 const stale=await page.evaluate(async id=>{const r=await fetch('/api/chat/features',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'priority',id,priority:0,priorityRevision:1})});return r.status;},id);assert.equal(stale,409);
 const context=await browser.createBrowserContext();const friend=await context.newPage();await login(friend,'bob@example.test');
 assert.equal(await friend.$('select[aria-label="New ticket priority"]'),null);
 const denied=await friend.evaluate(async id=>{const r=await fetch('/api/chat/features',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'priority',id,priority:0,priorityRevision:3})});return r.status;},id);assert.equal(denied,403);
 assert.deepEqual(errors,[]);console.log('PASS owner creates Emergency, edits existing ticket, priority persists, mobile select, stale 409, participant hidden/403, no page errors');
}finally{await browser.close();}
