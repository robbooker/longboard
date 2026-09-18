// Synthetic fixture only: ports 3267/54467, no production credentials or messages.
import puppeteer from 'puppeteer';import assert from 'node:assert/strict';
const base='http://localhost:3267',rest='http://127.0.0.1:54467';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
async function login(email,width){const context=await browser.createBrowserContext(),p=await context.newPage();await p.setViewport({width,height:900});await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label="Message LB"]');return p;}
async function api(p,body){return p.evaluate(async body=>{const r=await fetch('/api/chat/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},body);}
async function fixture(table,body){const r=await fetch(rest+'/rest/v1/'+table,{method:body?'POST':'GET',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,await r.clone().text());return r.json();}
async function button(p,scope,text){for(const b of await p.$$(`${scope} button`))if((await b.evaluate(e=>e.textContent)).trim()===text){await b.click();return;}throw Error('Missing '+text);}
async function edit(p,scope,body){await p.click(scope+' summary');await button(p,scope,'Edit');await p.waitForSelector('dialog[open] textarea');await p.click('dialog[open] textarea');await p.keyboard.down('Control');await p.keyboard.press('A');await p.keyboard.up('Control');await p.type('dialog[open] textarea',body);}
try{
const alice=await login('alice@example.test',1440),bob=await login('bob@example.test',390);
const member=(await fixture('longboard_chat_members?select=id&user_id=eq.00000000-0000-4000-8000-000000000001'))[0].id;
const root=crypto.randomUUID(),reply=crypto.randomUUID();
await fixture('longboard_chat_messages',{id:root,guest_id:member,member_id:member,author_label:'Alice',body:'Thread edit root',room_slug:'main'});
await fixture('longboard_chat_messages',{id:reply,guest_id:member,member_id:member,author_label:'Alice',body:'Thread editable reply',room_slug:'main',reply_to_id:root});
const action={action:'edit',room:'main',messageId:reply,body:'Forged',expectedBody:'Thread editable reply'};
assert.equal((await api(bob,action)).status,403);
assert.equal((await api(alice,{...action,room:'social'})).status,404);
for(const [p,width] of [[alice,1440],[alice,390]]){
 await p.setViewport({width,height:900});await p.goto(`${base}/chat?room=main#chat-message-${reply}`,{waitUntil:'networkidle0'});await p.reload({waitUntil:'networkidle0'});
 await p.waitForSelector('aside[aria-label="Comment replies"]');
 const card='aside[aria-label="Comment replies"] [aria-label="Replies to this comment"] article';
 await p.waitForSelector(card+' summary');await edit(p,card,`Edited reply ${width}`);
 await p.keyboard.press('Escape');await p.waitForSelector('dialog[open]',{hidden:true});assert(await p.$('aside[aria-label="Comment replies"]'),'Escape only closes editor');
 await button(p,card,'Edit');await p.waitForSelector('dialog[open] textarea');await p.click('dialog[open] textarea');await p.keyboard.down('Control');await p.keyboard.press('A');await p.keyboard.up('Control');await p.type('dialog[open] textarea',`Edited reply ${width}`);await button(p,'dialog[open]','Save changes');await p.waitForSelector('dialog[open]',{hidden:true});
 await p.waitForFunction((selector,text)=>document.querySelector(selector)?.textContent.includes(text),{},card,`Edited reply ${width}`);assert.match(await p.$eval(card+' time',e=>e.textContent),/edited/);
 const persisted=(await fixture('longboard_chat_messages?id=eq.'+reply))[0];assert.equal(persisted.body,`Edited reply ${width}`);assert(persisted.edited_at);
 await p.type('#thread-reply','Unsent reply draft');
 await edit(p,'aside [aria-label="Original comment"]',`Root edited ${width}`);await p.keyboard.press('Enter');await p.waitForSelector('dialog[open]',{hidden:true});
 await p.waitForFunction(text=>document.querySelector('aside [aria-label="Original comment"]')?.textContent.includes(text),{},`Root edited ${width}`);
 assert.equal(await p.$eval('#thread-reply',e=>e.value),'Unsent reply draft');
 const ids=await p.$$eval('dialog h2',els=>els.map(e=>e.id));assert.equal(new Set(ids).size,ids.length,'dialog labels unique across feed and thread');
 await p.$$eval('aside details[open]',els=>els.forEach(e=>e.open=false));
 await p.screenshot({path:`/tmp/thread-edit-${width}.png`});
 console.log('PASS thread save, Escape, immediate edited label and persistence',width);
}
assert.equal((await api(alice,{...action,expectedBody:'stale'})).status,409);
await bob.goto(`${base}/chat?room=main#chat-message-${reply}`,{waitUntil:'networkidle0'});await bob.waitForSelector('aside[aria-label="Comment replies"]');assert.equal(await bob.$('aside[aria-label="Comment replies"] summary'),null);
if(!(await fixture('chat_provider_identities?provider=eq.shortscout&account_id=eq.00000000-0000-4000-8000-000000000001')).length)await fixture('chat_provider_identities',{provider:'shortscout',subject:'00000000-0000-4000-8000-000000000001',account_id:'00000000-0000-4000-8000-000000000001',membership_level:'mastermind'});
for(const room of ['main','social','shortscout','lb-announcements','ss-announcements']){
 const id=crypto.randomUUID();await fixture('longboard_chat_messages',{id,guest_id:member,member_id:member,author_label:'Alice',body:'Universal edit',room_slug:room});
 const response=await api(alice,{action:'edit',room,messageId:id,body:'Universal edited',expectedBody:'Universal edit'});assert.equal(response.status,200,room+JSON.stringify(response));assert(response.data.message.edited_at);assert.equal(response.data.message.body,'Universal edited');
 assert.equal((await api(bob,{action:'edit',room,messageId:id,body:'forged',expectedBody:'Universal edited'})).status,403);
}
const state=async is_open=>{const r=await fetch(rest+'/rest/v1/longboard_chat_room_state?room_slug=eq.main',{method:'PATCH',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json'},body:JSON.stringify({is_open,paused_at:is_open?null:new Date().toISOString(),paused_by:is_open?null:"00000000-0000-4000-8000-000000000001"})});assert(r.ok,await r.text());};
await state(false);try{assert.equal((await api(alice,{...action,expectedBody:'Edited reply 390'})).status,423);}finally{await state(true);}
console.log('PASS paused room edit rejected');
console.log('PASS existing edit RPC in all five rooms, author-only announcement and SS restrictions');
console.log('PASS actual API/database author-only, cross-room and stale guards; recipient has no edit action');
}finally{await browser.close();}
