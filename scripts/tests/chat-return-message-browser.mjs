// Real production chat components against the isolated synthetic chat fixture.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base=process.env.CHAT_TEST_URL||'http://localhost:3346';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:900});await page.goto(base+'/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 const dm=await page.evaluate(async()=>{const data=await(await fetch('/api/chat/inbox')).json();const c=data.conversations.find(c=>c.otherName==='Bob');if(c.status==='pending')await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'accept',target:c.id})});return c.id;});
 await page.evaluate(()=>{
  const original=window.fetch.bind(window);window.sendTest={mode:'normal',count:0,done:0};
  window.fetch=async(input,init)=>{let body;try{body=JSON.parse(init?.body||'null');}catch{}
   if((input==='/api/chat'||input==='/api/chat/inbox')&&body?.action==='send'){
    const state=window.sendTest;state.count++;
    if(state.mode==='hold')await new Promise(resolve=>{state.release=resolve;});
    const response=state.mode==='fail'?Response.json({message:'Synthetic send failure',error:'Synthetic send failure'},{status:503}):await original(input,init);
    state.last=await response.clone().json();state.done++;return response;
   }
   return original(input,init);
  };
 });
 const room='textarea[aria-label="Message LB"]',dmInput='textarea[placeholder="Write a private message…"]';
 const focus=async selector=>{await page.waitForFunction(selector=>{const e=document.querySelector(selector);return e===document.activeElement&&e.value===''&&e.selectionStart===0&&!e.readOnly&&!e.disabled;},{},selector);};
 const send=async(selector,method,text)=>{if(selector===room)await new Promise(r=>setTimeout(r,1600));await page.type(selector,text);await page.waitForFunction(selector=>{const e=document.querySelector(selector);return e&&!e.form.querySelector('button[type="submit"],button:not([type])').disabled;},{},selector);if(method==='Enter')await page.keyboard.press('Enter');else {const input=await page.$(selector);const button=await input.evaluateHandle(e=>e.form.querySelector('button[type="submit"],button:not([type])'));await button.click();}};
 for(const width of [1440,390]) {
  await page.setViewport({width,height:844});
  for(const method of ['Enter','button']){
   const before=await page.evaluate(()=>window.sendTest.done);await send(room,method,`Room ${width} ${method}`);
   await page.waitForFunction(n=>window.sendTest.done>n,{},before);try{await focus(room);}catch(e){console.error('FOCUS',width,method,await page.evaluate(()=>({active:document.activeElement.outerHTML,inputs:[...document.querySelectorAll('textarea')].map(e=>({value:e.value,readOnly:e.readOnly,disabled:e.disabled,start:e.selectionStart})),hidden:document.hidden,last:window.sendTest.last,feedback:document.querySelector('#longboard-chat-feedback')?.textContent})));throw e;}
  }
  // Duplicate Enter during a delayed request does not send twice; focus is retained.
  await page.evaluate(()=>{window.sendTest.mode='hold';window.sendTest.release=null;});
  await send(room,'button',`Slow room ${width}`);await page.waitForFunction(()=>!!window.sendTest.release);
  const count=await page.evaluate(()=>window.sendTest.count);await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.sendTest.count),count);
  assert.equal(await page.$eval(room,e=>e.readOnly),true);
  await page.evaluate(()=>{window.sendTest.mode='normal';window.sendTest.release();});await focus(room);
  // Deliberate settings interaction wins over a delayed send confirmation.
  await page.evaluate(()=>{window.sendTest.mode='hold';window.sendTest.release=null;});await send(room,'Enter','Do not steal focus');await page.waitForFunction(()=>!!window.sendTest.release);
  await page.click('button[aria-label="Chat settings"]');await page.waitForSelector('#chat-settings-panel');
  const before=await page.evaluate(()=>window.sendTest.done);await page.evaluate(()=>{window.sendTest.mode='normal';window.sendTest.release();});await page.waitForFunction(n=>window.sendTest.done>n,{},before);
  await new Promise(r=>setTimeout(r,100));assert.equal(await page.$eval(room,e=>e===document.activeElement),false);await page.keyboard.press('Escape');
  await page.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),dm);await page.waitForSelector(dmInput,{visible:true});
  for(const method of ['Enter','button']){
   const before=await page.evaluate(()=>window.sendTest.done);await send(dmInput,method,`DM ${width} ${method}`);await page.waitForFunction(n=>window.sendTest.done>n,{},before);await focus(dmInput);
  }
  await page.click('button[aria-label="Back to LB room"]');await page.waitForSelector(room,{visible:true});
 }
 await page.evaluate(()=>{window.sendTest.mode='fail';});await send(room,'Enter','Keep failed room draft');
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Message LB"]')?.value==='Keep failed room draft');assert.equal(await page.$eval(room,e=>e===document.activeElement),true);
 assert.deepEqual(errors,[]);await page.screenshot({path:'/tmp/chat-return-message-mobile.png'});
 console.log('PASS real desktop/mobile room and DM Enter/button sends, success focus/caret, duplicate Enter guard, delayed settings focus preservation, failed room draft/focus, no page errors.');
}finally{await browser.close();}
