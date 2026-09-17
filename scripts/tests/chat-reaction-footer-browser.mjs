import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3204/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 for(const room of ['main','social','shortscout']){
  await page.goto(`http://localhost:3204/chat?room=${room}`);await page.waitForSelector('article[id^="chat-message-"] button[aria-expanded]');
  const id=await page.$$eval('article[id^="chat-message-"]',es=>es.at(-1).id);const reaction=`#${id} button[aria-pressed]`;const reply=`#${id} button[aria-expanded]`;
  for(const width of [320,390,1280,1920]){
   await page.setViewport({width,height:900});
   const g=await page.$eval(`#${id}`,e=>{const reaction=e.querySelector('button[aria-pressed]').getBoundingClientRect(),reply=e.querySelector('button[aria-expanded]').getBoundingClientRect(),body=e.querySelector('p').getBoundingClientRect(),time=e.querySelector('time').getBoundingClientRect();return {reactionTop:reaction.top,replyTop:reply.top,bodyBottom:body.bottom,timeBottom:time.bottom,replyLeft:reply.left,reactionLeft:reaction.left,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.ok(g.reactionTop>=g.bodyBottom);assert.ok(g.replyTop>=g.bodyBottom);assert.ok(g.reactionTop>g.timeBottom);assert.ok(g.reactionLeft>g.replyLeft);assert.equal(g.overflow,false);
  }
  assert.ok((await page.$eval(reaction,e=>e.textContent)).includes(room==='shortscout'?'🍋':'🌴'));
  const pressed=await page.$eval(reaction,e=>e.getAttribute('aria-pressed'));
  const toggle=async()=>{const wait=page.waitForResponse(r=>r.url().endsWith('/api/chat')&&r.request().method()==='POST');await page.click(reaction);const response=await wait;assert.equal(response.status(),200,await response.text());};
  await toggle();await page.waitForFunction((selector,before)=>document.querySelector(selector)?.getAttribute('aria-pressed')!==before,{},reaction,pressed);
  await page.waitForFunction(selector=>!document.querySelector(selector)?.disabled,{},reaction);await toggle();await page.waitForFunction((selector,before)=>document.querySelector(selector)?.getAttribute('aria-pressed')===before,{},reaction,pressed);
  await page.mouse.move(0,0);await page.$eval(reaction,e=>e.blur());await page.focus(reaction);await page.waitForSelector('[role="tooltip"]');await page.waitForFunction(()=>!document.querySelector('[role="tooltip"]')?.textContent.includes('Loading'));assert.ok(!(await page.$eval('[role="tooltip"]',e=>e.textContent)).includes('unavailable'));
  await page.setViewport({width:390,height:844});await page.screenshot({path:`/tmp/reaction-footer-${room}.png`});
  await page.click(reply);await page.waitForSelector('#thread-reply');await page.click('button[aria-label="Close replies"]');
 }
 assert.deepEqual(errors,[]);console.log('PASS footer geometry in all rooms at 320/390/1280/1920, palm/lemon, reaction toggles, liker tooltip, reply opens, no errors');
}finally{await browser.close();}
