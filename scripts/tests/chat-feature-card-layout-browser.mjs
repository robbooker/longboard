import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const statuses=['discussion','approved','in_progress','ready','done','blocked','declined','publish_approved','publishing','publish_failed'];
const titles=['Discuss an idea','Approved development','Building the feature','Ready for your review','Published feature','Blocked dependency','Declined idea','Approved release','Publishing release','Release needs attention'];
const requests=statuses.map((status,i)=>({id:`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,title:i===7?'A longer publishing request title that must wrap naturally':i===1?'AReallyLongUnbrokenFeatureRequestTitleThatMustNeverOverflowTheCard':titles[i],priority:i===0?0:3,priority_revision:1,proposal:'Status-color visual fixture.',revision:2,approved_proposal:'Status-color visual fixture.',status:status.startsWith('publish')?'ready':status,outcome:null,release:status.startsWith('publish')?{pr_number:1,head_sha:'a'.repeat(40),version:1,state:status==='publish_approved'?'approved':status==='publishing'?'publishing':'failed',approved_at:null,outcome:null}:null}));
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1280,height:1200});
 await page.setRequestInterception(true);page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/chat/features'){const data=url.searchParams.has('statusOnly')?{statuses:requests.map(({id,status})=>({id,status}))}:{requests,messages:[],role:'owner'};void request.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});}else void request.continue();});
 await page.goto('http://localhost:3270/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 await page.goto(`http://localhost:3270/chat/features?request=${requests[3].id}`);await page.waitForSelector('nav[aria-label="Feature requests"] button[data-status="publish_failed"]');
 const inspect=()=>page.evaluate(()=>[...document.querySelectorAll('nav[aria-label="Feature requests"] button')].map(e=>({status:e.dataset.status,color:getComputedStyle(e).getPropertyValue('--feature-glow').trim(),background:getComputedStyle(e).backgroundColor,opacity:getComputedStyle(e).opacity,label:e.querySelector('small').textContent,animation:getComputedStyle(e,'::after').animationName})));
 let cards=await inspect();assert.deepEqual(cards.map(c=>c.status),statuses);assert.equal(new Set(cards.map(c=>c.color)).size,10);assert.equal(cards.find(c=>c.status==='ready').color,'#f87171');assert.equal(cards.find(c=>c.status==='done').background,'rgb(8, 11, 16)');assert.equal(cards.find(c=>c.status==='done').opacity,'0.78');assert.equal(cards.find(c=>c.status==='done').animation,'none');
 await page.screenshot({path:'/tmp/feature-card-dark.png',fullPage:true});
 await page.click('button[aria-label="Light mode"]');assert.equal(await page.$eval('main',e=>e.dataset.featureTheme),'light');await page.screenshot({path:'/tmp/feature-card-light.png',fullPage:true});
 for(const width of [320,390,768,1280]){await page.setViewport({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const geometry=await page.evaluate(()=>[...document.querySelectorAll('nav[aria-label="Feature requests"] button')].map(card=>{
  const box=card.getBoundingClientRect(),title=card.querySelector('strong').getBoundingClientRect(),badge=card.querySelector('span').getBoundingClientRect(),status=card.querySelector('small').getBoundingClientRect();
  return {overflow:card.scrollWidth>card.clientWidth+1,titleLeft:title.left-box.left,badgeLeft:badge.left-box.left,statusLeft:status.left-box.left,ordered:badge.top>=title.bottom+7&&status.top>=badge.bottom+7,statusRight:status.right<=box.right-13,padding:getComputedStyle(card).padding};
 }));
 assert.ok(geometry.every(card=>!card.overflow&&card.ordered&&card.statusRight&&card.padding==='14px'),JSON.stringify({width,geometry}));
 assert.ok(geometry.every(card=>Math.abs(card.titleLeft-card.badgeLeft)<1&&Math.abs(card.titleLeft-card.statusLeft)<1));
 await page.screenshot({path:`/tmp/feature-card-${width}.png`,fullPage:true});}
 await page.setViewport({width:390,height:844});await page.screenshot({path:'/tmp/feature-card-mobile.png',fullPage:true});
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);cards=await inspect();assert.ok(cards.every(c=>c.animation==='none'));
 await page.click('nav button[data-status="done"]');assert.equal(await page.$eval('nav button[data-status="done"]',e=>getComputedStyle(e).opacity),'1');assert.equal(await page.$eval('span[data-status="done"]',e=>e.textContent),'Published and verified');
 assert.deepEqual(errors,[]);console.log('PASS title/priority/status alignment, equal14pxpadding, longstatus/titlewrapping at320/390/768/1280; all ten distinct status colors, red ready, black/faded completed cards, selected contrast, status badge, light/dark, 320/390/768/1280 layouts and reduced-motion behavior.');
}finally{await browser.close();}
