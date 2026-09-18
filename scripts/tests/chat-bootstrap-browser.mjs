// Compare two production builds against chat-bootstrap-fixture.mjs only.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const room=process.env.BENCH_ROOM||'social';
const labelText=room==='main'?'LB':'SOCIAL';
const composer=`textarea[aria-label="Message ${labelText}"]`;
const fixture='http://127.0.0.1:54450';
const origins={before:'http://localhost:3252',after:'http://localhost:3251'};
const results=[];const errors=[];
try{
 const contexts={};
 for(const [label,origin]of Object.entries(origins)){
  const context=await browser.createBrowserContext();contexts[label]=context;
  const page=await context.newPage();await page.goto(origin+'/login?next='+encodeURIComponent('/chat?room='+room));
  await page.waitForSelector('#li-email');await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');
  await page.waitForSelector(composer);await page.waitForSelector('article');await page.close();
 }
 for(let round=0;round<6;round++)for(const label of round%2?['after','before']:['before','after']){
  const page=await contexts[label].newPage();await page.setViewport({width:1280,height:900});await page.emulateTimezone('America/Chicago');
  page.on('pageerror',e=>errors.push({label,error:e.message}));
  const requests=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/chat'))requests.push({path:u.pathname,method:r.method()});});
  await page.evaluateOnNewDocument(()=>localStorage.removeItem('longboard-public-chat-theme-v1'));
  await fetch(fixture+'/test/reset-trace');
  const started=performance.now();const response=await page.goto(origins[label]+'/chat?room='+room,{waitUntil:'domcontentloaded'});
  const html=await response.text();
  await page.waitForFunction(selector=>document.querySelector('article')&&document.querySelector(selector)&&!document.querySelector(selector).disabled&&localStorage.getItem('longboard-public-chat-theme-v1'),{},composer);
  const ready=performance.now()-started;
  // A real input update demonstrates the composer hydrated rather than merely existing in HTML.
  await page.type(composer,'Synthetic draft only');
  await page.waitForFunction(()=>document.body.innerText.includes('20 / 600'));
  const interactive=performance.now()-started;
  const spans=await(await fetch(fixture+'/test/trace')).json();
  await new Promise(r=>setTimeout(r,500));
  assert.equal(await page.$eval(composer,e=>e.value),'Synthetic draft only');
  if(label==='after'){
   assert.match(html,/<article/);assert.ok(!requests.some(r=>r.path==='/api/chat/member'));
   await page.screenshot({path:`/tmp/s02-${round===5?'desktop':'latest'}.png`});
  }
  results.push({label,room,articles:await page.$$eval('article',rows=>rows.length),round,warmup:round===0,ready_ms:Math.round(ready),interactive_draft_ms:Math.round(interactive),html_contains_articles:html.includes('<article'),requests,spans});
  await page.close();await new Promise(r=>setTimeout(r,100));
 }
 assert.deepEqual(errors,[]);
 const summary=Object.fromEntries(Object.keys(origins).map(label=>{
  const rows=results.filter(r=>r.label===label&&!r.warmup);const median=key=>rows.map(r=>r[key]).sort((a,b)=>a-b)[2];
  return [label,{samples:rows.length,median_ready_ms:median('ready_ms'),median_interactive_draft_ms:median('interactive_draft_ms'),min_ready_ms:Math.min(...rows.map(r=>r.ready_ms)),max_ready_ms:Math.max(...rows.map(r=>r.ready_ms))}];
 }));
 await writeFile('/tmp/s02-browser-results.json',JSON.stringify({conditions:'Local production builds; synthetic PGlite/auth; 50ms injected per service HTTP call; alternating runs; first pair warmup excluded; no real messages sent. Not production speed evidence.',summary,errors,results},null,2));
 console.log(JSON.stringify(summary));
}finally{await browser.close();}
