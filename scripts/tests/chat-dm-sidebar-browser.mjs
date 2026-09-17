// Run with the isolated chat fixture; see docs/chat-dm-sidebar.md.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base=process.env.CHAT_TEST_URL||'http://localhost:3224';
const fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54424';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const dm='section[aria-label="Private conversation"]',nav='nav[aria-label="Chat rooms"]';
const errors=[];
async function login(email,width=1440){
 const context=await browser.createBrowserContext(),page=await context.newPage();
 await page.setViewport({width,height:900});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/login?next=%2Fchat`);await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email',email);await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label^="Message "]');return page;
}
async function clickText(page,scope,text){
 const buttons=await page.$$(`${scope} button`);
 for(const button of buttons)if((await button.evaluate(e=>e.textContent)).trim()===text){await button.click();return;}
 throw Error(`Missing button ${text}`);
}
async function openNav(page){
 if(await page.$eval(nav,e=>getComputedStyle(e).display==='none'))await page.click('button[aria-label="Open room navigation"]');
 await page.waitForSelector(`${nav} button[data-active]`,{visible:true});
}
async function select(page,name){
 await openNav(page);
 const buttons=await page.$$(`${nav} button[data-active]`);
 for(const button of buttons)if(await button.evaluate((e,n)=>e.textContent.includes(n),name)){await button.click();await page.waitForSelector(dm,{visible:true});return;}
 throw Error(`Missing conversation ${name}`);
}
async function api(page,body){return page.evaluate(async body=>{const r=await fetch('/api/chat/inbox',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json()};},body);}
async function room(page,slug='main') {await openNav(page);await page.click(`${nav} a[href="/chat?room=${slug}"]`);await page.waitForSelector(`textarea[aria-label="Message ${slug==='main'?'LB':'SOCIAL'}"]`,{visible:true});}
try{
 const alice=await login('alice@example.test');
 await alice.waitForSelector(`${nav} button[data-active]`);
 assert.equal(await alice.$$eval('button',els=>els.some(e=>e.textContent.trim()==='Inbox')),false,'no second inbox launcher');
 await alice.type('textarea[aria-label="Message LB"]','Preserve this room draft');
 assert.match(await alice.$eval(nav,e=>e.textContent),/DMs.*Requests.*Bob/s);
 await select(alice,'Bob');
 assert.equal(await alice.$('dialog[open]'),null);
 await alice.waitForFunction(()=>document.querySelector('section[aria-label="Private conversation"]')?.textContent.includes('Accept this request'));
 assert.equal(await alice.$('#dm-body'),null,'incoming requests must be accepted before replying');
 await clickText(alice,dm,'Accept request');await alice.waitForSelector('#dm-body',{visible:true});
 await alice.type('#dm-body','Accepted from the sidebar');await clickText(alice,dm,'Send message');
 await alice.waitForFunction(()=>document.querySelector('#dm-body')?.value==='');
 await room(alice);
 assert.equal(await alice.$eval('textarea[aria-label="Message LB"]',e=>e.value),'Preserve this room draft');
 const bob=await login('bob@example.test',390);
 const conversations=(await api(bob)).data.conversations,conversation=conversations.find(c=>c.otherName==='Alice');
 assert.equal(conversation.status,'accepted');
 const sent=await api(bob,{action:'send',target:conversation.id,body:'Incoming sidebar unread message',clientId:crypto.randomUUID()});assert.equal(sent.status,200,JSON.stringify(sent));
 await alice.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));
 await alice.waitForFunction(()=>[...document.querySelectorAll('nav button[data-active]')].some(e=>e.textContent.includes('Bob')&&e.querySelector('[class*="badge"]')));
 await select(alice,'Bob');await alice.waitForFunction(()=>document.querySelector('section[aria-label="Private conversation"]')?.textContent.includes('Incoming sidebar unread message'));
 await alice.waitForFunction(()=>![...document.querySelectorAll('nav button[data-active]')].find(e=>e.textContent.includes('Bob'))?.querySelector('[class*="badge"]'));
 await alice.screenshot({path:'/tmp/chat-dm-sidebar-desktop.png'});
 // Mobile selects from the same navigation, closes it, and retains a main-area composer.
 for(const width of [768,390,320]){
  await alice.setViewport({width,height:900});await select(alice,'Bob');
  await alice.waitForFunction(()=>getComputedStyle(document.querySelector('nav[aria-label="Chat rooms"]')).display==='none');
  await alice.waitForSelector('#dm-body',{visible:true});
  assert.equal(await alice.$('dialog[open]'),null);
  assert.equal(await alice.$eval(dm,e=>e.closest('section[aria-label="Longboard Chat"]').inert),false);
  assert.equal(await alice.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await alice.$eval(dm,e=>e.scrollWidth>e.clientWidth),false);
  await room(alice,'social');await select(alice,'Bob');await room(alice);
 }
 await select(alice,'Bob');await alice.type('#dm-body','Mobile composer draft');
 await alice.setViewport({width:1440,height:900});await alice.setViewport({width:390,height:900});
 assert.equal(await alice.$eval('#dm-body',e=>e.value),'Mobile composer draft');
 await alice.screenshot({path:'/tmp/chat-dm-sidebar-mobile.png'});
 // A covered conversation must not consume incoming unread messages.
 await openNav(alice);
 const covered=await api(bob,{action:'send',target:conversation.id,body:'Unread while the drawer covers the DM',clientId:crypto.randomUUID()});assert.equal(covered.status,200,JSON.stringify(covered));
 await alice.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));
 await alice.waitForFunction(()=>[...document.querySelectorAll('nav button[data-active]')].some(e=>e.textContent.includes('Bob')&&e.querySelector('[class*="badge"]')));
 await alice.waitForNetworkIdle();
 assert.ok((await api(alice)).data.conversations.find(c=>c.otherName==='Bob').unread>0,'drawer preserves unread');
 await clickText(alice,nav,'Back to chat →');
 await alice.waitForFunction(()=>![...document.querySelectorAll('nav button[data-active]')].find(e=>e.textContent.includes('Bob'))?.querySelector('[class*="badge"]'));

 // Recipient-name start still resolves an existing DM rather than a duplicate request.
 await room(alice);await alice.click('button[title="Message Bob privately"]');await alice.waitForSelector('#dm-body',{visible:true});
 assert.equal(await alice.$eval(dm,e=>e.textContent.includes('Start with a request')),false);
 // Notification can open a DM directly even when a mobile reply panel is open.
 await room(alice);await alice.click('#chat-message-20000000-0000-4000-8000-000000000001 button[aria-expanded]');await alice.waitForSelector('aside[aria-label="Comment replies"]');
 await alice.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),conversation.id);
 await alice.waitForSelector('#dm-body',{visible:true});
 assert.equal(await alice.$eval('section[aria-label="Longboard Chat"]',e=>e.inert),false);
 await alice.type('#dm-body','Usable notification composer');
 // Summaries continue to use the same sidebar and main pane.
 const summary=await fetch(`${fixture}/rest/v1/chat_summary_deliveries`,{method:'POST',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json'},body:JSON.stringify({account_id:'00000000-0000-4000-8000-000000000001',client_id:crypto.randomUUID(),room_slug:'main',body:'Private sidebar summary'})});assert.ok(summary.ok,await summary.text());
 await alice.evaluate(()=>window.dispatchEvent(new Event('chat-summary-delivered')));
 await alice.waitForFunction(()=>document.querySelector('section[aria-label="Private conversation"]')?.textContent.includes('Private sidebar summary'));
 assert.equal(await alice.$('#dm-body'),null,'summaries are read only');
 await alice.screenshot({path:'/tmp/chat-dm-sidebar-summary.png'});
 await openNav(alice);assert.match(await alice.$eval(nav,e=>e.textContent),/Room summaries/);
 // Another member cannot load this conversation through an ID or notification.
 const mallory=await login('mallory@example.test');
 const denied=await mallory.evaluate(async id=>(await fetch(`/api/chat/inbox?conversation=${id}`)).status,conversation.id);assert.equal(denied,404);
 await mallory.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),conversation.id);
 await mallory.waitForNetworkIdle();assert.equal(await mallory.$(dm),null);
 // Starting a new recipient preserves the outgoing pending state and mobile acceptance.
 await mallory.click('button[title="Message Bob privately"]');await mallory.waitForSelector('#dm-body',{visible:true});
 await mallory.type('#dm-body','A new sidebar request');await clickText(mallory,dm,'Send request');
 await mallory.waitForFunction(()=>document.querySelector('section[aria-label="Private conversation"]')?.textContent.includes('Request sent. You can send more'));
 assert.equal(await mallory.$('#dm-body'),null);
 await bob.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));
 await bob.waitForFunction(()=>[...document.querySelectorAll('nav button[data-active]')].some(e=>e.textContent.includes('Mallory')));
 await select(bob,'Mallory');await clickText(bob,dm,'Accept request');await bob.waitForSelector('#dm-body',{visible:true});
 assert.equal(await bob.$('dialog[open]'),null);
 assert.deepEqual(errors,[]);
 console.log('PASS sidebar-only desktop/mobile DMs; incoming acceptance; send/receive/unread; room drafts and channel switches; resize draft; recipient start; notification over mobile replies; private summaries; participant isolation; no page errors or horizontal overflow.');
}finally{await browser.close();}
