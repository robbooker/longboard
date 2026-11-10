// Ticket #419 "Gainers alerts: time and date on every alert": in the Gainers room every alert shows
// its own small date and time ("Nov 10, 07:51", the viewer's own clock), also the alerts that
// follow another within five minutes and so have no name line. Checked on a computer (1280) and a
// phone (390): the stamp is there once per alert, visible, small and muted, beside the text and
// never over it, and the alert is no taller for it. The ••• of such an alert still shows on hover
// and does not sit on the stamp. Another room (LB) keeps its grouping: a follow-on message has no
// visible time, and times there have no date.
// SCREENS=<dir> saves gainers-<computer|phone>.png and lb-computer.png.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3421',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54621';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const screens=process.env.SCREENS||'';
if(screens)await mkdir(screens,{recursive:true});
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const {people:[alice,bob]}=await control('identity');

// The alerts below are up to 90 seconds old and must all be today on this machine's clock, or the
// day line would split them: in the first two minutes after midnight, wait.
const sinceMidnight=Date.now()-new Date().setHours(0,0,0,0);
if(sinceMidnight<120000)await pause(120000-sinceMidnight);
const ago=seconds=>new Date(Date.now()-seconds*1000).toISOString();
const alertBody=(sym,pct,price,volume,cap,float)=>`🚨 ${sym} (+${pct}%) 🕒 Pre-Market\n💵 Price: $${price}\n📊 Volume: ${volume}\n🏦 Market Cap: ${cap} · Float: ${float}`;
// Synthetic tickers. OBIO alerted yesterday; ZYNT, QBLX and HVRA within 90 seconds just now.
const seed=[['OBIO',24*3600+600,alertBody('OBIO','31.20','3.18','2,104,551','41.2M','9.8M')],['ZYNT',90,alertBody('ZYNT','52.60','4.76','1,234,567','18.4M','3.2M')],['QBLX',60,alertBody('QBLX','27.10','0.89','3,410,220','7.7M','5.5M')],['HVRA',30,alertBody('HVRA','34.45','12.31','612,904','96.0M','4.4M')]];
// Start from an empty Gainers room (a second attempt too): each alert's source row first.
await sql('delete from chat_gainers_sources');await sql("delete from longboard_chat_messages where room_slug='gainers'");
let source=Date.now()%1e9;
for(const [,seconds,body] of seed)await sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[source++,ago(seconds),body]);
const alerts=await sql("select id,body,created_at from longboard_chat_messages where room_slug='gainers' and deleted_at is null order by created_at");
assert.deepEqual(alerts.map(a=>a.body.match(/🚨 (\w+)/)[1]),seed.map(s=>s[0]),'the four alerts are in the room');
const [obio,zynt,qblx,hvra]=alerts;
// Bob writes twice in LB within a minute: the second message is a follow-on there.
await sql("delete from longboard_chat_messages where body like 'G419 %'");
const say=async(body,seconds)=>(await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,created_at) values($1,$1,'Bob',$2,'main',now()-($3||' seconds')::interval) returning *",[bob.member.id,body,String(seconds)]))[0];
const lb1=await say('G419 first message in LB',60),lb2=await say('G419 second message in LB',30);

const errors=[];
// Real computer hover and pointer for the computer run; the phone run uses touch emulation.
const HOVER=['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'];
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
let browser,p;
const start=async size=>{await browser?.close();browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox',...(size===desktop?HOVER:[])]});p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport(size);await signIn(p,base,alice.email);};
const row=id=>`#chat-message-${id}`;
const openRoom=async(room,ids)=>{
  await p.goto(`${base}/chat?room=${room}`);
  await p.waitForFunction((room,ids)=>ids.every(id=>document.querySelector(`main[data-room="${room}"] #chat-message-${id}`)),{timeout:120000},room,ids);
  // Times are drawn in the viewer's own clock once the page is live: wait for that.
  await p.waitForFunction(id=>!/T\d\d:/.test(document.querySelector(`#chat-message-${id} time`)?.textContent??'T00:'),{timeout:60000},ids[0]);
  await p.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await pause(600);
};
// What the stamp must say, worked out in the page so it uses the same clock as the viewer.
const expected=iso=>p.evaluate(iso=>{const d=new Date(iso);return `${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(d)}, ${new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)}`;},iso);
// Everything the checks need about one message row.
const look=id=>p.evaluate(id=>{
  const a=document.getElementById(`chat-message-${id}`);a.scrollIntoView({block:'center'});
  const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,r:r.right,b:r.bottom,w:r.width,h:r.height};};
  const times=[...a.querySelectorAll('time')],time=times[0],t=box(time),body=a.querySelector('p'),bodyStyle=getComputedStyle(body),timeStyle=getComputedStyle(time);
  // The words of the message, line by line, without the stamp.
  const words=[];const walk=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);
  for(let n;(n=walk.nextNode());){if(n.parentElement.closest('time'))continue;const range=document.createRange();range.selectNodeContents(n);for(const r of range.getClientRects())if(r.width>0.5)words.push({x:r.x,y:r.y,r:r.right,b:r.bottom});}
  const at=document.elementFromPoint(t.x+t.w/2,t.y+t.h/2);
  return {continued:a.dataset.continued==='true',times:times.length,text:time.textContent,title:time.title,dateTime:time.dateTime,inBody:body.contains(time),stamps:a.querySelectorAll('[class*="alertStamp"]:has(> time)').length,
    time:t,row:box(a),words,onTop:!!at&&time.contains(at),shown:time.checkVisibility({opacityProperty:true,visibilityProperty:true}),
    timeSize:parseFloat(timeStyle.fontSize),timeColor:timeStyle.color,bodySize:parseFloat(bodyStyle.fontSize),bodyColor:bodyStyle.color,bodyHeight:body.getBoundingClientRect().height,lineHeight:parseFloat(bodyStyle.lineHeight),lines:new Set(words.map(w=>Math.round(w.y))).size,
    overflow:document.documentElement.scrollWidth-innerWidth};
},id);
const overlap=(a,b)=>a.x<b.r-0.5&&b.x<a.r-0.5&&a.y<b.b-0.5&&b.y<a.b-0.5;
const checkAlert=async(name,alert,continued,where)=>{
  const s=await look(alert.id),want=await expected(alert.created_at);
  assert.equal(s.continued,continued,`${name}: ${continued?'follows the alert before it, with no name line':'starts a group, with the name line'}`);
  assert.equal(s.times,1,`${name}: one time, so it is read out once`);
  assert.equal(s.text,want,`${name}: shows its date and time`);
  assert.match(s.text,/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/,`${name}: like "Nov 10, 07:51"`);
  assert.equal(new Date(s.dateTime).getTime(),new Date(alert.created_at).getTime(),`${name}: the time is machine-readable`);
  assert.match(s.title,/\d{4}/,`${name}: the full date shows on hover`);
  assert.equal(s.inBody,continued,`${name}: the time is ${continued?'beside the text':'by the name'}`);
  assert(s.shown&&s.onTop&&s.time.w>20&&s.time.h>8,`${name}: the time can be seen (${JSON.stringify(s.time)})`);
  assert(s.time.x>=s.row.x-0.5&&s.time.r<=s.row.r+0.5&&s.time.y>=s.row.y-0.5&&s.time.b<=s.row.b+0.5,`${name}: the time is inside its alert`);
  assert(s.timeSize<s.bodySize,`${name}: the time (${s.timeSize}px) is smaller than the alert text (${s.bodySize}px)`);
  assert.notEqual(s.timeColor,s.bodyColor,`${name}: the time is muted, not the text colour`);
  assert.equal(s.words.some(w=>overlap(w,s.time)),false,`${name}: the time is not over any words`);
  assert.equal(s.lines,4,`${name}: the alert's four lines are still four lines`);
  assert(Math.abs(s.bodyHeight-4*s.lineHeight)<1,`${name}: the text is four lines tall, no more (${s.bodyHeight} for a ${s.lineHeight} line)`);
  assert(s.overflow<=0,`${name}: nothing runs off the side of the ${where}`);
  return s;
};

try{
  for(const [where,size] of [['computer',desktop],['phone',phone]]){
    await start(size);
    await openRoom('gainers',alerts.map(a=>a.id));
    const first=await checkAlert(`${where} ZYNT`,zynt,false,where);
    const second=await checkAlert(`${where} QBLX`,qblx,true,where),third=await checkAlert(`${where} HVRA`,hvra,true,where);
    const old=await checkAlert(`${where} OBIO`,obio,false,where);
    assert.notEqual(old.text.split(',')[0],first.text.split(',')[0],`${where}: yesterday's alert names yesterday`);
    assert.equal(second.timeColor,first.timeColor,`${where}: the same muted colour as the time by the name`);
    assert.equal(second.timeSize,first.timeSize,`${where}: and the same small size`);
    assert.equal(second.stamps+third.stamps,2,`${where}: each follow-on alert has its own stamp`);
    if(size===desktop){
      // On a computer the stamp is on the alert's first line, at its right end.
      for(const s of [second,third]){assert(Math.abs(s.time.r-s.row.r)<2,'computer: the stamp is at the right edge');assert(s.time.y<Math.min(...s.words.map(w=>w.y))+s.lineHeight,'computer: on the first line');}
      // Its ••• still shows on hover, can be clicked, and sits under the stamp, not on it.
      const box=await (await p.$(row(qblx.id))).boundingBox();
      await p.mouse.move(box.x+200,box.y+box.height/2);
      await p.waitForFunction(id=>getComputedStyle(document.querySelector(`#chat-message-${id} > [class*="messageMeta"]`)).opacity==='1',{timeout:10000},qblx.id);
      await pause(300);
      const hover=await p.evaluate(id=>{const a=document.getElementById(`chat-message-${id}`),box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,r:r.right,b:r.bottom,w:r.width,h:r.height};},more=a.querySelector(':scope > [class*="messageMeta"] summary'),m=box(more),time=a.querySelector('time'),t=box(time);return {m,t,moreOnTop:more.contains(document.elementFromPoint(m.x+m.w/2,m.y+m.h/2)),timeOnTop:time.contains(document.elementFromPoint(t.x+t.w/2,t.y+t.h/2))};},qblx.id);
      assert(hover.m.w>20&&hover.m.h>20&&hover.moreOnTop,`computer: the ••• shows on hover and can be clicked (${JSON.stringify(hover.m)})`);
      assert.equal(overlap(hover.m,hover.t),false,`computer: the ••• is not on the stamp (${JSON.stringify(hover)})`);
      assert(hover.timeOnTop,'computer: the stamp still shows while the ••• is there');
      await p.mouse.move(5,5);
    }
    if(screens)await p.screenshot({path:`${screens}/gainers-${where}.png`});
    console.log(`PASS ${where}: every Gainers alert shows its own small date and time (${first.text}; ${second.text}; ${third.text}; ${old.text}), beside the text, and is no taller.`);

    // Another room is as it was: Bob's second message has no visible time, and no date anywhere.
    await openRoom('main',[lb1.id,lb2.id]);
    const lb=await p.evaluate((a,b)=>{const one=id=>{const e=document.getElementById(`chat-message-${id}`),time=e.querySelector('time'),line=time.parentElement,r=line.getBoundingClientRect();return {continued:e.dataset.continued==='true',times:e.querySelectorAll('time').length,text:time.textContent,w:r.width,h:r.height,clip:getComputedStyle(line).overflow,inBody:!!e.querySelector('p time')};};return {head:one(a),next:one(b),stamps:document.querySelectorAll('main[data-room="main"] [class*="alertStamp"]').length};},lb1.id,lb2.id);
    assert.equal(lb.head.continued,false);assert(lb.head.w>20&&lb.head.h>8,`${where} LB: the first message has its name line`);assert.equal(lb.next.continued,true,`${where} LB: the second message follows the first`);
    assert.match(lb.head.text,/^\d{2}:\d{2}$/,`${where} LB: the time by the name has no date`);
    assert.match(lb.next.text,/^\d{2}:\d{2}$/,`${where} LB: nor has the follow-on message's`);
    assert(lb.next.times===1&&lb.next.w<=1&&lb.next.h<=1&&lb.next.clip==='hidden'&&!lb.next.inBody,`${where} LB: the follow-on message's time is for screen readers only, as before (${JSON.stringify(lb.next)})`);
    assert.equal(lb.stamps,0,`${where} LB: no stamps in another room`);
    if(screens&&size===desktop)await p.screenshot({path:`${screens}/lb-computer.png`});
    console.log(`PASS ${where}: LB keeps its grouping, with no time on a follow-on message and no date.`);
  }
  assert.deepEqual(errors,[]);console.log('PASS zero browser runtime errors.');
}catch(error){await p?.screenshot({path:'/tmp/chat-gainers-alert-time-failure.png'}).catch(()=>{});throw error;}finally{await browser?.close();}
