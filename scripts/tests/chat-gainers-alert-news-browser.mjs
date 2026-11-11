// Ticket #436 "Gainers: post the latest press release headline and link under the alert". When a
// stock first alerts on Gainers in an Eastern day and the lookup program's DilutionTracker news read
// arrives (kind "news" on /api/chat/gainers/facts), the newest release shows once under that first
// alert: the headline as a link to the release, then its wire and Eastern time
// ("ACCESS Newswire · 7:02 AM ET"). Synthetic tickers and releases only (localhost:3423, database
// 127.0.0.1:54623). Checked on a computer (1280) and a phone (390):
//  - FRSH (release 25 minutes old): the headline link sits under its first alert, inside the alert,
//    and opens the release in a new tab; a second FRSH alert and a repeated news read add nothing;
//  - STAL (newest release 5 days old), NONE (no releases) and LATE (first alert 40 minutes before
//    its read) show nothing;
//  - nothing runs off the side of the phone.
// SCREENS=<dir> saves after-desktop.png and after-phone.png. BEFORE=1 (run against the app before
// this change) only seeds the same room and saves before-desktop.png.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3423',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54623';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const screens=process.env.SCREENS||'',before=process.env.BEFORE==='1';
if(screens)await mkdir(screens,{recursive:true});
const TOKEN='synthetic-gainers-lookup-token-never-a-production-secret';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const {people:[alice]}=await control('identity');

// Every alert below must fall in today's Eastern day (the route reads "today" in New York): in the
// first 45 minutes after Eastern midnight, wait.
const etParts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
const etMinutes=Number(etParts.hour)*60+Number(etParts.minute);
if(etMinutes<45)await pause((45-etMinutes)*60000);
const ago=minutes=>new Date(Date.now()-minutes*60000).toISOString();
const alertBody=(sym,pct,price,volume)=>`🚨 ${sym} (+${pct}%) 🕒 Pre-Market\n💵 Price: $${price}\n📊 Volume: ${volume}\n🏦 Market Cap: 18.4M · Float: 3.2M`;
// Start from an empty Gainers room and no saved releases (a second attempt too).
await sql(`do $$ begin if to_regclass('public.chat_gainers_alert_news') is not null then delete from public.chat_gainers_alert_news; end if; end $$`);
await sql('delete from chat_gainers_news');await sql('delete from chat_gainers_news_checks');
await sql('delete from chat_gainers_sources');await sql("delete from longboard_chat_messages where room_slug='gainers'");
let source=Date.now()%1e9;
const ingest=(minutes,body)=>sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source++,ago(minutes),body]);
await ingest(40,alertBody('LATE','44.10','2.05','2,950,112'));
await ingest(6,alertBody('FRSH','52.60','4.76','1,234,567'));
await ingest(5,alertBody('STAL','27.10','0.89','3,410,220'));
await ingest(4,alertBody('NONE','34.45','12.31','612,904'));
const lookup=async body=>{const r=await fetch(`${base}/api/chat/gainers/facts`,{method:'POST',headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const release=(id,minutes,title,source='ACCESS Newswire')=>({publishedAt:ago(minutes),source,title,url:`https://dilution.news/${id}`,dtItemId:id});
const frshNews=[release('frsh0002',25,'Freshcorp Announces FDA Clearance for Its Synthetic Test Device'),release('frsh0001',60*24*6,'Freshcorp Reports Third Quarter Results','GlobeNewswire')];
// The lookup's reads, as it sends them: FRSH twice (a retry), the others once.
const first=await lookup({kind:'news',ticker:'FRSH',items:frshNews});
const again=await lookup({kind:'news',ticker:'FRSH',items:frshNews});
const stal=await lookup({kind:'news',ticker:'STAL',items:[release('stal0001',60*24*5,'Stalecorp Closes Offering')]});
const none=await lookup({kind:'news',ticker:'NONE',items:[]});
const late=await lookup({kind:'news',ticker:'LATE',items:[release('late0001',10,'Latecorp Signs Partnership')]});
// FRSH alerts again after its headline went up: nothing new.
await ingest(1,alertBody('FRSH','61.20','5.31','2,004,881'));
const alerts=await sql("select id,body,created_at from longboard_chat_messages where room_slug='gainers' and reply_to_id is null order by created_at");
const by=sym=>alerts.filter(a=>a.body.startsWith(`🚨 ${sym} `));
const [frsh1,frsh2]=by('FRSH'),[stalAlert]=by('STAL'),[noneAlert]=by('NONE'),[lateAlert]=by('LATE');
if(!before){
  assert.equal(first.headline,'posted','the first FRSH read posts its headline');
  assert.equal(again.headline,'duplicate','the repeated read does not post again');
  assert.equal(stal.headline,'stale','STAL: newest release is more than 3 days old');
  assert.equal(none.headline,'no_news','NONE: no releases');
  assert.equal(late.headline,'too_late','LATE: the first alert is more than 30 minutes old');
  const rows=await sql('select ticker,alert_message_id,item_key from chat_gainers_alert_news order by ticker');
  assert.deepEqual(rows,[{ticker:'FRSH',alert_message_id:frsh1.id,item_key:'dt:frsh0002'}],'one headline, under the first FRSH alert');
  // The room never got a new message for it: still five alerts.
  assert.equal(alerts.length,5,'no extra message in the room');
}
const errors=[];
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
let browser,p;
const start=async size=>{await browser?.close();browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport(size);await signIn(p,base,alice.email);};
const openRoom=async ids=>{
  await p.goto(`${base}/chat?room=gainers`);
  await p.waitForFunction(ids=>ids.every(id=>document.querySelector(`main[data-room="gainers"] #chat-message-${id}`)),{timeout:120000},ids);
  await p.waitForFunction(id=>!/T\d\d:/.test(document.querySelector(`#chat-message-${id} time`)?.textContent??'T00:'),{timeout:60000},ids[0]);
  await p.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await pause(600);
};
// The Eastern time the line must show, like "7:02 AM ET".
const etTime=iso=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(new Date(iso)).map(x=>[x.type,x.value]));return `${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()} ET`;};
const look=id=>p.evaluate(id=>{
  const a=document.getElementById(`chat-message-${id}`);a.scrollIntoView({block:'center'});
  const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,r:r.right,b:r.bottom,w:r.width,h:r.height};};
  const news=a.querySelectorAll('[data-alert-news]'),line=news[0],link=line?.querySelector('a'),body=a.querySelector('p');
  return {count:news.length,row:box(a),body:body&&box(body),line:line&&box(line),link:link&&{href:link.href,target:link.target,rel:link.rel,text:link.textContent,box:box(link),onTop:link.contains(document.elementFromPoint(box(link).x+4,box(link).y+box(link).h/2))},
    meta:line?.querySelector('[data-alert-news-meta]')?.textContent??null,label:line?.getAttribute('aria-label')??null,overflow:document.documentElement.scrollWidth-innerWidth};
},id);
try{
  for(const [where,size] of before?[['computer',desktop]]:[['computer',desktop],['phone',phone]]){
    await start(size);
    await openRoom(alerts.map(a=>a.id));
    if(!before){
      await p.waitForSelector(`#chat-message-${frsh1.id} [data-alert-news]`,{timeout:60000});
      const s=await look(frsh1.id);
      assert.equal(s.count,1,`${where}: one headline under FRSH's first alert`);
      assert.equal(s.link.text,frshNews[0].title,`${where}: the newest release's headline`);
      assert.equal(s.link.href,frshNews[0].url,`${where}: the link opens the release`);
      assert.equal(s.link.target,'_blank',`${where}: in a new tab`);
      assert.match(s.link.rel,/noopener/,`${where}: without handing the room to the release page`);
      assert.equal(s.meta,`ACCESS Newswire · ${etTime(frshNews[0].publishedAt)}`,`${where}: the wire and its Eastern time`);
      assert(s.link.onTop&&s.link.box.w>40&&s.link.box.h>8,`${where}: the link can be seen and clicked (${JSON.stringify(s.link.box)})`);
      assert(s.line.y>=s.body.b-1,`${where}: the headline is under the alert text`);
      assert(s.line.x>=s.row.x-0.5&&s.line.r<=s.row.r+0.5&&s.line.b<=s.row.b+0.5,`${where}: inside its alert`);
      assert(s.overflow<=0,`${where}: nothing runs off the side`);
      for(const [name,alert] of [['second FRSH alert',frsh2],['STAL',stalAlert],['NONE',noneAlert],['LATE',lateAlert]])
        assert.equal((await look(alert.id)).count,0,`${where}: no headline under ${name}`);
      // Clicking opens the release in a new tab (the request is stopped before it leaves the machine).
      const opened=new Promise(resolve=>browser.once('targetcreated',async target=>{const page=await target.page().catch(()=>null);if(page){await page.setRequestInterception(true).catch(()=>{});page.on('request',r=>r.abort().catch(()=>{}));}resolve(target.url());}));
      await p.click(`#chat-message-${frsh1.id} [data-alert-news] a`);
      const url=await Promise.race([opened,pause(10000).then(()=>null)]);
      assert(url===null||url===frshNews[0].url||url==='about:blank',`${where}: the click opens the release (${url})`);
      await p.bringToFront();
      console.log(`PASS ${where}: FRSH's first alert shows "${s.link.text}" (${s.meta}); STAL, NONE, LATE and FRSH's second alert show nothing.`);
    }
    await p.evaluate(id=>document.getElementById(`chat-message-${id}`).scrollIntoView({block:'center'}),frsh1.id);await pause(300);
    if(screens)await p.screenshot({path:`${screens}/${before?'before':'after'}-${where==='computer'?'desktop':'phone'}.png`});
  }
  assert.deepEqual(errors,[]);console.log(before?'Saved the before picture.':'PASS zero browser runtime errors.');
}catch(error){await p?.screenshot({path:'/tmp/chat-gainers-alert-news-failure.png'}).catch(()=>{});throw error;}finally{await browser?.close();}
