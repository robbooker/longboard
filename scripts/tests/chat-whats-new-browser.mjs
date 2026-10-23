// Ticket #302 "Software Update List for Users - Read-Only": the What's New room, on desktop 1280
// and phone 390, against the synthetic fixture (localhost:3302, database 127.0.0.1:54302).
//  - a regular member (Mallory: no Boardroom, never joined anything) sees What's New in the room
//    list, its exact description stays put above the scrolling list in at most two lines, the
//    welcome post is the first message, there is no composer, Reply or thread, and reacting works;
//  - a deploy with one user-visible PR and one behind-the-scenes PR posts one dated note from
//    "Booker Chat Updates" through the real collection script and route (a rerun posts nothing),
//    the room shows unread until opened, and nobody gets a bell alert;
//  - an admin posts, edits and deletes by hand, and can edit the automatic note;
//  - a brand-new account is already in the room's member list.
// SCREENS=<dir> saves desktop + phone, light + dark screenshots to <dir>/after.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
import {collectChanges,postChanges} from '../whats-new/post-whats-new.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3302',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54302';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const screens=process.env.SCREENS?`${process.env.SCREENS}/after`:'';
if(screens)await mkdir(screens,{recursive:true});
const token='synthetic-whats-new-token-never-a-production-secret';
const DESCRIPTION="Chat Improvements... What's new? Real time updates as they go live.";
const WELCOME='30200000-0000-4000-8000-000000000302';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,,mallory]}=await control('identity');
// This fixture chain demotes Alice; What's New needs an admin.
await sql("update profiles set role='admin' where id=$1",[alice.id]);
const stamp=Date.now();

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const page=async()=>{const p=await (await browser.createBrowserContext()).newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(60000);return p;};
const api=(p,path,body)=>p.evaluate(async({path,body})=>{const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json().catch(()=>null)};},{path,body});
const theme=(p,value)=>p.evaluate(value=>localStorage.setItem('longboard-public-chat-theme-v1',value),value);
const settled=p=>p.waitForFunction(()=>[...document.querySelectorAll('article[id^="chat-message-"]')].some(e=>e.checkVisibility()),{timeout:60000});
const openRoom=async p=>{await p.goto(`${base}/chat?room=whats-new`);await p.waitForSelector('[data-room-description]',{visible:true});await settled(p);await pause(500);};
const navLink='a[href^="/chat?room=whats-new"]';
const visibleLink=p=>p.evaluate(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility()&&e.textContent.includes("What's New")&&!e.dataset.locked),navLink);
const unreadFlag=p=>p.evaluate(sel=>[...document.querySelectorAll(sel)].some(e=>e.dataset.unread==='true'),navLink);
// The phone's list of rooms and DMs (the back arrow from a room).
const phoneList=async p=>{await p.goto(`${base}/chat`);await p.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility()),{timeout:60000},'button[aria-label="Back to all chats"],'+navLink);
 const back=await p.$('button[aria-label="Back to all chats"]');if(back&&await back.evaluate(e=>e.checkVisibility()))await back.click();
 await p.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility()),{timeout:30000},navLink);await pause(600);};
async function pick(p,id,emoji){
 const scope=`[data-reaction-message="${id}"]`;await p.waitForSelector(scope);
 await p.evaluate(scope=>document.querySelector(scope).closest('article').querySelector('[data-dm-reaction-host] > button').click(),scope);
 await p.waitForSelector('dialog[open]');await p.click(`dialog[open] button[aria-label="${emoji} reaction"]`);
 await p.waitForSelector('dialog[open]',{hidden:true});await p.waitForSelector(`${scope} button[aria-label^="Remove ${emoji}"]`);
}
// The description: exact text, outside the scrolling list, two lines at most, and it stays put.
async function checkDescription(p,view){
 const d=await p.evaluate(()=>{const e=[...document.querySelectorAll('[data-room-description]')].find(e=>e.checkVisibility());const s=getComputedStyle(e);
  return {text:e.textContent,height:e.getBoundingClientRect().height,line:parseFloat(s.lineHeight)||parseFloat(s.fontSize)*1.4,pad:parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+parseFloat(s.borderBottomWidth),insideList:!!e.closest('[role="log"]')};});
 assert.equal(d.text,DESCRIPTION,view+': exact description');
 assert.equal(d.insideList,false,view+': description is not part of the scrolling list');
 assert(d.height<=d.line*2+d.pad+1,`${view}: description is at most two lines (${d.height}px)`);
 const top=()=>p.evaluate(()=>[...document.querySelectorAll('[data-room-description]')].find(e=>e.checkVisibility()).getBoundingClientRect().top);
 const before=await top();
 await p.evaluate(()=>{const l=[...document.querySelectorAll('[role="log"]')].find(e=>e.checkVisibility());l.scrollTop=0;l.dispatchEvent(new Event('scroll'));});await pause(300);
 assert.equal(await top(),before,view+': description stays in place while the list scrolls');
}
// A member: no composer, no Reply anywhere, no thread; the read-only footer explains.
async function checkReadOnly(p,view){
 assert.equal(await p.evaluate(()=>[...document.querySelectorAll('textarea[aria-label^="Message "]')].some(e=>e.checkVisibility())),false,view+': no message box');
 assert.equal(await p.evaluate(()=>[...document.querySelectorAll('article[id^="chat-message-"] button')].some(b=>b.checkVisibility()&&(b.hasAttribute('data-has-replies')||b.hasAttribute('data-menu-reply')))),false,view+': no Reply');
 assert.match(await p.evaluate(()=>document.body.innerText),/Only admins can post/,view+': read-only footer');
}
const firstMessage=p=>p.evaluate(()=>{const a=[...document.querySelectorAll('article[id^="chat-message-"]')].find(e=>e.checkVisibility());return {id:a.id.replace('chat-message-',''),text:a.textContent,time:a.querySelector('time')?.getAttribute('datetime')};});
const shot=async(p,name)=>{if(screens)await p.screenshot({path:`${screens}/${name}.png`});};

try{
 console.log('Browser',await browser.version());
 const member=await page();await member.setViewport(desktop);
 await signIn(member,base,mallory.email,{next:'/chat?room=social',composer:'textarea[aria-label="Message Social"]'});
 // 1. In the room list without joining, unread (the welcome post), on desktop and phone.
 assert(await visibleLink(member),'desktop: What\'s New in the room list');
 await member.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.dataset.unread==='true'),{timeout:30000},navLink);
 await member.setViewport(phone);await phoneList(member);
 assert(await visibleLink(member),'phone: What\'s New in the room list');
 for(const mode of ['light','dark']){await theme(member,mode);await phoneList(member);await shot(member,`phone-390-${mode}-1-room-list`);}
 await member.setViewport(desktop);await theme(member,'light');await member.goto(`${base}/chat?room=social`);await member.waitForSelector(navLink,{visible:true});await pause(600);
 for(const mode of ['light','dark']){await theme(member,mode);await member.reload();await member.waitForSelector(navLink,{visible:true});await pause(600);await shot(member,`desktop-1280-${mode}-1-room-list`);}
 await theme(member,'light');

 // 2. The room as a member: description, welcome first, read-only, reactions.
 for(const [view,size] of [['desktop-1280',desktop],['phone-390',phone]]){
  await member.setViewport(size);await openRoom(member);
  await checkDescription(member,view);await checkReadOnly(member,view);
  const first=await firstMessage(member);
  assert.equal(first.id,WELCOME,view+': the welcome post is the first message');
  assert.match(first.text,/Booker Chat Updates/);assert.match(first.text,/Welcome to What.s New/);assert(first.time,view+': dated');
  if(view==='desktop-1280'){
   assert.equal((await api(member,'/api/chat',{action:'send',room:'whats-new',body:'member post'})).status,403,'member cannot post');
   assert.equal((await api(member,'/api/chat',{action:'send',room:'whats-new',body:'member reply',replyTo:WELCOME})).status,403,'member cannot reply');
   assert.equal((await api(member,`/api/chat/thread?room=whats-new&messageId=${WELCOME}`)).status,403,'no threads');
   await pick(member,WELCOME,'like');
   await member.reload();await settled(member);await member.waitForSelector(`[data-reaction-message="${WELCOME}"] button[aria-label^="Remove like"]`);
  }else await pick(member,WELCOME,'rob');
  assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+': no horizontal page scroll');
  for(const mode of ['light','dark']){await theme(member,mode);await openRoom(member);await shot(member,`${view}-${mode}-2-room`);}
  await theme(member,'light');
 }
 // Opened, so read.
 await member.setViewport(desktop);await member.goto(`${base}/chat?room=social`);await member.waitForSelector(navLink,{visible:true});
 await member.waitForFunction(sel=>![...document.querySelectorAll(sel)].some(e=>e.dataset.unread==='true'),{timeout:30000},navLink);

 // 3. A deploy goes live: one user-visible PR and one behind-the-scenes PR, through the real
 // collection script and route. One dated note by Booker Chat Updates; a rerun posts nothing.
 const sha=stamp.toString(16).padStart(40,'0').slice(-40),prA=900000+stamp%90000,prB=prA+1;
 const note=`You can now see what changed in chat, right here (${stamp}).`;
 const github=async path=>path.startsWith('commits')?[{sha:'merge-a'},{sha:'merge-b'}]:[
  {number:prA,merged_at:new Date().toISOString(),updated_at:new Date().toISOString(),merge_commit_sha:'merge-a',body:`Adds a thing.\n\nWhat's New: ${note}`},
  {number:prB,merged_at:new Date().toISOString(),updated_at:new Date().toISOString(),merge_commit_sha:'merge-b',body:'Refactor the tests, nothing members would notice.'}];
 const {changes,skipped}=await collectChanges({github,sha});
 assert.deepEqual(changes.map(c=>c.pr),[prA]);assert.deepEqual(skipped,[prB],'behind-the-scenes PR skipped');
 await assert.rejects(postChanges({url:`${base}/api/chat/whats-new`,token:'wrong-token-wrong-token-wrong-token',sha,changes}),/401/,'a bad token is rejected');
 const posted=await postChanges({url:`${base}/api/chat/whats-new`,token,sha,changes});
 assert.equal(posted.posted,true,JSON.stringify(posted));assert.equal(posted.body,note);
 assert.equal((await postChanges({url:`${base}/api/chat/whats-new`,token,sha,changes})).posted,false,'a rerun posts nothing');
 const [row]=await sql("select author_label,bot_slug,body from longboard_chat_messages where id=$1",[posted.messageId]);
 assert.deepEqual(row,{author_label:'Booker Chat Updates',bot_slug:'whats-new',body:note});
 assert.equal((await sql("select count(*)::int n from longboard_chat_messages where room_slug='whats-new' and body like 'Refactor%'"))[0].n,0);
 // Unread in the room list until opened; no bell alert.
 await member.reload();await member.waitForSelector(navLink,{visible:true});
 await member.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.dataset.unread==='true'),{timeout:30000},navLink);
 const activity=await api(member,'/api/chat/activity?why=test');
 assert(!activity.data.mentions.some(n=>n.room==='whats-new'),'no bell alert for What\'s New');
 assert.equal((await sql("select count(*)::int n from chat_room_mentions where message_id=$1",[posted.messageId]))[0].n,0,'no alert rows');
 assert.equal((await sql("select count(*)::int n from chat_push_jobs where source_id=$1",[posted.messageId]).catch(()=>[{n:0}]))[0].n,0,'no push');
 await openRoom(member);
 await member.waitForSelector(`#chat-message-${posted.messageId}`);
 const auto=await member.evaluate(id=>{const a=document.getElementById('chat-message-'+id);return {text:a.textContent,time:a.querySelector('time')?.getAttribute('datetime')};},posted.messageId);
 assert.match(auto.text,/Booker Chat Updates/);assert(auto.text.includes(note));assert(auto.time,'the automatic note is dated');
 await shot(member,'desktop-1280-light-3-automatic-note');
 await member.goto(`${base}/chat?room=social`);await member.waitForSelector(navLink,{visible:true});
 assert.equal(await unreadFlag(member),false,'read after opening');

 // 4. An admin posts, edits and deletes by hand, and can edit the automatic note.
 const admin=await page();await admin.setViewport(desktop);
 await signIn(admin,base,alice.email,{next:'/chat?room=whats-new',composer:'textarea[aria-label="Message What\'s New"]'});
 await checkDescription(admin,'admin desktop');
 const hand=`Admin note by hand ${stamp}`;
 await admin.type('textarea[aria-label="Message What\'s New"]',hand);await admin.click('button[type="submit"][data-state]');
 await admin.waitForFunction(body=>[...document.querySelectorAll('article')].some(e=>e.textContent.includes(body)&&!e.dataset.pending),{},hand);
 const handId=await admin.evaluate(body=>[...document.querySelectorAll('article[id^="chat-message-"]')].find(e=>e.textContent.includes(body)).id.replace('chat-message-',''),hand);
 assert.equal(await admin.$(`#chat-message-${handId} button[data-has-replies]`),null,'no Reply for the admin either');
 assert.equal((await api(admin,'/api/chat',{action:'send',room:'whats-new',body:'admin reply',replyTo:handId})).status,403,'no replies at all');
 // The automatic note's menu offers Edit and Delete to the admin.
 await admin.evaluate(id=>document.querySelector(`#chat-message-${id} details summary`).click(),posted.messageId);await pause(200);
 const menu=await admin.evaluate(id=>[...document.querySelectorAll(`#chat-message-${id} details[open] button`)].map(b=>b.textContent.trim()),posted.messageId);
 assert(menu.includes('Edit')&&menu.some(t=>t.startsWith('Delete')),'admin menu on the automatic note: '+menu.join(', '));
 await admin.evaluate(id=>{const d=document.querySelector(`#chat-message-${id} details[open]`);if(d)d.open=false;},posted.messageId);
 const edited=await api(admin,'/api/chat/message',{action:'edit',room:'whats-new',messageId:posted.messageId,body:note+' Edited.',expectedBody:note,expectedRevision:0});
 assert.equal(edited.status,200,JSON.stringify(edited));
 assert.equal((await api(admin,'/api/chat/message',{action:'edit',room:'whats-new',messageId:handId,body:hand+' edited',expectedBody:hand})).status,200,'admin edits own note');
 assert.equal((await api(member,'/api/chat/message',{action:'edit',room:'whats-new',messageId:posted.messageId,body:'x',expectedBody:note+' Edited.'})).status,403,'member cannot edit');
 await member.goto(`${base}/chat?room=whats-new`);await settled(member);
 await member.waitForFunction(id=>document.getElementById('chat-message-'+id)?.textContent.includes('Edited.'),{timeout:30000},posted.messageId);
 assert.equal((await api(admin,'/api/chat/message',{action:'delete',room:'whats-new',messageId:handId})).status,200,'admin deletes');
 await admin.reload();await settled(admin);
 assert.equal(await admin.evaluate(body=>[...document.querySelectorAll('article')].some(e=>e.textContent.includes(body)),hand),false,'deleted note is gone');

 // 5. A brand-new account is already a member of the room.
 const fresh='00000000-0000-4000-8000-0000000003f2';
 await sql("insert into auth.users values($1) on conflict do nothing",[fresh]);await sql("insert into profiles values($1,'fresh302@example.test','user') on conflict do nothing",[fresh]);
 await sql("select longboard_chat_link_member($1,'Fresh Face',null)",[fresh]);
 const members=await api(member,'/api/chat/room-members?room=whats-new&q=Fresh');
 assert.equal(members.status,200,JSON.stringify(members));
 assert(JSON.stringify(members.data).includes('Fresh Face'),'the new account is in the room: '+JSON.stringify(members.data).slice(0,200));

 assert.deepEqual(errors,[]);
 console.log("PASS What's New desktop 1280 + phone 390: in every member's room list without joining, exact two-line description that stays put, welcome first, no composer/Reply/thread, reactions persist; deploy note via script+route (behind-the-scenes skipped, rerun posts nothing, bad token rejected), dated by Booker Chat Updates, unread until opened, no bell; admin post/edit/delete and edit of the automatic note; brand-new account in the room.");
}finally{await browser.close();}
