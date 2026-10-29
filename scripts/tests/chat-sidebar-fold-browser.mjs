// D-324 "Minimize groups in the left column", against the shared fixture on this test's own ports
// (localhost:3324, database 127.0.0.1:54524). Synthetic data only. As Alice, on a computer and a phone:
//  - every group heading (Pinned, Rooms, Announcements, Recordings, Pages, Direct messages) is a button
//    with aria-expanded and starts unfolded;
//  - folding Announcements leaves only its heading (LB and SS rows gone), by mouse and by keyboard;
//  - a folded group's heading shows the group's unread total, which rises on a new message and falls
//    once the room is read, and an @ mark for an unread mention inside;
//  - folding the groups above the DMs moves the Direct messages heading up;
//  - folds survive a reload and are per person (Bob's list on the same machine stays open).
// FOLD_SHOTS=<dir> saves screenshots.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3324',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54524';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.FOLD_SHOTS;
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[],broadcast)=>control('sql',{sql:text,args,broadcast});
const {people:[alice,bob]}=await control('identity');
// Only admins post in Announcements; Bob posts there in this test, so he is one here.
await sql("update profiles set role='admin' where id=$1 returning id",[bob.id]);
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const shot=async(p,name)=>{if(shots){await pause(500);await p.screenshot({path:`${shots}/${name}.png`});}};
const fold=group=>`#chat-room-navigation [data-sidebar-fold="${group}"]`;
const roomRow=room=>`#chat-room-navigation a[href^="/chat?room=${room}"]`;
const refresh=p=>p.evaluate(()=>window.dispatchEvent(new Event('chat-activity-refresh')));
const visibleCount=(p,sel)=>p.$$eval(sel,es=>es.filter(e=>e.checkVisibility()).length);
const expanded=(p,group)=>p.$eval(fold(group),e=>e.getAttribute('aria-expanded'));
const top=(p,sel)=>p.$eval(sel,e=>e.getBoundingClientRect().top);
const say=(room,body)=>sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Bob',$2,$3) returning *",[bob.member.id,body,room],'longboard_chat_messages');
async function setFold(p,group,folded){
 if((await expanded(p,group))!==String(!folded))await p.click(fold(group));
 await p.waitForFunction((sel,v)=>document.querySelector(sel)?.getAttribute('aria-expanded')===v,{},fold(group),String(!folded));
}
// The folded heading's unread total (0 when none is shown) and whether the @ mark shows.
const totals=(p,group)=>p.$eval(fold(group),e=>({unread:Number(e.querySelector('[data-fold-unread]')?.getAttribute('data-fold-unread')??0),mention:!!e.querySelector('[data-fold-mention]')}));
async function waitTotal(p,group,check,label){
 for(let i=0;i<80;i++){const t=await totals(p,group);if(check(t))return t;if(i%10===9)await refresh(p);await pause(250);}
 assert.fail(`${label}: ${JSON.stringify(await totals(p,group))}`);
}
async function openList(p,view,room='social'){
 if(view==='phone'){
  await p.goto(`${base}/chat`);await p.waitForSelector(fold('rooms'),{visible:true,timeout:60000});
 }else{await p.goto(`${base}/chat?room=${room}`);await p.waitForSelector(fold('rooms'),{visible:true,timeout:60000});}
 await pause(600);
}

try{
 console.log('Browser',await browser.version());
 const context=await browser.createBrowserContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(60000);
 await page.setViewport(desktop);
 await signIn(page,base,alice.email,{next:'/chat?room=main',composer:'textarea[aria-label="Message LB"]'});
 // A pin, so the Pinned heading is in the list too.
 assert.equal((await page.evaluate(async()=>(await fetch('/api/chat/pins',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'pin',target:{kind:'room',room:'gainers'}})})).status)),200);
 await openList(page,'desktop','main');
 const groups=await page.$$eval('#chat-room-navigation [data-sidebar-fold]',es=>es.filter(e=>e.checkVisibility()).map(e=>e.getAttribute('data-sidebar-fold')));
 for(const group of ['pinned','rooms','announcements','recordings','dms'])assert(groups.includes(group),`a fold button for ${group}: ${groups}`);
 for(const group of groups){
  assert.equal(await expanded(page,group),'true',`${group} starts unfolded`);
  assert.equal(await page.$eval(fold(group),e=>e.tagName+':'+e.type),'BUTTON:button');
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await shot(page,'after-desktop');

 // 1. Fold Announcements: only the heading stays. Keyboard (Enter) folds and unfolds as well.
 assert(await visibleCount(page,roomRow('lb-announcements'))>0,'LB announcements row before folding');
 await page.focus(fold('announcements'));await page.keyboard.press('Enter');
 await page.waitForFunction(sel=>document.querySelector(sel).getAttribute('aria-expanded')==='false',{},fold('announcements'));
 for(const room of ['lb-announcements','ss-announcements'])assert.equal(await visibleCount(page,roomRow(room)),0,`${room} hidden while folded`);
 assert.equal(await page.$eval(fold('announcements')+' [class*="name"]',e=>e.textContent),'Announcements');
 await page.keyboard.press(' ');await page.waitForFunction(sel=>document.querySelector(sel).getAttribute('aria-expanded')==='true',{},fold('announcements'));
 assert(await visibleCount(page,roomRow('lb-announcements'))>0,'rows back after unfolding');
 await setFold(page,'announcements',true);

 // 2. The folded total rises with a new message and falls once read.
 const before=(await totals(page,'announcements')).unread;
 await say('lb-announcements','Fold test bulletin one');
 const one=await waitTotal(page,'announcements',t=>t.unread===before+1,'total rises by one');
 await say('lb-announcements','Fold test bulletin two');
 await waitTotal(page,'announcements',t=>t.unread===one.unread+1,'total rises by two');
 await shot(page,'after-desktop-folded');
 // Reading it (opening the room through its link) brings the total down to 0.
 await page.goto(`${base}/chat?room=lb-announcements`);await page.waitForSelector(fold('announcements'),{visible:true});
 assert.equal(await expanded(page,'announcements'),'false','still folded when the folded room is the open one');
 await waitTotal(page,'announcements',t=>t.unread===0,'total falls once read');

 // 3. An unread @mention inside a folded group shows the @ mark; reading it clears the mark.
 await page.goto(`${base}/chat?room=gainers`);await page.waitForSelector(fold('rooms'),{visible:true});
 await setFold(page,'rooms',true);
 assert.equal(await visibleCount(page,roomRow('main')),0,'LB hidden while Rooms is folded');
 await say('social','@Alice a mention while Rooms is folded');
 const mentioned=await waitTotal(page,'rooms',t=>t.mention&&t.unread>0,'mention mark and total on Rooms');
 const activity=await page.evaluate(async()=>(await fetch('/api/chat/activity?why=test')).json());
 assert.equal(mentioned.unread,['main','social','shortscout','gainers','developers'].reduce((n,r)=>n+(activity.roomMessageCounts[r]??0),0),'Rooms total is the sum of its rooms');
 // Reading the room clears its count and the mark (the bell's own entry stays for the bell).
 await page.goto(`${base}/chat?room=social`);await page.waitForSelector(fold('rooms'),{visible:true});
 assert.equal(await expanded(page,'rooms'),'false');
 await waitTotal(page,'rooms',t=>!t.mention&&t.unread===mentioned.unread-activity.roomMessageCounts.social,'mark and count go once read');
 await page.goto(`${base}/chat?room=gainers`);await page.waitForSelector(fold('rooms'),{visible:true});
 // The Pinned heading adds up its pins the same way.
 await setFold(page,'pinned',true);assert.equal(await visibleCount(page,'[aria-label="Open pinned Gainers"]'),0,'pins hidden');

 // 4. Folding groups above the DMs moves Direct messages up.
 await setFold(page,'rooms',false);await setFold(page,'pinned',false);await setFold(page,'announcements',false);
 const dmsOpen=await top(page,fold('dms'));
 for(const group of ['pinned','rooms','announcements','recordings'])await setFold(page,group,true);
 if(groups.includes('pages'))await setFold(page,'pages',true);
 const dmsFolded=await top(page,fold('dms'));
 assert(dmsFolded<dmsOpen-100,`Direct messages moved up (${dmsOpen} → ${dmsFolded})`);
 await shot(page,'after-desktop-several-folded');

 // 5. Folds stay after a reload.
 await page.reload();await page.waitForSelector(fold('rooms'),{visible:true});await pause(500);
 for(const group of ['pinned','rooms','announcements','recordings'])assert.equal(await expanded(page,group),'false',`${group} still folded after reload`);
 assert.equal(await visibleCount(page,roomRow('main')),0,'LB still hidden after reload');
 // The DM list folds too, and opens again.
 await setFold(page,'dms',true);assert.equal(await page.$('#chat-room-navigation aside[aria-label="Private conversations"] h3'),null,'DM rows hidden');
 await setFold(page,'dms',false);

 // 6. Each person's own: Bob signed in on the same machine starts with everything open.
 const other=await browser.createBrowserContext(),bobPage=await other.newPage();bobPage.on('pageerror',e=>errors.push(e.message));await bobPage.setViewport(desktop);
 await signIn(bobPage,base,bob.email,{next:'/chat?room=main',composer:'textarea[aria-label="Message LB"]'});await bobPage.waitForSelector(fold('rooms'),{visible:true});
 assert.equal(await expanded(bobPage,'rooms'),'true');await other.close();
 const stored=await page.evaluate(id=>localStorage.getItem('longboard-chat-sidebar-folds:v1:'+id),alice.member.id);
 assert(stored&&JSON.parse(stored).includes('rooms'),'kept on this device under Alice: '+stored);

 // 7. A phone: the same controls on the phone's list, folded state shared, saved across a reload.
 for(const group of ['pinned','rooms','announcements','recordings','pages'])if(groups.includes(group))await setFold(page,group,false);
 await page.setViewport(phone);await openList(page,'phone');
 await shot(page,'after-phone');
 await setFold(page,'announcements',true);
 for(const room of ['lb-announcements','ss-announcements'])assert.equal(await visibleCount(page,roomRow(room)),0,`${room} hidden on a phone`);
 await say('lb-announcements','Phone fold bulletin');
 await waitTotal(page,'announcements',t=>t.unread>=1&&!t.mention,'phone total (an announcement is no personal mention)');
 assert(await page.$eval(fold('announcements'),e=>e.getBoundingClientRect().height>=44),'a full-size tap target on a phone');
 await shot(page,'after-phone-folded');
 const phoneDmsOpen=await top(page,fold('dms'));
 for(const group of ['pinned','rooms','recordings'])await setFold(page,group,true);
 if(groups.includes('pages'))await setFold(page,'pages',true);
 assert(await top(page,fold('dms'))<phoneDmsOpen-100,'Direct messages moved up on a phone');
 await shot(page,'after-phone-several-folded');
 await openList(page,'phone');
 for(const group of ['rooms','announcements','recordings'])assert.equal(await expanded(page,group),'false',`${group} folded after a phone reload`);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no sideways scroll on a phone');
 for(const group of groups)await setFold(page,group,false);

 assert.deepEqual(errors,[]);await context.close();
 console.log('PASS sidebar fold: every heading folds (mouse and keyboard), folded rows hidden, folded totals rise and fall, @ mark, DMs move up, reload keeps folds, per person, desktop and phone.');
}finally{await browser.close();}
