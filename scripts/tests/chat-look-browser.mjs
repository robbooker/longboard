// #420 themes and colour combinations in Profile settings, against the fixture on this test's own
// ports (localhost:3420, database 127.0.0.1:54620; chat-look-fixture.mjs). Synthetic members only.
//  - the chat settings menu no longer lists the themes; "Themes and colours" opens Profile settings at
//    its Look section: the four themes, then the colour combinations;
//  - picking a combination recolours the room and the open dialog at once, keeps the standard look
//    underneath (the base theme), and is saved on this device (storage and cookies) and on the account;
//  - a reload draws the combination on the first paint (the server's HTML already carries it), also
//    a reload straight after the pick;
//  - another browser signing in as the same member gets it from the account; Quad and Six follow;
//  - picking one of the four themes (Blade Runner) clears the combination everywhere;
//  - a combination the app no longer knows falls back to the plain theme;
//  - before the database change is applied (the app can go live first) nothing breaks: no combination
//    is kept on the account until it is;
//  - with no connection the swatches cannot be fetched: the dialog says so, the chat carries on, and
//    they load the next time it opens;
//  - on a 320px phone the Look section fits with no sideways scroll, the swatches are real buttons
//    (aria-pressed), reachable and usable from the keyboard with a visible focus ring.
// CHAT_SHOT_DIR saves t420-look-desktop.png, t420-ocean-desktop.png, t420-quad-plum.png and t420-look-phone.png.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3420',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54620';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR;
const shot=async(page,name)=>{if(shots){await sleep(500);await page.screenshot({path:path.join(shots,name)});}};
const control=async(p,body={})=>{const r=await fetch(fixture+'/test/'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ACCOUNT="(select id from public.profiles where email='alice@example.test')";
const account=()=>sql(`select theme,palette from public.chat_activity_preferences where account_id=${ACCOUNT}`);
const THEME_KEY='longboard-public-chat-theme-v1',PALETTE_KEY='longboard-chat-palette-v1';

// The colours that ship, read from the one file that defines them.
const css=await readFile(new URL('../../components/chat/chatPalettes.css',import.meta.url),'utf8');
const shipped=id=>Object.fromEntries([...css.match(new RegExp(`\\[data-palette="${id}"\\][^{]*\\{([^}]*)\\}`))[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
const rgb=hex=>`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`;
const names=[...css.matchAll(/^\[data-palette="([a-z0-9-]+)"\]/gm)].map(m=>m[1]);
assert.ok(names.length>=10,`about ten combinations ship (${names})`);

// Every themed surface on the page (the swatches in the Look section are previews, not surfaces).
const surfaces=page=>page.evaluate(()=>[...document.querySelectorAll('body [data-theme]')].filter(e=>!e.closest('[data-look]')).map(e=>`${e.dataset.theme}|${e.dataset.palette??''}`));
const allAre=(page,want,timeout=30000)=>page.waitForFunction(want=>{const e=[...document.querySelectorAll('body [data-theme]')].filter(x=>!x.closest('[data-look]'));return e.length>0&&e.every(x=>`${x.dataset.theme}|${x.dataset.palette??''}`===want);},{timeout},want);
const mainLook=page=>page.$eval('main[data-theme]',m=>({theme:m.dataset.theme,palette:m.dataset.palette??null,bg:getComputedStyle(m).getPropertyValue('--chat-bg').trim(),text:getComputedStyle(m).color}));
const pressed=page=>page.$$eval('dialog[open] [data-look][aria-pressed="true"]',b=>b.map(x=>x.dataset.look));
// (The picture above the swatches arrives on its own and moves them: wait for it before aiming a click.)
const pick=async(page,look)=>{await page.waitForSelector(`dialog[open] button[data-look="${look}"]`,{visible:true,timeout:60000});await page.waitForFunction(()=>!/Loading your picture/.test(document.querySelector('dialog[open]').textContent),{timeout:60000});await page.click(`dialog[open] button[data-look="${look}"]`);};
const savedToAccount=page=>page.waitForResponse(r=>r.url().endsWith('/api/chat/theme')&&r.request().method()==='POST',{timeout:20000});
const clickText=async(page,text)=>{
  await page.waitForFunction(t=>[...document.querySelectorAll('button,a')].some(e=>e.checkVisibility()&&e.textContent.trim()===t),{timeout:30000},text);
  await page.evaluate(t=>[...document.querySelectorAll('button,a')].find(e=>e.checkVisibility()&&e.textContent.trim()===t).click(),text);
};
const openMenu=async page=>{
  const visible=()=>{const b=[...document.querySelectorAll('button[aria-label^="Chat settings"]')].find(x=>{const r=x.getBoundingClientRect();return x.checkVisibility()&&r.width&&r.left>=0&&r.right<=innerWidth;});return b&&Object.keys(b).some(k=>k.startsWith('__reactProps$'))?b:null;};
  await page.waitForFunction(visible,{timeout:60000});
  await (await page.evaluateHandle(visible)).click();
};
// What the page has shown since its first paint: "theme|combination" each time it changed.
const record=page=>page.evaluateOnNewDocument(()=>{window.__looks=[];const note=()=>{const m=document.querySelector('main[data-theme]');if(m){const v=`${m.dataset.theme}|${m.dataset.palette??''}`;if(window.__looks.at(-1)!==v)window.__looks.push(v);}requestAnimationFrame(note);};note();});
const device=async(context,page,theme,palette)=>{
  await context.setCookie({name:'longboard-chat-theme',value:theme,domain:'localhost',path:'/'});
  // Only on this browser's first page, so what the chat saves later is what a reload reads.
  await page.evaluateOnNewDocument((k,p,theme,palette)=>{try{if(!sessionStorage.getItem('t420')){localStorage.setItem(k,theme);if(palette)localStorage.setItem(p,palette);}sessionStorage.setItem('t420','1');}catch{}},THEME_KEY,PALETTE_KEY,theme,palette);
};
const cookie=async(context,name)=>(await context.cookies(`${base}/chat`)).find(c=>c.name===name)?.value??null;

await sql(`update public.chat_activity_preferences set theme=null,palette=null where account_id=${ACCOUNT}`);
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:320,height:700,isMobile:true,hasTouch:true};
try{
 const ocean=shipped('ocean'),paper=shipped('paper'),plum=shipped('plum');
 // A computer, starting in plain Dark.
 const first=await browser.createBrowserContext(),page=await first.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport(desktop);
 await device(first,page,'dark',null);await record(page);
 await signIn(page,base,'alice@example.test',{next:'/chat?room=main'});
 assert.deepEqual(await mainLook(page).then(l=>[l.theme,l.palette]),['dark',null]);
 const plainDark=(await mainLook(page)).bg;

 // The menu no longer lists the themes; one line leads to them.
 await openMenu(page);
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.checkVisibility()&&b.textContent.trim()==='Themes and colours'),{timeout:30000});
 assert.equal(await page.$('[class*="headerMenuPanel"] [role="group"][aria-label="Chat theme"]'),null,'the menu has no theme list');
 assert.ok(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.checkVisibility()&&b.textContent.trim()==='Profile settings')),'Profile settings stays in the menu');
 await clickText(page,'Themes and colours');
 await page.waitForSelector('dialog[open] [role="group"][aria-label="Colour combination"] button',{visible:true,timeout:60000});
 assert.deepEqual(await page.$$eval('dialog[open] [role="group"][aria-label="Chat theme"] button',b=>b.map(x=>x.textContent.trim())),['Dark','Light','Blade Runner','Terminal']);
 assert.deepEqual(await page.$$eval('dialog[open] [role="group"][aria-label="Colour combination"] button',b=>b.map(x=>x.dataset.look)),names,'one swatch per combination that ships');
 assert.ok(await page.$$eval('dialog[open] [data-look]',b=>b.every(x=>x.tagName==='BUTTON'&&x.hasAttribute('aria-pressed')&&x.textContent.trim().length>0)),'swatches are named buttons');
 assert.deepEqual(await pressed(page),['dark']);
 // Opened from "Themes and colours", the dialog starts at the Look section.
 const at=await page.$eval('dialog[open] [data-chat-look]',e=>{const r=e.getBoundingClientRect(),d=e.closest('dialog').getBoundingClientRect();return {top:r.top,dialogTop:d.top,dialogBottom:d.bottom};});
 assert.ok(at.top>=at.dialogTop-1&&at.top<at.dialogBottom,`the Look section is in view ${JSON.stringify(at)}`);
 // Each swatch is drawn in its own colours, whatever is on screen.
 const swatch=await page.$eval('dialog[open] button[data-look="paper"] [data-theme]',e=>({theme:e.dataset.theme,palette:e.dataset.palette,bg:getComputedStyle(e).backgroundColor}));
 assert.deepEqual(swatch,{theme:'light',palette:'paper',bg:rgb(paper['--chat-bg'])});
 await shot(page,'t420-look-desktop.png');

 // Picking a combination: the room and the open dialog change at once, on the standard (Dark) look.
 let posted=savedToAccount(page);
 await pick(page,'ocean');
 await page.waitForFunction(()=>document.querySelector('main[data-theme]').dataset.palette==='ocean',{timeout:3000});
 let now=await mainLook(page);
 assert.deepEqual([now.theme,now.palette,now.bg,now.text],['dark','ocean',ocean['--chat-bg'],rgb(ocean['--chat-text'])]);
 assert.notEqual(now.bg,plainDark,'not the plain Dark colours');
 assert.deepEqual(await page.$eval('dialog[open]',d=>[getComputedStyle(d).backgroundColor,getComputedStyle(d).color]),[rgb(ocean['--chat-panel']),rgb(ocean['--chat-text'])],'the dialog follows');
 assert.deepEqual(await pressed(page),['ocean'],'the theme above is no longer the pressed one');
 assert.deepEqual(await page.evaluate((k,p)=>[localStorage.getItem(k),localStorage.getItem(p)],THEME_KEY,PALETTE_KEY),['dark','ocean']);
 assert.deepEqual([await cookie(first,'longboard-chat-theme'),await cookie(first,'longboard-chat-palette')],['dark','ocean'],'cookies for the first paint');
 assert.equal((await posted).status(),200);
 assert.deepEqual(await account(),[{theme:'dark',palette:'ocean'}],'saved on the account, on top of its base theme');
 // Fonts, sizes and shapes are the standard look's: only colours changed.
 const shape=()=>page.evaluate(()=>{const m=document.querySelector('main[data-theme]'),t=[...document.querySelectorAll('textarea[aria-label^="Message "]')].find(e=>e.checkVisibility()),c=getComputedStyle(t);return [getComputedStyle(m).fontFamily,c.fontFamily,c.fontSize,c.borderTopLeftRadius,c.paddingTop,t.getBoundingClientRect().height];});
 const oceanShape=await shape();
 await page.keyboard.press('Escape');await page.waitForSelector('dialog[open]',{hidden:true});
 await shot(page,'t420-ocean-desktop.png');

 // A reload: the server's HTML already carries it, and nothing else is ever shown.
 const jar=(await first.cookies(`${base}/chat`)).map(k=>`${k.name}=${k.value}`).join('; ');
 const html=await (await fetch(`${base}/chat?room=main`,{headers:{cookie:jar}})).text(),tag=html.match(/<main[^>]*data-theme="[^"]*"[^>]*>/)?.[0]??'';
 assert.ok(/data-theme="dark"/.test(tag)&&/data-palette="ocean"/.test(tag),`the server draws Ocean on the first paint: ${tag.slice(0,200)}`);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const t=[...document.querySelectorAll('textarea[aria-label^="Message "]')].find(e=>e.checkVisibility());return t&&Object.keys(t).some(k=>k.startsWith('__reactProps$'));},{timeout:90000});
 await sleep(1500); // the account's copy has been read by now
 assert.deepEqual(await page.evaluate(()=>window.__looks),['dark|ocean'],'no flash of other colours');
 assert.equal((await mainLook(page)).bg,ocean['--chat-bg']);

 // A pick followed at once by a reload is not lost: the save that was still waiting goes out as the page leaves.
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('chat-open-profile-settings',{detail:'look'})));
 await pick(page,'slate');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const t=[...document.querySelectorAll('textarea[aria-label^="Message "]')].find(e=>e.checkVisibility());return t&&Object.keys(t).some(k=>k.startsWith('__reactProps$'));},{timeout:90000});
 await sleep(1500);
 assert.deepEqual(await account(),[{theme:'dark',palette:'slate'}],'saved on the account although the page left at once');
 assert.deepEqual(await page.evaluate(()=>window.__looks),['dark|slate'],'the reload shows the pick, and nothing else');

 // A light-based combination switches the base theme with it.
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('chat-open-profile-settings',{detail:'look'})));
 posted=savedToAccount(page);
 await pick(page,'paper');
 await page.waitForFunction(()=>document.querySelector('main[data-theme]').dataset.palette==='paper',{timeout:3000});
 now=await mainLook(page);
 assert.deepEqual([now.theme,now.palette,now.bg,now.text],['light','paper',paper['--chat-bg'],rgb(paper['--chat-text'])]);
 assert.deepEqual(await pressed(page),['paper']);
 assert.deepEqual(await shape(),oceanShape,'same fonts, sizes and shapes as before');
 assert.equal((await posted).status(),200);
 assert.deepEqual(await account(),[{theme:'light',palette:'paper'}]);
 await page.keyboard.press('Escape');

 // Another browser (its own copy says plain Dark) signs in as the same member and gets Paper from the account.
 const second=await browser.createBrowserContext(),other=await second.newPage(),otherErrors=[];
 other.on('pageerror',e=>otherErrors.push(e.message));
 await other.setViewport({width:1920,height:1080});
 await device(second,other,'dark',null);
 await signIn(other,base,'alice@example.test',{next:'/chat?room=main'});
 await other.waitForFunction(()=>{const m=document.querySelector('main[data-theme]');return m.dataset.theme==='light'&&m.dataset.palette==='paper';},{timeout:30000});
 await other.waitForFunction((k,p)=>localStorage.getItem(k)==='light'&&localStorage.getItem(p)==='paper',{},THEME_KEY,PALETTE_KEY);
 assert.deepEqual([await cookie(second,'longboard-chat-theme'),await cookie(second,'longboard-chat-palette')],['light','paper'],'this device is ready for its next first paint');
 // Quad and Six follow: every pane, card and heading.
 for(const view of ['six','quad']){
  await other.goto(`${base}/chat/${view}`,{waitUntil:'domcontentloaded'});
  await other.waitForFunction(()=>document.querySelectorAll('body [data-theme]').length>1,{timeout:90000});
  await allAre(other,'light|paper',90000);
  assert.equal(await other.$eval('body [data-theme]',e=>getComputedStyle(e).getPropertyValue('--chat-bg').trim()),paper['--chat-bg'],view);
 }
 // In Quad the toolbar's Profile settings has the same Look section; a change repaints every pane at once.
 await clickText(other,'Profile settings');
 await pick(other,'plum');
 await allAre(other,'dark|plum',3000);
 assert.ok((await surfaces(other)).length>1,'Quad has several themed surfaces');
 assert.equal(await other.$eval('body [data-theme]',e=>getComputedStyle(e).getPropertyValue('--chat-bg').trim()),plum['--chat-bg']);
 await shot(other,'t420-quad-plum.png');
 // One of the four themes clears the combination: on screen, on this device and on the account.
 posted=savedToAccount(other);
 await pick(other,'blade-runner');
 await allAre(other,'blade-runner|',3000);
 assert.deepEqual(await pressed(other),['blade-runner']);
 assert.equal(await other.$('body [data-palette]:not([data-look] *)'),null,'no surface keeps a combination');
 assert.deepEqual(await other.evaluate((k,p)=>[localStorage.getItem(k),localStorage.getItem(p)],THEME_KEY,PALETTE_KEY),['blade-runner',null]);
 assert.deepEqual([await cookie(second,'longboard-chat-theme'),await cookie(second,'longboard-chat-palette')],['blade-runner',null]);
 assert.equal((await posted).status(),200);
 assert.deepEqual(await account(),[{theme:'blade-runner',palette:null}]);
 await other.keyboard.press('Escape');
 // The first browser (still holding Paper) follows the account on its next load.
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const m=document.querySelector('main[data-theme]');return m?.dataset.theme==='blade-runner'&&!m.hasAttribute('data-palette');},{timeout:60000});
 await page.waitForFunction(p=>localStorage.getItem(p)===null,{},PALETTE_KEY);
 assert.deepEqual(otherErrors,[]);
 await second.close();

 // A combination the app does not know (removed later, say) falls back to the plain theme.
 await sql(`update public.chat_activity_preferences set theme='dark',palette='retired-one' where account_id=${ACCOUNT}`);
 const third=await browser.createBrowserContext(),old=await third.newPage();
 old.on('pageerror',e=>errors.push(e.message));
 await old.setViewport(desktop);
 await device(third,old,'dark','retired-one');
 await third.setCookie({name:'longboard-chat-palette',value:'retired-one',domain:'localhost',path:'/'});
 await record(old);
 await signIn(old,base,'alice@example.test',{next:'/chat?room=main'});
 await sleep(1500);
 assert.deepEqual(await old.evaluate(()=>window.__looks),['dark|'],'plain Dark throughout');
 assert.equal((await mainLook(old)).bg,plainDark);
 assert.deepEqual(await old.evaluate(async()=>(await fetch('/api/chat/theme',{cache:'no-store'})).json()),{theme:'dark',palette:null});
 // One left under a theme it does not belong to is ignored too.
 await sql(`update public.chat_activity_preferences set theme='terminal',palette='ocean' where account_id=${ACCOUNT}`);
 await old.reload({waitUntil:'domcontentloaded'});
 await old.waitForFunction(()=>{const m=document.querySelector('main[data-theme]');return m?.dataset.theme==='terminal'&&!m.hasAttribute('data-palette');},{timeout:60000});
 await third.close();

 // The app can go live a few minutes before the database change: until then there is simply no
 // combination on the account (the theme is still saved), and nothing breaks.
 await control('exec',{sql:'alter table public.chat_activity_preferences drop column palette'});
 await sql(`update public.chat_activity_preferences set theme='dark' where account_id=${ACCOUNT}`);
 const early=await browser.createBrowserContext(),ahead=await early.newPage();
 ahead.on('pageerror',e=>errors.push(e.message));
 await ahead.setViewport(desktop);
 await device(early,ahead,'light',null);
 await signIn(ahead,base,'alice@example.test',{next:'/chat?room=main'});
 await ahead.waitForFunction(()=>document.querySelector('main[data-theme]')?.dataset.theme==='dark',{timeout:30000});
 assert.deepEqual(await ahead.evaluate(async()=>{const r=await fetch('/api/chat/theme',{cache:'no-store'});return [r.status,await r.json()];}),[200,{theme:'dark',palette:null}]);
 await ahead.evaluate(()=>window.dispatchEvent(new CustomEvent('chat-open-profile-settings',{detail:'look'})));
 posted=savedToAccount(ahead);
 await pick(ahead,'rose');
 await ahead.waitForFunction(()=>document.querySelector('main[data-theme]').dataset.palette==='rose',{timeout:3000});
 assert.equal((await posted).status(),200,'the theme under it is still saved');
 assert.deepEqual(await sql(`select theme from public.chat_activity_preferences where account_id=${ACCOUNT}`),[{theme:'light'}]);
 await ahead.keyboard.press('Escape');
 // Once the change is applied, combinations are kept on the account.
 // (The fixture skips a migration text it has already run, hence the extra line.)
 await control('exec',{sql:await readFile(new URL('../../supabase/migrations/20261110220000_chat_theme_palette.sql',import.meta.url),'utf8')+'\n-- applied again by chat-look-browser.mjs\n'});
 assert.deepEqual(await account(),[{theme:'light',palette:null}]);
 await ahead.evaluate(()=>window.dispatchEvent(new CustomEvent('chat-open-profile-settings',{detail:'look'})));
 posted=savedToAccount(ahead);
 await pick(ahead,'lavender');
 assert.equal((await posted).status(),200);
 assert.deepEqual(await account(),[{theme:'light',palette:'lavender'}]);
 await early.close();

 // With no connection the swatches cannot be fetched: Profile settings says so and the chat carries
 // on; they load the next time it opens.
 await sql(`update public.chat_activity_preferences set theme='light',palette=null where account_id=${ACCOUNT}`);
 const fourth=await browser.createBrowserContext(),away=await fourth.newPage();
 await away.setViewport(desktop);
 await signIn(away,base,'alice@example.test',{next:'/chat?room=main'});
 await away.waitForFunction(()=>{const t=[...document.querySelectorAll('textarea')].find(e=>e.checkVisibility());return t&&Object.keys(t).some(k=>k.startsWith('__reactProps$'));},{timeout:90000});
 await away.setOfflineMode(true);
 await away.evaluate(()=>window.dispatchEvent(new CustomEvent('chat-open-profile-settings',{detail:'look'})));
 await away.waitForFunction(()=>/could not be loaded/.test(document.querySelector('dialog[open] [data-chat-look] [role="status"]')?.textContent??''),{timeout:30000});
 assert.ok(await away.evaluate(()=>!!document.querySelector('main[data-theme] textarea')&&!/Application error/.test(document.body.textContent)),'the chat is still there');
 await away.keyboard.press('Escape');await away.waitForSelector('dialog[open]',{hidden:true});
 await away.setOfflineMode(false);
 await away.evaluate(()=>window.dispatchEvent(new CustomEvent('chat-open-profile-settings',{detail:'look'})));
 await away.waitForSelector('dialog[open] button[data-look="ocean"]',{visible:true,timeout:60000});
 await fourth.close();

 // A 320px phone: the Look section fits, and the keyboard reaches and works every swatch.
 // (Its own tab, a phone from its first page: touch only works on a page that started as one.)
 const desk=page;
 {const page=await first.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport(phone);
 await page.goto(`${base}/chat?room=main`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('main[data-theme]')?.dataset.theme==='light',{timeout:60000});
 // On a phone the ••• menu is on the list of chats.
 await page.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Back to all chats"]');return b?.checkVisibility()&&Object.keys(b).some(k=>k.startsWith('__reactProps$'));},{timeout:60000});
 await page.tap('button[aria-label="Back to all chats"]');
 await page.waitForFunction(()=>!document.querySelector('nav[aria-label="Chat rooms"]')?.inert,{timeout:30000});await sleep(900);
 await page.tap('#chat-room-navigation button[aria-label="Chat settings"]');
 await clickText(page,'Themes and colours');
 await page.waitForSelector('dialog[open] [role="group"][aria-label="Colour combination"] button',{visible:true,timeout:60000});
 // "Themes and colours" lands on the Look section (the last one), not the top of the dialog.
 await page.waitForFunction(()=>{const d=document.querySelector('dialog[open]').getBoundingClientRect(),h=document.querySelector('dialog[open] [data-chat-look] h3').getBoundingClientRect(),g=document.querySelector('dialog[open] [aria-label="Chat theme"]').getBoundingClientRect();return h.top>=d.top&&g.bottom<=d.bottom&&g.bottom<=innerHeight;},{timeout:5000});
 const fit=await page.evaluate(()=>{const d=document.querySelector('dialog[open]'),box=d.getBoundingClientRect();
  const buttons=[...d.querySelectorAll('[data-look]')].map(b=>b.getBoundingClientRect());
  return {page:document.documentElement.scrollWidth-innerWidth,dialog:d.scrollWidth-d.clientWidth,left:box.left,right:box.right,
   inside:buttons.every(r=>r.left>=box.left&&r.right<=box.right),small:buttons.filter(r=>r.width<44||r.height<44).length,
   columns:new Set([...d.querySelectorAll('[aria-label="Colour combination"] [data-look]')].map(b=>Math.round(b.getBoundingClientRect().left))).size};});
 assert.ok(fit.page<=0&&fit.dialog<=0&&fit.left>=0&&fit.right<=320&&fit.inside,`fits a 320px phone ${JSON.stringify(fit)}`);
 assert.equal(fit.small,0,'every swatch is big enough to tap');
 assert.ok(fit.columns>=2,`a grid, not a list (${fit.columns} across)`);
 await shot(page,'t420-look-phone.png');
 await page.focus('dialog[open] button[data-look="light"]');
 await page.keyboard.press('Tab');await page.keyboard.press('Tab');
 const focus=await page.evaluate(()=>{const e=document.activeElement,c=getComputedStyle(e);return {look:e.dataset.look,visible:e.matches(':focus-visible'),style:c.outlineStyle,width:parseFloat(c.outlineWidth)};});
 assert.deepEqual([focus.look,focus.visible,focus.style],['terminal',true,'solid'],JSON.stringify(focus));
 assert.ok(focus.width>=2,'a visible focus ring');
 for(let i=0;i<names.indexOf('sky')+1;i++)await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.look),'sky');
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('main[data-theme]').dataset.palette==='sky',{timeout:3000});
 assert.deepEqual(await pressed(page),['sky']);
 assert.equal((await mainLook(page)).bg,shipped('sky')['--chat-bg']);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no sideways scroll after the change');
 await page.keyboard.press('Escape');await page.waitForSelector('dialog[open]',{hidden:true});}
 // The computer's tab, still open, follows the phone's choice (one browser, one saved look).
 // Back to that tab first: a tab in the background draws no frames, so the wait would never look again.
 await desk.bringToFront();
 await desk.waitForFunction(()=>document.querySelector('main[data-theme]').dataset.palette==='sky',{timeout:15000});
 assert.deepEqual(errors,[]);
 console.log('chat-look: ok');
}finally{await browser.close();}
