import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const owner='00000000-0000-4000-8000-000000000001';
async function fixture(table,body,method='POST'){
 const r=await fetch('http://localhost:54404/rest/v1/'+table,{method,headers:{Authorization:'Bearer test-service-role','Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});
 assert.ok(r.ok,await r.clone().text());return r.json();
}
const [active]=await fixture('chat_feature_requests',{title:'Open priority ticket',created_by:owner});
const [completed]=await fixture('chat_feature_requests',{title:'Published archive ticket',created_by:owner,status:'done',outcome:'Published and verified'});
const [archived]=await fixture('chat_feature_requests',{title:'Withdrawn archive ticket',created_by:owner,status:'archived'});
await fixture('chat_feature_messages',{request_id:completed.id,author_label:'Codex',kind:'system',body:'Preserved release history'});
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
 async function login(p,email){await p.goto('http://localhost:3204/login?next=%2Fchat%2Ffeatures');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type="submit"]');await p.waitForSelector('#feature-title');}
 const api=(url)=>page.evaluate(async url=>{const r=await fetch(url);return {status:r.status,data:await r.json()};},url);
 const click=async text=>page.evaluate(text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text).click(),text);
 await login(page,'alice@example.test');await page.waitForSelector('nav[aria-label="Feature requests"] button');
 const list=(await api('/api/chat/features')).data.requests;
 assert.ok(list.some(r=>r.id===active.id));assert.ok(!list.some(r=>[completed.id,archived.id].includes(r.id)));
 const archive=(await api('/api/chat/features?view=archive')).data.requests;
 assert.ok(archive.some(r=>r.id===completed.id));assert.ok(archive.some(r=>r.id===archived.id));assert.ok(!archive.some(r=>r.id===active.id));
 const statuses=(await api('/api/chat/features?statusOnly=1')).data.statuses;assert.ok(!statuses.some(r=>[completed.id,archived.id].includes(r.id)));
 await page.goto('http://localhost:3204/chat/features?request='+active.id);await page.waitForSelector('select[aria-label="Ticket priority"]');
 for(const priority of ['1','3']){
  await page.select('select[aria-label="Ticket priority"]',priority);
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].some(e=>e.textContent.startsWith('Priority saved')));
  const style=await page.$eval('main > [role="status"]',e=>({position:getComputedStyle(e).position,pointerEvents:getComputedStyle(e).pointerEvents,top:e.getBoundingClientRect().top}));
  assert.equal(style.position,'fixed');assert.equal(style.pointerEvents,'none');assert.equal(style.top,16);
  await page.waitForFunction(()=>![...document.querySelectorAll('[role="status"]')].some(e=>e.textContent.startsWith('Priority saved')),{timeout:3000});
 }
 await click('Archive');await page.waitForFunction(()=>document.querySelector('nav')?.textContent.includes('Published archive ticket'));
 assert.ok(!(await page.$eval('nav',e=>e.textContent)).includes('Open priority ticket'));
 await page.goto('http://localhost:3204/chat/features?request='+completed.id);await page.waitForFunction(()=>document.querySelector('h2')?.textContent==='Published archive ticket');
 assert.ok((await page.$eval('main',e=>e.textContent)).includes('Preserved release history'));
 assert.equal(await page.$eval('[aria-label="Ticket views"] button:nth-child(2)',e=>e.getAttribute('aria-pressed')),'true');
 // Publishing an open ticket moves it out of active results without rewriting its audited done state.
 await fixture('chat_feature_requests?id=eq.'+active.id,{status:'done'},'PATCH');
 assert.ok(!(await api('/api/chat/features')).data.requests.some(r=>r.id===active.id));
 assert.ok((await api('/api/chat/features?view=archive')).data.requests.some(r=>r.id===active.id&&r.status==='done'));
 await page.setViewport({width:390,height:844});await page.screenshot({path:'/tmp/feature-archive-mobile.png',fullPage:true});
 const context=await browser.createBrowserContext();const friend=await context.newPage();await login(friend,'bob@example.test');
 await friend.goto('http://localhost:3204/chat/features?request='+archived.id);await friend.waitForFunction(()=>document.querySelector('h2')?.textContent==='Withdrawn archive ticket');assert.equal(await friend.$('#feature-message'),null);
 const outsider=await browser.createBrowserContext();const denied=await outsider.newPage();await denied.goto('http://localhost:3204/login');
 assert.equal(await denied.evaluate(async()=> (await fetch('/api/chat/features?view=archive')).status),404);
 assert.deepEqual(errors,[]);console.log('PASS two-second repeatable nonblocking toast; active/archive isolation; preserved completed history and old links; auto archive on done; participant retrieval; unauthenticated denial; mobile; no page errors');
}finally{await browser.close();}
