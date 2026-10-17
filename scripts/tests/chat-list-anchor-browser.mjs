// LIST-ANCHOR: the room list rests at the newest message while rows above change height, a reader's
// row holds still, and a 1,000+ message conversation scrolls smoothly on a throttled phone (390px,
// 4x CPU). A room holds at most 80 rows (lib/publicChat mergeMessage), so the long list is a DM,
// which keeps every page it loads.
// Actual production UI/API/current SQL; exclusively synthetic local accounts/data.
// Prints a METRICS line (frame gaps, long tasks, interaction latency) for before/after comparison.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
// Budgets are for a quiet developer machine; slower shared CI runners set CHAT_TIMING_SCALE (see run-browser-tests.mjs).
const timingScale=Number(process.env.CHAT_TIMING_SCALE||1);
const base=process.env.CHAT_TEST_URL||'http://localhost:3392',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54592';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,bob]}=await control('identity');
await sql("update profiles set role='user' where id=$1",[alice.id]);
await sql("delete from longboard_chat_messages where body like 'Anchor %'");
// Varied row heights: every fifth message runs several lines.
const insert=(from,to)=>sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) select $1,$1,'Bob','Anchor row '||n||case when n%5=0 then ' with a longer body that wraps across several lines on a phone so rows are not all the same height, like real chat history' else '' end,'main' from generate_series($2::int,$3::int)n returning *",[bob.member.id,from,to]);
const seed=await insert(1,80);
const mark=seq=>sql('insert into chat_room_reads(account_id,room_slug,through_seq) values($1,$2,$3) on conflict(account_id,room_slug) do update set through_seq=excluded.through_seq',[alice.id,'main',seq]);
await mark(seed.at(-1).unread_seq);
await sql("update longboard_chat_conversations set status='accepted'");
const [conversation]=await sql('select * from longboard_chat_conversations where (requester_id=$1 and recipient_id=$2) or (requester_id=$2 and recipient_id=$1)',[alice.member.id,bob.member.id]);
await sql("delete from longboard_chat_direct_messages where body like 'Anchor %'");
const dms=await sql("insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) select $1,$2,gen_random_uuid(),'Anchor dm '||n||case when n%5=0 then ' with a longer body that wraps across several lines on a phone so rows are not all the same height, like real chat history' else '' end from generate_series(1,1100)n returning id,seq",[conversation.id,bob.member.id]);
await sql('update longboard_chat_conversations set requester_read_seq=$2,recipient_read_seq=$2 where id=$1',[conversation.id,dms.at(-1).seq]);
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),p=await browser.newPage(),errors=[];
p.on('pageerror',e=>{errors.push(e.message);console.error('Browser error stack',e.stack);});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ready=async s=>{await p.waitForSelector(s,{visible:true});await p.waitForFunction(s=>Object.keys(document.querySelector(s)).some(k=>k.startsWith('__reactProps$')),{},s);};
const dmPane='[aria-label="Private conversation"]',dmScroll=dmPane+' [aria-live="polite"][aria-busy]';
let room='[data-room="main"] [role="log"][aria-busy]',input='textarea[aria-label="Message LB"]';
const bottom=(label,timeout=12000)=>p.waitForFunction(s=>{const e=document.querySelector(s);return e&&e.scrollHeight-e.clientHeight-e.scrollTop<=2;},{timeout},room).catch(async()=>{throw Error(label+': not at the newest message, gap '+await gap());});
const gap=()=>p.$eval(room,e=>Math.round(e.scrollHeight-e.clientHeight-e.scrollTop));
const anchor=()=>p.$eval(room,e=>{const bounds=e.getBoundingClientRect();const row=[...e.querySelectorAll('article')].find(r=>r.getBoundingClientRect().bottom>bounds.top+10);return {id:row.id||row.dataset.messageId,offset:row.getBoundingClientRect().top-bounds.top};});
const preserved=async(before,label)=>{const after=await anchor();assert.equal(after.id,before.id,label+' visible anchor '+JSON.stringify({before,after}));assert(Math.abs(after.offset-before.offset)<3,`${label} anchor offset ${before.offset} -> ${after.offset}`);};
// Grows (or restores) the nth row from the end, by index into the rendered rows.
// A wheel step down to the newest message (as chat-auto-scroll's move): synthesized wheel gestures
// report each wheel after the scroll it caused, so they never read as moving down.
const toBottom=async()=>{await p.$eval(room,e=>{const next=e.scrollHeight-e.clientHeight-20;e.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:next-e.scrollTop}));e.scrollTop=next;e.dispatchEvent(new Event('scroll',{bubbles:true}));});await pause(70);await p.$eval(room,e=>{e.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:20}));e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll',{bubbles:true}));});await pause(150);};
const grow=(fromEnd,height)=>p.$eval(room,(e,{fromEnd,height})=>{const rows=[...e.querySelectorAll('article[id^="chat-message-"]')];rows.at(-fromEnd).style.minHeight=height?height+'px':'';},{fromEnd,height});
try{
 await p.setViewport({width:1440,height:1000});await p.goto(base+'/login?next=%2Fchat');await ready('#li-email');await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>{const f=document.querySelector('#li-email')?.form;return f&&Object.keys(f).some(k=>k.startsWith('__reactProps$')&&typeof f[k]?.onSubmit==='function');});await p.type('#li-email',alice.email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await ready(input);
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await p.goto(base+'/chat?room=main');await ready(input);await p.waitForSelector('#chat-message-'+seed.at(-1).id);await bottom('opens at the newest message');
 // A. Resting at the newest message while rows above change height (images, reactions, edits).
 for(const [fromEnd,height] of [[30,420],[3,260],[30,0],[3,0],[60,900]]){await grow(fromEnd,height);await pause(150);assert((await gap())<=2,`row ${fromEnd} from the end at ${height||'natural'}px keeps the bottom (gap ${await gap()})`);}
 await grow(60,0);
 // A late image above the newest message.
 await p.$eval(room,e=>{const row=[...e.querySelectorAll('article')].at(-4);const img=new Image();img.alt='';img.width=300;img.height=1;row.append(img);setTimeout(()=>{img.height=240;},50);});await pause(300);assert((await gap())<=2,'a late image above keeps the bottom');
 // The keyboard (a shorter viewport) and back.
 await p.setViewport({width:390,height:480,isMobile:true,hasTouch:true});await pause(250);assert((await gap())<=2,'a shorter viewport keeps the bottom');
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await pause(250);assert((await gap())<=2,'a taller viewport keeps the bottom');
 console.log('PASS resting at the newest message while rows above change height, a late image and viewport changes.');
 // B. A reader's row holds while rows above it change height.
 const client=await p.createCDPSession();const box=await p.$eval(room,e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};});
  // Wheel gestures: headless Chromium ignores synthesized touch scrolls on this pane.
 const swipe=(distance,speed=1500,repeat=1)=>client.send('Input.synthesizeScrollGesture',{x:box.x,y:box.y,yDistance:distance,speed,repeatCount:repeat,repeatDelayMs:0,gestureSourceType:'mouse'});
 for(let i=0;i<4&&(await gap())<=600;i++){await swipe(1200);await pause(400);}assert((await gap())>600,'scrolling leaves the bottom, gap '+await gap());
 // Let the gesture's scroll come to rest before reading the anchor: on a slow runner it was still moving and
 // the row at the top changed (offset -1 -> -20) without any row growing (CI, line 37).
 const settle=async()=>{let last=-1,still=0;for(let i=0;i<50&&still<3;i++){const top=await p.$eval(room,e=>e.scrollTop);still=top===last?still+1:0;last=top;await pause(100);}};
 await settle();let held=await anchor();await grow(75,500);await pause(200);await preserved(held,'row above grows');await grow(75,0);await pause(200);await preserved(held,'row above shrinks');
 const arrivals=await insert(81,81);await p.evaluate(rows=>{for(const row of rows)window.dispatchEvent(new CustomEvent('chat-room-event',{detail:{eventType:'INSERT',new:row}}));},arrivals);await p.waitForSelector('#chat-message-'+arrivals[0].id);await pause(200);await preserved(held,'a new message while reading');
 console.log('PASS a reader keeps their row while rows above grow, shrink and new messages arrive.');
 // C. 1,000+ messages: a long DM, paged in with "Load earlier messages" the way a reader gets there.
 await p.goto(base+'/chat?dm='+conversation.id);room=dmScroll;input=dmPane+' textarea';await ready(input);await p.waitForSelector(`[data-message-id="${dms.at(-1).id}"]`);await bottom('the DM opens at the newest message');
 const rowCount=()=>p.$$eval(room+' article[data-message-id]',a=>a.length);
 const earlier=(s,enabled)=>[...document.querySelectorAll(s+' button')].some(b=>b.textContent.trim()==='Load earlier messages'&&(!enabled||!b.disabled));
 for(let pages=0;await p.evaluate(earlier,room,false);pages++){
  assert(pages<40,'paging ends');const before=await rowCount();
  await p.waitForFunction(earlier,{timeout:30000},room,true);
  await p.evaluate(s=>[...document.querySelectorAll(s+' button')].find(b=>b.textContent.trim()==='Load earlier messages'&&!b.disabled)?.click(),room);
  await p.waitForFunction((s,n)=>document.querySelectorAll(s+' article[data-message-id]').length>n,{timeout:30000},room,before);
 }
 const count=await rowCount();assert(count>=1000,'1,000+ rows rendered, got '+count);
 // Paging leaves the reader where they were (the newest message) but paused; scroll back down to follow.
 await swipe(3000,6000);await toBottom();await bottom('back at the newest message with 1,000+ rows',30000);
 await client.send('Emulation.setCPUThrottlingRate',{rate:4});await pause(500);
 await p.evaluate(()=>{const m=window.__lam={frames:[],long:[],loaf:[],events:[]};let run=true;m.stop=()=>{run=false;};const tick=t=>{m.frames.push(t);if(run)requestAnimationFrame(tick);};requestAnimationFrame(tick);
  new PerformanceObserver(l=>m.long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});
  m.slow=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries()){m.loaf.push(e.duration);if(e.duration>300)m.slow.push(Math.round(e.duration)+': '+(e.scripts||[]).filter(x=>x.duration>20).map(x=>`${x.invoker}${x.sourceFunctionName?' '+x.sourceFunctionName:''} ${Math.round(x.duration)}`).join(', '));}}).observe({type:'long-animation-frame'});}catch{}
  // Input to the next frame: how long the main thread keeps a tap or key from showing. Headless
  // Chromium can hold event-timing entries until an unrelated later frame (typing alone did not
  // present one), so this is the latency the test asserts; event timing is reported beside it.
  m.input=[];for(const type of ['pointerdown','keydown','click'])addEventListener(type,e=>{const t=e.timeStamp;requestAnimationFrame(()=>setTimeout(()=>m.input.push({type,d:performance.now()-t}),0));},true);
  new PerformanceObserver(l=>m.events.push(...l.getEntries().filter(e=>e.interactionId).map(e=>({id:e.interactionId,name:e.name,d:e.duration})))).observe({type:'event',durationThreshold:16});});
 const t0=Date.now();await swipe(2500,3000,12);await swipe(-2500,3000,6);const scrollMs=Date.now()-t0;
 const scroll=await p.evaluate(()=>{const m=window.__lam;m.stop();const gaps=m.frames.slice(1).map((t,i)=>t-m.frames[i]).sort((a,b)=>a-b);const q=f=>Math.round(gaps[Math.min(gaps.length-1,Math.floor(gaps.length*f))]);const r={frames:gaps.length,p50:q(.5),p95:q(.95),max:q(1),over50:gaps.filter(g=>g>50).length,longTasks:m.long.length,longMs:Math.round(m.long.reduce((a,b)=>a+b,0)),longMax:Math.round(Math.max(0,...m.long)),loaf:m.loaf.length,loafMax:Math.round(Math.max(0,...m.loaf))};m.frames=[];m.long=[];m.loaf=[];return r;});
 held=await anchor();await pause(600);await preserved(held,'the reader stays put after a long throttled scroll');
 // Interactions on the 1,000+ row page: typing in the composer and opening a message's menu.
 await p.tap(input);await p.keyboard.type('quick brown fox',{delay:40});await pause(300);
 const menu=await p.$eval(room,e=>{const bounds=e.getBoundingClientRect();const s=[...e.querySelectorAll('summary')].find(s=>{const r=s.getBoundingClientRect();return r.top>bounds.top+80&&r.bottom<bounds.bottom-80;});if(!s)return null;const r=s.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
 if(menu){await p.touchscreen.tap(menu.x,menu.y);await pause(400);await p.touchscreen.tap(menu.x,menu.y);await pause(400);}
 // A new message arriving while resting at the newest message.
 await swipe(-400000,40000);await toBottom();await bottom('back at the newest message after the scroll',30000);
 const [last]=await control('sql',{sql:"insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values($1,$2,gen_random_uuid(),'Anchor dm arrival') returning *",args:[conversation.id,bob.member.id],broadcast:'longboard_chat_direct_messages'});
 await p.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));await p.waitForSelector(`[data-message-id="${last.id}"]`,{timeout:30000});const arrivalGap=await p.waitForFunction(s=>{const e=document.querySelector(s);return e.scrollHeight-e.clientHeight-e.scrollTop<=2;},{timeout:15000},room).then(()=>0,()=>gap());
 const after=await p.evaluate(()=>{const m=window.__lam;const by={},kind={};for(const e of m.events){if(e.d>=(by[e.id]??0))kind[e.id]=e.name;by[e.id]=Math.max(by[e.id]??0,e.d);}const v=Object.values(by),worst=Object.keys(by).sort((a,b)=>by[b]-by[a])[0];const input=m.input.reduce((a,b)=>b.d>a.d?b:a,{type:null,d:0});return{inputToFrame:Math.round(input.d),inputEvent:input.type,inputs:m.input.length,interactions:v.length,eventTimingInp:Math.round(Math.max(0,...v)),eventTimingEvent:kind[worst]??null,slow:m.slow.slice(-6),longTasks:m.long.length,longMax:Math.round(Math.max(0,...m.long)),loafMax:Math.round(Math.max(0,...m.loaf))};});
 await client.send('Emulation.setCPUThrottlingRate',{rate:1});
 console.log('METRICS '+JSON.stringify({rows:count,scrollMs,scroll,after,arrivalGap}));
 assert.equal(arrivalGap,0,'a new message on a 1,000+ row page stays in view');
 // Find-in-page still reaches an old row far above the screen.
 const found=await p.evaluate(()=>{window.getSelection().removeAllRanges();return window.find('Anchor dm 90 ');});assert(found,'find-in-page reaches an old row');
 assert(after.inputToFrame<200*timingScale,'interaction latency under 200 ms on a throttled phone, got '+after.inputToFrame);
 assert(scroll.longMax<200*timingScale,'no long task over 200 ms while scrolling, got '+scroll.longMax);
 assert.deepEqual(errors,[]);console.log('PASS 1,000+ rows: smooth throttled phone scrolling, reader position held, interactions under 200 ms, find-in-page, newest message follows.');
}catch(error){console.error('Runtime errors',errors);await p.screenshot({path:'/tmp/chat-list-anchor-failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
