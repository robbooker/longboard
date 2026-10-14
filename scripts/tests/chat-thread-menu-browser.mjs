// D-184: a ••• menu in the replies panel opens toward the side with room instead of under the main chat.
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
console.log(bad?'FAIL '+bad:'PASS');await b.close();process.exit(bad?1:0);
