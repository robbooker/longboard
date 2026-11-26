// #458 Gainers Table: the overseas marker beside a "US" block, on a computer and a phone, light and
// dark, against the fixture on this test's own ports (localhost:3458, database 127.0.0.1:54458) and a
// fake Short Check (chat-gainers-nexus-preload.mjs; the real feed is never reached). Synthetic only.
//  - AIMD (U.S. address, Short Check: Taiwan and the Cayman Islands) has a small globe marker "TW+1"
//    right after its grey "US" block, on the same line; its title and accessible name are "Operates
//    overseas: Taiwan, Cayman Islands. <reason> (as of Nov 10, 2026). Source: Short Check";
//  - USCO (U.S., clear), SLOW (U.S., Short Check too slow: the table doesn't wait for it) and CHNA
//    (China: never asked) have none; GONE (country still being looked up) has none;
//  - clicking or tapping the marker shows the same words under it with a "SEC filing" link (new tab,
//    sec.gov) without opening the row's press releases (computer) or details (phone); Escape, a tap
//    elsewhere or tapping it again hides it; the country's own tip still works beside it;
//  - the marker's letters are readable on its background (contrast 4.5:1 or more) in light and dark
//    (and Paper Terminal, #464);
//  - nothing scrolls sideways on a phone (390px and 360px).
// CHAT_SHOT_DIR saves t458-desktop-light.png, t458-desktop-dark.png, t458-desktop-tip.png,
// t458-phone-light.png, t458-phone-dark.png and t458-phone-tip.png.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3458',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54458';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,TOKEN='synthetic-gainers-lookup-token-never-a-production-secret';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let source=1;
const ago=s=>new Date(Date.now()-s*1000).toISOString();
const alert=(sym,secondsAgo,vol)=>sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source++,ago(secondsAgo),`🚨 ${sym} (+${(40+source).toFixed(1)}%)\nPrice: $2.50\nVolume: ${vol.toLocaleString('en-US')}\nMarket Cap: 12.5M`]);
const etMinutes=(()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return Number(p.hour)*60+Number(p.minute);})();
// #525: run-browser-tests.mjs pins this test to 9:00 AM New York (clock in browser-manifest.mjs), so this only ever stops a run by hand.
assert(etMinutes>=15,'run by hand, without run-browser-tests.mjs and its 9:00 AM New York clock: at least 15 minutes after midnight in New York');

await alert('AIMD',60,900000);
await alert('USCO',120,500000);
await alert('SLOW',180,400000);
await alert('CHNA',240,300000);
await alert('GONE',300,200000);
const save=async body=>{const r=await fetch(`${base}/api/chat/gainers/facts`,{method:'POST',headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify({notFound:false,country:null,cashUsd:null,cashMonthsLeft:null,cashFlowPositive:false,instOwnPct:null,...body})});assert.equal(r.status,200,await r.text());};
await save({ticker:'AIMD',country:'United States',cashUsd:8_400_000,cashMonthsLeft:7.2,instOwnPct:3.1});
await save({ticker:'USCO',country:'U.S.',cashUsd:31_500_000,cashMonthsLeft:30,instOwnPct:12.5});
await save({ticker:'SLOW',country:'USA',cashUsd:2_000_000,cashMonthsLeft:3,instOwnPct:1});
await save({ticker:'CHNA',country:'China',cashUsd:5_000_000,cashMonthsLeft:12,instOwnPct:0.5});

const WORDS='Operates overseas: Taiwan, Cayman Islands. Listed in the US. Filings tie operations or control to Taiwan and the Cayman Islands (as of Nov 10, 2026). Source: Short Check';
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
// Pictures at twice the pixels, so the small marker is sharp in them.
const scale=shots?2:1,desktop={width:1280,height:720,isMobile:false,hasTouch:false,deviceScaleFactor:scale},phone={width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:scale};
const markers=page=>page.$$eval('[data-gainers-row]',trs=>trs.map(tr=>{const m=tr.querySelector('[data-nexus]'),b=tr.querySelector('[data-country-block]');return [tr.dataset.gainersRow,b?.dataset.countryBlock??null,m?m.querySelector('button').textContent:null];}));
// The marker's letters against its own background, as a contrast ratio (WCAG).
const contrast=page=>page.$eval('[data-gainers-row="AIMD"] [data-nexus] button',btn=>{
 const rgb=c=>{const x=document.createElement('canvas').getContext('2d');x.fillStyle=c;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3);};
 const lum=c=>{const [r,g,b]=rgb(c).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;};
 const s=getComputedStyle(btn),a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
const sideways=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
async function open(page,theme,viewport){
 await page.setViewport(viewport);
 // The look is saved on the account (and the device): set all three, as the theme menu does.
 const saved=await page.evaluate(async theme=>{try{localStorage.setItem('longboard-public-chat-theme-v1',theme);}catch{}const r=await fetch('/api/chat/theme',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({theme})});return r.status;},theme);
 assert.equal(saved,200,`saving the ${theme} look`);
 await page.browserContext().setCookie({name:'longboard-chat-theme',value:theme,domain:'localhost',path:'/chat'});
 await page.goto(`${base}/chat?page=gainers-table`,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-gainers-row="AIMD"] [data-nexus]',{visible:true,timeout:60000});
 await page.waitForFunction(theme=>document.querySelector(`main[data-theme="${theme}"]`),{timeout:10000},theme);
 await sleep(400);
}
async function checkMarker(page,label){
 assert.deepEqual(await markers(page),[['AIMD','US','TW+1'],['USCO','US',null],['SLOW','US',null],['CHNA','CN',null],['GONE','looking',null]],`${label}: only AIMD has the marker`);
 const m=await page.$eval('[data-gainers-row="AIMD"] [data-nexus] button',b=>({title:b.title,label:b.getAttribute('aria-label'),expanded:b.getAttribute('aria-expanded'),svgHidden:b.querySelector('svg').getAttribute('aria-hidden')}));
 assert.deepEqual(m,{title:WORDS,label:WORDS,expanded:'false',svgHidden:'true'},`${label}: hover words and accessible name`);
 // On the same line as the US block, right after it, the same height or less.
 const at=await page.$eval('[data-gainers-row="AIMD"] [data-country-block]',b=>{const us=b.querySelector('button').getBoundingClientRect(),n=b.querySelector('[data-nexus] button').getBoundingClientRect();return {gap:n.left-us.right,mid:Math.abs((n.top+n.bottom)/2-(us.top+us.bottom)/2),h:n.height,usH:us.height};});
 assert(at.gap>=1&&at.gap<=6&&at.mid<=1.5&&at.h<=at.usH+1,`${label}: the marker sits right after US ${JSON.stringify(at)}`);
 const ratio=await contrast(page);
 assert(ratio>=4.5,`${label}: the marker is readable (contrast ${ratio.toFixed(2)})`);
 console.log(`${label}: marker contrast ${ratio.toFixed(2)}`);
}
async function checkTip(page,label,tapping){
 const press=sel=>tapping?page.tap(sel):page.click(sel);
 await press('[data-gainers-row="AIMD"] [data-nexus] button');
 await page.waitForSelector('[data-nexus-tip]',{visible:true,timeout:5000});
 const tip=await page.$eval('[data-nexus-tip]',t=>{const a=t.querySelector('a'),r=t.getBoundingClientRect();return {text:t.textContent,href:a?.href,target:a?.target,rel:a?.rel,right:r.right,width:innerWidth,id:t.id,describes:document.querySelector('[data-gainers-row="AIMD"] [data-nexus] button').getAttribute('aria-describedby'),expanded:document.querySelector('[data-gainers-row="AIMD"] [data-nexus] button').getAttribute('aria-expanded')};});
 assert.equal(tip.text,`${WORDS} SEC filing`,`${label}: the tip's words`);
 assert.match(tip.href,/^https:\/\/www\.sec\.gov\//);assert.equal(tip.target,'_blank');assert.match(tip.rel,/noopener/);
 assert.equal(tip.describes,tip.id);assert.equal(tip.expanded,'true');
 assert(tip.right<=tip.width,`${label}: the tip stays on screen ${JSON.stringify(tip)}`);
 assert.equal(await page.$('[data-gainers-news]'),null,`${label}: the row's press releases stay shut`);
 assert.equal(await page.$('[data-gainers-details]'),null,`${label}: the row's details stay shut`);
 // A tap on the tip's words keeps it open and the row shut.
 await press('[data-nexus-tip]');await sleep(150);
 assert(await page.$('[data-nexus-tip]'),`${label}: tapping the words keeps the tip`);
 assert.equal(await page.$('[data-gainers-news]'),null);assert.equal(await page.$('[data-gainers-details]'),null);
}
try{
 // A computer: light, then dark.
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(desktop);
  await context.setCookie({name:'longboard-chat-theme',value:'light',domain:'localhost',path:'/'});
  await signIn(page,base,'bob@example.test');
  const started=Date.now();
  await open(page,'light',desktop);
  console.log(`table with the marker in ${Date.now()-started}ms (SLOW never answers)`);
  await checkMarker(page,'computer light');
  if(shots)await page.screenshot({path:`${shots}/t458-desktop-light.png`});
  await checkTip(page,'computer light',false);
  if(shots)await page.screenshot({path:`${shots}/t458-desktop-tip.png`});
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('[data-nexus-tip]'),{timeout:3000});
  // The country's own tip still works, and opening one closes the other.
  await page.click('[data-gainers-row="AIMD"] [data-nexus] button');
  await page.waitForSelector('[data-nexus-tip]',{visible:true});
  await page.click('[data-gainers-row="AIMD"] [data-country-block] > span > button');
  await page.waitForSelector('[data-country-tip]',{visible:true,timeout:3000});
  assert.equal(await page.$eval('[data-country-tip]',t=>t.textContent),'United States');
  assert.equal(await page.$('[data-nexus-tip]'),null,'one tip at a time');
  await page.keyboard.press('Escape');
  // By keyboard: Tab to the marker, Enter shows the tip.
  await page.focus('[data-gainers-row="AIMD"] [data-nexus] button');await page.keyboard.press('Enter');
  await page.waitForSelector('[data-nexus-tip]',{visible:true,timeout:3000});
  await page.keyboard.press('Escape');
  // A click on the row itself still opens its press releases.
  await page.click('[data-gainers-row="AIMD"] [data-price]');
  await page.waitForSelector('[data-gainers-news="AIMD"]',{visible:true,timeout:15000});
  await page.click('[data-gainers-row="AIMD"] [data-price]');
  await page.waitForFunction(()=>!document.querySelector('[data-gainers-news]'),{timeout:5000});
  await open(page,'dark',desktop);
  await checkMarker(page,'computer dark');
  if(shots)await page.screenshot({path:`${shots}/t458-desktop-dark.png`});
  // #464: Paper Terminal's own deeper amber stays readable on the salmon paper.
  await open(page,'paper-terminal',desktop);
  await checkMarker(page,'computer paper-terminal');
  if(shots)await page.screenshot({path:`${shots}/t464-nexus-desktop-paper.png`});
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // A phone: light, then dark, then 360px.
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(phone);
  await context.setCookie({name:'longboard-chat-theme',value:'light',domain:'localhost',path:'/'});
  await signIn(page,base,'bob@example.test');
  await open(page,'light',phone);
  await checkMarker(page,'phone light');
  assert((await sideways(page))<=0,'phone: no sideways scroll');
  if(shots)await page.screenshot({path:`${shots}/t458-phone-light.png`});
  await checkTip(page,'phone light',true);
  if(shots)await page.screenshot({path:`${shots}/t458-phone-tip.png`});
  // A tap elsewhere hides it; tapping the row still opens its details.
  await page.tap('[data-gainers-about-toggle]');// #476: the heading words are behind this bar now.
  await page.waitForFunction(()=>!document.querySelector('[data-nexus-tip]'),{timeout:3000});
  await page.tap('[data-gainers-row="AIMD"] [data-price]');
  await page.waitForSelector('[data-gainers-details="AIMD"]',{visible:true,timeout:5000});
  await open(page,'dark',phone);
  await checkMarker(page,'phone dark');
  assert((await sideways(page))<=0,'phone dark: no sideways scroll');
  if(shots)await page.screenshot({path:`${shots}/t458-phone-dark.png`});
  await open(page,'light',{...phone,width:360});
  assert((await sideways(page))<=0,'360px: no sideways scroll');
  await checkTip(page,'phone 360',true);
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 console.log('chat-gainers-nexus browser: passed');
}finally{await browser.close();}
