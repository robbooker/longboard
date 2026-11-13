// #453: an "Unread DMs" button at the top of the chat. It shows only while a DM is unread, counts
// them the way the sidebar's Direct messages heading does, brings the DM list into view on a
// computer (also when folded, and in the compact layout's navigation), opens the DM list on a
// phone, and goes away once everything is read. Runs on the shared chat fixture (Alice, Bob, Mallory).
// UNREAD_DMS_SHOTS=<dir> also saves screenshots there.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base=process.env.CHAT_TEST_URL||'http://localhost:3453';
const shots=process.env.UNREAD_DMS_SHOTS||'';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];
const nav='nav[aria-label="Chat rooms"]',list='aside[aria-label="Private conversations"]',button='[data-unread-dms]';
const shot=async(page,name)=>{if(shots)await page.screenshot({path:`${shots}/${name}.png`});};
async function login(email,viewport={width:1440,height:900}){
 const context=await browser.createBrowserContext(),page=await context.newPage();
 page.on('pageerror',e=>errors.push(`${email}: ${e.message}`));
 await page.setViewport(viewport);
 await page.goto(`${base}/login?next=%2Fchat`);await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email',email);await page.type('#li-password','demo-only');await page.click('button[type="submit"]');
 await page.waitForSelector('textarea[aria-label^="Message "]');
 return page;
}
const api=(page,path,body)=>page.evaluate(async({path,body})=>{const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json()};},{path,body});
async function requestMallory(from,text){
 const mallory=(await api(from,'/api/chat/dm-members?q=Mallory')).data.members[0];
 const sent=await api(from,'/api/chat/inbox',{action:'request',target:mallory.id,body:text,clientId:randomUUID()});
 assert.equal(sent.status,200,JSON.stringify(sent));
}
// The button on screen (a phone keeps one in its hidden list bar too).
const shown=page=>page.evaluate(s=>{const b=[...document.querySelectorAll(s)].find(e=>e.checkVisibility({visibilityProperty:true}));return b?{count:b.dataset.unreadDms,label:b.getAttribute('aria-label'),text:b.innerText.trim()}:null;},button);
const waitShown=(page,label,timeout=45000)=>page.waitForFunction((s,label)=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility({visibilityProperty:true})&&e.getAttribute('aria-label')===label),{timeout,polling:250},button,label);
const waitGone=(page,timeout=45000)=>page.waitForFunction(s=>!document.querySelector(s),{timeout,polling:250},button);
// Clicks the copy on screen (the room left last stays mounted, hidden, with its own header).
const clickShown=async(page,s)=>{const h=await page.waitForFunction(s=>[...document.querySelectorAll(s)].find(e=>e.checkVisibility({visibilityProperty:true})),{timeout:15000},s);await h.asElement().click();};
const sidebarTotal=page=>page.$eval(`${list} h2`,h=>h.querySelector('[class*="badge"]')?.textContent.trim()??'0');
// "In view": the DM list's heading is showing, inside the window.
const listInView=page=>page.evaluate(l=>{const a=document.querySelector(l);if(!a||!a.checkVisibility({visibilityProperty:true}))return false;const h=a.querySelector('h2').getBoundingClientRect();return h.height>0&&h.top>=0&&h.bottom<=innerHeight;},list);
const waitInView=page=>page.waitForFunction(l=>{const a=document.querySelector(l);if(!a||!a.checkVisibility({visibilityProperty:true}))return false;const h=a.querySelector('h2').getBoundingClientRect();return h.height>0&&h.top>=0&&h.bottom<=innerHeight;},{timeout:10000,polling:100},list);
const scrollListAway=page=>page.evaluate(n=>{for(const e=[document.querySelector(n)];e[0];e[0]=e[0].parentElement)if(e[0].scrollHeight>e[0].clientHeight)e[0].scrollTop=0;window.scrollTo(0,0);},nav);
const noOverflow=async(page,what)=>{
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${what}: no sideways scroll`);
 const off=await page.evaluate(()=>[...document.querySelectorAll('header button')].filter(b=>b.checkVisibility({visibilityProperty:true})).map(b=>({b:b.getAttribute('aria-label')||b.textContent.trim(),r:b.getBoundingClientRect()})).filter(({r})=>r.left<-1||r.right>innerWidth+1).map(({b})=>b));
 assert.deepEqual(off,[],`${what}: header buttons inside the window`);
};
try{
 const mallory=await login('mallory@example.test',{width:1280,height:560});
 await mallory.waitForSelector(list);
 // 1. Nothing unread: no button.
 await mallory.waitForNetworkIdle();
 assert.equal(await mallory.$(button),null,'no button with no unread DMs');
 assert.equal(await sidebarTotal(mallory),'0');
 await shot(mallory,'desktop-none');

 // 2. A new DM shows "1 unread DM" without a refresh; a second, from someone else, "2 unread DMs".
 const bob=await login('bob@example.test');
 await requestMallory(bob,'Hi Mallory, a first test message.');
 await waitShown(mallory,'1 unread DM');
 assert.equal((await shown(mallory)).text,'1 unread DM');
 assert.equal(await sidebarTotal(mallory),'1','the button and the sidebar agree');
 const alice=await login('alice@example.test');
 await requestMallory(alice,'Hello Mallory, a second test message.');
 await waitShown(mallory,'2 unread DMs');
 assert.equal(await sidebarTotal(mallory),'2','the button and the sidebar agree');
 assert.ok(await mallory.$eval(`header ${button}`,b=>!!b.closest('[class*="headerActions"]')),'in the header actions');
 await noOverflow(mallory,'computer');
 await shot(mallory,'desktop-two');

 // 3. Computer: the DM list (folded, and scrolled out of view) comes into view.
 await mallory.$eval(`${list} h2 button`,b=>b.click());
 await mallory.waitForFunction(l=>document.querySelector(`${l} h2 button`).getAttribute('aria-expanded')==='false',{},list);
 await scrollListAway(mallory);
 const before=await listInView(mallory);
 await clickShown(mallory,`header ${button}`);
 await waitInView(mallory);
 assert.equal(await mallory.$eval(`${list} h2 button`,b=>b.getAttribute('aria-expanded')),'true','the folded list opens');
 assert.ok(await mallory.evaluate(l=>[...document.querySelectorAll(`${l} button`)].some(b=>b.textContent.includes('Bob'))&&[...document.querySelectorAll(`${l} button`)].some(b=>b.textContent.includes('Alice')),list),'both conversations listed');
 await shot(mallory,'desktop-clicked');
 console.log(`computer: list in view before the click: ${before}; after: true`);

 // 4. Compact layout (no sidebar): the click opens the navigation with the DMs in view.
 await mallory.setViewport({width:900,height:560});
 await mallory.waitForFunction(n=>getComputedStyle(document.querySelector(n)).display==='none',{},nav);
 await waitShown(mallory,'2 unread DMs');
 await noOverflow(mallory,'compact');
 await clickShown(mallory,`header ${button}`);
 await waitInView(mallory);
 await shot(mallory,'compact-clicked');
 await mallory.setViewport({width:1280,height:560});

 // 5. Phone (375 wide, touch): in a room the button is in the header; a tap opens the DM list.
 const phone=await login('mallory@example.test',{width:375,height:740,isMobile:true,hasTouch:true});
 const room='section[aria-label="Longboard Chat"]';
 await phone.waitForFunction(r=>document.querySelector(r)?.checkVisibility({visibilityProperty:true})&&!document.querySelector(r).inert,{timeout:15000},room);// the room last open (sign-in returns to it)
 await waitShown(phone,'2 unread DMs');
 const header=await phone.$eval(`${room} header`,h=>[...h.children].filter(e=>e.checkVisibility()).map(e=>e.getAttribute('aria-label')||e.tagName));
 assert.deepEqual(header.filter(x=>x!=='Phone notifications are off'&&x!=='Phone notifications are blocked'),['Back to all chats','2 unread DMs','DIV','Room info'],header.join(' | '));
 const centered=await phone.$eval(`${room} header h1`,e=>{const r=e.getBoundingClientRect();return Math.abs(r.left+r.width/2-innerWidth/2);});
 assert.ok(centered<4,'title stays centered: '+centered);
 await noOverflow(phone,'phone');
 assert.equal(await phone.$eval(`${room} header ${button}`,b=>b.innerText.trim()),"2","compact: icon and number");
 await shot(phone,'phone-room');
 await phone.tap(`${room} header ${button}`);
 await phone.waitForFunction(r=>document.querySelector(r).inert,{timeout:15000},room);
 await waitInView(phone);
 await shot(phone,'phone-tapped');
 // On the list itself the button sits in the top bar and scrolls down to the DMs.
 await scrollListAway(phone);
 await phone.tap(`${nav} ${button}`);
 await waitInView(phone);

 // 6. Reading: each opened conversation takes its count off; with all read, the button goes.
 const open=async(page,name)=>{await page.evaluate((l,n)=>[...document.querySelectorAll(`${l} button`)].find(b=>b.textContent.includes(n)).click(),list,name);await page.waitForFunction(n=>document.querySelector('section[aria-label="Private conversation"]')?.checkVisibility()&&document.querySelector('section[aria-label="Private conversation"]').textContent.includes(n),{timeout:15000},name);};
 await open(mallory,'Bob');
 await waitShown(mallory,'1 unread DM');
 assert.equal(await sidebarTotal(mallory),'1');
 await waitShown(phone,'1 unread DM');
 await open(mallory,'Alice');
 await waitGone(mallory);
 assert.equal(await sidebarTotal(mallory),'0');
 await shot(mallory,'desktop-read');
 await waitGone(phone);
 await noOverflow(phone,'phone, all read');
 assert.deepEqual(errors,[]);
 console.log('PASS unread DMs button: hidden at 0; live 1 → 2 with the sidebar total; brings the (folded) DM list into view on a computer and in the compact navigation; phone header tap opens the DM list, list bar scrolls to it; goes away once read; no overflow or page errors.');
}finally{await browser.close();}
