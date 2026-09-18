import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3282';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const p=await browser.newPage();await p.setViewport({width:1440,height:1000});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email','alice@example.test');await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label="Message LB"]');await p.waitForSelector('article[id^="chat-message-"]');
 await p.waitForNetworkIdle({idleTime:500});
 let delayed=true;const navigations=[];p.on('request',r=>{if((r.isNavigationRequest()&&r.frame()===p.mainFrame())||r.url().includes('_rsc='))navigations.push(r.url());});await p.setRequestInterception(true);p.on('request',async r=>{if(delayed&&r.url()===base+'/api/chat/updates'&&r.postData()?.includes('/api/chat/history'))await new Promise(resolve=>setTimeout(resolve,650));await r.continue();});
 await p.type('textarea[aria-label="Message LB"]','LB preserved draft');
 const pane=()=>p.$('div[aria-live="polite"][aria-busy]');
 const scroll=await p.$eval('div[aria-live="polite"][aria-busy]',e=>{e.scrollTop=200;e.dispatchEvent(new Event('scroll'));return e.scrollTop;});
 await p.click('nav[aria-label="Chat rooms"] a[href="/chat?room=social"]');await p.waitForSelector('textarea[aria-label="Message SOCIAL"]');assert(await p.$eval('div[aria-live="polite"][aria-busy]',e=>e.getAttribute('aria-busy')==='true'),'Cold room shows stable loading state');await p.waitForFunction(()=>document.querySelector('div[aria-live="polite"][aria-busy]')?.getAttribute('aria-busy')==='false');
 await p.type('textarea[aria-label="Message SOCIAL"]','Social preserved draft');
 const timings=[];
 for(let i=0;i<20;i++){
  const room=i%2?'social':'main',label=i%2?'SOCIAL':'LB';
  timings.push(await p.evaluate(({room,label})=>new Promise((resolve,reject)=>{const begin=performance.now(),timeout=setTimeout(()=>reject(Error('Warm room missing')),1000);const ob=new MutationObserver(()=>{const input=document.querySelector(`textarea[aria-label="Message ${label}"]`),pane=document.querySelector('div[aria-live="polite"][aria-busy]');if(input&&pane?.getAttribute('aria-busy')==='false'){ob.disconnect();requestAnimationFrame(()=>{clearTimeout(timeout);resolve(performance.now()-begin);});}});ob.observe(document.body,{subtree:true,childList:true,attributes:true});document.querySelector(`nav[aria-label="Chat rooms"] a[href="/chat?room=${room}"]`).click();}),{room,label}));
  assert.equal(await p.$eval(`textarea[aria-label="Message ${label}"]`,e=>e.value),room==='main'?'LB preserved draft':'Social preserved draft');
  if(room==='main')assert(Math.abs(await p.$eval('div[aria-live="polite"][aria-busy]',e=>e.scrollTop)-scroll)<3,'Room scroll restored');
 }
 const p95=[...timings].sort((a,b)=>a-b)[18];assert(p95<150,JSON.stringify({p95,timings}));assert.equal(navigations.length,0,'Warm room switches need no document/RSC navigation');console.log('Room20 warm p95ms',p95.toFixed(1));
 await p.goBack();await p.waitForSelector('textarea[aria-label="Message LB"]');assert.equal(await p.$eval('textarea[aria-label="Message LB"]',e=>e.value),'LB preserved draft');await p.goForward();await p.waitForSelector('textarea[aria-label="Message SOCIAL"]');
 await p.click('nav[aria-label="Chat rooms"] a[href="/chat?room=main"]');
 await p.waitForSelector('textarea[aria-label="Message LB"]');await p.click('article[id^="chat-message-"] button[aria-expanded]');await p.waitForSelector('#thread-reply');await p.type('#thread-reply','Preserved thread draft');
 await p.click('nav[aria-label="Chat rooms"] a[href="/chat?room=social"]');await p.waitForSelector('textarea[aria-label="Message SOCIAL"]');await p.goBack();await p.waitForSelector('#thread-reply');assert.equal(await p.$eval('#thread-reply',e=>e.value),'Preserved thread draft','Back restores thread and its draft');
 await p.setViewport({width:390,height:844});await p.screenshot({path:'/tmp/s04-room-mobile.png'});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 delayed=false;assert.deepEqual(errors,[]);console.log('PASS immediate warm rooms, delayed background reads, cold loading, draft/scroll preservation, browser back/forward and mobile.');
}catch(e){console.error(e);for(const p of await browser.pages())if(p.url().includes('/chat'))await p.screenshot({path:'/tmp/s04-room-failure.png'});throw e;}finally{await browser.close();}
