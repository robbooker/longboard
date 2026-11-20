// #473: "Earlier messages" and "Newer messages" load above or below the messages on screen and
// leave the message being read in the same spot: in a room, a DM and a reply thread, on a phone
// and a computer, after opening at an older message from a link, and when pressed several times in
// a row. A picture that finishes loading in the rows above doesn't move it either.
// Actual production UI/API/current SQL; exclusively synthetic local accounts/data (ports 3473/54673).
// PLACE_SHOTS=<dir> saves screenshots with the message being read outlined. PLACE_SOFT=1 reports a
// moved message instead of failing (to take before-shots on code without the fix).
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import puppeteer from 'puppeteer';
const base=process.env.CHAT_TEST_URL||'http://localhost:3473',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54673';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.PLACE_SHOTS,soft=process.env.PLACE_SOFT==='1';
if(shots)mkdirSync(shots,{recursive:true});
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,bob]}=await control('identity');
await sql("update profiles set role='user' where id=$1",[alice.id]);
await sql("delete from longboard_chat_messages where body like 'Place %'");
// Varied row heights: every fifth message runs several lines.
const long=" ||case when n%5=0 then ' with a longer body that wraps across several lines on a phone, so the rows are not all the same height' else '' end";
// In posting order, after the fixture's own messages, each in its own millisecond (as real
// messages: the chat orders rows by time as well as by number).
const at="clock_timestamp()+make_interval(secs=>n*0.002)";
const roomRows=await sql(`insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,created_at) select $1,$1,'Bob','Place room '||n${long},'main',${at} from generate_series(1,600)n returning id,unread_seq`,[bob.member.id]);
const [root]=await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,created_at) values($1,$1,'Bob','Place thread root','social',clock_timestamp()) returning id,unread_seq",[bob.member.id]);
const replies=await sql(`insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) select $1,$1,'Bob','Place reply '||n${long},'social',$2,${at} from generate_series(1,500)n returning id,unread_seq`,[bob.member.id,root.id]);
const mark=(room,seq)=>sql('insert into chat_room_reads(account_id,room_slug,through_seq) values($1,$2,$3) on conflict(account_id,room_slug) do update set through_seq=excluded.through_seq',[alice.id,room,seq]);
await mark('main',roomRows.at(-1).unread_seq);await mark('social',root.unread_seq);
await sql("update longboard_chat_conversations set status='accepted'");
const [conversation]=await sql('select * from longboard_chat_conversations where (requester_id=$1 and recipient_id=$2) or (requester_id=$2 and recipient_id=$1)',[alice.member.id,bob.member.id]);
await sql("delete from longboard_chat_direct_messages where body like 'Place %'");
const dms=await sql(`insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body,created_at) select $1,$2,gen_random_uuid(),'Place dm '||n${long},${at} from generate_series(1,400)n returning id,seq`,[conversation.id,bob.member.id]);
// The DM opens at its first unread message, in the middle of the conversation: both buttons show.
const dmUnread=()=>sql('update longboard_chat_conversations set requester_read_seq=$2,recipient_read_seq=$2 where id=$1',[conversation.id,dms[199].seq]);

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),p=await browser.newPage(),errors=[];
p.on('pageerror',e=>{errors.push(e.message);console.error('Browser error stack',e.stack);});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ready=async s=>{await p.waitForSelector(s,{visible:true,timeout:60000});await p.waitForFunction(s=>Object.keys(document.querySelector(s)).some(k=>k.startsWith('__reactProps$')),{},s);};
// Page-side helpers: each kind's scrolling pane, its message rows and its paging buttons.
await p.evaluateOnNewDocument(outline=>{
 const kinds={
  room:{pane:()=>document.querySelector('[data-room="main"] [role="log"][aria-busy]'),rows:'article[id^="chat-message-"]',id:r=>r.id.slice(13)},
  dm:{pane:()=>document.querySelector('[aria-label="Private conversation"] [aria-live="polite"][aria-busy]'),rows:'article[data-message-id]',id:r=>r.dataset.messageId},
  thread:{pane:()=>document.querySelector('aside[aria-label="Comment replies"] [aria-label="Replies to this comment"]')?.parentElement,rows:'[aria-label="Replies to this comment"] [data-thread-message-id]',id:r=>r.dataset.threadMessageId},
 };
 const visible=e=>e.getBoundingClientRect().width>0;
 window.__place={
  pane:k=>kinds[k].pane(),
  rows:k=>[...kinds[k].pane().querySelectorAll(kinds[k].rows)].filter(visible),
  ids:k=>window.__place.rows(k).map(kinds[k].id),
  // The message being read: the first row wholly in view. Its text is what must stay put (the
  // name line above it goes when earlier messages from the same person join it).
  reading(k){const pane=kinds[k].pane(),box=pane.getBoundingClientRect(),rows=window.__place.rows(k);
   const row=rows.find(r=>{const b=r.getBoundingClientRect();return b.top>=box.top-1&&b.bottom<=box.bottom+1;})??rows.find(r=>r.getBoundingClientRect().bottom>box.top+10);
   for(const old of document.querySelectorAll('[data-place-read]'))old.removeAttribute('data-place-read');
   row.setAttribute('data-place-read','');
   return {id:kinds[k].id(row),offset:window.__place.at(k,kinds[k].id(row)),text:(row.querySelector('p')??row).textContent.slice(0,40)};},
  at(k,id){const row=window.__place.rows(k).find(r=>kinds[k].id(r)===id);if(!row)return null;return Math.round(((row.querySelector('p')??row).getBoundingClientRect().top-kinds[k].pane().getBoundingClientRect().top)*10)/10;},
  button(k,label){return [...kinds[k].pane().querySelectorAll('button')].find(b=>b.textContent.trim()===label&&visible(b));},
  // A plain (not gesture) move, so the room doesn't load a page by itself.
  // The loaded messages' numbers, in order: each page joins the ones on screen without a gap.
  gaps(k){const n=window.__place.rows(k).map(r=>Number((r.querySelector('p')??r).textContent.match(/Place (?:room|dm|reply) (\d+)/)?.[1])).filter(Boolean);const g=[];for(let i=1;i<n.length;i++)if(n[i]!==n[i-1]+1)g.push(n[i-1]+'->'+n[i]);return g;},
  to(k,edge){const pane=kinds[k].pane();pane.scrollTop=edge==='top'?0:pane.scrollHeight;},
 };
 if(outline)document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='[data-place-read]{outline:3px solid #f08c00!important;outline-offset:-3px;border-radius:6px}';document.head.append(s);});
},!!shots);
const kindLabels={room:['Earlier messages','Newer messages'],dm:['Load earlier messages','Load newer messages'],thread:['Earlier replies','Newer replies']};
const moved=[];
const shot=async name=>{if(shots)await p.screenshot({path:`${shots}/${name}.png`});};
// Leaves the bottom with a real wheel gesture (the room then stops following the newest message).
const leaveBottom=async kind=>{const box=await p.evaluate(k=>{const r=window.__place.pane(k).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};},kind);const client=await p.createCDPSession();await client.send('Input.synthesizeScrollGesture',{x:box.x,y:box.y,yDistance:500,speed:2000,gestureSourceType:'mouse'});await client.detach();await pause(900);};
// Presses Earlier or Newer and checks the message being read kept its spot.
async function press(kind,direction,label,{edge=true,image=false,shotName}={}){
 if(edge){await p.evaluate((k,e)=>window.__place.to(k,e),kind,direction==='before'?'top':'bottom');await pause(400);}
 const text=kindLabels[kind][direction==='before'?0:1];
 await p.waitForFunction((k,t)=>{const b=window.__place.button(k,t);return b&&!b.disabled;},{timeout:20000},kind,text);
 const before=await p.evaluate(k=>window.__place.reading(k),kind),ids=await p.evaluate(k=>window.__place.ids(k).join(),kind);
 if(shotName)await shot(shotName+'-1-before');
 await p.evaluate((k,t)=>window.__place.button(k,t).click(),kind,text);
 await p.waitForFunction((k,ids)=>window.__place.ids(k).join()!==ids,{timeout:20000},kind,ids);
 await pause(500);
 if(image){
  // A picture in a row that just loaded above finishes loading and grows.
  await p.evaluate(k=>{const row=window.__place.rows(k)[1];const img=new Image();img.alt='';img.width=240;img.height=1;row.append(img);setTimeout(()=>{img.height=320;},80);},kind);
  await pause(500);
 }
 const after=await p.evaluate((k,id)=>window.__place.at(k,id),kind,before.id);
 if(shotName)await shot(shotName+'-2-after');
 const gaps=await p.evaluate(k=>window.__place.gaps(k),kind);
 assert.deepEqual(gaps,[],label+': the loaded messages run in order without a gap');
 const ok=after!==null&&Math.abs(after-before.offset)<3;
 const line=`${label}: "${before.text.trim()}" ${before.offset}px -> ${after===null?'gone':after+'px'}`;
 if(!ok){moved.push(line);if(!soft)assert.fail(line+' (the message being read moved)');}
 console.log((ok?'held  ':'MOVED ')+line);
}
const signIn=async()=>{await p.setViewport({width:1440,height:1000});await p.goto(base+'/login?next=%2Fchat');await ready('#li-email');await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>{const f=document.querySelector('#li-email')?.form;return f&&Object.keys(f).some(k=>k.startsWith('__reactProps$')&&typeof f[k]?.onSubmit==='function');});await p.type('#li-email',alice.email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await ready('textarea[aria-label="Message LB"]');};
const rowSelector={room:id=>'#chat-message-'+id,dm:id=>`[data-message-id="${id}"]`,thread:id=>`[data-thread-message-id="${id}"]`};
try{
 await signIn();
 for(const [size,viewport] of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844,isMobile:true,hasTouch:true}]]){
  const tag=size==='desktop'?'computer':'phone';
  await p.setViewport(viewport);
  // A. A room opened at its newest message: Earlier messages, pressed again and again.
  await p.goto(base+'/chat?room=main');await ready('textarea[aria-label="Message LB"]');await p.waitForSelector(rowSelector.room(roomRows.at(-1).id));await pause(800);
  await leaveBottom('room');
  await press('room','before',`room ${tag} earlier 1`);
  await press('room','before',`room ${tag} earlier 2`,{shotName:size==='desktop'?'room-computer-earlier':'room-phone-earlier'});
  await press('room','before',`room ${tag} earlier 3 (a picture loads above)`,{image:true});
  // Pressed again without scrolling back up (the reader stays where they are).
  await press('room','before',`room ${tag} earlier 4, not scrolled`,{edge:false});
  // B. A link to an old message opens the room around it: Newer three times, then Earlier.
  await p.goto('about:blank');
  await p.goto(base+'/chat?room=main#chat-message-'+roomRows[60].id);await p.waitForSelector(rowSelector.room(roomRows[60].id),{timeout:30000});await pause(1500);
  await press('room','after',`room ${tag} link, newer 1`,{shotName:size==='desktop'?'room-computer-newer':undefined});
  await press('room','after',`room ${tag} link, newer 2`);
  await press('room','after',`room ${tag} link, newer 3`);
  await press('room','before',`room ${tag} link, earlier`);
  // C. A DM opened at its first unread message: Earlier, Newer, each several times.
  await dmUnread();await p.goto('about:blank');await p.goto(base+'/chat?dm='+conversation.id);await p.waitForSelector(rowSelector.dm(dms[200].id),{timeout:30000});await pause(1200);
  await press('dm','before',`dm ${tag} earlier 1`,{shotName:size==='phone'?'dm-phone-earlier':'dm-computer-earlier'});
  await press('dm','before',`dm ${tag} earlier 2 (a picture loads above)`,{image:true});
  await press('dm','before',`dm ${tag} earlier 3`);
  await press('dm','after',`dm ${tag} newer 1`);
  await press('dm','after',`dm ${tag} newer 2`);
  await press('dm','after',`dm ${tag} newer 3, not scrolled`,{edge:false});
  // D. A link to a reply opens its thread at the reply: Earlier and Newer, each several times.
  await p.goto('about:blank');
  await p.goto(base+'/chat?room=social#chat-message-'+replies[300].id);await p.waitForSelector(rowSelector.thread(replies[300].id),{timeout:30000});await pause(1500);
  await press('thread','before',`thread ${tag} link, earlier 1`,{shotName:size==='desktop'?'thread-computer-earlier':'thread-phone-earlier'});
  await press('thread','before',`thread ${tag} link, earlier 2`);
  await press('thread','after',`thread ${tag} link, newer 1`,{shotName:size==='phone'?'thread-phone-newer':undefined});
  await press('thread','after',`thread ${tag} link, newer 2`);
  await press('thread','after',`thread ${tag} link, newer 3`);
  console.log(`PASS ${tag}: room, DM and thread keep the message being read in place for Earlier and Newer, repeated, after a link and with a late picture.`);
 }
 if(soft&&moved.length)console.log(`SOFT ${moved.length} moved:\n`+moved.join('\n'));
 assert.deepEqual(errors,[]);
}catch(error){console.error('Runtime errors',errors);await p.screenshot({path:'/tmp/chat-load-keeps-place-failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
