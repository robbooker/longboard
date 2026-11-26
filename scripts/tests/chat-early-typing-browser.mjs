// EARLY-TYPING: text typed into the room composer before the page takes over is kept.
// Run against the isolated fixture described in docs/chat-mobile-replies.md (ports 54404/3204).
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3204',composer='textarea[aria-label="Message LB"]';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const hydrated=p=>p.evaluate(s=>{const t=document.querySelector(s);return !!t&&Object.keys(t).some(k=>k.startsWith('__reactProps'));},composer);
try{
 const p=await browser.newPage();await p.setViewport({width:1440,height:900});
 await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});
 await p.type('#li-email','alice@example.test');await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector(composer);
 // Slow the page's scripts so the server-drawn composer is on screen well before it can take input.
 await p.setRequestInterception(true);p.on('request',r=>r.url().includes('/_next/static/chunks/')?setTimeout(()=>r.continue(),1500):r.continue());
 await p.goto(base+'/chat?room=main',{waitUntil:'domcontentloaded'});await p.waitForSelector(composer);
 assert.equal(await hydrated(p),false,'typed before the page took over');
 await p.type(composer,'Typed before the page was ready');
 await p.waitForFunction(s=>{const t=document.querySelector(s);return Object.keys(t).some(k=>k.startsWith('__reactProps'));},{timeout:60000},composer);
 await new Promise(r=>setTimeout(r,1500));
 assert.equal(await p.$eval(composer,e=>e.value),'Typed before the page was ready');
 // The kept text is the composer's own state: it sends.
 await p.type(composer,' and kept');await p.keyboard.press('Enter');
 await p.waitForFunction(s=>document.querySelector(s).value==='',{},composer);
 await p.waitForFunction(()=>document.body.textContent.includes('Typed before the page was ready and kept'));
 console.log('PASS text typed before hydration is kept, editable and sent.');
 // #526: a saved draft comes back only once the page takes over, so on a reload the box is empty for a moment.
 // What is typed into it then is kept after the saved draft (it used to be replaced by the draft).
 const taken=()=>p.waitForFunction(s=>{const t=document.querySelector(s);return !!t&&Object.keys(t).some(k=>k.startsWith('__reactProps'));},{timeout:60000},composer);
 const stored=()=>p.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('chat-refresh-draft:')&&k.endsWith(encodeURIComponent('room:main'))).map(k=>JSON.parse(sessionStorage.getItem(k)).text));
 await p.type(composer,'Saved draft');await p.waitForFunction(s=>document.querySelector(s).value==='Saved draft',{},composer);assert.deepEqual(await stored(),['Saved draft']);
 await p.goto(base+'/chat?room=main',{waitUntil:'domcontentloaded'});await p.waitForSelector(composer);
 assert.equal(await hydrated(p),false,'typed before the page took over, with a draft saved');assert.equal(await p.$eval(composer,e=>e.value),'');
 await p.type(composer,'typed early');await taken();
 await p.waitForFunction(s=>document.querySelector(s).value==='Saved draft typed early',{timeout:15000},composer).catch(async()=>assert.equal(await p.$eval(composer,e=>e.value),'Saved draft typed early','the saved draft and the early typing are both kept'));
 await p.waitForFunction(()=>Object.keys(sessionStorage).some(k=>k.startsWith('chat-refresh-draft:')&&sessionStorage.getItem(k).includes('Saved draft typed early')),{timeout:15000});
 // With nothing typed in between, the saved draft comes back as it was.
 await p.goto(base+'/chat?room=main',{waitUntil:'domcontentloaded'});await p.waitForSelector(composer);await taken();
 await p.waitForFunction(s=>document.querySelector(s).value==='Saved draft typed early',{timeout:15000},composer);assert.deepEqual(await stored(),['Saved draft typed early']);
 console.log('PASS a saved draft and text typed before hydration are both kept; an untouched reload restores the draft.');
}finally{await browser.close();}
