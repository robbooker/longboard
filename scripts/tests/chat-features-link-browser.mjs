// D-242: the chat's Features link opens the company dev board in a new tab, for chat admins only.
// Alice is a chat admin (and Features owner); Bob is a regular member who is a Features participant
// (he saw the old link). Desktop and phone. FEATURES_SHOTS=<dir> FEATURES_TAG=before|after saves screenshots.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3297',DEV='https://company.robbooker.com/dev';
const shots=process.env.FEATURES_SHOTS,tag=process.env.FEATURES_TAG||'after',strict=tag!=='before';// 'before' only records the old build
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--host-resolver-rules=MAP company.robbooker.com 127.0.0.1:9']});
const nav='nav[aria-label="Chat rooms"]',composer='textarea[aria-label="Message LB"]';
try{
 for(const [who,email] of [['admin','alice@example.test'],['member','bob@example.test']]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Never reach the real site from the test (the new tab's host also resolves to a closed local port).
  await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith('https://company.robbooker.com')?r.abort():r.continue());
  await page.setViewport({width:1440,height:900});await context.setCookie({name:'longboard-chat-theme',value:'light',domain:'localhost',path:'/'});
  await page.goto(`${base}/login?next=%2Fchat`);await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
  await page.type('#li-email',email);await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector(composer);
  const check=async device=>{
   await page.waitForSelector(`${nav} a[href="/chat?room=main"]`,{visible:true});await new Promise(r=>setTimeout(r,400));
   if(shots)await page.screenshot({path:`${shots}/${who}-${device}-${tag}.png`});
   const links=await page.$$eval(`${nav} a`,as=>as.filter(a=>a.textContent.trim().startsWith('Features')).map(a=>({href:a.href,target:a.target,rel:a.rel})));
   // No link anywhere in the page (nav, bell, menus) goes to the old ticket system.
   const old=await page.$$eval('a[href]',as=>as.map(a=>a.getAttribute('href')).filter(h=>h.includes('/chat/features')));
   console.log(who,device,JSON.stringify({links,old}));if(!strict)return;
   if(who==='admin')assert.deepEqual(links,[{href:DEV,target:'_blank',rel:'noopener noreferrer'}],`${who} ${device} Features link`);
   else assert.deepEqual(links,[],`${who} ${device} sees no Features link`);
   assert.deepEqual(old,[],'no old ticket links');
   assert.equal(await page.evaluate(()=>document.body.innerText.split('\n').some(l=>l.trim()==='Features')),who==='admin',`${who} ${device} Features text`);
  };
  await check('desktop');
  if(strict&&who==='admin'){
   // Clicking opens a new tab at the dev board; the chat stays where it was.
   // Wait for the dev-board tab itself: the chat's service worker can register as a target at the same moment.
   const chatUrl=page.url(),opened=browser.waitForTarget(t=>t.type()==='page'&&t.url().startsWith(DEV),{timeout:15000});
   await page.click(`${nav} a[href="${DEV}"]`);const target=await opened;
   await new Promise(r=>setTimeout(r,500));assert.equal(page.url(),chatUrl,'chat stays open');
   await new Promise(r=>setTimeout(r,300));assert.equal(target.url(),DEV,'new tab for the dev board');
   const tab=await target.page().catch(()=>null);if(tab&&tab!==page)await tab.close();
  }
  // Phone: plain /chat is the room list.
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await page.goto(`${base}/chat`);await page.waitForSelector(composer);
  // The phone may reopen the last conversation; go back to the room list (the conversation goes inert).
  const listShown=()=>page.evaluate(()=>!!document.querySelector('section[aria-label="Longboard Chat"]')?.inert);
  await new Promise(r=>setTimeout(r,800));if(!await listShown()){await page.tap('button[aria-label="Back to all chats"]');}
  await page.waitForFunction(()=>document.querySelector('section[aria-label="Longboard Chat"]')?.inert&&document.querySelector('nav[aria-label="Chat rooms"]').getBoundingClientRect().left>=0);
  await check('phone');
  if(strict&&who==='admin'){
   const opened=new Promise(resolve=>browser.once('targetcreated',resolve));await page.tap(`${nav} a[href="${DEV}"]`);const target=await opened;
   const tab=await target.page().catch(()=>null);if(tab&&tab!==page)await tab.close();
  }
  // The ••• menu and the bell carry no Features link either.
  const menu=strict&&await page.$(`${nav} button[aria-label="Chat settings"]`);if(menu){await menu.click();await new Promise(r=>setTimeout(r,300));assert.deepEqual(await page.$$eval('a[href]',(as,admin)=>as.filter(a=>(a.textContent.trim()==='Features'&&!admin)||a.getAttribute('href').includes('/chat/features')).map(a=>a.href),who==='admin'),[]);await page.keyboard.press('Escape');}
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log(strict?'PASS D-242: admin Features link opens the dev board in a new tab on desktop and phone; member sees none; no old ticket links.':'RECORDED before-build screenshots only (no assertions).');
}finally{await browser.close();}
