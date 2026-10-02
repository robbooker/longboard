// Actual Next app/API/current SQL; only the isolated fixture receives synthetic data.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base='http://localhost:3361',fixture='http://127.0.0.1:54561';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
const sql=(sql,args=[])=>control('sql',{sql,args});
const identity=await control('identity'),[alice,bob]=identity.people;
await sql("update profiles set role=case when id=$1 then 'admin' else 'user' end",[alice.id]);
await sql("insert into user_tags(user_id,tag) select $1,'boardroom-cohort-1' where not exists(select 1 from user_tags where user_id=$1 and tag='boardroom-cohort-1')",[bob.id]);
await sql('delete from chat_room_message_pins');
await sql("delete from longboard_chat_messages where body like 'PIN TEST %'");
const create=async(body,room='main',parent=null,day=0)=>(await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) values($1,$1,$2,$3,$4,$5,now()-($6||' days')::interval) returning *",[room==='main'||room==='social'?bob.member.id:alice.member.id,room==='main'||room==='social'?'Bob':'Alice','PIN TEST '+body,room,parent,String(day)]))[0];
const old=await create('old root','main',null,10),nested=await create('old nested','main',old.id,9),deep=await create('deep nested','main',nested.id,8);
for(let n=0;n<101;n++)await create('sibling '+n,'main',old.id,1);
const latest=[];for(let n=0;n<85;n++)latest.push(await create('recent root '+n));
await create('latest child','main',latest.at(-1).id);
const social=await create('social isolated','social');
const recording=await create('old recording','lb-recordings',null,10);
for(let n=0;n<81;n++)await create('recording '+n,'lb-recordings');
const gainers=(await sql("select ingest_chat_gainers_alert('-199',extract(epoch from clock_timestamp())::bigint,now(),'PIN TEST Gainers') value"))[0].value.messageId;
await sql("insert into chat_room_reads(account_id,room_slug,through_seq) select a.id,m.room_slug,max(m.unread_seq) from chat_accounts a cross join longboard_chat_messages m group by a.id,m.room_slug on conflict(account_id,room_slug) do update set through_seq=excluded.through_seq");
const browser=await puppeteer.launch({executablePath:process.env.CHAT_BROWSER_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),errors=[],releases=[];
const api=(p,path,body)=>p.evaluate(async(path,body)=>{const r=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};},path,body);
async function ready(p,selector){await p.waitForSelector(selector,{visible:true});await p.waitForFunction(selector=>{const e=document.querySelector(selector);return Object.keys(e).some(k=>k.startsWith('__reactProps$'));},{},selector);}
async function login(email){const context=await browser.createBrowserContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:950});await page.goto(base+'/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email',email);await page.type('#li-password','demo-only');await page.click('button[type=submit]');await ready(page,'textarea[aria-label="Message LB"]');return {context,page};}
const strip='[aria-label="Pinned room messages"]';
const pinned=id=>`${strip} [data-pinned-message-id="${id}"]`;
async function waitPin(p,id,visible=true){await p.waitForSelector(pinned(id),visible?{visible:true,timeout:20000}:{hidden:true,timeout:20000});}
async function openPin(p,id){await waitPin(p,id);await p.click(pinned(id)+' button:first-child');}
const setPin=(p,messageId,room='main',action='pin')=>api(p,'/api/chat/message-pins',{room,messageId,action});
try{
 console.log('Browser '+await browser.version());
 const admin=await login(alice.email),viewer=await login(bob.email),p=admin.page,v=viewer.page;
 assert.equal((await setPin(v,old.id)).status,403);assert.equal((await api(v,'/api/chat/message-pins?room=shortscout')).status,403);
 await p.waitForSelector(`#chat-message-${latest.at(-1).id} button[aria-label="Pin message by Bob"]`);await p.click(`#chat-message-${latest.at(-1).id} button[aria-label="Pin message by Bob"]`);await waitPin(p,latest.at(-1).id);await waitPin(v,latest.at(-1).id);
 assert.equal(await v.$(`${strip} button[aria-label^="Unpin"]`),null);
 await p.click(`${pinned(latest.at(-1).id)} button[aria-label="Unpin message by Bob"]`);await waitPin(p,latest.at(-1).id,false);
 assert.equal((await setPin(p,old.id)).status,200);assert.equal((await setPin(p,nested.id)).status,200);assert.equal((await setPin(p,deep.id)).status,200);
 await waitPin(v,old.id);await waitPin(p,old.id);
 // Seeing a pin preview does not acknowledge its unseen original message/event.
 await sql("insert into chat_room_mentions(account_id,message_id,room_slug,author_label,preview,category,root_message_id) values($1,$2,'main','Bob','PIN TEST old root','mention',null) on conflict do nothing",[alice.id,old.id]);
 await p.type('textarea[aria-label="Message LB"]','Room draft stays');
 await p.waitForFunction(id=>!document.querySelector('#chat-message-'+id),{},old.id);
 const before=(await sql('select through_seq from chat_room_reads where account_id=$1 and room_slug=$2',[alice.id,'main']))[0].through_seq;
 assert.equal((await sql('select read_at from chat_room_mentions where account_id=$1 and message_id=$2',[alice.id,old.id]))[0].read_at,null);
 await openPin(p,old.id);await ready(p,'#chat-message-'+old.id);
 await p.waitForFunction(id=>{const e=document.querySelector('#chat-message-'+id),r=e?.getBoundingClientRect(),c=e?.parentElement.getBoundingClientRect();return r&&c&&Math.abs(r.top-c.top)<5;},{},old.id);
 assert.equal(await p.$eval('textarea[aria-label="Message LB"]',e=>e.value),'Room draft stays');
 // The anchor is an 81st row: both old and latest root reply counts remain complete.
 await p.waitForFunction((oldId,lastId)=>document.querySelector('#chat-message-'+oldId+' button[data-has-replies=true]')?.textContent.includes('102 replies')&&document.querySelector('#chat-message-'+lastId+' button[data-has-replies=true]')?.textContent.includes('1 reply'),{timeout:20000},old.id,latest.at(-1).id);
 assert.equal((await api(p,`/api/chat/history?room=main&anchor=${old.id}`)).data.messages.filter(m=>!m.removed).length,81);
 await create('arrived after old jump');await p.evaluate(()=>window.dispatchEvent(new Event('chat-room-refresh')));
 await p.waitForFunction(()=>document.body.textContent.includes('PIN TEST arrived after old jump'),{timeout:20000});
 assert.equal((await sql('select through_seq from chat_room_reads where account_id=$1 and room_slug=$2',[alice.id,'main']))[0].through_seq,before);
 assert(await p.$('#chat-message-'+old.id));
 await openPin(p,nested.id);await p.waitForFunction(id=>document.querySelector('[aria-label="Original comment"]')?.getAttribute('data-thread-message-id')===id,{},nested.id);await p.type('#thread-reply','Nested draft stays');
 await openPin(p,deep.id);await p.waitForFunction(id=>document.querySelector('[aria-label="Original comment"]')?.getAttribute('data-thread-message-id')===id,{},deep.id);
 await openPin(p,nested.id);await p.waitForFunction(()=>document.querySelector('#thread-reply')?.value==='Nested draft stays');
 await p.screenshot({path:'/tmp/chat-room-message-pins-desktop.png'});
 console.log('PASS shared admin controls, peer view, exact old/nested navigation, 81-row counts, drafts and read boundary.');
 const edit=await api(v,'/api/chat/message',{room:'main',messageId:old.id,action:'edit',body:'PIN TEST current edited preview',expectedBody:old.body,expectedRevision:0});assert.equal(edit.status,200);
 await p.waitForFunction(id=>document.querySelector(`[data-pinned-message-id="${id}"]`)?.textContent.includes('current edited preview'),{timeout:20000},old.id);
 assert.equal((await api(v,'/api/chat/message',{room:'main',messageId:old.id,action:'delete',expectedRevision:1})).status,200);await waitPin(p,old.id,false);
 assert.equal((await api(v,'/api/chat/message',{room:'main',messageId:old.id,action:'edit',body:'PIN TEST deliberate replacement',expectedBody:'Message deleted',expectedRevision:2})).status,200);
 assert.equal((await api(p,'/api/chat/message-pins?room=main')).data.pins.some(x=>x.messageId===old.id),false);
 // Pinning uses read access and never enables Gainers/recording sends or replies.
 for(const [room,id]of [['lb-recordings',recording.id],['gainers',gainers],['social',social.id]])assert.equal((await setPin(p,id,room)).status,200);
 assert.equal((await api(p,'/api/chat',{action:'send',room:'gainers',body:'Forbidden'})).status,403);
 assert.equal((await api(v,'/api/chat',{action:'send',room:'lb-recordings',body:'Forbidden'})).status,403);
 await p.goto(base+'/chat?room=lb-recordings');await waitPin(p,recording.id);await openPin(p,recording.id);await ready(p,'#chat-message-'+recording.id);assert.equal(await p.$('[aria-label="Original comment"]'),null);
 await p.goto(base+'/chat?room=gainers');await waitPin(p,gainers);await openPin(p,gainers);await ready(p,'#chat-message-'+gainers);assert.equal(await p.$('textarea[aria-label^="Message"]'),null);
 await p.goto(base+'/chat?room=social');await waitPin(p,social.id);assert.equal(await p.$(pinned(nested.id)),null);
 await p.setViewport({width:320,height:850});await p.tap(pinned(social.id)+' button:first-child');await ready(p,'#chat-message-'+social.id);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:'/tmp/chat-room-message-pins-mobile-320.png'});
 await p.setViewport({width:1440,height:950});const quad=await admin.context.newPage();quad.on('pageerror',e=>errors.push(e.message));await quad.setViewport({width:1440,height:950});await quad.goto(base+'/chat/quad');await ready(quad,'select');await quad.select('select','room:main');await waitPin(quad,nested.id);await quad.click(pinned(nested.id)+' button:first-child');await quad.waitForFunction(id=>[...document.querySelectorAll('[aria-label="Original comment"]')].some(e=>e.getAttribute('data-thread-message-id')===id),{},nested.id);await quad.screenshot({path:'/tmp/chat-room-message-pins-quad.png'});await quad.close();
 console.log('PASS edited/deleted/replaced previews, room isolation, recordings/Gainers, 320px touch and Quad.');
 // A held old-room batch must not repopulate pins in the new room.
 await p.goto(base+'/chat?room=main');await waitPin(p,nested.id);let release,heldRequest,held=false;await p.setRequestInterception(true);
 const intercept=async request=>{const body=request.postData();if(!held&&request.url().endsWith('/api/chat/updates')&&body?.includes('/api/chat/message-pins?room=main')){held=true;heldRequest=request;try{const result=await fetch(request.url(),{method:'POST',headers:request.headers(),body});const text=await result.text();await new Promise(resolve=>{release=resolve;releases.push(resolve);});await request.respond({status:result.status,contentType:'application/json',body:text}).catch(()=>{});}catch{await request.abort().catch(()=>{});}}else await request.continue().catch(()=>{});};p.on('request',intercept);await p.evaluate(()=>window.dispatchEvent(new Event('chat-room-refresh')));
 for(let n=0;!release&&n<300;n++)await new Promise(r=>setTimeout(r,20));assert(release);
 await p.click('#chat-room-navigation a[href="/chat?room=social"]');await waitPin(p,social.id);const delivered=p.waitForResponse(r=>r.request()===heldRequest,{timeout:5000});release();await delivered;assert.equal(await p.$(pinned(nested.id)),null);p.off('request',intercept);await p.setRequestInterception(false);
 // Current room/admin revocation removes content/capabilities through the shared batch.
 await sql('delete from user_tags where user_id=$1',[bob.id]);await v.evaluate(()=>window.dispatchEvent(new Event('chat-room-refresh')));await v.waitForFunction(()=>document.body.textContent.includes('Access to this room could not be verified'),{timeout:20000});assert.equal(await v.$(strip),null);
 await sql("update profiles set role='user' where id=$1",[alice.id]);await p.evaluate(()=>window.dispatchEvent(new Event('chat-room-refresh')));await p.waitForSelector(`${strip} button[aria-label^="Unpin"]`,{hidden:true,timeout:20000});assert.equal((await setPin(p,social.id,'social','unpin')).status,403);
 const anonContext=await browser.createBrowserContext(),anon=await anonContext.newPage();await anon.goto(base+'/chat/login');assert.equal((await api(anon,'/api/chat/message-pins?room=social')).status,401);await anonContext.close();
 assert.deepEqual(errors,[]);console.log('PASS actual room-message pins browser matrix; held room response, current access/admin revocation, anonymous denial; zero browser errors.');
}catch(error){console.error(error);for(const release of releases)release();for(const [i,p]of(await browser.pages()).entries()){await p.screenshot({path:`/tmp/chat-room-message-pins-failure-${i}.png`}).catch(()=>{});await writeFile(`/tmp/chat-room-message-pins-failure-${i}.txt`,await p.evaluate(()=>document.body.innerText).catch(()=>''));}throw error;}finally{for(const release of releases)release();await browser.close();}
