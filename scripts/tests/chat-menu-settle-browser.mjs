// COSMETIC 11: a ••• menu opened while a room is still settling stays under the finger, and the
// room returns to the newest message once the menu closes. Run against the chat-mobile fixture.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { signIn } from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3204';
const SCALE=Number(process.env.CHAT_TIMING_SCALE)||1;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 for(const [width,height,mobile] of [[1440,900,false],[390,844,true]]){
  const c=await b.createBrowserContext(),p=await c.newPage();await p.setViewport({width,height,isMobile:mobile,hasTouch:mobile});
  await signIn(p,base,'alice@example.test',{next:'/chat?room=main'}); // phones open /chat on the room list
  for(let round=0;round<2;round++){
   await p.goto(base+'/chat?room=main',{waitUntil:'domcontentloaded'});
   await p.waitForFunction(()=>{const s=[...document.querySelectorAll('article[id^="chat-message-"] summary')].at(-1);return s&&Object.keys(s).some(k=>k.startsWith('__react'));},{timeout:30000,polling:10});
   const top=await p.evaluate(()=>{const s=[...document.querySelectorAll('article[id^="chat-message-"] summary')].at(-1);s.click();window.__menu=s.parentElement;window.__id=s.closest('article').id;return s.getBoundingClientRect().top;});
   for(let i=0;i<15;i++){await sleep(80);const now=await p.evaluate(()=>({open:window.__menu.isConnected&&window.__menu.open,top:document.getElementById(window.__id).querySelector('summary').getBoundingClientRect().top}));assert.equal(now.open,true,'menu stays open');assert.ok(Math.abs(now.top-top)<1,`menu moved ${now.top-top}px at ${width}px`);}
   await p.keyboard.press('Escape');await p.evaluate(()=>{window.__menu.open=false});
   // The room scrolls back once the menu closes; on a slow runner that took longer than a fixed 400 ms (CI, line 18).
   const atNewest=()=>{const L=document.getElementById(window.__id).parentElement;return L.scrollHeight-L.scrollTop-L.clientHeight<=2};
   await p.waitForFunction(atNewest,{timeout:5000*SCALE}).catch(()=>{});
   assert.ok(await p.evaluate(atNewest),'back at the newest message after closing');
  }
  await c.close();
 }
 console.log('PASS: menu holds still while the room settles; room follows again after close');
}finally{await b.close();}
