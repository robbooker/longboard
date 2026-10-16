// WRONG-LANDING: on a phone (390px, opening from the room list) every room lands where it should
// (the newest message, or the first unread) and CHAT-TIMING's wrong_landing reports 0 for it.
// Covers the room mounted under the list on plain /chat (it used to stay at its top, unmeasured),
// a room switch onto an unread spot, a room that opens into an unread thread (its covered list
// is not judged; it used to read as thousands of px off), and back. Runs against
// chat-mobile-fixture.mjs.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const fixture='http://localhost:54492/rest/v1/';
const app='http://localhost:3292';
async function rest(path,body,method){const response=await fetch(fixture+path,{method:method??(body?'POST':'GET'),headers:{authorization:'Bearer test-service-role','Content-Type':'application/json',prefer:'return=representation'},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 // SOCIAL gets 80 messages of mixed length; Alice has read the first 50 of them.
 const [bob]=await rest('longboard_chat_members?select=id&display_name=eq.Bob');
 const social=[];
 for(let i=1;i<=80;i++)social.push((await rest('longboard_chat_messages',{room_slug:'social',member_id:bob.id,guest_id:bob.id,author_label:'Bob',body:`Social line ${i} `+'with a few more words '.repeat(i%5*3),created_at:new Date(Date.now()-(100-i)*60000).toISOString()}))[0]);
 await rest('chat_room_reads?room_slug=eq.social',{through_seq:social[49].unread_seq},'PATCH');
 const firstUnread=social[50].id;

 const page=await browser.newPage();page.setDefaultTimeout(60000);
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluateOnNewDocument(()=>{
  sessionStorage.setItem('longboard-chat-timings-v1','1');
  window.__beacons=[];const send=navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon=(url,data)=>{data.text().then(t=>window.__beacons.push(t));return send(url,data);};
 });
 const nav='nav[aria-label="Chat rooms"]',section='section[aria-label="Longboard Chat"]',list=`${section} [role="log"]`;
 const back='button[aria-label="Back to all chats"]';
 const listShows=()=>page.waitForFunction((n,s)=>{const e=document.querySelector(n);return e&&getComputedStyle(e).visibility==='visible'&&document.querySelector(s).inert;},{},nav,section);
 // The conversation is in (slid in, not under the list) and its list has stopped moving.
 const settled=async()=>{
  await page.waitForFunction((n,l)=>{const e=document.querySelector(l);if(!e||getComputedStyle(document.querySelector(n)).visibility!=='hidden')return false;return e.getBoundingClientRect().left===0;},{},nav,list);
  let last='';for(let i=0;i<40;i++){const now=await page.$eval(list,e=>`${e.scrollTop}:${e.scrollHeight}`);if(now===last)break;last=now;await pause(150);}
 };
 // wrong_landing is checked 600 ms after the room is ready; stay a little longer before leaving.
 const judged=()=>pause(900);
 const fromBottom=()=>page.$eval(list,e=>e.scrollHeight-e.scrollTop-e.clientHeight);
 const rowInView=id=>page.$eval(list,(e,id)=>{const row=document.getElementById(`chat-message-${id}`);if(!row)return false;const p=e.getBoundingClientRect(),r=row.getBoundingClientRect();return r.bottom>p.top&&r.top<p.bottom;},id);
 const tapRoom=async room=>{const link=`${nav} a[href="/chat?room=${room}"]`;await page.waitForSelector(link,{visible:true});await page.tap(link);};

 await page.goto(`${app}/login?next=%2Fchat`);await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');
 await page.waitForSelector('textarea[aria-label="Message LB"]');
 await page.goto(`${app}/chat`,{waitUntil:'load'});await listShows();
 await page.waitForSelector(`${list}:not([data-positioning]) [id^="chat-message-"]`);await pause(1000);

 // 1. The room under the list (LB): touch the list first, as a person does, then open LB from it.
 const cdp=await page.createCDPSession();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:600}]});
 for(let i=1;i<=5;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:200,y:600-12*i}]});await pause(16);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await pause(300);
 await tapRoom('main');await settled();
 await judged();await page.screenshot({path:'/tmp/phone-landing-main.png'});
 assert.ok(await fromBottom()<=2,`LB opened from the list at the newest message (${await fromBottom()}px from it)`);

 // 2. Back, then SOCIAL: it opens at the first unread message, under "Unread starts here".
 await page.tap(back);await listShows();
 await tapRoom('social');await page.waitForSelector('textarea[aria-label="Message SOCIAL" i]');await settled();
 await page.waitForSelector(`[id="chat-message-${firstUnread}"][data-unread-start]`);
 await judged();await page.screenshot({path:'/tmp/phone-landing-social.png'});
 assert.ok(await rowInView(firstUnread),'SOCIAL opened at its first unread message');
 assert.ok(await fromBottom()>844,'and not at the bottom (the unread spot is far above it)');

 // 3. Back; a reply arrives on an older LB message, so LB opens into that unread thread.
 await page.tap(back);await listShows();
 const [parent]=await rest('longboard_chat_messages?select=id&room_slug=eq.main&body=eq.History%20message%2060');
 await rest('longboard_chat_messages',{room_slug:'main',member_id:bob.id,guest_id:bob.id,author_label:'Bob',body:'Unread reply for the phone',reply_to_id:parent.id});
 await tapRoom('main');
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-unread-start]')].some(n=>n.textContent.includes('Unread reply for the phone')&&n.getBoundingClientRect().width>0));
 await pause(1200);
 await page.screenshot({path:'/tmp/phone-landing-thread.png'});
 // Closing the thread shows LB at the message it belongs to.
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/^←\s*Chat$/.test(b.textContent.trim()))?.click());
 await page.waitForFunction(l=>{const e=document.querySelector(l);return e&&getComputedStyle(e).visibility==='visible';},{},list);await settled();
 assert.ok(await rowInView(parent.id),'LB shows the thread\'s message after the thread closes');

 // 4. Back to the list and SOCIAL again.
 await page.tap(back);await listShows();
 await tapRoom('social');await page.waitForSelector('textarea[aria-label="Message SOCIAL" i]');await settled();await judged();

 // The sampled session's beacon: every judged landing is 0, and the thread opening is not judged.
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await pause(800);
 const beacons=await page.evaluate(()=>window.__beacons);
 assert.equal(beacons.length,1,JSON.stringify(beacons));
 const batch=JSON.parse(beacons[0]);
 assert.equal(batch.device,'phone');
 const landings=batch.rows.filter(r=>r.m==='wrong_landing');
 assert.deepEqual(landings.map(r=>[r.r,r.v]),[['main',0],['social',0],['social',0]],beacons[0]);
 assert.ok(batch.rows.filter(r=>r.m==='room_switch').length>=3,'room switches are still timed, the thread opening too');
 assert.deepEqual(errors,[]);
 console.log('PASS phone landing: LB from the list at the newest message, SOCIAL at its first unread, LB into an unread thread (not judged) and back to its message, SOCIAL again; wrong_landing',JSON.stringify(landings));
}finally{await browser.close();}
