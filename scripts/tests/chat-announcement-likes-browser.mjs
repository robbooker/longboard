import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
const base='http://localhost:3214',owner='00000000-0000-4000-8000-000000000001';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];
async function fixture(table,body,method='POST'){
 const r=await fetch('http://127.0.0.1:54414/rest/v1/'+table,{method,headers:{Authorization:'Bearer test-service-role','Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});assert.ok(r.ok,await r.clone().text());return r.json();
}
const api=(page,body)=>page.evaluate(async body=>{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},body);
const names=(page,room,id)=>page.evaluate(async({room,id})=>{const r=await fetch('/api/chat/reactions?room='+room+'&messageId='+id);return {status:r.status,data:await r.json()};},{room,id});
try{
 const login=async(name)=>{const context=await browser.createBrowserContext(),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width:1440,height:900});await signIn(p,base,name+'@example.test',{composer:'textarea[aria-label^="Message "]'});return p;};
 const admin=await login('alice'),member=await login('bob'),outsider=await login('mallory');
 const scout=await(await browser.createBrowserContext()).newPage();scout.on('pageerror',e=>errors.push(e.message));await scout.goto('http://localhost:54414/test/scout');await scout.waitForSelector('textarea[aria-label="Message SS"]');
 const ids={};for(const room of ['lb-announcements','ss-announcements']){await new Promise(r=>setTimeout(r,1600));const sent=await api(admin,{action:'send',room,body:'Announcement likes fixture '+room});assert.equal(sent.status,200,JSON.stringify(sent));ids[room]=sent.data.message.id;}
 // Readers react through the shared reaction picker (palm/lemon likes became message reactions).
 for(const [room,p,name] of [['lb-announcements',member,'Bob'],['ss-announcements',scout,'Scout Tester']]){
  const id=ids[room],selector='#chat-message-'+id+' button[aria-label="Add reaction"]',chip=`[data-reaction-message="${id}"] > button[aria-pressed]`;
  const chipState=()=>p.evaluate(s=>{const e=document.querySelector(s);return e&&{pressed:e.getAttribute('aria-pressed'),label:e.getAttribute('aria-label'),disabled:e.disabled};},chip);
  for(const width of [1440,390]){
   await p.setViewport({width,height:900,isMobile:width===390,hasTouch:width===390});await p.goto(base+'/chat?room='+room);await p.waitForSelector(selector);
   assert.equal(await p.$('textarea[aria-label^="Message "]'),null,'announcement readers cannot post');assert.match(await p.$eval('body',e=>e.textContent),/You can react to announcements/);
   await p.waitForFunction(s=>!document.querySelector(s)?.disabled,{},selector);
   const like=p.waitForResponse(r=>r.url().endsWith('/api/chat/message-reactions')&&r.request().method()==='POST');const button=await p.$(selector);if(width===390)await button.tap();else await button.click();
   await p.waitForSelector('dialog[open] button[aria-label="like reaction"]');await p.click('dialog[open] button[aria-label="like reaction"]');assert.equal((await like).status(),200);
   await p.waitForFunction(s=>{const e=document.querySelector(s);return e?.getAttribute('aria-pressed')==='true'&&!e.disabled;},{},chip);
   const state=await chipState();assert.match(state.label,new RegExp(`like reaction, 1\\. ${name}`));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await p.screenshot({path:`/tmp/announcement-likes-${room}-${width}.png`});await p.reload();await p.waitForFunction(s=>document.querySelector(s)?.getAttribute('aria-pressed')==='true',{},chip);
   await p.click(chip);await p.waitForFunction(s=>!document.querySelector(s),{},chip);
  }
  assert.equal((await api(p,{action:'send',room,body:'Unauthorized announcement'})).status,403);assert.equal((await api(p,{action:'send',room,body:'Unauthorized reply',replyTo:id})).status,403);
  assert.equal((await api(admin,{action:'react',room,messageId:id,active:true})).status,200);assert.equal((await api(admin,{action:'react',room,messageId:id,active:false})).status,200);
  await fixture('longboard_chat_room_state?room_slug=eq.'+room,{is_open:false,paused_at:new Date().toISOString(),paused_by:owner},'PATCH');
  for(const active of [true,false])assert.equal((await api(p,{action:'react',room,messageId:id,active})).status,423);
  assert.equal((await api(admin,{action:'react',room,messageId:id,active:true})).status,423);
  await p.reload();await p.waitForSelector(selector);await p.waitForFunction(s=>document.querySelector(s)?.disabled===true,{timeout:10000},selector);
  await fixture('longboard_chat_room_state?room_slug=eq.'+room,{is_open:true,paused_at:null,paused_by:null},'PATCH');
 }
 assert.equal((await api(member,{action:'react',room:'ss-announcements',messageId:ids['ss-announcements'],active:true})).status,403);
 assert.equal((await api(scout,{action:'react',room:'lb-announcements',messageId:ids['lb-announcements'],active:true})).status,403);
 assert.equal((await api(outsider,{action:'react',room:'lb-announcements',messageId:ids['lb-announcements'],active:true})).status,403);
 assert.equal((await names(outsider,'lb-announcements',ids['lb-announcements'])).status,403);
 assert.equal((await api(member,{action:'react',room:'lb-announcements',messageId:ids['ss-announcements'],active:true})).status,404);assert.equal((await names(member,'lb-announcements',ids['ss-announcements'])).status,404);
 assert.equal((await api(member,{action:'react',room:'lb-announcements',messageId:ids['lb-announcements'],active:'yes'})).status,400);
 const anonymous=await(await browser.createBrowserContext()).newPage();await anonymous.goto(base+'/login');assert.equal((await api(anonymous,{action:'react',room:'lb-announcements',messageId:ids['lb-announcements'],active:true})).status,401);
 assert.deepEqual(errors,[]);console.log('PASS eligible LB/SS reader desktop/mobile like reaction, count/name label, persistence/unlike, admin reaction/post, non-admin post/reply denial, paused UI/API, outsider/cross-community/anonymous denial, mismatched target404 and invalid input400.');
}finally{await browser.close();}
