// #482 AI Insights, against the fixture on this test's own ports (localhost:3482, database
// 127.0.0.1:54482). Synthetic names and data only; the model is never called (the write-up, the SS
// note and the AI's answer are posted through the database functions the job uses).
//  - an SS member sees AI Insights in the room list, the write-up with its bold headings, no room
//    composer ("Replies only"), and can reply in the thread, where the AI's answer shows;
//  - the server refuses a member's new post (replies_only) and takes a reply, and the reply goes
//    through the answer step once (no model here, so it is marked failed and nothing posts);
//  - the note in SS links into AI Insights, in the app;
//  - an admin has the composer; a member without SS has neither the room nor its messages.
// CHAT_SHOT_DIR saves after-room-list.png, after-thread.png, after-ss-note.png and after-phone.png.
import assert from 'node:assert/strict';

import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3482',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54482';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR;
const sql=async(text,args=[])=>{const r=await fetch(fixture+'/test/sql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql:text,args})}),body=await r.text();assert.equal(r.status,200,body);return JSON.parse(body);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// Neutral names for the pictures. Alice is the admin; Bob and Mallory are members; Bob also has SS.
await sql("update profiles set role='admin' where email='alice@example.test'");
await sql("update profiles set role='user' where email in ('bob@example.test','mallory@example.test')");
await sql(`update longboard_chat_members m set display_name=n.name from (values('alice@example.test','Room Host'),('bob@example.test','Sample Trader'),('mallory@example.test','LB Member')) n(email,name),profiles p where p.email=n.email and m.user_id=p.id`);
const people=await sql(`select p.email,p.id,m.id member from profiles p join longboard_chat_members m on m.user_id=p.id where p.email in ('alice@example.test','bob@example.test','mallory@example.test') order by p.email`);
const [alice,bob,mallory]=people;
await sql(`insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$1,'mastermind') on conflict do nothing`,[bob.id]);
await sql(`insert into chat_shortscout_authorization(subject,decision,membership_level,checked_at,valid_until) values($1,'allow','mastermind',now(),now()+interval '30 days') on conflict(subject) do nothing`,[bob.id]);

// The day in SS: enough member messages, then the write-up and its note, as the job posts them.
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
for(let i=0;i<16;i++)await sql(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,created_at) values($1,$1,'shortscout',$2,$3,now()-interval '3 hours'+$4*interval '1 minute')`,[i%2?bob.member:alice.member,i%2?'Sample Trader':'Room Host',`AIIDemo ${i}: $ZPLX short at $4.55, covered $4.15`,i]);
const WRITEUP=`**AI Insights · Today**
A slow, choppy tape. The room spent the morning on the $ZPLX offering and one clean news short.

**Questions worth a second look**

**"Where do you put a stop on a stock with no chart?"** (Sample Trader, on $ZPLX)
Room Host's answer was the premarket high. One thing to add: a fresh offering has *price memory*. $ZPLX traded between the $4.15 cover and the $4.55 entry all day.

**Highlights**
- Sample Trader's $ZPLX short: in at $4.55, covered at $4.15.

**Stocks that mattered**
$ZPLX · $KORA

**Most valuable trader: Room Host**
Answered most of the room's questions, with levels for every trade.

*Written by AI from today's ShortScout room. Not trading advice.*`;
const post=(await sql(`select post_chat_ai_insights_writeup($1,$2,16,'claude-opus-5-5') r`,[day,WRITEUP]))[0].r;
assert.equal(post.status,'posted',JSON.stringify(post));
const note=(await sql(`select post_chat_ai_insights_note($1,$2) r`,[day,`Today's AI Insights are ready 👉 AI Insights: ${base}/chat?room=ai-insights#chat-message-${post.messageId}`]))[0].r;
assert.equal(note.status,'posted');
// A thread: Sample Trader asks, the AI answers (the answer step's database calls), Room Host adds.
const [question]=await sql(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,'ai-insights','Sample Trader','How do I know the offering price is really support?',$2) returning id`,[bob.member,post.messageId]);
assert.equal((await sql(`select claim_chat_ai_insights_answer($1,20,200) r`,[question.id]))[0].r.status,'answer');
assert.equal((await sql(`select post_chat_ai_insights_answer($1,$2) r`,[question.id,'You know it once buyers defend it more than once. In the room today $ZPLX held $4.15 twice before Sample Trader covered there. A single bounce is a guess; two or three on rising volume is a level.']))[0].r.status,'posted');
await sql(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id,created_at) values($1,$1,'ai-insights','Room Host','Agree. And watch the warrants in that filing.',$2,now()+interval '1 second')`,[alice.member,post.messageId]);

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const visible=(page,selector)=>page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility()),selector);
const shot=async(page,name)=>{if(!shots)return;await sleep(600);await page.evaluate(()=>document.querySelectorAll('nextjs-portal').forEach(e=>e.remove()));await page.screenshot({path:`${shots}/${name}.png`});};
const open=async(email,viewport,room='ai-insights',text='Questions worth a second look',hash='')=>{
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport(viewport);
 await context.setCookie({name:'longboard-chat-theme',value:'light',domain:'localhost',path:'/'});
 await signIn(page,base,email);
 await page.evaluate(()=>localStorage.setItem('longboard-public-chat-theme-v1','light'));
 await page.goto(`${base}/chat?room=${room}${hash}`,{waitUntil:'domcontentloaded'});
 if(text)await page.waitForFunction(text=>[...document.querySelectorAll('article')].some(a=>a.checkVisibility()&&a.innerText.includes(text)),{timeout:90000},text);
 return {context,page,errors};
};
const api=(page,body)=>page.evaluate(async body=>{await new Promise(r=>setTimeout(r,1700));const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({room:'ai-insights',action:'send',clientId:crypto.randomUUID(),...body})});return [r.status,(await r.json()).error??'ok'];},body);
try{
 // 1. An SS member: the room in the list, the write-up, replies only.
 {
  const {context,page,errors}=await open('bob@example.test',desktop);
  assert(await page.evaluate(()=>[...document.querySelectorAll('nav[aria-label="Chat rooms"] a, nav[aria-label="Chat rooms"] button')].some(e=>e.checkVisibility()&&/AI Insights/.test(e.textContent))),'AI Insights is in the room list');
  assert.equal(await visible(page,'textarea[aria-label^="Message "]'),false,'no room composer for a member');
  assert(await page.evaluate(()=>[...document.querySelectorAll('strong')].some(e=>e.checkVisibility()&&e.textContent==='Replies only')),'says replies only');
  assert(await page.evaluate(()=>[...document.querySelectorAll('article strong')].some(e=>e.checkVisibility()&&e.textContent==='Questions worth a second look')),'headings are bold, without stars');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('article')].some(a=>a.checkVisibility()&&a.innerText.includes('**'))),false,'no stray stars');
  await page.waitForFunction(()=>[...document.querySelectorAll('article')].some(a=>a.checkVisibility()&&a.innerText.includes('Questions worth')&&[...a.querySelectorAll('button')].some(b=>/3 replies/i.test(b.textContent))),{timeout:30000});
  await shot(page,'after-room-list');
  // The server: no new post, a reply yes, and the reply goes through the answer step once.
  assert.deepEqual(await api(page,{body:'a new post'}),[403,'replies_only']);
  assert.deepEqual(await api(page,{body:'AI, what about the warrants?',replyTo:post.messageId}),[200,'ok']);
  const [sent]=await sql(`select id from longboard_chat_messages where body='AI, what about the warrants?'`);
  let status;for(let i=0;i<60&&!status;i++){status=(await sql(`select status from chat_ai_insights_answers where trigger_message_id=$1`,[sent.id]))[0]?.status;if(!status)await sleep(500);}
  assert.equal(status,'failed','the answer step ran once (no model here), and posted nothing');
  assert.equal((await sql(`select count(*)::int n from longboard_chat_messages where answered_id=$1`,[sent.id]))[0].n,0);
  await sql(`delete from longboard_chat_messages where id=$1`,[sent.id]);
  // The thread: the question, the AI's answer and the admin's reply; a reply box for the member.
  await page.evaluate(()=>[...document.querySelectorAll('article')].find(a=>a.checkVisibility()&&a.innerText.includes('Questions worth')).querySelector('button[data-has-replies]')?.click());
  await page.waitForFunction(()=>{const p=document.querySelector('aside[aria-label="Comment replies"]');return p&&p.innerText.includes('buyers defend it')&&p.innerText.includes('watch the warrants');},{timeout:30000});
  assert(await visible(page,'aside[aria-label="Comment replies"] textarea'),'members reply in the thread');
  await shot(page,'after-thread');
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // 2. The note in SS links into the room, in the app.
 {
  const {context,page,errors}=await open('bob@example.test',desktop,'shortscout',"Today's AI Insights are ready",`#chat-message-${note.messageId}`);
  await page.evaluate(id=>document.getElementById(`chat-message-${id}`)?.scrollIntoView({block:'center'}),note.messageId);
  const href=await page.evaluate(()=>[...document.querySelectorAll('article a')].find(a=>a.checkVisibility()&&a.textContent==='AI Insights')?.getAttribute('href'));
  assert.equal(href,`/chat?room=ai-insights#chat-message-${post.messageId}`);
  assert(await visible(page,'textarea[aria-label^="Message "]'),'members still post in SS');
  await shot(page,'after-ss-note');
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // 3. On a phone.
 {
  const {context,page,errors}=await open('bob@example.test',phone);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=0,'no sideways scroll');
  await shot(page,'after-phone');
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // 4. An admin has the composer.
 {
  const {context,page,errors}=await open('alice@example.test',desktop);
  assert(await visible(page,'textarea[aria-label^="Message "]'),'an admin has the composer');
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // 5. A member without SS: no room, no messages.
 {
  const {context,page}=await open('mallory@example.test',desktop,'social',null);
  // Like SS, the room shows locked, and leads to the ShortScout sign-in.
  const row=await page.evaluate(()=>[...document.querySelectorAll('nav[aria-label="Chat rooms"] a')].filter(e=>/AI Insights/.test(e.textContent)).map(a=>[a.dataset.locked,a.getAttribute('href')]));
  assert.deepEqual(row.map(r=>r[0]),['true'],'a locked row');
  assert.match(row[0][1],/^\/api\/chat\/login\/start\?(link=1&)?room=ai-insights$/);
  const status=await page.evaluate(async()=>(await fetch('/api/chat?room=ai-insights',{cache:'no-store'})).status);
  assert.equal(status,403,'and the server refuses its messages');
  await context.close();
 }
 assert.equal(mallory.email,'mallory@example.test');
 console.log('chat-ai-insights browser test passed');
}finally{await browser.close();}
