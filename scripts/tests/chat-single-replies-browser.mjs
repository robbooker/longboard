// Ticket #301 "Replies - Remove Multiple Layers": an original message with one list of replies.
// Seeds an older conversation nested four levels deep (and one whose middle reply was deleted)
// the way production has them, then applies migration 20261023120000 in the fixture and checks,
// on desktop 1280 and phone 390: no Reply on any reply (link, menu, swipe target), one list in
// time order, "replying to <name>" / "replying to a deleted message" labels, reply counts equal
// before and after, and a reply to a reply posted through the API lands under the original.
// CHAT_EXPECT_BASELINE=1 checks the published behaviour (nested levels, Reply on replies) without
// the migration. SCREENS=<dir> saves desktop + phone, light + dark screenshots to <dir>/before
// (baseline) or <dir>/after.
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3391',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54591';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const baseline=process.env.CHAT_EXPECT_BASELINE==='1',screens=process.env.SCREENS?`${process.env.SCREENS}/${baseline?'before':'after'}`:'';
if(screens)await mkdir(screens,{recursive:true});
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,bob]}=await control('identity');
await sql("delete from longboard_chat_messages where body like 'SRB %'");
// Seed history predates the send RPC's anti-spam window.
await sql("update longboard_chat_messages set created_at=created_at-interval '1 day' where guest_id=any($1)",[[alice.member.id,bob.member.id]]);
let minute=600;
const post=async(person,body,parent=null)=>(await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) values($1,$1,$2,$3,'main',$4,now()-($5||' minutes')::interval) returning *",[person.member.id,person===alice?'Alice':'Bob',body,parent,String(minute--)]))[0];
// An older conversation, nested the way replies to replies used to be.
const top=await post(bob,'SRB top: is the rate cut priced in?');
const r1=await post(alice,'SRB first reply from Alice',top.id);
const r2=await post(bob,'SRB second reply from Bob',top.id);
const r1a=await post(bob,'SRB Bob answers Alice',r1.id);
const r1a1=await post(alice,'SRB Alice answers Bob',r1a.id);
const r1a1x=await post(bob,'SRB Bob answers Alice again, deepest',r1a1.id);
// A second conversation whose middle reply was deleted after someone answered it.
const top2=await post(alice,'SRB second conversation');
const gone=await post(bob,'SRB soon deleted',top2.id);
const answer=await post(alice,'SRB answer to the deleted one',gone.id);
await sql("update longboard_chat_messages set body='Message deleted',deleted_at=now(),revision=revision+1 where id=$1",[gone.id]);
// Unread through now, so the room opens at the latest messages with these conversations on screen.
for(let n=0;n<3;n++)await post(bob,'SRB later room message '+n);
await sql("insert into chat_room_reads(account_id,room_slug,through_seq) select $1,room_slug,max(unread_seq) from longboard_chat_messages group by room_slug on conflict(account_id,room_slug) do update set through_seq=excluded.through_seq",[alice.id]);

// "Total reply counts": every live reply across all levels before; the one list after.
const tree=[top,r1,r2,r1a,r1a1,r1a1x];
const liveBefore=(await sql("with recursive t as (select id from longboard_chat_messages where id=$1 union all select m.id from longboard_chat_messages m join t on m.reply_to_id=t.id) select count(*)::int n from t join longboard_chat_messages m using(id) where m.id<>$1 and m.deleted_at is null and not m.removed",[top.id]))[0].n;
const levelCounts=Object.fromEntries((await sql("select message_id,reply_count::int n from chat_thread_counts('main',$1)",[tree.map(m=>m.id)])).map(r=>[r.message_id,r.n]));
assert.equal(liveBefore,5);assert.deepEqual(tree.map(m=>levelCounts[m.id]),[2,1,0,1,1,0],'nested counts before');
if(!baseline){
 await control('exec',{sql:await readFile(new URL('../../supabase/migrations/20261023120000_chat_single_level_replies.sql',import.meta.url),'utf8')});
 const [after]=await sql("select reply_count::int n from chat_thread_counts('main',$1)",[[top.id]]);
 assert.equal(after.n,liveBefore,'the same number of replies, now in one list');
 assert.deepEqual((await sql("select count(*)::int n from longboard_chat_messages where reply_to_id in (select id from longboard_chat_messages where reply_to_id is not null)"))[0].n,0);
 console.log(`PASS migration in the fixture: ${liveBefore} replies across ${Object.values(levelCounts).filter(Boolean).length} levels before, ${after.n} in one list after.`);
}

const browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const p=await (await browser.createBrowserContext()).newPage();p.on('pageerror',e=>errors.push(e.message));
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const shot=async name=>{if(screens)await p.screenshot({path:`${screens}/${name}.png`});};
const theme=value=>p.evaluate(value=>localStorage.setItem('longboard-public-chat-theme-v1',value),value);
const panel='aside[aria-label="Comment replies"]';
const openThread=async id=>{
 await p.goto(`${base}/chat?room=main&thread=${id}`);
 await p.waitForFunction((panel,id)=>[...document.querySelectorAll(panel+' [aria-label="Original comment"]')].some(e=>e.checkVisibility()&&e.dataset.threadMessageId===id),{timeout:30000},panel,id);
 await p.waitForFunction(panel=>!document.querySelector(panel+' [role="status"]')?.textContent.includes('Loading'),{},panel);
};
// What the visible thread shows: each reply's text, its "replying to" line, and any Reply control.
const thread=()=>p.evaluate(panel=>{
 const root=[...document.querySelectorAll(panel)].find(e=>e.checkVisibility());
 return [...root.querySelectorAll('[aria-label="Replies to this comment"] article[data-thread-message-id]')].map(a=>({
  id:a.dataset.threadMessageId,body:a.querySelector(':scope > p')?.textContent.trim(),
  label:a.querySelector('[data-replying-to]')?.textContent.replace(/^↳\s*/,'').trim()??null,
  reply:[...a.querySelectorAll('button')].filter(b=>b.hasAttribute('data-has-replies')||b.hasAttribute('data-menu-reply')||/\bReply\b|\breplies?\b/.test(b.textContent)).map(b=>(b.querySelector('[data-reply-count]')?.textContent??b.textContent).trim()),
 }));
},panel);
const roomChip=id=>p.evaluate(id=>{const e=document.getElementById('chat-message-'+id);const b=e&&[...e.querySelectorAll('button[data-has-replies]')].find(b=>b.checkVisibility());return b?(b.querySelector('[data-reply-count]')?.textContent??b.textContent).trim():null;},id);
const noOverflow=async()=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal page scroll');
const label=n=>`${n} ${n===1?'reply':'replies'}`;

try{
 console.log('Browser',await browser.version());
 await p.setViewport(desktop);await signIn(p,base,alice.email,{composer:'textarea[aria-label="Message LB"]'});
 if(baseline){
  for(const [view,size] of [['desktop-1280',desktop],['phone-390',phone]])for(const mode of ['light','dark']){
   await p.setViewport(size);await theme(mode);await openThread(top.id);await pause(800);
   const rows=await thread();
   assert.deepEqual(rows.map(r=>r.id),[r1.id,r2.id],view+': only the direct replies are listed');
   assert.deepEqual(rows.map(r=>r.reply),[[label(1)],['↳ Reply']],view+': every reply has its own Reply / reply count');
   assert(rows.every(r=>r.label===null));await shot(`${view}-${mode}-1-thread`);
   await p.evaluate((panel,id)=>[...document.querySelectorAll(`${panel} [data-thread-message-id="${id}"] button[data-has-replies]`)].find(b=>b.checkVisibility()).click(),panel,r1.id);
   await p.waitForFunction((panel,id)=>[...document.querySelectorAll(panel+' [aria-label="Original comment"]')].some(e=>e.checkVisibility()&&e.dataset.threadMessageId===id),{},panel,r1.id);await pause(500);
   assert.deepEqual((await thread()).map(r=>r.id),[r1a.id],view+': a second layer under the first reply');await shot(`${view}-${mode}-2-second-layer`);
  }
  console.log('REPRODUCED published baseline: replies nest (a second and deeper layer), every reply has its own Reply or reply count, no "replying to" labels.');
 }else{
  const expected=[[r1,null],[r2,null],[r1a,'replying to Alice'],[r1a1,'replying to Bob'],[r1a1x,'replying to Alice']];
  for(const [view,size] of [['desktop-1280',desktop],['phone-390',phone]]){
   await p.setViewport(size);await theme('light');await openThread(top.id);
   const rows=await thread();
   assert.deepEqual(rows.map(r=>r.id),expected.map(([m])=>m.id),view+': one list in time order');
   assert.deepEqual(rows.map(r=>r.label),expected.map(([,l])=>l),view+': replying-to labels');
   // D-305 brought Reply back on every reply (it answers within this one list); no reply counts.
   assert.deepEqual(rows.map(r=>r.reply),expected.map(()=>['↳ Reply']),view+': Reply (and no count) on every reply');
   // Own replies have an actions menu; it has no Reply either.
   for(const id of [r1.id,r1a1.id]){
    const opened=await p.evaluate((panel,id)=>{const root=[...document.querySelectorAll(panel)].find(e=>e.checkVisibility());const s=root?.querySelector(`[data-thread-message-id="${id}"] summary`);s?.click();return !!s;},panel,id);
    assert(opened,view+': own reply has a menu');await pause(200);
    assert.equal(await p.evaluate((panel,id)=>[...document.querySelectorAll(`${panel} [data-thread-message-id="${id}"] details[open] button`)].some(b=>b.hasAttribute('data-menu-reply')||/^\s*Reply\s*$/.test(b.textContent.replace(/\s+/g,' '))),panel,id),false,view+': no Reply in a reply menu');
    await p.evaluate((panel,id)=>{const root=[...document.querySelectorAll(panel)].find(e=>e.checkVisibility());const d=root?.querySelector(`[data-thread-message-id="${id}"] details[open]`);if(d)d.open=false;},panel,id);await pause(100);
   }
   await noOverflow();
   for(const mode of ['light','dark']){await theme(mode);await openThread(top.id);await pause(600);await shot(`${view}-${mode}-1-thread`);}
   await theme('light');
   // The original message still offers Reply in the room, with the total count.
   if(view==='desktop-1280'){
    await p.waitForFunction((id,want)=>{const e=document.getElementById('chat-message-'+id);const b=e&&[...e.querySelectorAll('button[data-has-replies]')].find(b=>b.checkVisibility());return b&&(b.querySelector('[data-reply-count]')?.textContent??b.textContent).trim()===want;},{timeout:20000},top.id,label(liveBefore));
    assert.equal(await roomChip(top.id),label(liveBefore),'the original message counts every reply');
   }
   // A reply to a deleted message says so.
   await openThread(top2.id);
   const second=await thread();
   assert.deepEqual(second.map(r=>[r.id,r.label,r.reply]),[[answer.id,'replying to a deleted message',['↳ Reply']]],view+': deleted answered message');
   for(const mode of ['light','dark']){await theme(mode);await openThread(top2.id);await pause(600);await shot(`${view}-${mode}-2-deleted`);}
   await theme('light');
   console.log(`PASS ${view}: one list in time order, "replying to" labels (names and a deleted message), no Reply link or menu item on any reply, original message counts ${liveBefore}.`);
  }
  // An old client (or any API caller) replying to a reply lands under the original message.
  await p.setViewport(desktop);await openThread(top.id);
  const sent=await p.evaluate(async(replyTo)=>{const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'send',room:'main',body:'SRB posted to a reply through the API',replyTo,clientId:crypto.randomUUID()})});return {status:r.status,data:await r.json()};},r1a1x.id);
  assert.equal(sent.status,200,JSON.stringify(sent.data));
  assert.equal(sent.data.message.reply_to_id,top.id,'stored under the original message');assert.equal(sent.data.message.answered_id,r1a1x.id);
  await p.waitForFunction((panel,id)=>[...document.querySelectorAll(`${panel} [data-thread-message-id="${id}"] [data-replying-to]`)].some(e=>e.checkVisibility()),{timeout:30000},panel,sent.data.message.id).catch(async()=>{await openThread(top.id);});
  const withNew=await thread();
  assert.deepEqual(withNew.at(-1),{id:sent.data.message.id,body:'SRB posted to a reply through the API',label:'replying to Bob',reply:['↳ Reply']});
  assert.equal(withNew.length,expected.length+1);
  // An old link to a reply leads to the whole conversation instead of a second layer.
  await openThread(r1a.id);
  assert.equal(await p.$(`${panel} textarea`),null,'no composer under a reply');
  await p.evaluate(panel=>[...document.querySelectorAll(panel+' [data-whole-conversation]')].find(b=>b.checkVisibility()).click(),panel);
  await p.waitForFunction((panel,id)=>[...document.querySelectorAll(panel+' [aria-label="Original comment"]')].some(e=>e.checkVisibility()&&e.dataset.threadMessageId===id),{timeout:15000},panel,top.id);
  console.log('PASS API: a reply to a reply is stored under the original message with "replying to Bob"; an old link to a reply opens its whole conversation.');
 }
 assert.deepEqual(errors,[]);console.log('PASS zero browser runtime errors.');
}catch(error){await p.screenshot({path:'/tmp/chat-single-replies-failure.png'}).catch(()=>{});console.error(await p.evaluate(()=>document.body.innerText.slice(-1500)).catch(()=>''));throw error;}finally{await browser.close();}
