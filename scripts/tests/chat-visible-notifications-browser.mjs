// Actual local Next routes + PGlite fixture. No production data or credentials.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3354',rest='http://127.0.0.1:54554';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[],writes=[];
const account=i=>`00000000-0000-4000-8000-00000000000${i}`;
async function fixture(path,body){const r=await fetch(rest+'/rest/v1/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,await r.clone().text());return r.json();}
const pause=()=>new Promise(resolve=>setTimeout(resolve,600));
async function until(check,label){for(let n=0;n<60;n++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out: '+label);}
const activity=async()=>(await fixture('rpc/chat_activity_inbox',{actor:account(1),rooms:['main','social']}));
const mentionUnread=async id=>(await activity()).mentions.some(n=>n.messageId===id);
const reactionUnread=async id=>(await activity()).reactions.some(n=>n.messageId===id);
let p;
try{
 const context=await browser.createBrowserContext();p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 p.on('request',req=>{if(req.url().endsWith('/api/chat/activity')&&req.method()==='POST')writes.push(JSON.parse(req.postData()));});
 await p.setViewport({width:1440,height:1000});await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});
 await p.waitForFunction(()=>{const f=document.querySelector('#li-email')?.form;return f&&Object.keys(f).some(k=>k.startsWith('__reactProps$')&&typeof f[k]?.onSubmit==='function');});
 await p.type('#li-email','alice@example.test');await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label="Message LB"]');await p.goto('about:blank');
 const members=await fixture('longboard_chat_members?select=id,user_id');const member=i=>members.find(m=>m.user_id===account(i)).id;
 const post=async(i,body,parent=null,room='main')=>{const id=crypto.randomUUID();await fixture('longboard_chat_messages',{id,guest_id:member(i),member_id:member(i),author_label:i===1?'Alice':'Bob',body,room_slug:room,reply_to_id:parent});return id;};
 const react=async(id,room='main',emoji='heart',active=true,conversation=null)=>fixture('rpc/set_chat_message_reaction',{p_actor:account(2),p_room:conversation?null:room,p_conversation:conversation,p_message:id,p_emoji:emoji,p_active:active});
 const root=await post(1,'Read this original conversation');
 const mentions=[];for(let i=0;i<18;i++)mentions.push(await post(2,`@Alice room notification ${i}. `+'Readable content with enough height to keep unseen messages outside the viewport. '.repeat(3)));
 const replies=[];for(let i=0;i<18;i++)replies.push(await post(2,`Reply notification ${i}. `+'A conversation reply with enough height to require scrolling. '.repeat(3),root));
 const nested=await post(2,'Nested unseen reply',replies[0]);
 await react(root);
 // Hold the real visible acknowledgement after observing the older event boundary.
 const heldScript=await p.evaluateOnNewDocument(()=>{const original=window.fetch;window.fetch=async(...args)=>{let body;try{body=JSON.parse(args[1]?.body||'{}');}catch{}if(body?.kind==='visible'&&window.__holdVisible){window.__heldVisible=body;window.__holdVisible=false;return new Promise(resolve=>window.__releaseVisible=()=>resolve(original(...args)));}return original(...args);};window.__holdVisible=true;});
 await p.goto(`${base}/chat?room=main#chat-message-${root}`,{waitUntil:'domcontentloaded'});await p.bringToFront();await p.waitForSelector(`#chat-message-${root}`);
 await p.waitForFunction(()=>window.__heldVisible?.messageIds?.length);
 const held=await p.evaluate(()=>window.__heldVisible);assert(held.messageIds.includes(root));assert(held.reactionThrough>0);assert(!held.messageIds.includes(mentions.at(-1)));assert(!held.messageIds.includes(replies[0]));
 await p.evaluate(()=>Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false}));await react(root,'main','like');
 await p.evaluate(()=>window.__releaseVisible());await pause();assert(await reactionUnread(root),'A later reaction on a previously observed row remains unread');
 assert(await mentionUnread(replies[0]));assert(await mentionUnread(nested));assert(await mentionUnread(mentions.at(-1)));
 await p.evaluate(()=>{delete document.hasFocus;window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('chat-activity-refresh'));});
 await until(async()=>!(await reactionUnread(root)),'visible latest reaction clears after a fresh focused observation');
 await p.$eval(`#chat-message-${mentions.at(-1)}`,e=>e.scrollIntoView({block:'center'}));await until(async()=>!(await mentionUnread(mentions.at(-1))),'onscreen room mention clears');
 assert(await mentionUnread(replies[0]),'Room read never clears unseen replies');
 await p.click('button[aria-label="Search chat"]');await react(root,'main','laugh');await p.evaluate(()=>window.dispatchEvent(new Event('chat-activity-refresh')));await pause();assert(await reactionUnread(root),'Search does not acknowledge hidden room targets');
 console.log('PASS room viewport IDs and held old-event acknowledgement; offscreen and reply alerts preserved.');
 // Stop holding later document requests, and read a thread without clicking its bell alert.
 await p.removeScriptToEvaluateOnNewDocument(heldScript.identifier);
 await p.goto(`${base}/chat?room=main&thread=${root}`,{waitUntil:'domcontentloaded'});await p.evaluate(()=>{window.__holdVisible=false;window.__releaseVisible?.();});
 const panel='aside[aria-label="Comment replies"]';await p.waitForSelector(`${panel} [data-thread-message-id="${replies[0]}"]`);
 await until(async()=>!(await mentionUnread(replies[0])),'viewed reply clears without a notification click');assert(await mentionUnread(replies.at(-1)));assert(await mentionUnread(nested));
 await p.$eval(`${panel} [data-thread-message-id="${replies.at(-1)}"]`,e=>e.scrollIntoView({block:'center'}));await until(async()=>!(await mentionUnread(replies.at(-1))),'scrolled reply clears');assert(await mentionUnread(nested));
 await p.setViewport({width:390,height:900});const covered=await post(2,'@Alice hidden under the mobile reply panel');await p.evaluate(()=>window.dispatchEvent(new Event('chat-room-refresh')));await pause();assert(await mentionUnread(covered));await p.screenshot({path:'/tmp/clear-replies-mobile.png'});
 console.log('PASS direct replies only, nested/offscreen alerts retained, mobile covered room remains unread.');
 // Whole DM reaction target visibility uses independent reaction cursors; normal DM reads remain.
 await p.goto('about:blank');const conversations=await fixture('longboard_chat_conversations?select=id,requester_id,recipient_id,status');
 const conversation=conversations.find(c=>[c.requester_id,c.recipient_id].includes(member(1))&&[c.requester_id,c.recipient_id].includes(member(2)));
 if(conversation.status==='pending')await fixture('rpc/longboard_chat_dm_action',{p_user_id:account(1),p_action:'accept',p_target:conversation.id});
 const dmIds=[];for(let i=0;i<18;i++){const id=crypto.randomUUID();await fixture('longboard_chat_direct_messages',{id,conversation_id:conversation.id,sender_id:member(1),body:`Owned DM ${i}. `+'Private content to fill the viewport. '.repeat(8),client_id:crypto.randomUUID()});dmIds.push(id);}
 await react(dmIds[0],null,'heart',true,conversation.id);await react(dmIds.at(-1),null,'heart',true,conversation.id);
 await p.setViewport({width:1440,height:1000});await p.goto(`${base}/chat?dm=${conversation.id}`,{waitUntil:'domcontentloaded'});await p.evaluate(()=>{window.__holdVisible=false;window.__releaseVisible?.();});await p.waitForSelector(`[data-message-id="${dmIds[0]}"]`);
 await p.$eval(`[data-message-id="${dmIds[0]}"]`,e=>e.scrollIntoView({block:'center'}));await until(async()=>!(await reactionUnread(dmIds[0])),'visible DM target clears');assert(await reactionUnread(dmIds.at(-1)));
 await p.$eval(`[data-message-id="${dmIds.at(-1)}"]`,e=>e.scrollIntoView({block:'center'}));await until(async()=>!(await reactionUnread(dmIds.at(-1))),'scrolled DM target clears');
 await p.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='test-read-cover';dialog.innerHTML='<button>Close cover</button>';document.body.append(dialog);dialog.showModal();});
 await react(dmIds.at(-1),null,'laugh',true,conversation.id);await p.evaluate(()=>window.dispatchEvent(new Event('chat-activity-refresh')));await pause();assert(await reactionUnread(dmIds.at(-1)),'A dialog-covered target stays unread');
 await p.evaluate(()=>{document.querySelector('#test-read-cover').remove();window.dispatchEvent(new Event('focus'));});await until(async()=>!(await reactionUnread(dmIds.at(-1))),'dialog close resumes actual visibility');
 await p.evaluate(()=>{const original=window.fetch;window.__failedVisible=false;window.fetch=async(...args)=>{let body;try{body=JSON.parse(args[1]?.body||'{}');}catch{}if(body?.kind==='visible'&&!window.__failedVisible){window.__failedVisible=true;return new Response(JSON.stringify({error:'Synthetic temporary failure'}),{status:503,headers:{'Content-Type':'application/json'}});}return original(...args);};});
 await react(dmIds.at(-1),null,'rob',true,conversation.id);await p.evaluate(()=>window.dispatchEvent(new Event('chat-activity-refresh')));await p.waitForFunction(()=>window.__failedVisible);assert(await reactionUnread(dmIds.at(-1)));
 await p.evaluate(()=>window.dispatchEvent(new Event('chat-activity-refresh')));await until(async()=>!(await reactionUnread(dmIds.at(-1))),'unchanged activity snapshot retries a failed stationary visible acknowledgement');
 console.log('PASS DM exact targets, offscreen isolation, modal coverage and stationary retry after a failed acknowledgement.');
 // Passive following in Quad must not choose inactive panes or mark their new alerts read.
 await p.goto(`${base}/chat/quad`,{waitUntil:'domcontentloaded'});await p.evaluate(()=>{window.__holdVisible=false;window.__releaseVisible?.();});await p.waitForSelector('select');
 const pane=i=>`section[aria-label^="Pane ${i+1}:"]`;
 await p.select(`${pane(0)} select`,'room:main');await p.select(`${pane(1)} select`,'room:social');await p.select(`${pane(2)} select`,`dm:${conversation.id}`);
 await p.waitForSelector(`${pane(2)} textarea[placeholder="Write a private message…"]`);
 for(let i=0;i<3;i++){await p.waitForSelector(`${pane(i)} button[aria-label="Skip to Most Recent Message"]:not(:disabled)`);await p.click(`${pane(i)} button[aria-label="Skip to Most Recent Message"]`);}
 await p.focus(`${pane(0)} textarea`);await pause();
 const mainTarget=await post(1,'Quad main visible new target'),socialTarget=await post(1,'Quad social inactive new target',null,'social');
 await react(mainTarget);await react(socialTarget,'social');await react(dmIds.at(-1),null,'like',true,conversation.id);
 const beforeWrites=writes.length;await p.evaluate(()=>{window.dispatchEvent(new Event('chat-room-refresh'));window.dispatchEvent(new Event('chat-activity-refresh'));});
 await p.waitForSelector(`${pane(0)} #chat-message-${mainTarget}`);await p.waitForSelector(`${pane(1)} #chat-message-${socialTarget}`);
 await until(async()=>!(await reactionUnread(mainTarget)),'active Quad target clears');await pause();assert(await reactionUnread(socialTarget));assert(await reactionUnread(dmIds.at(-1)));
 assert(!writes.slice(beforeWrites).some(w=>w.kind==='visible'&&(w.scope.room==='social'||w.scope.kind==='dm')),'Passive auto-follow did not select or acknowledge inactive panes');
 await p.focus(`${pane(1)} textarea`);await until(async()=>!(await reactionUnread(socialTarget)),'deliberately focused Quad pane clears');
 await p.focus(`${pane(2)} textarea[placeholder="Write a private message…"]`);await until(async()=>!(await reactionUnread(dmIds.at(-1))),'deliberately focused DM pane clears');
 await p.evaluate(()=>Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false}));
 await react(dmIds.at(-1),null,'heart',false,conversation.id);await react(dmIds.at(-1),null,'heart',true,conversation.id);
 const freshSnapshot=p.waitForResponse(async response=>{if(!response.url().endsWith('/api/chat/updates'))return false;const result=await response.json().catch(()=>null);return result?.results?.some(row=>row.path==='/api/chat/activity'&&row.data?.reactions?.some(event=>event.messageId===dmIds.at(-1)&&event.emoji==='heart'));});
 await p.evaluate(()=>window.dispatchEvent(new Event('chat-activity-refresh')));await freshSnapshot;
 await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});delete document.hasFocus;document.dispatchEvent(new Event('visibilitychange'));});
 await pause();assert(await reactionUnread(dmIds.at(-1)),'Hidden document does not acknowledge an observed new event in the active pane');
 await p.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await until(async()=>!(await reactionUnread(dmIds.at(-1))),'foreground active pane resumes observation');
 await react(socialTarget,'social','laugh');await p.setViewport({width:390,height:900});await pause();assert(await reactionUnread(socialTarget));
 await p.click('nav[aria-label="Choose visible conversation"] button:nth-child(2)');await until(async()=>!(await reactionUnread(socialTarget)),'selected mobile pane clears');await p.screenshot({path:'/tmp/clear-quad-mobile.png'});
 console.log('PASS active Quad selection, passive auto-follow, inactive DM/room, background document and hidden mobile panes.');
 assert.deepEqual(errors,[]);console.log('PASS no browser runtime errors.');
}catch(error){console.error(error);await p?.screenshot({path:'/tmp/clear-browser-failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
