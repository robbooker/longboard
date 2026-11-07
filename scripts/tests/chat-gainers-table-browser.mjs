// #371 Gainers Table on a computer and a phone, against the fixture on this test's own ports
// (localhost:3371, database 127.0.0.1:54371). Synthetic alerts and facts only.
//  - the row sits directly under Gainers and opens a table, not messages;
//  - one row per stock that alerted today with 150K+ shares (no after-hours, not yesterday),
//    newest alert first; seeded countries show at once, missing facts show "looking up…";
//  - facts saved through the lookup route fill in without a reload, and a new alert appears on top;
//  - the minutes count up on their own;
//  - no sideways scroll on a phone; signed out and wrong tokens are refused.
// CHAT_SHOT_DIR saves t371-desktop.png and t371-phone.png.
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
const alert=(sym,secondsAgo,vol,extra='')=>sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source++,ago(secondsAgo),`🚨 ${sym} (+${(40+source).toFixed(1)}%)\nPrice: $2.50\nVolume: ${vol.toLocaleString('en-US')}\nMarket Cap: 12.5M${extra}`]);
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

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const desktop={width:1280,height:860,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
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
  assert.deepEqual(table[1],['NEWT','5','U.S.','$31.5M · 304 mo','12.5%']);
  assert.deepEqual(table[0].slice(2),['China','looking up…','looking up…'],'seeded country; the rest is being looked up');
  assert.deepEqual(table[2].slice(2),['looking up…','looking up…','looking up…']);
  assert.equal(await page.$$eval('[data-gainers-row="GONE"] [data-looking-up]',e=>e.length),3);
  const headers=await page.$$eval('[data-gainers-table] thead th',ths=>ths.map(t=>t.textContent.trim()));
  assert.deepEqual(headers,['Symbol','Min since alert','Country','Cash left','Inst Own %']);
  if(shots){await sleep(400);await page.screenshot({path:`${shots}/t371-desktop.png`});}
  // The minutes count up by themselves: AEHL's latest alert was 52 seconds old when it went in.
  assert(['0','1'].includes(await cell(page,'AEHL',1)));
  await page.waitForFunction(()=>document.querySelector('[data-gainers-row="AEHL"] [data-minutes]')?.textContent==='1',{timeout:30000});
  const minutesBefore=await cell(page,'GONE',1);assert(Number(minutesBefore)>=12,minutesBefore);
  // Facts fill in, and a new alert comes in on top, without a reload.
  await save({ticker:'AEHL',country:'China',cashUsd:31_500_000,cashMonthsLeft:304.7,instOwnPct:0.1});
  await save({ticker:'GONE',cashFlowPositive:true,country:'Greece',instOwnPct:2});
  await alert('FRSH',5,700000);
  await page.waitForFunction(()=>document.querySelector('[data-gainers-row]')?.dataset.gainersRow==='FRSH'&&!document.querySelector('[data-gainers-row="AEHL"] [data-looking-up]'),{timeout:40000});
  table=await rows(page);
  assert.deepEqual(table.map(r=>r[0]),['FRSH','AEHL','NEWT','GONE']);
  assert.deepEqual(table[1].slice(2),['China','$31.5M · 304 mo','0.1%']);
  assert.deepEqual(table[3].slice(2),['Greece','Cash flow positive','2%']);
  assert.deepEqual(table[0].slice(1),['0','looking up…','looking up…','looking up…']);
  await save({ticker:'FRSH',notFound:true});
  await page.waitForFunction(()=>!document.querySelector('[data-gainers-row="FRSH"] [data-looking-up]'),{timeout:40000});
  assert.deepEqual((await rows(page))[0].slice(2),['—','—','—'],'not on DilutionTracker');
  // Its own address opens it too.
  await page.goto(`${base}/chat?page=gainers-table`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('[data-gainers-row]',{visible:true,timeout:60000});
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // A phone.
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(phone);
  await context.setCookie({name:'longboard-chat-theme',value:'light',domain:'localhost',path:'/'});
  await signIn(page,base,'bob@example.test');
  await page.goto(`${base}/chat?page=gainers-table`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('[data-gainers-row]',{visible:true,timeout:60000});
  await sleep(500);
  const sideways=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(sideways<=0,`no sideways page scroll on a phone (${sideways}px)`);
  const inner=await page.$eval('[data-gainers-table] table',t=>t.parentElement.scrollWidth-t.parentElement.clientWidth);
  assert(inner<=0,`the table fits the phone (${inner}px too wide)`);
  const box=await (await page.$('[data-gainers-table] table')).boundingBox();
  assert(box.x>=0&&box.x+box.width<=phone.width,`table inside the screen: ${JSON.stringify(box)}`);
  assert.equal((await rows(page)).length,4);
  if(shots)await page.screenshot({path:`${shots}/t371-phone.png`});
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 console.log('chat-gainers-table browser: passed');
}finally{await browser.close();}
