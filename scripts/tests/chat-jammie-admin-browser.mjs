// Actual production Next pages/routes and current SQL, using synthetic local Auth only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import puppeteer from 'puppeteer';
const base=process.env.CHAT_TEST_URL||'http://localhost:3367',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54567';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
assert(['localhost','127.0.0.1'].includes(new URL(fixture).hostname));
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);const text=await r.text();assert(text,'Fixture failure: '+path+' '+(body.sql||''));return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const identity=await control('identity'),[alice,bob,mallory,jammie]=identity.people;
assert.equal(jammie.id,'6ad10d99-fe91-4955-86fa-a893b9763573');
// Repeatable synthetic baseline; these test-only writes never reach production.
await sql("update profiles set role='user' where id=$1",[jammie.id]);await sql('delete from longboard_chat_owners where user_id=$1',[jammie.id]);
const featureBefore=await sql('select * from chat_feature_members order by account_id');
const post=async(body,room='social',parent=null)=>(await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id) values($1,$1,'Bob',$2,$3,$4) returning *",[bob.member.id,body,room,parent]))[0];
const visible=await post('Admin grant synthetic pin and delete target');
const root=await post('Admin grant synthetic reply root'),reply=await post('Admin grant synthetic nested moderation target','social',root.id);
await sql('delete from longboard_chat_conversations where requester_id=$1 and recipient_id=$2',[alice.member.id,mallory.member.id]);
const privateConversation=(await sql("insert into longboard_chat_conversations(requester_id,recipient_id,status) values($1,$2,'accepted') returning id",[alice.member.id,mallory.member.id]))[0].id;
const privateMessage=(await sql("insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,'Unreported private message',gen_random_uuid()) returning *",[privateConversation,alice.member.id]))[0];
const privateFile=(await sql("insert into chat_attachments(member_id,conversation_id,filename,mime_type,byte_size,upload_path,object_path,sha256,status) values($1,$2,'private.png','image/png',50,$3,$4,$5,'ready') returning id",[alice.member.id,privateConversation,'quarantine/'+crypto.randomUUID(),'clean/'+crypto.randomUUID(),'a'.repeat(64)]))[0].id;
await sql('update longboard_chat_direct_messages set attachment_ids=array[$1]::uuid[] where id=$2',[privateFile,privateMessage.id]);
const browser=await puppeteer.launch({executablePath:process.env.CHAT_BROWSER_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[],unexpected=[];
const api=(p,path,body)=>p.evaluate(async(path,body)=>{const r=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};},path,body);
async function ready(p,selector){await p.waitForSelector(selector,{visible:true});await p.waitForFunction(selector=>{const e=document.querySelector(selector);return Object.keys(e).some(k=>k.startsWith('__reactProps$'));},{},selector);}
async function clickText(p,text,selector='button'){const button=await p.evaluateHandle((selector,text)=>[...document.querySelectorAll(selector)].find(e=>e.textContent.trim()===text),selector,text);assert(await button.asElement(),text);await button.asElement().click();}
async function pageFor(context){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.postData()?.includes('summarize_now'))unexpected.push('summary invocation');});await p.setViewport({width:1440,height:950});return p;}
async function login(email){console.log('Login start',email);const context=await browser.createBrowserContext(),p=await pageFor(context);await p.goto(base+'/login?next=%2Fchat%3Froom%3Dsocial');await p.waitForSelector('#li-email');console.log('Login page loaded',email);await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');console.log('Login submitted',email);await p.waitForFunction(()=>location.pathname==='/chat');await p.goto(base+'/chat?room=social&popout=1');await ready(p,'textarea[aria-label="Message SOCIAL"]');console.log('Login complete',email);return {context,page:p};}
try{
 console.log('Browser '+await browser.version());
 const admin=await login(jammie.email),p=admin.page,member=await login(bob.email),ordinary=member.page;
 assert.equal((await api(p,'/api/admin/users')).status,403);
 assert.equal((await api(p,'/api/chat/admin?room=social')).data.isOwner,false);
 assert.equal((await api(p,'/api/chat/message-pins',{room:'social',messageId:visible.id,action:'pin'})).status,403);
 const beforeCookie=await admin.context.cookies();
 await sql(await readFile(new URL('../../supabase/migrations/20261002203642_chat_jammie_administrator.sql',import.meta.url),'utf8'));
 // Existing normal LB session re-reads the profile: no special JWT/admin login is invented.
 assert.equal((await api(p,'/api/admin/users')).status,200);
 assert.equal((await api(p,'/api/chat/admin?room=social')).data.isOwner,true);
 assert.deepEqual((await admin.context.cookies()).filter(c=>c.name.includes('auth-token')).map(c=>c.value),beforeCookie.filter(c=>c.name.includes('auth-token')).map(c=>c.value));
 assert.equal((await api(ordinary,'/api/admin/users')).status,403);
 assert.equal((await api(ordinary,'/api/chat/admin?room=social')).data.isOwner,false);
 assert.equal((await api(ordinary,'/api/chat/message-pins',{room:'social',messageId:visible.id,action:'pin'})).status,403);
 assert.equal((await api(p,`/api/admin/users/${jammie.id}/role`,{role:'user'})).data.error,'cannot_demote_self');
 await p.goto(base+'/admin');await p.waitForFunction(email=>[...document.querySelectorAll('tbody tr')].some(r=>r.textContent.includes(email)),{},bob.email);
 for(const label of ['PROMOTE','DEMOTE']){
  const button=await p.evaluateHandle((email,label)=>[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(email))?.querySelectorAll('button')&&[...[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(email)).querySelectorAll('button')].find(b=>b.textContent===label),bob.email,label);assert(button.asElement());await button.asElement().click();
  await p.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='CONFIRM '+label),{},label);
  const response=p.waitForResponse(r=>r.url().endsWith(`/api/admin/users/${bob.id}/role`)&&r.request().method()==='POST');
  await clickText(p,'CONFIRM '+label);assert.equal((await response).status(),200);
  await p.waitForFunction((email,expected)=>[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(email))?.textContent.includes(expected),{},bob.email,label==='PROMOTE'?'DEMOTE':'PROMOTE');
  assert.equal((await sql('select role from profiles where id=$1',[bob.id]))[0].role,label==='PROMOTE'?'admin':'user');
 }
 await p.screenshot({path:'/tmp/chat-jammie-admin-users.png'});
 console.log('PASS existing LB session gains admin; existing role UI promotes/demotes another synthetic user, self-demotion and ordinary user remain denied.');
 for(const room of ['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings']){
  assert.equal((await api(p,'/api/chat/history?room='+room)).status,200,room);
  const pinState=await api(p,'/api/chat/message-pins?room='+room);assert.equal(pinState.status,200);assert.equal(pinState.data.canManagePins,true,room);
  assert.equal((await api(p,'/api/chat/admin?room='+room)).data.isOwner,true,room);
 }
 await p.goto(base+'/chat?room=social&popout=1');await ready(p,'textarea[aria-label="Message SOCIAL"]');
 await p.waitForSelector(`#chat-message-${visible.id} button[aria-label="Pin message by Bob"]`);await p.click(`#chat-message-${visible.id} button[aria-label="Pin message by Bob"]`);
 await p.waitForSelector(`[data-pinned-message-id="${visible.id}"]`);assert.equal((await sql('select count(*)::int n from chat_room_message_pins where message_id=$1',[visible.id]))[0].n,1);
 await p.click(`[data-pinned-message-id="${visible.id}"] button[aria-label="Unpin message by Bob"]`);await p.waitForSelector(`[data-pinned-message-id="${visible.id}"]`,{hidden:true});
 await p.click(`#chat-message-${visible.id} summary[aria-label="Actions for message by Bob"]`);await clickText(p,'Delete as admin',`#chat-message-${visible.id} button`);await p.waitForSelector('dialog[open]');await clickText(p,'Delete message','dialog[open] button');await p.waitForSelector(`#chat-message-${visible.id}`,{hidden:true});assert.equal((await sql('select id from longboard_chat_messages where id=$1',[visible.id])).length,0);
 assert.equal((await api(p,'/api/chat/message',{room:'social',messageId:reply.id,action:'delete',expectedRevision:0})).status,200);assert.equal((await sql('select id from longboard_chat_messages where id=$1',[reply.id])).length,0);
 await p.click('button[aria-label="Chat settings"]');await p.waitForFunction(()=>[...document.querySelectorAll('#chat-settings-panel button')].some(b=>b.textContent.startsWith('Admin controls')));const controls=await p.evaluateHandle(()=>[...document.querySelectorAll('#chat-settings-panel button')].find(b=>b.textContent.startsWith('Admin controls')));await controls.asElement().click();await p.waitForSelector('#longboard-chat-admin-panel');
 p.on('dialog',dialog=>dialog.accept());await clickText(p,'PAUSE CHAT');await p.waitForFunction(()=>document.querySelector('#longboard-chat-admin-panel')?.textContent.includes('ROOM PAUSED'));assert.equal((await sql("select is_open from longboard_chat_room_state where room_slug='social'"))[0].is_open,false);
 await p.screenshot({path:'/tmp/chat-jammie-admin-room.png'});await clickText(p,'REOPEN CHAT');await p.waitForFunction(()=>document.querySelector('#longboard-chat-admin-panel')?.textContent.includes('ROOM OPEN'));
 assert.equal((await sql("select count(*)::int n from longboard_chat_admin_events where owner_user_id=$1 and action in ('pause','reopen')",[jammie.id]))[0].n>=2,true);
 assert.equal((await api(p,'/api/chat/message',{room:'gainers',messageId:root.id,action:'delete',expectedRevision:0})).status,403);
 console.log('PASS all eight existing rooms/pin capabilities, visible pin/unpin and admin deletion, nested moderation, pause/reopen/audit, and Gainers write restriction.');
 assert.equal((await api(p,'/api/chat/inbox?conversation='+privateConversation)).status,404);
 assert.equal((await api(p,'/api/chat/inbox',{action:'delete',target:privateConversation,messageId:privateMessage.id,expectedRevision:0})).status,404);
 assert.equal((await api(p,'/api/chat/attachments/'+privateFile)).status,404);
 const report=(await sql('insert into longboard_chat_reports(reporter_id,conversation_id,reason) values($1,$2,$3) returning id',[alice.member.id,privateConversation,'Synthetic submitted report']))[0];
 const reported=await api(p,'/api/chat/reports?id='+report.id);assert.equal(reported.status,200);assert(reported.data.messages.some(m=>m.id===privateMessage.id));
 assert.equal((await api(p,'/api/chat/inbox?conversation='+privateConversation)).status,404);assert.equal((await api(p,'/api/chat/attachments/'+privateFile)).status,404);
 assert.equal((await api(ordinary,'/api/chat/reports?id='+report.id)).status,403);
 assert.equal((await api(p,'/api/chat/features',{action:'approve_release',id:crypto.randomUUID(),confirmed:true,releaseVersion:1,headSha:'a'.repeat(40)})).status,403);
 assert.deepEqual(await sql('select * from chat_feature_members order by account_id'),featureBefore);
 const cookieContext=await browser.createBrowserContext();await cookieContext.setCookie({name:'lb-chat-session',value:'j'.repeat(43),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'});const cookie=await pageFor(cookieContext);await cookie.goto(base+'/chat?room=social&popout=1');await ready(cookie,'textarea[aria-label="Message SOCIAL"]');
 assert.equal((await api(cookie,'/api/chat/history?room=shortscout')).status,200);
 assert.equal((await api(cookie,'/api/admin/users')).status,401);
 assert.equal((await api(cookie,'/api/chat/message-pins',{room:'social',messageId:root.id,action:'pin'})).status,403);
 assert.equal((await api(cookie,'/api/chat/admin?room=social')).data.isOwner,false);
 assert.equal((await api(cookie,'/api/chat/admin?room=social',{action:'set_room_open',isOpen:false})).status,403);
 assert.equal((await api(cookie,'/api/chat/message',{room:'social',messageId:root.id,action:'delete',expectedRevision:0})).status,403);
 assert.equal((await api(cookie,'/api/chat/reports')).status,401);
 assert.equal((await sql('select role from profiles where id=$1',[jammie.id]))[0].role,'admin');
 console.log('PASS DM/attachment privacy and submitted-report exception; release owner unchanged; linked SS cookie remains non-admin for mutations.');
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await p.goto(base+'/chat?room=social&popout=1');await ready(p,'textarea[aria-label="Message SOCIAL"]');await p.click('button[aria-label="Chat settings"]');await p.waitForFunction(()=>document.querySelector('#chat-settings-panel')?.textContent.includes('Admin controls'));await p.screenshot({path:'/tmp/chat-jammie-admin-mobile.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log('PASS mobile control access, no browser runtime errors, no summary invocation.');
}catch(error){for(const [i,page]of(await browser.pages()).entries()){console.error('Failed page',i,page.url());console.error(await page.evaluate(()=>document.body.innerText.slice(0,1200)).catch(()=>''));await page.screenshot({path:'/tmp/chat-jammie-admin-failure-'+i+'.png'}).catch(()=>{});}throw error;}finally{await browser.close();}
