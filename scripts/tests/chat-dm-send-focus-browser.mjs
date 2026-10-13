import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:1000});await page.goto('http://localhost:3261/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type=submit]');await page.waitForSelector('textarea[aria-label^="Message "]');
 const conversation=await page.evaluate(async()=>{const list=await(await fetch('/api/chat/inbox')).json();const c=list.conversations.find(c=>c.otherName==='Bob');if(c.status==='pending')await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'accept',target:c.id})});return c.id;});
 const fixtureHeaders={authorization:'Bearer test-service-role','Content-Type':'application/json'};
 const members=await(await fetch('http://127.0.0.1:54461/rest/v1/longboard_chat_members',{headers:fixtureHeaders})).json();const existing=await(await fetch('http://127.0.0.1:54461/rest/v1/longboard_chat_conversations',{headers:fixtureHeaders})).json();const otherId=existing.find(c=>c.recipient_id===members.find(m=>m.display_name==='Mallory').id)?.id||crypto.randomUUID();
 await fetch('http://127.0.0.1:54461/rest/v1/longboard_chat_conversations',{method:'POST',headers:fixtureHeaders,body:JSON.stringify({id:otherId,requester_id:members.find(m=>m.display_name==='Alice').id,recipient_id:members.find(m=>m.display_name==='Mallory').id,status:'accepted'})});
 // Wait for hydration: keys typed earlier miss the composer's handlers (EARLY-TYPING).
 await page.reload();await page.waitForFunction(()=>{const t=document.querySelector('textarea');return t&&Object.keys(t).some(k=>k.startsWith('__reactProps'));});await page.waitForSelector('nav button[data-active]');
 const open=async()=>{await page.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),conversation);await page.waitForSelector('#dm-body',{visible:true});
  // A send while the conversation is still opening is ignored, so let it finish.
  await page.waitForSelector('section[aria-label="Private conversation"] [aria-label="Loading messages"]',{hidden:true});await new Promise(r=>setTimeout(r,500));await page.click('#dm-body');};await open();
 let held=null,mode='normal';await page.setRequestInterception(true);page.on('request',r=>{let body;try{body=JSON.parse(r.postData()||'null');}catch{}if(r.url().endsWith('/api/chat/inbox')&&body?.action==='send'&&mode!=='normal'){held=r;return;}void r.continue();});
 const settled=()=>page.waitForFunction(()=>!document.querySelector('#dm-body')?.disabled);
 const focused=()=>page.evaluate(()=>document.activeElement?.id==='dm-body');
 const send=async(method,text)=>{await page.type('#dm-body',text);if(method==='Enter')await page.keyboard.press('Enter');else{for(const button of await page.$$('section[aria-label="Private conversation"] form button'))if((await button.evaluate(e=>e.textContent)).trim()==='Send message'){await button.click();break;}}};
 for(const width of [1440,390]){
  await page.setViewport({width,height:844,isMobile:width===390,hasTouch:width===390});await page.waitForSelector('nav button[data-active]');await open();
  // On phones Return adds a new line (U7), so only the button sends there.
  for(const method of width===390?['button']:['Enter','button']){await send(method,`focus ${width} ${method}`);await page.waitForFunction(()=>document.querySelector('#dm-body')?.value==='');await settled();await page.waitForFunction(()=>document.activeElement?.id==='dm-body');}
  // Since #308 a send clears the composer at once and a failure shows "Not sent" with Retry on the message.
  mode='hold';await send('button','retry draft');await page.waitForFunction(()=>document.querySelector('#dm-body').value==='');while(!held)await new Promise(r=>setTimeout(r,10));await held.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic send failure'})});held=null;
  const failed='section[aria-label="Private conversation"] article[data-send-state="failed"]';await page.waitForFunction(s=>document.querySelector(s)?.textContent.includes('retry draft'),{},failed);assert.equal(await focused(),true);
  mode='normal';for(const b of await page.$$(failed+' button'))if((await b.evaluate(e=>e.textContent)).trim()==='Retry message'){await b.click();break;}await page.waitForSelector(failed,{hidden:true});
 }
 await page.setViewport({width:1440,height:1000});await page.waitForSelector('nav button[data-active]');
 for(const move of ['outside','modal','switch','close']){
  await open();mode='hold';await send('button',`slow ${move}`);while(!held)await new Promise(r=>setTimeout(r,10));
  if(move==='outside')await page.evaluate(()=>{const b=document.createElement('button');b.id='outside-focus';b.textContent='Outside';document.body.append(b);b.focus();});
  if(move==='modal')await page.evaluate(()=>{const d=document.createElement('dialog');d.id='test-modal';d.innerHTML='<button id="modal-focus">Close</button>';document.body.append(d);d.showModal();d.querySelector('button').focus();});
  if(move==='switch')await page.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),otherId);
  if(move==='close')await page.evaluate(()=>document.querySelector('nav a[href="/chat?room=main"]').click());
  if(move==='switch')await page.waitForFunction(()=>document.querySelector('header[data-dm="true"] h1')?.textContent==='Mallory');
  if(move==='close')await page.waitForSelector('#dm-body',{hidden:true});
  await new Promise(r=>setTimeout(r,200));await held.continue();held=null;mode='normal';await new Promise(r=>setTimeout(r,800));
  // Opening another DM focuses its own composer; the late send must not change that or the others.
  if(move==='switch')assert.equal(await page.$eval('#dm-body',e=>e.value),'');else assert.equal(await focused(),false,move);
  if(move==='outside'){await page.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));await new Promise(r=>setTimeout(r,300));assert.equal(await page.evaluate(()=>document.activeElement.id),'outside-focus');await page.evaluate(()=>document.getElementById('outside-focus').remove());}
  if(move==='modal'){assert.equal(await page.evaluate(()=>document.activeElement.id),'modal-focus');await page.evaluate(()=>document.getElementById('test-modal').remove());}
 }
 assert.deepEqual(errors,[]);console.log('PASS desktop/mobile Enter/button success, failure shown on the message with Retry, focus kept; delayed send outside focus/modal/switch/close suppression; unrelated inbox refresh does not steal focus.');
}finally{await browser.close();}
