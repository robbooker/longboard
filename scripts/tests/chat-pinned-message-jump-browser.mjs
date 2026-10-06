import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.CHAT_TEST_URL||'http://localhost:3368',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54568';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
assert(['localhost','127.0.0.1'].includes(new URL(fixture).hostname));
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);const text=await r.text();assert(text,path+' '+(body.sql||''));return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,bob]}=await control('identity');
await sql("update profiles set role='admin' where id=$1",[alice.id]);
await sql("insert into user_tags(user_id,tag) select $1,'boardroom-cohort-1' where not exists(select 1 from user_tags where user_id=$1 and tag='boardroom-cohort-1')",[bob.id]);
await sql('delete from chat_room_message_pins');
const create=async(body,parent=null,days=0)=>(await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id,created_at) values($1,$1,'Bob',$2,'main',$3,now()-($4||' days')::interval) returning *",[bob.member.id,body,parent,String(days)]))[0];
const old=await create('PIN JUMP historical original',null,10),child=await create('PIN JUMP nested original',old.id,9),deep=await create('PIN JUMP deep original',child.id,8);
for(let n=0;n<35;n++)await create('PIN JUMP nested scrolling reply '+n,child.id,1);
const roots=[];for(let n=0;n<85;n++)roots.push(await create('PIN JUMP recent '+n));
for(const row of [old,child,deep,roots.at(-1)])await sql("select set_chat_room_message_pin($1,'main',$2,true)",[alice.id,row.id]);
await sql("insert into chat_room_reads(account_id,room_slug,through_seq) select $1,room_slug,max(unread_seq) from longboard_chat_messages group by room_slug on conflict(account_id,room_slug) do update set through_seq=excluded.through_seq",[alice.id]);
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),errors=[];
const context=await browser.createBrowserContext(),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width:1440,height:950});
async function ready(selector){await p.waitForSelector(selector,{visible:true});await p.waitForFunction(selector=>Object.keys(document.querySelector(selector)).some(k=>k.startsWith('__reactProps$')),{},selector);}
const pin=id=>`[data-pinned-message-id="${id}"] button:first-child`;
const openPin=async id=>{await p.waitForSelector(pin(id));await p.click(pin(id));};
const original='[aria-label="Original comment"]';
const settle=()=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const highlighted=async selector=>p.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('data-pin-highlight')==='true',{},selector);
const hold=async predicate=>{
 let held,release;await p.setRequestInterception(true);
 const listener=async request=>{if(!held&&predicate(request)){held=request;const response=await fetch(request.url(),{method:request.method(),headers:request.headers(),...(request.postData()?{body:request.postData()}: {})});const body=await response.text();await new Promise(resolve=>{release=resolve;});await request.respond({status:response.status,contentType:'application/json',body}).catch(()=>{});}else await request.continue().catch(()=>{});};
 p.on('request',listener);
 return {ready:async()=>{for(let n=0;!release&&n<300;n++)await new Promise(r=>setTimeout(r,20));assert(release,'Expected held response');},finish:async()=>{const delivered=p.waitForResponse(r=>r.request()===held);release();await delivered;await settle();p.off('request',listener);await p.setRequestInterception(false);}};
};
const rootRequest=request=>{const u=new URL(request.url());return u.pathname==='/api/chat/history'&&u.searchParams.get('anchor')===old.id;};
const close=async()=>{if(await p.$(original)){await p.click('button[aria-label="Close replies"]');await p.waitForSelector(original,{hidden:true});}};

try{
 console.log('Browser '+await browser.version());
 await p.goto(base+'/login?next=%2Fchat');await ready('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',alice.email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await ready('textarea[aria-label="Message LB"]');
 await p.type('textarea[aria-label="Message LB"]','Room draft remains');await openPin(old.id);await p.waitForSelector('#chat-message-'+old.id);
 await p.waitForFunction(id=>{const e=document.getElementById('chat-message-'+id);return Math.abs(e.getBoundingClientRect().top-e.parentElement.getBoundingClientRect().top)<5;},{},old.id);
 const rootHighlight=await p.$eval('#chat-message-'+old.id,e=>e.hasAttribute('data-pin-highlight'));
 await openPin(child.id);await p.waitForFunction(id=>document.querySelector('[aria-label="Original comment"]')?.getAttribute('data-thread-message-id')===id,{},child.id);await ready('#thread-reply');await p.type('#thread-reply','Nested draft remains');
 await p.$eval(original,e=>{e.parentElement.scrollTop=500;});await p.waitForFunction(()=>document.querySelector('[aria-label="Original comment"]').parentElement.scrollTop>450);
 await p.click('button[aria-label="Close replies"]');await p.waitForSelector(original,{hidden:true});await openPin(child.id);await ready('#thread-reply');
 const originalVisible=await p.$eval(original,e=>e.getBoundingClientRect().top>=e.parentElement.getBoundingClientRect().top-1);
 if(process.env.CHAT_EXPECT_BASELINE==='1'){
  assert.equal(rootHighlight,false);assert.equal(originalVisible,false);console.log('REPRODUCED published baseline: old root jumps without highlight; revisiting a pinned reply restores saved scroll and hides its original.');
 }else{
 assert.equal(rootHighlight,true);assert.equal(originalVisible,true);assert.equal(await p.$eval('#thread-reply',e=>e.value),'Nested draft remains');

 await highlighted(original);
 // Same target, without closing: every activation reveals it again and renews emphasis.
 await p.$eval(original,e=>{e.parentElement.scrollTop=500;});await openPin(child.id);await highlighted(original);
 assert(await p.$eval(original,e=>Math.abs(e.getBoundingClientRect().top-e.parentElement.getBoundingClientRect().top)<5));
 await openPin(deep.id);await p.waitForFunction(id=>document.querySelector('[aria-label="Original comment"]')?.getAttribute('data-thread-message-id')===id,{},deep.id);await highlighted(original);
 // Opening a root closes a prior thread through history; its success cue survives popstate.
 await openPin(old.id);await p.waitForSelector(original,{hidden:true});await highlighted('#chat-message-'+old.id);await new Promise(r=>setTimeout(r,150));assert(await p.$('#chat-message-'+old.id+'[data-pin-highlight]'));
 assert.equal(await p.$eval('textarea[aria-label="Message LB"]',e=>e.value),'Room draft remains');
 await p.$eval('#chat-message-'+old.id,e=>{e.parentElement.scrollTop+=300;});await openPin(old.id);await highlighted('#chat-message-'+old.id);
 assert.equal(await p.evaluate(()=>document.activeElement.id),'chat-message-'+old.id);
 await p.waitForSelector('#chat-message-'+old.id+'[data-pin-highlight]',{hidden:true,timeout:5000});
 // Keyboard activation gets the same reveal/focus without smooth motion.
 await p.focus(pin(old.id));await p.keyboard.press('Enter');await highlighted('#chat-message-'+old.id);assert.equal(await p.evaluate(()=>document.activeElement.id),'chat-message-'+old.id);
 await p.click('#chat-message-'+old.id+' button[data-has-replies]');await ready('#thread-reply');await p.type('#thread-reply','Ordinary thread draft');
 await openPin(old.id);await p.waitForSelector(original,{hidden:true});await highlighted('#chat-message-'+old.id);await new Promise(r=>setTimeout(r,150));assert(await p.$('#chat-message-'+old.id+'[data-pin-highlight]'));assert.equal(await p.evaluate(()=>document.activeElement.id),'chat-message-'+old.id);
 await p.click('#chat-message-'+old.id+' button[data-has-replies]');await ready('#thread-reply');assert.equal(await p.$eval('#thread-reply',e=>e.value),'Ordinary thread draft');await close();
 await openPin(roots.at(-1).id);await highlighted('#chat-message-'+roots.at(-1).id);assert(await p.$eval('#chat-message-'+roots.at(-1).id,e=>{const r=e.getBoundingClientRect(),c=e.parentElement.getBoundingClientRect();return r.bottom<=c.bottom+1&&r.top<c.bottom;}));
 console.log('PASS historical/root/reply/deep/repeated/keyboard navigation, pin and ordinary thread-close highlight, last-message visibility, expiry and drafts.');
 // Delayed reads cannot override a newer wheel, composer edit, search or modal intent.
 for(const action of ['wheel','composer','search','dialog']){
  await close();const gate=await hold(rootRequest);await openPin(old.id);await gate.ready();
  if(action==='wheel'){await p.hover('textarea[aria-label="Message LB"]');await p.mouse.wheel({deltaY:-150});}
  if(action==='composer'){await p.click('textarea[aria-label="Message LB"]');await p.type('textarea[aria-label="Message LB"]',' later');}
  if(action==='search')await p.click('[aria-label="Search chat"]');
  if(action==='dialog')await p.evaluate(()=>{const d=document.createElement('dialog');d.id='synthetic-global-dialog';document.body.append(d);d.showModal();});
  await gate.finish();assert.equal(await p.$('[data-pin-highlight]'),null,action+' should cancel emphasis');
  if(action==='composer')assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Message LB');
  if(action==='search'){assert.equal(await p.$eval('[aria-label="Search chat"]',e=>e.getAttribute('aria-pressed')),'true');await p.click('#chat-room-navigation a[href="/chat?room=main"]');}
  if(action==='dialog')await p.evaluate(()=>document.getElementById('synthetic-global-dialog').remove());
 }
 const other=await hold(rootRequest);await openPin(old.id);await other.ready();await openPin(deep.id);await highlighted(original);await other.finish();assert.equal(await p.$eval(original,e=>e.getAttribute('data-thread-message-id')),deep.id);
 console.log('PASS held root superseded by wheel/composer/search/dialog/another pin.');
 // Themes and reduced motion: outline leaves metadata backgrounds unchanged.
 for(const theme of ['dark','light','blade-runner']){
  await p.evaluate(theme=>localStorage.setItem('longboard-public-chat-theme-v1',theme),theme);await p.goto(base+'/chat');await ready('textarea[aria-label="Message LB"]');
  await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await openPin(old.id);await highlighted('#chat-message-'+old.id);
  const css=await p.$eval('#chat-message-'+old.id,e=>{const c=getComputedStyle(e);const result={outline:c.outlineStyle,width:c.outlineWidth,animation:c.animationName,background:c.backgroundColor,metadata:getComputedStyle(e.querySelector('time')).color};e.removeAttribute('data-pin-highlight');result.normalBackground=getComputedStyle(e).backgroundColor;result.normalMetadata=getComputedStyle(e.querySelector('time')).color;e.setAttribute('data-pin-highlight','true');return result;});assert.equal(css.outline,'solid');assert.equal(css.width,'2px');assert.equal(css.animation,'none');assert.equal(css.background,css.normalBackground);assert.equal(css.metadata,css.normalMetadata);
  await p.screenshot({path:'/tmp/chat-pinned-message-jump-'+theme+'.png'});await openPin(child.id);await highlighted(original);await p.screenshot({path:'/tmp/chat-pinned-message-jump-'+theme+'-reply.png'});
 }
 await close();await p.setViewport({width:320,height:850,isMobile:true,hasTouch:true});await openPin(old.id);await highlighted('#chat-message-'+old.id);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:'/tmp/chat-pinned-message-jump-mobile-root.png'});
 await openPin(child.id);await highlighted(original);assert(await p.$eval(original,e=>Math.abs(e.getBoundingClientRect().top-e.parentElement.getBoundingClientRect().top)<5));await p.screenshot({path:'/tmp/chat-pinned-message-jump-mobile-reply.png'});
 console.log('PASS three themes, reduced motion and 320px root/reply touch layout.');
 await p.setViewport({width:1440,height:950,isMobile:false,hasTouch:false});await p.goto(base+'/chat/quad');await ready('select');
 const pane='section[aria-label="Pane 1: LB"]';const disclosure=pane+' aside[aria-label="Pinned room messages"] > button[aria-expanded]';await p.waitForSelector(disclosure);if(await p.$eval(disclosure,e=>e.getAttribute('aria-expanded')==='false'))await p.click(disclosure);await p.waitForSelector(pane+' '+pin(old.id),{visible:true});await p.click(pane+' '+pin(old.id));await highlighted(pane+' #chat-message-'+old.id);
 const otherPane='section[aria-label^="Pane 2:"]';
 // Inactive→active initial pin click must succeed, but a later pane selection cancels.
 await p.click(otherPane+' select');await p.keyboard.press('Escape');await p.click(pane+' '+pin(old.id));await highlighted(pane+' #chat-message-'+old.id);
 const inactive=await hold(rootRequest);await p.click(pane+' '+pin(old.id));await inactive.ready();await p.click(otherPane+' select');await p.keyboard.press('Escape');await inactive.finish();assert.equal(await p.$(pane+' [data-pin-highlight]'),null);await p.click(pane+' select');await p.keyboard.press('Escape');await settle();assert.equal(await p.$(pane+' [data-pin-highlight]'),null);
 // Hold a real thread update across pane deactivation and reactivation: no replay.
 const thread=await hold(request=>request.url().endsWith('/api/chat/updates')&&request.postData()?.includes('/api/chat/thread?room=main&messageId='+child.id));await p.click(pane+' '+pin(child.id));await thread.ready();await p.click(otherPane+' select');await p.keyboard.press('Escape');await thread.finish();await p.click(pane+' select');await p.keyboard.press('Escape');await settle();assert.equal(await p.$(pane+' [data-pin-highlight]'),null);
 await p.click(pane+' button[aria-label="Close replies"]');await p.waitForSelector(pane+' '+original,{hidden:true});
 // Quad's external Latest control also supersedes a pending thread jump.
 const latest=await hold(request=>request.url().endsWith('/api/chat/updates')&&request.postData()?.includes('/api/chat/thread?room=main&messageId='+deep.id));await p.click(pane+' '+pin(deep.id));await latest.ready();await p.click(pane+' button[aria-label="Skip to Most Recent Message"]');await latest.finish();await p.waitForSelector(pane+' '+original,{hidden:true});assert.equal(await p.$(pane+' [data-pin-highlight]'),null);
 const dialog=await hold(rootRequest);await p.click(pane+' '+pin(old.id));await dialog.ready();await p.evaluate(()=>window.dispatchEvent(new Event('chat-open-profile-settings')));await p.waitForSelector('dialog[open]');await dialog.finish();assert.equal(await p.$(pane+' [data-pin-highlight]'),null);await p.keyboard.press('Escape');
 await p.click(pane+' '+pin(child.id));await highlighted(pane+' '+original);assert.equal(await p.$(otherPane+' [data-pin-highlight]'),null);await p.screenshot({path:'/tmp/chat-pinned-message-jump-quad.png'});
 console.log('PASS Quad scope, inactive activation, root/thread deactivation no replay, external Latest and global profile dialog.');
 assert.deepEqual(errors,[]);console.log('PASS complete pinned-message jump matrix with zero browser runtime errors.');
 }
}catch(error){await p.screenshot({path:'/tmp/chat-pinned-message-jump-failure.png'});console.error(await p.evaluate(()=>document.body.innerText.slice(-1800)));throw error;}finally{await browser.close();}
