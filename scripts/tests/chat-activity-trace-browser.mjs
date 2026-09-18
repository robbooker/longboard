// Run against an authenticated local fixture or a local page rendering FeatureChannel.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let status='in_progress';
 const requests=()=>['Activity trace','Another working ticket','An approved ticket'].map((title,i)=>({id:`trace-${i}`,title,priority:2,priority_revision:1,proposal:'Fixture',revision:1,approved_proposal:'Fixture',status:i===0?status:i===1?'in_progress':'approved',outcome:null}));
 await page.setRequestInterception(true);
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/chat/')){void request.respond({status:200,contentType:'application/json',body:JSON.stringify(url.searchParams.has('statusOnly')?{statuses:requests()}:{requests:requests(),messages:[],role:'owner',view:'active',selected:null,hasMore:false,notifications:[],unreadCount:0})});}else void request.continue();});
 await page.goto(process.env.TRACE_URL||'http://127.0.0.1:3275/trace-test',{waitUntil:'networkidle0'});
 const trace='nav[aria-label="Feature requests"] [aria-hidden="true"]';
 await page.waitForSelector(trace);
 assert.equal(await page.$$eval(trace,n=>n.length),2);
 assert.equal(await page.$eval('button[data-status="approved"]',e=>!!e.querySelector('svg')),false);
 const delays=await page.$$eval(trace,n=>n.map(e=>e.style.getPropertyValue('--trace-delay')));assert.notEqual(delays[0],delays[1]);
 for(const width of [1440,390,320]){
  await page.setViewport({width,height:900});
  const geometry=await page.$$eval('nav[aria-label="Feature requests"] button',nodes=>nodes.map(card=>{const c=card.getBoundingClientRect(),s=card.querySelector('small').getBoundingClientRect(),t=card.querySelector('svg')?.getBoundingClientRect();return {overflow:card.scrollWidth>card.clientWidth+1,aligned:!t||(Math.abs(t.left-s.left)<1&&t.top>=s.bottom&&t.right<=c.right-13)};}));
  assert.ok(geometry.every(g=>!g.overflow&&g.aligned),JSON.stringify(geometry));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`/tmp/activity-trace-${width}.png`,fullPage:true});
 }
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 assert.ok((await page.$$eval(`${trace} circle`,nodes=>nodes.map(e=>getComputedStyle(e).animationName))).every(n=>n==='none'));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
 // An actual status refresh drives completion, without changing the status text.
 status='ready';
 await page.waitForSelector('button[data-status="ready"] [data-completed="true"]');
 assert.equal(await page.$eval('button[data-status="ready"] small',e=>e.textContent),'Ready for review');
 await page.waitForFunction(()=>!document.querySelector('button[data-status="ready"] svg'));
 // Pauses when the remaining trace leaves the viewport.
 await page.$eval('button[data-status="in_progress"]',e=>e.style.marginTop='2000px');
 await page.waitForSelector(`${trace}[data-paused="true"]`);
 assert.deepEqual(errors,[]);
 console.log('PASS: actual feature cards at1440/390/320, seeded variations, status honesty, working-only trace, reduced motion, completion then settled, offscreen pause, no browser errors.');
}finally{await browser.close();}
