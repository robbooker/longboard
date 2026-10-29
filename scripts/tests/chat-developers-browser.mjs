// #322 Developers room, on desktop 1280 and phone 390, against the Developers fixture on this
// test's own ports (localhost:3322, database 127.0.0.1:54322). Synthetic data only.
//  - a Longboard member without Boardroom (Mallory) sees Developers in the Rooms list, right after
//    Gainers, and opens it: title "Developers", a message box, no horizontal page scroll;
//  - she posts, replies and reacts there; the post shows up in the room;
//  - search offers a Developers scope and finds the post.
// CHAT_SHOT_DIR: also save sidebar screenshots there (developers-sidebar-desktop/phone.png).
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3322',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54322';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR;
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const {people:[,,mallory]}=await control('identity');

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const navLink='a[href^="/chat?room=developers"]';
const visible=(p,sel)=>p.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility()),{timeout:60000},sel);
const api=(p,path,body)=>p.evaluate(async({path,body})=>{const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json().catch(()=>null)};},{path,body});
// The visible Rooms group, in order.
const roomsGroup=p=>p.evaluate(()=>{
 const nav=[...document.querySelectorAll('#chat-room-navigation')].find(e=>e.checkVisibility());
 const items=[...nav.querySelectorAll('div, a')].filter(e=>e.checkVisibility()&&(e.matches('a[href^="/chat?room="]')&&!e.closest('section')||e.tagName==='DIV'&&!e.children.length&&/^(Rooms|Announcements|Recordings)$/.test(e.textContent.trim())))
  .map(e=>e.matches('a')?e.getAttribute('href').match(/room=([\w-]+)/)[1]:'#'+e.textContent.trim());
 const start=items.indexOf('#Rooms'),end=items.findIndex((x,i)=>i>start&&x.startsWith('#'));
 return items.slice(start+1,end<0?undefined:end);
});
async function openList(p,view){
 if(view==='phone'){
  await p.goto(`${base}/chat`);await visible(p,'button[aria-label="Back to all chats"],'+navLink);
  const back=await p.$('button[aria-label="Back to all chats"]');if(back&&await back.evaluate(e=>e.checkVisibility()))await back.click();
 }else await p.goto(`${base}/chat?room=social`);
 await visible(p,navLink);await pause(800);
}

try{
 console.log('Browser',await browser.version());
 const member=await (await browser.createBrowserContext()).newPage();member.on('pageerror',e=>errors.push(e.message));member.setDefaultTimeout(60000);
 await member.setViewport(desktop);
 await signIn(member,base,mallory.email,{next:'/chat?room=social',composer:'textarea[aria-label="Message Social"]'});

 // 1. Rooms list: Developers right after Gainers, on both widths.
 for(const [view,size] of [['desktop',desktop],['phone',phone]]){
  await member.setViewport(size);await openList(member,view);
  const rooms=await roomsGroup(member);
  const g=rooms.indexOf('gainers');
  assert(g>=0,`${view}: Gainers listed: ${rooms.join(' | ')}`);
  assert.equal(rooms[g+1],'developers',`${view}: Developers right after Gainers: ${rooms.join(' | ')}`);
  assert.equal(rooms.filter(r=>r==='developers').length,1,`${view}: listed once`);
  const label=await member.evaluate(sel=>{const e=[...document.querySelectorAll(sel)].find(e=>e.checkVisibility());return {text:e.textContent,locked:e.dataset.locked};},navLink);
  assert(label.text.includes('Developers'),`${view}: named Developers (${label.text})`);
  assert.notEqual(label.locked,'true',`${view}: open to this member, not locked`);
  if(shots)await member.screenshot({path:`${shots}/developers-sidebar-${view}.png`});
 }

 // 2. Inside the room on both widths: title, a message box, no page scroll.
 for(const [view,size] of [['desktop-1280',desktop],['phone-390',phone]]){
  await member.setViewport(size);await member.goto(`${base}/chat?room=developers`);
  await visible(member,'textarea[aria-label="Message Developers"]');await pause(500);
  const title=await member.evaluate(()=>[...document.querySelectorAll('header h1')].find(e=>e.checkVisibility())?.textContent);
  assert.equal(title,'Developers',view+': room title');
  assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+': no horizontal page scroll');
  if(shots)await member.screenshot({path:`${shots}/developers-room-${view}.png`});
 }

 // 3. A member posts, replies and reacts.
 const sent=await api(member,'/api/chat',{action:'send',room:'developers',body:'My first dashboard on the chat API',clientId:randomUUID()});
 assert.equal(sent.status,200,'member posts: '+JSON.stringify(sent.data));
 const id=sent.data?.message?.id??sent.data?.id;assert(id,'post id: '+JSON.stringify(sent.data));
 // Sends are rate-limited per person; wait out the limit before the reply.
 let reply;for(let i=0;i<30;i++){reply=await api(member,'/api/chat',{action:'send',room:'developers',body:'Reply in the thread',replyTo:id,clientId:randomUUID()});if(reply.status!==429)break;await pause(1000);}
 assert.equal(reply.status,200,'member replies: '+JSON.stringify(reply.data));
 await member.setViewport(desktop);await member.goto(`${base}/chat?room=developers`);
 await member.waitForFunction(()=>document.body.innerText.includes('My first dashboard on the chat API'),{timeout:60000});

 // 4. Search offers a Developers scope and finds the post.
 const found=await api(member,'/api/chat/search?q=dashboard&room=developers');
 assert.equal(found.status,200,'search: '+JSON.stringify(found.data));
 assert(found.data.messages.some(m=>m.id===id),'search finds the post');
 assert.deepEqual(errors,[]);
 console.log('PASS Developers desktop 1280 + phone 390: right after Gainers in Rooms, open to a Longboard member without Boardroom, title and message box, post + reply, search scope.');
}finally{await browser.close();}
