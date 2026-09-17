import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];const runId=Date.now();
try {
 const login=async(name)=>{const context=await browser.createBrowserContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:900});await page.goto('http://localhost:3204/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email',`${name}@example.test`);await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label="Message LB"]');return page;};
 const admin=await login('alice'),member=await login('bob');
 const scout=await (await browser.createBrowserContext()).newPage();scout.on('pageerror',e=>errors.push(e.message));await scout.goto('http://localhost:54404/test/scout');await scout.waitForSelector('textarea[aria-label="Message SS"]');
 for(const [room,label] of [['lb-announcements','LB ANNOUNCEMENT'],['ss-announcements','SS ANNOUNCEMENT']]){
  await new Promise(resolve=>setTimeout(resolve,1600));await admin.goto(`http://localhost:3204/chat?room=${room}`);await admin.waitForSelector(`textarea[aria-label="Message ${label}"]`);await admin.type(`textarea[aria-label="Message ${label}"]`,`${label} test bulletin ${runId}`);await admin.click('button[type="submit"][data-state]');await admin.waitForFunction(text=>[...document.querySelectorAll('article p')].some(e=>e.textContent===text&&!e.closest('article').dataset.pending),{},`${label} test bulletin ${runId}`);
 }
 const activity=async(page)=>page.evaluate(async()=>{const r=await fetch('/api/chat/activity');return {status:r.status,...await r.json()};});
 const lb=await activity(member),ss=await activity(scout);assert.equal(lb.status,200);assert.equal(ss.status,200);assert.ok(lb.mentions.some(n=>n.room==='lb-announcements'));assert.ok(!lb.mentions.some(n=>n.room==='ss-announcements'));assert.ok(ss.mentions.some(n=>n.room==='ss-announcements'));assert.ok(!ss.mentions.some(n=>n.room==='lb-announcements'));
 await member.reload();await member.waitForSelector('button[aria-label^="Chat notifications"]');await member.click('button[aria-label^="Chat notifications"]');await member.waitForFunction(()=>document.querySelector('section[aria-label="Chat notifications"]')?.textContent.includes('posted an announcement'));await member.evaluate(()=>[...document.querySelectorAll('section[aria-label="Chat notifications"] button')].find(e=>e.textContent.includes('posted an announcement')).click());await member.waitForFunction(()=>location.search.includes('lb-announcements'));await member.waitForFunction(()=>document.body.textContent.includes('LB ANNOUNCEMENT test bulletin'));
 assert.equal(await member.$('textarea[aria-label="Message LB ANNOUNCEMENT"]'),null);
 for(const width of [320,390,768,1440]){await member.setViewport({width,height:900});assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await member.screenshot({path:'/tmp/announcements-member-desktop.png'});await member.setViewport({width:390,height:900});await member.screenshot({path:'/tmp/announcements-member-mobile.png'});
 const sendStatus=await member.evaluate(async()=>{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',room:'lb-announcements',body:'unauthorized'})});return r.status;});assert.equal(sendStatus,403);
 await scout.goto('http://localhost:3204/chat?room=ss-announcements');await scout.waitForFunction(()=>document.body.textContent.includes('SS ANNOUNCEMENT test bulletin'));assert.equal(await scout.$('textarea[aria-label="Message SS ANNOUNCEMENT"]'),null);
 assert.equal(await scout.evaluate(async()=> (await fetch('/api/chat/history?room=lb-announcements')).status),403);
 assert.deepEqual(errors,[]);console.log('PASS admin posts in LB/SS, matching audience alerts, bell navigation, read-only member UI, non-admin API rejection, SS membership isolation and responsive layouts.');
} finally {await browser.close();}
