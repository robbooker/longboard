// #378 the Terminal theme, against the fixture on this test's own ports (localhost:3388, database
// 127.0.0.1:54388). Synthetic members, messages and gainers alerts only; Polygon is the Gainers Table's
// fake (chat-gainers-table-preload.mjs).
//  - the chat settings menu lists Terminal with the other themes; picking it switches the chat at once,
//    is remembered on this device (storage and cookie) and comes back from the server after a reload;
//  - everything is in the monospace stack (Rob's JetBrainsMono Nerd Font first, then the JetBrains Mono
//    web font, which this build serves); section headings are spaced capitals; corners are 2-3px;
//  - key text passes WCAG AA contrast on the panel;
//  - the room, the Gainers Table and the FAQ render in it on a computer and on a phone with no sideways
//    page scroll;
//  - the Dark theme is untouched (still the system font);
//  - DMs keep a dark background in Terminal, like a room (#407);
//  - the theme is saved to the member's account, and another browser signing in as them gets it (#407).
// CHAT_SHOT_DIR saves t378-before-desktop.png (Dark), t378-picker.png, t378-desktop.png,
// t378-desktop-gainers.png and t378-phone.png.
import assert from 'node:assert/strict';
import path from 'node:path';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3388',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54388';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR;
const shot=(page,name)=>shots?page.screenshot({path:path.join(shots,name)}):null;
const control=async(p,body={})=>{const r=await fetch(fixture+'/test/'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const STACK=/^"JetBrainsMono Nerd Font", "JetBrainsMono NF", "JetBrains Mono"/;

// Three of today's gainers for the table (the fake snapshot knows AEHL, NEWT and FRSH).
let source=Date.now()%1e9; // unique message ids, so the test can run twice against one fixture
const ago=s=>new Date(Date.now()-s*1000).toISOString();
for(const [sym,secondsAgo,vol] of [['AEHL',600,300000],['NEWT',300,450000],['FRSH',120,2000000]])
  await sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source++,ago(secondsAgo),`🚨 ${sym} (+44.0%)\nPrice: $2.50\nVolume: ${vol.toLocaleString('en-US')}\nMarket Cap: 12.5M`]);

const visible=sel=>[...document.querySelectorAll(sel)].find(e=>e.checkVisibility());
const theme=page=>page.$eval('main[data-theme]',m=>m.dataset.theme);
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
// The family of each surface's text: the page, a message, the composer, a button, a sidebar heading.
const fonts=page=>page.evaluate(()=>{
  const at=sel=>{const e=[...document.querySelectorAll(sel)].find(x=>x.checkVisibility());return e?getComputedStyle(e).fontFamily:null;};
  return {page:at('main[data-theme]'),message:at('main[data-theme] article'),composer:at('textarea[aria-label^="Message "]'),button:at('header[data-dm] button'),heading:at('#chat-room-navigation [class*="navHeading"]')};
});
// WCAG contrast of a few text colours against the panel they sit on.
const contrast=page=>page.evaluate(()=>{
  const rgb=c=>c.match(/[\d.]+/g).slice(0,3).map(Number);
  const lum=c=>{const [r,g,b]=rgb(c).map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;};
  const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
  const panel=getComputedStyle(document.querySelector('main[data-theme]')).getPropertyValue('--chat-panel').trim();
  const probe=document.createElement('i');document.body.append(probe);
  const colour=v=>{probe.style.color=v;return getComputedStyle(probe).color;};
  const bg=colour(panel),out={};
  for(const name of ['--chat-text','--chat-muted','--chat-palm','--chat-error'])out[name]=ratio(colour(getComputedStyle(document.querySelector('main[data-theme]')).getPropertyValue(name).trim()),bg);
  probe.remove();return out;
});

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const desktop={width:1280,height:860,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const openPage=async(page,attr)=>{
  await page.waitForFunction(a=>{const e=[...document.querySelectorAll(`a[${a}]`)].find(x=>x.checkVisibility());return e&&Object.keys(e).some(k=>k.startsWith('__reactProps$'));},{timeout:60000},attr);
  await (await page.evaluateHandle(a=>[...document.querySelectorAll(`a[${a}]`)].find(x=>x.checkVisibility()),attr)).click();
};
try{
 // A computer, starting in Dark.
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(desktop);
  await context.setCookie({name:'longboard-chat-theme',value:'dark',domain:'localhost',path:'/'});
  await page.evaluateOnNewDocument(()=>{try{if(!localStorage.getItem('longboard-public-chat-theme-v1'))localStorage.setItem('longboard-public-chat-theme-v1','dark');}catch{}});
  await signIn(page,base,'alice@example.test');
  assert.equal(await theme(page),'dark');
  const dark=await fonts(page);
  assert.doesNotMatch(dark.composer,/JetBrains/,'Dark keeps its own font');
  await sleep(800);await shot(page,'t378-before-desktop.png');

  // The theme picker lists Terminal; picking it switches the chat at once.
  await page.waitForFunction(()=>{const b=document.querySelector('header[data-dm] button[aria-label^="Chat settings"]');return b&&Object.keys(b).some(k=>k.startsWith('__reactProps$'));},{timeout:60000});
  await page.click('header[data-dm] button[aria-label^="Chat settings"]');
  await page.waitForSelector('[role="group"][aria-label="Chat theme"] button',{visible:true});
  const options=await page.$$eval('[role="group"][aria-label="Chat theme"] button',bs=>bs.map(b=>b.textContent.replace(/✓/,'').trim()));
  assert.deepEqual(options,['Dark','Light','Blade Runner','Terminal'],'every member can pick Terminal');
  const savedToAccount=page.waitForResponse(r=>r.url().endsWith('/api/chat/theme')&&r.request().method()==='POST',{timeout:15000});
  await (await page.evaluateHandle(()=>[...document.querySelectorAll('[role="group"][aria-label="Chat theme"] button')].find(b=>b.textContent.includes('Terminal')))).click();
  // #407: the choice is saved to the account (shortly after, without holding up the screen).
  assert.equal((await savedToAccount).status(),200);
  assert.deepEqual((await sql("select p.theme from public.chat_activity_preferences p join public.profiles u on u.id=p.account_id where u.email='alice@example.test'")),[{theme:'terminal'}]);
  await page.waitForFunction(()=>document.querySelector('main[data-theme]').dataset.theme==='terminal');
  assert.equal(await page.$eval('[role="group"][aria-label="Chat theme"]',g=>[...g.querySelectorAll('button')].find(b=>b.textContent.includes('Terminal')).getAttribute('aria-pressed')),'true');
  await page.evaluate(()=>{const p=document.querySelector('[role="group"][aria-label="Chat theme"]').closest('[class*="headerMenuPanel"]');p?.scrollTo(0,p.scrollHeight);});
  await sleep(500);await shot(page,'t378-picker.png');
  assert.equal(await page.evaluate(()=>localStorage.getItem('longboard-public-chat-theme-v1')),'terminal');
  assert.ok((await context.cookies(`${base}/chat`)).some(c=>c.name==='longboard-chat-theme'&&c.value==='terminal'),'cookie for the first paint');
  await page.keyboard.press('Escape');
  if(await page.$('[role="group"][aria-label="Chat theme"]'))await page.click('header[data-dm] button[aria-label^="Chat settings"]');

  // Monospace everywhere, served as a web font when the Nerd Font isn't installed.
  const f=await fonts(page);
  for(const [where,family] of Object.entries(f))assert.match(family??'',STACK,`${where}: ${family}`);
  const faces=await page.evaluate(async()=>(await document.fonts.load('400 14px "JetBrains Mono"')).length);
  assert.ok(faces>0,'the JetBrains Mono web font loads');
  // Small spaced capitals for headings, square-ish corners on the panel and the composer.
  const look=await page.evaluate(()=>{const h=[...document.querySelectorAll('#chat-room-navigation [class*="navHeading"]')].find(e=>e.checkVisibility()),cs=h&&getComputedStyle(h);
   const r=s=>parseFloat(getComputedStyle(document.querySelector(s)).borderTopLeftRadius);
   return {transform:cs?.textTransform,spacing:parseFloat(cs?.letterSpacing),shell:r('main[data-theme] [class*="shell"]'),composer:r('textarea[aria-label^="Message "]')};});
  assert.equal(look.transform,'uppercase');assert.ok(look.spacing>0,'spaced');
  assert.ok(look.shell<=3&&look.composer<=3,`corners ${JSON.stringify(look)}`);
  const c=await contrast(page);
  for(const [name,ratio] of Object.entries(c))assert.ok(ratio>=4.5,`${name} ${ratio.toFixed(2)}:1 on the panel`);
  assert.ok((await overflow(page))<=0,'no sideways scroll');
  await sleep(600);await shot(page,'t378-desktop.png');
  // #407: DMs stay dark in Terminal, like the rooms (their message blocks take these colours).
  const dm=await page.evaluate(()=>{const m=getComputedStyle(document.querySelector('main[data-theme]')),probe=document.createElement('i');document.body.append(probe);
   const lum=v=>{probe.style.color=v;const [r,g,b]=getComputedStyle(probe).color.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;};
   const out={received:lum(m.getPropertyValue('--chat-dm-received-bg').trim()),text:lum(m.getPropertyValue('--chat-dm-received-text').trim())};probe.remove();return out;});
  assert.ok(dm.received<0.05&&dm.text>0.6,`Terminal DMs: dark blocks, light text ${JSON.stringify(dm)}`);

  // The Gainers Table in Terminal.
  await openPage(page,'data-chat-gainers-table');
  await page.waitForSelector('[data-gainers-row]',{visible:true,timeout:30000});
  assert.match(await page.$eval('[data-gainers-table] thead th',th=>getComputedStyle(th).fontFamily),STACK);
  assert.equal(await page.$eval('[data-gainers-table] thead th',th=>getComputedStyle(th).textTransform),'uppercase');
  assert.deepEqual(await page.$$eval('[data-gainers-row]',r=>r.map(x=>x.dataset.gainersRow)),['FRSH','NEWT','AEHL']);
  assert.ok((await overflow(page))<=0);
  await sleep(500);await shot(page,'t378-desktop-gainers.png');

  // The FAQ in Terminal.
  await openPage(page,'data-chat-faq');
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-faq-page] h2')].some(e=>e.checkVisibility()),{timeout:30000});
  assert.match(await page.evaluate(()=>getComputedStyle([...document.querySelectorAll('[data-faq-page] h2')].find(e=>e.checkVisibility())).fontFamily),STACK);
  assert.ok((await overflow(page))<=0);

  // Remembered: the server renders Terminal on the next visit.
  // The session's cookies with the theme cookie the chat just wrote (the test's own starting one aside).
  const jar=(await context.cookies(`${base}/chat`)).filter(k=>k.name!=='longboard-chat-theme');
  const html=await (await fetch(`${base}/chat?room=main`,{headers:{cookie:[...jar.map(k=>`${k.name}=${k.value}`),'longboard-chat-theme=terminal'].join('; ')}})).text();
  assert.ok(/<main[^>]*data-theme="terminal"/.test(html),'the server draws Terminal on the first paint');
  assert.deepEqual(errors,[]);
  await context.close();
 }
 // #407: another browser (its own copy says Light) signs in as the same member and gets Terminal from the account.
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(desktop);
  await context.setCookie({name:'longboard-chat-theme',value:'light',domain:'localhost',path:'/'});
  await page.evaluateOnNewDocument(()=>{try{if(!sessionStorage.getItem('t407'))localStorage.setItem('longboard-public-chat-theme-v1','light');sessionStorage.setItem('t407','1');}catch{}});
  await signIn(page,base,'alice@example.test',{next:'/chat?room=main'});
  await page.waitForFunction(()=>document.querySelector('main[data-theme]')?.dataset.theme==='terminal',{timeout:30000});
  await page.waitForFunction(()=>localStorage.getItem('longboard-public-chat-theme-v1')==='terminal');
  assert.ok((await context.cookies(`${base}/chat`)).some(c=>c.name==='longboard-chat-theme'&&c.value==='terminal'),'the device copy is refreshed for the next first paint');
  // Quad and Six follow the same account theme.
  await page.goto(`${base}/chat/quad`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{const e=[...document.querySelectorAll('body [data-theme]')];return e.length>1&&e.every(x=>x.dataset.theme==='terminal');},{timeout:90000});
  assert.deepEqual(errors,[]);
  await context.close();
 }
 // A phone, already in Terminal.
 {
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport(phone);
  await context.setCookie({name:'longboard-chat-theme',value:'terminal',domain:'localhost',path:'/'});
  await page.evaluateOnNewDocument(()=>{try{localStorage.setItem('longboard-public-chat-theme-v1','terminal');}catch{}});
  await signIn(page,base,'alice@example.test',{next:'/chat?room=main'});
  assert.equal(await theme(page),'terminal');
  await page.waitForFunction(()=>{const e=[...document.querySelectorAll('main[data-theme] article')].find(x=>x.checkVisibility());return !!e;},{timeout:30000});
  const f=await fonts(page);
  for(const where of ['page','message','composer'])assert.match(f[where]??'',STACK,`phone ${where}: ${f[where]}`);
  assert.ok((await overflow(page))<=0,'room: no sideways scroll on a phone');
  await sleep(600);await shot(page,'t378-phone.png');
  for(const id of ['gainers-table','faq']){
   await page.goto(`${base}/chat?page=${id}`,{waitUntil:'domcontentloaded'});
   await page.waitForSelector(id==='faq'?'[data-faq-page] h2':'[data-gainers-row]',{visible:true,timeout:60000});
   assert.equal(await theme(page),'terminal');
   assert.ok((await overflow(page))<=0,`${id}: no sideways scroll on a phone`);
  }
  assert.deepEqual(errors,[]);
  await context.close();
 }
 console.log('chat-terminal-theme: ok');
}finally{await browser.close();}
