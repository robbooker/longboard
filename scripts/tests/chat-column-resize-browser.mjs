// D-353 "Resizable chat columns", against the search-jump fixture on this test's own ports
// (localhost:3363, database 127.0.0.1:54563). Synthetic data only. As Alice:
//  - dragging either divider changes the two columns beside it, and each column stops at its minimum;
//  - the dividers work from the keyboard and announce their values;
//  - widths survive a reload with no flash and no hydration complaint; bad or blocked storage means defaults;
//  - a bigger window grows only the middle; a narrow one shrinks columns so all three stay in view;
//  - a drag leaves the composer's focus and draft and the reader's scroll position alone;
//  - a tablet held upright and a phone keep today's layout, with no dividers.
// COLUMN_SHOTS=<dir> saves screenshots; COLUMN_BEFORE=1 only saves screenshots (for the code before the change).
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3363',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54563';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.COLUMN_SHOTS,before=process.env.COLUMN_BEFORE==='1',prefix=before?'before':'after';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const {people:[alice,bob]}=await control('identity');
const LONG='Bartholomew Featherstonehaug'; // Names are at most 28 characters.
await sql("update longboard_chat_members set display_name=$1 where id=$2 returning id",[LONG,bob.member.id]);
const say=async(body,{parent=null,minutes=0,label='Bob'}={})=>(await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) values($1,$1,$2,$3,'main',$4,now()-($5||' minutes')::interval) returning *",[bob.member.id,label,body,parent,String(minutes)]))[0];
for(let n=0;n<40;n++)await say(`Column test message ${n}. `+'Some longer words so that the line wraps when the column gets narrower. '.repeat(3),{minutes:300-n});
const root=await say('The message with replies',{minutes:100});
const reply=await say('A reply from someone with a long name',{parent:root.id,minutes:99,label:LONG});
for(let n=0;n<30;n++)await say(`Later message ${n}. `+'Some longer words so that the line wraps when the column gets narrower. '.repeat(3),{minutes:60-n});

const KEY='chat-column-widths-v1',left='[data-chat-column-handle="left"]',right='[data-chat-column-handle="right"]';
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const shot=async(p,name)=>{if(shots){await pause(400);await p.screenshot({path:`${shots}/${prefix}-${name}.png`});}};
const near=(a,b,message,tolerance=1.5)=>assert(Math.abs(a-b)<=tolerance,`${message}: ${a} vs ${b}`);
// The three columns as drawn, and whether anything hangs off the shell.
const columns=p=>p.evaluate(()=>{
 const box=e=>{const r=e?.getBoundingClientRect();return r&&r.width?{x:r.left,w:r.width,end:r.right}:null;};
 const visible=q=>[...document.querySelectorAll(q)].find(e=>e.checkVisibility());
 const shell=document.querySelector('main[data-chat-view] > div');
 return {left:box(document.getElementById('chat-room-navigation')),middle:box(visible('section[aria-label$="Chat"]')),right:box(visible('aside[aria-label="Comment replies"]')),shell:box(shell),overflow:shell.scrollWidth-shell.clientWidth};
});
const handleAt=async(p,sel)=>{const b=await(await p.$(sel)).boundingBox();assert(b,sel+' is shown');return {x:b.x+b.width/2,y:b.y+b.height/2};};
async function drag(p,sel,dx){
 const c=await handleAt(p,sel);await p.mouse.move(c.x,c.y);await p.mouse.down();
 for(let i=1;i<=4;i++){await p.mouse.move(c.x+dx*i/4,c.y);await pause(25);}
 await p.mouse.up();await pause(60);
}
const composer='textarea[aria-label="Message LB"]';
// A reload brings open replies back, so close them: every step starts from the room.
const openRoom=async p=>{
 await p.goto(`${base}/chat?room=main`);await p.waitForSelector(composer,{visible:true});await pause(500);
 if(await p.$('aside[aria-label="Comment replies"]')){await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('aside[aria-label="Comment replies"]'));await pause(200);}
};
const openThread=async p=>{
 await p.waitForSelector(`#chat-message-${root.id}`);
 await p.$eval(`#chat-message-${root.id}`,e=>{const b=[...e.querySelectorAll('button')].find(b=>/repl/i.test(b.textContent));if(!b)throw new Error('no reply button');b.scrollIntoView();b.click();});
 await p.waitForFunction(()=>[...document.querySelectorAll('aside[aria-label="Comment replies"]')].some(e=>e.checkVisibility()&&e.getAttribute('aria-busy')!=='true'));
 await p.waitForFunction(id=>document.querySelector(`[data-thread-message-id="${id}"]`),{},reply.id);
 await pause(300);
};
const setTheme=async(context,p,theme)=>{await context.setCookie({name:'longboard-chat-theme',value:theme,domain:'localhost',path:'/chat'});await p.evaluate(t=>localStorage.setItem('longboard-public-chat-theme-v1',t),theme);};
const scroller=p=>p.evaluateHandle(id=>{let s=document.getElementById('chat-message-'+id).parentElement;while(s&&!(s.scrollHeight>s.clientHeight+40&&getComputedStyle(s).overflowY!=='visible'))s=s.parentElement;return s;},root.id);

try{
 console.log('Browser',await browser.version());
 const context=await browser.createBrowserContext(),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/hydrat|did not match/i.test(m.text()))errors.push(m.text());});
 page.setDefaultTimeout(60000);await page.setViewport(desktop);
 await signIn(page,base,alice.email,{next:'/chat?room=main',composer});

 for(const theme of ['light','dark']){
  await setTheme(context,page,theme);await openRoom(page);assert.equal(await page.$eval('main[data-chat-view]',e=>e.dataset.theme),theme);await openThread(page);await shot(page,`desktop-${theme}-default`);
 }
 if(before){
  const ph=await(await browser.createBrowserContext()).newPage();await ph.setViewport(phone);
  await signIn(ph,base,alice.email,{next:'/chat?room=main',composer});await openRoom(ph);await shot(ph,'phone-room');await openThread(ph);await shot(ph,'phone-replies');
  console.log('before screenshots saved');
  await browser.close();process.exit(0);
 }
 await setTheme(context,page,'light');await openRoom(page);

 // Today's widths with nothing saved: 240 with replies closed, 220 and 350 with them open.
 let c=await columns(page);near(c.left.w,240,'default rooms column, replies closed');assert.equal(await page.$(right),null,'no replies divider with replies closed');
 await openThread(page);c=await columns(page);near(c.left.w,220,'default rooms column');near(c.right.w,350,'default replies column');

 // The divider says it can be dragged, and says so to a screen reader.
 const lh=await handleAt(page,right);await page.mouse.move(lh.x,lh.y);await pause(250);
 const look=await page.$eval(right,e=>({cursor:getComputedStyle(e).cursor,line:getComputedStyle(e,'::after').backgroundColor}));
 assert.equal(look.cursor,'col-resize');assert.notEqual(look.line,'rgba(0, 0, 0, 0)','the line shows on hover');
 await shot(page,'desktop-light-hover');await page.mouse.move(640,450);
 const aria=await page.$eval(right,e=>Object.fromEntries(['role','aria-orientation','aria-valuenow','aria-valuemin','aria-valuemax','tabindex','aria-label'].map(a=>[a,e.getAttribute(a)])));
 assert.equal(aria.role,'separator');assert.equal(aria['aria-orientation'],'vertical');assert.equal(aria['aria-valuenow'],'350');assert.equal(aria['aria-valuemin'],'300');assert.equal(aria.tabindex,'0');assert(aria['aria-label']);

 // Dragging: focus, draft, the room's messages and its scroll are left alone.
 await page.type(composer,'a draft in progress');
 const list=await scroller(page);
 const gapOf=()=>list.evaluate(s=>s.scrollHeight-s.scrollTop-s.clientHeight);
 for(let i=0;i<8;i++){await list.evaluate(s=>{s.scrollTop=s.scrollHeight;});await pause(250);if(await gapOf()<=2)break;}
 assert(await gapOf()<=2,'the list reaches its newest message before the drag: '+await gapOf());
 await page.evaluate(id=>{window.__mutations=0;const list=document.getElementById('chat-message-'+id).parentElement;new MutationObserver(r=>{window.__mutations+=r.length;}).observe(list,{childList:true,subtree:true,attributes:true,characterData:true});},root.id);
 const beforeDrag=await columns(page);
 await drag(page,right,-140);c=await columns(page);
 near(c.right.w,490,'dragged replies wider');near(c.middle.w,beforeDrag.middle.w-140,'the middle gave up the room');near(c.left.w,beforeDrag.left.w,'the rooms column stayed');
 assert.equal(await page.$eval(composer,e=>e.value),'a draft in progress');assert.equal(await page.evaluate(q=>document.activeElement===document.querySelector(q),composer),true,'the composer keeps focus');
 await pause(300);assert((await gapOf())<=4,'still at the newest message: '+await gapOf());
 assert.equal(await page.evaluate(()=>window.__mutations),0,'a drag changes nothing in the message list');
 assert(await page.$eval(`[data-thread-message-id="${reply.id}"]`,(e,long)=>e.textContent.includes(long),LONG),'the long name is in the replies');
 await shot(page,'desktop-light-dragged');

 // Reading older messages: the same one stays near the top.
 await list.evaluate((s,id)=>{const row=document.getElementById('chat-message-'+id);s.scrollTop+=row.getBoundingClientRect().top-s.getBoundingClientRect().top-100;},root.id);await pause(400);
 const rowTop=()=>page.$eval(`#chat-message-${root.id}`,e=>e.getBoundingClientRect().top);
 const top0=await rowTop();await drag(page,right,60);near(await rowTop(),top0,'the row being read stays put',6);

 await drag(page,left,50);c=await columns(page);near(c.left.w,270,'dragged rooms wider');

 // Minimums and the middle's limit.
 await drag(page,left,-500);c=await columns(page);near(c.left.w,160,'rooms minimum');
 await drag(page,right,600);c=await columns(page);near(c.right.w,300,'replies minimum');
 await shot(page,'desktop-light-minimums');
 await drag(page,right,-900);c=await columns(page);near(c.right.w,640,'replies maximum');
 await drag(page,left,900);c=await columns(page);near(c.middle.w,360,'chat minimum');
 await drag(page,right,600);await drag(page,left,900);c=await columns(page);near(c.left.w,420,'rooms maximum');assert(c.middle.w>=359);

 // Keyboard.
 await drag(page,left,-400);await drag(page,left,40);await drag(page,right,100);
 const now=sel=>page.$eval(sel,e=>Number(e.getAttribute('aria-valuenow')));
 await page.focus(left);let v=await now(left);await page.keyboard.press('ArrowRight');assert.equal(await now(left),v+16,'arrow moves the divider');
 await page.keyboard.press('ArrowLeft');assert.equal(await now(left),v);
 await page.keyboard.press('Home');assert.equal(await now(left),160,'Home goes to the minimum');
 await page.keyboard.press('End');assert.equal(await now(left),await page.$eval(left,e=>Number(e.getAttribute('aria-valuemax'))),'End goes to the maximum');
 await page.keyboard.press('Home');
 await page.focus(right);v=await now(right);await page.keyboard.press('ArrowLeft');assert.equal(await now(right),v+16,'moving this divider left widens replies');
 await shot(page,'desktop-light-focus');
 await page.$eval(composer,e=>e.focus());

 // Remembered, with no flash and no hydration complaint.
 const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);assert.equal(saved.left,160);assert.equal(saved.right,await now(right));
 await page.evaluateOnNewDocument(()=>{new MutationObserver((_,o)=>{const shell=document.querySelector('main[data-chat-view] > div');if(shell&&!window.__firstTracks){window.__firstTracks=getComputedStyle(shell).gridTemplateColumns;o.disconnect();}}).observe(document,{childList:true,subtree:true});});
 await openRoom(page);
 const first=await page.evaluate(()=>window.__firstTracks);console.log('first drawing:',first);
 near(parseFloat(first),saved.left,'the first drawing already has the saved width');
 c=await columns(page);near(c.left.w,saved.left,'rooms width after reload');
 await openThread(page);c=await columns(page);near(c.right.w,saved.right,'replies width after reload');

 // Dark, after a drag.
 await page.evaluate((k,val)=>localStorage.setItem(k,val),KEY,JSON.stringify({left:280,right:500}));
 await setTheme(context,page,'dark');await openRoom(page);await openThread(page);await shot(page,'desktop-dark-dragged');await setTheme(context,page,'light');

 // Window size: bigger grows only the middle, narrow keeps everything in view, and back again.
 await page.setViewport({...desktop,width:1600});await pause(200);c=await columns(page);
 near(c.left.w,280,'rooms stay on a bigger window');near(c.right.w,500,'replies stay on a bigger window');near(c.middle.w,1600-40-2-780,'middle takes the rest',2);
 await page.evaluate((k,val)=>localStorage.setItem(k,val),KEY,JSON.stringify({left:420,right:640}));
 await page.setViewport({...desktop,width:1100});await openRoom(page);await openThread(page);c=await columns(page);
 assert(c.left.w>=160&&c.right.w>=300&&c.middle.w>=359,'nothing under its minimum: '+JSON.stringify(c));assert(c.right.end<=1100,'replies end inside the window');assert(c.overflow<=0,'nothing hangs off');
 await shot(page,'desktop-light-narrow-window');
 // A drag at that squeezed size stays inside the window too.
 await drag(page,left,40);c=await columns(page);assert(c.right.end<=1100&&c.middle.w>=359,'a squeezed drag fits: '+JSON.stringify(c));
 await page.evaluate((k,val)=>localStorage.setItem(k,val),KEY,JSON.stringify({left:300,right:400}));
 await page.setViewport(desktop);await openRoom(page);await openThread(page);
 await page.setViewport({...desktop,width:1100});await pause(200);await page.setViewport(desktop);await pause(200);c=await columns(page);near(c.left.w,300,'chosen rooms width back');near(c.right.w,400,'chosen replies width back');

 // Replies closed: no divider for them, and the left one still works.
 await page.keyboard.press('Escape');
 await page.waitForFunction(q=>!document.querySelector(q),{},right);c=await columns(page);near(c.left.w,300,'rooms width with replies closed');assert.equal(c.right,null);near(c.middle.end,c.shell.end,'the middle fills the rest',2);
 await drag(page,left,-40);c=await columns(page);near(c.left.w,260,'dragging with replies closed');

 // Bad saved values fall back to today's widths.
 for(const bad of ['not json','null','42','{"left":-5,"right":99999}','{"left":"300","right":null}','{"left":1e999}']){
  await page.evaluate((k,val)=>localStorage.setItem(k,val),KEY,bad);await openRoom(page);c=await columns(page);near(c.left.w,240,'bad value '+bad);
 }
 // Storage that throws: defaults, and dragging still works for the visit.
 const blocked=await context.newPage();blocked.setDefaultTimeout(60000);blocked.on('pageerror',e=>errors.push(e.message));await blocked.setViewport(desktop);
 await blocked.evaluateOnNewDocument(k=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(x){if(x===k)throw new Error('blocked');return get.call(this,x);};Storage.prototype.setItem=function(x,y){if(x===k)throw new Error('blocked');return set.call(this,x,y);};},KEY);
 await openRoom(blocked);c=await columns(blocked);near(c.left.w,240,'blocked storage default');await drag(blocked,left,30);c=await columns(blocked);near(c.left.w,270,'drag with blocked storage');await blocked.close();

 // A tablet: on its side it has columns and touch works; upright it has today's single view.
 await page.evaluate(k=>localStorage.removeItem(k),KEY);
 const tablet=await context.newPage();tablet.setDefaultTimeout(60000);tablet.on('pageerror',e=>errors.push(e.message));
 await tablet.setViewport({width:1180,height:820,isMobile:true,hasTouch:true});await openRoom(tablet);await openThread(tablet);
 c=await columns(tablet);near(c.right.w,350,'tablet on its side: replies');
 const t=await handleAt(tablet,right);const touch=await tablet.touchscreen.touchStart(t.x,t.y);for(let i=1;i<=4;i++){await touch.move(t.x-20*i,t.y);await pause(25);}await touch.end();await pause(80);
 c=await columns(tablet);near(c.right.w,430,'touch drag on a tablet');await shot(tablet,'tablet-landscape-dragged');
 await tablet.setViewport({width:820,height:1180,isMobile:true,hasTouch:true});await openRoom(tablet);
 assert.equal(await tablet.$$eval('[data-chat-column-handle]',es=>es.filter(e=>e.checkVisibility()).length),0,'no dividers on an upright tablet');
 await openThread(tablet);c=await columns(tablet);near(c.right.w,820,'upright tablet: replies cover the screen');await shot(tablet,'tablet-portrait-replies');await tablet.close();

 // A phone, even with widths saved on this browser: no dividers, the same screens.
 const ph=await(await browser.createBrowserContext()).newPage();ph.setDefaultTimeout(60000);ph.on('pageerror',e=>errors.push(e.message));await ph.setViewport(phone);
 await signIn(ph,base,alice.email,{next:'/chat?room=main',composer});
 await ph.evaluate((k,val)=>localStorage.setItem(k,val),KEY,JSON.stringify({left:300,right:500}));await openRoom(ph);
 assert.equal(await ph.$$eval('[data-chat-column-handle]',es=>es.filter(e=>e.checkVisibility()).length),0,'no dividers on a phone');await shot(ph,'phone-room');
 await openThread(ph);c=await columns(ph);near(c.right.w,390,'phone: replies cover the screen');await shot(ph,'phone-replies');

 assert.deepEqual(errors,[],'page errors');
 console.log('PASS chat-column-resize');
}finally{await browser.close();}
