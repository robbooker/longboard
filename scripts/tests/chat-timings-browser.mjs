// CHAT-TIMING: a sampled session sends one beacon of timings when the tab hides, with only
// metric names, numbers, room slugs and phone/desktop; an unsampled session sends nothing.
// EVENT-STREAM step 3: each row also says whether the room's event stream was on for it (`s`);
// this fixture has no realtime connection, so every row here is "off" (chat-event-stream-browser
// checks "on").
// Runs against chat-mobile-fixture.mjs (the fixture applies every migration, chat_timings too).
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const fixture='http://localhost:54404/rest/v1/';
const app='http://localhost:3204';
async function rest(path,body){const response=await fetch(fixture+path,{method:body?'POST':'GET',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json',prefer:'return=representation'},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;}
const SECRET='Timing beacon private words 7731';
async function session(sampled){
 const context=await browser.createBrowserContext();
 const page=await context.newPage();page.setDefaultTimeout(120000);page.setDefaultNavigationTimeout(120000);await page.setViewport({width:1440,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const requests=[];page.on('request',r=>{if(r.url().includes('/api/chat/timings'))requests.push({method:r.method(),body:r.postData()??''});});
 await page.evaluateOnNewDocument((flag)=>{
  sessionStorage.setItem('longboard-chat-timings-v1',flag);
  window.__beacons=[];const send=navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon=(url,data)=>{window.__beacons.push({url:String(url),type:data?.type??''});data.text().then(t=>window.__beacons.at(-1).body=t);return send(url,data);};
 },sampled?'1':'0');
 await page.goto(`${app}/login?next=%2Fchat`);await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');
 await page.waitForSelector('textarea[aria-label="Message LB"]');
 // A full page load of /chat, so open_first_message is timed.
 await page.goto(`${app}/chat`,{waitUntil:'load'});await page.waitForSelector('textarea[aria-label="Message LB"]');
 await page.waitForSelector('[role="log"]:not([data-positioning]) [id^="chat-message-"]');
 await new Promise(r=>setTimeout(r,900));
 await page.click('a[href*="room=social"]');await page.waitForSelector('textarea[aria-label="Message Social"]',{visible:true});
 await page.waitForSelector('[role="log"]:not([data-positioning]) [id^="chat-message-"]');
 await page.type('textarea[aria-label="Message Social"]',SECRET);await page.keyboard.press('Enter');
 await page.waitForFunction((t)=>[...document.querySelectorAll('[id^="chat-message-"]')].some(n=>n.textContent.includes(t)&&!n.id.includes('pending')),{},SECRET);
 await new Promise(r=>setTimeout(r,900));
 // Someone else's message arriving live (the fixture has no realtime socket, so the test
 // delivers the row the way both transports do: a chat-room-event).
 const [bob]=await rest('longboard_chat_members?select=id&display_name=eq.Bob');
 const [row]=await rest('longboard_chat_messages',{room_slug:'social',member_id:bob.id,guest_id:bob.id,author_label:'Bob',body:'Bob live arrival sentence'});
 await page.evaluate((row)=>window.dispatchEvent(new CustomEvent('chat-room-event',{detail:{eventType:'INSERT',new:row,old:{}}})),row);
 await page.waitForSelector(`[id="chat-message-${row.id}"]`);await new Promise(r=>setTimeout(r,300));
 const texts=await page.evaluate(()=>[...document.querySelectorAll('[id^="chat-message-"]')].map(n=>({id:n.id.slice(13),text:n.textContent})));
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await new Promise(r=>setTimeout(r,500));
 // A second hide with nothing new sends nothing more.
 await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));});
 await new Promise(r=>setTimeout(r,1500));
 const beacons=await page.evaluate(()=>window.__beacons);
 await context.close();
 return {beacons,requests,texts,errors};
}
try{
 const before=(await rest('chat_timings?select=id')).length;
 const off=await session(false);
 assert.deepEqual(off.beacons,[],'an unsampled session sends no beacon');
 assert.deepEqual(off.requests,[],'an unsampled session makes no timing requests at all');
 assert.equal((await rest('chat_timings?select=id')).length,before);

 const on=await session(true);
 assert.equal(on.beacons.length,1,JSON.stringify(on.beacons));
 const [beacon]=on.beacons;
 assert.ok(beacon.url.endsWith('/api/chat/timings'));assert.match(beacon.type,/^text\/plain/);
 const batch=JSON.parse(beacon.body);
 assert.deepEqual(Object.keys(batch).sort(),['device','rows']);assert.equal(batch.device,'desktop');
 for(const row of batch.rows){assert.deepEqual(Object.keys(row).sort(),['m','r','s','v']);assert.equal(row.s,'off','no realtime here: the stream is off');assert.ok(Number.isInteger(row.v)&&row.v>=0);assert.ok(['main','social'].includes(row.r));}
 const metrics=new Set(batch.rows.map(r=>r.m));
 for(const m of ['open_first_message','room_switch','send_visible','delivery_lag','tap_response','wrong_landing'])assert.ok(metrics.has(m),`${m} recorded: ${beacon.body}`);
 // No message text, names or ids anywhere in the beacon.
 for(const {id,text} of on.texts){assert.ok(!beacon.body.includes(id),'no message ids');for(const word of text.split(/\s+/).filter(w=>w.length>=5&&!/^\d+$/.test(w)))assert.ok(!beacon.body.includes(word),`no message text (${word})`);}
 for(const word of [SECRET,'Alice','Bob','alice@example.test','00000000-0000-4000-8000'])assert.ok(!beacon.body.includes(word),word);
 assert.ok(on.requests.some(r=>r.method==='GET'),'one clock read');assert.equal(on.requests.filter(r=>r.method==='GET').length,1);
 // The batch reached the table as-is.
 let stored=[];for(let i=0;i<20&&stored.length<before+batch.rows.length;i++){stored=await rest('chat_timings?select=metric,value,room,device,stream&order=id');await new Promise(r=>setTimeout(r,250));}
 assert.equal(stored.length,before+batch.rows.length);
 assert.deepEqual(stored.slice(before).map(r=>[r.metric,r.value,r.room,r.device,r.stream]),batch.rows.map(r=>[r.m,r.v,r.r,'desktop',r.s]));
 assert.deepEqual([...off.errors,...on.errors],[]);
 console.log('PASS sampled session: one text/plain beacon on hide with',batch.rows.length,'rows',JSON.stringify([...metrics]),'stored as-is; no message text, names or ids; unsampled session sends nothing');
 console.log(beacon.body);
}finally{await browser.close();}
