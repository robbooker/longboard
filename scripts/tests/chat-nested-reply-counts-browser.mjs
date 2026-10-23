// Real app → authorized count/send/delete handlers → current synthetic SQL.
// Since #301 (one level of replies) the seeded replies to replies count under the original message.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.CHAT_TEST_URL||'http://localhost:3360',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54560';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
const sql=(sql,args=[],broadcast)=>control('sql',{sql,args,broadcast});
const {people}=await control('identity'),[alice]=people;
await sql("update profiles set role='admin' where id=$1",[alice.id]);
const post=async(body,parent=null)=>{const [row]=await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id) values($1,$1,'Alice',$2,'main',$3) returning *",[alice.member.id,body,parent],'longboard_chat_messages');return row;};
const root=await post('Nested counts root');
const children=(await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) select $1,$1,'Alice','Nested count row '||n,'main',$2,now()-interval '1 minute'+n*interval '1 millisecond' from generate_series(1,100) n returning *",[alice.member.id,root.id])).sort((a,b)=>a.id.localeCompare(b.id));
const special=[78,79,80,99],grand=[];for(const index of special)grand.push(await post('Nested grandchild '+index,children[index].id));
const great=await post('Nested great grandchild',grand[0].id);
// Seed history predates the unchanged production anti-spam send window.
await sql("update longboard_chat_messages set created_at=created_at-interval '1 day' where member_id=$1",[alice.member.id]);
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const errors=[],countReads=[],badCountResponses=[];
const panel='aside[aria-label="Comment replies"]';
const row=id=>`${panel} [data-thread-message-id="${id}"]`;
const button=id=>`${row(id)} button[data-has-replies]`;
// AVATARS-REST: a thread link reads "[tiles] 2 replies · last …"; compare its count, or the empty "↳ Reply".
const label=n=>n?`${n} ${n===1?'reply':'replies'}`:'↳ Reply';
const api=(page,path,body)=>page.evaluate(async(path,body)=>{const r=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};},path,body);
async function waitCount(page,id,n,selector=button(id)){await page.waitForFunction((selector,label)=>(e=>e&&(e.querySelector('[data-reply-count]')?.textContent??e.textContent).trim())(document.querySelector(selector))===label,{timeout:20000},selector,label(n));assert.equal(await page.$eval(selector,e=>e.dataset.hasReplies),String(n>0));}
async function login(){const context=await browser.createBrowserContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/chat/updates')&&r.method()==='POST')for(const path of JSON.parse(r.postData()).paths)if(path.startsWith('/api/chat/thread-counts?'))countReads.push(path);});page.on('response',async r=>{if(r.url().endsWith('/api/chat/updates'))try{for(const result of (await r.json()).results??[])if(result.path.startsWith('/api/chat/thread-counts?')&&result.status!==200)badCountResponses.push(result);}catch{}});await page.setViewport({width:1440,height:950});await page.goto(base+'/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>{const f=document.querySelector('#li-email')?.form;return f&&Object.keys(f).some(k=>k.startsWith('__reactProps$')&&typeof f[k]?.onSubmit==='function');});await page.type('#li-email',alice.email);await page.type('#li-password','demo-only');await page.click('button[type=submit]');await page.waitForSelector('textarea[aria-label="Message LB"]');return page;}
// #301: replies are one level. The grandchildren and great-grandchild seeded above are stored under
// the original message (the insert trigger), so the original counts all 105 and no reply has a
// Reply link or count of its own.
const rootButton=`#chat-message-${root.id} button[data-has-replies]`;
const noReplyOnReplies=async(page,where)=>assert.equal(await page.$$eval(`${panel} [aria-label="Replies to this comment"] article button`,bs=>bs.filter(b=>b.checkVisibility()&&(b.hasAttribute('data-has-replies')||/^↳ (Reply|\d+ repl)/.test(b.textContent.trim()))).length),0,where+': no Reply on replies');
try{
 for(const m of [...grand,great])assert.equal((await sql('select reply_to_id from longboard_chat_messages where id=$1',[m.id]))[0].reply_to_id,root.id,'stored under the original message');
 const page=await login();await page.goto(`${base}/chat?room=main&thread=${root.id}`);await page.waitForSelector(row(great.id));
 assert.equal(await page.$$eval(`${panel} [aria-label="Replies to this comment"] article`,rows=>rows.length),100,'the newest 100 of 105 replies in the thread window');
 await noReplyOnReplies(page,'desktop');
 await waitCount(page,root.id,105,rootButton);
 // Published pin controls still sit on a reply.
 await page.click(`${row(children[79].id)} summary[aria-label="Actions for message by Alice"]`);await page.click(`${row(children[79].id)} button[aria-label="Pin message by Alice"]`);await page.waitForSelector(`[data-pinned-message-id="${children[79].id}"]`);
 const covered=new Set(countReads.flatMap(path=>new URL(path,base).searchParams.get('ids').split(',')));assert(covered.has(root.id),'the original message is counted');
 // A lost successful acknowledgement retries the same client ID without +1 guesses.
 await page.evaluate(()=>{const native=window.fetch.bind(window);window.__countSendBodies=[];window.fetch=async(...args)=>{const body=typeof args[1]?.body==='string'?JSON.parse(args[1].body):{};const response=await native(...args);if(args[0]==='/api/chat'&&body.action==='send'){window.__countSendBodies.push(body);if(window.__countSendBodies.length===1&&response.ok)return Response.json({error:'Synthetic lost acknowledgement'},{status:503});}return response;};});
 await page.type('#thread-reply','Retry after a lost acknowledgement');await page.keyboard.press('Enter');await page.waitForSelector(`${panel} [data-send-state="failed"]`);
 const retry=await page.$(`${panel} [data-send-state="failed"] button`);await retry.click();await page.waitForFunction(()=>window.__countSendBodies.length===2);await page.waitForSelector(`${panel} [data-send-state]`,{hidden:true});
 const sends=await page.evaluate(()=>window.__countSendBodies);assert.equal(sends.length,2);assert.equal(sends[0].clientId,sends[1].clientId);
 const sent=await sql('select * from longboard_chat_messages where client_id=$1',[sends[0].clientId]);assert.equal(sent.length,1);assert.equal(sent[0].reply_to_id,root.id);
 await waitCount(page,root.id,106,rootButton);
 // Realtime: a reply to a reply (an older client) lands in the one list and the original's count.
 const extra=await post('Realtime reply to a reply',children[78].id);assert.equal(extra.reply_to_id,root.id);await waitCount(page,root.id,107,rootButton);
 const remove=async message=>{const r=await api(page,'/api/chat/message',{action:'delete',room:'main',messageId:message.id,expectedRevision:message.revision??0});assert.equal(r.status,200);await sql('select * from longboard_chat_messages where id=$1',[message.id],'longboard_chat_messages');};
 await remove(extra);await waitCount(page,root.id,106,rootButton);
 // A deleted reply has no replies under it now, so it stops taking space and stops counting.
 await remove(children[79]);await page.waitForSelector(row(children[79].id),{hidden:true});await page.waitForSelector(`[data-pinned-message-id="${children[79].id}"]`,{hidden:true});await waitCount(page,root.id,105,rootButton);
 await noReplyOnReplies(page,'desktop after changes');
 await page.screenshot({path:'/tmp/chat-nested-counts-desktop.png'});
 console.log('PASS desktop: 105 replies (formerly nested) in one list under the original, no Reply on replies, lost-ACK retry, realtime add/delete of a reply to a reply, deleted reply pruned.');
 for(const width of [320,390]){await page.setViewport({width,height:900});await page.waitForSelector(row(great.id));await noReplyOnReplies(page,'mobile '+width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`/tmp/chat-nested-counts-mobile-${width}.png`});}
 console.log('PASS mobile 320/390: one list, no Reply on replies, no horizontal overflow.');
 await page.setViewport({width:1440,height:950});await page.goto(base+'/chat/quad');await page.waitForSelector('select');await page.select('select','room:main');await page.waitForSelector(`#chat-message-${root.id} button[data-has-replies="true"]`,{visible:true});await page.click(`#chat-message-${root.id} button[data-has-replies="true"]`);await page.waitForSelector(row(great.id));await noReplyOnReplies(page,'quad');
 const quad=await post('Quad reply to a reply',grand[3].id);await waitCount(page,root.id,106,rootButton);await remove(quad);await waitCount(page,root.id,105,rootButton);await page.screenshot({path:'/tmp/chat-nested-counts-quad.png'});
 assert(countReads.every(path=>new URL(path,base).searchParams.get('ids').split(',').length<=80));assert.deepEqual(badCountResponses,[]);assert.deepEqual(errors,[]);
 console.log('PASS Quad: the original counter reacts to replies to replies being added and deleted; all observed count requests ≤80 IDs and successful, zero browser runtime errors.');
}catch(error){for(const [i,page]of(await browser.pages()).entries()){console.error('Failure page',i,page.url());await page.screenshot({path:`/tmp/chat-nested-counts-failure-${i}.png`}).catch(()=>{});}throw error;}finally{await browser.close();}
