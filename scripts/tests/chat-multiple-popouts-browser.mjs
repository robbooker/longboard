// #438: several chats popped out at once. A DM, the News Feed, the LB room and the Gainers Table each
// open in their own window (none replaces another), each window's title names its chat, popping
// out the same DM again brings its window forward without opening (or reloading) another, closing
// one leaves the rest working, and messages flow live between the pop-outs and the main app.
// Synthetic shared fixture only: ports 3438/54638, no production credentials or messages.
//
// Usage: node scripts/tests/chat-multiple-popouts-browser.mjs [--shots <dir>]
//   --shots writes after-main.png, after-popouts.png (a side-by-side of the windows) into <dir>.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {signIn} from './browser-login.mjs';
const base='http://localhost:3438',nav='nav[aria-label="Chat rooms"]';
const args=process.argv.slice(2),shots=args.includes('--shots')?args[args.indexOf('--shots')+1]:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const clickText=async(p,selector,text)=>{for(const b of await p.$$(selector))if(await b.evaluate((e,t)=>e.textContent.trim()===t,text)){await b.click();return;}throw Error(`no ${selector} "${text}"`);};
const popups=()=>browser.pages().then(pages=>pages.filter(p=>p.url().includes('popout=1')));
// "Pop out" from the header's menu; resolves with the new window (or null when none opened).
async function popOut(p){
 const before=new Set(await popups());
 // The menu item, once the menu has opened (opened again if a re-render closed it).
 const item=()=>p.waitForFunction(()=>[...document.querySelectorAll('button')].find(b=>b.checkVisibility()&&/^Pop out (chat|Gainers)$/.test(b.textContent.trim())),{timeout:5000});
 let button=null;
 for(let i=0;i<3&&!button;i++){await p.click('button[aria-label="Chat settings"]');button=await item().catch(()=>null);}
 assert.ok(button,'the Pop out menu item');
 await button.click();
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){const fresh=(await popups()).filter(x=>!before.has(x));if(fresh.length)return fresh[0];await sleep(150);}
 return null;
}
async function openDm(p){
 await p.waitForSelector(`${nav} button[data-active]`,{visible:true});
 for(const b of await p.$$(`${nav} button[data-active]`))if(await b.evaluate(e=>e.textContent.includes('Bob'))){await b.click();break;}
 await p.waitForSelector('header[data-dm="true"]');
 if(await p.$$eval('button',els=>els.some(e=>e.textContent==='Accept request')))await clickText(p,'button','Accept request');
 await p.waitForSelector('#dm-body');
}
const title=(p,text)=>p.waitForFunction(t=>document.title.startsWith(t),{timeout:60000},text);
const shows=(p,selector,text)=>p.waitForFunction((s,t)=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility()&&e.textContent.includes(t)),{timeout:30000},selector,text);
const send=async(p,selector,text)=>{await p.waitForSelector(selector,{visible:true});await p.type(selector,text);await p.keyboard.press('Enter');};
const errors=[];
// Every pop-out's page errors count too.
browser.on('targetcreated',async t=>{const w=await t.page().catch(()=>null);w?.on('pageerror',e=>{errors.push(`${w.url()}: ${e.message}`);console.log('pageerror:',w.url(),e.message);});});
try{
 const p=await browser.newPage();await p.setViewport({width:1440,height:900});
 p.on('pageerror',e=>errors.push(e.message));
 await signIn(p,base,'alice@example.test',{composer:'textarea[aria-label="Message LB"]'});
 // 1. A DM.
 await openDm(p);
 const dm=await popOut(p);assert.ok(dm,'the DM opens a window');
 assert.match(dm.url(),/[?&]dm=[0-9a-f-]{36}/,'the DM window opens that DM');
 await dm.waitForSelector('#dm-body',{visible:true,timeout:60000});await title(dm,'Bob');
 await dm.evaluate(()=>{window.__popout438='kept';});
 // 2. The News Feed: a second window, the DM's stays.
 await p.click(`${nav} a[data-chat-news-feed]`);await p.waitForSelector(`${nav} a[data-chat-news-feed][aria-current="page"]`,{timeout:60000});
 const news=await popOut(p);assert.ok(news,'the News Feed opens its own window');
 assert.match(news.url(),/[?&]page=news-feed/);
 // (The fixture has no news source, so the feed itself only says it is unavailable.)
 await title(news,'News Feed');await news.waitForSelector('a[data-chat-news-feed][aria-current="page"]',{timeout:60000});
 assert.equal(dm.isClosed(),false);assert.match(dm.url(),/[?&]dm=/,'the DM window was not replaced');
 // 3. The Gainers Table, then the LB room: a third and a fourth window.
 await p.click(`${nav} a[data-chat-gainers-table]`);await p.waitForSelector(`${nav} a[data-chat-gainers-table][aria-current="page"]`,{timeout:60000});
 const table=await popOut(p);assert.ok(table,'the Gainers Table opens its own window');
 assert.match(table.url(),/[?&]page=gainers-table/);await title(table,'Gainers Table');
 await table.waitForSelector('a[data-chat-gainers-table][aria-current="page"]',{timeout:60000});
 await p.goto(base+'/chat?room=main');await p.waitForSelector('textarea[aria-label="Message LB"]',{visible:true,timeout:60000});
 const lb=await popOut(p);assert.ok(lb,'the LB room opens its own window');
 await lb.waitForSelector('textarea[aria-label="Message LB"]',{visible:true,timeout:60000});await title(lb,'Longboard');
 assert.equal((await popups()).length,4,'four pop-outs open at once');
 assert.equal(new Set((await popups()).map(x=>x.url())).size,4,'each shows its own chat');
 // Popping out the DM again brings its window forward: no fifth window, no reload.
 await openDm(p);
 assert.equal(await popOut(p),null,'no duplicate window for the same DM');
 assert.equal((await popups()).length,4);
 assert.equal(await dm.evaluate(()=>window.__popout438),'kept','the DM window was not reloaded');
 // Live: the main app's message reaches the DM window; the DM window's reaches the main app.
 const fromMain=`From the main app ${Date.now()}`;await send(p,'#dm-body',fromMain);
 await shows(dm,'[data-chat-message-id], li, article',fromMain);
 const fromPopout=`From the DM pop-out ${Date.now()}`;await send(dm,'#dm-body',fromPopout);
 await shows(p,'[data-chat-message-id], li, article',fromPopout);
 // Closing the News Feed window leaves the others working.
 await news.close();await sleep(300);
 assert.equal((await popups()).length,3);
 const fromLb=`From the LB pop-out ${Date.now()}`;await send(lb,'textarea[aria-label="Message LB"]',fromLb);
 await p.goto(base+'/chat?room=main');await shows(p,'[data-chat-message-id], li, article',fromLb);
 const again=`DM still live ${Date.now()}`;await send(dm,'#dm-body',again);
 await openDm(p);await shows(p,'[data-chat-message-id], li, article',again);
 if(shots){
  await p.screenshot({path:join(shots,'after-main.png')});
  for(const [name,w] of [['dm',dm],['lb',lb],['table',table]]){await w.setViewport({width:460,height:780});await w.screenshot({path:join(shots,`after-popout-${name}.png`)});}
 }
 assert.deepEqual(errors,[]);
 console.log('PASS multiple pop-outs: DM, News Feed, Gainers Table and LB each in their own titled window, a repeat pop-out focuses without reloading, closing one keeps the rest, live messages both ways');
}catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();}
