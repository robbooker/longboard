// Ticket #295: a search result opens its room (or thread) at that message, with the messages around
// it, a brief highlight, normal paging both ways and Jump to latest. Actual Next routes/components
// and synthetic SQL. CHAT_EXPECT_BASELINE=1 checks the published behaviour (results only preview).
// CHAT_SEARCH_SCREENS=<dir> saves desktop 1280 and phone 390 screenshots in light and dark.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.CHAT_TEST_URL||'http://localhost:3377',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54577';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const baseline=process.env.CHAT_EXPECT_BASELINE==='1',screens=process.env.CHAT_SEARCH_SCREENS||'';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);assert(text,body.sql);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,bob]}=await control('identity');
await sql("update profiles set role='admin' where id=$1",[alice.id]);
await sql("delete from longboard_chat_messages where body like 'SJ %'");
// Chronological inserts, so room positions follow time: 60 before, the target, 30 after, then 90 recent.
const create=async(body,{room='main',parent=null,minutes})=>(await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) values($1,$1,'Bob',$2,$3,$4,now()-($5||' minutes')::interval) returning *",[bob.member.id,body,room,parent,String(minutes)]))[0];
const day=24*60;let minute=20*day;
for(let n=0;n<60;n++)await create('SJ before '+n,{minutes:minute--});
const old=await create('SJ SJUMPOLD the earnings call went well',{minutes:minute--});
for(let n=0;n<30;n++)await create('SJ after '+n,{minutes:minute--});
const parent=await create('SJ thread parent about the Fed',{minutes:minute--});
const replies=[];for(let n=0;n<40;n++)replies.push(await create(n===25?'SJ SJUMPREPLY a reply deep in the thread':'SJ reply '+n,{parent:parent.id,minutes:minute--}));
const reply=replies[25];
const social=await create('SJ SJUMPSOCIAL over in Social',{room:'social',minutes:minute--});
for(let n=0;n<90;n++)await create('SJ social recent '+n,{room:'social',minutes:minute--});
// The newest messages in the room (the fixture's own rows are from today), seconds apart.
const recent=[];for(let n=0;n<90;n++)recent.push(await create('SJ recent '+n,{minutes:-(1+n/60)}));
await sql("insert into chat_room_reads(account_id,room_slug,through_seq) select $1,room_slug,max(unread_seq) from longboard_chat_messages group by room_slug on conflict(account_id,room_slug) do update set through_seq=excluded.through_seq",[alice.id]);

const browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const context=await browser.createBrowserContext(),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
await p.setViewport(desktop);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ready=async selector=>{await p.waitForSelector(selector,{visible:true});await p.waitForFunction(selector=>Object.keys(document.querySelector(selector)).some(k=>k.startsWith('__reactProps$')),{},selector);};
const pane='section[aria-label="Search chat"]',query=pane+' input',scope=pane+' select[aria-label="Search room"]',method=pane+' select[aria-label="Search method"]';
// From chat-ss-search: a phone conversation opens search from its Room info sheet.
const openSearch=async()=>{
 await p.waitForFunction(()=>[...document.querySelectorAll('button[aria-label="Search chat"],header[data-phone="true"] button[aria-label="Room info"]')].some(e=>e.getBoundingClientRect().width&&Object.keys(e).some(k=>k.startsWith('__reactProps$'))));
 for(let i=0;i<4&&!(await p.$(query+':not([hidden] *)'))?.boundingBox();i++){
  if(await p.$('header[data-phone="true"] button[aria-label="Room info"]')){
   const inRoom=()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('Search in')&&b.getBoundingClientRect().width);
   if(!await p.evaluate(inRoom)){await p.evaluate(()=>document.querySelector('header[data-phone="true"] button[aria-label="Room info"]').click());await p.waitForFunction(inRoom,{timeout:8000}).catch(()=>{});}
   await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Search in')&&b.getBoundingClientRect().width)?.click());
  }else await p.evaluate(()=>[...document.querySelectorAll('button[aria-label="Search chat"]')].find(e=>e.getBoundingClientRect().width)?.click());
  await p.waitForFunction(selector=>[...document.querySelectorAll(selector)].some(e=>e.getBoundingClientRect().width),{timeout:8000},query).catch(()=>{});
 }
 await p.waitForFunction(selector=>[...document.querySelectorAll(selector)].some(e=>e.getBoundingClientRect().width),{},query);
};
const visibleQuery=()=>p.evaluateHandle(selector=>[...document.querySelectorAll(selector)].find(e=>e.getBoundingClientRect().width),query);
const search=async(text,room='main')=>{
 await openSearch();const root=await p.evaluateHandle(selector=>[...document.querySelectorAll(selector)].find(e=>e.getBoundingClientRect().width),pane);
 await root.$eval('select[aria-label="Search method"]',e=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'keywords');e.dispatchEvent(new Event('change',{bubbles:true}));});
 await root.$eval('select[aria-label="Search room"]',(e,room)=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,room);e.dispatchEvent(new Event('change',{bubbles:true}));},room);
 const input=await visibleQuery();await input.evaluate((e,text)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,text);e.dispatchEvent(new Event('input',{bubbles:true}));},text);await input.evaluate(e=>e.form.requestSubmit());
 await p.waitForFunction((selector,text)=>[...document.querySelectorAll(selector)].some(s=>s.getBoundingClientRect().width&&s.querySelector('[aria-busy="false"]')&&[...s.querySelectorAll('article p')].some(n=>n.textContent.includes(text))),{},pane,text);
 return root;
};
const result=async(root,text)=>root.evaluateHandle((root,text)=>[...root.querySelectorAll('article')].find(a=>a.querySelector('p')?.textContent.includes(text)),text);
const row=id=>'#chat-message-'+id;
const roomList=()=>p.evaluateHandle(()=>[...document.querySelectorAll('[id^="chat-message-"]')].find(e=>e.getBoundingClientRect().width)?.parentElement);
// The target sits inside the list's visible area (centred by the scroll owner).
const inView=(selector)=>p.waitForFunction(selector=>{const e=document.querySelector(selector);if(!e||!e.getBoundingClientRect().height)return false;let s=e.parentElement;while(s&&!(s.scrollHeight>s.clientHeight&&/(auto|scroll)/.test(getComputedStyle(s).overflowY)))s=s.parentElement;if(!s)return false;const r=e.getBoundingClientRect(),c=s.getBoundingClientRect();return r.top>=c.top-1&&r.bottom<=c.bottom+1;},{timeout:15000},selector);
const highlighted=selector=>p.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('data-jump-highlight')==='true',{timeout:15000},selector);
const shot=async name=>{if(screens)await p.screenshot({path:`${screens}/${name}.png`});};
const theme=async value=>{await p.evaluate(value=>localStorage.setItem('longboard-public-chat-theme-v1',value),value);};
const noOverflow=async()=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal page scroll');

try{
 console.log('Browser',await browser.version());
 await p.goto(base+'/login?next=%2Fchat');await ready('#li-email');await p.reload({waitUntil:'domcontentloaded'});await ready('#li-email');await p.type('#li-email',alice.email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await ready('textarea[aria-label="Message LB"]');
 if(baseline){
  for(const [view,size] of [['desktop-1280',desktop],['phone-390',phone]])for(const mode of ['light','dark']){
   await p.setViewport(size);await theme(mode);await p.goto(base+'/chat?room=main');await ready('textarea[aria-label="Message LB"]');
   const root=await search('SJUMPOLD');await shot(`${view}-${mode}-1-results`);
   const card=await result(root,'SJUMPOLD');await card.$eval('p',e=>e.click());await pause(800);
   assert.equal(await p.$(row(old.id)+'[data-jump-highlight]'),null);assert(await root.evaluate(e=>e.getBoundingClientRect().width>0),'search stays open');
   await shot(`${view}-${mode}-2-after-click`);
   await card.evaluate(a=>[...a.querySelectorAll('button')].find(b=>b.textContent.includes('View conversation')).click());await p.waitForFunction(root=>root.querySelector('article[data-target="true"]'),{},root);await shot(`${view}-${mode}-3-view-conversation`);
  }
  console.log('REPRODUCED published baseline: clicking a search result does nothing; View conversation only previews it inside search.');
 }else{
  // 1-3, 5: an old room message opens around itself, centred and highlighted; paging and latest work.
  let root=await search('SJUMPOLD');await shot('desktop-1280-light-1-results');
  assert.equal(await (await result(root,'SJUMPOLD')).$$eval('button',b=>b.map(x=>x.textContent.trim()).join('|')),'View conversation →|Go to message');
  await (await result(root,'SJUMPOLD')).$eval('p',e=>e.click());
  await p.waitForFunction(selector=>!document.querySelector(selector)?.getBoundingClientRect().width,{},pane);
  await highlighted(row(old.id));await inView(row(old.id));
  const loaded=text=>p.evaluate(text=>[...document.querySelectorAll('[id^="chat-message-"] p')].some(e=>e.textContent===text),text);
  assert.equal(await loaded('SJ before 0'),false,'only a window around the target loads');
  for(const neighbour of ['SJ before 59','SJ after 0','SJ before 30','SJ after 29'])assert(await p.evaluate(text=>[...document.querySelectorAll('[id^="chat-message-"] p')].some(e=>e.textContent===text),neighbour),neighbour+' loads around the target');
  assert.equal(await p.$(row(recent.at(-1).id)),null,'the latest page is replaced by the window around the target');
  await shot('desktop-1280-light-2-jumped');
  const label=await p.$$eval('button',buttons=>buttons.filter(b=>b.getBoundingClientRect().width).map(b=>b.textContent.trim()));
  assert(label.includes('Earlier messages')&&label.includes('Newer messages'),'pages either way: '+label.filter(l=>/messages|latest/i.test(l)).join(', '));
  assert(label.some(l=>l.startsWith('Jump to latest')),'Jump to latest is offered');
  await p.waitForSelector(row(old.id)+'[data-jump-highlight]',{hidden:true,timeout:6000});
  const fade=await p.evaluate(()=>{const s=[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules];}catch{return [];}});return s.some(r=>r.cssText?.includes('data-jump-highlight')&&r.cssText.includes('animation'));});assert(fade,'the highlight fades by animation');
  // Scroll up normally: older messages load above.
  await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Earlier messages'&&b.getBoundingClientRect().width).click());
  await p.waitForFunction(()=>[...document.querySelectorAll('[id^="chat-message-"] p')].some(e=>e.textContent==='SJ before 0'),{timeout:15000});
  await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Jump to latest')&&b.getBoundingClientRect().width).click());
  await p.waitForSelector(row(recent.at(-1).id),{timeout:15000});await inView(row(recent.at(-1).id));
  console.log('PASS old message: search closes, room opens around it (a window of messages before/after), centred, highlighted then cleared, Earlier/Newer paging and Jump to latest returns to the newest message.');
  // Repeating the same result jumps again, also when it is already loaded.
  root=await search('SJUMPOLD');await (await result(root,'SJUMPOLD')).$eval('p',e=>e.click());await highlighted(row(old.id));await inView(row(old.id));
  root=await search('SJUMPOLD');await (await result(root,'SJUMPOLD')).$eval('p',e=>e.click());await highlighted(row(old.id));await inView(row(old.id));
  console.log('PASS repeated jumps to the same message (loaded and not loaded).');
  // 4: a reply opens its thread at the reply. Keyboard: the Go to message button.
  root=await search('SJUMPREPLY');const button=await (await result(root,'SJUMPREPLY')).evaluateHandle(a=>[...a.querySelectorAll('button')].find(b=>b.textContent.trim()==='Go to message'));
  await button.focus();await p.keyboard.press('Enter');
  const replyRow=`[data-thread-message-id="${reply.id}"]`;
  await p.waitForFunction(id=>document.querySelector('[aria-label="Original comment"]')?.getAttribute('data-thread-message-id')===id,{timeout:15000},parent.id);
  await highlighted(replyRow);await inView(replyRow);assert.equal(await p.$(replyRow+'[data-unread-start]'),null,'no unread divider for a search jump');
  assert.notEqual(await p.evaluate(()=>document.activeElement?.id),'thread-reply','the reply composer does not take focus');
  await shot('desktop-1280-light-3-reply');
  // With that thread open, a room-level result closes it and shows the room at the message.
  root=await search('SJUMPOLD');await (await result(root,'SJUMPOLD')).$eval('p',e=>e.click());
  await p.waitForSelector('[aria-label="Original comment"]',{hidden:true});await highlighted(row(old.id));await inView(row(old.id));
  console.log('PASS reply: its thread opens at the reply, highlighted, no unread divider or composer focus; a room result then closes the thread.');
  // A message in another room opens that room at the message.
  root=await search('SJUMPSOCIAL','lb-social');await (await result(root,'SJUMPSOCIAL')).$eval('p',e=>e.click());
  await ready('textarea[aria-label="Message Social"]');await highlighted(row(social.id));await inView(row(social.id));
  assert(await p.evaluate(()=>[...document.querySelectorAll('[id^="chat-message-"] p')].some(e=>e.textContent==='SJ social recent 0')));
  console.log('PASS another room: Social opens at the result with the messages after it.');
  // 6: phone, tap a result.
  await p.setViewport(phone);await p.goto(base+'/chat?room=main');await ready('textarea[aria-label="Message LB"]');
  root=await search('SJUMPOLD');await noOverflow();await shot('phone-390-light-1-results');
  const card=await result(root,'SJUMPOLD');const box=await (await card.$('p')).boundingBox();await p.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
  await highlighted(row(old.id));await inView(row(old.id));await noOverflow();await shot('phone-390-light-2-jumped');
  root=await search('SJUMPREPLY');const replyCard=await result(root,'SJUMPREPLY');const replyBox=await (await replyCard.$('p')).boundingBox();await p.touchscreen.tap(replyBox.x+replyBox.width/2,replyBox.y+replyBox.height/2);
  await highlighted(replyRow);await inView(replyRow);await noOverflow();await shot('phone-390-light-3-reply');
  console.log('PASS phone 390: tapping a room result and a reply result jumps the same way, no horizontal scroll.');
  if(screens)for(const [view,size] of [['desktop-1280',desktop],['phone-390',phone]]){
   await p.setViewport(size);await theme('dark');await p.goto(base+'/chat?room=main');await ready('textarea[aria-label="Message LB"]');
   root=await search('SJUMPOLD');await shot(`${view}-dark-1-results`);await (await result(root,'SJUMPOLD')).$eval('p',e=>e.click());await highlighted(row(old.id));await inView(row(old.id));await pause(150);await shot(`${view}-dark-2-jumped`);
   root=await search('SJUMPREPLY');await (await result(root,'SJUMPREPLY')).$eval('p',e=>e.click());await highlighted(replyRow);await inView(replyRow);await pause(150);await shot(`${view}-dark-3-reply`);
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS zero browser runtime errors.');
}catch(error){await p.screenshot({path:'/tmp/chat-search-jump-failure.png'}).catch(()=>{});console.error(await p.evaluate(()=>document.body.innerText.slice(-1500)).catch(()=>''));throw error;}finally{await browser.close();}
