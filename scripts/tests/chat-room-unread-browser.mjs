import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const fixture='http://localhost:54404/rest/v1/';
async function rest(path,body){const response=await fetch(fixture+path,{method:body?'POST':'GET',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json',prefer:'return=representation'},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;}
try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3204/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 const [bob]=await rest('longboard_chat_members?select=id&display_name=eq.Bob');
 await rest('longboard_chat_messages',{room_slug:'social',member_id:bob.id,guest_id:null,author_label:'Bob',body:'Unread social verification'});
 await page.waitForSelector('a[href*="room=social"] [aria-label="1 unread messages"]');
 await page.screenshot({path:'/tmp/unread-desktop.png'});
 await page.click('a[href*="room=social"]');await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');
 await page.waitForFunction(async()=>{const a=await (await fetch('/api/chat/activity')).json();return a.roomMessageCounts.social===0;});
 await page.waitForFunction(()=>!document.querySelector('a[href*="room=social"] [aria-label*="unread messages"]'));
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');await page.waitForFunction(async()=>{const a=await (await fetch('/api/chat/activity')).json();return a.roomMessageCounts.social===0;});assert.equal(await page.$('a[href*="room=social"] [aria-label*="unread messages"]'),null);
 await rest('longboard_chat_messages',{room_slug:'main',member_id:bob.id,guest_id:null,author_label:'Bob',body:'Unread mobile verification'});
 await page.setViewport({width:390,height:844});await page.click('button[aria-label="Open room navigation"]');
 await page.waitForSelector('a[href*="room=main"] [aria-label="1 unread messages"]',{timeout:10000});
 await page.screenshot({path:'/tmp/unread-mobile.png'});
 await page.click('a[href*="room=main"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 await page.waitForFunction(()=>!document.querySelector('a[href*="room=main"] [aria-label*="unread messages"]'));
 const invalid=await page.evaluate(async()=>{const r=await fetch('/api/chat/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'room',room:'main',mentionThrough:0,roomThrough:-1})});return r.status;});assert.equal(invalid,400);
 assert.deepEqual(errors,[]);console.log('PASS desktop/mobile ordinary-message badges, opening clears, reload stays read, invalid cursor rejected, no browser errors');
}finally{await browser.close();}
