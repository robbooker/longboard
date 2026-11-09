// #371 Gainers Table on a computer and a phone, against the fixture on this test's own ports
// (localhost:3371, database 127.0.0.1:54371). Synthetic alerts and facts only.
//  - the row sits directly under Gainers and opens a table, not messages;
//  - one row per stock that alerted today with 150K+ shares (no after-hours, not yesterday),
//    newest alert first; seeded countries show at once, missing facts show "looking up…";
//  - facts saved through the lookup route fill in without a reload, and a new alert appears on top;
//  - the minutes count up on their own;
//  - #372: price, % today (green up, red down) and volume today from the fake Polygon snapshot in
//    chat-gainers-table-preload.mjs (no real Polygon call); a ticker missing from it shows "—";
//  - #373: Borrow at TZ after Volume: "ETB", "$0.0725", "None", "checking…" before the first check,
//    posted through the lookup route (synthetic; no TradeZero request); the title says when checked;
//    a failed re-check keeps the earlier offer;
//  - #376: IB overnight fee and IB avail after Borrow at TZ on a computer ("1,390%", "8.9%", "70K",
//    ">10M", "0" muted, "—" before any IB row), posted through the lookup route as kind "ib"
//    (synthetic; no FTP request); the title says when IB wrote the file;
//  - #376 phone (390px): only Symbol, % today, Volume and Borrow at TZ, no sideways scroll at
//    all; tapping a row (or its symbol button, by keyboard too) opens a details line with the
//    other seven values, Price first, tapping again closes it, and an open row stays open and updates across a
//    15-second re-read; signed out and wrong tokens are refused.
//  - #394: a cash flow positive company's Cash left says "CFP"; its title and label say "Cash Flow
//    Positive", and clicking or tapping it (in a phone row's details too) shows the words without
//    closing the row.
//  - #398 phone: the row is Symbol, Price, % today, Country and Borrow at TZ, in that order, with the
//    same values as the computer's; Volume and the rest are in the details, each with its name beside
//    it. A long country ("British Virgin Islands") wraps to two lines at most, and nothing scrolls
//    sideways at 390px or 360px.
//  - #412: every heading sorts its column (click/tap; again reverses; a third time is newest first),
//    with an arrow and aria-sort on the sorted one, remembered on the device across a reload, on a
//    computer and a phone; a stock that alerts again moves back to the top with its minutes from that
//    alert; Borrow at TZ shows ".0725" and "1.50"; IB avail is gone; Updated shows when the row's facts
//    or borrow were last checked (or the alert's time before that), in the viewer's own time zone.
// CHAT_SHOT_DIR saves t376-desktop.png, t398-desktop.png (1440 wide), t398-phone.png,
// t398-phone-open.png, t394-phone-cfp.png and t398-phone-360.png; #412: t412-desktop.png,
// t412-desktop-sorted.png, t412-phone.png, t412-phone-open.png and t412-phone-sorted.png.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3371',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54371';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,TOKEN='synthetic-gainers-lookup-token-never-a-production-secret';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let source=1;
const ago=s=>new Date(Date.now()-s*1000).toISOString();
// #412: each stock's latest alert time, to check Updated against.
const alertAt={};
const alert=(sym,secondsAgo,vol,extra='')=>(alertAt[sym]=ago(secondsAgo),sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source++,ago(secondsAgo),`🚨 ${sym} (+${(40+source).toFixed(1)}%)\nPrice: $2.50\nVolume: ${vol.toLocaleString('en-US')}\nMarket Cap: 12.5M${extra}`]));
// The test needs today's alerts to be today in New York: not in the first quarter hour after midnight there.
const etMinutes=(()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return Number(p.hour)*60+Number(p.minute);})();
assert(etMinutes>=15,'run this test at least 15 minutes after midnight in New York');

// Today: AEHL (seeded country China) 52 seconds ago so its minutes tick from 0 to 1 while we watch;
// NEWT 5 minutes ago; GONE 12 minutes ago; SMAL never reaches 150K; LATE is after hours;
// OLDY alerted yesterday.
await alert('AEHL',600,300000);await alert('AEHL',52,90000);
await alert('NEWT',300,450000);
await alert('GONE',720,200000);
await alert('SMAL',200,149000);
await alert('LATE',100,9000000,'\nAfter-Hours');
await alert('OLDY',36*3600,900000);

const facts=(body,token=TOKEN)=>fetch(`${base}/api/chat/gainers/facts`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
const save=async body=>{const r=await facts({notFound:false,country:null,cashUsd:null,cashMonthsLeft:null,cashFlowPositive:false,instOwnPct:null,...body});assert.equal(r.status,200,await r.text());};
assert.equal((await facts(null,'x'.repeat(60))).status,401,'wrong token');
assert.equal((await facts({ticker:'NEWT'},'x'.repeat(60))).status,401,'wrong token can\'t save');
const needs=await (await facts()).json();
assert.deepEqual(needs.needs.map(n=>n.ticker),['AEHL','NEWT','GONE'],'the lookup is asked for today\'s 150K stocks, newest first');
assert.deepEqual(needs.needs[0].fields,['cash','instOwn'],'a seeded country is not looked up again');
await save({ticker:'NEWT',country:'U.S.',cashUsd:31_500_000,cashMonthsLeft:304.7,instOwnPct:12.5});
// #373: borrow at TradeZero, as the lookup program posts it (synthetic; no TradeZero request is sent).
assert.deepEqual(needs.borrow.map(n=>n.ticker),['AEHL','NEWT','GONE'],'every new ticker is due a borrow check');
const borrow=async body=>{const r=await facts({kind:'borrow',etb:false,pricePerShare:null,locateType:null,...body});assert.equal(r.status,200,await r.text());};
await borrow({ticker:'AEHL',status:'etb',etb:true});
await borrow({ticker:'NEWT',status:'offered',pricePerShare:0.0725,locateType:'SingleUse'});
await borrow({ticker:'NEWT',status:'error',etb:null});
assert.equal((await facts({kind:'borrow',ticker:'NEWT',status:'offered',etb:false,pricePerShare:-1,locateType:'Locate'})).status,400,'a bad price is refused');
assert.deepEqual((await (await facts()).json()).borrow.map(n=>n.ticker),['GONE'],'checked tickers wait for their next turn');
// #376: Interactive Brokers' rows, as the lookup program posts them from IB's file (synthetic).
assert.deepEqual((await (await facts()).json()).tickers,['AEHL','NEWT','GONE'],'the lookup gets every ticker in today\'s table');
const ibAt=new Date(Math.floor((Date.now()-120000)/1000)*1000).toISOString();
const ib=async(rows,fileTime=ibAt)=>{const r=await facts({kind:'ib',fileTime,rows:rows.map(row=>({feePct:null,rebatePct:null,available:null,availableMore:false,...row}))});assert.equal(r.status,200,await r.text());};
await ib([{ticker:'AEHL',feePct:1390.3435,rebatePct:-1386.4635,available:70000},{ticker:'NEWT',feePct:8.88,rebatePct:-5.0,available:10000000,availableMore:true}]);
assert.equal((await facts({kind:'ib',fileTime:ibAt,rows:[{ticker:'AEHL',feePct:1,rebatePct:1,available:-1,availableMore:false}]})).status,400,'a bad IB row is refused');
// An older file never replaces a newer one's row.
await ib([{ticker:'AEHL',feePct:5,available:5}],new Date(Date.parse(ibAt)-3600000).toISOString());

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const desktop={width:1280,height:860,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
// #412: Updated is in the viewer's own time: the computer is in Chicago, the phone in London.
const clock=(iso,timeZone)=>new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone}).formatToParts(new Date(iso)).filter(p=>p.type!=='dayPeriod').map(p=>p.value).join('').trim();
const order=page=>page.$$eval('[data-gainers-row]',trs=>trs.map(tr=>tr.dataset.gainersRow));
const sortState=page=>page.$$eval('[data-gainers-table] thead th',ths=>ths.filter(t=>t.hasAttribute('aria-sort')||t.querySelector('[data-sort-arrow]')).map(t=>[t.dataset.head,t.getAttribute('aria-sort'),t.querySelector('[data-sort-arrow]')?.dataset.sortArrow??null]));
const headButton=key=>`[data-gainers-table] thead th[data-head="${key}"] button[data-sort-head]`;
const rows=page=>page.$$eval('[data-gainers-row]',trs=>trs.map(tr=>[...tr.children].map(c=>c.textContent.trim())));
const cell=(page,sym,i)=>page.$eval(`[data-gainers-row="${sym}"]`,(tr,i)=>tr.children[i].textContent.trim(),i);
try{
 // Signed out: refused.
 {const r=await fetch(`${base}/api/chat/gainers/table`);assert.equal(r.status,401,'signed out');}
 // A computer.
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(desktop);
  await page.emulateTimezone('America/Chicago');
  await context.setCookie({name:'longboard-chat-theme',value:'light',domain:'localhost',path:'/'});
  await signIn(page,base,'bob@example.test');
  // The row sits directly under Gainers.
  const names=await page.evaluate(()=>{const nav=[...document.querySelectorAll('#chat-room-navigation')].find(e=>e.checkVisibility());return [...nav.querySelectorAll('a')].filter(a=>a.checkVisibility()).map(a=>a.textContent.trim());});
  const at=names.indexOf('Gainers');assert(at>=0,names.join(' | '));
  assert.equal(names[at+1],'Gainers Table',`directly under Gainers: ${names.join(' | ')}`);
  await page.waitForFunction(()=>{const a=[...document.querySelectorAll('a[data-chat-gainers-table]')].find(e=>e.checkVisibility());return a&&Object.keys(a).some(k=>k.startsWith('__reactProps$'));},{timeout:60000});
  for(let attempt=1;;attempt++){
   await (await page.evaluateHandle(()=>[...document.querySelectorAll('a[data-chat-gainers-table]')].find(e=>e.checkVisibility()))).click();
   try{await page.waitForSelector('[data-gainers-row]',{visible:true,timeout:15000});break;}catch(e){if(attempt===3)throw e;}
  }
  assert.equal(await page.$('[data-gainers-table] textarea'),null,'a table, not a chat');
  assert.equal(await page.$eval('a[data-chat-gainers-table]',a=>a.getAttribute('aria-current')),'page');
  let table=await rows(page);
  assert.deepEqual(table.map(r=>r[0]),['AEHL','NEWT','GONE'],'150K stocks today, newest alert first');
  // #412: Updated: the latest of the facts lookup and the borrow check, or the alert before either.
  const updated=()=>page.$$eval('[data-gainers-row] [data-updated]',tds=>Object.fromEntries(tds.map(td=>[td.closest('tr').dataset.gainersRow,{at:td.dataset.updated,text:td.textContent,title:td.title}])));
  {const u=await updated();
   assert.equal(u.GONE.at,new Date(alertAt.GONE).toISOString(),'GONE has nothing newer than its alert');
   assert(Date.parse(u.AEHL.at)>Date.parse(alertAt.AEHL),'AEHL\'s borrow was checked after its latest alert');
   for(const [sym,v] of Object.entries(u)){assert.equal(v.text,clock(v.at,'America/Chicago'),`${sym}: Updated in the viewer's time`);assert.match(v.title,/^Updated \d{1,2}:\d\d\s[AP]M$/);}
   assert(Date.parse(u.NEWT.at)>Date.parse(alertAt.NEWT),'NEWT was checked after its alert');}
  assert.deepEqual(table[1],['NEWT','$0.4512','-12.3%','850K','.0725','8.9%','5',table[1][7],'U.S.','$31.5M · 304 mo','12.5%'],'under $1: four decimals; #412 borrow without $ or leading zero; a failed re-check keeps the offer');
  assert.deepEqual(table[0].slice(1,6),['$2.50','+52.3%','1.2M','ETB','1,390%'],'pre-market volume counts (min.av while day.v is 0); the older IB file was ignored');
  assert.deepEqual(table[0].slice(8),['China','looking up…','looking up…'],'seeded country; the rest is being looked up');
  assert.deepEqual(table[2].slice(1,6),['—','—','—','checking…','—'],'not in the snapshot, not checked at TradeZero yet, no IB row yet');
  assert.deepEqual(table[2].slice(8),['looking up…','looking up…','looking up…']);
  // #376: the IB cells say when IB wrote the file, New York time.
  const ibTitles=await page.$$eval('[data-ib-fee]',tds=>tds.map(td=>td.title));
  assert.match(ibTitles[0],/^Interactive Brokers indicative rate, updated \d{1,2}:\d\d ET$/);
  assert.equal(ibTitles[1],ibTitles[0]);assert.equal(ibTitles[2],'No Interactive Brokers rate yet');
  assert.equal(await page.$('[data-ib-avail]'),null,'#412: IB avail is gone');
  assert.equal(await page.$$eval('[data-gainers-row="GONE"] [data-looking-up]',e=>e.length),3);
  // #373: the borrow cell says when it was checked (New York time) and which pool offered it.
  const titles=await page.$$eval('[data-borrow]',tds=>tds.map(td=>[td.dataset.borrow,td.title]));
  assert.deepEqual(titles.map(t=>t[0]),['etb','offered','checking']);
  assert.match(titles[0][1],/^checked \d{1,2}:\d\d$/);assert.match(titles[1][1],/^checked \d{1,2}:\d\d · single-use$/);
  assert.equal(titles[2][1],'Not checked at TradeZero yet');
  const headers=await page.$$eval('[data-gainers-table] thead th',ths=>ths.map(t=>t.textContent.trim()));
  assert.deepEqual(headers,['Symbol','Price','% today','Volume','Borrow at TZ','IB overnight fee','Min since alert','Updated','Country','Cash left','Inst Own %']);
  // Every header is named and titled; on a computer the names show and the icon key doesn't.
  const NAMES=headers.slice(1);
  const TITLES={'IB overnight fee':'IB overnight fee: Interactive Brokers’ yearly borrow rate','Updated':'Updated: when this row’s company facts or TradeZero borrow were last checked (your time)'};
  const heads=await page.$$eval('[data-gainers-table] thead th[data-head]:not([data-head="symbol"])',ths=>ths.map(t=>({label:t.getAttribute('aria-label'),title:t.title,icon:t.querySelector('svg').checkVisibility(),name:t.querySelector('span').checkVisibility()})));
  assert.deepEqual(heads,NAMES.map(n=>({label:n,title:TITLES[n]??n,icon:false,name:true})),'names on a computer');
  assert.equal(await page.$('[data-gainers-toggle]'),null,'no row toggles on a computer');
  assert.equal(await page.$eval('[data-gainers-icon-key]',e=>e.checkVisibility()),false,'no icon key on a computer');
  // Green up, red down, in the chat's own colours.
  const tones=await page.evaluate(()=>{const css=getComputedStyle(document.querySelector('[data-gainers-table]'));const probe=v=>{const s=document.createElement('span');s.style.color=`var(${v})`;document.querySelector('[data-gainers-table]').append(s);const c=getComputedStyle(s).color;s.remove();return c;};
   const color=sym=>getComputedStyle(document.querySelector(`[data-gainers-row="${sym}"] [data-change]`)).color;return {up:color('AEHL'),down:color('NEWT'),success:probe('--chat-success'),error:probe('--chat-error'),text:css.color};});
  assert.equal(tones.up,tones.success,'up is green');assert.equal(tones.down,tones.error,'down is red');assert.notEqual(tones.up,tones.down);
  assert.equal(await page.$('[data-gainers-row="GONE"] [data-change]'),null,'no colour without a change');
  const sideways=await page.$eval('[data-gainers-table] table',t=>t.parentElement.scrollWidth-t.parentElement.clientWidth);
  assert(sideways<=1,`all eleven columns fit on a computer (${sideways}px over)`);
  // #412: every heading is a sort button; nothing is sorted at first (newest alert first).
  assert.deepEqual(await page.$$eval('[data-gainers-table] thead th',ths=>ths.map(t=>!!t.querySelector('button[data-sort-head]'))),headers.map(()=>true),'every heading is a button');
  assert.deepEqual(await sortState(page),[],'no arrow at first');
  assert.deepEqual(await page.$$eval('[data-gainers-table] thead th',ths=>ths.map(t=>t.textContent.trim())),headers);
  if(shots){await sleep(400);await page.screenshot({path:`${shots}/t376-desktop.png`});}
  // The minutes count up by themselves: AEHL's latest alert was 52 seconds old when it went in
  // (#412: counted from that second alert, not its first one ten minutes ago).
  assert(['0','1'].includes(await cell(page,'AEHL',6)));
  await page.waitForFunction(()=>document.querySelector('[data-gainers-row="AEHL"] [data-minutes]')?.textContent==='1',{timeout:30000});
  const minutesBefore=await cell(page,'GONE',6);assert(Number(minutesBefore)>=12,minutesBefore);
  // Facts and borrow fill in, and a new alert comes in on top, without a reload.
  await save({ticker:'AEHL',country:'China',cashUsd:31_500_000,cashMonthsLeft:304.7,instOwnPct:0.1});
  await save({ticker:'GONE',cashFlowPositive:true,country:'British Virgin Islands',instOwnPct:2});
  await borrow({ticker:'GONE',status:'none'});
  await alert('FRSH',5,700000);
  await page.waitForFunction(()=>document.querySelector('[data-gainers-row]')?.dataset.gainersRow==='FRSH'&&!document.querySelector('[data-gainers-row="AEHL"] [data-looking-up]'),{timeout:40000});
  table=await rows(page);
  assert.deepEqual(table.map(r=>r[0]),['FRSH','AEHL','NEWT','GONE']);
  assert.deepEqual(table[1].slice(8),['China','$31.5M · 304 mo','0.1%']);
  assert.deepEqual([table[3][4],...table[3].slice(8)],['None','British Virgin Islands','CFP','2%'],'none offered at TradeZero; #394 cash flow positive shows CFP');
  // #394: CFP says "Cash Flow Positive" on hover and to screen readers, and shows the words when clicked.
  {const cfp='[data-gainers-row="GONE"] [data-cash] [data-cfp] button';
   assert.deepEqual(await page.$eval(cfp,b=>({title:b.title,label:b.getAttribute('aria-label'),abbr:b.querySelector('abbr').title,text:b.textContent})),{title:'Cash Flow Positive',label:'Cash Flow Positive',abbr:'Cash Flow Positive',text:'CFP'});
   assert.equal(await page.$('[data-cfp-words]'),null,'the words are hidden until asked for');
   await page.click(cfp);
   assert.equal(await page.$eval('[data-gainers-row="GONE"] [data-cfp-words]',e=>e.textContent),'Cash Flow Positive');
   await page.click(cfp);
   assert.equal(await page.$('[data-cfp-words]'),null,'clicking again hides them');
   // Only the Gainers Table's own wording changed: the other cells are as before.
   assert.equal(await page.$$eval('[data-gainers-table] [data-cfp]',e=>e.length),1,'only the cash flow positive row has CFP');}
  assert.deepEqual(table[0].slice(1),['$10.00','+100.0%','12.3M','checking…','—','0',clock(alertAt.FRSH,'America/Chicago'),'looking up…','looking up…','looking up…'],'a new alert gets its price at once; Updated is its alert time');
  await save({ticker:'FRSH',notFound:true});
  await borrow({ticker:'FRSH',status:'offered',pricePerShare:1.5,locateType:'Locate'});
  // #376: not in IB's file: none to lend.
  await ib([{ticker:'FRSH',available:0}]);
  await page.waitForFunction(()=>!document.querySelector('[data-gainers-row="FRSH"] [data-looking-up]')&&document.querySelector('[data-gainers-row="FRSH"] [data-borrow]')?.dataset.borrow==='offered',{timeout:40000});
  {const top=(await rows(page))[0];assert.deepEqual([top[4],top[5],...top.slice(8)],['1.50','—','—','—','—'],'not on DilutionTracker; two decimals for a whole-cent price, no $ (#412)');}
  // #412: FRSH's borrow check is newer than its alert: Updated moved on.
  {const u=await updated();assert(Date.parse(u.FRSH.at)>Date.parse(alertAt.FRSH),JSON.stringify(u.FRSH));assert.equal(u.FRSH.text,clock(u.FRSH.at,'America/Chicago'));}
  // #412: GONE alerts again: back to the top, its minutes from this alert, Updated its time.
  await alert('GONE',3,260000);
  await page.waitForFunction(()=>document.querySelector('[data-gainers-row]')?.dataset.gainersRow==='GONE',{timeout:40000});
  assert.deepEqual(await order(page),['GONE','FRSH','AEHL','NEWT'],'a re-alert moves back to the top');
  assert(['0','1'].includes(await cell(page,'GONE',6)),'minutes from the latest alert');
  assert.equal((await updated()).GONE.at,new Date(alertAt.GONE).toISOString(),'Updated is the re-alert');
  // #398: a long country stays on one line on a computer, as before.
  assert.equal(await page.$eval('[data-gainers-row="GONE"] [data-country]',td=>td.title),'','no title on a computer');
  if(shots){await page.setViewport({...desktop,width:1440,height:900});await sleep(400);await page.screenshot({path:`${shots}/t398-desktop.png`});await page.screenshot({path:`${shots}/t412-desktop.png`});await page.setViewport(desktop);}
  // #412: sorting. Price: biggest first, then reversed, missing ("—") last both ways, then back.
  await page.click(headButton('price'));
  assert.deepEqual(await order(page),['FRSH','AEHL','NEWT','GONE'],'price, biggest first');
  assert.deepEqual(await sortState(page),[['price','descending','desc']],'an arrow and aria-sort on Price');
  await page.click(headButton('price'));
  assert.deepEqual(await order(page),['NEWT','AEHL','FRSH','GONE'],'price, smallest first; missing still last');
  assert.deepEqual(await sortState(page),[['price','ascending','asc']]);
  await page.click(headButton('price'));
  assert.deepEqual(await order(page),['GONE','FRSH','AEHL','NEWT'],'a third click: newest alert first again');
  assert.deepEqual(await sortState(page),[]);
  // Words A to Z (the not-found FRSH has no country: last); the keyboard works (the heading is a button).
  await page.focus(headButton('country'));await page.keyboard.press('Enter');
  assert.deepEqual(await order(page),['GONE','AEHL','NEWT','FRSH'],'country A to Z, missing last');
  await page.keyboard.press('Enter');
  assert.deepEqual(await order(page),['NEWT','AEHL','GONE','FRSH'],'country Z to A, missing still last');
  // Borrow, dearest first: None, 1.50, .0725, ETB. Remembered on this device across a reload.
  await page.click(headButton('borrow'));
  assert.deepEqual(await order(page),['GONE','FRSH','NEWT','AEHL'],'borrow: none offered, then by price, then ETB');
  assert.deepEqual(await sortState(page),[['borrow','descending','desc']],'one sorted column at a time');
  if(shots){await page.setViewport({...desktop,width:1440,height:900});await sleep(400);await page.screenshot({path:`${shots}/t412-desktop-sorted.png`});await page.setViewport(desktop);}
  // Its own address opens it too (#412: in the remembered order).
  await page.goto(`${base}/chat?page=gainers-table`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('[data-gainers-row]',{visible:true,timeout:60000});
  assert.deepEqual(await order(page),['GONE','FRSH','NEWT','AEHL'],'the order is remembered');
  assert.deepEqual(await sortState(page),[['borrow','descending','desc']]);
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // A phone.
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(phone);
  await page.emulateTimezone('Europe/London');
  await context.setCookie({name:'longboard-chat-theme',value:'light',domain:'localhost',path:'/'});
  await signIn(page,base,'bob@example.test');
  await page.goto(`${base}/chat?page=gainers-table`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('[data-gainers-row]',{visible:true,timeout:60000});
  await sleep(500);
  const frame=await (await page.$('[data-gainers-table] table')).evaluateHandle(t=>t.parentElement);
  // #376: no sideways scroll anywhere, not the page and not the table's frame. Measured as
  // overflow (with a pixel of rounding), not exact column edges, so CI's wider fonts don't matter.
  const noSideways=async why=>{
   const over=await frame.evaluate(f=>({page:document.documentElement.scrollWidth-document.documentElement.clientWidth,frame:f.scrollWidth-f.clientWidth}));
   assert(over.page<=0&&over.frame<=1,`${why}: no sideways scroll on a phone ${JSON.stringify(over)}`);
  };
  await noSideways('closed');
  const box=await frame.boundingBox();
  assert(box.x>=0&&box.x+box.width<=phone.width+1,`the table's frame is inside the screen: ${JSON.stringify(box)}`);
  // #398: five columns: Symbol, Price, % today, Country, Borrow at TZ, with the computer's values.
  const shown=page=>page.$$eval('[data-gainers-row]',trs=>trs.map(tr=>[...tr.children].filter(c=>c.checkVisibility()).map(c=>c.textContent.replace(/^[▸▾]/,'').trim())));
  let table=await shown(page);
  assert.equal(await page.$eval('[data-gainers-toggle="NEWT"] [aria-hidden]',e=>e.textContent),'▸','a closed row shows ▸');
  assert.deepEqual(table.map(r=>r.length),[5,5,5,5],'five columns on a phone');
  assert.equal(await page.$$eval('[data-gainers-row] > *',cs=>cs.filter(c=>!c.checkVisibility()).length),0,'no hidden cells: a phone draws only its own columns');
  assert.deepEqual(table,[['GONE','—','—','British Virgin Islands','None'],['FRSH','$10.00','+100.0%','—','1.50'],['AEHL','$2.50','+52.3%','China','ETB'],['NEWT','$0.4512','-12.3%','U.S.','.0725']],'the same values as on a computer, newest alert first (a fresh device: no remembered order)');
  assert.deepEqual(await sortState(page),[],'a new device starts unsorted');
  assert.equal(await page.$('[data-gainers-row] [data-volume]'),null,'Volume is in the details now');
  // A long country wraps between words, two lines at most, and keeps the whole name in its title.
  const country=()=>page.$eval('[data-gainers-row="GONE"] [data-country]',td=>{const span=td.firstElementChild,line=parseFloat(getComputedStyle(span).lineHeight);return {title:td.title,lines:Math.round(span.getBoundingClientRect().height/line),borrowTop:Math.round(td.nextElementSibling.getBoundingClientRect().top-td.getBoundingClientRect().top)};});
  {const c=await country();assert.equal(c.title,'British Virgin Islands');assert(c.lines>=1&&c.lines<=2,JSON.stringify(c));assert.equal(c.borrowTop,0,'the row stays aligned');}
  // Icons in place of the header names, each still named and titled, and a key under the intro.
  const heads=await page.$$eval('[data-gainers-table] thead th[data-head]:not([data-head="symbol"])',ths=>ths.filter(t=>t.checkVisibility()).map(t=>({label:t.getAttribute('aria-label'),title:t.title,icon:t.querySelector('svg').checkVisibility(),name:t.querySelector('span').checkVisibility()})));
  const NAMES=['Price','% today','Country','Borrow at TZ'];
  assert.deepEqual(heads,NAMES.map(n=>({label:n,title:n,icon:true,name:false})),'icons on a phone, for the five columns');
  assert.equal(await page.$eval('[data-gainers-table] thead th',t=>t.textContent.trim()),'Symbol','Symbol stays text');
  const key=await page.$eval('[data-gainers-icon-key]',e=>({shown:e.checkVisibility(),text:e.textContent.replace(/\s+/g,' ').trim(),icons:e.querySelectorAll('svg').length}));
  assert.deepEqual(key,{shown:true,text:NAMES.join(' '),icons:4},'the icon key says which is which');
  if(shots){await page.screenshot({path:`${shots}/t398-phone.png`});await page.screenshot({path:`${shots}/t412-phone.png`});}
  // Tapping a row opens its details right under it; tapping again closes them.
  const toggle=sym=>`[data-gainers-toggle="${sym}"]`;
  assert.equal(await page.$eval(toggle('NEWT'),b=>b.tagName+' '+b.getAttribute('aria-expanded')),'BUTTON false');
  assert.equal(await page.$('[data-gainers-details]'),null,'closed at first');
  await page.tap('[data-gainers-row="NEWT"] [data-change]');
  await page.waitForSelector('[data-gainers-details="NEWT"]',{visible:true,timeout:5000});
  assert.equal(await page.$eval(toggle('NEWT'),b=>b.getAttribute('aria-expanded')),'true');
  assert.equal(await page.$eval(toggle('NEWT'),b=>b.getAttribute('aria-controls')),await page.$eval('[data-gainers-details="NEWT"] td',td=>td.id));
  assert.equal(await page.$eval('[data-gainers-details="NEWT"]',tr=>tr.previousElementSibling.dataset.gainersRow),'NEWT','right under its row');
  const details=sym=>page.$$eval(`[data-gainers-details="${sym}"] [data-detail]`,ds=>ds.map(d=>[d.querySelector('dt').textContent.trim(),d.querySelector('dd').textContent.trim()]));
  const newt=await details('NEWT');
  assert.deepEqual(newt.map(d=>d[0]),['Volume','IB overnight fee','Min since alert','Updated','Cash left','Inst Own %']);
  assert.deepEqual(newt[0],['Volume','850K'],'Volume comes first in the details');
  assert(Number(newt[2][1])>=5,newt[2][1]);
  {const at=await page.$eval('[data-gainers-details="NEWT"] [data-updated]',e=>e.dataset.updated);assert.equal(newt[3][1],clock(at,'Europe/London'),'#412: Updated in the phone\'s own time');}
  assert.deepEqual([newt[1],...newt.slice(4)],[['IB overnight fee','8.9%'],['Cash left','$31.5M · 304 mo'],['Inst Own %','12.5%']]);
  // #398: each detail's name is beside its value, on the same line.
  const beside=await page.$$eval('[data-gainers-details="NEWT"] [data-detail]',ds=>ds.map(d=>{const t=d.querySelector('dt').getBoundingClientRect(),v=d.querySelector('dd').getBoundingClientRect();return v.left>=t.right&&Math.abs(v.top-t.top)<6;}));
  assert.deepEqual(beside,newt.map(()=>true),'names beside values');
  await noSideways('open');
  if(shots){await sleep(300);await page.screenshot({path:`${shots}/t398-phone-open.png`});await page.screenshot({path:`${shots}/t412-phone-open.png`});}
  await page.tap(toggle('NEWT'));
  await page.waitForFunction(()=>!document.querySelector('[data-gainers-details="NEWT"]'),{timeout:5000});
  assert.equal(await page.$eval(toggle('NEWT'),b=>b.getAttribute('aria-expanded')),'false','tap again closes');
  // The keyboard works too: the symbol is a button.
  await page.focus(toggle('FRSH'));await page.keyboard.press('Enter');
  await page.waitForSelector('[data-gainers-details="FRSH"]',{visible:true,timeout:5000});
  assert.deepEqual((await details('FRSH'))[1],['IB overnight fee','—']);
  assert.deepEqual((await details('FRSH'))[0],['Volume','12.3M']);
  await page.keyboard.press('Space');
  await page.waitForFunction(()=>!document.querySelector('[data-gainers-details="FRSH"]'),{timeout:5000});
  // An open row stays open across the 15-second re-read, and its values update.
  await page.tap('[data-gainers-row="GONE"] th');
  await page.waitForSelector('[data-gainers-details="GONE"]',{visible:true,timeout:5000});
  assert.deepEqual((await details('GONE')).slice(0,2),[['Volume','—'],['IB overnight fee','—']]);
  // #394: in the details, Cash left says CFP; tapping it shows the words and leaves the details open.
  assert.deepEqual((await details('GONE'))[4],['Cash left','CFP']);
  await page.tap('[data-gainers-details="GONE"] [data-cfp] button');
  await page.waitForSelector('[data-gainers-details="GONE"] [data-cfp-words]',{visible:true,timeout:5000});
  assert.equal(await page.$eval('[data-gainers-details="GONE"] [data-cfp-words]',e=>e.textContent),'Cash Flow Positive');
  assert.equal(await page.$eval(toggle('GONE'),b=>b.getAttribute('aria-expanded')),'true','tapping CFP doesn\'t close the row');
  await noSideways('CFP words shown');
  if(shots){await sleep(300);await page.screenshot({path:`${shots}/t394-phone-cfp.png`});}
  await page.tap('[data-gainers-details="GONE"] [data-detail="volume"] dt');
  await page.waitForFunction(()=>!document.querySelector('[data-cfp-words]'),{timeout:5000});
  assert.equal(await page.$eval(toggle('GONE'),b=>b.getAttribute('aria-expanded')),'true','tapping elsewhere hides the words, the row stays open');
  await ib([{ticker:'GONE',feePct:22.2988,rebatePct:-18.4,available:200000}]);
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-gainers-details="GONE"] dd')].map(d=>d.textContent).join('|').includes('22.3%'),{timeout:40000});
  assert.equal(await page.$eval(toggle('GONE'),b=>b.getAttribute('aria-expanded')),'true','still open after the re-read');
  await noSideways('open after a re-read');
  // #398: a 360px phone fits too, with a row open.
  await page.setViewport({...phone,width:360,height:780});
  await sleep(400);
  await noSideways('360px wide');
  {const c=await country();assert(c.lines>=1&&c.lines<=2,JSON.stringify(c));assert.equal(c.borrowTop,0,'the row stays aligned at 360px');}
  if(shots)await page.screenshot({path:`${shots}/t398-phone-360.png`});
  // #412: a tap on a heading icon sorts on a phone too: % today, biggest first; again reverses. The
  // arrow still fits at 360px, and the open row stays open.
  await page.tap(headButton('change'));
  assert.deepEqual(await order(page),['FRSH','AEHL','NEWT','GONE'],'% today, biggest first; missing last');
  assert.deepEqual(await sortState(page),[['change','descending','desc']]);
  assert.equal(await page.$eval(toggle('GONE'),b=>b.getAttribute('aria-expanded')),'true','sorting keeps an open row open');
  assert.equal(await page.$eval('[data-gainers-details="GONE"]',tr=>tr.previousElementSibling.dataset.gainersRow),'GONE','its details move with it');
  await noSideways('sorted at 360px');
  await page.tap(headButton('change'));
  assert.deepEqual(await order(page),['NEWT','AEHL','FRSH','GONE'],'% today, smallest first; missing still last');
  await page.tap(toggle('GONE'));
  await page.waitForFunction(()=>!document.querySelector('[data-gainers-details]'),{timeout:5000});
  await page.setViewport(phone);await sleep(300);
  await page.tap(headButton('symbol'));
  assert.deepEqual(await order(page),['AEHL','FRSH','GONE','NEWT'],'Symbol A to Z');
  await page.tap(headButton('borrow'));
  assert.deepEqual(await order(page),['GONE','FRSH','NEWT','AEHL'],'Borrow at TZ, dearest first');
  await noSideways('sorted at 390px');
  if(shots){await sleep(300);await page.screenshot({path:`${shots}/t412-phone-sorted.png`});}
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 console.log('chat-gainers-table browser: passed');
}finally{await browser.close();}
