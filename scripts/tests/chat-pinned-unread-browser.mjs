// Actual Next app → activity/read RPCs → isolated PGlite database. Synthetic data only.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const base=process.env.CHAT_TEST_URL||'http://localhost:3357',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54557';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
const sql=(sql,args=[],broadcast)=>control('sql',{sql,args,broadcast});
const identity=await control('identity'),[alice,bob]=identity.people,errors=[];
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const refresh=page=>page.evaluate(()=>{window.dispatchEvent(new Event('chat-activity-refresh'));window.dispatchEvent(new Event('chat-pins-changed'));});
const api=(p,path,body)=>p.evaluate(async(path,body)=>{const r=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};},path,body);
const button=label=>`[data-chat-pins="sidebar"] [aria-label="Open pinned ${label}"]`;
async function badge(page,label,count){await page.waitForFunction((selector,count)=>{const node=document.querySelector(selector);return !!node&&(count===null?!node.querySelector('[data-pin-unread]'):node.querySelector('[data-pin-unread]')?.getAttribute('data-pin-unread')===String(count));},{timeout:20000},button(label),count);}
async function login(email,width=1440){const context=await browser.createBrowserContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width,height:950});await page.goto(base+'/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>{const f=document.querySelector('#li-email')?.form;return f&&Object.keys(f).some(k=>k.startsWith('__reactProps$')&&typeof f[k]?.onSubmit==='function');});await page.type('#li-email',email);await page.type('#li-password','demo-only');await page.click('button[type=submit]');await page.waitForSelector('textarea[aria-label="Message LB"]');return {context,page};}
const incomingDm=(id,body='Pinned unread DM')=>sql('insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values($1,$2,$3,gen_random_uuid()) returning *',[id,bob.member.id,body],'longboard_chat_direct_messages');
const incomingRoom=(room,body='Pinned unread room')=>sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Bob',$2,$3) returning *",[bob.member.id,body,room],'longboard_chat_messages');
try{
 const {page,context}=await login(alice.email);
 const inbox=await api(page,'/api/chat/inbox'),dm=inbox.data.conversations.find(c=>c.otherName==='Bob').id;
 assert.equal((await api(page,'/api/chat/inbox',{action:'accept',target:dm})).status,200);
 assert.equal((await api(page,'/api/chat/activity',{kind:'dm',id:dm,dmThrough:999999})).status,200);
 for(const target of [{kind:'room',room:'main'},{kind:'room',room:'social'},{kind:'dm',conversationId:dm}])assert.equal((await api(page,'/api/chat/pins',{action:'pin',target})).status,200);
 await refresh(page);await badge(page,'Bob',null);await badge(page,'LB',null);
 // Realtime arrives through the existing coordinator, with no explicit UI refresh.
 await incomingRoom('social');await badge(page,'SOCIAL',1);
 await incomingDm(dm);await badge(page,'Bob',1);
 const accessible=await page.$eval(button('Bob'),node=>document.getElementById(node.getAttribute('aria-describedby'))?.textContent);assert.equal(accessible,'1 unread messages');
 await page.screenshot({path:'/tmp/chat-pinned-unread-desktop.png'});
 // Opening a pinned target retains the existing read semantics and clears its count.
 await page.click(button('SOCIAL'));await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');await badge(page,'SOCIAL',null);
 await page.click(button('Bob'));await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='Bob');await badge(page,'Bob',null);
 await page.click(button('LB'));await page.waitForSelector('textarea[aria-label="Message LB"]');
 // Large counts stay compact. All counts survive a deliberately oversized UTF-8 preview sample.
 await sql("insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) select $1,$2,$3||n,gen_random_uuid() from generate_series(1,105) n returning *",[dm,bob.member.id,'😅界'.repeat(100)+' '],'longboard_chat_direct_messages');
 await badge(page,'Bob',105);assert.equal(await page.$eval(button('Bob')+' [data-pin-unread]',e=>e.textContent),'99+');
 // The old pinned conversation falls outside SQL's 100-preview list.
 await sql(`do $$declare a uuid;m uuid;c uuid;begin for n in 1..101 loop
 a:=gen_random_uuid();insert into auth.users values(a);insert into profiles values(a,'pin-browser-'||n||'@example.test','user');insert into chat_accounts(id,longboard_user_id) values(a,a);
 m:=(longboard_chat_link_member(a,'Unread Peer '||n,null)->>'id')::uuid;c:=gen_random_uuid();
 insert into longboard_chat_conversations(id,requester_id,recipient_id,status) values(c,'${alice.member.id}',m,'accepted');
 insert into longboard_chat_direct_messages(conversation_id,sender_id,body,client_id) values(c,m,repeat('😅界',200),gen_random_uuid());end loop;end $$;`);
 await refresh(page);await badge(page,'Bob',105);
 const crowded=await api(page,'/api/chat/activity');assert.equal(crowded.data.pinnedDmUnread[dm],105);assert(!crowded.data.dms.some(row=>row.id===dm));assert(Buffer.byteLength(JSON.stringify(crowded.data),'utf8')<=32768);
 // Simulate the optional field being absent during rolling deployment, not zero.
 let mode='old',held=false,release;await page.setRequestInterception(true);
 page.on('request',async request=>{
  if(!request.url().endsWith('/api/chat/updates')||request.method()!=='POST'||!mode)return request.continue();
  try{const response=await fetch(request.url(),{method:'POST',headers:request.headers(),body:request.postData()});const data=await response.json();for(const result of data.results??[])if(result.path==='/api/chat/activity'){if(mode==='old')delete result.data.pinnedDmUnread;else if(mode==='error'){result.status=503;result.data={error:'Synthetic unavailable'};}else if(mode==='hold'){held=true;await new Promise(resolve=>{release=resolve;});}}await request.respond({status:response.status,contentType:'application/json',body:JSON.stringify(data)});}catch{await request.abort().catch(()=>{});}
 });
 await refresh(page);await badge(page,'Bob',null);mode='';await refresh(page);await badge(page,'Bob',105);
 mode='error';await refresh(page);await badge(page,'Bob',null);mode='';await refresh(page);await badge(page,'Bob',105);
 // Mobile drawer uses the same pins/counts with no overflow and full accessible names.
 for(const width of [320,390]){await page.setViewport({width,height:900});await page.click('button[aria-label="Open room navigation"]');await page.waitForFunction(selector=>document.querySelector(selector)?.getBoundingClientRect().width>0&&getComputedStyle(document.querySelector('#chat-room-navigation')).opacity==='1',{},button('Bob'));await badge(page,'Bob',105);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.$eval(button('Bob')+' span:nth-child(2)',e=>getComputedStyle(e).textAlign),'left');await page.screenshot({path:`/tmp/chat-pinned-unread-mobile-${width}.png`});await page.click('button[class*=mobileNavBack]');}
 await page.setViewport({width:1440,height:950});
 // Unpinning changes only the saved target, and re-pinning refreshes its count.
 await page.click('[aria-label="Unpin Bob"]');await page.waitForSelector(button('Bob'),{hidden:true});assert.equal((await api(page,'/api/chat/activity')).data.pinnedDmUnread[dm],undefined);
 await api(page,'/api/chat/pins',{action:'pin',target:{kind:'dm',conversationId:dm}});await refresh(page);await badge(page,'Bob',105);
 // Existing block and room-authorization revocation hide counts; opening revalidates pins.
 await api(page,'/api/chat/inbox',{action:'block',target:dm});await page.evaluate(()=>window.dispatchEvent(new Event('chat-activity-refresh')));await badge(page,'Bob',null);
 await page.click(button('Bob'));await page.waitForSelector(button('Bob'),{hidden:true});
 await api(page,'/api/chat/inbox',{action:'unblock',target:dm});await refresh(page);await badge(page,'Bob',105);
 await page.click(button('SOCIAL'));await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');await incomingRoom('main');await badge(page,'LB',1);
 await sql('delete from user_tags where user_id=$1',[alice.id]);await page.evaluate(()=>window.dispatchEvent(new Event('chat-activity-refresh')));await badge(page,'LB',null);
 await page.click(button('LB'));await page.waitForSelector(button('LB'),{hidden:true});await sql("insert into user_tags values($1,'boardroom-cohort-1')",[alice.id]);await refresh(page);
 // Quad retains its existing layout/read behavior; that same truth drives the Single pins.
 await page.goto(base+'/chat/quad');await page.waitForSelector('select');await page.select('select','room:social');await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');
 await incomingRoom('social','Read through Quad');await page.waitForFunction(()=>document.body.textContent.includes('Read through Quad'));await page.waitForFunction(async()=>{const r=await fetch('/api/chat/activity');return(await r.json()).roomMessageCounts.social===0;});
 await page.goto(base+'/chat?room=main');await page.waitForSelector('textarea[aria-label="Message LB"]');await badge(page,'SOCIAL',null);await badge(page,'Bob',105);
 // Separate account data cannot inherit Alice's pinned list or count map.
 const second=await login(bob.email,390);assert.deepEqual((await api(second.page,'/api/chat/pins')).data.pins,[]);assert.deepEqual((await api(second.page,'/api/chat/activity')).data.pinnedDmUnread,{});assert.equal(await second.page.$('[data-pin-unread]'),null);await second.context.close();
 // A real Supabase local sign-out broadcasts to the mounted chat client while
 // its old activity response is held. The old snapshot cannot restore cleared pins.
 const logout=await build({stdin:{contents:`import {createBrowserClient} from '@supabase/ssr';window.logoutPinsTest=()=>createBrowserClient(${JSON.stringify(fixture)},'test-anon').auth.signOut({scope:'local'});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
 await page.addScriptTag({content:logout.outputFiles[0].text});mode='hold';await refresh(page);
 for(let i=0;i<100&&!held;i++)await new Promise(resolve=>setTimeout(resolve,25));assert(held,'old activity response is held');
 await page.evaluate(()=>window.logoutPinsTest()).catch(()=>{});mode='';release();await page.waitForFunction(()=>location.pathname.includes('login'));assert.equal(await page.$('[data-pin-unread]'),null);
 await page.goto(base+'/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>{const f=document.querySelector('#li-email')?.form;return f&&Object.keys(f).some(k=>k.startsWith('__reactProps$')&&typeof f[k]?.onSubmit==='function');});await page.click('#li-email');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type('#li-email',bob.email);await page.type('#li-password','demo-only');await page.click('button[type=submit]');await page.waitForSelector('textarea[aria-label="Message LB"]');assert.deepEqual((await api(page,'/api/chat/activity')).data.pinnedDmUnread,{});assert.equal(await page.$('[data-pin-unread]'),null);
 assert.deepEqual(errors,[]);await context.close();console.log('PASS real Pins browser: live room/DM arrival, read clearing, zero/unknown/error, 99+, truncated UTF-8 previews, desktop/mobile layout, unpin/re-pin, block/access revocation, Quad read integration, account isolation, and delayed old activity across real logout/account replacement.');
}finally{await browser.close();}
