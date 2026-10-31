// #340 LB Review and the daily gainers page, on a computer and a phone, against the fixture on this
// test's own ports (localhost:3340, database 127.0.0.1:54340). Synthetic data; Polygon is a fake here.
//  - the bot scripts make the account and token; the bot reaches LB Review and nothing else;
//  - the real job (scripts/gainers-daily/run.py) runs for a real night: one page, one post, twice over;
//    a holiday posts nothing; a failed save posts nothing and tells Rob;
//  - a member opens the room, the post and its link; six charts draw; no sideways scroll on a phone;
//  - signed out can't open the page; the route refuses a wrong token.
// CHAT_SHOT_DIR saves screenshots. LB_REVIEW_PAYLOAD=<json> stores that day's data instead of the job's,
// and LB_REVIEW_TEXT=<file> saves the page's text, for comparing with an approved page.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3340',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54340';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,DAILY='synthetic-gainers-daily-token-never-a-production-secret';
const DAY=process.env.LB_REVIEW_DAY||'2026-10-30',HOLIDAY='2026-10-29',FAILDAY='2026-10-28';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const rowsOf=r=>r.rows??r;
const dir=await mkdtemp(join(tmpdir(),'chat-lb-review-'));
const pexec=promisify(execFile);
const script=async(file,...args)=>{const {stdout,stderr}=await pexec('node',[`scripts/chat-bots/${file}`,...args],{env:{...process.env,NODE_OPTIONS:'',NEXT_PUBLIC_SUPABASE_URL:fixture,SUPABASE_SERVICE_ROLE_KEY:'test-service-role'}});return stdout+stderr;};

// The bot. The fixture has no Auth admin API, so the login row is added here.
const botId='00000000-0000-4000-8000-0000000000bb',tokenFile=join(dir,'bot.token');
await sql('insert into auth.users(id) values($1)',[botId]);
await sql(`insert into profiles(id,email,role) values($1,'lb-review@bot.longboard.invalid','user')`,[botId]);
assert.match(await script('create-lb-review-bot.mjs'),/Gainers Review is ready/);
assert.match(await script('create-lb-review-bot.mjs'),/Gainers Review is ready/,'safe to run again');
const minted=await script('lb-review-token.mjs','mint','--out',tokenFile),token=(await readFile(tokenFile,'utf8')).trim();
assert(!minted.includes(token),'the token is never printed');
const asBot=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.status;};
for(const room of ['social','main','gainers','developers','admins','whats-new'])assert.notEqual(await asBot(`/api/chat/history?room=${room}`),200,`bot can't read ${room}`);
assert.equal(await asBot('/api/chat/history?room=lb-review'),200,'bot reads its room');
assert.equal(await asBot('/api/chat',{room:'social',action:'send',body:'nope',clientId:crypto.randomUUID()}),403,"bot can't post elsewhere");
assert.notEqual(await asBot('/api/chat/inbox'),200,'bot has no direct messages');

// The route.
const daily=(path,init={})=>fetch(`${base}/api/chat/gainers/daily${path}`,init);
assert.equal((await daily(`?alerts=${DAY}`)).status,401,'no token');
assert.equal((await daily(`?alerts=${DAY}`,{headers:{Authorization:'Bearer '+'x'.repeat(50)}})).status,401,'wrong token');

// Alerts for a real night, through the same function the live feed uses.
const SYMS=['AAAA','BBBB','CCCC','DDDD','EEEE','FFFF','GGGG','HHHH'];let source=1;
for(const [i,sym] of SYMS.entries())await sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source++,`${DAY} 14:${10+i}:30+00`,`🚨 ${sym} (+${90-i*7}.5%)\nPrice: $${2+i}.50\nVolume: ${(300000+i*1000).toLocaleString('en-US')}\nMarket Cap: 12.5M`]);
await sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source++,`${DAY} 20:30:00+00`,'🚨 LATE (+300%)\nPrice: $9.00\nVolume: 9,000,000\nMarket Cap: 1M\nAfter-Hours']);
await sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source++,`${FAILDAY} 14:10:30+00`,'🚨 AAAA (+50%)\nPrice: $3.50\nVolume: 400,000\nMarket Cap: 12.5M']);

// Fake Polygon: a day of 2-minute bars, hourly history, and SPY on trading days only.
const polygon=createServer((req,res)=>{
 const m=new URL(req.url,'http://x').pathname.match(/ticker\/([^/]+)\/range\/(\d+)\/(\w+)\/([\d-]+)\/([\d-]+)/);
 const results=[];const [,sym,,span,,to]=m;
 if(to!==HOLIDAY){
  const start=Date.parse(`${to}T13:30:00Z`),step=span==='hour'?3600000:120000,n=span==='hour'?7:195;
  const seed=sym.charCodeAt(0)-60;
  for(let i=0;i<n;i++){const c=seed/10+Math.sin(i/9)*.4+i*.004;results.push({t:start+i*step,o:+(c-.02).toFixed(3),h:+(c+.08).toFixed(3),l:+(c-.09).toFixed(3),c:+c.toFixed(3),v:2000+i*30});}
 }
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({results}));
});
await new Promise(r=>polygon.listen(0,'127.0.0.1',r));
const notes=[];
const notifier=createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{notes.push(JSON.parse(b));res.writeHead(200,{'content-type':'application/json'});res.end('{}');});});
await new Promise(r=>notifier.listen(0,'127.0.0.1',r));
for(const [f,v] of [['daily',DAILY],['notify','n']])await writeFile(join(dir,f),v);
await writeFile(join(dir,'env'),'POLYGON_API_KEY=fake\n');
await writeFile(join(dir,'countries.json'),JSON.stringify({AAAA:{country:'China'},BBBB:{country:'U.S.'}}));
const job=async(env,...args)=>{try{const {stdout}=await pexec('python3',['-I','scripts/gainers-daily/run.py',...args],{env:{...process.env,GAINERS_CHAT_URL:base,GAINERS_POLYGON_URL:`http://127.0.0.1:${polygon.address().port}`,GAINERS_NOTIFY_URL:`http://127.0.0.1:${notifier.address().port}/notify`,GAINERS_STATE_DIR:join(dir,'state'),GAINERS_DAILY_TOKEN_FILE:join(dir,'daily'),GAINERS_BOT_TOKEN_FILE:tokenFile,GAINERS_NOTIFY_TOKEN_FILE:join(dir,'notify'),GAINERS_POLYGON_ENV:join(dir,'env'),GAINERS_COUNTRIES:join(dir,'countries.json'),...env}});return {code:0,stdout};}catch(e){return {code:e.code,stdout:e.stdout,stderr:e.stderr};}};
const posts=async()=>rowsOf(await sql(`select body from longboard_chat_messages where room_slug='lb-review' order by created_at`)).map(r=>r.body);
const pageDays=async()=>rowsOf(await sql('select trading_day::text d from chat_gainers_pages order by 1')).map(r=>r.d);

// Holiday: no page, no post, no note.
let run=await job({},'--date',HOLIDAY);assert.equal(run.code,0,JSON.stringify(run));assert.match(run.stdout,/holiday/);
assert.deepEqual(await posts(),[]);assert.deepEqual(await pageDays(),[]);assert.deepEqual(notes,[]);
// Failed save (the wrong token here): nothing posted, Rob told, and no secret in the note.
await writeFile(join(dir,'wrong'),'y'.repeat(50));
run=await job({GAINERS_DAILY_TOKEN_FILE:join(dir,'wrong')},'--date',FAILDAY);assert.equal(run.code,1);
assert.deepEqual(await posts(),[],'failed run posts nothing');assert.equal(notes.length,1,'Rob is told');
assert.match(notes[0].body,/did not finish/);assert.equal(notes[0].dm,'rob');notes.length=0;
// A real night, then the same day again.
run=await job({},'--date',DAY);assert.equal(run.code,0,JSON.stringify(run));
run=await job({},'--date',DAY);assert.equal(run.code,0,JSON.stringify(run));
const posted=await posts();assert.equal(posted.length,1,'exactly one post after two runs');
const postText=posted[0],link=`${base}/gainers/${DAY}`;
assert(postText.includes(link),postText);
assert(postText.includes('Friday\'s top gainers, Oct 30, 2026'),postText);
assert(postText.includes('AAAA (China)')&&postText.includes('CCCC (Unknown)')&&postText.includes('FFFF (Unknown)'),postText);
assert(!postText.includes('GGGG')&&!postText.includes('LATE'),'top six only, no after hours');
assert.equal((await pageDays()).length,1,'one row for the day');
assert.equal(new Set(notes.map(n=>n.clientId)).size,1,'unknown countries reported once: the same note id on both runs');assert.match(notes[0].body,/CCCC/);
if(process.env.LB_REVIEW_PAYLOAD){const r=await daily('',{method:'POST',headers:{Authorization:`Bearer ${DAILY}`,'Content-Type':'application/json'},body:await readFile(process.env.LB_REVIEW_PAYLOAD,'utf8')});assert.equal(r.status,200,await r.text());}

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const shot=async(p,name,full=false)=>{if(shots){await pause(600);await p.screenshot({path:`${shots}/${name}.png`,fullPage:full});}};
try{
 // Signed out.
 const out=await browser.createBrowserContext(),outPage=await out.newPage();
 await outPage.goto(link,{waitUntil:'domcontentloaded'});
 assert.match(outPage.url(),/\/chat\/login\?room=lb-review/,'signed out goes to the login page');
 assert(!(await outPage.content()).includes('AAAA'),'no data for a signed-out visitor');
 await out.close();
 for(const [label,viewport] of [['computer',desktop],['phone',phone]]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(viewport);
  await signIn(page,base,'bob@example.test');
  await page.goto(`${base}/chat?room=lb-review`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>[...document.querySelectorAll('article')].some(e=>e.checkVisibility()&&e.innerText.includes('top gainers')),{timeout:60000});
  await page.waitForFunction(()=>[...document.querySelectorAll('textarea')].some(e=>e.checkVisibility()&&e.getAttribute('aria-label')==='Message LB Review'),{timeout:30000});
  await shot(page,`room-${label}`);
  const anchor=await page.evaluate(day=>{const a=[...document.querySelectorAll('article a')].find(e=>e.checkVisibility()&&e.href.includes(`/gainers/${day}`));return a?.href;},DAY);
  assert.equal(anchor,link,'the post has a working link');
  await page.evaluate(()=>[...document.querySelectorAll('article')].find(e=>e.checkVisibility()&&e.innerText.includes('top gainers'))?.scrollIntoView({block:'center'}));
  await shot(page,`post-${label}`);
  const response=await page.goto(link,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);
  await page.waitForSelector('[data-gainers-page]');
  await page.waitForFunction(()=>document.querySelectorAll('[data-gainers-chart] canvas').length>=6,{timeout:60000});
  assert.equal((await page.$$('[data-gainers-chart]')).length,6,'six charts');
  const text=await page.evaluate(()=>document.body.innerText);
  assert(!/bought|if a trader|at the signal/i.test(text),'the buy section is gone');
  assert(/not trade advice/i.test(text),'research wording stays');
  const sideways=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert.equal(sideways,0,`${label}: no sideways scroll`);
  if(process.env.LB_REVIEW_TEXT)await writeFile(process.env.LB_REVIEW_TEXT.replace('.txt',`-${label}.txt`),text);
  await shot(page,`page-${label}`);await shot(page,`page-${label}-full`,true);
  // Other days don't exist, bad addresses don't crash.
  assert.equal((await page.goto(`${base}/gainers/2001-01-01`)).status(),404);
  assert.equal((await page.goto(`${base}/gainers/not-a-date`)).status(),404);
  assert.deepEqual(errors,[],`${label}: page errors`);
  await context.close();
 }
 console.log('PASS LB Review room, bot, job, page and sign-in rules.');
}finally{await browser.close();polygon.close();notifier.close();await rm(dir,{recursive:true,force:true});}
