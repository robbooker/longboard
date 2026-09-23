import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3335';

const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const post=(page,body)=>page.evaluate(async body=>{const r=await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},body);
const get=(page,path)=>page.evaluate(async path=>(await fetch(path)).json(),path);
async function login(p,email){await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label^="Message "]');await p.waitForNetworkIdle({idleTime:500});}
async function select(p,id,name){await p.bringToFront();await p.waitForFunction(name=>[...document.querySelectorAll('aside[aria-label="Private conversations"] button')].some(e=>e.textContent.includes(name)),{},name);await p.evaluate(name=>[...document.querySelectorAll('aside[aria-label="Private conversations"] button')].find(e=>e.textContent.includes(name)).click(),name);await p.waitForFunction(name=>document.querySelector('header[data-dm="true"] h1')?.textContent===name,{},name);await p.waitForSelector('#dm-body',{visible:true});await p.waitForFunction(()=>document.activeElement?.id==='dm-body');}
try {
 const p=await browser.newPage();await p.setRequestInterception(true);p.on('request',r=>r.url().includes('/api/chat/opening?')?r.respond({status:200,contentType:'application/json',body:JSON.stringify({messageId:null,readThrough:0})}):r.continue());await p.setViewport({width:1100,height:900});await login(p,'alice@example.test');
 const list=await get(p,'/api/chat/inbox'),conversation=list.conversations.find(c=>c.otherName==='Bob');if(conversation.status==='pending')await post(p,{action:'accept',target:conversation.id});
 const history=await get(p,'/api/chat/history?room=main'),parent=history.messages.find(m=>m.author_label==='Bob');assert.deepEqual(parent.memberships,['LB','SS']);
 const thread=await get(p,`/api/chat/thread?room=main&messageId=${parent.id}`);assert.deepEqual(thread.parent.memberships,['LB','SS']);
 const inbox=await get(p,`/api/chat/inbox?conversation=${conversation.id}`),incoming=inbox.messages.find(m=>m.sender_id===parent.member_id);assert.deepEqual(incoming.memberships,['LB','SS']);
 await select(p,conversation.id,'Bob');await p.waitForSelector('[data-message-id][data-own="false"] [data-membership="SS"]');
 const snapshot=await p.$eval(`[data-message-id="${incoming.id}"]`,e=>e.querySelector('p')?.textContent);
 await fetch('http://127.0.0.1:54535/test/membership-state',{method:'POST',body:JSON.stringify({state:'revoke'})});
 await p.waitForFunction(id=>{const row=document.querySelector(`[data-message-id="${id}"]`);return row?.querySelector('[data-membership="LB"]')&&!row.querySelector('[data-membership="SS"]');},{timeout:125000,polling:500},incoming.id);
 assert.equal(await p.$eval(`[data-message-id="${incoming.id}"]`,e=>e.querySelector('p')?.textContent),snapshot);
 const changed=await get(p,`/api/chat/thread?room=main&messageId=${parent.id}`);assert.deepEqual(changed.parent.memberships,['LB']);
 const historyAfter=await get(p,'/api/chat/history?room=main');assert.deepEqual(historyAfter.messages.find(m=>m.id===parent.id).memberships,['LB']);
 const older=await get(p,`/api/chat/inbox?conversation=${conversation.id}&ids=${incoming.id}`);assert.deepEqual(older.messages[0].memberships,['LB']);
 console.log('PASS current signed membership removal without login or message edit: actual DM automatically refreshes, room/thread and exact-ID older DM reads agree; independent LB remains.');
}finally{await fetch('http://127.0.0.1:54535/test/membership-state',{method:'POST',body:JSON.stringify({state:'update'})});await browser.close();}
