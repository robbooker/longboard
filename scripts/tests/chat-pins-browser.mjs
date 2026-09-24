import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base=process.env.CHAT_TEST_URL||'http://localhost:3343';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];
async function login(email,width){const context=await browser.createBrowserContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width,height:850});await page.goto(base+'/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email',email);await page.type('#li-password','demo-only');await page.click('button[type=submit]');await page.waitForSelector('button[aria-label="Chat settings"]').catch(async e=>{console.error('LOGIN STATE',await page.url(),await page.$eval('body',e=>e.innerText));throw e;});return page;}
async function clickText(page,text){for(const el of await page.$$('button'))if((await el.evaluate(e=>e.textContent)).includes(text)){await el.click();return;}throw Error('Missing '+text);}
async function menu(page){if(await page.$('#chat-settings-panel'))return;await page.click('button[aria-label="Chat settings"]');await page.waitForSelector('[data-chat-pins]');}
const favorite=page=>page.evaluate(async()=>{const r=await fetch('/api/chat/favorite');return(await r.json()).favorite;});
const pins=page=>page.evaluate(async()=>{const r=await fetch('/api/chat/pins');return(await r.json()).pins;});
const pinButton=page=>page.waitForSelector('[data-chat-pins="option"] button:not([disabled])');
try{
 const alice=await login('alice@example.test',1440),bob=await login('bob@example.test',320);
 await alice.evaluate(async()=>{const {conversations}=await(await fetch('/api/chat/inbox')).json();const bob=conversations.find(c=>c.otherName==='Bob');if(bob)await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'unblock',target:bob.id})});});
 for(const page of [alice,bob])await page.evaluate(async()=>{const {pins}=await(await fetch('/api/chat/pins')).json();for(const pin of pins)await fetch('/api/chat/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'unpin',target:pin})});window.dispatchEvent(new Event('chat-pins-changed'));});
 assert.deepEqual(await pins(alice),[]);assert.deepEqual(await pins(bob),[]);
 await menu(alice);await pinButton(alice);await clickText(alice,'Pin LB');await alice.waitForSelector('[data-chat-pins="sidebar"] button[aria-label="Open pinned LB"]');await alice.keyboard.press('Escape');
 await alice.click('nav[aria-label="Chat rooms"] a[href="/chat?room=social"]');await alice.waitForFunction(()=>document.querySelector('h1')?.textContent==='Social');await menu(alice);await pinButton(alice);await clickText(alice,'Pin SOCIAL');await alice.waitForSelector('[data-chat-pins="sidebar"] button[aria-label="Open pinned SOCIAL"]');
 await alice.reload({waitUntil:'networkidle2'});await alice.waitForSelector('[data-chat-pins="sidebar"] button[aria-label="Open pinned LB"]');assert.deepEqual((await pins(alice)).map(p=>p.room),['main','social']);assert.deepEqual(await pins(bob),[]);
 const dm=await alice.evaluate(async()=>{const body=await(await fetch('/api/chat/inbox')).json();return body.conversations.find(c=>c.otherName==='Bob')?.id;});assert.ok(dm);await alice.evaluate(async id=>fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'accept',target:id})}),dm);
 await alice.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),dm);await alice.waitForFunction(()=>document.querySelector('h1')?.textContent==='Bob');await menu(alice);await clickText(alice,'DM settings');await alice.waitForSelector('details[data-dm-settings][open]');await pinButton(alice);await clickText(alice,'Pin Bob');await alice.waitForSelector('[data-chat-pins="sidebar"] button[aria-label="Open pinned Bob"]');
 assert.deepEqual((await pins(alice)).map(p=>p.room||p.conversationId),['main','social',dm]);
 await alice.keyboard.press('Escape');await alice.click('[aria-label="Open pinned LB"]');await alice.waitForFunction(()=>document.querySelector('h1')?.textContent==='Longboard');await alice.waitForSelector('[aria-label="Open pinned Bob"]');await alice.click('[aria-label="Open pinned Bob"]');await alice.waitForFunction(()=>document.querySelector('h1')?.textContent==='Bob');
 await alice.reload({waitUntil:'networkidle2'});await alice.waitForSelector('[aria-label="Open pinned Bob"]');await alice.screenshot({path:'/tmp/chat-pins-desktop.png'});
 // New room activity cannot reorder existing pins.
 await fetch('http://127.0.0.1:54543/test/message?body=Fresh+activity');assert.deepEqual((await pins(alice)).map(p=>p.room||p.conversationId),['main','social',dm]);
 await menu(bob);await pinButton(bob);await clickText(bob,'Pin LB');await bob.waitForSelector('[data-chat-pins="option"] button[aria-pressed=true]');assert.equal(await bob.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await bob.keyboard.press('Escape');
 // The nav drawer exposes the same Pinned section on mobile.
 const mobileButton=await bob.$('button[aria-label="Open room navigation"]');if(mobileButton)await mobileButton.click();await bob.screenshot({path:'/tmp/chat-pins-mobile.png'});
 await alice.click('[aria-label="Unpin SOCIAL"]');await alice.waitForSelector('[aria-label="Open pinned SOCIAL"]',{hidden:true});await alice.reload({waitUntil:'networkidle2'});await alice.waitForSelector('[aria-label="Open pinned LB"]');assert.deepEqual((await pins(alice)).map(p=>p.room||p.conversationId),['main',dm]);
 // Revalidation prevents a stale pinned DM from opening after blocking.
 await alice.evaluate(async id=>fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'block',target:id})}),dm);await alice.click('[aria-label="Open pinned Bob"]');await alice.waitForSelector('[aria-label="Open pinned Bob"]',{hidden:true});assert.deepEqual((await pins(alice)).map(p=>p.room),['main']);
 // Current room catalog includes Gainers, independently of the original favorite constraint.
 const gainers=await alice.evaluate(async()=>{const r=await fetch('/api/chat/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pin',target:{kind:'room',room:'gainers'}})});return {status:r.status,body:await r.json()};});assert.equal(gainers.status,200);assert.ok(gainers.body.pins.some(p=>p.room==='gainers'));
 let failNextRead=true;await bob.setRequestInterception(true);bob.on('request',request=>{if(failNextRead&&request.url().endsWith('/api/chat/pins')&&request.method()==='GET'){failNextRead=false;void request.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic failure'})});}else void request.continue();});
 await bob.evaluate(()=>window.dispatchEvent(new Event('focus')));await bob.waitForSelector('[data-chat-pins="sidebar"] [role="status"]');await clickText(bob,'Retry loading pins');await bob.waitForSelector('[data-chat-pins="sidebar"] [aria-label="Open pinned LB"]');
 assert.deepEqual(errors,[]);console.log('PASS pins browser: room/DM options, multiple pins, reload persistence, stable activity order, account isolation, sidebar navigation, unpin persistence, blocked target revalidation and 320px layout.');
}finally{await browser.close();}
