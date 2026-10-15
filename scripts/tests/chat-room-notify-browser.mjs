// ROOM-NOTIFY: per-room All messages / Mentions only / Muted, in the desktop ••• menu and the phone
// room info sheet; the sidebar badge, muted mark and bell follow it. Run against
// chat-room-notify-fixture.mjs (127.0.0.1:54596) with a dev server on localhost:3396.
// ROOM_NOTIFY_PREMIGRATION=1 (fixture and test): before the migration the setting is hidden, no errors.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3396',fixture='http://127.0.0.1:54596/rest/v1/';
const pre=process.env.ROOM_NOTIFY_PREMIGRATION==='1';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
async function rest(path,body){const r=await fetch(fixture+path,{method:body?'POST':'GET',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json',prefer:'return=representation'},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|favicon|WebSocket|realtime/i.test(m.text()))errors.push(m.text());});
 await page.setViewport({width:1440,height:1000});
 await page.goto(`${base}/login?next=%2Fchat`);await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});
 await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');
 await page.waitForSelector('textarea[aria-label="Message LB"]');
 const [bob]=await rest('longboard_chat_members?select=id&display_name=eq.Bob');
 const say=(room,body)=>rest('longboard_chat_messages',{room_slug:room,member_id:bob.id,guest_id:null,author_label:'Bob',body});
 const activity=()=>page.evaluate(async()=>(await fetch('/api/chat/activity?why=test')).json());
 const menu='button[aria-label="Chat settings"]',group='#chat-settings-panel [role="group"][aria-label="Room notifications"]';
 const openMenu=async()=>{await page.waitForFunction(m=>{if(document.querySelector('#chat-settings-panel'))return true;document.querySelector(m)?.click();return false;},{polling:300,timeout:15000},menu);};
 const pressed=g=>page.$$eval(`${g} button[aria-pressed="true"]`,b=>b.map(e=>e.textContent.replace('✓','').trim()));
 const choose=(g,label)=>page.evaluate((g,label)=>[...document.querySelectorAll(`${g} button`)].find(b=>b.textContent.includes(label)).click(),g,label);
 const socialLink='nav[aria-label="Chat rooms"] a[href="/chat?room=social"]';

 if(pre){
  await openMenu();await page.waitForSelector('#chat-settings-panel');
  assert.equal(await page.$(group),null,'no room notification setting before the migration');
  assert.equal((await activity()).roomLevels,undefined);
  await say('social','Before migration unread');await page.waitForSelector(`${socialLink} [aria-label="1 unread messages"]`);
  assert.equal(await page.$('[data-muted]'),null);
  const r=await page.evaluate(async()=>(await fetch('/api/chat/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'roomLevel',room:'main',level:'muted'})})).status);
  assert.equal(r,503,'saving reports unavailable, never a silent success');
  assert.deepEqual(errors,[]);console.log('PASS before migration: setting hidden, badges unchanged, save reports 503, no browser errors');
  process.exit(0);
 }

 // 1. Desktop ••• menu, "This room": three choices, All messages current by default.
 await openMenu();await page.waitForSelector(group);
 const label=await page.$eval('#chat-settings-panel',e=>e.textContent);assert.ok(label.indexOf('This room')<label.indexOf('Notifications')&&label.indexOf('Notifications')<label.indexOf('You'),label);
 assert.deepEqual(await page.$$eval(`${group} button`,b=>b.map(e=>e.textContent.replace('✓','').trim())),['All messages','Mentions only','Muted']);
 assert.deepEqual(await pressed(group),['All messages']);
 await page.keyboard.press('Escape');

 // 2. Mute SOCIAL from inside it; plain messages and @mentions there leave no badge and no bell.
 await page.click(socialLink);await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');
 await openMenu();await page.waitForSelector(group);await choose(group,'Muted');
 await page.waitForFunction(g=>document.querySelector(`${g} button[aria-pressed="true"]`)?.textContent.includes('Muted')&&!document.querySelector(`${g} [aria-busy]`),{},group);
 assert.deepEqual((await activity()).roomLevels,{social:'muted'});
 await page.keyboard.press('Escape');
 await page.click('nav[aria-label="Chat rooms"] a[href="/chat?room=main"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 const bellBefore=(await activity()).mentionCount;
 await say('social','Muted room plain message');await say('social','@Alice muted room mention');
 await page.waitForFunction(async()=>(await (await fetch('/api/chat/activity?why=test')).json()).roomMessageCounts.social>=2);
 await page.waitForSelector(`${socialLink}[data-muted] [aria-label="Muted"]`);
 await new Promise(r=>setTimeout(r,1500));
 assert.equal(await page.$(`${socialLink} [aria-label*="unread messages"]`),null,'muted room has no badge');
 assert.equal(await page.$eval(socialLink,e=>e.hasAttribute('data-unread')),false,'muted room is not bold');
 let a=await activity();assert.equal(a.mentionCount,bellBefore,'muted mention does not light the bell');assert.equal(a.roomCounts.social,undefined);
 await page.screenshot({path:'/tmp/room-notify-muted-sidebar.png'});

 // 3. Mentions only: the badge counts only the @mention; the bell lights for it.
 await page.click(socialLink);await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');
 await openMenu();await page.waitForSelector(group);await choose(group,'Mentions only');
 await page.waitForFunction(g=>document.querySelector(`${g} button[aria-pressed="true"]`)?.textContent.includes('Mentions only')&&!document.querySelector(`${g} [aria-busy]`),{},group);
 await page.keyboard.press('Escape');
 await page.click('nav[aria-label="Chat rooms"] a[href="/chat?room=main"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 await say('social','Mentions-only plain message');await say('social','Mentions-only plain message 2');await say('social','Mentions-only plain message 3');
 await page.waitForFunction(async()=>(await (await fetch('/api/chat/activity?why=test')).json()).roomMessageCounts.social>=3);
 await new Promise(r=>setTimeout(r,1500));
 // The badge is the room's unread mentions (an earlier one sent while muted is still unread), not its messages.
 a=await activity();const mentions=a.roomCounts.social??0;assert.ok(a.roomMessageCounts.social>mentions,JSON.stringify(a));
 const badge=()=>page.$eval(socialLink,e=>e.querySelector('[aria-label$="unread messages"]')?.textContent??'0');
 assert.equal(await badge(),String(mentions),'plain messages do not add to the badge on mentions only');
 assert.equal(await page.$(`${socialLink}[data-muted]`),null);
 const bell=a.mentionCount;
 await say('social','@Alice mentions-only ping');
 await page.waitForSelector(`${socialLink} [aria-label="${mentions+1} unread messages"]`,{timeout:20000});
 a=await activity();assert.equal(a.mentionCount,bell+1,'the @mention lights the bell');
 await page.waitForFunction(n=>new RegExp(`, ${n} room alerts`).test(document.querySelector('button[aria-label^="Chat notifications"]')?.getAttribute('aria-label')||''),{timeout:20000},bell+1);

 // 4. Phone: the room info sheet shows the same choice; it saves and survives a reload.
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await page.goto(`${base}/chat?room=social`);await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');
 const sheet='[role="dialog"][aria-label="Room info"]',sheetGroup=`${sheet} [role="group"][aria-label="Room notifications"]`;
 await page.waitForFunction(()=>{if(document.querySelector('[role="dialog"][aria-label="Room info"]'))return true;const b=[...document.querySelectorAll('button[aria-label="Room info"]')].find(b=>b.getClientRects().length);b?.click();return false;},{polling:400,timeout:15000});
 await page.waitForSelector(sheetGroup,{visible:true});
 assert.deepEqual(await pressed(sheetGroup),['Mentions onlyOnly @mentions and replies to you']);
 await choose(sheetGroup,'Muted');
 await page.waitForFunction(g=>document.querySelector(`${g} button[aria-pressed="true"]`)?.textContent.startsWith('Muted')&&!document.querySelector(`${g} [aria-busy]`),{},sheetGroup);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');
 await page.waitForFunction(()=>{if(document.querySelector('[role="dialog"][aria-label="Room info"] [role="group"][aria-label="Room notifications"]'))return true;const b=[...document.querySelectorAll('button[aria-label="Room info"]')].find(b=>b.getClientRects().length);if(b&&!document.querySelector('[role="dialog"][aria-label="Room info"]'))b.click();return false;},{polling:400,timeout:20000});
 assert.ok((await pressed(sheetGroup))[0].startsWith('Muted'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // Back to the default for later runs.
 await choose(sheetGroup,'All messages');
 await page.waitForFunction(g=>document.querySelector(`${g} button[aria-pressed="true"]`)?.textContent.startsWith('All messages')&&!document.querySelector(`${g} [aria-busy]`),{},sheetGroup);
 assert.deepEqual((await activity()).roomLevels,{});
 assert.deepEqual(errors,[]);
 console.log('PASS room notifications: desktop menu + phone sheet choice, muted = no badge/bell + muted mark, mentions only = mention badge + bell, saved across reload, no browser errors');
}finally{await browser.close();}
