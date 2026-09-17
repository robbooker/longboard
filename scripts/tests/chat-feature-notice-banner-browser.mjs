import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3214',owner='00000000-0000-4000-8000-000000000001';
async function fixture(table,body,method='POST'){
 const r=await fetch('http://127.0.0.1:54414/rest/v1/'+table,{method,headers:{Authorization:'Bearer test-service-role','Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});
 assert.ok(r.ok,await r.clone().text());return r.json();
}
const [ticket]=await fixture('chat_feature_requests',{title:'Notification banner test '+Date.now(),created_by:owner,status:'in_progress'});
await fixture('chat_feature_requests?id=eq.'+ticket.id,{status:'ready'},'PATCH');
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1280,height:900});
 const banner='aside[aria-label="Feature update"]',bell='button[aria-label^="Feature notifications"]';
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 let posts=0;page.on('request',r=>{if(r.url().endsWith('/api/chat/features/notifications')&&r.method()==='POST')posts++;});
 await page.goto(base+'/login?next=%2Fchat%2Ffeatures');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('#feature-title');
 const refresh=async()=>{const done=page.waitForResponse(r=>r.url().endsWith('/api/chat/features/notifications')&&r.request().method()==='GET');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await done;await pause(80);};
 const inbox=()=>page.evaluate(async()=>await(await fetch('/api/chat/features/notifications')).json());
 await refresh();assert.equal(await page.$(banner),null,'historical unread alerts seed silently');
 const baseline=await inbox();assert.ok(baseline.notifications.some(n=>n.request_id===ticket.id&&n.category==='status'&&!n.read_at));
 const update=async status=>{await fixture('chat_feature_requests?id=eq.'+ticket.id,{status},'PATCH');await refresh();await page.waitForSelector(banner);};
 await page.focus('#feature-title');await update('in_progress');
 const start=Date.now();const position=await page.$eval(banner,e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{top:r.top,right:innerWidth-r.right,width:r.width,pointer:s.pointerEvents,position:s.position};});
 assert.equal(position.top,16);assert.equal(position.right,16);assert.equal(position.position,'fixed');assert.equal(position.pointer,'none');assert.ok(position.width<=320);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'feature-title');await page.type('#feature-title','Typing remains available');
 await pause(1100);assert.ok(await page.$(banner));await refresh();
 await page.waitForSelector(banner,{hidden:true,timeout:1800});const elapsed=Date.now()-start;assert.ok(elapsed>=1600&&elapsed<2900,'dismissed after2sec without repeated-poll timer reset: '+elapsed);
 const after=await inbox();assert.ok(after.unread>baseline.unread);assert.equal(posts,0,'expiry must not mark notifications read');
 await refresh();assert.equal(await page.$(banner),null,'same event never reappears');
 await update('ready');await page.click('button[aria-label="Dismiss feature update"]');assert.equal(await page.$(banner),null);await refresh();assert.equal(await page.$(banner),null);assert.equal(posts,0,'manual dismissal must not mark read');
 // Later update replaces an active banner and receives its own full lifetime.
 await update('blocked');await pause(1200);await update('in_progress');await pause(1100);assert.ok(await page.$(banner));assert.match(await page.$eval(banner,e=>e.textContent),/Development started/);await page.waitForSelector(banner,{hidden:true,timeout:1800});
 // New ordinary discussion notifications stay in the inbox without work banners.
 await fixture('chat_feature_messages',{request_id:ticket.id,author_label:'Codex',kind:'assistant',body:'A normal discussion reply'});await refresh();assert.equal(await page.$(banner),null);
 await page.click(bell);await page.waitForSelector('section[aria-label="Feature notifications"]');assert.match(await page.$eval('section[aria-label="Feature notifications"]',e=>e.textContent),/Development started/);
 assert.ok((await inbox()).notifications.some(n=>n.request_id===ticket.id&&!n.read_at));await page.click('button[aria-label="Close notifications"]');
 // Remount is silent, even with the full unread backlog. Mobile sidebar stays closed.
 await page.setViewport({width:390,height:844});await page.goto(base+'/chat');await page.waitForSelector('textarea[aria-label^="Message "]');await page.waitForSelector(bell);await refresh();assert.equal(await page.$(banner),null);
 await update('ready');assert.equal(await page.$eval(banner,e=>e.parentElement===document.body),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const mobile=await page.$eval(banner,e=>{const r=e.getBoundingClientRect();return{right:r.right,top:r.top,height:r.height};});assert.ok(mobile.right<=390&&mobile.top===16&&mobile.height<100);
 await page.screenshot({path:'/tmp/feature-notice-banner-mobile.png'});await page.click('button[aria-label="Dismiss feature update"]');assert.equal(await page.$(banner),null);
 assert.equal(posts,0);assert.deepEqual(errors,[]);
 console.log('PASS silent initial/remount backlog; status-only updates;2sec expiry; repeated-poll dedup; replacement timer; manual dismissal; retained unread/history; focus and typing; mobile closed-nav portal; no page errors.');
}finally{await browser.close();}
