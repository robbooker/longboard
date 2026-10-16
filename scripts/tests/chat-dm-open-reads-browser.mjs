// BUG-DM-OPEN-READS-ROOM: opening a DM link (/chat?dm=<id>, the URL a DM push notification opens)
// must leave the room underneath unread. Only a room that is actually shown is marked read.
// Desktop 1440 and phone 390. Actual production UI/API/current SQL; exclusively synthetic local data.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const timingScale=Number(process.env.CHAT_TIMING_SCALE||1);
const base=process.env.CHAT_TEST_URL||'http://localhost:3398',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54598';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,bob]}=await control('identity');
await sql("update profiles set role='user' where id=$1",[alice.id]);
await sql("update longboard_chat_conversations set status='accepted'");
const [conversation]=await sql('select * from longboard_chat_conversations where (requester_id=$1 and recipient_id=$2) or (requester_id=$2 and recipient_id=$1)',[alice.member.id,bob.member.id]);
const dm=await sql("insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values($1,$2,gen_random_uuid(),'DM open reads message') returning id,seq",[conversation.id,bob.member.id]);
const readMain=async()=>Number((await sql("select through_seq from chat_room_reads where account_id=$1 and room_slug='main'",[alice.id]))[0]?.through_seq??0);
const pause=ms=>new Promise(r=>setTimeout(r,ms*timingScale));
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const dmInput='[aria-label="Private conversation"] textarea',roomInput='textarea[aria-label="Message LB"]';
try{
 for(const [label,viewport] of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844,isMobile:true,hasTouch:true}]]){
  const context=await browser.createBrowserContext(),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
  const ready=async s=>{await p.waitForSelector(s,{visible:true});await p.waitForFunction(s=>Object.keys(document.querySelector(s)).some(k=>k.startsWith('__reactProps$')),{},s);};
  const roomReads=[];
  p.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/chat/activity')){const body=JSON.parse(r.postData()||'{}');if(body.kind==='room')roomReads.push(body);}});
  await p.setViewport(viewport);
  await p.goto(base+'/login?next=%2Fchat%3Froom%3Dmain');await ready('#li-email');await p.reload({waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>{const f=document.querySelector('#li-email')?.form;return f&&Object.keys(f).some(k=>k.startsWith('__reactProps$')&&typeof f[k]?.onSubmit==='function');});
  await p.type('#li-email',alice.email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');
  await p.waitForFunction(()=>location.pathname==='/chat');
  // Leave chat, then give the member unread messages in the main room.
  await p.goto('about:blank');
  const unread=await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) select $1,$1,'Bob','DM open reads '||$2||' '||n,'main' from generate_series(1,5)n returning unread_seq",[bob.member.id,label]);
  const newest=Math.max(...unread.map(r=>Number(r.unread_seq)));
  await sql("insert into chat_room_reads(account_id,room_slug,through_seq) values($1,'main',$2) on conflict(account_id,room_slug) do update set through_seq=excluded.through_seq",[alice.id,newest-5]);
  const before=await readMain();assert.equal(before,newest-5);
  roomReads.length=0;
  // Open the DM link directly, as a DM push notification does (public/chat-sw.js openWindow).
  await p.goto(`${base}/chat?dm=${conversation.id}`,{waitUntil:'domcontentloaded'});
  await ready(dmInput);await p.waitForSelector(`[data-message-id="${dm[0].id}"]`);
  await pause(4000);
  const counts=await p.evaluate(async()=>(await (await fetch('/api/chat/activity?why=test')).json()).roomMessageCounts);
  const after=await readMain();
  assert.deepEqual(roomReads.filter(r=>r.room==='main'),[],`${label}: opening the DM posted a main room read ${JSON.stringify(roomReads)}`);
  assert.equal(after,before,`${label}: main read position moved ${before} -> ${after} while only the DM was shown`);
  assert.equal(counts.main,5,`${label}: main unread count ${counts.main}`);
  await p.waitForSelector('a[href*="room=main"] [aria-label="5 unread messages"]',{timeout:10000*timingScale});
  if(label==='phone'){
   // Back from the notification's DM lands on the list (UI-PHONE-NAV); the room is still not shown.
   await p.goBack();await p.waitForSelector('#chat-room-navigation a[href*="room=main"] [aria-label="5 unread messages"]',{visible:true});
   await pause(2000);assert.equal(await readMain(),before,'phone: back to the list read the room');
  }
  // Control: showing the room does read it.
  await p.goto(`${base}/chat?room=main`);await ready(roomInput);
  await p.waitForFunction(async n=>(await (await fetch('/api/chat/activity?why=test')).json()).roomMessageCounts.main===0,{timeout:15000*timingScale},newest);
  assert.equal(await readMain(),newest,`${label}: showing the room reads it`);
  await p.screenshot({path:`/tmp/chat-dm-open-reads-${label}.png`});
  console.log(`PASS ${label}: DM link left main unread (${before} of ${newest}); opening main read it`);
  await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS opening a DM link leaves room unread intact (desktop + phone), no browser errors');
}finally{await browser.close();}
