// #386 Booker Stock Club on a computer and a phone, against the fixture on this test's own ports
// (localhost:3386, database 127.0.0.1:54386). Polygon is the fake in chat-stock-club-preload.mjs;
// facts and borrow are posted through the lookup route (synthetic; no DilutionTracker or TradeZero).
//  - the cron needs CRON_SECRET; #403: its #1 is today's Longboard morning report #1 (CNAA; an
//    older day's report is ignored), posted once, and the room gets one stock a day: a later report
//    version with a new #1 (NEWA) is ranked first but not posted; the lookup route asks for the
//    club's candidates that never alerted in Gainers, and the card reads country and borrow fresh;
//  - the room is in the sidebar for a Gainers member; each post is a card with symbol, price,
//    % today, volume, country, inst own, borrow at TZ, levels above price and a chart; read-only;
//  - an admin sets the pick by hand, which posts and stops automatic changes until turned back on
//    (and even then nothing automatic posts: the day already has its stock);
//  - a phone shows the card with no sideways scroll; signed out is refused.
// CHAT_SHOT_DIR saves t386-desktop.png and t386-phone.png.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3386',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54386';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,CRON='synthetic-local-cron',LOOKUP='synthetic-gainers-lookup-token-never-a-production-secret';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const rowsOf=r=>r.rows??r;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// The cron.
const cron=async(token=CRON)=>{const r=await fetch(`${base}/api/cron/stock-club`,{headers:token?{authorization:`Bearer ${token}`}:{}});return {status:r.status,body:await r.json().catch(()=>({}))};};
assert.equal((await cron(null)).status,401,'no token');
assert.equal((await cron('x'.repeat(40))).status,401,'wrong token');
const lookup=(body)=>fetch(`${base}/api/chat/gainers/facts`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${LOOKUP}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
const save=async body=>{const r=await lookup({notFound:false,country:null,cashUsd:null,cashMonthsLeft:null,cashFlowPositive:false,instOwnPct:null,...body});assert.equal(r.status,200,await r.text());};
const borrow=async body=>{const r=await lookup({kind:'borrow',etb:false,pricePerShare:null,locateType:null,...body});assert.equal(r.status,200,await r.text());};
const posts=async()=>rowsOf(await sql(`select body,author_label,bot_slug from longboard_chat_messages where room_slug='club' order by created_at`));

// #403: the club's #1 is today's Longboard morning report #1 (its newest version; an older day's
// report doesn't count), and the room gets one stock a day.
const nyDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const yesterday=new Date(Date.parse(`${nyDay}T12:00:00Z`)-86_400_000).toISOString().slice(0,10);
let reportAt=Date.now()-3_600_000;
// The chat fixture doesn't load the morning report's migrations: the columns the club reads.
await sql(`create table if not exists public.morning_email_archive(id uuid primary key default gen_random_uuid(),sent_date date not null,subject text not null,stocks_json jsonb not null,html text not null,status text not null default 'success',created_at timestamptz not null default now())`);
const report=async(day,tickers)=>sql(`insert into morning_email_archive(sent_date,subject,stocks_json,html,status,created_at) values($1,'Morning Brief',$2::jsonb,'<p>synthetic</p>','success',$3)`,[day,JSON.stringify(tickers.map(ticker=>({ticker}))),new Date(reportAt+=60_000).toISOString()]);
await report(yesterday,['USAA']); // Friday's report, still refreshing on Monday morning
await report(nyDay,['CNAA','NEWA']);
await save({ticker:'USAA',country:'U.S.',cashUsd:12_000_000,cashMonthsLeft:20,instOwnPct:3.2});
let run=await cron();
assert.equal(run.status,200,JSON.stringify(run));
assert.deepEqual([run.body.status,run.body.from,run.body.top,run.body.candidates],['posted','report','CNAA',['CNAA','USAA','NEWA']],"today's report #1 first, then the morning report's rules");
run=await cron();assert.equal(run.body.status,'same','the same #1 never posts twice');
let list=await posts();assert.equal(list.length,1);
assert.deepEqual([list[0].author_label,list[0].bot_slug],['Booker Stock Club','club']);
assert.match(list[0].body,/^#1 stock of the day: CNAA \(China Alpha Holdings\)\n\$2\.50 · \+60\.0% today · Volume 800K\nCountry: looking up… · Inst own: — · Borrow at TZ: checking…\nLevels above: \$/);
// The lookup program is asked about the club's candidates too (none of them alerted in Gainers).
const asked=await (await lookup()).json();
assert.deepEqual(asked.needs.map(n=>n.ticker).sort(),['CNAA','NEWA'],'candidates without facts are looked up');
assert.deepEqual(asked.borrow.map(n=>n.ticker).sort(),['CNAA','NEWA','USAA'],'the top three get a borrow check');
await save({ticker:'CNAA',country:'China',cashUsd:5_000_000,cashMonthsLeft:6,instOwnPct:12.5});
await borrow({ticker:'CNAA',status:'offered',pricePerShare:0.04,locateType:'Locate'});
await borrow({ticker:'USAA',status:'etb',etb:true});
await report(nyDay,['NEWA','CNAA']); // a later version of today's report with a new #1
run=await cron();
assert.deepEqual([run.body.status,run.body.top,run.body.candidates],['done_for_day','NEWA',['NEWA','CNAA','USAA']],'one stock a day: a new #1 later is not posted');
assert.equal((await posts()).length,1);
// Signed out: no card.
assert.equal((await fetch(`${base}/api/chat/club/pick?message=00000000-0000-4000-8000-000000000001`)).status,401);

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const openRoom=async(page,cards)=>{
 await page.goto(`${base}/chat?room=club`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(n=>[...document.querySelectorAll('[data-club-card]')].filter(e=>e.checkVisibility()).length>=n,{timeout:90000},cards);
};
const card=(page,sym)=>page.evaluate(sym=>{
 const el=[...document.querySelectorAll(`[data-club-card="${sym}"]`)].find(e=>e.checkVisibility());
 const f=name=>el.querySelector(`[data-club-field="${name}"] dd`)?.textContent??el.querySelector(`[data-club-field="${name}"]`)?.textContent;
 return {symbol:f('symbol'),price:f('price'),change:f('change'),volume:f('volume'),country:f('country'),inst:f('inst-own'),borrow:f('borrow'),cap:f('market-cap'),
  levels:[...el.querySelectorAll('[data-club-level]')].map(li=>li.dataset.clubLevel),chartLevels:[...el.querySelectorAll('[data-club-chart-level]')].length,
  chart:!!el.querySelector('[data-club-chart] path')};
},sym);
try{
 // A Gainers member on a computer.
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(desktop);
  await context.setCookie({name:'longboard-chat-theme',value:'light',domain:'localhost',path:'/'});
  await signIn(page,base,'bob@example.test');
  const names=await page.evaluate(()=>{const nav=[...document.querySelectorAll('#chat-room-navigation')].find(e=>e.checkVisibility());return [...nav.querySelectorAll('a')].filter(a=>a.checkVisibility()).map(a=>a.textContent.trim());});
  assert(names.includes('Booker Stock Club'),`in the sidebar: ${names.join(' | ')}`);
  assert(names.indexOf('Booker Stock Club')>names.indexOf('Gainers'),'under Gainers');
  await openRoom(page,1);
  const cn=await card(page,'CNAA');
  assert.deepEqual({...cn,levels:undefined,chartLevels:undefined},{symbol:'CNAA',price:'$2.50',change:'+60.0% today',volume:'800K',country:'China',inst:'12.5%',borrow:'$0.04',cap:'$20M',chart:true,levels:undefined,chartLevels:undefined});
  assert(cn.levels.length>=3&&cn.levels.includes('missed')&&cn.levels.includes('cmp')&&cn.levels.includes('sma200'),`missed pivots, CMP and 200 SMA above price: ${cn.levels}`);
  assert(cn.chartLevels>=1,'levels drawn on the chart');
  // Country, inst own and borrow were saved after the post went up: the card reads them fresh.
  const prices=await page.$$eval('[data-club-card="CNAA"] [data-club-level]',lis=>lis.map(li=>Number(li.querySelector('span').textContent.replace('$',''))));
  assert(prices.every(p=>p>2.5)&&prices.every((p,i)=>!i||p>=prices[i-1]),`above price, nearest first: ${prices}`);
  assert.equal(await page.$('[data-club-admin]'),null,'no admin strip for a member');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('textarea[aria-label^="Message "]')].some(e=>e.checkVisibility())),false,'no composer: read-only');
  const footer=await page.evaluate(()=>[...document.querySelectorAll('strong')].filter(e=>e.checkVisibility()).map(e=>e.textContent).includes('Read-only'));
  assert(footer,'says read-only');
  // Members can't post there, or set the pick.
  const tries=await page.evaluate(async()=>{
   const send=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({room:'club',action:'send',body:'hello',clientId:crypto.randomUUID()})});
   const pick=await fetch('/api/chat/club/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticker:'NEWA'})});
   return [send.status,pick.status];
  });
  assert.deepEqual(tries,[403,403]);
  if(shots){await sleep(500);await page.screenshot({path:`${shots}/t386-desktop.png`});}
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
  await openRoom(page,1);
  await sleep(500);
  const fit=await page.evaluate(()=>{const el=[...document.querySelectorAll('[data-club-card="CNAA"]')].find(e=>e.checkVisibility());const box=el.getBoundingClientRect();return {over:document.documentElement.scrollWidth-document.documentElement.clientWidth,left:box.left,right:box.right,inner:el.scrollWidth-el.clientWidth};});
  assert(fit.over<=0&&fit.inner<=1,`no sideways scroll on a phone ${JSON.stringify(fit)}`);
  assert(fit.left>=0&&fit.right<=phone.width,`the card is inside the screen ${JSON.stringify(fit)}`);
  const cn=await card(page,'CNAA');assert.deepEqual([cn.symbol,cn.country,cn.borrow,cn.chart],['CNAA','China','$0.04',true]);
  if(shots){await sleep(400);await page.screenshot({path:`${shots}/t386-phone.png`});}
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // An admin sets the pick by hand. (This fixture starts everyone as a member; Alice becomes the admin.)
 await sql("update profiles set role='admin' where email='alice@example.test'");
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(desktop);
  await signIn(page,base,'alice@example.test');
  await openRoom(page,1);
  await page.waitForFunction(()=>/Automatic picks today: on/.test(document.querySelector('[data-club-admin]')?.textContent??''),{timeout:30000});
  assert.match(await page.$eval('[data-club-candidates]',e=>e.textContent),/NEWA \+90\.0% \(country unknown\).*CNAA \+60\.0% \(China\).*USAA \+150\.0% \(U\.S\.\)/);
  await page.type('[data-club-admin] input','usaa');
  await page.click('[data-club-admin] button[type="submit"]');
  await page.waitForFunction(()=>/off \(set by hand\)/.test(document.querySelector('[data-club-admin]')?.textContent??''),{timeout:60000});
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-club-card="USAA"]')].some(e=>e.checkVisibility()),{timeout:60000});
  assert.match(await page.$eval('[data-club-card="USAA"]',e=>e.textContent),/Today's pick/);
  run=await cron();assert.equal(run.body.status,'locked','no automatic changes after an admin pick');
  await (await page.evaluateHandle(()=>[...document.querySelectorAll('[data-club-admin] button')].find(b=>/back on/.test(b.textContent)))).click();
  await page.waitForFunction(()=>/Automatic picks today: on/.test(document.querySelector('[data-club-admin]')?.textContent??''),{timeout:30000});
  run=await cron();assert.equal(run.body.status,'done_for_day','back on: the day already has its stock, so nothing automatic posts');
  assert.equal((await posts()).length,2);
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 console.log('chat-stock-club browser test passed');
}finally{await browser.close();}
