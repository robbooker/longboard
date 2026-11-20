// #476 Gainers Table heading as one slim bar, against the fixture on this test's own ports
// (localhost:3477, database 127.0.0.1:54477). Synthetic alerts and facts only; Polygon is the Gainers
// Table test's fake (chat-gainers-table-preload.mjs).
//  - the heading words (and a phone's icon key) sit behind one slim "About this table" bar with an
//    arrow; it starts closed, so the first gainers sit higher than they did under the full heading;
//  - the bar is a real button (aria-expanded, aria-controls naming the panel): a click or tap opens it
//    to the full words, again closes it; Enter and Space work too;
//  - open or closed is remembered on this device across a reload and leaving for a room and coming
//    back; with storage blocked it starts closed, still opens and closes, and nothing breaks;
//  - the column names are the same, still sticky, and line up with the cells, closed or open;
//  - a computer (1280) and a phone (390) work the same; no sideways scroll on the phone;
//  - in every look (Dark, Light, Blade Runner, Terminal, Paper Terminal) the bar's words are readable;
//  - in a six view card the same bar, closed or open as remembered.
// GAINERS_HEADING_BEFORE=1 runs only the "before" measurement and pictures (for the old heading).
// CHAT_SHOT_DIR saves t476-*.png.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3477',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54477';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,before=process.env.GAINERS_HEADING_BEFORE==='1',TOKEN='synthetic-gainers-lookup-token-never-a-production-secret';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let source=1;
const ago=s=>new Date(Date.now()-s*1000).toISOString();
const alert=(sym,secondsAgo,vol)=>sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source++,ago(secondsAgo),`🚨 ${sym} (+${(40+source).toFixed(1)}%)\nPrice: $2.50\nVolume: ${vol.toLocaleString('en-US')}\nMarket Cap: 12.5M`]);
const etMinutes=(()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return Number(p.hour)*60+Number(p.minute);})();
assert(etMinutes>=15,'run this test at least 15 minutes after midnight in New York');

await alert('AEHL',60,300000);
await alert('NEWT',300,450000);
await alert('GONE',720,200000);
const save=async body=>{const r=await fetch(`${base}/api/chat/gainers/facts`,{method:'POST',headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify({notFound:false,country:null,cashUsd:null,cashMonthsLeft:null,cashFlowPositive:false,instOwnPct:null,...body})});assert.equal(r.status,200,await r.text());};
await save({ticker:'AEHL',country:'China',cashUsd:8_400_000,cashMonthsLeft:7.2,instOwnPct:3.1});
await save({ticker:'NEWT',country:'U.S.',cashUsd:31_500_000,cashMonthsLeft:304.7,instOwnPct:12.5,floatShares:1_240_000_000});

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const desktop={width:1280,height:860,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const BAR='[data-gainers-table] [data-gainers-about-toggle]',PANEL='[data-gainers-table] [data-gainers-about-panel]';
const THEMES=['dark','light','blade-runner','terminal','paper-terminal'];
const sideways=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
// The first gainer's top, in the window (the page is at the top).
const firstRowTop=page=>page.$eval('[data-gainers-row]',tr=>Math.round(tr.getBoundingClientRect().top*10)/10);
const bar=page=>page.$eval(BAR,b=>{const panel=document.getElementById(b.getAttribute('aria-controls')),r=b.getBoundingClientRect();
 return {tag:b.tagName,type:b.type,text:b.textContent.trim(),expanded:b.getAttribute('aria-expanded'),panel:!!panel&&panel.matches('[data-gainers-about-panel]'),
  panelShown:!!panel&&panel.checkVisibility(),introShown:!!panel?.querySelector('p')?.checkVisibility(),height:Math.round(r.height*10)/10};});
// The column names, whether they stick, and each one's left edge and width beside the first row's cells.
const heads=page=>page.$eval('[data-gainers-table] table',t=>{const ths=[...t.querySelectorAll('thead th')].filter(e=>e.checkVisibility()),tds=[...t.querySelector('[data-gainers-row]').children];
 return {names:ths.map(th=>th.getAttribute('aria-label')||th.textContent.trim()),sticky:ths.every(th=>getComputedStyle(th).position==='sticky'),
  cols:ths.map((th,i)=>{const a=th.getBoundingClientRect(),b=tds[i].getBoundingClientRect();return [Math.round(a.left*10)/10,Math.round(a.width*10)/10,Math.round(b.left*10)/10,Math.round(b.width*10)/10];})};});
const checkAligned=(h,where)=>{for(const [thLeft,thWidth,tdLeft,tdWidth] of h.cols){assert(Math.abs(thLeft-tdLeft)<0.6&&Math.abs(thWidth-tdWidth)<0.6,`${where}: a column name lines up with its cells ${JSON.stringify(h.cols)}`);}assert(h.sticky,`${where}: the column names stick`);};
// The bar's words against what is behind them, as a contrast ratio (WCAG).
const contrast=page=>page.$eval(BAR,b=>{
 const rgba=c=>{const x=document.createElement('canvas').getContext('2d');x.fillStyle=c;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data];};
 let e=b,bg;while(e){const c=rgba(getComputedStyle(e).backgroundColor);if(c[3]>0&&getComputedStyle(e).backgroundColor!=='rgba(0, 0, 0, 0)'){bg=c;break;}e=e.parentElement;}bg??=[255,255,255,255];
 const lum=c=>{const [r,g,v]=c.slice(0,3).map(x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*v;};
 const a=lum(rgba(getComputedStyle(b).color)),z=lum(bg);return (Math.max(a,z)+.05)/(Math.min(a,z)+.05);});
async function setTheme(page,theme){
 // The look is saved on the account (and the device): set all three, as the theme menu does.
 const saved=await page.evaluate(async theme=>{try{localStorage.setItem('longboard-public-chat-theme-v1',theme);}catch{}const r=await fetch('/api/chat/theme',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({theme})});return r.status;},theme);
 assert.equal(saved,200,`saving the ${theme} look`);
 await page.browserContext().setCookie({name:'longboard-chat-theme',value:theme,domain:'localhost',path:'/chat'});
}
async function openTable(page,theme){
 await page.goto(`${base}/chat?page=gainers-table`,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-gainers-row="NEWT"]',{visible:true,timeout:60000});
 if(theme)await page.waitForFunction(theme=>document.querySelector(`main[data-theme="${theme}"]`),{timeout:10000},theme);
 await page.evaluate(()=>{document.querySelector('[data-gainers-table] table')?.parentElement?.scrollTo(0,0);window.scrollTo(0,0);});
 // Pictures without the dev server's badge.
 if(shots)await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
 await sleep(400);
}
async function newPage(viewport,{blockStorage=false}={}){
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport(viewport);
 await context.setCookie({name:'longboard-chat-theme',value:'light',domain:'localhost',path:'/'});
 await signIn(page,base,'bob@example.test');
 await setTheme(page,'light');
 // Blocked storage, for the bar's own key (the rest of the chat keeps working to sign in and draw).
 if(blockStorage)await page.evaluateOnNewDocument(()=>{for(const k of ['getItem','setItem','removeItem']){const real=Storage.prototype[k];Storage.prototype[k]=function(key,...rest){if(key==='longboard-gainers-table-about-v1')throw new DOMException('blocked','SecurityError');return real.call(this,key,...rest);};}});
 return {context,page,errors};
}
try{
 if(before){
  // The old heading: where the first gainer sits, and pictures.
  for(const [label,viewport] of [['desktop',desktop],['phone',phone]]){
   const {context,page}=await newPage(viewport);await openTable(page,'light');
   console.log(`#476 before ${label}: first row top ${await firstRowTop(page)}px`);
   if(shots)await page.screenshot({path:`${shots}/t476-before-${label}.png`});
   await context.close();
  }
  console.log('PASS #476 before pictures');
  process.exit(0);
 }
 // A computer.
 {
  const {context,page,errors}=await newPage(desktop);
  await openTable(page,'light');
  let b=await bar(page);
  assert.deepEqual({...b,height:undefined},{tag:'BUTTON',type:'button',text:'▸About this table',expanded:'false',panel:true,panelShown:false,introShown:false,height:undefined},'closed at first: one bar, the words behind it');
  assert(b.height<=24,`the bar is slim (${b.height}px)`);
  const closedTop=await firstRowTop(page),closedHeads=await heads(page);
  checkAligned(closedHeads,'computer closed');
  assert.deepEqual(closedHeads.names,['Symbol','Price','% today','Volume','Borrow at TZ','Mkt Cap','Float','Cash left','Inst %','Min','Time'],'the column names are the same');
  console.log(`#476 computer closed: first row top ${closedTop}px, bar ${b.height}px`);
  if(shots)await page.screenshot({path:`${shots}/t476-desktop-closed.png`});
  // A click opens it to the full words; the rows move down under them.
  await page.click(BAR);
  b=await bar(page);
  assert.deepEqual([b.expanded,b.panelShown,b.introShown,b.text],['true',true,true,'▾About this table'],'a click opens it');
  assert.match(await page.$eval(PANEL,p=>p.innerText.replace(/\s+/g,' ')),/Every stock that alerted in Gainers today with at least 150,000 shares.*Click a stock for its press releases from the last 30 days\./,'the full heading words');
  assert.equal(await page.$eval('[data-gainers-icon-key]',e=>e.checkVisibility()),false,'no icon key on a computer');
  const openTop=await firstRowTop(page);
  assert(openTop>closedTop+30,`open, the rows sit under the words (${closedTop} → ${openTop})`);
  const openHeads=await heads(page);checkAligned(openHeads,'computer open');
  assert.deepEqual(openHeads.cols.map(c=>c[1]),closedHeads.cols.map(c=>c[1]),'the column widths are the same, open or closed');
  console.log(`#476 computer open: first row top ${openTop}px`);
  if(shots)await page.screenshot({path:`${shots}/t476-desktop-open.png`});
  // Remembered across a reload.
  await openTable(page);
  assert.equal((await bar(page)).expanded,'true','left open: open after a reload');
  // Again closes it.
  await page.click(BAR);
  b=await bar(page);assert.deepEqual([b.expanded,b.panelShown],['false',false],'again closes it');
  assert.equal(await firstRowTop(page),closedTop,'closed, the rows are back up');
  // The keyboard: Enter opens, Space closes; focus stays on the bar.
  await page.focus(BAR);await page.keyboard.press('Enter');
  assert.equal((await bar(page)).expanded,'true','Enter opens it');
  await page.keyboard.press('Space');
  assert.equal((await bar(page)).expanded,'false','Space closes it');
  assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-gainers-about-toggle')),true,'focus stays on the bar');
  // Closed is remembered too, after leaving for a room and coming back.
  await openTable(page);
  assert.equal((await bar(page)).expanded,'false','left closed: closed after a reload');
  await page.click(BAR);
  await page.goto(`${base}/chat`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('textarea[aria-label^="Message "]',{visible:true,timeout:60000});
  await openTable(page);
  assert.equal((await bar(page)).expanded,'true','left open: still open after a room and back');
  await page.click(BAR);
  // Every look: the bar is readable and the same height.
  for(const theme of THEMES){
   await setTheme(page,theme);await openTable(page,theme);
   const t=await bar(page),ratio=await contrast(page);
   assert.equal(t.expanded,'false',`${theme}: closed as left`);
   assert(t.height<=24,`${theme}: slim (${t.height}px)`);
   assert(ratio>=4.5,`${theme}: the bar's words are readable (contrast ${ratio.toFixed(2)})`);
   checkAligned(await heads(page),`${theme} closed`);
   console.log(`#476 ${theme}: bar contrast ${ratio.toFixed(2)}, first row top ${await firstRowTop(page)}px`);
   if(shots&&(theme==='dark'||theme==='terminal'))await page.screenshot({path:`${shots}/t476-desktop-${theme}.png`});
  }
  await setTheme(page,'light');
  // A six view card shows the same bar, as remembered on this device.
  await page.setViewport({width:1920,height:1080});
  await page.goto(`${base}/chat/six`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('section[data-card] [data-gainers-table] [data-gainers-row]',{visible:true,timeout:60000});
  if(shots){await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await sleep(300);await page.screenshot({path:`${shots}/t476-six-closed.png`});}
  const CARD_BAR='section[data-card] [data-gainers-about-toggle]';
  assert.equal(await page.$eval(CARD_BAR,b=>b.getAttribute('aria-expanded')),'false','six view card: closed as left');
  await page.click(CARD_BAR);
  assert.equal(await page.$eval('section[data-card] [data-gainers-about-panel]',p=>p.checkVisibility()),true,'six view card: opens');
  if(shots){await sleep(300);await page.screenshot({path:`${shots}/t476-six-open.png`});}
  await page.click(CARD_BAR);
  assert.equal(await page.$eval('section[data-card] [data-gainers-about-panel]',p=>p.checkVisibility()),false,'six view card: closes');
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // A phone: the same bar, tapped; the icon key is behind it too.
 {
  const {context,page,errors}=await newPage(phone);
  await openTable(page,'light');
  let b=await bar(page);
  assert.deepEqual([b.tag,b.expanded,b.panelShown],['BUTTON','false',false],'phone: closed at first');
  assert(b.height>=28&&b.height<=32,`phone: a slim bar, easy to tap (${b.height}px)`);
  assert.equal(await page.$eval('[data-gainers-icon-key]',e=>e.checkVisibility()),false,'phone: the icon key is behind the bar');
  const closedTop=await firstRowTop(page),closedHeads=await heads(page);
  checkAligned(closedHeads,'phone closed');
  assert.deepEqual(closedHeads.names,['Symbol','Price','% today','Borrow at TZ'],'phone: the same column names');
  assert((await sideways(page))<=0,'phone: no sideways scroll');
  console.log(`#476 phone closed: first row top ${closedTop}px, bar ${b.height}px`);
  if(shots)await page.screenshot({path:`${shots}/t476-phone-closed.png`});
  await page.tap(BAR);
  b=await bar(page);
  assert.deepEqual([b.expanded,b.panelShown,b.introShown],['true',true,true],'phone: a tap opens it');
  assert.match(await page.$eval(PANEL,p=>p.innerText),/Tap a stock for the rest and its press releases\./);
  assert.doesNotMatch(await page.$eval(PANEL,p=>p.innerText),/Click a stock/,'phone: the computer\'s words are hidden');
  assert.equal(await page.$eval('[data-gainers-icon-key]',e=>e.checkVisibility()),true,'phone: the icon key shows when open');
  checkAligned(await heads(page),'phone open');
  assert((await sideways(page))<=0,'phone open: no sideways scroll');
  console.log(`#476 phone open: first row top ${await firstRowTop(page)}px`);
  if(shots)await page.screenshot({path:`${shots}/t476-phone-open.png`});
  // Tapping a row still opens its details, open or closed.
  await page.tap('[data-gainers-row="NEWT"] [data-change]');
  await page.waitForSelector('[data-gainers-details="NEWT"]',{visible:true,timeout:5000});
  await openTable(page);
  assert.equal((await bar(page)).expanded,'true','phone: left open, open after a reload');
  await page.tap(BAR);
  assert.equal((await bar(page)).expanded,'false','phone: a tap again closes it');
  await openTable(page);
  assert.equal((await bar(page)).expanded,'false','phone: left closed, closed after a reload');
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // Storage blocked: closed at first, still opens and closes, nothing breaks.
 {
  const {context,page,errors}=await newPage(desktop,{blockStorage:true});
  await openTable(page);
  assert.equal((await bar(page)).expanded,'false','blocked storage: closed');
  await page.click(BAR);assert.equal((await bar(page)).expanded,'true','blocked storage: opens');
  await page.click(BAR);assert.equal((await bar(page)).expanded,'false','blocked storage: closes');
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 console.log('PASS #476 Gainers Table heading bar: closed at first, opens and closes by click, tap and keys, remembered, column names unchanged, every look, six view card, phone and computer');
}finally{await browser.close();}
