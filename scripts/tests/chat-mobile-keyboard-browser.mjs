// Production UI with current synthetic SQL, native Chromium touch/scroll and real send routes.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.CHAT_TEST_URL||'http://localhost:3372',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54572';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,bob]}=await control('identity');await sql("update longboard_chat_conversations set status='accepted'");
await sql("delete from longboard_chat_messages where body like 'Keyboard %' or body='Nested keyboard reply'");
await sql("delete from longboard_chat_direct_messages where body like 'Keyboard %'");
const [conversation]=await sql('select * from longboard_chat_conversations where requester_id=$1 or recipient_id=$1',[alice.member.id]);
const roots=[];for(let i=0;i<35;i++)roots.push((await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Bob',$2,'main') returning *",[bob.member.id,'Keyboard history '+i]))[0]);
const [child]=await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,reply_to_id) values($1,$1,'Bob','Nested keyboard reply','main',$2) returning *",[bob.member.id,roots.at(-1).id]);
for(let i=0;i<20;i++)await sql("insert into longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values($1,$2,gen_random_uuid(),$3)",[conversation.id,bob.member.id,'Keyboard private history '+i]);
const browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),context=await browser.createBrowserContext(),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
const room='textarea[aria-label="Message LB"]',thread='[aria-label="Comment replies"] textarea[data-chat-composer]',dm='[aria-label="Private conversation"] textarea[data-chat-composer]';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ready=async s=>{await p.waitForSelector(s,{visible:true});await p.waitForFunction(s=>Object.keys(document.querySelector(s)).some(k=>k.startsWith('__reactProps$')),{},s);};
const set=async(s,value)=>{await p.focus(s);await p.$eval(s,(e,value)=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));},value);};
const focused=s=>p.$eval(s,e=>document.activeElement===e);
const touch=async(s,dx=0,dy=0)=>{
 const node=await p.$(s);assert(node,s);await node.evaluate(e=>e.scrollIntoView({block:'nearest'}));const r=await node.boundingBox();assert(r,s);const x=r.x+Math.min(r.width/2,100),y=r.y+Math.min(r.height/2,25),cdp=await p.createCDPSession();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 if(dx||dy)for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/6,y:y+dy*i/6}]});await pause(20);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await pause(100);
};
const content=()=>`#chat-message-${roots.at(-1).id} p`;
const hold=async predicate=>{
 let held,release;await p.setRequestInterception(true);
 const listener=async request=>{if(!held&&predicate(request)){held=request;const response=await fetch(request.url(),{method:request.method(),headers:request.headers(),body:request.postData()});assert(response.ok,'Actual send route succeeded');const body=await response.text();await new Promise(r=>{release=r;});await request.respond({status:response.status,contentType:'application/json',body}).catch(()=>{});}else await request.continue().catch(()=>{});};p.on('request',listener);
 return {ready:async()=>{for(let i=0;!release&&i<300;i++)await pause(20);assert(release,'Expected held real send response');},finish:async()=>{const response=p.waitForResponse(r=>r.request()===held);release();await response;await pause(180);p.off('request',listener);await p.setRequestInterception(false);}};
};
const sendRace=async(input,target,path,body,swipe=false)=>{
 await set(input,body);const gate=await hold(r=>new URL(r.url()).pathname===path&&r.method()==='POST'&&r.postData()?.includes(body));
 const submit=await p.$eval(input,e=>{const b=e.form.querySelector('button:not([type]),button[type=submit]');b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});await p.touchscreen.tap(submit.x,submit.y);await gate.ready();await touch(target,0,swipe?65:0);assert.equal(await focused(input),false,'deliberate dismissal before ACK');
 await pause(350);const measure=e=>{const pane=e.closest('article').parentElement;return {top:pane.scrollTop,height:pane.scrollHeight,client:pane.clientHeight,anchor:e.closest('article').getBoundingClientRect().top,url:location.href};};const before=await p.$eval(target,measure);await gate.finish();const after=await p.$eval(target,measure);console.log('ACK scroll',body,{before,after});assert(Math.abs(after.anchor-before.anchor)<2,'late ACK preserves the visible message anchor across layout changes');assert.equal(await focused(input),false,'late ACK must not refocus');assert.equal(await p.$eval(target,e=>location.href),before.url);assert.equal(await p.$eval(input,e=>e.value),'');
};
try{
 console.log('Browser '+await browser.version());await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await p.goto(base+'/login?next=%2Fchat');await ready('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',alice.email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await ready(room);
 await p.evaluate(()=>{window.keyboardTouchDefaults=[];document.addEventListener('touchend',e=>window.keyboardTouchDefaults.push(e.defaultPrevented));});
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  await p.setViewport({...viewport,isMobile:true,hasTouch:true});await set(room,'Orientation draft');await touch(content());assert.equal(await focused(room),false);assert.equal(await p.$eval(room,e=>e.value),'Orientation draft');
  await p.focus(room);await touch(content(),0,65);assert.equal(await focused(room),false);
  await p.focus(room);await touch(content(),0,-65);assert.equal(await focused(room),true,'upward history swipe keeps composer focus');
  await p.focus(room);await touch(content(),65,0);assert.equal(await focused(room),true,'horizontal gesture keeps composer focus');
 }
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await sendRace(room,content(),'/api/chat','Keyboard room held success',true);
 const sent=await sql('select body from longboard_chat_messages where member_id=$1 and body=$2',[alice.member.id,'Keyboard room held success']);assert.equal(sent.length,1);
 await set(room,'Room preserved draft');await touch('[aria-label="Add to message"]');await p.waitForSelector('[aria-label="Message additions"]',{visible:true});assert.equal(await p.$eval(room,e=>e.value),'Room preserved draft');await p.keyboard.press('Escape');await p.focus(room);await touch(room,0,35);assert.equal(await focused(room),true,'textarea scrolling is excluded');
 // Native touch scroll moves history while the downward gesture dismisses focus.
 const feed=`#chat-message-${roots.at(-1).id}`;await p.$eval(feed,e=>{e.parentElement.scrollTop=e.parentElement.scrollHeight/2;});await p.focus(room);
 const box=await p.$eval(feed,e=>{const r=e.parentElement.getBoundingClientRect();return {x:r.x+80,y:r.y+80,top:e.parentElement.scrollTop};});const cdp=await p.createCDPSession();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x,y:box.y}]});for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x,y:box.y+i*10}]});await pause(20);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await pause(150);assert.equal(await focused(room),false);assert(await p.$eval(feed,(e,before)=>e.parentElement.scrollTop<before,box.top),'native downward history scrolling still occurs');
 console.log('PASS room portrait/landscape tap/downward dismissal, upward/horizontal/input preservation, native scrolling, real send and held ACK.');
 await p.$eval(feed,e=>e.scrollIntoView({block:'nearest'}));await p.click(feed+' button[data-has-replies]');await ready(thread);await p.click(`[data-thread-message-id="${child.id}"] button[data-has-replies]`);await ready(thread);
 assert.equal(await p.$eval('[aria-label="Original comment"]',e=>e.getAttribute('data-thread-message-id')),child.id);
 await set(thread,'Nested retained draft');await touch('[aria-label="Original comment"] p');assert.equal(await focused(thread),false);assert.equal(await p.$eval(thread,e=>e.value),'Nested retained draft');
 await sendRace(thread,'[aria-label="Original comment"] p','/api/chat','Keyboard nested held success');assert.equal((await sql('select id from longboard_chat_messages where member_id=$1 and reply_to_id=$2 and body=$3',[alice.member.id,child.id,'Keyboard nested held success'])).length,1);await p.click('[aria-label="Close replies"]');await ready(room);assert.equal(await p.$eval(room,e=>e.value),'Room preserved draft');
 console.log('PASS nested replies tap and held ACK, persisted reply send, room draft preserved.');
 await p.click('[aria-label="Open room navigation"]');await p.waitForFunction(()=>[...document.querySelectorAll('[aria-label="Private conversations"] button')].some(e=>e.textContent.includes('Bob')));for(const button of await p.$$('[aria-label="Private conversations"] button'))if(await button.evaluate(e=>e.textContent.includes('Bob'))){await button.click();break;}await ready(dm);
 const dmBody='[aria-label="Private conversation"] article:last-child [class*="messageBody"]';await ready(dmBody);await set(dm,'Private retained draft');await touch(dmBody);assert.equal(await focused(dm),false);assert.equal(await p.$eval(dm,e=>e.value),'Private retained draft');
 await sendRace(dm,dmBody,'/api/chat/inbox','Keyboard DM held success',true);assert.equal((await sql('select body from longboard_chat_direct_messages where sender_id=$1 and body=$2',[alice.member.id,'Keyboard DM held success'])).length,1);
 await set(dm,'Private final draft');await p.screenshot({path:'/tmp/chat-mobile-keyboard-portrait.png'});await p.setViewport({width:844,height:390,isMobile:true,hasTouch:true});await touch(dmBody);assert.equal(await focused(dm),false);assert.equal(await p.$eval(dm,e=>e.value),'Private final draft');await p.screenshot({path:'/tmp/chat-mobile-keyboard-landscape.png'});
 console.log('PASS mobile portaled DM tap/swipe/held ACK, exact send persistence and draft/orientation preservation.');
 assert(await p.evaluate(()=>window.keyboardTouchDefaults.every(value=>value===false)),'native touch defaults remain unprevented');
 // A wide touch layout exercises simultaneous Quad panes, while mouse clicks stay native.
 await p.setViewport({width:1440,height:1000,hasTouch:true});await p.goto(base+'/chat/quad');await p.waitForSelector('select');await p.select('select','dm:'+conversation.id);await ready(dm);await ready(dmBody);await set(dm,'Quad DM retained');
 await p.$eval(dm,e=>{window.otherPaneBlurCalls=0;const blur=e.blur;e.blur=function(){window.otherPaneBlurCalls++;return blur.call(this);};});await touch('[data-pane="true"][data-room="social"] article p');assert.equal(await p.evaluate(()=>window.otherPaneBlurCalls),0,'other Quad watcher does not call blur on this composer');await p.focus(dm);await touch('[aria-label="Private conversation"] article:last-child [class*="messageBody"]');assert.equal(await focused(dm),false);
 const social='[data-pane="true"][data-room="social"] textarea[data-chat-composer]';await ready(social);await set(social,'Quad room draft');await touch('[data-pane="true"][data-room="social"] article p');assert.equal(await focused(social),false);assert.equal(await p.$eval(social,e=>e.value),'Quad room draft');await p.screenshot({path:'/tmp/chat-mobile-keyboard-quad.png'});
 const selectors=await p.$$('select');await selectors[1].select('room:main');await ready('[data-pane="true"] '+room);await ready(feed+' button[data-has-replies]');await p.click(feed+' button[data-has-replies]');await ready(thread);await set(thread,'Quad reply retained');await touch('[aria-label="Original comment"] p',0,65);assert.equal(await focused(thread),false);assert.equal(await p.$eval(thread,e=>e.value),'Quad reply retained');await p.click('[aria-label="Close replies"]');
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await p.click('[aria-label="Choose visible conversation"] button:first-child');await ready(dm);await ready(dmBody);await set(dm,'Quad mobile draft');await touch(dmBody);assert.equal(await focused(dm),false);assert.equal(await p.$eval(dm,e=>e.value),'Quad mobile draft');await p.screenshot({path:'/tmp/chat-mobile-keyboard-quad-mobile.png'});
 assert.deepEqual(errors,[]);console.log('PASS Quad pane ownership/DM portal, room/reply dismissal and mobile pane selection, no browser runtime errors.');
}catch(error){console.error('Runtime errors',errors);console.error('Page',p.url(),await p.evaluate(()=>document.body.innerText));await p.screenshot({path:'/tmp/chat-mobile-keyboard-failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
