// Ticket #331 "Spacing in Replies with multiple entries": a run of messages from one person has one
// Reply and one reaction button by the name, acting on the most recent message; later messages use
// the full width; an earlier message can still be answered or reacted to from its ••• menu.
// Checks the room, a thread and a DM (DMs have reactions but no Reply) on desktop 1280 and phone 390.
// CHAT_EXPECT_BASELINE=1 only takes the "before" screenshots. SCREENS=<dir> saves
// <before|after>-<thread|room|dm>-<desktop|phone>.png.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3396',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54596';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const baseline=process.env.CHAT_EXPECT_BASELINE==='1',screens=process.env.SCREENS||'',prefix=baseline?'before':'after';
if(screens)await mkdir(screens,{recursive:true});
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,bob,mallory]}=await control('identity');
const names=new Map([[alice.member.id,'Alice'],[bob.member.id,'Bob'],[mallory.member.id,'Mallory']]);
const LONG=' with enough words in it to run right across the whole width of the column so a squeezed line would wrap early and show the problem clearly.';
await sql("delete from longboard_chat_messages where body like 'GA %'");
// Mallory is a Longboard member here too, so all three can write in LB.
await sql("insert into user_tags(user_id,tag) select $1,'boardroom-cohort-1' where not exists(select 1 from user_tags where user_id=$1 and tag='boardroom-cohort-1')",[mallory.id]);
await sql("update longboard_chat_messages set created_at=created_at-interval '1 day' where guest_id=any($1)",[[alice.member.id,bob.member.id,mallory.member.id]]);
const post=async(person,body,minutes,parent=null)=>(await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) values($1,$1,$2,$3,'main',$4,now()-($5||' seconds')::interval) returning *",[person.member.id,names.get(person.member.id),body,parent,String(Math.round(minutes*60))]))[0];
const top=await post(mallory,'GA top: is the rate cut priced in?',30);
const t1=await post(bob,'GA thread first'+LONG,25,top.id),t2=await post(bob,'GA thread second'+LONG,24,top.id),t3=await post(bob,'GA thread third'+LONG,23,top.id);
const r1=await post(bob,'GA room first'+LONG,12),r2=await post(bob,'GA room second'+LONG,11),r3=await post(bob,'GA room third'+LONG,10);
const [conversation]=await sql("insert into longboard_chat_conversations(requester_id,recipient_id,status) values($1,$2,'accepted') on conflict do nothing returning *",[bob.member.id,alice.member.id]);
const conversationId=conversation?.id??(await sql('select id from longboard_chat_conversations where least(requester_id,recipient_id)=least($1::uuid,$2::uuid) and greatest(requester_id,recipient_id)=greatest($1::uuid,$2::uuid)',[bob.member.id,alice.member.id]))[0].id;
await sql("update longboard_chat_conversations set status='accepted' where id=$1",[conversationId]);
const dm=async(body,minutes)=>(await sql("insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body,created_at) values($1,$2,gen_random_uuid(),$3,now()-($4||' seconds')::interval) returning *",[conversationId,bob.member.id,body,String(minutes*60)]))[0];
const d1=await dm('GA dm first'+LONG,5),d2=await dm('GA dm second'+LONG,4),d3=await dm('GA dm third'+LONG,3);

const errors=[];
// Real computer hover and pointer for desktop; the phone run uses the default with touch emulation.
const HOVER=['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'];
let browser,p;
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const start=async size=>{await browser?.close();browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox',...(size===desktop?HOVER:[])]});p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport(size);await signIn(p,base,alice.email,{composer:'textarea[aria-label="Message LB"]'});};
const panel='aside[aria-label="Comment replies"]';
const roomRow=id=>`#chat-message-${id}`,threadRow=id=>`[data-thread-message-id="${id}"]`,dmRow=id=>`[data-message-id="${id}"]`;
const shot=async name=>{if(screens)await p.screenshot({path:`${screens}/${prefix}-${name}.png`});};
const view=()=>p.viewport().isMobile?'phone':'desktop';
const sel=async(selector,fn)=>{await p.waitForFunction(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility()),{timeout:30000},selector);return p.evaluate((s,fn)=>{const e=[...document.querySelectorAll(s)].find(e=>e.checkVisibility());return new Function('e','return ('+fn+')(e)')(e);},selector,fn);};
const click=selector=>sel(selector,'e=>{e.click()}');
const openRoom=async()=>{await p.goto(`${base}/chat?room=main`);await p.waitForSelector(roomRow(r3.id),{visible:true,timeout:60000});await pause(500);};
const openThread=async()=>{await p.goto(`${base}/chat?room=main&thread=${top.id}`);await p.waitForFunction(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility()),{timeout:60000},`${panel} ${threadRow(t3.id)}`);await pause(500);};
const openDm=async()=>{await p.goto(`${base}/chat?room=main`);await p.waitForFunction(()=>[...document.querySelectorAll('aside[aria-label="Private conversations"] button')].some(e=>e.textContent.includes('Bob')),{timeout:60000});await p.evaluate(()=>[...document.querySelectorAll('aside[aria-label="Private conversations"] button')].find(e=>e.textContent.includes('Bob')).click());await p.waitForSelector(dmRow(d3.id),{visible:true,timeout:30000});await pause(500);};
const reveal=async selector=>{await p.$eval(selector,e=>e.scrollIntoView({block:'center'}));await pause(100);};
const hover=async selector=>{if(view()==='desktop'){const h=await p.$(selector);await h.hover();await pause(200);}};
const reacted=(id,emoji='heart',want=true)=>p.waitForFunction((id,emoji,want)=>[...document.querySelectorAll(`[data-reaction-message="${id}"] button[aria-label^="Remove ${emoji}"]`)].some(e=>e.checkVisibility())===want,{timeout:15000},id,emoji,want);
// One group's layout: buttons only on the first, later text as wide as the row and aligned.
const checkLayout=async(rows,bodySelector,hasReply)=>{
 const shape=await p.evaluate((rows,bodySelector)=>rows.map(s=>{const a=document.querySelector(s),b=a.querySelector(bodySelector),r=b.getBoundingClientRect(),art=a.getBoundingClientRect();return {replies:a.querySelectorAll('[data-group-reply]').length,add:a.querySelectorAll('[aria-label="Add reaction"]').length,left:r.left,right:r.right,articleRight:art.right-parseFloat(getComputedStyle(a).paddingRight),continued:a.hasAttribute('data-continued')};}),rows,bodySelector);
 assert.deepEqual(shape.map(s=>s.continued),[false,true,true]);
 assert.deepEqual(shape.map(s=>s.add),[1,0,0],'one reaction button');
 assert.deepEqual(shape.map(s=>s.replies),[hasReply?1:0,0,0],'one Reply button');
 for(const s of shape.slice(1)){assert.ok(Math.abs(s.left-shape[0].left)<1,'aligned '+JSON.stringify(shape));assert.ok(Math.abs(s.right-s.articleRight)<=1,'full width '+JSON.stringify(shape));}
 // The first row's Reply is really visible on phones too.
 if(hasReply)assert.equal(await p.$eval(`${rows[0]} [data-group-reply]`,e=>e.checkVisibility()),true);
};
const checkHiddenUntilAsked=async(row,meta)=>{
 const state=()=>p.$eval(`${row} ${meta}`,e=>({opacity:getComputedStyle(e).opacity,events:getComputedStyle(e).pointerEvents}));
 await p.mouse.move(0,0);await pause(250);
 assert.deepEqual(await state(),{opacity:'0',events:'none'},'later message actions wait');
 if(view()==='desktop'){await hover(row);}else{await p.$eval(row,e=>e.scrollIntoView({block:'center'}));await pause(500);const box=await (await p.$(`${row} p`)).boundingBox();await p.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await pause(250);}
 assert.equal((await state()).opacity,'1','••• appears');
};
try{
 await start(desktop);
 await p.evaluate(async(id)=>{await fetch('/api/chat/message-reactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'room',room:'main',messageId:id,action:'set',emoji:'laugh',active:true})});},r1.id);
 await p.evaluate(async(id)=>{await fetch('/api/chat/message-reactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'room',room:'main',messageId:id,action:'set',emoji:'laugh',active:true})});},t1.id);
 for(const size of [desktop,phone]){
  if(size===phone)await start(phone);const name=view();
  await openThread();await reveal(threadRow(t1.id));await hover(`${panel} ${threadRow(t1.id)}`);await shot(`thread-${name}`);
  await openRoom();await reveal(roomRow(r1.id));await hover(roomRow(r1.id));await shot(`room-${name}`);
  await openDm();await reveal(dmRow(d1.id));await hover(dmRow(d1.id));await shot(`dm-${name}`);
 }
 if(baseline){console.log('PASS baseline screenshots taken.');await browser.close();process.exit(0);}
 for(const size of [desktop,phone]){
  await start(size);const name=view();
  // ROOM
  await openRoom();await reveal(roomRow(r1.id));
  await checkLayout([r1,r2,r3].map(m=>roomRow(m.id)),'[class*="bodyBlock"]',true);
  await reacted(r1.id,'laugh');
  await checkHiddenUntilAsked(roomRow(r2.id),'[class*="messageMeta"]');
  // Reaction lands on the most recent message; the first keeps its own.
  await hover(roomRow(r1.id));await click(`${roomRow(r1.id)} [aria-label="Add reaction"]`);await click('dialog[open] button[aria-label="heart reaction"]');await reacted(r3.id);await reacted(r1.id,'laugh');
  await p.$eval(`[data-reaction-message="${r3.id}"] button[aria-label^="Remove heart"]`,e=>e.click());await reacted(r3.id,'heart',false);
  // A new message moves the target; deleting it moves the target back.
  const r4=await post(bob,'GA room fourth',9);
  await p.evaluate(()=>window.dispatchEvent(new Event('chat-room-refresh')));await p.waitForSelector(roomRow(r4.id),{timeout:15000});
  await p.waitForSelector(`${roomRow(r1.id)} [data-reaction-group-target="${r4.id}"]`,{timeout:15000});
  await sql("update longboard_chat_messages set body='Message deleted',deleted_at=now(),revision=revision+1 where id=$1",[r4.id]);
  await p.evaluate(()=>window.dispatchEvent(new Event('chat-room-refresh')));
  await p.waitForSelector(`${roomRow(r1.id)} [data-reaction-group-target="${r3.id}"]`,{timeout:15000});
  await sql('delete from longboard_chat_messages where id=$1',[r4.id]);
  // An earlier message, from its own menu: reaction, then reply.
  await openRoom();await reveal(roomRow(r2.id));await hover(roomRow(r2.id));
  await p.$eval(`${roomRow(r2.id)} summary`,e=>e.click());await pause(150);
  await click(`${roomRow(r2.id)} [data-menu-react]`);await click('dialog[open] button[aria-label="heart reaction"]');await reacted(r2.id);
  await p.$eval(`[data-reaction-message="${r2.id}"] button[aria-label^="Remove heart"]`,e=>e.click());await reacted(r2.id,'heart',false);
  await p.$eval(`${roomRow(r2.id)} summary`,e=>e.click());await pause(150);await click(`${roomRow(r2.id)} [data-menu-reply]`);
  await p.waitForFunction((panel,id)=>[...document.querySelectorAll(panel+' [aria-label="Original comment"]')].some(e=>e.checkVisibility()&&e.dataset.threadMessageId===id),{timeout:30000},panel,r2.id);
  await p.keyboard.press('Escape');await pause(400);
  // Reply by the name opens the most recent message's conversation.
  await openRoom();await reveal(roomRow(r1.id));await hover(roomRow(r1.id));await click(`${roomRow(r1.id)} [data-group-reply]`);
  await p.waitForFunction((panel,id)=>[...document.querySelectorAll(panel+' [aria-label="Original comment"]')].some(e=>e.checkVisibility()&&e.dataset.threadMessageId===id),{timeout:30000},panel,r3.id);
  console.log(`PASS room ${name}.`);
  // THREAD
  await openThread();const rows=[t1,t2,t3].map(m=>`${panel} ${threadRow(m.id)}`);await reveal(rows[0]);
  await checkLayout(rows,':scope > p',true);
  await reacted(t1.id,'laugh');
  await checkHiddenUntilAsked(rows[1],'[class*="replyMeta"]');
  await hover(rows[0]);await click(`${rows[0]} [aria-label="Add reaction"]`);await click('dialog[open] button[aria-label="heart reaction"]');await reacted(t3.id);await reacted(t1.id,'laugh');
  await p.$eval(`${panel} [data-reaction-message="${t3.id}"] button[aria-label^="Remove heart"]`,e=>e.click());await reacted(t3.id,'heart',false);
  await hover(rows[0]);await click(`${rows[0]} [data-group-reply]`);await pause(100);
  assert.equal(await p.$eval(`${rows[0]} [data-group-reply]`,e=>e.getAttribute('aria-pressed')),'true');
  await hover(rows[1]);await p.$eval(`${rows[1]} summary`,e=>e.click());await pause(150);await click(`${rows[1]} [data-menu-reply]`);await pause(100);
  assert.equal(await p.$eval(`${rows[0]} [data-group-reply]`,e=>e.getAttribute('aria-pressed')),'false','the menu answers that reply, not the newest');
  await hover(rows[0]);await click(`${rows[0]} [data-group-reply]`);
  const box=await p.evaluateHandle(panel=>[...document.querySelectorAll(panel)].find(e=>e.checkVisibility()).querySelector('textarea[data-chat-composer]'),panel);
  await box.type('GA answer '+name);await p.keyboard.press('Enter');await pause(1500);
  const [sent]=await sql('select answered_id from longboard_chat_messages where body=$1',['GA answer '+name]);assert.equal(sent?.answered_id,t3.id,'Reply attaches to the most recent reply');
  await sql('delete from longboard_chat_messages where body=$1',['GA answer '+name]);
  console.log(`PASS thread ${name}.`);
  // DM (reactions only: DMs have no Reply)
  await openDm();const dms=[d1,d2,d3].map(m=>dmRow(m.id));await reveal(dms[0]);
  await checkLayout(dms,'[class*="messageBody"]',false);
  await checkHiddenUntilAsked(dms[1],'[class*="headerActions"]');
  await hover(dms[0]);await click(`${dms[0]} [aria-label="Add reaction"]`);await click('dialog[open] button[aria-label="heart reaction"]');await reacted(d3.id);
  await p.$eval(`[data-reaction-message="${d3.id}"] button[aria-label^="Remove heart"]`,e=>e.click());await reacted(d3.id,'heart',false);
  await reveal(dms[1]);await hover(dms[1]);await p.$eval(`${dms[1]} summary`,e=>e.click());await pause(150);await click(`${dms[1]} [data-menu-react]`);await click('dialog[open] button[aria-label="heart reaction"]');await reacted(d2.id);
  await p.$eval(`[data-reaction-message="${d2.id}"] button[aria-label^="Remove heart"]`,e=>e.click());await reacted(d2.id,'heart',false);
  console.log(`PASS dm ${name}.`);
 }
 assert.deepEqual(errors,[]);console.log('PASS zero browser runtime errors.');
}catch(error){await p?.screenshot({path:'/tmp/chat-grouped-actions-failure.png'}).catch(()=>{});throw error;}finally{await browser?.close();}
