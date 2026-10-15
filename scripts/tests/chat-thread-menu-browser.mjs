// D-184: a ••• menu in the replies panel opens toward the side with room instead of under the main chat.
// POLISH-REST: the last message's menu opens upward instead of under the composer.
// Run against the chat-mobile fixture (CHAT_TEST_URL, default http://localhost:3204).
import puppeteer from 'puppeteer';
const base=process.env.CHAT_TEST_URL||'http://localhost:3204',shot=process.argv[2];
const b=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--blink-settings=primaryPointerType=4,primaryHoverType=2,availablePointerTypes=4,availableHoverTypes=2']});
const p=await b.newPage();await p.setViewport({width:1280,height:900,deviceScaleFactor:2});
await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email','alice@example.test');await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label^="Message "]');
await new Promise(r=>setTimeout(r,2500));
await p.evaluate(()=>{const b=[...document.querySelectorAll('article[id^="chat-message-"] button')].filter(b=>/^Reply|repl/i.test(b.textContent.trim()));b.at(-1).click();});
const aside='aside[aria-label="Comment replies"]';await p.waitForSelector(aside+' textarea');await new Promise(r=>setTimeout(r,1000));
// Jammie's layout: a long name pushes ••• onto its own line at the left edge.
await p.evaluate(a=>{const st=document.createElement('style');st.textContent=a+' details{order:-1}';document.head.append(st);},aside);
const n=await p.$$eval(aside+' summary[aria-label^="Actions for message"]',s=>s.length);let bad=0;
for(let i=0;i<n;i++){
 const s=(await p.$$(aside+' summary[aria-label^="Actions for message"]'))[i];await s.click();await new Promise(r=>setTimeout(r,300));
 const r=await p.evaluate((a,i)=>{const d=document.querySelectorAll(a+' details')[i];const m=d.querySelector(':scope>div').getBoundingClientRect(),c=document.querySelector(a).getBoundingClientRect();return {menu:[Math.round(m.left),Math.round(m.right)],panel:[Math.round(c.left),Math.round(c.right)],fits:m.left>=c.left&&m.right<=c.right,summaryLeft:Math.round(d.getBoundingClientRect().left)}},aside,i);
 console.log('menu',i,JSON.stringify(r));if(!r.fits)bad++;
 if(i===0&&shot){const c=await p.evaluate(a=>{const r=document.querySelector(a).getBoundingClientRect();return {x:r.x-220,y:r.y,width:r.width+220,height:420}},aside);await p.screenshot({path:shot,clip:c});}
 await p.keyboard.press('Escape');await new Promise(r=>setTimeout(r,200));
}
// POLISH-REST: the ••• menu on the last message opens upward when the composer would cover Delete;
// it stays inside the scrolling list (and the visible viewport) in the thread, the room and on a phone.
const lastMenuFits=async(page,scope,label)=>{
 const r=await page.evaluate(async scope=>{
  const sums=[...document.querySelectorAll('summary[aria-label^="Actions for message"]')].filter(s=>scope?s.closest(scope):!s.closest('aside')&&s.getBoundingClientRect().width),s=sums.at(-1);
  s.scrollIntoView({block:'end'});await new Promise(r=>setTimeout(r,250));s.click();await new Promise(r=>setTimeout(r,300));
  const d=s.closest('details'),m=d.querySelector(':scope>div').getBoundingClientRect();
  let list=d.parentElement;while(list&&!/(auto|scroll)/.test(getComputedStyle(list).overflowY))list=list.parentElement;
  const l=list?list.getBoundingClientRect():{top:0,bottom:innerHeight},vb=visualViewport?visualViewport.offsetTop+visualViewport.height:innerHeight;
  const del=[...d.querySelectorAll(':scope>div button')].at(-1).getBoundingClientRect();
  const out={menu:[Math.round(m.top),Math.round(m.bottom)],list:[Math.round(l.top),Math.round(l.bottom)],side:d.dataset.side??null,lastItem:Math.round(del.bottom),fits:m.top>=Math.max(l.top,0)-1&&m.bottom<=Math.min(l.bottom,vb)+1};
  d.open=false;return out;
 },scope);
 console.log('last menu',label,JSON.stringify(r));if(!r.fits)bad++;
};
// A short window puts the last reply and the last room message right above their composers.
await p.setViewport({width:1280,height:520,deviceScaleFactor:2});await new Promise(r=>setTimeout(r,400));
await lastMenuFits(p,aside,'thread');
await lastMenuFits(p,null,'room');
const phone=await b.newPage();await phone.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
await phone.goto(base+'/chat');await phone.waitForSelector('textarea[aria-label^="Message "]');await new Promise(r=>setTimeout(r,2500));
await lastMenuFits(phone,null,'phone room');await phone.close();
console.log(bad?'FAIL '+bad:'PASS');await b.close();process.exit(bad?1:0);
