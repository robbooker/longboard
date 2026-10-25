// D-304 "What's New Room Changes", on desktop 1280 and phone 390, against the What's New fixture on
// this test's own ports (localhost:3304, database 127.0.0.1:54304). Synthetic data only.
//  - the room list: What's New? sits below the member's pinned rooms and above the "Rooms"
//    heading; with nothing pinned it is the first entry of the list;
//  - the name is "What's New?" in the room list, the room header and the quick switcher;
//  - inside the room the line under the title is the description, exactly
//    "Chat Improvements… Real time updates as they go live.", "Admin posts only" is gone from the
//    header, and the description shows once (no separate line above the messages);
//  - a member still can't post: no message box, the read-only footer, and the API refuses.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3304',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54304';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const NAME="What's New?",DESCRIPTION="Chat Improvements… Real time updates as they go live.";
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const {people:[,,mallory]}=await control('identity');

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const navLink='a[href^="/chat?room=whats-new"]';
const visible=(p,sel)=>p.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility()),{timeout:60000},sel);
const api=(p,path,body)=>p.evaluate(async({path,body})=>{const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json().catch(()=>null)};},{path,body});
const pin=async(p,action,room)=>assert.equal((await api(p,'/api/chat/pins',{action,target:{kind:'room',room}})).status,200,`${action} ${room}`);

// The visible room list in order: the Pinned section, headings and room rows.
const listOrder=p=>p.evaluate(()=>{
 const nav=[...document.querySelectorAll('#chat-room-navigation')].find(e=>e.checkVisibility());
 return [...nav.querySelectorAll('section[aria-label="Pinned conversations"], div, a')].filter(e=>e.checkVisibility()&&(
  e.matches('section')||e.matches('a')&&!e.closest('section')||e.tagName==='DIV'&&!e.children.length&&/^(Rooms|Announcements|Recordings)$/.test(e.textContent.trim())))
  .map(e=>e.matches('section')?'Pinned:'+[...e.querySelectorAll('button[aria-label^="Open pinned"]')].map(b=>b.textContent.trim()).join(','):e.matches('a')?'room:'+(e.getAttribute('href')?.match(/room=([\w-]+)/)?.[1]??e.textContent.trim()):'heading:'+e.textContent.trim());
});
async function openList(p,view){
 if(view==='phone'){
  await p.goto(`${base}/chat`);await visible(p,'button[aria-label="Back to all chats"],'+navLink);
  const back=await p.$('button[aria-label="Back to all chats"]');if(back&&await back.evaluate(e=>e.checkVisibility()))await back.click();
 }else await p.goto(`${base}/chat?room=social`);
 await visible(p,navLink);await pause(800);
}
async function checkList(p,view,pinned){
 await openList(p,view);
 if(pinned.length)await p.waitForFunction(n=>[...document.querySelectorAll('button[aria-label^="Open pinned"]')].filter(e=>e.checkVisibility()).length===n,{timeout:30000},pinned.length);
 const order=await listOrder(p);
 const at=order.indexOf('room:whats-new'),rooms=order.indexOf('heading:Rooms');
 assert(at>=0&&rooms>=0,`${view}: list has What's New? and Rooms: ${order.join(' | ')}`);
 assert.equal(at,rooms-1,`${view}: What's New? sits right above the Rooms heading: ${order.join(' | ')}`);
 if(pinned.length){
  assert.equal(order[0],'Pinned:'+pinned.join(','),`${view}: pins first: ${order.join(' | ')}`);
  assert.equal(at,1,`${view}: What's New? right below the pins: ${order.join(' | ')}`);
 }else assert.equal(at,0,`${view}: with nothing pinned, What's New? is at the very top: ${order.join(' | ')}`);
 assert.equal(order.filter(e=>e==='room:whats-new').length,1,`${view}: listed once`);
 const label=await p.evaluate(sel=>[...document.querySelectorAll(sel)].find(e=>e.checkVisibility()).textContent,navLink);
 assert(label.includes(NAME),`${view}: named ${NAME} in the list (${label})`);
}

try{
 console.log('Browser',await browser.version());
 const member=await (await browser.createBrowserContext()).newPage();member.on('pageerror',e=>errors.push(e.message));member.setDefaultTimeout(60000);
 await member.setViewport(desktop);
 await signIn(member,base,mallory.email,{next:'/chat?room=social',composer:'textarea[aria-label="Message Social"]'});
 for(const room of ['social','gainers','whats-new'])await pin(member,'unpin',room);

 // 1. Placement without pins, then with pins (pinned rooms keep their own order).
 await checkList(member,'desktop',[]);
 await member.setViewport(phone);await checkList(member,'phone',[]);
 await pin(member,'pin','gainers');await pin(member,'pin','social');
 const pinned=(await api(member,'/api/chat/pins')).data.pins.map(p=>p.label);
 assert.deepEqual([...pinned].sort(),['Gainers','Social']);
 await checkList(member,'phone',pinned);
 await member.setViewport(desktop);await checkList(member,'desktop',pinned);
 // Pinning What's New? itself shows it under Pinned (by name) and still in its own spot.
 await pin(member,'pin','whats-new');
 const withNews=(await api(member,'/api/chat/pins')).data.pins.map(p=>p.label);
 assert(withNews.includes(NAME),'pinned under its new name: '+withNews.join(','));
 await checkList(member,'desktop',withNews);
 for(const room of ['social','gainers','whats-new'])await pin(member,'unpin',room);

 // 2. The quick switcher (Ctrl+K) lists it by name.
 await member.goto(`${base}/chat?room=social`);await visible(member,'textarea[aria-label="Message Social"]');await pause(500);
 await member.keyboard.down('Control');await member.keyboard.press('k');await member.keyboard.up('Control');
 await member.waitForSelector('dialog[open]');
 assert(await member.evaluate(name=>document.querySelector('dialog[open]').textContent.includes(name),NAME),'quick switcher shows '+NAME);
 await member.keyboard.press('Escape');

 // 3. Inside the room on both widths: title, description line, shown once, still read-only.
 for(const [view,size] of [['desktop-1280',desktop],['phone-390',phone]]){
  await member.setViewport(size);await member.goto(`${base}/chat?room=whats-new`);
  await visible(member,'[data-room-description]');
  await member.waitForFunction(()=>[...document.querySelectorAll('article[id^="chat-message-"]')].some(e=>e.checkVisibility()),{timeout:60000});await pause(500);
  const header=await member.evaluate(()=>{const h=[...document.querySelectorAll('header')].find(e=>e.checkVisibility()&&e.querySelector('h1'));
   const d=[...document.querySelectorAll('[data-room-description]')].filter(e=>e.checkVisibility());
   return {title:h.querySelector('h1').textContent,text:h.innerText,descriptions:d.length,description:d[0]?.textContent,inHeader:!!d[0]?.closest('header'),
    count:document.body.innerText.split('Chat Improvements').length-1};});
  assert.equal(header.title,NAME,view+': room title');
  assert.equal(header.descriptions,1,view+': one description line');
  assert.equal(header.description,DESCRIPTION,view+': exact description');
  assert(header.inHeader,view+': the description is under the title');
  assert(!/Admin posts only/.test(header.text),view+': no "Admin posts only" under the title: '+header.text);
  assert.equal(header.count,1,view+': the description shows only once on the page');
  assert.equal(await member.evaluate(()=>[...document.querySelectorAll('textarea[aria-label^="Message "]')].some(e=>e.checkVisibility())),false,view+': no message box');
  assert.match(await member.evaluate(()=>document.body.innerText),/Only admins can post/,view+': read-only footer');
  assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+': no horizontal page scroll');
 }
 const post=await api(member,'/api/chat',{action:'send',room:'whats-new',body:'member post'});
 assert.equal(post.status,403,'member cannot post');
 assert.match(post.data?.error??'',/What's New\?/,'the refusal names the room');
 assert.deepEqual(errors,[]);
 console.log("PASS What's New? desktop 1280 + phone 390: below pins and above Rooms (top when nothing is pinned), named What's New? in list, pins, quick switcher and header, exact description under the title shown once, no Admin posts only, members still can't post.");
}finally{await browser.close();}
