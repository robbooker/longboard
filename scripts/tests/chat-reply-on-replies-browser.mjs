// Ticket D-305 "Reply Button - Add back to Replies": every reply in a conversation has Reply again,
// and the answer stays in the same one list (#301) with a small "replying to <name>" line.
// On desktop 1280 and phone 390 it checks: Reply on every reply (not on a deleted one); Reply on a
// reply names that person in the composer (and × goes back to the original message); the sent reply
// is stored under the original message with answered_id = the reply, shows "replying to <name>"
// and lands at the end of the same list; clicking the label centres the answered reply and marks it
// briefly, also when it is older than the loaded replies; replying to the original message has no
// label; the answered person gets a reply alert in the bell and the sender none (also when they
// answer their own reply); an older flattened conversation and a deleted answered reply display as
// before. CHAT_EXPECT_BASELINE=1 checks the published behaviour (no Reply on replies) instead.
// SCREENS=<dir> saves screenshots to <dir>/before (baseline) or <dir>/after.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3389',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54589';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const baseline=process.env.CHAT_EXPECT_BASELINE==='1',screens=process.env.SCREENS?`${process.env.SCREENS}/${baseline?'before':'after'}`:'';
if(screens)await mkdir(screens,{recursive:true});
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,bob,mallory]}=await control('identity');
const names=new Map([[alice.member.id,'Alice'],[bob.member.id,'Bob'],[mallory.member.id,'Mallory']]);
await sql("delete from longboard_chat_messages where body like 'RR %'");
// Mallory is a Longboard member here too, so all three can write in LB.
await sql("insert into user_tags(user_id,tag) select $1,'boardroom-cohort-1' where not exists(select 1 from user_tags where user_id=$1 and tag='boardroom-cohort-1')",[mallory.id]);
// Seed history predates the send RPC's anti-spam window.
await sql("update longboard_chat_messages set created_at=created_at-interval '1 day' where guest_id=any($1)",[[alice.member.id,bob.member.id,mallory.member.id]]);
let minute=900;
const post=async(person,body,parent=null)=>(await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) values($1,$1,$2,$3,'main',$4,now()-($5||' minutes')::interval) returning *",[person.member.id,names.get(person.member.id),body,parent,String(minute--)]))[0];
// A conversation with replies from three people (Alice reads it).
const top=await post(mallory,'RR top: is the rate cut priced in?');
const r1=await post(alice,'RR Alice thinks it is mostly priced in',top.id);
const r2=await post(bob,'RR Bob says watch the two-year yield',top.id);
const r3=await post(mallory,'RR Mallory agrees with Bob',top.id);
// An older conversation already flattened by #301 (a reply sent to a reply is stored under the
// original by the database), its answered reply far above the latest 100 replies.
const top2=await post(bob,'RR second conversation about earnings');
const early=await post(mallory,'RR Mallory early note, far above',top2.id);
for(let n=0;n<104;n++)await post(bob,'RR filler reply '+n,top2.id);
const late=await post(alice,'RR Alice answers the early note',early.id);
assert.deepEqual([late.reply_to_id,late.answered_id],[top2.id,early.id],'the database files a reply to a reply under the original');
// A third conversation whose answered reply was deleted.
const top3=await post(alice,'RR third conversation');
const gone=await post(bob,'RR soon deleted',top3.id);
const afterGone=await post(mallory,'RR answer to the deleted one',gone.id);
await sql("update longboard_chat_messages set body='Message deleted',deleted_at=now(),revision=revision+1 where id=$1",[gone.id]);
for(let n=0;n<3;n++)await post(bob,'RR later room message '+n);
await sql("insert into chat_room_reads(account_id,room_slug,through_seq) select a,room_slug,max(unread_seq) from longboard_chat_messages,unnest($1::uuid[]) a group by room_slug,a on conflict(account_id,room_slug) do update set through_seq=excluded.through_seq",[[alice.id,bob.id,mallory.id]]);

const browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const page=async()=>{const p=await (await browser.createBrowserContext()).newPage();p.on('pageerror',e=>errors.push(e.message));return p;};
const p=await page();
const shot=async(name,target=p)=>{if(screens)await target.screenshot({path:`${screens}/${name}.png`});};
const panel='aside[aria-label="Comment replies"]';
const visiblePanel=`[...document.querySelectorAll('${panel}')].find(e=>e.checkVisibility())`;
const openThread=async id=>{
 await p.goto(`${base}/chat?room=main&thread=${id}`);
 await p.waitForFunction((panel,id)=>[...document.querySelectorAll(panel+' [aria-label="Original comment"]')].some(e=>e.checkVisibility()&&e.dataset.threadMessageId===id),{timeout:30000},panel,id);
 await p.waitForFunction(panel=>!document.querySelector(panel+' [role="status"]')?.textContent.includes('Loading'),{},panel);
 await pause(400);
};
// What the visible thread shows: each reply's text, its "replying to" line and its Reply control.
const thread=()=>p.evaluate(panel=>{
 const root=[...document.querySelectorAll(panel)].find(e=>e.checkVisibility());
 return [...root.querySelectorAll('[aria-label="Replies to this comment"] article[data-thread-message-id]')].map(a=>({
  id:a.dataset.threadMessageId,body:a.querySelector(':scope > p')?.textContent.trim(),
  label:a.querySelector('[data-replying-to]')?.textContent.replace(/^↳\s*/,'').trim()??null,
  // #318: Reply sits in the reply's top-right actions (on hover); on a phone it is in the ••• menu.
  reply:a.querySelectorAll('button[data-reply-on-reply]').length||a.querySelectorAll('button[data-menu-reply]').length,
 }));
},panel);
const composer=()=>p.evaluate(panel=>{
 const root=[...document.querySelectorAll(panel)].find(e=>e.checkVisibility()),t=root.querySelector('textarea[data-chat-composer]');
 return {chip:root.querySelector('[data-composer-replying-to]')?.textContent.replace(/×/g,'').replace(/\s+/g,' ').trim()??null,placeholder:t?.placeholder,focused:document.activeElement===t};
},panel);
const answer=async id=>{if(p.viewport().isMobile){await clickIn('summary',id);await pause(150);await clickIn('[data-menu-reply]',id);}else await clickIn('button[data-reply-on-reply]',id);};
const clickIn=(selector,id)=>p.evaluate((panel,selector,id)=>{const root=[...document.querySelectorAll(panel)].find(e=>e.checkVisibility());const b=root.querySelector(`[data-thread-message-id="${id}"] ${selector}`);b.click();},panel,selector,id);
const typeAndSend=async text=>{
 const box=await p.evaluateHandle(panel=>[...document.querySelectorAll(panel)].find(e=>e.checkVisibility()).querySelector('textarea[data-chat-composer]'),panel);
 await box.type(text);await p.keyboard.press('Enter');
 const row=await p.waitForFunction((panel,text)=>{const root=[...document.querySelectorAll(panel)].find(e=>e.checkVisibility());return [...root.querySelectorAll('article[data-thread-message-id]')].find(a=>a.querySelector(':scope > p')?.textContent.trim()===text)?.dataset.threadMessageId;},{timeout:30000},panel,text);
 return row.jsonValue();
};
const stored=async id=>(await sql('select reply_to_id,answered_id from longboard_chat_messages where id=$1',[id]))[0];
const alerts=async id=>(await sql("select account_id,category,thread_root_id from chat_room_mentions where message_id=$1 order by account_id",[id]));
// Centred in the pane and marked by the jump highlight.
const highlighted=id=>p.waitForFunction((panel,id)=>{
 const root=[...document.querySelectorAll(panel)].find(e=>e.checkVisibility()),row=root?.querySelector(`[data-thread-message-id="${id}"]`),pane=row?.closest('[class*="replyContents"]');
 if(!row||row.getAttribute('data-jump-highlight')!=='true')return false;
 const r=row.getBoundingClientRect(),v=pane.getBoundingClientRect();return r.top>=v.top-1&&r.bottom<=v.bottom+1;
},{timeout:15000},panel,id);
// Opens the bell and waits for an alert with this text. On a phone the bell sits in the room
// navigation: close a conversation the room opened at, then open the navigation first.
const clickShown=(target,selector)=>target.waitForFunction(selector=>{const e=[...document.querySelectorAll(selector)].find(e=>e.checkVisibility()&&Object.keys(e).some(k=>k.startsWith('__reactProps$')));e?.click();return !!e;},{timeout:30000,polling:300},selector);
const openBell=async(target,text,onPhone)=>{
 if(onPhone){
  await pause(1500);
  if(await target.evaluate(()=>!![...document.querySelectorAll('button[aria-label="Close replies"]')].find(e=>e.checkVisibility())))await clickShown(target,'button[aria-label="Close replies"]');
  await clickShown(target,'button:is([aria-label="Back to all chats"],[aria-label="Open room navigation"])');await pause(400);
 }
 await clickShown(target,'button[aria-label^="Chat notifications,"]');
 await target.waitForFunction(text=>[...document.querySelectorAll('section[aria-label="Chat notifications"]')].some(e=>e.checkVisibility()&&e.textContent.includes(text)),{timeout:30000},text);
 await pause(300);
};
const noOverflow=async()=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal page scroll');

try{
 console.log('Browser',await browser.version());
 await p.setViewport(desktop);await signIn(p,base,alice.email,{composer:'textarea[aria-label="Message LB"]'});
 if(baseline){
  for(const [view,size] of [['desktop-1280',desktop],['phone-390',phone]]){
   await p.setViewport(size);await openThread(top.id);
   const rows=await thread();
   assert.deepEqual(rows.map(r=>r.id),[r1.id,r2.id,r3.id]);
   assert.equal(await p.evaluate(panel=>[...document.querySelectorAll(panel+' article[data-thread-message-id] button')].some(b=>b.checkVisibility()&&/^\s*↳?\s*Reply\s*$/.test(b.textContent)),panel),false,view+': no Reply on any reply');
   await shot(`${view}-1-thread`);
   await openThread(top2.id);
   assert.equal((await thread()).at(-1).label,'replying to Mallory');
   await shot(`${view}-3-label`);
  }
  // Today a reply to a reply can only come from the API (an older app); Bob's bell for it.
  const viaApi=await p.evaluate(async(replyTo)=>{const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'send',room:'main',body:'RR Alice answers Bob through the API',replyTo,clientId:crypto.randomUUID()})});return r.status;},r2.id);
  assert.equal(viaApi,200);
  const bobPage=await page();
  for(const [view,size] of [['desktop-1280',desktop],['phone-390',phone]]){
   await bobPage.setViewport(size);if(view==='desktop-1280')await signIn(bobPage,base,bob.email,{composer:'textarea[aria-label="Message LB"]'});else await bobPage.goto(`${base}/chat`);
   await openBell(bobPage,'RR Alice answers Bob through the API',size===phone);
   await shot(`${view}-5-notification`,bobPage);
  }
  console.log('REPRODUCED published baseline: replies have no Reply button; a reply to a reply (API only) shows "replying to <name>".');
 }else{
  const bobPage=await page();
  await bobPage.setViewport(desktop);await signIn(bobPage,base,bob.email,{composer:'textarea[aria-label="Message LB"]'});
  for(const [view,size] of [['desktop-1280',desktop],['phone-390',phone]]){
   await p.setViewport(size);await openThread(top.id);
   // 1. Reply on every reply.
   let rows=await thread();
   assert.deepEqual(rows.slice(0,3).map(r=>r.id),[r1.id,r2.id,r3.id],view+': the replies');
   assert(rows.every(r=>r.reply===1),view+': every reply has its own Reply');
   // #318: on a computer Reply shows at the top right on hover; on a phone the ••• menu holds it.
   await p.mouse.move(1,1);
   const replyShown=await p.evaluate(panel=>[...document.querySelectorAll(panel+' button[data-reply-on-reply]:not([data-group-reply])')].filter(b=>b.checkVisibility()).length,panel);
   if(view==='phone-390')assert.equal(replyShown,0,'phone: no Reply link under or beside replies');
   else{
    // (Headless Chromium may report no hover; then actions stay shown, as they do in the room.)
    const hidden=await p.evaluate(panel=>{const b=[...document.querySelectorAll(panel+' button[data-reply-on-reply]')].find(b=>b.checkVisibility());return matchMedia('(hover: hover) and (pointer: fine)').matches?getComputedStyle(b.parentElement).opacity:'0';},panel);
    assert.equal(hidden,'0','desktop: Reply waits for hover');
   }
   await noOverflow();await shot(`${view}-1-thread`);
   // 2. Reply on Bob's reply: the composer names Bob; × goes back to the original message.
   const start=await composer();assert.deepEqual([start.chip,start.placeholder],[null,'Reply to Mallory…'],view+': the composer replies to the original message');
   await answer(r2.id);
   await p.waitForFunction(panel=>!![...document.querySelectorAll(panel)].find(e=>e.checkVisibility())?.querySelector('[data-composer-replying-to]'),{},panel);
   assert.deepEqual(await composer(),{chip:'↳ Replying to Bob',placeholder:'Reply to Bob…',focused:true},view+': composer replying to Bob');
   await p.evaluate(panel=>[...document.querySelectorAll(panel)].find(e=>e.checkVisibility()).querySelector('[data-composer-replying-to] button').click(),panel);
   assert.deepEqual(await composer(),{chip:null,placeholder:'Reply to Mallory…',focused:true},view+': × goes back to the original message');
   await answer(r2.id);await pause(200);
   await noOverflow();await shot(`${view}-2-composer`);
   // 3. Send: same level, with the label, at the end of the one list; Bob is alerted, Alice is not.
   const text=`RR Alice answers Bob on ${view}`;
   const sent=await typeAndSend(text);
   assert.deepEqual(await stored(sent),{reply_to_id:top.id,answered_id:r2.id},view+': stored under the original, answering Bob');
   rows=await thread();
   // In the same one list (its place is by time; the fixture's clock strings can differ in zone).
   assert.deepEqual(rows.find(r=>r.id===sent),{id:sent,body:text,label:'replying to Bob',reply:1},view+': the posted reply');
   assert.equal(rows.length,new Set(rows.map(r=>r.id)).size);
   assert.equal((await composer()).chip,null,view+': the composer is back on the original message');
   const sentAlerts=await alerts(sent);
   assert.deepEqual(sentAlerts.map(a=>a.account_id).sort(),[bob.id,mallory.id].sort(),view+': Bob (answered) and Mallory (original) get one alert each, Alice none');
   assert(sentAlerts.every(a=>a.category==='reply'&&a.thread_root_id===top.id));
   await p.evaluate((panel,id)=>[...document.querySelectorAll(panel)].find(e=>e.checkVisibility()).querySelector(`[data-thread-message-id="${id}"]`).scrollIntoView({block:'center'}),panel,sent);await pause(200);
   await noOverflow();await shot(`${view}-3-posted`);
   // 4. The label jumps to Bob's reply and marks it.
   await p.evaluate(panel=>{const root=[...document.querySelectorAll(panel)].find(e=>e.checkVisibility());root.querySelector('[class*="replyContents"]').scrollTop=1e6;},panel);
   await clickIn('button[data-replying-to]',sent);
   await highlighted(r2.id);await shot(`${view}-4-highlight`);
   await pause(3000);
   assert.equal(await p.evaluate((panel,id)=>[...document.querySelectorAll(panel)].find(e=>e.checkVisibility()).querySelector(`[data-thread-message-id="${id}"]`).hasAttribute('data-jump-highlight'),panel,r2.id),false,view+': the mark fades');
   // 5. Replying to the original message: no label, no answered_id.
   const plain=`RR Alice replies to the original on ${view}`;
   const plainId=await typeAndSend(plain);
   assert.deepEqual(await stored(plainId),{reply_to_id:top.id,answered_id:null});
   assert.equal((await thread()).find(r=>r.id===plainId).label,null,view+': no label on a reply to the original');
   // 6. Alice answers her own reply: she gets no alert.
   await pause(1700);
   await answer(r1.id);
   assert.equal((await composer()).chip,'↳ Replying to Alice');
   const own=await typeAndSend(`RR Alice adds to her own reply on ${view}`);
   assert.deepEqual(await stored(own),{reply_to_id:top.id,answered_id:r1.id});
   assert.equal((await thread()).find(r=>r.id===own).label,'replying to Alice');
   assert.equal((await alerts(own)).some(a=>a.account_id===alice.id),false,view+': no alert for answering yourself');
   // 7. The bell: Bob sees the reply alert.
   await bobPage.setViewport(size);await bobPage.goto(size===phone?`${base}/chat`:`${base}/chat?room=main`);
   await openBell(bobPage,text,size===phone);
   const bell=await bobPage.evaluate(text=>[...[...document.querySelectorAll('section[aria-label="Chat notifications"]')].find(e=>e.checkVisibility()).querySelectorAll('article')].find(a=>a.textContent.includes(text))?.textContent.replace(/\s+/g,' '),text);
   assert.match(bell,/Alice – replied/,view+': Bob\'s bell shows Alice replied');
   assert.equal(await bobPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await shot(`${view}-5-notification`,bobPage);
   await bobPage.keyboard.press('Escape');
   // 8. An older flattened conversation: the label of the latest reply loads the far-above reply.
   await openThread(top2.id);
   rows=await thread();
   assert.equal(rows.at(-1).label,'replying to Mallory');assert.equal(rows.some(r=>r.id===early.id),false,view+': the answered reply is not loaded yet');
   await clickIn('button[data-replying-to]',late.id);
   await highlighted(early.id);
   await shot(`${view}-6-highlight-older`);
   // 9. A deleted answered reply: the label says so and does nothing; the deleted reply has no Reply.
   await openThread(top3.id);
   rows=await thread();
   assert.deepEqual(rows.map(r=>[r.id,r.label,r.reply]),[[gone.id,null,0],[afterGone.id,'replying to a deleted message',1]],view+': deleted');
   assert.equal(await p.evaluate((panel,id)=>[...document.querySelectorAll(panel)].find(e=>e.checkVisibility()).querySelector(`[data-thread-message-id="${id}"] button[data-replying-to]`).disabled,panel,afterGone.id),true);
   console.log(`PASS ${view}: Reply on every reply; composer names the answered person; same level with "replying to Bob"; label jumps and marks (also a reply above the loaded ones); original-message reply unchanged; Bob alerted in the bell, no self alert; deleted target labelled.`);
   await pause(1700);
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS zero browser runtime errors.');
}catch(error){await p.screenshot({path:'/tmp/chat-reply-on-replies-failure.png'}).catch(()=>{});console.error(await p.evaluate(()=>document.body.innerText.slice(-1500)).catch(()=>''));throw error;}finally{await browser.close();}
