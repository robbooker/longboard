// Synthetic local fixture only. See docs/chat-dm-message-actions.md.
import puppeteer from 'puppeteer';import assert from 'node:assert/strict';
const base=process.env.CHAT_TEST_URL||'http://localhost:3224',rest=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54424';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const dm='section[aria-label="Private conversation"]',errors=[];
async function login(email,width){const c=await browser.createBrowserContext(),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width,height:1000});await p.goto(`${base}/login?next=%2Fchat`);await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});assert.equal(await p.$('[data-nextjs-dialog]'),null);await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label^="Message "]');return p;}
async function api(p,body){return p.evaluate(async body=>{const r=await fetch('/api/chat/inbox',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json()};},body);}
async function textButton(p,scope,text){for(const h of await p.$$(`${scope} button`))if((await h.evaluate(e=>e.textContent)).trim()===text){await h.click();return;}throw Error(`Missing ${text}`);}
async function select(p,name){await p.waitForSelector('nav button[data-active]');if(await p.$eval('nav[aria-label="Chat rooms"]',e=>getComputedStyle(e).display==='none'))await p.click('button[aria-label="Open room navigation"]');await p.evaluate(name=>[...document.querySelectorAll('nav button[data-active]')].find(e=>e.textContent.includes(name)).click(),name);await p.waitForSelector('#dm-body',{visible:true});}
async function action(p,id,name){await p.waitForSelector(`[data-message-id="${id}"] summary`);await p.click(`[data-message-id="${id}"] summary`);await textButton(p,`[data-message-id="${id}"] details`,name);await p.waitForSelector('dialog[open]',{visible:true});}
// Own deletes happen at once, without a confirmation dialog, and the message leaves both views (#350).
async function remove(p,id){await p.waitForSelector(`[data-message-id="${id}"] summary`);await p.click(`[data-message-id="${id}"] summary`);await textButton(p,`[data-message-id="${id}"] details`,'Delete');await p.waitForFunction(id=>{const row=document.querySelector(`[data-message-id="${id}"]`);return !row||!row.querySelector('summary');},{},id);}
async function replace(p,selector,text){await p.click(selector);await p.keyboard.down('Control');await p.keyboard.press('A');await p.keyboard.up('Control');await p.type(selector,text);}
async function fixture(table,data){const r=await fetch(`${rest}/rest/v1/${table}`,{method:'POST',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json'},body:JSON.stringify(data)});assert.ok(r.ok,await r.text());}
try{
 const alice=await login('alice@example.test',1440),bob=await login('bob@example.test',390);
 const conversation=(await api(alice)).data.conversations.find(c=>c.otherName==='Bob');assert.equal((await api(alice,{action:'accept',target:conversation.id})).status,200);
 const rows=await(await fetch(`${rest}/rest/v1/longboard_chat_conversations?id=eq.${conversation.id}`,{headers:{authorization:'Bearer test-service-role'}})).json();const own=rows[0].recipient_id,other=rows[0].requester_id;
 const oldId=crypto.randomUUID();await fixture('longboard_chat_direct_messages',{id:oldId,conversation_id:conversation.id,sender_id:own,client_id:crypto.randomUUID(),body:'Old own editable message'});
 for(let i=0;i<55;i++)await fixture('longboard_chat_direct_messages',{conversation_id:conversation.id,sender_id:i%2?own:other,client_id:crypto.randomUUID(),body:`History ${i}`});
 for(const [p,name] of [[alice,'Bob'],[bob,'Alice']]){await p.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));await select(p,name);await p.waitForSelector(`${dm} article`);// An unread conversation opens at its first unread message, which can already include the oldest one.
  if(!await p.$(`[data-message-id="${oldId}"]`))await textButton(p,dm,'Load earlier messages');await p.waitForSelector(`[data-message-id="${oldId}"]`);}
 assert.equal(await bob.$(`[data-message-id="${oldId}"] summary`),null,'recipient cannot edit/delete another sender');
 assert.equal((await api(bob,{action:'edit',target:conversation.id,messageId:oldId,expectedRevision:0,body:'forged'})).status,404);
 // Stale editor cannot overwrite a concurrent edit and preserves its draft on error.
 await action(alice,oldId,'Edit');await replace(alice,'dialog[open] textarea','My pending edit');
 const remote=await api(alice,{action:'edit',target:conversation.id,messageId:oldId,expectedRevision:0,body:'Other tab edit'});assert.equal(remote.status,200);
 await textButton(alice,'dialog[open]','Save changes');await alice.waitForSelector('dialog[open] [role="alert"]');assert.equal(await alice.$eval('dialog[open] textarea',e=>e.value),'My pending edit');
 await alice.keyboard.press('Escape');await alice.waitForSelector('dialog[open]',{hidden:true});assert.ok(await alice.$(dm),'Escape leaves DM open');
 await alice.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));await alice.waitForFunction(id=>document.querySelector(`[data-message-id="${id}"]`)?.textContent.includes('Other tab edit'),{},oldId);
 await action(alice,oldId,'Edit');await replace(alice,'dialog[open] textarea','Edited old message');await alice.keyboard.press('Enter');await alice.waitForSelector('dialog[open]',{hidden:true});
 await bob.waitForFunction(id=>document.querySelector(`[data-message-id="${id}"]`)?.textContent.includes('Edited old message'),{timeout:22000},oldId);
 assert.match(await bob.$eval(`[data-message-id="${oldId}"] time`,e=>e.textContent),/edited/);
 // Latest message edit/delete changes both the conversation and sidebar preview.
 // The conversation opened at its unread start; replying waits until the newest messages are loaded.
 for(const p of [alice,bob])await p.evaluate(async scope=>{for(let i=0;i<20;i++){const b=[...document.querySelectorAll(scope+' button')].find(b=>b.textContent.trim()==='Load newer messages');if(!b)return;if(!b.disabled)b.click();await new Promise(r=>setTimeout(r,500));}},dm);
 await alice.type('#dm-body','Latest own message');await textButton(alice,dm,'Send message');await alice.waitForFunction(()=>document.querySelector('#dm-body').value==='');
 const latest=await alice.evaluate(async id=>{const r=await(await fetch(`/api/chat/inbox?conversation=${id}`)).json();return r.messages.at(-1);},conversation.id);
 await action(alice,latest.id,'Edit');await replace(alice,'dialog[open] textarea','Latest edited https://example.com/updated');await textButton(alice,'dialog[open]','Save changes');await alice.waitForSelector('dialog[open]',{hidden:true});
 await alice.waitForFunction(()=>document.querySelector('nav')?.textContent.includes('Latest edited https://example.com/updated'));
 await alice.screenshot({path:'/tmp/chat-dm-edit-desktop.png'});
 await remove(alice,latest.id);
 await bob.waitForFunction(id=>!document.querySelector(`[data-message-id="${id}"]`),{timeout:22000},latest.id);
 assert.equal(await alice.$(`[data-message-id="${latest.id}"] summary`),null);assert.equal(await alice.$(`[data-message-id="${latest.id}"] a`),null);
 {const preview=(await api(bob)).data.conversations.find(c=>c.id===conversation.id).lastBody;assert.ok(!preview?.includes('Latest edited'),'the deleted text leaves the conversation preview: '+preview);}
 // Delete an old loaded page too; polling cannot leave its original text behind.
 await remove(alice,oldId);
 await bob.waitForFunction(id=>!document.querySelector(`[data-message-id="${id}"]`),{timeout:22000},oldId);
 // Mobile own-message edit, newline keyboard behavior, and confirmation focus.
 await bob.type('#dm-body','Mobile original');await textButton(bob,dm,'Send message');await bob.waitForFunction(()=>document.querySelector('#dm-body').value==='');
 const mobile=await bob.evaluate(async id=>(await(await fetch(`/api/chat/inbox?conversation=${id}`)).json()).messages.at(-1),conversation.id);
 await action(bob,mobile.id,'Edit');await replace(bob,'dialog[open] textarea','Mobile edited');await bob.keyboard.down('Shift');await bob.keyboard.press('Enter');await bob.keyboard.up('Shift');await bob.type('dialog[open] textarea','Second line');assert.equal(await bob.$eval('dialog[open] textarea',e=>e.value),'Mobile edited\nSecond line');
 await bob.keyboard.press('Enter');await bob.waitForSelector('dialog[open]',{hidden:true});assert.equal(await bob.$eval(`[data-message-id="${mobile.id}"] summary`,e=>document.activeElement===e),true);
 await bob.screenshot({path:'/tmp/chat-dm-delete-mobile.png'});
 assert.equal(await bob.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await bob.reload({waitUntil:'domcontentloaded'});await select(bob,'Alice');await bob.waitForFunction(id=>document.querySelector(`[data-message-id="${id}"]`)?.textContent.includes('Mobile edited'),{},mobile.id);
 await remove(bob,mobile.id);
 // Summary thread has no mutation menu, and its identifier is rejected by the API.
 await fixture('chat_summary_deliveries',{account_id:'00000000-0000-4000-8000-000000000001',client_id:crypto.randomUUID(),room_slug:'main',body:'Private system summary'});
 await alice.evaluate(()=>window.dispatchEvent(new Event('chat-summary-delivered')));await alice.waitForFunction(()=>document.querySelector('section[aria-label="Private conversation"]')?.textContent.includes('Private system summary'));
 assert.equal(await alice.$(`${dm} summary`),null);assert.equal((await api(alice,{action:'delete',target:'room-summaries',messageId:latest.id,expectedRevision:0})).status,400);
 assert.deepEqual(errors,[]);console.log('PASS own-only desktop/mobile edit/delete, stale edit rejection/draft retention, Escape/Enter/Shift+Enter/focus, old-history recipient polling, tombstone/link removal, sidebar preview, reload, and system protection.');
}finally{await browser.close();}
