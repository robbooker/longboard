// #363: a reply posted while a reply thread is open shows up straight away (no "Newer replies"),
// earlier replies stay, the thread stays at the bottom when the reader is there, and a reader who
// scrolled up keeps their place and gets a "new replies" pill, as in the room. Desktop and phone.
// Synthetic fixture only: ports 3463/54663, no production credentials or messages.
// THREAD_LIVE_SHOTS=<dir> saves screenshots of each width after the live replies land.
import puppeteer from 'puppeteer';import assert from 'node:assert/strict';
const base='http://localhost:3463',rest='http://127.0.0.1:54663',shots=process.env.THREAD_LIVE_SHOTS;
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function login(email,width,phone){const context=await browser.createBrowserContext(),p=await context.newPage();await p.setViewport({width,height:phone?844:900,isMobile:!!phone,hasTouch:!!phone});await p.goto(base+'/login?next=%2Fchat',{waitUntil:'domcontentloaded',timeout:60000});await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label="Message LB"]');return p;}
async function fixture(table,body){const r=await fetch(rest+'/rest/v1/'+table,{method:body?'POST':'GET',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,await r.clone().text());return r.json();}
async function liveReply(root,body){const r=await fetch(`${rest}/test/reply?root=${root}&body=${encodeURIComponent(body)}`);assert(r.ok,await r.clone().text());return r.json();}
const pane='aside[aria-label="Comment replies"]',list=`${pane} [aria-label="Replies to this comment"]`;
// The thread's scrolling column holds the replies list.
const contents=p=>p.evaluateHandle(sel=>document.querySelector(sel).parentElement,list);
const scrollState=p=>p.evaluate(sel=>{const n=document.querySelector(sel).parentElement;return {top:n.scrollTop,gap:n.scrollHeight-n.scrollTop-n.clientHeight};},list);
const rows=p=>p.$$eval(`${list} [data-thread-message-id]`,rows=>rows.length);
const waitText=(p,text)=>p.waitForFunction((sel,text)=>document.querySelector(sel)?.textContent.includes(text),{timeout:30000},list,text);
const hasText=(p,text)=>p.evaluate((sel,text)=>!!document.querySelector(sel)?.textContent.includes(text),list,text);
const newerButton=p=>p.evaluate(sel=>[...document.querySelectorAll(sel+' button')].some(b=>/Newer replies/.test(b.textContent)),list);
// Wait for the live reply, or for the old "Newer replies" button in its place (so a before-shot shows it).
const landed=(p,text)=>p.waitForFunction((sel,text)=>{const l=document.querySelector(sel);return l&&(l.textContent.includes(text)||[...l.querySelectorAll('button')].some(b=>/Newer replies/.test(b.textContent)));},{timeout:30000},list,text);
// A real gesture over the replies (the panel follows only what the reader does).
async function wheel(p,dy){const box=await(await contents(p)).boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/3);for(let i=0;i<8;i++){await p.mouse.wheel({deltaY:dy/8});await sleep(40);}await sleep(400);}
const member=(await fixture('longboard_chat_members?select=id&user_id=eq.00000000-0000-4000-8000-000000000002'))[0].id;
const errors=[];
try{
for(const [label,width,phone] of [['desktop',1440,false],['phone',390,true]]){
 // Bob's conversation with 6 replies, none read by Alice: the thread opens at its first unread reply,
 // a bounded window (the case where a live reply used to become "Newer replies"), all in view.
 const root=crypto.randomUUID();
 await fixture('longboard_chat_messages',{id:root,guest_id:member,member_id:member,author_label:'Bob',body:`Live thread root ${label}`,room_slug:'main'});
 for(let i=1;i<=6;i++)await fixture('longboard_chat_messages',{guest_id:member,member_id:member,author_label:'Bob',body:`Earlier reply ${label} ${i}`,room_slug:'main',reply_to_id:root});
 const alice=await login('alice@example.test',width,phone);alice.on('pageerror',e=>errors.push(e.message));
 if(phone)await alice.goto(base+'/chat?room=main',{waitUntil:'domcontentloaded'});
 await sleep(3000);if(await alice.$(pane)){await alice.click('button[aria-label="Close replies"]');await alice.waitForSelector(pane,{hidden:true});await sleep(1000);}
 await alice.waitForSelector(`#chat-message-${root} button[data-has-replies="true"]`,{timeout:60000});
 // The room may still be hydrating or placing its unread opening: press until the thread opens.
 for(let i=0;i<8&&!await alice.$(pane);i++){await alice.click(`#chat-message-${root} button[data-has-replies="true"]`).catch(()=>{});await sleep(2000);}
 await alice.waitForSelector(pane);await waitText(alice,`Earlier reply ${label} 6`);
 await sleep(1500);

 // 1. A reply arrives while the thread is open: it shows at once, below the earlier ones, in view.
 const first=`Live reply ${label} one`;await liveReply(root,first);
 await landed(alice,first);await sleep(1500);
 if(shots)await alice.screenshot({path:`${shots}/${label}.png`});
 assert.equal(await newerButton(alice),false,`${label}: no Newer replies button`);
 assert(await hasText(alice,first),`${label}: the live reply shows`);
 for(let i=1;i<=6;i++)assert(await hasText(alice,`Earlier reply ${label} ${i}`),`${label}: earlier reply ${i} stays`);
 assert.equal(await rows(alice),7,`${label}: 6 earlier replies and the live one`);
 let at=await scrollState(alice);assert(at.gap<=4,`${label}: the newest reply is in view ${JSON.stringify(at)}`);
 console.log(`PASS ${label}: a live reply shows at once in the open thread, earlier replies stay, no Newer replies`);

 // 2. A run of replies: the thread keeps scrolling with them (it overflows now).
 for(let i=1;i<=14;i++){await liveReply(root,`Run reply ${label} ${i}`);await sleep(250);}
 await waitText(alice,`Run reply ${label} 14`);await sleep(1500);
 at=await scrollState(alice);assert(at.gap<=4&&at.top>0,`${label}: stays at the bottom through a run ${JSON.stringify(at)}`);
 assert.equal(await rows(alice),21,`${label}: nothing dropped`);assert.equal(await newerButton(alice),false);
 if(shots)await alice.screenshot({path:`${shots}/${label}-run.png`});
 console.log(`PASS ${label}: at the bottom it stays scrolled down through a run of replies`);

 // 3. Scrolled up: the reply is added, the reader's place holds, and the pill offers it (as the room).
 await sleep(2500);await wheel(alice,-500);
 const before=await scrollState(alice);assert(before.gap>100,`${label}: scrolled up ${JSON.stringify(before)}`);
 const second=`Live reply ${label} two`;await liveReply(root,second);
 await waitText(alice,second);await sleep(1200);
 const after=await scrollState(alice);assert(Math.abs(after.top-before.top)<=2,`${label}: no forced scroll ${JSON.stringify({before,after})}`);
 assert.equal(await newerButton(alice),false,`${label}: still no Newer replies`);
 await alice.waitForSelector(`${pane} button[data-thread-new-replies]`,{visible:true,timeout:5000});
 assert.match(await alice.$eval(`${pane} button[data-thread-new-replies]`,b=>b.textContent),/1 new reply/);
 if(shots)await alice.screenshot({path:`${shots}/${label}-scrolled-up.png`});
 await alice.click(`${pane} button[data-thread-new-replies]`);await sleep(800);
 at=await scrollState(alice);assert(at.gap<=4,`${label}: the pill goes to the newest reply ${JSON.stringify(at)}`);
 assert.equal(await alice.$(`${pane} button[data-thread-new-replies]`),null,`${label}: the pill goes away`);
 const third=`Live reply ${label} three`;await liveReply(root,third);
 await waitText(alice,third);await sleep(1200);
 at=await scrollState(alice);assert(at.gap<=4,`${label}: follows again ${JSON.stringify(at)}`);
 assert.equal(await rows(alice),23,`${label}: every reply kept`);
 assert.equal(await alice.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${label}: no sideways scroll`);
 console.log(`PASS ${label}: scrolled up keeps its place with a "1 new reply" pill; the pill returns to the bottom and following resumes`);
 // Close it, so the next width does not reopen this thread.
 await alice.click('button[aria-label="Close replies"]');await alice.waitForSelector(pane,{hidden:true});await sleep(1000);
 await alice.browserContext().close();
}
assert.deepEqual(errors,[]);
}finally{await browser.close();}
