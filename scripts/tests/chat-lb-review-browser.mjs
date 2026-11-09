// #340 LB Review and the daily gainers page, on a computer and a phone, against the fixture on this
// test's own ports (localhost:3340, database 127.0.0.1:54340). Synthetic data; Polygon is a fake here.
//  - the bot scripts make the account and token; the bot reaches LB Review and nothing else;
//  - the real job (scripts/gainers-daily/run.py) runs for a real night: one page, one post, twice over;
//    a holiday posts nothing; a failed save posts nothing and tells Rob;
//  - a member opens the room, the post and its link; six charts draw; no sideways scroll on a phone;
//  - signed out can't open the page; the route refuses a wrong token;
//  - #343: the page's light and dark choice, shared with chat; every post in the room has its own header.
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

// #343: another day's page, and the bot's posts minutes apart; Bob posts twice in a row in Social as the control.
const OTHERDAY='2026-10-22',FORMER=`${base}/gainers/${OTHERDAY}`;
await sql(`insert into chat_gainers_pages(trading_day,data) select $1::date,jsonb_set(data,'{day}',to_jsonb($1::text)) from chat_gainers_pages where trading_day=$2`,[OTHERDAY,DAY]);
for(const [ago,text] of [[1,'Thursday\'s top gainers, Oct 29, 2026'],[2,'Wednesday\'s top gainers, Oct 28, 2026']])await sql(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,bot_slug,created_at) select guest_id,member_id,room_slug,author_label,$1,bot_slug,created_at-make_interval(mins=>$2::int) from longboard_chat_messages where room_slug='lb-review' and body like '%Oct 30, 2026%'`,[text,ago]);
const bobMember=rowsOf(await sql(`select m.id from longboard_chat_members m where m.user_id='00000000-0000-4000-8000-000000000002'`))[0]?.id;assert(bobMember,'Bob is a member');
for(const [ago,text] of [[2,'Social control one'],[1,'Social control two']])await sql(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,created_at) values($1,$1,'social','Bob',$2,now()-make_interval(mins=>$3::int))`,[bobMember,text,ago]);

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const shot=async(p,name,full=false)=>{if(shots){await pause(600);await p.screenshot({path:`${shots}/${name}.png`,fullPage:full});}};
// #343: the theme control on a page already open, for one viewport.
const KEY='longboard-public-chat-theme-v1',LIGHT=[255,255,255],DARK=[23,30,27];
const readTheme=p=>p.evaluate(()=>{const page=document.querySelector('[data-gainers-page]');return {attr:page.getAttribute('data-gainers-theme'),panel:getComputedStyle(page).getPropertyValue('--panel').trim(),pressed:document.querySelector('[aria-label="Page theme"] [aria-pressed="true"]')?.textContent};});
const chartIs=(p,rgb)=>p.waitForFunction(want=>[...document.querySelectorAll('[data-gainers-chart]')].every(box=>{const canvas=box.querySelector('canvas');if(!canvas)return false;const d=canvas.getContext('2d').getImageData(2,2,1,1).data;return d[0]===want[0]&&d[1]===want[1]&&d[2]===want[2];}),{timeout:15000},rgb);
const openDay=async(p,url)=>{await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.querySelectorAll('[data-gainers-chart] canvas').length>=6&&document.querySelector('[aria-label="Page theme"] [aria-pressed="true"]'),{timeout:60000});};
const theme=async(page,viewport,label)=>{
 const press=async name=>{const handle=await page.evaluateHandle(n=>[...document.querySelectorAll('[aria-label="Page theme"] button')].find(b=>b.textContent===n),name);if(viewport.hasTouch)await handle.tap();else await handle.click();};
 const device=value=>page.emulateMediaFeatures([{name:'prefers-color-scheme',value}]);
 // Never chosen: follows the device, also when the device changes. An unknown saved value counts as never chosen.
 await page.evaluate(k=>localStorage.removeItem(k),KEY);await device('dark');await openDay(page,link);
 assert.deepEqual(await readTheme(page),{attr:null,panel:'#171e1b',pressed:'Dark'},`${label}: follows a dark device`);await chartIs(page,DARK);
 await device('light');await page.waitForFunction(()=>document.querySelector('[aria-label="Page theme"] [aria-pressed="true"]').textContent==='Light');
 assert.deepEqual(await readTheme(page),{attr:null,panel:'#fff',pressed:'Light'},`${label}: follows a light device`);await chartIs(page,LIGHT);
 await page.evaluate(k=>localStorage.setItem(k,'junk'),KEY);await device('dark');await openDay(page,link);
 assert.equal((await readTheme(page)).pressed,'Dark',`${label}: junk is ignored`);
 // Choosing beats the device, redraws the charts, survives a reload and another day's page.
 await press('Light');await chartIs(page,LIGHT);
 assert.deepEqual(await readTheme(page),{attr:'light',panel:'#fff',pressed:'Light'},`${label}: Light on a dark device`);
 assert.equal(await page.evaluate(k=>localStorage.getItem(k),KEY),'light','saved where chat keeps it');
 await shot(page,`after-page-light-${label}`);
 await openDay(page,link);assert.deepEqual(await readTheme(page),{attr:'light',panel:'#fff',pressed:'Light'},`${label}: after reload`);await chartIs(page,LIGHT);
 // A zoom stays through a theme change (computer: the wheel). The time axis' labels show where the zoom is.
 const axis=()=>page.evaluate(()=>{const canvas=[...document.querySelector('[data-gainers-chart]').querySelectorAll('canvas')].filter(c=>c.height>0&&c.height<80).sort((x,y)=>y.width-x.width)[0];const {width,height}=canvas,d=canvas.getContext('2d').getImageData(0,0,width,height).data;const bg=d.slice(0,3);let out='';for(let x=0;x<width;x++){let hit=false;for(let y=0;y<height&&!hit;y++){const i=(y*width+x)*4;hit=Math.abs(d[i]-bg[0])+Math.abs(d[i+1]-bg[1])+Math.abs(d[i+2]-bg[2])>120;}out+=hit?'1':'0';}return out;});
 let zoomed=null;
 if(!viewport.hasTouch){const start=await axis();const box=await (await page.$('[data-gainers-chart]')).boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);for(let i=0;i<4;i++)await page.mouse.wheel({deltaY:-240});await pause(800);zoomed=await axis();assert.notEqual(zoomed,start,'the wheel zoomed');}
 await device('light');await press('Dark');await chartIs(page,DARK);
 if(zoomed){await pause(500);const after=await axis();const same=[...after].filter((c,i)=>c===zoomed[i]).length/after.length;assert(same>.97,`zoom kept through the theme change (${same})`);}
 assert.deepEqual(await readTheme(page),{attr:'dark',panel:'#171e1b',pressed:'Dark'},`${label}: Dark on a light device`);
 await shot(page,`after-page-dark-${label}`);
 await openDay(page,FORMER);assert.deepEqual(await readTheme(page),{attr:'dark',panel:'#171e1b',pressed:'Dark'},`${label}: another day`);await chartIs(page,DARK);
 assert.equal(await page.$eval('h1',e=>e.textContent),`Thursday's top gainers, Oct 22, 2026`);
 // The saved theme is on the page before any of the page's own code runs, so it can't flash.
 assert.equal(await page.evaluate(()=>document.querySelector('[data-gainers-page] > script')?.nextElementSibling?.tagName),'MAIN');
 // Shared with chat, both ways. Blade Runner shows as dark and pressing Dark leaves it saved.
 await page.goto(`${base}/chat?room=lb-review`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>[...document.querySelectorAll('article')].some(e=>e.checkVisibility()),{timeout:60000});
 assert.equal(await page.evaluate(k=>localStorage.getItem(k),KEY),'dark','chat keeps the choice made on the gainers page');
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('article')].find(e=>e.checkVisibility()).closest('[data-theme]').dataset.theme),'dark','chat shows the choice');
 assert.match(await page.evaluate(()=>document.cookie),/longboard-chat-theme=dark/,'chat paints it first time');
 await page.evaluate(k=>localStorage.setItem(k,'blade-runner'),KEY);await openDay(page,link);
 assert.deepEqual(await readTheme(page),{attr:'dark',panel:'#171e1b',pressed:'Dark'},`${label}: Blade Runner`);
 await press('Dark');assert.equal(await page.evaluate(k=>localStorage.getItem(k),KEY),'blade-runner','pressing the shown theme changes nothing');
 await page.evaluate(k=>localStorage.setItem(k,'light'),KEY);await page.emulateMediaFeatures([]);
};
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
  // #343: the heading has the year; each post in the room keeps its own header; Social groups as before.
  assert.equal(await page.$eval('h1',e=>e.textContent),`Friday's top gainers, Oct 30, 2026`);
  await theme(page,viewport,label);
  await page.goto(`${base}/chat?room=lb-review`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>[...document.querySelectorAll('article')].filter(e=>e.checkVisibility()&&e.innerText.includes('top gainers')).length===3,{timeout:60000});
  await pause(500);
  const grouped=await page.evaluate(()=>[...document.querySelectorAll('article')].filter(e=>e.checkVisibility()&&e.innerText.includes('top gainers')).map(e=>!!e.dataset.continued));
  assert.deepEqual(grouped,[false,false,false],`${label}: every LB Review post has its own header`);
  await shot(page,`after-room-${label}`);
  await page.goto(`${base}/chat?room=social`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>[...document.querySelectorAll('article')].some(e=>e.checkVisibility()&&e.innerText.includes('Social control two')),{timeout:60000});
  await pause(500);
  assert.equal(await page.evaluate(()=>!![...document.querySelectorAll('article')].find(e=>e.checkVisibility()&&e.innerText.includes('Social control two')).dataset.continued),true,`${label}: other rooms still group`);
  // Other days don't exist, bad addresses don't crash.
  assert.equal((await page.goto(`${base}/gainers/2001-01-01`)).status(),404);
  assert.equal((await page.goto(`${base}/gainers/not-a-date`)).status(),404);
  assert.deepEqual(errors,[],`${label}: page errors`);
  await context.close();
 }
 console.log('PASS LB Review room, bot, job, page and sign-in rules.');
}finally{await browser.close();polygon.close();notifier.close();await rm(dir,{recursive:true,force:true});}
