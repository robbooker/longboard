// UI-PHONE-NAV: on a phone the room and DM list is the home screen; a conversation opens over it
// with back, a centered title and one info sheet. Run against chat-mobile-fixture.mjs (see
// docs/chat-mobile-replies.md): `node scripts/tests/chat-mobile-fixture.mjs`, then a dev server on 3204.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base=process.env.CHAT_TEST_URL||'http://localhost:3204';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 const nav='nav[aria-label="Chat rooms"]',room='section[aria-label="Longboard Chat"]',composer='textarea[aria-label="Message LB"]';
 const back='button[aria-label="Back to all chats"]',info='button[aria-label="Room info"]';
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 // "Showing" means visible and not covered: the list and the conversation swap visibility.
 const shows=selector=>page.waitForFunction(s=>{const e=document.querySelector(s);if(!e)return false;const r=e.getBoundingClientRect();return getComputedStyle(e).visibility==='visible'&&r.width>0&&r.left>=0&&r.left<innerWidth/2;},{timeout:15000},selector);
 const listShows=async()=>{await shows(nav);await page.waitForFunction(r=>document.querySelector(r).inert,{},room);};
 const conversationShows=async()=>{await shows(room);await page.waitForFunction(n=>document.querySelector(n).inert&&getComputedStyle(document.querySelector(n)).visibility==='hidden',{},nav);};
 const tap=async selector=>{await page.waitForSelector(selector,{visible:true});await page.tap(selector);};
 const reactReady=s=>page.waitForFunction(s=>{const e=document.querySelector(s);return e&&Object.keys(e).some(k=>k.startsWith('__reactProps'));},{},s);

 await page.goto(`${base}/login?next=%2Fchat`);await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');
 await page.waitForSelector(composer);await reactReady(composer);
 // A pinned message for the info sheet (Alice is a chat admin in this fixture).
 const pinned=await page.evaluate(async()=>{const r=await fetch('/api/chat/message-pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'main',messageId:'20000000-0000-4000-8000-000000000001',action:'pin'})});return r.status;});
 assert.equal(pinned,200,'pin the fixture message');
 await page.goto(`${base}/chat`);await reactReady(composer);

 // 1. Plain /chat on a phone opens the list: big title, bell and ••• at the top, Search, groups.
 await listShows();
 assert.equal(await page.$eval(`${nav} h1`,e=>e.textContent),'Chat');
 assert.ok(await page.$(`${nav} button[aria-label^="Chat notifications"]`),'bell on the list');
 assert.ok(await page.$(`${nav} button[aria-label="Chat settings"]`),'••• menu on the list');
 assert.ok(await page.evaluate(n=>[...document.querySelectorAll(`${n} button`)].some(b=>b.textContent.trim()==='Search chat'),nav),'Search row');
 const headings=await page.$$eval(`${nav} [class*="navHeading"]`,h=>h.map(e=>e.textContent));assert.ok(headings.includes('Rooms'),headings.join());
 assert.ok(await page.$(`${nav} aside[aria-label="Private conversations"]`),'DMs are on the list');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/phone-nav-list.png'});

 // 2. Open LB: back chevron, centered title with the online count, one info button; no Latest or Search.
 await tap(`${nav} a[href="/chat?room=main"]`);await conversationShows();
 const header=await page.$eval(`${room} header`,h=>({title:h.textContent,buttons:[...h.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')||b.textContent.trim())}));
 assert.match(header.title,/^Longboard/);assert.match(header.title,/online|Connecting/);
 assert.deepEqual(header.buttons.filter(b=>/Latest|Search chat|Chat settings|Chat notifications|Open room navigation/.test(b)),[],header.buttons.join(' | '));
 assert.ok(header.buttons.includes('Back to all chats')&&header.buttons.includes('Room info'),header.buttons.join(' | '));
 const centered=await page.$eval(`${room} header h1`,e=>{const r=e.getBoundingClientRect();return Math.abs(r.left+r.width/2-innerWidth/2);});assert.ok(centered<4,'title is centered: '+centered);
 const historyAtRoom=await page.evaluate(()=>history.length);

 // 3. Type a draft and scroll up, go back: the list shows the draft; reopening keeps draft and scroll.
 await page.focus(composer);await page.type(composer,'Phone draft for LB');
 const list=`${room} [role="log"]`;
 await page.$eval(list,e=>{e.scrollTop=Math.max(0,e.scrollHeight-e.clientHeight-900);e.dispatchEvent(new Event('scroll'));});await pause(300);
 const scrolled=await page.$eval(list,e=>e.scrollTop);assert.ok(scrolled>0);
 await tap(back);await listShows();
 await page.waitForFunction(n=>document.querySelector(`${n} a[href="/chat?room=main"]`)?.textContent.includes('Draft: Phone draft for LB'),{},nav);
 await page.screenshot({path:'/tmp/phone-nav-list-draft.png'});
 await tap(`${nav} a[href="/chat?room=main"]`);await conversationShows();
 assert.equal(await page.$eval(composer,e=>e.value),'Phone draft for LB');
 assert.ok(Math.abs(await page.$eval(list,e=>e.scrollTop)-scrolled)<=2,'scroll kept');
 assert.equal(await page.evaluate(()=>history.length),historyAtRoom,'reopening replaces, never stacks, the conversation entry');

 // 4. Another room and back again: LB's draft survives the room switch.
 await tap(back);await listShows();
 await tap(`${nav} a[href="/chat?room=social"]`);await page.waitForSelector('textarea[aria-label="Message Social"]');await conversationShows();
 assert.equal(new URL(page.url()).searchParams.get('room'),'social','room URLs are unchanged');
 await tap(back);await listShows();
 assert.ok(await page.$eval(`${nav} a[href="/chat?room=main"]`,e=>e.textContent.includes('Draft: Phone draft for LB')));
 await tap(`${nav} a[href="/chat?room=main"]`);await page.waitForSelector(composer);await conversationShows();await reactReady(composer);
 assert.equal(await page.$eval(composer,e=>e.value),'Phone draft for LB');

 // 5. The info sheet: favorite, pin, search, pinned messages and members; Escape closes it.
 await tap(info);const sheet='[role="dialog"][aria-label="Room info"]';await page.waitForSelector(sheet,{visible:true});
 await page.waitForFunction(s=>document.querySelector(s).textContent.includes('Reaction tooltip verification message'),{timeout:15000},sheet);
 const contents=await page.$eval(sheet,e=>e.textContent);
 for(const text of ['Pinned','Reaction tooltip verification message','Members','Member List','Search in LB'])assert.ok(contents.includes(text),`${text} in: ${contents}`);
 await page.waitForFunction(s=>/Favorite LB|Remove LB favorite/.test(document.querySelector(s).textContent),{},sheet);
 assert.equal(await page.$eval(room,e=>e.inert),true,'the conversation is inert behind the sheet');
 await page.screenshot({path:'/tmp/phone-nav-sheet.png'});
 await page.keyboard.press('Escape');await page.waitForSelector(sheet,{hidden:true});
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Room info');
 // The title opens it too, and the scrim closes it.
 await tap(`${room} header h1`);await page.waitForSelector(sheet,{visible:true});
 await page.touchscreen.tap(195,60);await page.waitForSelector(sheet,{hidden:true});
 // Search in room opens search as its own screen; back returns to the list.
 await tap(info);await page.waitForSelector(sheet,{visible:true});
 await page.evaluate(s=>[...document.querySelectorAll(`${s} button`)].find(b=>b.textContent.includes('Search in LB')).click(),sheet);
 await page.waitForFunction(()=>document.querySelector('section[aria-label="Longboard Chat"] header h1')?.textContent.startsWith('Search'));
 await tap(back);await listShows();
 await tap(`${nav} a[href="/chat?room=main"]`);await conversationShows();
 await page.waitForFunction(()=>document.querySelector('section[aria-label="Longboard Chat"] header h1')?.textContent.startsWith('Longboard'));

 // 6. Browser (or Android) back from a conversation returns to the list; forward reopens it.
 await page.goBack();await listShows();
 await page.goForward();await conversationShows();
 assert.equal(await page.$eval(composer,e=>e.value),'Phone draft for LB');

 // 7. Swipe in from the left edge goes back.
 const cdp=await page.createCDPSession();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:6,y:420}]});
 for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:6+30*i,y:422}]});await pause(16);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 await listShows();

 // 8. A DM from the list: same header and back.
 await page.waitForFunction(n=>[...document.querySelectorAll(`${n} aside[aria-label="Private conversations"] button`)].some(b=>b.textContent.includes('Bob')),{},nav);
 await page.evaluate(n=>[...document.querySelectorAll(`${n} aside[aria-label="Private conversations"] button`)].find(b=>b.textContent.includes('Bob')).click(),nav);
 await page.waitForSelector('section[aria-label="Private conversation"]',{visible:true});await conversationShows();
 assert.match(await page.$eval(`${room} header h1`,e=>e.textContent),/^Bob/);
 await tap('button[aria-label="Conversation info"]');await page.waitForSelector('[role="dialog"][aria-label="Conversation info"] [data-dm-settings]',{visible:true});
 await page.screenshot({path:'/tmp/phone-nav-dm-sheet.png'});
 await page.keyboard.press('Escape');await page.waitForSelector('[role="dialog"][aria-label="Conversation info"]',{hidden:true});
 assert.equal(await page.$(`${nav} [data-dm-settings]`),null,'DM settings live in the sheet on a phone');
 await tap(back);await listShows();

 // 9. A deep link (or notification) to a DM opens it, with back to the list underneath.
 const conversation=await page.evaluate(async()=>(await (await fetch('/api/chat/inbox')).json()).conversations.find(c=>c.otherName==='Bob').id);
 await page.goto(`${base}/chat?room=main&dm=${conversation}`);
 await page.waitForSelector('section[aria-label="Private conversation"]',{visible:true});await conversationShows();
 assert.match(await page.$eval(`${room} header h1`,e=>e.textContent),/^Bob/);
 assert.equal(new URL(page.url()).searchParams.get('dm'),conversation,'the DM link is unchanged');
 await page.screenshot({path:'/tmp/phone-nav-dm.png'});
 await tap(back);await listShows();
 // A deep link to a room opens that room; browser back also reaches the list.
 await page.goto(`${base}/chat?room=social`);await page.waitForSelector('textarea[aria-label="Message Social"]');await conversationShows();
 await page.goBack();await listShows();
 // Reduced motion: no slide.
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 assert.equal(await page.$eval(nav,e=>getComputedStyle(e).transitionDuration.split(',').every(d=>d.trim()==='0s')),true);
 assert.deepEqual(errors,[]);
 console.log('PASS phone list first, open/back, draft on the list and kept, scroll kept, info sheet (pins, members, Esc, scrim, search), browser back/forward, edge swipe, DM sheet, DM and room deep links with back to the list, reduced motion, no page errors');
}finally{await browser.close();}
