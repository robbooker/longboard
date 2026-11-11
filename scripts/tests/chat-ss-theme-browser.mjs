// #434 the ShortScout rooms follow the member's theme like every other room, against the fixture on
// this test's own ports (localhost:3434, database 127.0.0.1:54634; chat-ss-theme-fixture.mjs).
// Synthetic members only.
//  - with the blue Ocean combination saved, SS draws Ocean's colours (not its old pink), on the
//    first paint and on a 1280px computer and a 390px phone alike; SS Announcements too;
//  - picking another combination (Sky, Plum) in Profile settings repaints SS at once;
//  - under each of the four plain themes SS has the same colours as the LB room.
//  - Pink (the old SS pink) and Pink light turn LB and SS pink alike, on the computer and the phone.
// CHAT_SHOT_DIR saves t434-ss-ocean-desktop.png and t434-ss-ocean-phone.png (taken before the
// colour checks, so a run on the old code still leaves its picture), t434-pink-desktop.png and
// t434-pink-phone.png (LB in Pink).
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3434',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54634';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const shot=async(page,name)=>{if(shots){await sleep(700);await page.screenshot({path:path.join(shots,name)});}};
const control=async(p,body={})=>{const r=await fetch(fixture+'/test/'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const ACCOUNT="(select id from public.profiles where email='alice@example.test')";
const saveOcean=()=>sql(`insert into public.chat_activity_preferences(account_id,theme,palette) select ${ACCOUNT},'dark','ocean' on conflict(account_id) do update set theme='dark',palette='ocean' returning theme,palette`);
const THEME_KEY='longboard-public-chat-theme-v1',PALETTE_KEY='longboard-chat-palette-v1';

// The colours that ship, read from the one file that defines them.
const css=await readFile(new URL('../../components/chat/chatPalettes.css',import.meta.url),'utf8');
const shipped=id=>Object.fromEntries([...css.match(new RegExp(`\\[data-palette="${id}"\\][^{]*\\{([^}]*)\\}`))[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
const TOKENS=['--chat-bg','--chat-panel','--chat-text','--chat-palm','--chat-palm-fill','--chat-line'];
const look=page=>page.$eval('main[data-theme]',(m,tokens)=>({room:m.dataset.room,theme:m.dataset.theme,palette:m.dataset.palette??null,...Object.fromEntries(tokens.map(t=>[t,getComputedStyle(m).getPropertyValue(t).trim()]))}),TOKENS);
const expectPalette=(got,id,where)=>{const want=shipped(id);for(const t of TOKENS)assert.equal(got[t],want[t],`${where}: ${t} is ${id}'s (${JSON.stringify(got)})`);};
const inRoom=(page,room)=>page.waitForFunction(r=>document.querySelector('main[data-theme]')?.dataset.room===r,{timeout:60000},room);
const ready=page=>page.waitForFunction(()=>{const t=[...document.querySelectorAll('textarea[aria-label^="Message "]')].find(e=>e.checkVisibility());return t&&Object.keys(t).some(k=>k.startsWith('__reactProps$'));},{timeout:90000});
const openLook=page=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('chat-open-profile-settings',{detail:'look'})));
// (The picture above the swatches arrives on its own and moves them: wait for it before aiming a click.)
const pick=async(page,id)=>{await page.waitForSelector(`dialog[open] button[data-look="${id}"]`,{visible:true,timeout:60000});await page.waitForFunction(()=>!/Loading your picture/.test(document.querySelector('dialog[open]').textContent),{timeout:60000});await page.click(`dialog[open] button[data-look="${id}"]`);};
const picked=(page,theme,palette)=>page.waitForFunction((t,p)=>{const m=document.querySelector('main[data-theme]');return m.dataset.theme===t&&(m.dataset.palette??null)===p;},{timeout:3000},theme,palette);
// Before leaving the page: the pick's account save has gone out, so the next page reads it back.
const savedToAccount=page=>page.waitForResponse(r=>r.url().endsWith('/api/chat/theme')&&r.request().method()==='POST',{timeout:20000});
const closeDialog=async page=>{await page.keyboard.press('Escape');await page.waitForSelector('dialog[open]',{hidden:true});};
const device=async(context,page,theme,palette)=>{
  await context.setCookie({name:'longboard-chat-theme',value:theme,domain:'localhost',path:'/'},{name:'longboard-chat-palette',value:palette??'',domain:'localhost',path:'/'});
  await page.evaluateOnNewDocument((k,p,theme,palette)=>{try{if(!sessionStorage.getItem('t434')){localStorage.setItem(k,theme);if(palette)localStorage.setItem(p,palette);else localStorage.removeItem(p);}sessionStorage.setItem('t434','1');}catch{}},THEME_KEY,PALETTE_KEY,theme,palette);
};

// Alice is an admin, so she can open the ShortScout rooms; her account starts on Ocean (blue).
await sql("update public.profiles set role='admin' where email='alice@example.test'");
await saveOcean();
let saved;
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
try{
 const context=await browser.createBrowserContext(),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1280,height:900,isMobile:false,hasTouch:false});
 await device(context,page,'dark','ocean');
 await signIn(page,base,'alice@example.test',{next:'/chat?room=shortscout'});
 await inRoom(page,'shortscout');
 await shot(page,'t434-ss-ocean-desktop.png');
 let now=await look(page);
 assert.deepEqual([now.theme,now.palette],['dark','ocean']);
 expectPalette(now,'ocean','SS on a computer');

 // The server's first paint already carries it (no pink flash).
 const jar=(await context.cookies(`${base}/chat`)).map(k=>`${k.name}=${k.value}`).join('; ');
 const html=await (await fetch(`${base}/chat?room=shortscout`,{headers:{cookie:jar}})).text(),tag=html.match(/<main[^>]*data-theme="[^"]*"[^>]*>/)?.[0]??'';
 assert.ok(/data-palette="ocean"/.test(tag),`first paint draws Ocean: ${tag.slice(0,200)}`);

 // Another combination repaints SS at once.
 await ready(page);
 await openLook(page);
 for(const [id,theme] of [['sky','light'],['plum','dark']]){
  await pick(page,id);await picked(page,theme,id);
  expectPalette(await look(page),id,`SS after picking ${id}`);
 }
 await closeDialog(page);

 // SS Announcements is drawn as the SS room, and follows too.
 await page.goto(`${base}/chat?room=ss-announcements`,{waitUntil:'domcontentloaded'});
 await inRoom(page,'shortscout');
 await page.waitForFunction(()=>document.querySelector('main[data-theme]')?.dataset.palette==='plum',{timeout:60000});
 expectPalette(await look(page),'plum','SS Announcements');

 // Pink (the old SS pink, now for every room): picked on LB, LB and SS both turn pink; Pink light too.
 await page.goto(`${base}/chat?room=main`,{waitUntil:'domcontentloaded'});
 await inRoom(page,'main');await ready(page);
 await openLook(page);
 saved=savedToAccount(page);await pick(page,'pink');await picked(page,'dark','pink');
 assert.equal((await saved).status(),200);
 expectPalette(await look(page),'pink','LB after picking Pink');
 assert.equal((await look(page))['--chat-palm'],'#ff839f','the old SS pink accent');
 await closeDialog(page);
 await shot(page,'t434-pink-desktop.png');
 await page.goto(`${base}/chat?room=shortscout`,{waitUntil:'domcontentloaded'});
 await inRoom(page,'shortscout');
 await page.waitForFunction(()=>document.querySelector('main[data-theme]')?.dataset.palette==='pink',{timeout:60000});
 expectPalette(await look(page),'pink','SS with Pink');
 await ready(page);await openLook(page);
 saved=savedToAccount(page);await pick(page,'pink-light');await picked(page,'light','pink-light');
 assert.equal((await saved).status(),200);
 expectPalette(await look(page),'pink-light','SS after picking Pink light');
 await closeDialog(page);
 await page.goto(`${base}/chat?room=main`,{waitUntil:'domcontentloaded'});
 await inRoom(page,'main');
 await page.waitForFunction(()=>document.querySelector('main[data-theme]')?.dataset.palette==='pink-light',{timeout:60000});
 expectPalette(await look(page),'pink-light','LB with Pink light');

 // Under each plain theme SS has the LB room's colours.
 const plain={};
 for(const room of ['shortscout','main']){
  await page.goto(`${base}/chat?room=${room}`,{waitUntil:'domcontentloaded'});
  await inRoom(page,room);await ready(page);
  await openLook(page);
  for(const theme of ['dark','light','blade-runner','terminal']){
   await pick(page,theme);await picked(page,theme,null);await sleep(150);
   const {room:_r,...colours}=await look(page);
   if(room==='shortscout')plain[theme]=colours;else assert.deepEqual(plain[theme],colours,`SS matches LB under ${theme}`);
  }
  await closeDialog(page);
 }

 // A 390px phone, Ocean again: the same colours as the computer. (Once the last pick's account
 // save has gone out, so it cannot land after this.)
 await page.close();await sleep(2000);
 assert.deepEqual(await saveOcean(),[{theme:'dark',palette:'ocean'}]);
 const phoneContext=await browser.createBrowserContext(),phone=await phoneContext.newPage();
 phone.on('pageerror',e=>errors.push(e.message));
 await phone.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await device(phoneContext,phone,'dark','ocean');
 await signIn(phone,base,'alice@example.test',{next:'/chat?room=shortscout'});
 await inRoom(phone,'shortscout');
 await shot(phone,'t434-ss-ocean-phone.png');
 now=await look(phone);
 assert.deepEqual([now.theme,now.palette],['dark','ocean']);
 expectPalette(now,'ocean','SS on a phone');
 assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no sideways scroll');
 // Pink on the phone: SS turns pink at once, and so does LB.
 await ready(phone);await openLook(phone);
 saved=savedToAccount(phone);await pick(phone,'pink');await picked(phone,'dark','pink');
 assert.equal((await saved).status(),200);
 expectPalette(await look(phone),'pink','SS on a phone after picking Pink');
 await closeDialog(phone);
 await phone.goto(`${base}/chat?room=main`,{waitUntil:'domcontentloaded'});
 await inRoom(phone,'main');
 await phone.waitForFunction(()=>document.querySelector('main[data-theme]')?.dataset.palette==='pink',{timeout:60000});
 expectPalette(await look(phone),'pink','LB on a phone with Pink');
 await shot(phone,'t434-pink-phone.png');
 assert.deepEqual(errors,[]);
 console.log('chat-ss-theme: ok');
}finally{await browser.close();}
