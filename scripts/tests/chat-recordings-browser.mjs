// Actual Next.js components and APIs against isolated current-schema PGlite data.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3344',browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[],stamp=Date.now();
async function login(name){const p=await(await browser.createBrowserContext()).newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(60000);await p.setViewport({width:1440,height:1000});await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',name+'@example.test');await p.type('#li-password','demo-only');await p.click('button[type="submit"]');await p.waitForSelector('textarea[aria-label="Message LB"]');return p;}
async function api(p,path,body){return p.evaluate(async({path,body})=>{const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json()};},{path,body});}
async function pick(p,id,emoji){const scope=`[data-reaction-message="${id}"]`;await p.waitForSelector(scope);await p.evaluate(scope=>[...document.querySelectorAll(scope+' button')].find(b=>b.textContent.trim()==='＋ ADD REACTION').click(),scope);await p.waitForSelector('dialog[open]');await p.click(`dialog[open] button[aria-label="${emoji} reaction"]`);await p.waitForSelector('dialog[open]',{hidden:true});await p.waitForSelector(`${scope} button[aria-label^="Remove ${emoji}"]`);}
try{
 const admin=await login('alice'),member=await login('bob');
 const scout=await(await browser.createBrowserContext()).newPage();scout.setDefaultTimeout(60000);scout.on('pageerror',e=>errors.push(e.message));await scout.goto('http://localhost:54544/test/scout');await scout.waitForSelector('textarea[aria-label="Message SS"]');
 for(const [room,label,reader] of [['lb-recordings','LB RECORDINGS',member],['ss-recordings','SS RECORDINGS',scout]]){
  await admin.goto(`${base}/chat?room=${room}`,{waitUntil:'networkidle2'});
  await admin.waitForSelector(`textarea[aria-label="Message ${label}"]`);
  await admin.waitForFunction(()=>{const e=document.querySelector('textarea');return e&&Object.keys(e).some(k=>k.startsWith('__reactProps'));});
  const body=`${label} session ${stamp}`;await admin.type(`textarea[aria-label="Message ${label}"]`,body);await admin.click('button[type="submit"][data-state]');
  await admin.waitForFunction(body=>[...document.querySelectorAll('article')].some(e=>e.textContent.includes(body)&&!e.dataset.pending),{},body);
  const id=await admin.evaluate(body=>[...document.querySelectorAll('article[id^="chat-message-"]')].find(e=>e.textContent.includes(body)).id.replace('chat-message-',''),body);
  assert.equal(await admin.$(`#chat-message-${id} button[aria-expanded]`),null,'no admin Reply button');
  assert.equal((await api(admin,'/api/chat',{action:'send',room,body:'reply',replyTo:id})).status,403);
  assert.equal((await api(admin,`/api/chat/thread?room=${room}&messageId=${id}`)).status,403);
  const alerts=await api(reader,'/api/chat/activity');assert(alerts.data.mentions.some(n=>n.room===room));
  await reader.goto(`${base}/chat?room=${room}`,{waitUntil:'networkidle2'});await reader.waitForSelector(`#chat-message-${id}`);
  assert.equal(await reader.$('textarea[aria-label^="Message "]'),null);
  assert.equal(await reader.$(`#chat-message-${id} button[aria-expanded]`),null);
  assert.equal((await api(reader,'/api/chat',{action:'send',room,body:'unauthorized'})).status,403);
  await pick(reader,id,'like');await pick(reader,id,'rob');
  for(const width of [320,390,768,1440]){await reader.setViewport({width,height:1000});assert.equal(await reader.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`no overflow at ${width}`);}
  await reader.screenshot({path:`/tmp/${room}-desktop.png`});await reader.setViewport({width:390,height:1000});await reader.screenshot({path:`/tmp/${room}-mobile.png`});
  await reader.reload({waitUntil:'networkidle2'});await reader.waitForSelector(`[data-reaction-message="${id}"] button[aria-label^="Remove rob"]`);
  const details=await api(reader,'/api/chat/message-reactions',{action:'details',kind:'room',room,messageId:id,emoji:'rob'});assert.equal(details.status,200,JSON.stringify(details));assert.equal(details.data.people.length,1);
  assert.equal((await api(reader,'/api/chat/favorite',{favorite:{kind:'room',room}})).status,200);
  assert((await api(reader,'/api/chat/quad-options')).data.rooms.includes(room));
  await reader.goto(`${base}/chat?room=${room}&thread=${id}`,{waitUntil:'networkidle2'});assert.equal(await reader.$('aside[aria-label="Comment replies"]'),null);assert.equal(await reader.$('section[inert]'),null,'restored recording thread cannot cover feed');
  const edit=await api(admin,'/api/chat/message',{action:'edit',room,messageId:id,body:body+' edited',expectedBody:body});assert.equal(edit.status,200,JSON.stringify(edit));
  const cross=room==='lb-recordings'?scout:member;assert.equal((await api(cross,`/api/chat/history?room=${room}`)).status,403);
  assert.equal((await api(cross,'/api/chat/message-reactions',{action:'read',kind:'room',room,messageIds:[id]})).status,403);
  assert.equal((await api(cross,'/api/chat/message-reactions',{action:'details',kind:'room',room,messageId:id,emoji:'rob'})).status,403);
  assert.equal((await api(admin,'/api/chat/message',{action:'delete',room,messageId:id})).status,200);
 }
 assert.deepEqual(errors,[]);console.log('PASS current components desktop/mobile: admin root posts/edit/delete, reader like+Rob persistence, no reply UI/API, matching notifications, cross-membership history/reactions denial, no horizontal overflow.');
}finally{await browser.close();}
