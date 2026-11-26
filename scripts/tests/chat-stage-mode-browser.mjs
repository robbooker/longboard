// #501 Stage mode (admin-only preview; #502: with no LiveKit settings, so exactly as before live video), against the fixture on this test's own ports
// (localhost:3501, database 127.0.0.1:54501). Synthetic members, messages, alerts and news only.
//  - a member (Bob) has no "Go live (preview)" in the room menu, and /chat?room=main&stage=1 is just
//    the room for him: no stage, the sidebar and header as always, and his page is never told stage
//    mode exists;
//  - an admin (Alice) has the item; it opens the stage: top bar, then three columns side by side
//    (stage, trades and questions, room chat) at 1440px and 1280px with nothing scrolling sideways;
//    the sidebar and the room header are hidden; the address says &stage=1;
//  - the video is one placeholder component with the overlay as its own layer;
//  - with no rows in today's Gainers Table the stock panel shows the handoff's APUS row marked as a
//    sample, and a made-up ticker's chip shows "—" for every number (nothing invented);
//  - once stocks alert, the panel shows today's Gainers Table rows (the fake Polygon's price), a chip
//    switches the stock on screen, and its saved press releases are listed as links;
//  - a chapter can be selected, a question upvoted (and un-voted) and a question asked, all local;
//  - a message typed in the right column is a real room message: it is saved, and it is still in
//    the room after leaving the stage;
//  - every button in the stage is at least 44px tall and has a name;
//  - "Back to rooms" leaves: the room is as before, and the address drops &stage=1; the admin's own
//    /chat?room=main&stage=1 link opens the stage again.
//  - #510: the stage keeps the admin's own theme, and in every theme and colour combination the chat
//    offers (changed while the stage is open, with nothing loaded again) its surfaces are that
//    look's own colours, its text is readable (4.5:1; 3:1 large), the player and its bars stay dark,
//    LIVE stays red and the focus ring shows (stage-theme-checks.mjs);
// CHAT_SHOT_DIR saves menu-member.png, menu-admin.png, stage-1440.png and stage-1280.png.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
import {LOOKS,checkStageLooks,contrastOf,setLook} from './stage-theme-checks.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3501',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54501';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,TOKEN='synthetic-gainers-lookup-token-never-a-production-secret';
const scale=Number(process.env.CHAT_TIMING_SCALE||1);
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ago=s=>new Date(Date.now()-s*1000).toISOString();
let source=1;
const alert=(sym,secondsAgo,vol)=>sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source++,ago(secondsAgo),`🚨 ${sym} (+${(40+source).toFixed(1)}%)\nPrice: $2.50\nVolume: ${vol.toLocaleString('en-US')}\nMarket Cap: 12.5M`]);
const facts=body=>fetch(`${base}/api/chat/gainers/facts`,{method:'POST',headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify(body)});
// Today's alerts must be today in New York. #525: run-browser-tests.mjs pins this test to 9:00 AM there (clock in browser-manifest.mjs), so this only ever stops a run by hand.
const etMinutes=(()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return Number(p.hour)*60+Number(p.minute);})();
assert(etMinutes>=15,'run by hand, without run-browser-tests.mjs and its 9:00 AM New York clock: at least 15 minutes after midnight in New York');
// Alice is the admin, Bob a member.
await sql("update profiles set role='admin' where email='alice@example.test'");
await sql("update profiles set role='user' where email='bob@example.test'");

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const LB='textarea[aria-label="Message LB"]';
const shown=(page,selector)=>page.evaluateHandle(s=>[...document.querySelectorAll(s)].find(e=>e.checkVisibility())??null,selector);
const visible=(page,selector)=>page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility()),selector);
const openMenu=async page=>{
 await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button[aria-label="Chat settings"]')].find(e=>e.checkVisibility());return b&&Object.keys(b).some(k=>k.startsWith('__reactProps$'));},{timeout:60000});
 await (await shown(page,'button[aria-label="Chat settings"]')).click();
 await page.waitForSelector('#chat-settings-panel',{visible:true});
 return page.$$eval('#chat-settings-panel :is(button,a)',items=>items.filter(e=>e.checkVisibility()).map(e=>e.textContent.trim()));
};
const send=async(page,text)=>{
 const box=await shown(page,LB);await box.click();await page.keyboard.type(text);await page.keyboard.press('Enter');
 await page.waitForFunction(t=>[...document.querySelectorAll('article[id^="chat-message-"]:not([data-pending])')].some(a=>a.checkVisibility()&&a.textContent.includes(t)),{timeout:30000*scale},text);
};
const saved=(page,text)=>page.evaluate(async t=>{const r=await fetch('/api/chat/history?room=main',{cache:'no-store'});const body=await r.json();return (body.messages??[]).some(m=>m.body===t);},text);
try{
 // A member: no menu item, and the link is just the room.
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1440,height:900});
  await signIn(page,base,'bob@example.test',{composer:LB,next:'/chat?room=main'});
  await send(page,'Alert set at the stop.');
  const items=await openMenu(page);
  assert(items.includes('Pop out chat'),`the room menu is open: ${items.join(' | ')}`);
  assert(!items.some(text=>/go live/i.test(text)),`a member has no Go live item: ${items.join(' | ')}`);
  assert.equal(await page.$('[data-stage-go-live]'),null);
  if(shots)await page.screenshot({path:`${shots}/menu-member.png`});
  const response=await page.goto(`${base}/chat?room=main&stage=1`);
  const html=await response.text();
  assert(!/stageMode\\?":true/.test(html),'a member\'s page is not told about stage mode');
  await page.waitForSelector(LB,{visible:true,timeout:60000});
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button[aria-label="Chat settings"]')].find(e=>e.checkVisibility());return b&&Object.keys(b).some(k=>k.startsWith('__reactProps$'));},{timeout:60000});
  await sleep(1500);
  assert.equal(await page.$('[data-stage-root]'),null,'a member\'s stage link opens no stage');
  assert.equal(await page.$('main[data-stage]'),null);
  assert(await visible(page,'#chat-room-navigation'),'the member\'s sidebar is there as always');
  assert(!(await page.evaluate(()=>performance.getEntriesByType('resource').some(e=>/StageMode|stage_/i.test(e.name)))),'a member downloads no stage code');
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('PASS member: no Go live item, and the stage link is just the room');
 }
 // An admin.
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1440,height:900});
  await context.setCookie({name:'longboard-chat-theme',value:'light',domain:'localhost',path:'/'});
  await signIn(page,base,'alice@example.test',{composer:LB,next:'/chat?room=main'});
  assert.equal(await page.$('[data-stage-root]'),null,'the room opens as a room');
  assert(!(await page.evaluate(()=>performance.getEntriesByType('resource').some(e=>/StageMode/i.test(e.name)))),'no stage code before it is opened');
  const items=await openMenu(page);
  assert(items.includes('Go live (preview)'),`an admin has Go live (preview): ${items.join(' | ')}`);
  if(shots)await page.screenshot({path:`${shots}/menu-admin.png`});
  await page.click('[data-stage-go-live]');
  await page.waitForSelector('[data-stage-root]',{timeout:60000*scale});
  await page.waitForSelector('[data-stage-column="stage"]',{visible:true});
  assert.equal(new URL(page.url()).searchParams.get('stage'),'1','the address says the stage is open');
  assert.equal(new URL(page.url()).searchParams.get('room'),'main');
  assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'H1','focus moves to the stage\'s heading');
  assert.equal(await page.$eval('main[data-stage]',m=>m.dataset.theme),'light','#510: the stage keeps the admin\'s own theme');
  // Three columns under the top bar, left to right; the sidebar and the room header are hidden.
  const layout=()=>page.evaluate(()=>{
   const box=s=>{const e=[...document.querySelectorAll(s)].find(x=>x.checkVisibility());if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),right:Math.round(r.right)};};
   const chat=document.querySelector('[data-stage-root] ~ section');
   return {bar:box('[data-stage-root] > header'),stage:box('[data-stage-column="stage"]'),trades:box('[data-stage-column="trades"]'),chat:box('[data-stage-root] ~ section'),
    composerInChat:!!chat?.querySelector('textarea[aria-label="Message LB"]')?.checkVisibility(),log:!!chat?.querySelector('[role="log"]')?.checkVisibility(),
    nav:[...document.querySelectorAll('#chat-room-navigation')].some(e=>e.checkVisibility()),roomHeader:!!chat?.querySelector(':scope > header')?.checkVisibility(),
    sideways:document.documentElement.scrollWidth>window.innerWidth,width:window.innerWidth,height:window.innerHeight};});
  const checkLayout=async where=>{const l=await layout();
   assert(l.bar&&l.stage&&l.trades&&l.chat,`${where}: the bar and three columns are shown: ${JSON.stringify(l)}`);
   assert.equal(l.bar.w,l.width,`${where}: the top bar spans the page`);
   assert(l.stage.x===0&&l.stage.right<=l.trades.x&&l.trades.right<=l.chat.x,`${where}: stage, trades, chat from left to right: ${JSON.stringify(l)}`);
   assert.equal(l.trades.w,360,`${where}: the middle column is 360px`);assert.equal(l.chat.w,340,`${where}: the chat column is 340px`);
   assert.equal(l.chat.right,l.width,`${where}: the chat is the right column`);
   for(const c of [l.stage,l.trades,l.chat])assert(c.y>=l.bar.h&&c.y+c.h<=l.height+1,`${where}: the columns sit under the bar, inside the window: ${JSON.stringify(l)}`);
   assert(l.composerInChat&&l.log,`${where}: the right column is the room's own message list and composer`);
   assert(!l.nav&&!l.roomHeader,`${where}: the sidebar and room header are hidden`);
   assert(!l.sideways,`${where}: nothing scrolls sideways`);};
  await checkLayout('1440px');
  // The top bar.
  const bar=await page.$eval('[data-stage-root] > header',h=>h.textContent);
  for(const text of ['# LB','LIVE','Back to rooms'])assert(bar.includes(text),`the top bar has "${text}": ${bar}`);
  // #508: Raise hand is real now, for people watching live video; the preview has no sample of it.
  assert(!/hand/i.test(bar),`no sample Raise hand button in the preview: ${bar}`);
  assert.match(await page.$eval('[data-stage-elapsed]',e=>e.textContent),/^00:00:\d\d$/);
  // The video: one component with the room's id, a placeholder and the overlay as its own layer.
  assert.equal(await page.$eval('[data-stage-video]',e=>e.dataset.stageVideo),'main');
  assert.match(await page.$eval('[data-stage-video-placeholder]',e=>e.textContent),/\[Live video feed\]/);
  assert.equal(await page.$eval('[data-stage-overlay]',e=>e.contains(document.querySelector('[data-stage-video-placeholder]'))),false,'the overlay is a separate layer');
  assert.equal(await page.$eval('[data-stage-overlay]',e=>e.childElementCount),0,'#507: no card on top of the video');
  assert.equal(await page.$('[data-stage-root] video'),null,'no real video yet');
  // #502: the controls are real now; with no live video set up here they are there but switched off.
  for(const label of ['Pause','Mute','Picture in picture','Full screen'])assert.equal(await page.$eval(`[data-stage-video] button[aria-label="${label}"]`,b=>b.disabled),true,label);
  assert.equal(await page.$eval('[data-stage-video] input[aria-label="Volume"]',i=>i.disabled),true);
  assert.equal(await page.$eval('[data-stage-video]',e=>e.dataset.stageVideoState),'preview');
  assert.equal(await page.$('[data-stage-broadcast]'),null,'no "Live video" card without LiveKit settings');
  assert(!(await page.evaluate(()=>performance.getEntriesByType('resource').some(e=>/livekit|\/api\/chat\/stage\//i.test(e.name)))),'no LiveKit code and no stage requests without LiveKit settings');
  // Bob's message is in the right column: it is the real room.
  assert(await page.evaluate(()=>[...document.querySelectorAll('[data-stage-root] ~ section article[id^="chat-message-"]')].some(a=>a.textContent.includes('Alert set at the stop.'))),'the room\'s messages are in the right column');
  // No rows today: the handoff's sample row, marked; a made-up ticker shows no numbers.
  const stock=()=>page.$eval('[data-stage-stock]',e=>({sym:e.dataset.stageStock,source:e.dataset.stageStockSource,shown:e.querySelector('[data-stage-stock-sym]').textContent,sample:e.querySelector('[data-stage-sample]')?.textContent??null,
   chips:[...e.querySelectorAll('[data-stage-chip]')].map(c=>[c.dataset.stageChip,c.getAttribute('aria-pressed')]),stats:[...e.querySelectorAll('[data-stage-stat]')].map(s=>[s.querySelector('dt').textContent,s.querySelector('dd').textContent]),
   news:e.querySelector('[data-stage-news]').dataset.stageNews,links:[...e.querySelectorAll('[data-stage-news-item] a')].map(a=>[a.textContent,a.href,a.target])}));
  await page.waitForFunction(()=>document.querySelector('[data-stage-stock]')?.dataset.stageStockSource==='sample',{timeout:30000*scale});
  let s=await stock();
  assert.equal(s.sym,'APUS');assert.equal(s.source,'sample');assert.match(s.sample,/Sample row/);
  assert.deepEqual(s.stats,[['Price','$3.14'],['% today','+35.8%'],['Volume','7.3M'],['Borrow at TZ','.01'],['Mkt cap','$5.8M'],['Float','1.2M'],['Cash left','$149M'],['Inst %','3.9%'],['Min','7'],['Time','9:25']],'the handoff\'s row, in the Gainers Table\'s order');
  assert.deepEqual(s.chips,[['APUS','true'],['QBTZ','false'],['MLNK','false']]);
  await page.click('[data-stage-chip="QBTZ"]');
  s=await stock();
  assert.equal(s.shown,'QBTZ');assert.equal(s.source,'placeholder');assert.match(s.sample,/Sample ticker/);
  assert.deepEqual([...new Set(s.stats.map(x=>x[1]))],['—'],'a made-up ticker has no invented numbers');
  assert.deepEqual(s.chips,[['APUS','false'],['QBTZ','true'],['MLNK','false']]);assert.equal(s.news,'none');
  // Chapters: one selected at a time.
  const chapters=()=>page.$$eval('[data-stage-chapter]',bs=>bs.map(b=>[b.dataset.stageChapter,b.textContent,b.getAttribute('aria-pressed')]));
  assert.deepEqual(await chapters(),[['c1','09:42VXRT cover','false'],['c2','10:02MLNK watch','false'],['c3','10:06QBTZ short entry','false'],['live','NOWLive','true']]);
  await page.click('[data-stage-chapter="c3"]');
  assert.deepEqual((await chapters()).map(c=>c[2]),['false','false','true','false']);
  // The trade tape (sample).
  assert.deepEqual(await page.$$eval('[data-stage-column="trades"] ol li',ls=>ls.map(l=>[...l.children].map(c=>c.textContent))),[['10:06','SHORT','QBTZ','starter'],['10:02','WATCH','MLNK','no entry'],['09:42','COVER','VXRT','closed']]);
  // Questions: an upvote toggles, and a question can be asked (all local).
  const votes=id=>page.$eval(`[data-stage-question="${id}"]`,q=>[q.querySelector('[data-stage-votes]').textContent,q.querySelector('button').getAttribute('aria-pressed')]);
  assert.deepEqual(await votes('q2'),['6','false']);
  await page.click('[data-stage-question="q2"] button');assert.deepEqual(await votes('q2'),['7','true']);
  await page.click('[data-stage-question="q2"] button');assert.deepEqual(await votes('q2'),['6','false']);
  await page.click('[data-stage-question="q1"] button');assert.deepEqual(await votes('q1'),['10','true']);
  await page.type('[data-stage-column="trades"] input','Where is the stop on this one?');
  assert(await page.$eval('[data-stage-column="trades"] input',i=>!!i.labels?.length),'the question box has a label');
  await page.keyboard.press('Enter');
  assert.equal(await page.$$eval('[data-stage-question]',qs=>qs.length),4);
  assert.match(await page.$eval('[data-stage-question="mine-1"]',q=>q.textContent),/Where is the stop on this one\?/);
  assert.equal(await page.$eval('[data-stage-column="trades"] input',i=>i.value),'');
  // A message from the right column is a real room message.
  await send(page,'Starter only. Process over outcome.');
  assert(await saved(page,'Starter only. Process over outcome.'),'the message was saved in the room');
  assert(await page.evaluate(()=>!document.querySelector('[data-stage-root] ~ section textarea[aria-label="Message LB"]').value),'the composer cleared');
  // A reply thread opens over the chat column and closes back to it.
  await page.evaluate(()=>[...document.querySelectorAll('[data-stage-root] ~ section article button[data-menu-reply]')].at(-1).click());
  await page.waitForSelector('[data-stage-root] ~ aside[aria-label="Comment replies"] button[aria-label="Close replies"]',{visible:true,timeout:60000*scale});
  {const l=await layout(),r=await page.$eval('[data-stage-root] ~ aside',a=>{const b=a.getBoundingClientRect();return {x:Math.round(b.left),w:Math.round(b.width),right:Math.round(b.right)};});
   assert.equal(r.w,340,'the thread takes the chat column');assert.equal(r.right,l.width);assert(l.stage&&l.trades&&l.trades.right<=r.x,'the stage and trades stay put beside the thread');}
  await page.click('[data-stage-root] ~ aside button[aria-label="Close replies"]');
  await page.waitForFunction(()=>!document.querySelector('[data-stage-root] ~ aside'));
  await checkLayout('after a thread');
  // Stocks alert: the panel is today's Gainers Table (no reload: the next 15-second read).
  await alert('NEWT',300,450000);await alert('AEHL',52,300000);
  {const r=await facts({ticker:'NEWT',notFound:false,country:'U.S.',cashUsd:31_500_000,cashMonthsLeft:304.7,cashFlowPositive:false,instOwnPct:12.5,floatShares:1_240_000_000});assert.equal(r.status,200,await r.text());}
  {const r=await facts({kind:'news',ticker:'NEWT',items:[{publishedAt:ago(3600),source:'ACCESS Newswire',title:'Newt Corp reports third quarter results',url:'https://dilution.news/newt-1',dtItemId:'newt-1'},{publishedAt:ago(3*86400),source:'GlobeNewswire',title:'Newt Corp announces a registered direct offering',url:'https://dilution.news/newt-2',dtItemId:'newt-2'}]});assert.equal(r.status,200,await r.text());}
  await page.waitForFunction(()=>document.querySelector('[data-stage-stock]')?.dataset.stageStockSource==='table',{timeout:40000*scale});
  s=await stock();
  assert.deepEqual(s.chips.map(c=>c[0]),['AEHL','NEWT'],'today\'s stocks, newest alert first');
  assert.equal(s.sym,'AEHL','the chosen sample ticker is gone, so the newest stock is on screen');assert.equal(s.sample,null,'real rows are not marked as samples');
  assert.equal(s.stats[0][1],'$2.50','AEHL\'s price from the (fake) snapshot');assert.equal(s.stats[1][1],'+52.3%');
  await page.click('[data-stage-chip="NEWT"]');
  await page.waitForFunction(()=>document.querySelector('[data-stage-news]')?.dataset.stageNews==='ready'&&document.querySelector('[data-stage-stock]').dataset.stageStock==='NEWT',{timeout:20000*scale});
  s=await stock();
  assert.equal(s.shown,'NEWT');assert.deepEqual(s.chips,[['AEHL','false'],['NEWT','true']]);
  assert.deepEqual(s.stats.map(x=>x[0]),['Price','% today','Volume','Borrow at TZ','Mkt cap','Float','Cash left','Inst %','Min','Time']);
  assert.equal(s.stats[0][1],'$0.4512');assert.equal(s.stats[1][1],'-12.3%');assert.equal(s.stats[5][1],'1.2B');assert.equal(s.stats[7][1],'12.5%');
  assert.deepEqual(s.links,[['Newt Corp reports third quarter results','https://dilution.news/newt-1','_blank'],['Newt Corp announces a registered direct offering','https://dilution.news/newt-2','_blank']],'the saved press releases, newest first, as links');
  assert.equal(await page.$eval('[data-stage-stat="change"] dd',d=>d.dataset.tone),'down');
  // Every button has a name and is at least 44px tall; inputs have labels.
  const controls=await page.$$eval('[data-stage-root] button',bs=>bs.map(b=>({name:(b.getAttribute('aria-label')||b.textContent).trim(),h:Math.round(b.getBoundingClientRect().height)})));
  assert(controls.length>=15,String(controls.length));
  for(const c of controls){assert(c.name,'every stage button has a name');assert(c.h>=44,`"${c.name}" is ${c.h}px tall`);}
  if(shots)await page.screenshot({path:`${shots}/stage-1440.png`});
  // #510: the stage in every theme and colour combination, changed while it is open (nothing is
  // loaded again). A stock with a loss, its press releases, a selected chip, chapter and vote, the
  // sample trades and the question box are all on screen for it.
  {const requests=[];const note=r=>requests.push(r.url());page.on('request',note);
   const marks=await page.evaluate(()=>{window.__stageKept=document.querySelector('[data-stage-root]');return performance.getEntriesByType('navigation').length;});
   const seen=await checkStageLooks(page,{each:async look=>{
    for(const [what,sel] of [['a loss','[data-stage-stat="change"] dd[data-tone="down"]'],['a press release link','[data-stage-news-item] a'],['a selected chip','[data-stage-chip][aria-pressed="true"]'],['a selected chapter','[data-stage-chapter][aria-pressed="true"]'],['a selected vote','[data-stage-question] button[aria-pressed="true"]'],['a sample label','[data-stage-column="trades"] h2'],['the SHORT tag','[data-stage-column="trades"] [data-tag="SHORT"]'],['the COVER tag','[data-stage-column="trades"] [data-tag="COVER"]']]){
     const ratio=await contrastOf(page,sel);assert(ratio!==null,`${look.id}: ${what} is on screen`);assert(ratio>=4.5,`${look.id}: ${what} is ${ratio}:1`);}
    if(shots)await page.screenshot({path:`${shots}/stage-look-${look.id}.png`});}});
   assert.equal(Object.keys(seen).length,LOOKS.length);
   assert.equal(await page.evaluate(()=>window.__stageKept===document.querySelector('[data-stage-root]')&&performance.getEntriesByType('navigation').length),marks,'changing the theme redraws the open stage in place: nothing is loaded again');
   page.off('request',note);
   const asked=requests.filter(url=>/\/api\/chat\/theme|\.css(\?|$)/.test(url));
   assert.deepEqual(asked,[],`a theme change asks for nothing (no stylesheet, no save from this tab): ${asked.join(' ')}`);
   await setLook(page,{theme:'light',palette:null});}
  // A 1280px laptop: still three columns.
  await page.setViewport({width:1280,height:800});await sleep(300);
  await checkLayout('1280px');
  if(shots)await page.screenshot({path:`${shots}/stage-1280.png`});
  // Narrower: the columns stack.
  await page.setViewport({width:1100,height:800});await sleep(300);
  {const l=await layout();assert(l.stage.y<l.trades.y&&l.trades.y<l.chat.y,`below 1280px the columns stack: ${JSON.stringify(l)}`);assert(!l.sideways,'stacked: nothing scrolls sideways');}
  await page.setViewport({width:1440,height:900});await sleep(300);
  // Leave: the room is back as it was.
  await page.click('[data-stage-exit]');
  await page.waitForFunction(()=>!document.querySelector('[data-stage-root]'));
  assert.equal(new URL(page.url()).searchParams.get('stage'),null,'the address drops the stage');
  assert.equal(await page.$('main[data-stage]'),null);
  assert.equal(await page.$eval('main[data-chat-view]',m=>m.dataset.theme),'light','the admin\'s own theme is back');
  assert(await visible(page,'#chat-room-navigation'),'the sidebar is back');
  assert(await visible(page,LB),'the room composer is back');
  assert(await page.evaluate(()=>[...document.querySelectorAll('article[id^="chat-message-"]')].some(a=>a.checkVisibility()&&a.textContent.includes('Starter only. Process over outcome.'))),'the message sent from the stage is in the room');
  const main=await page.evaluate(()=>{const r=[...document.querySelectorAll('section[aria-label="Longboard Chat"]')].find(e=>e.checkVisibility()).getBoundingClientRect();return Math.round(r.width);});
  assert(main>700,`the room is full width again (${main}px)`);
  // The admin's own link opens the stage.
  await page.goto(`${base}/chat?room=main&stage=1`);
  await page.waitForSelector('[data-stage-root]',{timeout:60000*scale});
  await checkLayout('by link');
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('PASS admin: Go live (preview), three columns at 1440 and 1280, real chat, sample and Gainers Table stock, chapters, questions, exit, link');
 }
}finally{await browser.close();}
