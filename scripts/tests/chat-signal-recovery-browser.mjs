// Real production components with synthetic fixture data and client transport fault injection.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base=process.env.CHAT_TEST_URL||'http://localhost:3345';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const p=await browser.newPage();p.setDefaultTimeout(30000);await p.setViewport({width:1440,height:1000});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});
 await p.type('#li-email','alice@example.test');await p.type('#li-password','demo-only');await p.click('button[type="submit"]');
 await p.waitForSelector('textarea[aria-label="Message LB"]');await new Promise(r=>setTimeout(r,750));
 await p.evaluate(()=>{
  const original=window.fetch.bind(window);window.recoveryTest={mode:'ok',sendFailure:false};
  window.fetch=async(input,init)=>{
   const state=window.recoveryTest;
   if(input==='/api/chat/updates'&&String(init?.body).includes('/api/chat/history')){
    if(state.mode==='fail')throw new DOMException('signal is aborted without reason','AbortError');
    if(state.mode==='delayed')return new Promise((_resolve,reject)=>{state.reject=()=>reject(new DOMException('old room aborted','AbortError'));});
   }
   if(input==='/api/chat'&&init?.method==='POST'&&state.sendFailure)return Response.json({message:'Synthetic send failure'},{status:503});
   return original(input,init);
  };
 });
 const mode=async(value)=>p.evaluate(value=>{window.recoveryTest.mode=value;window.dispatchEvent(new Event('chat-room-refresh'));},value);
 await mode('fail');await p.waitForSelector('[data-chat-connection]');
 assert.match(await p.$eval('[data-chat-connection]',e=>e.textContent),/Reconnecting automatically/);
 assert(!await p.evaluate(()=>document.body.textContent.includes('signal is aborted')));
 // Repeated failures must not replace/flicker the existing warning element.
 await p.evaluate(()=>{window.warningNode=document.querySelector('[data-chat-connection]');window.dispatchEvent(new Event('chat-room-refresh'));});
 await new Promise(r=>setTimeout(r,350));assert(await p.evaluate(()=>window.warningNode===document.querySelector('[data-chat-connection]')));
 // A user action failure is independent and survives the successful history refresh.
 await p.evaluate(()=>{window.recoveryTest.sendFailure=true;});
 await p.type('textarea[aria-label="Message LB"]','Synthetic failed message');await p.click('button[type="submit"][data-state]');
 await p.waitForFunction(()=>document.querySelector('#longboard-chat-feedback')?.textContent.includes('Synthetic send failure'));
 await mode('ok');await p.waitForSelector('[data-chat-connection]',{hidden:true});
 assert.match(await p.$eval('#longboard-chat-feedback',e=>e.textContent),/Synthetic send failure/);
 await mode('fail');await p.waitForSelector('[data-chat-connection]');
 await mode('ok');await p.waitForSelector('[data-chat-connection]',{hidden:true});
 // A failure finishing after a room switch cannot contaminate the next room.
 await mode('delayed');await p.waitForFunction(()=>!!window.recoveryTest.reject);
 await p.evaluate(()=>{window.recoveryTest.mode='ok';document.querySelector('nav[aria-label="Chat rooms"] a[href="/chat?room=social"]').click();});
 await p.waitForSelector('textarea[aria-label="Message SOCIAL"]');
 await p.evaluate(()=>window.recoveryTest.reject());await new Promise(r=>setTimeout(r,750));
 assert.equal(await p.$('[data-chat-connection]'),null);
 await p.setViewport({width:390,height:844});await mode('fail');await p.waitForSelector('[data-chat-connection]');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await mode('ok');await p.waitForSelector('[data-chat-connection]',{hidden:true});
 assert.deepEqual(errors,[]);
 console.log('PASS timeout warning recovery, recurrence, stable repeated failure, independent send failure, stale room rejection, mobile recovery.');
}finally{await browser.close();}
