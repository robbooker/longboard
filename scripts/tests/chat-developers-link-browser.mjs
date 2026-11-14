// #454 The sidebar's "My agents & API keys" link (to the developers page), on desktop 1280 and phone
// 390 (and 320), light and dark, against the
// shared fixture on this test's own ports (localhost:3454, database 127.0.0.1:54454). Synthetic
// data and neutral test names only.
//  - a member with developer access (a chat_api_access row; Bob) sees "My agents & API keys" in Pages,
//    with a key icon (not a room's colour mark), and it opens the developers page (/chat/developers);
//  - the name fits, or ends cleanly in "…", on a 320px phone and in a narrowed sidebar;
//  - a member without it (Mallory) sees Pages but no such link, on both widths;
//  - the link follows the database: Bob loses it on the next load once his access row is removed.
// CHAT_SHOT_DIR: also saves developers-link-{desktop,phone}-{light,dark}.png and
// developers-link-none-{desktop,phone}.png there.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3454',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54454';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR;
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const {people:[,bob,mallory]}=await control('identity');
const sql=(text,args=[])=>control('sql',{sql:text,args});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const LINK='a[data-chat-developers-link]',PAGES='[data-sidebar-group="pages"]',LABEL='My agents & API keys';
const visible=(p,sel,timeout=60000)=>p.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility()),{timeout},sel);
const shown=(p,sel)=>p.evaluate(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility()),sel);
async function look(p,theme){
 await p.setCookie({name:'longboard-chat-theme',value:theme,url:base+'/chat'});
 await p.evaluate(t=>{try{localStorage.setItem('longboard-public-chat-theme-v1',t);}catch{}},theme);
}
// The room list with its Pages section: the sidebar on a computer, the home screen on a phone.
async function openList(p,view){
 await p.goto(`${base}/chat${view==='phone'?'':'?room=social'}`);
 if(view==='phone'){
  await visible(p,'button[aria-label="Back to all chats"],'+PAGES);
  const back=await p.$('button[aria-label="Back to all chats"]');if(back&&await back.evaluate(e=>e.checkVisibility()))await back.click();
 }
 await visible(p,PAGES);await pause(600);
}
// The visible link: its name, icon, where it goes, and that it sits in the Pages section.
const linkInfo=p=>p.evaluate(({LINK,PAGES})=>{
 const a=[...document.querySelectorAll(LINK)].find(e=>e.checkVisibility());if(!a)return null;
 const heading=[...document.querySelectorAll(PAGES)].find(e=>e.checkVisibility());
 const after=!!heading&&!!(heading.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_FOLLOWING);
 const next=[...a.parentElement.querySelectorAll('[data-sidebar-group]')].find(h=>h!==heading&&heading&&(heading.compareDocumentPosition(h)&Node.DOCUMENT_POSITION_FOLLOWING));
 const beforeNext=!next||!!(a.compareDocumentPosition(next)&Node.DOCUMENT_POSITION_FOLLOWING);
 const r=a.getBoundingClientRect(),nav=a.closest('nav').getBoundingClientRect();
 const icon=a.querySelector(':scope > span[aria-hidden="true"] > svg'),box=icon?.parentElement.getBoundingClientRect(),label=a.querySelector(':scope > span > span');
 const lr=label.getBoundingClientRect(),ls=getComputedStyle(label);
 return {text:a.textContent.trim(),title:a.title,href:a.getAttribute('href'),inPages:after&&beforeNext,inView:r.width>0&&r.right<=innerWidth+1,
  key:!!icon&&box.width>0&&box.height>0,roomDot:!!a.querySelector('[data-initials]'),iconColor:icon&&getComputedStyle(icon).color,
  // The name stays on one line inside the row: whole, or cut with "…".
  oneLine:lr.height<30,truncated:label.scrollWidth>label.clientWidth+1,ellipsis:ls.textOverflow==='ellipsis',
  inRow:lr.right<=r.right+1,inNav:r.right<=nav.right+1,
  // Reads like its neighbour row ("Suggest a page"): same text size and colour, names lined up.
  sameAsNeighbour:(()=>{const n=[...document.querySelectorAll('a[data-chat-page="new"]')].find(e=>e.checkVisibility())?.querySelector(':scope > span:last-child');if(!n)return 'no neighbour';
   const ns=getComputedStyle(n),nr=n.getBoundingClientRect();
   return ns.fontSize===ls.fontSize&&ns.color===ls.color&&Math.abs(nr.left-lr.left)<=1?true:{neighbour:[ns.fontSize,ns.color,nr.left],link:[ls.fontSize,ls.color,lr.left]};})()};
},{LINK,PAGES});
// The name: whole, or cut cleanly with an ellipsis, always inside its row and the list.
function fitsCleanly(info,where){
 assert(info.inRow&&info.inNav&&info.oneLine,`${where}: the name stays on one line inside the list (${JSON.stringify(info)})`);
 if(info.truncated)assert(info.ellipsis,`${where}: a cut name ends in an ellipsis`);
}
// For the pictures: the Pages section in view, no menu left open, no dev-server badge.
async function frame(p,sel){
 await p.keyboard.press('Escape');
 await p.evaluate(sel=>{document.activeElement?.blur?.();document.querySelectorAll('nextjs-portal').forEach(e=>e.style.display='none');
  [...document.querySelectorAll(sel)].find(e=>e.checkVisibility())?.scrollIntoView({block:'center'});},sel);
 await pause(300);
}
const member=async(who)=>{const p=await (await browser.createBrowserContext()).newPage();p.on('pageerror',e=>errors.push(`${who.email}: ${e.message}`));p.setDefaultTimeout(60000);await p.setViewport(desktop);
 await signIn(p,base,who.email,{next:'/chat?room=social',composer:'textarea[aria-label="Message Social"]'});return p;};

try{
 console.log('Browser',await browser.version());
 // Bob has developer access; Mallory doesn't. Neutral names for the pictures.
 await sql('insert into chat_api_access(account_id) values($1) on conflict do nothing',[bob.id]);
 await sql('delete from chat_api_access where account_id=$1',[mallory.id]);
 await sql('update longboard_chat_members set display_name=$2 where id=$1',[bob.member.id,'Sample Developer']);
 await sql('update longboard_chat_members set display_name=$2 where id=$1',[mallory.member.id,'Sample Member']);

 // 1. With access: the link is in Pages, named Developers, and opens the developers page.
 const dev=await member(bob);
 for(const [view,size] of [['desktop',desktop],['phone',phone]]){
  for(const theme of ['light','dark']){
   await dev.setViewport(size);await look(dev,theme);await openList(dev,view);
   await visible(dev,LINK,15000);
   const info=await linkInfo(dev);
   assert.equal(info?.text,LABEL,`${view} ${theme}: named ${LABEL} (${JSON.stringify(info)})`);
   assert.equal(info.title,LABEL,`${view} ${theme}: the full name on hover`);
   assert(info.key,`${view} ${theme}: a key icon`);
   assert.equal(info.roomDot,false,`${view} ${theme}: no room colour mark`);
   assert.equal(info.truncated,false,`${view} ${theme}: the whole name shows at this width`);
   assert.equal(info.sameAsNeighbour,true,`${view} ${theme}: looks like the other Pages rows: ${JSON.stringify(info.sameAsNeighbour)}`);
   fitsCleanly(info,`${view} ${theme}`);
   assert.equal(info.href,'/chat/developers',`${view} ${theme}: goes to the developers page`);
   assert(info.inPages,`${view} ${theme}: listed in the Pages section`);
   assert(info.inView,`${view} ${theme}: fits on screen`);
   assert.equal(await dev.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${view} ${theme}: no sideways scroll`);
   if(shots){await frame(dev,LINK);await dev.screenshot({path:`${shots}/developers-link-${view}-${theme}.png`});}
  }
  // It opens the page (the page's own access check agrees: the token form is there).
  await look(dev,'light');await openList(dev,view);
  await Promise.all([dev.waitForNavigation({waitUntil:'domcontentloaded'}),dev.evaluate(sel=>[...document.querySelectorAll(sel)].find(e=>e.checkVisibility()).click(),LINK)]);
  assert.equal(new URL(dev.url()).pathname,'/chat/developers',`${view}: opened the developers page`);
  await dev.waitForFunction(()=>document.body.innerText.includes('Chat for developers'));
  await dev.waitForFunction(()=>document.body.innerText.includes('Create token'),{timeout:30000});
  assert(!(await dev.evaluate(()=>document.body.innerText)).includes('invite-only'),`${view}: has access on the page too`);
 }

 // 1b. Narrow: a 320px phone, and a computer sidebar squeezed to 150px: the name fits or ends in "…".
 await dev.setViewport({...phone,width:320});await look(dev,'light');await openList(dev,'phone');await visible(dev,LINK,15000);
 fitsCleanly(await linkInfo(dev),'phone 320');
 assert.equal(await dev.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'phone 320: no sideways scroll');
 await dev.setViewport(desktop);await openList(dev,'desktop');await visible(dev,LINK,15000);
 await dev.evaluate(()=>{const nav=document.querySelector('#chat-room-navigation');nav.style.width=nav.style.maxWidth=nav.style.minWidth='150px';nav.style.flex='0 0 150px';});await pause(300);
 const narrow=await linkInfo(dev);
 assert.equal(narrow.truncated,true,`narrow sidebar: the name is cut (${JSON.stringify(narrow)})`);
 fitsCleanly(narrow,'narrow sidebar');

 // 2. Without access: Pages shows, the link doesn't.
 const plain=await member(mallory);
 for(const [view,size] of [['desktop',desktop],['phone',phone]]){
  await plain.setViewport(size);await look(plain,'light');await openList(plain,view);
  await pause(800);
  assert.equal(await shown(plain,LINK),false,`${view}: no Developers link without access`);
  assert.equal(await plain.$(LINK),null,`${view}: not in the page at all`);
  if(shots){await frame(plain,'[data-chat-page="new"]');await plain.screenshot({path:`${shots}/developers-link-none-${view}.png`});}
 }

 // 3. Access removed: the next load has no link.
 await sql('delete from chat_api_access where account_id=$1',[bob.id]);
 await dev.setViewport(desktop);await openList(dev,'desktop');await pause(800);
 assert.equal(await dev.$(LINK),null,'link gone once access is removed');

 assert.deepEqual(errors,[]);
 console.log('PASS "My agents & API keys" link desktop 1280 + phone 390, light and dark: in Pages with a key icon for a member with developer access and opens /chat/developers; fits or ends in an ellipsis at 320px and in a narrow sidebar; hidden without access; follows the access row on the next load.');
}finally{await browser.close();}
