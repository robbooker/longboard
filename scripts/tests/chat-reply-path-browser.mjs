// Ticket #296: a reply opened from search or a bell alert (#chat-message-<id>) opens with its whole
// conversation behind it. Back steps up one level at a time, and from the top level returns to the
// room at the original message, as when browsing there. Desktop 1280 and phone 390.
// CHAT_EXPECT_BASELINE=1 checks the published behaviour (one level only, Back goes to the room).
// CHAT_PATH_SCREENS=<dir> saves screenshots.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.CHAT_TEST_URL||'http://localhost:3378',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54578';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const baseline=process.env.CHAT_EXPECT_BASELINE==='1',screens=process.env.CHAT_PATH_SCREENS||'';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,bob]}=await control('identity');
await sql("update profiles set role='admin' where id=$1",[alice.id]);
await sql("delete from longboard_chat_messages where body like 'RP %'");
const create=async(body,{parent=null,minutes})=>(await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) values($1,$1,'Bob',$2,'main',$3,now()-($4||' minutes')::interval) returning *",[bob.member.id,body,parent,String(minutes)]))[0];
// An old room message three replies deep, buried under newer room messages.
let minute=10*24*60;
for(let n=0;n<40;n++)await create('RP before '+n,{minutes:minute--});
const root=await create('RP root message about rates',{minutes:minute--});
const one=await create('RP first reply',{parent:root.id,minutes:minute--});
for(let n=0;n<3;n++)await create('RP side reply '+n,{parent:root.id,minutes:minute--});
const two=await create('RP second level reply',{parent:one.id,minutes:minute--});
const three=await create('RP RPATHDEEP the deepest reply',{parent:two.id,minutes:minute--});
for(let n=0;n<120;n++)await create('RP recent '+n,{minutes:-(1+n/60)});
await sql("insert into chat_room_reads(account_id,room_slug,through_seq) select $1,room_slug,max(unread_seq) from longboard_chat_messages group by room_slug on conflict(account_id,room_slug) do update set through_seq=excluded.through_seq",[alice.id]);

const browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const p=await (await browser.createBrowserContext()).newPage();p.on('pageerror',e=>errors.push(e.message));
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const ready=async selector=>{await p.waitForSelector(selector,{visible:true});await p.waitForFunction(selector=>Object.keys(document.querySelector(selector)).some(k=>k.startsWith('__reactProps$')),{},selector);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const shot=async name=>{if(screens)await p.screenshot({path:`${screens}/${name}.png`});};
const pane='section[aria-label="Search chat"]',query=pane+' input';
const openSearch=async()=>{
 for(let i=0;i<4&&!await p.evaluate(q=>[...document.querySelectorAll(q)].some(e=>e.getBoundingClientRect().width),query);i++){
  if(await p.$('header[data-phone="true"] button[aria-label="Room info"]')){
   const inRoom=()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('Search in')&&b.getBoundingClientRect().width);
   if(!await p.evaluate(inRoom)){await p.evaluate(()=>document.querySelector('header[data-phone="true"] button[aria-label="Room info"]').click());await p.waitForFunction(inRoom,{timeout:8000}).catch(()=>{});}
   await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Search in')&&b.getBoundingClientRect().width)?.click());
  }else await p.evaluate(()=>[...document.querySelectorAll('button[aria-label="Search chat"]')].find(e=>e.getBoundingClientRect().width)?.click());
  await p.waitForFunction(q=>[...document.querySelectorAll(q)].some(e=>e.getBoundingClientRect().width),{timeout:8000},query).catch(()=>{});
 }
};
const searchAndOpen=async text=>{
 await openSearch();const box=await p.evaluateHandle(s=>[...document.querySelectorAll(s)].find(e=>e.getBoundingClientRect().width),pane);
 await box.$eval('select[aria-label="Search method"]',e=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'keywords');e.dispatchEvent(new Event('change',{bubbles:true}));});
 await box.$eval('input',(e,text)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,text);e.dispatchEvent(new Event('input',{bubbles:true}));e.form.requestSubmit();},text);
 await p.waitForFunction((s,text)=>[...document.querySelectorAll(s+' article p')].some(n=>n.getBoundingClientRect().width&&n.textContent.includes(text)),{},pane,text);
 await p.evaluate((s,text)=>[...document.querySelectorAll(s+' article p')].find(n=>n.getBoundingClientRect().width&&n.textContent.includes(text)).click(),pane,text);
};
const original=()=>p.evaluate(()=>[...document.querySelectorAll('[aria-label="Original comment"]')].find(e=>e.getBoundingClientRect().width)?.getAttribute('data-thread-message-id')??null);
const backButton=()=>p.evaluate(()=>{const b=[...document.querySelectorAll('button[aria-label="Back to previous comment"],button[aria-label="Back to chat"]')].find(e=>e.getBoundingClientRect().width);return b?{label:b.getAttribute('aria-label'),text:b.textContent.trim()}:null;});
const showing=async id=>{await p.waitForFunction(id=>[...document.querySelectorAll('[aria-label="Original comment"]')].some(e=>e.getBoundingClientRect().width&&e.getAttribute('data-thread-message-id')===id),{timeout:15000},id);};
const back=async()=>{await p.evaluate(()=>[...document.querySelectorAll('button[aria-label="Back to previous comment"],button[aria-label="Back to chat"]')].find(e=>e.getBoundingClientRect().width).click());};
const inRoom=async id=>{
 await p.waitForFunction(()=>![...document.querySelectorAll('[aria-label="Original comment"]')].some(e=>e.getBoundingClientRect().width),{timeout:15000});
 await p.waitForFunction(id=>{const e=document.getElementById('chat-message-'+id);if(!e||!e.getBoundingClientRect().height)return false;let s=e.parentElement;while(s&&!(s.scrollHeight>s.clientHeight&&/(auto|scroll)/.test(getComputedStyle(s).overflowY)))s=s.parentElement;if(!s)return false;const r=e.getBoundingClientRect(),c=s.getBoundingClientRect();return r.top>=c.top-1&&r.bottom<=c.bottom+1;},{timeout:15000},id);
};
// Walks the chain from the deepest reply back to the room.
const walk=async view=>{
 await showing(two.id);await p.waitForSelector(`[data-thread-message-id="${three.id}"][data-jump-highlight="true"]`,{timeout:15000});
 assert.deepEqual(await backButton(),{label:'Back to previous comment',text:'← Back'},view+': the deepest reply shows Back');await shot(view+'-1-deep');
 await back();await showing(one.id);
 assert.deepEqual(await backButton(),{label:'Back to previous comment',text:'← Back'},view+': the first reply level shows Back');await shot(view+'-2-up-one');
 await back();await showing(root.id);
 // The top level: ← Chat on a phone; on desktop the room is beside the panel and × closes it.
 if(view.startsWith('phone')){assert.deepEqual(await backButton(),{label:'Back to chat',text:'← Chat'},view+': the top level shows Chat');await shot(view+'-3-top');await back();}
 else{assert.equal(await backButton(),null,view+': the top level closes with ×');await shot(view+'-3-top');await p.click('button[aria-label="Close replies"]');}
 await inRoom(root.id);await shot(view+'-4-room');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal page scroll');
};

try{
 console.log('Browser',await browser.version());
 await p.setViewport(desktop);
 await p.goto(base+'/login?next=%2Fchat');await ready('#li-email');await p.reload({waitUntil:'domcontentloaded'});await ready('#li-email');await p.type('#li-email',alice.email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await ready('textarea[aria-label="Message LB"]');
 if(baseline){
  await searchAndOpen('RPATHDEEP');await showing(two.id);await pause(1000);
  assert.equal(await backButton(),null,'desktop: no back arrow on a deep reply');await shot('desktop-1280-baseline-1-deep');
  await p.setViewport(phone);await p.goto(base+'/chat?room=main');await ready('textarea[aria-label="Message LB"]');
  await searchAndOpen('RPATHDEEP');await showing(two.id);await pause(1000);
  assert.deepEqual(await backButton(),{label:'Back to chat',text:'← Chat'});await shot('phone-390-baseline-1-deep');
  await back();await p.waitForFunction(()=>![...document.querySelectorAll('[aria-label="Original comment"]')].some(e=>e.getBoundingClientRect().width),{timeout:15000});
  assert.equal(await original(),null);await pause(500);await shot('phone-390-baseline-2-after-back');
  console.log('REPRODUCED published baseline: a deep reply from search opens one level only, with no Back on desktop; on a phone ← Chat leaves the conversation at once.');
 }else{
  for(const [view,size] of [['desktop-1280',desktop],['phone-390',phone]]){
   await p.setViewport(size);await p.goto(base+'/chat?room=main');await ready('textarea[aria-label="Message LB"]');
   await searchAndOpen('RPATHDEEP');await walk(view+'-search');
   console.log(`PASS ${view} search: deep reply shows Back, steps up two levels, then Chat returns to the room at the original message.`);
   // A bell alert opens /chat?room=<room>#chat-message-<id>.
   await p.goto('about:blank');await p.goto(`${base}/chat?room=main#chat-message-${three.id}`);
   await walk(view+'-bell');
   console.log(`PASS ${view} bell link: the same chain and return.`);
  }
  // A top-level result still opens in the room, as before.
  await p.setViewport(desktop);await p.goto(base+'/chat?room=main');await ready('textarea[aria-label="Message LB"]');
  await searchAndOpen('RP root message');await inRoom(root.id);assert.equal(await original(),null);
  console.log('PASS a room message from search still opens in the room with no thread.');
 }
 assert.deepEqual(errors,[]);console.log('PASS zero browser runtime errors.');
}catch(error){await p.screenshot({path:'/tmp/chat-reply-path-failure.png'}).catch(()=>{});console.error(await p.evaluate(()=>document.body.innerText.slice(-1500)).catch(()=>''));throw error;}finally{await browser.close();}
