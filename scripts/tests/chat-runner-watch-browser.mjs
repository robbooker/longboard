// #341 Runner Watch on a computer and a phone, against the fixture on this test's own ports
// (localhost:3341, database 127.0.0.1:54341). Synthetic data; every ticker here is made up.
//  - the key: right, wrong, missing; one post per room however often it's sent;
//  - an ordinary update reaches Runner Watch only; an alert reaches LB and SS too, as a link;
//  - a member opens the link; so does an SS member with no LB access; signed out can't;
//  - nothing from the sender becomes HTML or an unsafe link;
//  - too many are held back and the Admins room is told; Post now; the off switch stops all three.
// CHAT_SHOT_DIR saves screenshots.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3341',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54341';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,KEY='synthetic-runner-watch-token-never-a-production-secret';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const rowsOf=r=>r.rows??r;
const send=async(body,key=KEY)=>{const r=await fetch(`${base}/api/chat/runner-watch`,{method:'POST',headers:{'content-type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
const posts=async room=>rowsOf(await sql(`select count(*)::int n from longboard_chat_messages where room_slug=$1 and bot_slug='runner-watch'`,[room]))[0].n;
const counts=async()=>[await posts('runner-watch'),await posts('main'),await posts('shortscout')];

const identity=await control('identity'),[alice,bob]=identity.people;
await sql(`update profiles set role='admin' where id=$1`,[alice.id]);
await sql(`insert into user_tags(user_id,tag) values($1,'boardroom-cohort-1') on conflict do nothing`,[bob.id]);

// The key.
const report={id:'fake-1',tickers:['FAKE'],summary:'TEST DATA. Made-up S-1 for up to 5M shares with warrants. <b>not bold</b> See https://evil.test/spoof',fullText:'TEST DATA, not a real company.\n\nFAKE filed a made-up S-1.\n<script>window.pwned=1</script><img src=x onerror="window.pwned=1">\n\nFiling: https://www.sec.gov/fake-filing\n[The notice](https://www.nasdaq.com/fake-notice)\n[bad link](javascript:window.pwned=1)\njavascript:window.pwned=1',sentAt:'2026-10-31T14:30:00Z'};
assert.equal((await send(report,null)).status,401,'no key');
assert.equal((await send(report,'x'.repeat(54))).status,401,'wrong key');
assert.deepEqual(await counts(),[0,0,0],'refused means nothing posted');
assert.equal(rowsOf(await sql('select count(*)::int n from chat_runner_watch_reports'))[0].n,0,'and nothing stored');

// An ordinary update: Runner Watch only, once.
const first=await send(report);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.body.status,'posted');assert.deepEqual(first.body.mainRooms,[]);
assert.equal((await send(report)).body.status,'duplicate','same update again');assert.deepEqual(await counts(),[1,0,0],'one post');
const link=first.body.url;assert(link.startsWith(base+'/runner-watch/'),link);
// An alert: all three, once each. A report with no ticker is worded generically.
const alert={id:'fake-2',tickers:['FAKER'],summary:'TEST DATA. Made-up delisting notice for FAKER.',fullText:'TEST DATA. FAKER got a made-up notice.',alert:true};
const second=await send(alert);assert.deepEqual(second.body.mainRooms,['main','shortscout']);
assert.equal((await send(alert)).body.status,'duplicate','alert resend');assert.deepEqual(await counts(),[2,1,1],'once per room');
const alertLink=second.body.url;
const generic=await send({id:'fake-3',summary:'TEST DATA. No single ticker in this made-up update.',fullText:'TEST DATA. Made-up market note.'});assert.equal(generic.status,200);
assert.deepEqual(await counts(),[3,1,1]);

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const shot=async(p,name,full=false)=>{if(shots){await pause(600);await p.screenshot({path:`${shots}/${name}.png`,fullPage:full});}};
const visiblePost=(page,text)=>page.waitForFunction(text=>[...document.querySelectorAll('article')].some(e=>e.checkVisibility()&&e.innerText.includes(text)),{timeout:60000},text);
const reportLink=(page,text)=>page.evaluate(text=>{const a=[...document.querySelectorAll('article a')].find(e=>e.checkVisibility()&&e.textContent===text);return a?{href:a.href,blank:a.target==='_blank'}:null;},text);
try{
 // Signed out.
 const out=await browser.createBrowserContext(),outPage=await out.newPage();
 await outPage.goto(link,{waitUntil:'domcontentloaded'});
 assert.match(outPage.url(),/\/chat\/login\?room=runner-watch/,'signed out goes to the login page');
 assert(!(await outPage.content()).includes('made-up'),'no report for a signed-out visitor');
 await out.close();

 for(const [label,viewport] of [['computer',desktop],['phone',phone]]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(viewport);
  await signIn(page,base,'bob@example.test');
  await page.goto(`${base}/chat?room=runner-watch`,{waitUntil:'domcontentloaded'});
  await visiblePost(page,'More about FAKE here');
  await page.waitForFunction(()=>[...document.querySelectorAll('textarea')].some(e=>e.checkVisibility()&&e.getAttribute('aria-label')==='Message Runner Watch'),{timeout:30000});
  await shot(page,`room-${label}`);
  const text=await page.evaluate(()=>[...document.querySelectorAll('article')].filter(e=>e.checkVisibility()).map(e=>e.innerText).join('\n'));
  assert(text.includes('Runner Risk Watch'),'from the bot');assert(text.includes('<b>not bold</b>'),'HTML shows as characters');
  assert(!text.includes('evil.test'),'the summary\'s own link is gone from the post');
  assert(text.includes('AI-generated research')&&text.includes('Not trade advice'),'labelled');
  assert(text.includes('More about this update here'),'no ticker, generic wording');
  const anchor=await reportLink(page,'More about FAKE here');assert.equal(anchor?.href,link,'the words are the link');assert.equal(anchor.blank,false,'stays in the app');
  await page.evaluate(()=>[...document.querySelectorAll('article')].find(e=>e.checkVisibility()&&e.innerText.includes('More about FAKE here'))?.scrollIntoView({block:'center'}));
  await shot(page,`post-${label}`);
  // Following it, by tapping.
  await page.evaluate(()=>[...document.querySelectorAll('article a')].find(e=>e.checkVisibility()&&e.textContent==='More about FAKE here').click());
  await page.waitForSelector('[data-runner-report]',{timeout:60000});assert.equal(page.url(),link,'the link opens the report');
  const body=await page.evaluate(()=>document.body.innerText);
  assert(body.includes('FAKE filed a made-up S-1.')&&/AI-generated research from Jake's watchlist/.test(body)&&/Not trade advice/.test(body)&&/filings/.test(body),'report and label');
  assert(body.includes('<script>window.pwned=1</script>'),'script shows as characters');
  assert.equal(await page.evaluate(()=>window.pwned),undefined,'nothing ran');
  assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-runner-report] script,[data-runner-report] img').length),0,'no HTML elements from the sender');
  const hrefs=await page.$$eval('[data-runner-text] a',as=>as.map(a=>[a.getAttribute('href'),a.textContent,a.rel]));
  assert.deepEqual(hrefs.map(h=>h.slice(0,2)),[['https://www.sec.gov/fake-filing','https://www.sec.gov/fake-filing'],['https://www.nasdaq.com/fake-notice','The notice']],'only http and https links');
  assert(hrefs.every(h=>h[2].includes('noopener')));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0,`${label}: no sideways scroll`);
  await shot(page,`report-${label}`,true);
  assert.equal(await page.$eval('[data-runner-report] a',a=>a.getAttribute('href')),'/chat?room=runner-watch','back link');
  // An alert in LB, with its link.
  await page.goto(`${base}/chat?room=main`,{waitUntil:'domcontentloaded'});
  await visiblePost(page,'Runner Risk Watch alert:');
  assert.equal((await reportLink(page,'More about FAKER here'))?.href,alertLink,'LB post links');
  await page.evaluate(()=>[...document.querySelectorAll('article')].find(e=>e.checkVisibility()&&e.innerText.includes('Runner Risk Watch alert:'))?.scrollIntoView({block:'center'}));
  await shot(page,`lb-post-${label}`);
  // Bad addresses and a report that doesn't exist.
  assert.equal((await page.goto(`${base}/runner-watch/not-an-id`)).status(),404);
  assert.equal((await page.goto(`${base}/runner-watch/00000000-0000-4000-8000-000000000000`)).status(),404);
  assert.deepEqual(errors,[],`${label}: page errors`);
  await context.close();
 }

 // An SS member with no LB access reads the SS post and opens its link.
 const ss=await browser.createBrowserContext();await ss.setCookie({name:'lb-chat-session',value:identity.scoutToken,url:base,httpOnly:true});
 const scout=await ss.newPage();await scout.setViewport(phone);
 assert.equal(rowsOf(await sql(`select public.chat_account_has_room($1,'main') ok`,[identity.scoutId]))[0].ok,false,'no LB for this member');
 assert.equal(rowsOf(await sql(`select public.chat_account_has_room($1,'shortscout') ok`,[identity.scoutId]))[0].ok,true,'SS member');
 await scout.goto(`${base}/chat?room=shortscout`,{waitUntil:'domcontentloaded'});
 await visiblePost(scout,'Runner Risk Watch alert:');
 assert.equal((await reportLink(scout,'More about FAKER here'))?.href,alertLink,'SS post links');
 await scout.evaluate(()=>[...document.querySelectorAll('article')].find(e=>e.checkVisibility()&&e.innerText.includes('Runner Risk Watch alert:'))?.scrollIntoView({block:'center'}));
 await shot(scout,'ss-post-phone');
 assert.equal((await scout.goto(alertLink,{waitUntil:'domcontentloaded'})).status(),200,'SS member opens the page');
 await scout.waitForSelector('[data-runner-report]');assert((await scout.evaluate(()=>document.body.innerText)).includes('FAKER got a made-up notice'));
 assert.equal((await scout.goto(`${base}/api/chat/history?room=main`)).status(),403,'and still has no LB');
 await ss.close();

 // Too many, held back, and the Admins room told.
 const [{n:done}]=rowsOf(await sql(`select count(*)::int n from chat_runner_watch_reports where status='posted'`));
 await sql('update chat_runner_watch_settings set max_per_hour=$1',[done]);
 const heldAnswer=await send({id:'fake-held',tickers:['HELD'],summary:'TEST DATA. Made-up update over the limit.',fullText:'TEST DATA. Held.',alert:true});
 assert.equal(heldAnswer.status,429);assert.equal(heldAnswer.body.status,'held');
 const before=await counts();await send({id:'fake-held-2',summary:'TEST DATA. Another.',fullText:'TEST DATA. Another.'});
 assert.deepEqual(await counts(),before,'nothing posts while held');
 assert.equal(rowsOf(await sql(`select count(*)::int n from longboard_chat_messages where room_slug='admins' and bot_slug='runner-watch-notices'`))[0].n,1,'one note');

 for(const [label,viewport] of [['computer',desktop],['phone',phone]]){
  const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport(viewport);
  await signIn(page,base,'alice@example.test');
  if(label==='computer'){
   await page.goto(`${base}/chat?room=admins`,{waitUntil:'domcontentloaded'});await visiblePost(page,'too many updates');await shot(page,'admins-note-computer');
  }
  await page.goto(`${base}/admin/runner-watch`,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-held-row]',{timeout:60000});
  await page.waitForFunction(()=>Object.keys(document.querySelector('[data-feed-toggle]')).some(k=>k.startsWith('__reactProps$')));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0,'admin page fits');
  await shot(page,`admin-${label}`,true);
  await context.close();
 }
 // A member can't use the switches or read a held report.
 const member=await browser.createBrowserContext(),mPage=await member.newPage();await signIn(mPage,base,'bob@example.test');
 assert.equal(await mPage.evaluate(async()=>(await fetch('/api/admin/runner-watch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'settings',enabled:false})})).status),403,'not for members');
 assert.equal((await mPage.goto(heldAnswer.body.reportId?`${base}/runner-watch/${heldAnswer.body.reportId}`:base)).status(),404,'held page hidden from members');
 await mPage.goto(`${base}/admin/runner-watch`,{waitUntil:'domcontentloaded'});assert(!mPage.url().includes('/admin/runner-watch'),'admin page refuses a member');
 await member.close();

 // Rob: Post now, then off. Off stops all three; on brings it back.
 const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport(desktop);
 await signIn(page,base,'alice@example.test');await page.goto(`${base}/admin/runner-watch`,{waitUntil:'domcontentloaded'});
 const hydrate=sel=>page.waitForFunction(sel=>{const e=document.querySelector(sel);return e&&Object.keys(e).some(k=>k.startsWith('__reactProps$'));},{timeout:60000},sel);
 await hydrate('[data-held-post]');
 assert.equal((await page.goto(`${base}/runner-watch/${heldAnswer.body.reportId}`)).status(),200,'an admin can read a held one');
 await page.goto(`${base}/admin/runner-watch`,{waitUntil:'domcontentloaded'});await hydrate('[data-held-post]');
 const heldBefore=(await page.$$('[data-held-row]')).length;
 const heldRow=await page.evaluateHandle(()=>[...document.querySelectorAll('[data-held-row]')].find(r=>r.innerText.includes('HELD')).querySelector('[data-held-post]'));
 await heldRow.click();
 await page.waitForFunction(n=>document.querySelectorAll('[data-held-row]').length===n-1,{timeout:30000},heldBefore);
 assert.deepEqual(await counts(),[before[0]+1,before[1]+1,before[2]+1],'Post now posts the alert in all three');
 await page.click('[data-feed-toggle]');await page.waitForFunction(()=>document.querySelector('[data-feed-state]').innerText==='The feed is off',{timeout:30000});
 const at=await counts();
 const off=await send({id:'fake-off',tickers:['OFFF'],summary:'TEST DATA. Off.',fullText:'TEST DATA. Off.',alert:true});
 assert.equal(off.status,503);assert.equal(off.body.error,'feed_off');assert.deepEqual(await counts(),at,'off stops all three');
 await page.click('[data-feed-toggle]');await page.waitForFunction(()=>document.querySelector('[data-feed-state]').innerText==='The feed is on',{timeout:30000});
 await sql('update chat_runner_watch_settings set max_per_hour=1000');
 assert.equal((await send({id:'fake-off',tickers:['OFFF'],summary:'TEST DATA. Back on.',fullText:'TEST DATA. Back on.'})).status,200,'on again');
 await context.close();
 console.log('PASS Runner Watch feed, posts, report page, members, limits and switches.');
}finally{await browser.close();}
