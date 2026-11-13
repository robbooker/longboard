// #450 Agents in chat, on desktop 1280 and phone 390, against the fixture on this test's own ports
// (localhost:3452, database 127.0.0.1:54452). Synthetic data and neutral test names only.
//  - a developer (Bob) makes an agent and its token on the developers page;
//  - the token posts in Developers as the agent; other rooms, DMs and other routes are refused;
//  - another member sees the agent's name, the Agent badge and "run by Bob" on both widths, can
//    open its view and mute it (its posts hide), then unmute it;
//  - Bob pauses the agent: its token fails at once; resuming brings it back;
//  - the admin (Alice) sees the limits for every agent and pauses the agent from there.
// CHAT_SHOT_DIR: also saves agent-post-desktop.png, agent-post-phone.png, agents-settings.png,
// agents-settings-phone.png, agent-ceiling.png and agent-view.png.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3452',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54452';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR;
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const {people:[alice,bob,mallory]}=await control('identity');
const sql=(text,args=[])=>control('sql',{sql:text,args});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const page=async(who,next)=>{const p=await (await browser.createBrowserContext()).newPage();p.on('pageerror',e=>errors.push(`${who.email}: ${e.message}`));p.setDefaultTimeout(60000);await p.setViewport(desktop);
 await signIn(p,base,who.email,{next:'/chat?room=developers',composer:'textarea[aria-label="Message Developers"]'});if(next)await p.goto(base+next);return p;};
const api=(p,path,body)=>p.evaluate(async({path,body})=>{const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json().catch(()=>null)};},{path,body});
const clickButton=(p,text,scope='body')=>p.evaluate(({text,scope})=>{const b=[...document.querySelector(scope).querySelectorAll('button')].find(x=>x.textContent.trim()===text&&!x.disabled&&x.checkVisibility());if(!b)throw Error('no button '+text);b.click();},{text,scope});
const waitText=(p,text)=>p.waitForFunction(t=>document.body.innerText.includes(t),{},text);
const seen=(p,text)=>p.waitForFunction(text=>[...document.querySelectorAll('article')].some(e=>e.checkVisibility()&&e.innerText.includes(text)),{timeout:60000},text);
const gone=(p,text)=>p.waitForFunction(text=>![...document.querySelectorAll('article')].some(e=>e.checkVisibility()&&e.innerText.includes(text)),{timeout:30000},text);
const rowOf=(p,text)=>p.evaluate(text=>{const a=[...document.querySelectorAll('article')].find(e=>e.checkVisibility()&&e.innerText.includes(text));if(!a)return null;a.scrollIntoView({block:'center'});
 const badge=a.querySelector('[data-membership="agent"]'),by=a.querySelector('[data-agent-byline]');
 return {badge:!!badge&&badge.checkVisibility()&&badge.textContent,byline:by?.innerText??'',author:a.querySelector('[data-picture-view][title]')?.textContent??'',you:a.innerText.includes('\nyou\n')};},text);

try{
 console.log('Browser',await browser.version());
 // Bob has developer access; Mallory doesn't.
 await sql('insert into chat_api_access(account_id) values($1) on conflict do nothing',[bob.id]);
 // Neutral chat names for the pictures.
 await sql('update longboard_chat_members set display_name=$2 where id=$1',[bob.member.id,'Sample Owner']);
 await sql('update longboard_chat_members set display_name=$2 where id=$1',[mallory.member.id,'Sample Member']);
 // Alice is the admin (the shared fixture already makes her one; said here so the test stands alone).
 await sql("update profiles set role='admin' where id=$1",[alice.id]);
 assert.equal((await sql('select chat_agent_is_admin($1) a',[alice.id]))[0].a,true,'Alice is an admin');

 // 1. Bob makes an agent and a token on the developers page.
 const owner=await page(bob,'/chat/developers');
 await waitText(owner,'New agent name');
 await owner.type('input[placeholder="e.g. Desk Helper"]','Desk Helper');
 await clickButton(owner,'Create agent');
 await owner.waitForSelector('[data-agent-card="Desk Helper"]');
 await owner.type('[data-agent-card="Desk Helper"] input[placeholder^="Token name"]','home server');
 await clickButton(owner,'Create token','[data-agent-card="Desk Helper"]');
 await owner.waitForSelector('[data-agent-card="Desk Helper"] code');
 const token=await owner.$eval('[data-agent-card="Desk Helper"] code',c=>c.textContent.trim());
 assert.match(token,/^lbc_[A-Za-z0-9_-]{43}$/);
 assert.equal((await sql('select count(*)::int n from chat_agent_tokens where hint=$1',[token.slice(-4)]))[0].n,1,'stored as its own token');
 assert.equal((await sql('select count(*)::int n from chat_api_tokens where hint=$1',[token.slice(-4)]))[0].n,0,'not a personal token');
 await owner.evaluate(()=>document.querySelector('[data-agent-card="Desk Helper"] details').open=true);
 if(shots){await pause(300);await owner.evaluate(()=>document.querySelector('#agents').scrollIntoView());await owner.screenshot({path:`${shots}/agents-settings.png`,fullPage:false});}
 await clickButton(owner,'Done','[data-agent-card="Desk Helper"]');

 // 2. The token posts as the agent in Developers; everything outside its permissions is refused.
 const call=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json().catch(()=>null)};};
 const hello='Nightly build passed. Details in the log.';
 const posted=await call('/api/chat',{room:'developers',action:'send',body:hello,clientId:randomUUID()});
 assert.equal(posted.status,200,JSON.stringify(posted.data));
 assert.equal(posted.data.message.author_label,'Desk Helper');assert.equal(posted.data.message.agent.owner,'Sample Owner');
 const row=(await sql('select member_id,agent_id from longboard_chat_messages where id=$1',[posted.data.message.id]))[0];
 assert.equal(row.member_id,bob.member.id,'the owner is on the row');assert.ok(row.agent_id);
 const history=await call('/api/chat/history?room=developers');assert.equal(history.status,200);
 const read=history.data.messages.find(m=>m.id===posted.data.message.id);assert.equal(read.author_label,'Desk Helper');assert.equal(read.agent.owner,'Sample Owner');
 const blocked=await call('/api/chat',{room:'social',action:'send',body:'Hello Social',clientId:randomUUID()});
 assert.equal(blocked.status,403,JSON.stringify(blocked.data));
 assert.equal((await call('/api/chat/history?room=social')).status,403,'Social is not a room it may read');
 for(const path of ['/api/chat/inbox','/api/chat/member','/api/chat/dm-members?q=Al','/api/chat/mentions?q=Al&room=developers','/api/chat/api-tokens','/api/chat/agents'])
  assert.equal((await call(path)).status,403,path);
 assert.equal((await call('/api/chat/message',{action:'delete',room:'developers',messageId:posted.data.message.id})).status,403,'no edits or deletes');
 const batch=await call('/api/chat/updates',{paths:['/api/chat?room=developers','/api/chat/inbox']});
 assert.deepEqual(batch.data.results.map(x=>x.status),[200,403]);

 // 3. Another member sees the badge and "run by" on both widths, can mute and unmute.
 const member=await page(mallory);
 for(const [view,size] of [['desktop',desktop],['phone',phone]]){
  await member.setViewport(size);await member.goto(`${base}/chat?room=developers`);await seen(member,hello);await pause(500);
  const r=await rowOf(member,hello);
  assert.equal(r.badge,'Agent',`${view}: Agent badge`);assert.match(r.byline,/run by Sample Owner/,`${view}: run by`);assert.match(r.author,/Desk Helper/,`${view}: the agent's name`);
  assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${view}: no page scroll`);
  if(shots){await pause(300);await member.screenshot({path:`${shots}/agent-post-${view}.png`});}
 }
 await member.setViewport(desktop);await member.goto(`${base}/chat?room=developers`);await seen(member,hello);
 // Its owner sees it as the agent too, never as "you".
 await owner.goto(`${base}/chat?room=developers`);await seen(owner,hello);
 const ownView=await rowOf(owner,hello);assert.equal(ownView.badge,'Agent');assert.equal(ownView.you,false,'not marked as the owner\'s own post');assert.match(ownView.author,/Desk Helper/);
 await member.evaluate(text=>[...document.querySelectorAll('article')].find(e=>e.checkVisibility()&&e.innerText.includes(text)).querySelector('button[data-picture-view][title]').click(),hello);
 const VIEW='dialog[data-member-picture-view][open]';
 await member.waitForSelector(VIEW);
 const viewText=await member.$eval(VIEW,d=>d.innerText);assert.match(viewText,/Desk Helper/);assert.match(viewText,/run by Sample Owner/);assert.doesNotMatch(viewText,/Message privately/);
 if(shots){await pause(300);await member.screenshot({path:`${shots}/agent-view.png`});}
 await member.click(`${VIEW} button[data-agent-mute]`);
 await member.waitForFunction(v=>document.querySelector(v)?.innerText.includes('Unmute this agent'),{},VIEW);
 await member.click(`${VIEW} button[aria-label="Close"]`);
 await gone(member,hello);
 await member.reload();await member.waitForSelector('textarea[aria-label="Message Developers"]',{visible:true});await pause(1500);
 assert.equal(await member.evaluate(t=>[...document.querySelectorAll('article')].some(e=>e.checkVisibility()&&e.innerText.includes(t)),hello),false,'still hidden after a reload');
 assert.equal((await api(member,'/api/chat/agents/mutes')).data.muted.length,1);
 assert.equal((await api(member,'/api/chat/agents/mutes',{agentId:row.agent_id,muted:false})).status,200);
 await member.reload();await seen(member,hello);

 // 4. Bob pauses the agent: the token stops at once; resume brings it back.
 await owner.goto(`${base}/chat/developers`);await owner.waitForSelector('[data-agent-card="Desk Helper"]');
 await clickButton(owner,'Pause','[data-agent-card="Desk Helper"]');
 await owner.waitForFunction(()=>document.querySelector('[data-agent-card="Desk Helper"]').innerText.includes('Paused'));
 const paused=await call('/api/chat',{room:'developers',action:'send',body:'Should not post',clientId:randomUUID()});
 assert.equal(paused.status,403);assert.equal(paused.data.error,'agent_paused');
 assert.equal((await call('/api/chat/history?room=developers')).data.error,'agent_paused');
 await clickButton(owner,'Resume','[data-agent-card="Desk Helper"]');
 await owner.waitForFunction(()=>document.querySelector('[data-agent-card="Desk Helper"]').innerText.includes('Active'));
 assert.equal((await call('/api/chat/history?room=developers')).status,200,'resumed');
 if(shots){await owner.setViewport(phone);await owner.reload();await owner.waitForSelector('[data-agent-card="Desk Helper"]');await owner.evaluate(()=>document.querySelector('#agents').scrollIntoView());await pause(300);await owner.screenshot({path:`${shots}/agents-settings-phone.png`});}
 assert.equal(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'settings: no page scroll');

 // 5. The admin control: only for admins; the admin pauses any agent.
 assert.equal((await api(owner,'/api/chat/agents/admin')).status,403,'owners are not admins');
 assert.equal(await owner.evaluate(()=>!!document.querySelector('[data-agent-ceiling]')),false);
 const admin=await page(alice,'/chat/developers');
 await admin.waitForSelector('[data-agent-ceiling] [data-admin-agent="Desk Helper"]');
 if(shots){await admin.evaluate(()=>document.querySelector('[data-agent-ceiling]').scrollIntoView());await pause(300);await admin.screenshot({path:`${shots}/agent-ceiling.png`});}
 await clickButton(admin,'Pause','[data-admin-agent="Desk Helper"]');
 await waitText(admin,'Desk Helper paused.');
 assert.equal((await call('/api/chat/history?room=developers')).data.error,'agent_paused','admin pause');
 await owner.reload();await owner.waitForSelector('[data-agent-card="Desk Helper"]');
 assert.match(await owner.$eval('[data-agent-card="Desk Helper"]',e=>e.innerText),/Paused by an admin/);
 assert.deepEqual(errors,[]);
 console.log('PASS agents: made on the developers page with its own token, posts as the agent (owner kept on the row), Agent badge and "run by" on desktop 1280 + phone 390, blocked rooms and routes refused, mute hides its posts, owner and admin pause stop the token at once, admin-only limits.');
}finally{await browser.close();}
