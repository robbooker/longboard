// Synthetic fixture only: localhost 3351/54551, no production credentials/messages.
import puppeteer from 'puppeteer';import assert from 'node:assert/strict';
const base='http://localhost:3351',rest='http://127.0.0.1:54551';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];
async function login(email,width){const context=await browser.createBrowserContext(),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width,height:900});await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.waitForFunction(()=>{const form=document.querySelector('#li-email')?.form;return form&&Object.keys(form).some(key=>key.startsWith('__reactProps$')&&typeof form[key]?.onSubmit==='function');});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label="Message LB"]');return p;}
async function api(p,path,body){return p.evaluate(async(path,body)=>{const r=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};},path,body);}
async function fixture(path,body){const r=await fetch(rest+'/rest/v1/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,await r.clone().text());return r.json();}
async function button(p,scope,text){for(const b of await p.$$(`${scope} button`))if((await b.evaluate(e=>e.textContent)).trim()===text){await p.waitForFunction(element=>Object.keys(element).some(key=>key.startsWith('__reactProps$')&&typeof element[key]?.onClick==='function'),{},b);await b.click();return;}throw Error('Missing '+text+' in '+scope);}
async function remove(p,scope){await p.click(scope+' summary');await button(p,scope,'Delete');assert.equal(await p.$('dialog[open]'),null,'Own deletion requires no confirmation');}
const panel='aside[aria-label="Comment replies"]';
try{
 const alice=await login('alice@example.test',1440),bob=await login('bob@example.test',390);
 const members=await fixture('longboard_chat_members?select=id,user_id');
 const account=i=>`00000000-0000-4000-8000-00000000000${i}`;
 const member=i=>members.find(m=>m.user_id===account(i)).id;
 const post=async(i,body,parent=null)=>{const id=crypto.randomUUID();await fixture('longboard_chat_messages',{id,guest_id:member(i),member_id:member(i),author_label:i===1?'Alice':'Bob',body,room_slug:'main',reply_to_id:parent});return id;};
 for(const width of [1440,390]){
  await alice.setViewport({width,height:900});
  const root=await post(1,`Root deleted words ${width}`),own=await post(1,`Own leaf ${width}`,root),other=await post(2,'Other member survives',root);
  await alice.goto(`${base}/chat?room=main&thread=${root}`,{waitUntil:'domcontentloaded'});await alice.waitForSelector(`${panel} [data-thread-message-id="${own}"] summary`);
  await alice.type('#thread-reply','Draft survives deletion');
  await remove(alice,`${panel} [data-thread-message-id="${own}"]`);await alice.waitForSelector(`${panel} [data-thread-message-id="${own}"]`,{hidden:true});
  assert.equal(await alice.$eval('#thread-reply',e=>e.value),'Draft survives deletion');
  assert(await alice.$(`${panel} [data-thread-message-id="${other}"]`));
  await remove(alice,`${panel} [aria-label="Original comment"]`);
  await alice.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('Message deleted'),{},`${panel} [aria-label="Original comment"]`);
  assert.equal(await alice.$eval('#thread-reply',e=>e.value),'Draft survives deletion');
  assert(await alice.$(`${panel} [data-thread-message-id="${other}"]`));
  assert(!(await alice.$eval(panel,e=>e.textContent)).includes(`Root deleted words ${width}`));
  await alice.click(`${panel} [aria-label="Original comment"] summary`);await button(alice,`${panel} [aria-label="Original comment"]`,'Edit');await alice.waitForSelector('dialog[open] textarea');
  assert.equal(await alice.$eval('dialog[open] textarea',e=>e.value),'','Deleted editor starts empty');
  await alice.type('dialog[open] textarea',`Deliberate replacement ${width}`);await alice.keyboard.press('Enter');await alice.waitForSelector('dialog[open]',{hidden:true});
  await alice.waitForFunction((selector,text)=>document.querySelector(selector)?.textContent.includes(text),{},`${panel} [aria-label="Original comment"]`,`Deliberate replacement ${width}`);
  const saved=(await fixture('longboard_chat_messages?id=eq.'+root))[0];assert.equal(saved.deleted_at,null);assert.equal(saved.revision,2);assert.deepEqual(saved.attachment_ids,[]);
  assert.equal((await api(bob,'/api/chat/message',{action:'delete',room:'main',messageId:root,expectedRevision:2,admin:true,p_admin:true})).status,403);
  await alice.screenshot({path:`/tmp/delete-thread-${width}.png`});
  const leaf=await post(1,`Main leaf ${width}`);await alice.goto(base+'/chat?room=main',{waitUntil:'domcontentloaded'});await alice.waitForSelector(`#chat-message-${leaf} summary`);await remove(alice,`#chat-message-${leaf}`);await alice.waitForSelector(`#chat-message-${leaf}`,{hidden:true});
  const gone=(await fixture('longboard_chat_messages?id=eq.'+leaf))[0];assert(gone.removed);assert.equal(gone.body,'Message deleted');
  const retry=await api(alice,'/api/chat/message',{action:'delete',room:'main',messageId:leaf,expectedRevision:0});assert.equal(retry.status,200);assert(retry.data.message.removed);
  await alice.reload({waitUntil:'domcontentloaded'});assert.equal(await alice.$(`#chat-message-${leaf}`),null);
  console.log(`PASS ${width}px: immediate own room/reply removal, retained root/replies, empty edit/replacement, draft preservation, persisted removal, ownership.`);
 }
 // Hold an actual successful send ACK while another owner session deletes its server row.
 const otherOwner=await login('alice@example.test',1440);
 async function holdSend(p){await p.evaluate(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0])==='/api/chat'&&JSON.parse(args[1]?.body||'{}').action==='send'&&response.ok){window.__heldMessage=(await response.clone().json()).message;return new Promise(resolve=>{window.__releaseAck=()=>resolve(response);});}return response;};});}
 for(const mode of ['room','thread']){
  const thread=mode==='thread'?await post(1,'Held ACK thread'):null;
  await alice.setViewport({width:1440,height:900});await alice.goto(`${base}/chat?room=main${thread?'&thread='+thread:''}`,{waitUntil:'domcontentloaded'});
  const input=thread?'#thread-reply':'textarea[aria-label="Message LB"]';await alice.waitForSelector(input);await holdSend(alice);
  // Existing anti-spam spacing applies to real sends.
  await new Promise(resolve=>setTimeout(resolve,1600));await alice.type(input,'Held ACK must stay deleted '+mode);await alice.focus(input);await alice.keyboard.press('Enter');
  await alice.waitForFunction(()=>window.__heldMessage?.id);
  const held=await alice.evaluate(()=>window.__heldMessage);
  const row=thread?`[data-thread-message-id="${held.id}"]`:`#chat-message-${held.id}`;
  await alice.evaluate(()=>window.dispatchEvent(new Event('chat-room-refresh')));await alice.waitForSelector(row);
  const result=await api(otherOwner,'/api/chat/message',{action:'delete',room:'main',messageId:held.id,expectedRevision:0});assert.equal(result.status,200);
  await alice.evaluate(()=>window.dispatchEvent(new Event('chat-room-refresh')));await alice.waitForSelector(row,{hidden:true});
  await alice.evaluate(()=>window.__releaseAck());
  await new Promise(resolve=>setTimeout(resolve,300));assert.equal(await alice.$(row),null,'A released old ACK never restores a deletion learned from polling');
  assert(!(await alice.$eval(thread?panel:'main',e=>e.textContent)).includes('Held ACK must stay deleted '+mode));
  console.log('PASS cross-session '+mode+' deletion learned through poll before held send ACK, without resurrection.');
 }
 const conversations=await fixture('longboard_chat_conversations?select=id,requester_id,recipient_id,status');const convo=conversations.find(c=>[c.requester_id,c.recipient_id].includes(member(1))&&[c.requester_id,c.recipient_id].includes(member(2)));
 if(convo.status==='pending')await fixture('rpc/longboard_chat_dm_action',{p_user_id:account(1),p_action:'accept',p_target:convo.id});
 for(const width of [1440,390]){
  const id=crypto.randomUUID();await fixture('longboard_chat_direct_messages',{id,conversation_id:convo.id,sender_id:member(1),body:`Flat DM delete ${width}`,client_id:crypto.randomUUID()});
  await alice.setViewport({width,height:900});await alice.goto(`${base}/chat?dm=${convo.id}`,{waitUntil:'domcontentloaded'});await alice.waitForSelector(`[data-message-id="${id}"] summary`);
  await remove(alice,`[data-message-id="${id}"]`);await alice.waitForSelector(`[data-message-id="${id}"]`,{hidden:true});
  const gone=(await fixture('longboard_chat_direct_messages?id=eq.'+id))[0];assert(gone.deleted_at);assert.equal(gone.body,'Message deleted');
  await alice.reload({waitUntil:'domcontentloaded'});await alice.waitForSelector('section[aria-label="Selected conversation"]');assert.equal(await alice.$(`[data-message-id="${id}"]`),null);
  await bob.goto(`${base}/chat?dm=${convo.id}`,{waitUntil:'domcontentloaded'});await bob.waitForSelector('section[aria-label="Selected conversation"]');assert.equal(await bob.$(`[data-message-id="${id}"]`),null);
  await alice.screenshot({path:`/tmp/delete-dm-${width}.png`});console.log(`PASS ${width}px: DM deletion removes whole row for sender and recipient, persists backend sequence tombstone.`);
 }
 assert.deepEqual(errors,[],'No browser runtime errors');console.log('PASS no browser runtime errors.');
}catch(error){for(const [index,page] of (await browser.pages()).entries()){console.error('Failure page',index,page.url());await page.screenshot({path:`/tmp/delete-failure-${index}.png`}).catch(()=>{});}throw error;}finally{await browser.close();}
