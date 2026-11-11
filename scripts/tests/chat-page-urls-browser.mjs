// #441: the address bar shows the page on screen. Opening News Feed, Gainers Table, FAQ or Reader puts
// its own link (/chat?page=<name>) in the address bar; a refresh keeps the page; the link opens it in
// a new tab; a room afterwards shows /chat?room=<room>; Back from a page returns to the room it was
// opened from and Forward opens the page again; the app's refresh guard doesn't write room= over a
// page. On a phone, a page opens over the list and Back returns to the list.
// Synthetic shared fixture only: ports 3445/54645, no production credentials or messages.
//
// Usage: node scripts/tests/chat-page-urls-browser.mjs [--shots <dir>]
//   --shots writes after-desktop.png (News Feed, with its address drawn above the page) into <dir>.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {signIn} from './browser-login.mjs';
const base='http://localhost:3445',nav='nav[aria-label="Chat rooms"]';
const args=process.argv.slice(2),shots=args.includes('--shots')?args[args.indexOf('--shots')+1]:null;
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const errors=[];
const address=p=>p.evaluate(()=>location.pathname+location.search);
const waitAddress=(p,want)=>p.waitForFunction(w=>location.pathname+location.search===w,{timeout:30000},want).catch(async()=>{throw Error(`address is ${await address(p)}, wanted ${want}`);});
// A page row of the sidebar, shown as the page on screen.
const PAGES=[
 {name:'news-feed',row:'a[data-chat-news-feed]'},
 {name:'gainers-table',row:'a[data-chat-gainers-table]'},
 {name:'faq',row:'a[data-chat-faq]'},
 {name:'reader',row:'a[data-chat-app="reader"]'},
];
const current=(p,row)=>p.waitForSelector(`${nav} ${row}[aria-current="page"]`,{timeout:60000});
const noneCurrent=p=>p.waitForFunction(n=>!document.querySelector(`${n} a[aria-current="page"][href^="/chat?page="]`),{timeout:30000},nav);
// The Gainers room is read-only (no composer): its header line says it is on screen.
const gainersShows=p=>p.waitForFunction(()=>[...document.querySelectorAll('header')].some(h=>h.checkVisibility()&&h.textContent.includes('Live Gainers alerts')),{timeout:60000});
try{
 const p=await browser.newPage();await p.setViewport({width:1440,height:900});
 p.on('pageerror',e=>errors.push(e.message));
 await signIn(p,base,'alice@example.test',{composer:'textarea[aria-label="Message LB"]'});
 await p.goto(base+'/chat?room=gainers');await gainersShows(p);
 await p.waitForSelector(`${nav} a[data-chat-news-feed]`,{visible:true,timeout:60000});
 const hasReader=!!(await p.$(`${nav} a[data-chat-app="reader"]`));
 for(const page of PAGES){
  if(page.name==='reader'&&!hasReader){console.log('(no Reader row for this member: its link is checked directly)');continue;}
  // 1. Opening the page puts its own link in the address bar.
  await p.click(`${nav} ${page.row}`);await current(p,page.row);
  await waitAddress(p,`/chat?page=${page.name}`);
  // 2. The refresh guard (run before the app reloads itself) leaves ?page= alone.
  await p.evaluate(()=>window.dispatchEvent(new Event('chat-before-refresh',{cancelable:true})));
  assert.equal(await address(p),`/chat?page=${page.name}`,'the refresh guard keeps the page address');
  // 3. Back returns to the room the page was opened from; Forward opens the page again.
  await p.goBack();await waitAddress(p,'/chat?room=gainers');await noneCurrent(p);
  await gainersShows(p);
  await p.goForward();await waitAddress(p,`/chat?page=${page.name}`);await current(p,page.row);
  // 4. A room afterwards shows that room's address and closes the page.
  await p.click(`${nav} a[href="/chat?room=gainers"]`);await waitAddress(p,'/chat?room=gainers');await noneCurrent(p);
 }
 // 5. A refresh keeps News Feed, and its link opens News Feed in a new tab.
 await p.click(`${nav} a[data-chat-news-feed]`);await current(p,'a[data-chat-news-feed]');await waitAddress(p,'/chat?page=news-feed');
 if(shots){
  const url=await p.evaluate(()=>location.href);const png=await p.screenshot({encoding:'base64'});
  const frame=await browser.newPage();await frame.setViewport({width:1440,height:948});
  await frame.setContent(`<body style="margin:0;font:15px system-ui;background:#dee1e6"><div style="height:48px;display:flex;align-items:center;padding:0 16px"><div style="flex:1;background:#fff;border-radius:16px;padding:7px 16px;color:#202124">${url.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div></div><img style="display:block" src="data:image/png;base64,${png}"></body>`);
  await frame.screenshot({path:join(shots,'after-desktop.png')});await frame.close();
 }
 await p.reload();await current(p,'a[data-chat-news-feed]');assert.equal(await address(p),'/chat?page=news-feed','a refresh keeps the page');
 for(const page of PAGES){
  const tab=await browser.newPage();await tab.setViewport({width:1440,height:900});tab.on('pageerror',e=>errors.push(e.message));
  await tab.goto(`${base}/chat?page=${page.name}`);
  if(page.name==='reader'&&!hasReader){
   // Without the Reader row the link still opens the Reader page (its library explains the membership).
   await tab.waitForFunction(()=>document.title.includes('Reader')||[...document.querySelectorAll('h1,h2')].some(h=>h.textContent.includes('Reader')),{timeout:60000});
  }else await current(tab,page.row);
  assert.equal(await address(tab),`/chat?page=${page.name}`,`${page.name}: a new tab keeps the page address`);
  await tab.close();
 }
 // 6. Back after a refresh still returns to the room.
 await p.goBack();await waitAddress(p,'/chat?room=gainers');await noneCurrent(p);

 // 7. Phone: the page opens over the list with its own address; Back returns to the list.
 const phone=await browser.newPage();phone.on('pageerror',e=>errors.push(e.message));
 await phone.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 const listShows=()=>phone.waitForFunction(n=>{const e=document.querySelector(n);if(!e)return false;const r=e.getBoundingClientRect();return getComputedStyle(e).visibility==='visible'&&r.width>0&&r.left>=0&&r.left<innerWidth/2;},{timeout:30000},nav);
 const listHidden=()=>phone.waitForFunction(n=>getComputedStyle(document.querySelector(n)).visibility==='hidden',{timeout:30000},nav);
 await phone.goto(base+'/chat');await listShows();
 await phone.waitForFunction(s=>{const e=document.querySelector(s);return e&&Object.keys(e).some(k=>k.startsWith('__reactProps'));},{timeout:60000},`${nav} a[data-chat-news-feed]`);
 await phone.waitForFunction(()=>history.state&&history.state.chatPhone==='list',{timeout:30000});
 await phone.tap(`${nav} a[data-chat-news-feed]`);await listHidden();
 await waitAddress(phone,'/chat?page=news-feed');
 await phone.goBack();await listShows();
 assert.notEqual(await address(phone),'/chat?page=news-feed','back on a phone leaves the page for the list');
 // A page link on a phone: the page shows (its address kept), and Back returns to the list.
 await phone.goto(base+'/chat?page=gainers-table');await listHidden();
 await phone.waitForSelector(`${nav} a[data-chat-gainers-table][aria-current="page"]`,{timeout:60000});
 await new Promise(r=>setTimeout(r,500));
 assert.equal(await address(phone),'/chat?page=gainers-table','a phone keeps the page link');
 await phone.goBack();await listShows();

 assert.deepEqual(errors,[]);
 console.log('PASS page addresses: News Feed, Gainers Table, FAQ and Reader each show /chat?page=<name>, survive a refresh and a new tab, rooms show ?room=, Back/Forward move between page and room, the refresh guard keeps ?page=, and a phone returns to the list');
}catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();}
