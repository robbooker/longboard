import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3335';

const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const post=(page,body)=>page.evaluate(async body=>{const r=await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},body);
const get=(page,path)=>page.evaluate(async path=>(await fetch(path)).json(),path);
async function login(p,email){await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label^="Message "]');await p.waitForNetworkIdle({idleTime:500,timeout:15000}).catch(()=>{});}
async function select(p,id,name){await p.bringToFront();await p.waitForFunction(name=>[...document.querySelectorAll('aside[aria-label="Private conversations"] button')].some(e=>e.textContent.includes(name)),{},name);await p.evaluate(name=>[...document.querySelectorAll('aside[aria-label="Private conversations"] button')].find(e=>e.textContent.includes(name)).click(),name);await p.waitForFunction(name=>document.querySelector('header[data-dm="true"] h1')?.textContent===name,{},name);await p.waitForSelector('#dm-body',{visible:true});await p.waitForFunction(()=>document.activeElement?.id==='dm-body',{timeout:5000}).catch(()=>p.focus('#dm-body'));} // focus-on-open has its own test (chat-dm-send-focus); here it only marks the DM ready
try {
 const p=await browser.newPage();await p.setRequestInterception(true);p.on('request',r=>r.url().includes('/api/chat/opening?')?r.respond({status:200,contentType:'application/json',body:JSON.stringify({messageId:null,readThrough:0})}):r.continue());await p.setViewport({width:1100,height:900});await login(p,'alice@example.test');
 const list=await get(p,'/api/chat/inbox'),conversation=list.conversations.find(c=>c.otherName==='Bob');if(conversation.status==='pending')await post(p,{action:'accept',target:conversation.id});
 const history=await get(p,'/api/chat/history?room=main'),parent=history.messages.find(m=>m.author_label==='Bob');assert.deepEqual(parent.memberships,['LB','SS']);
 const thread=await get(p,`/api/chat/thread?room=main&messageId=${parent.id}`);assert.deepEqual(thread.parent.memberships,['LB','SS']);
 const inbox=await get(p,`/api/chat/inbox?conversation=${conversation.id}`),incoming=inbox.messages.find(m=>m.sender_id===parent.member_id);assert.deepEqual(incoming.memberships,['LB','SS']);
 await select(p,conversation.id,'Bob');await p.waitForSelector(`[data-message-id="${incoming.id}"]`);
 // D-218: messages carry no LB/SS badges in the UI; the Member List shows them.
 assert.equal(await p.$$eval('[data-message-id] [data-membership]',els=>els.length),0);
 const memberBadges=async name=>{await p.goto(base+'/chat?room=social',{waitUntil:'domcontentloaded'});
  const button=()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Member List'&&b.getClientRects().length&&Object.keys(b).some(k=>k.startsWith('__reactProps')));
  /* SIDEBAR-REST: the Member List is in the room info sheet. */const info=()=>[...document.querySelectorAll('header button[aria-label="Room info"]')].find(b=>b.getClientRects().length&&Object.keys(b).some(k=>k.startsWith('__reactProps')));await p.waitForFunction(`(${info})()`);await p.evaluate(`(${info})().click()`);await p.waitForFunction(`(${button})()`);await p.evaluate(`(${button})().click()`);
  await p.waitForFunction(name=>[...document.querySelectorAll('dialog[open] ul[aria-label="Room members"] li strong')].some(e=>e.firstChild?.textContent===name),{timeout:20000},name);
  return p.$$eval('dialog[open] ul[aria-label="Room members"] li strong',(els,name)=>[...els.find(e=>e.firstChild.textContent===name).querySelectorAll('[data-membership]')].map(b=>b.textContent),name);};
 assert.deepEqual(await memberBadges('Bob'),['LB','SS']);
 await fetch('http://127.0.0.1:54535/test/membership-state',{method:'POST',body:JSON.stringify({state:'revoke'})});
 // Chat reads ShortScout membership from its local copy (A6): the nightly sync (or an owner's
 // Sync now) writes the source's answer there. Stand in for that sync, then expect the open DM to
 // drop the badge with no sign-in or message edit.
 const rest=(path,init={})=>fetch('http://127.0.0.1:54535/rest/v1/'+path,{...init,headers:{authorization:'Bearer test-service-role','Content-Type':'application/json',prefer:'return=representation'}}).then(async r=>{assert.ok(r.ok,await r.clone().text());return r.json();});
 const synced=await rest("chat_shortscout_authorization?subject=eq.00000000-0000-4000-8000-000000000002",{method:'PATCH',body:JSON.stringify({decision:'deny',membership_level:null,checked_at:new Date().toISOString()})});assert.ok(synced.length>=1,'Bob copy row updated');
 // The Member List shows the change on its next read (opening it again), with no sign-in.
 for(const until=Date.now()+125000;;){if(JSON.stringify(await memberBadges('Bob'))==='["LB"]')break;assert.ok(Date.now()<until,'Bob keeps only LB in the Member List');await new Promise(r=>setTimeout(r,2000));}
 const changed=await get(p,`/api/chat/thread?room=main&messageId=${parent.id}`);assert.deepEqual(changed.parent.memberships,['LB']);
 const historyAfter=await get(p,'/api/chat/history?room=main');assert.deepEqual(historyAfter.messages.find(m=>m.id===parent.id).memberships,['LB']);
 const older=await get(p,`/api/chat/inbox?conversation=${conversation.id}&ids=${incoming.id}`);assert.deepEqual(older.messages[0].memberships,['LB']);
 console.log('PASS current signed membership removal without login or message edit: the Member List shows it (D-218), room/thread and exact-ID older DM reads agree; independent LB remains.');
}finally{await fetch('http://127.0.0.1:54535/test/membership-state',{method:'POST',body:JSON.stringify({state:'update'})});await browser.close();}
