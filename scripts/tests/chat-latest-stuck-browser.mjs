// #520: a request that takes over from a Latest still loading must not leave Latest disabled.
//  A. Latest is pressed and, before it answers, the reader scrolls to the top (an earlier page loads),
//     presses Earlier messages, or a message of their own is delivered: the Latest button and
//     "Jump to latest" work again and the list is no longer marked busy. Before the fix they stayed
//     disabled until the room was left.
//  B. "Show sent message": a message that arrives while the sent message's history loads no longer
//     asks for a second press; the page asks again by itself (three tries in all, as Latest does).
//  C. The @ list no longer empties and looks the name up again when the page's own identity arrives.
// Production UI/API/current SQL; exclusively synthetic local accounts/data (ports 3520/54720).
// LATEST_SOFT=1 reports a failed check and carries on (to see every part fail on code without the fix).
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.CHAT_TEST_URL||'http://localhost:3520',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54720';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const soft=process.env.LATEST_SOFT==='1',failed=[];
const check=(ok,message)=>{if(ok)return;if(!soft)assert.fail(message);failed.push(message);console.log('SOFT FAIL '+message);};
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const text=await r.text();assert.equal(r.status,200,`${path}: ${text}`);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,bob]}=await control('identity');
await sql("delete from longboard_chat_messages where body like 'Latest stuck %'");
const roots=await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,created_at) select $1,$1,'Bob','Latest stuck root '||n,'main',clock_timestamp()+n*interval '1 millisecond' from generate_series(1,240) n returning id,unread_seq",[bob.member.id]);
const marker=(room,seq)=>sql('insert into chat_room_reads(account_id,room_slug,through_seq) values($1,$2,$3) on conflict(account_id,room_slug) do update set through_seq=excluded.through_seq',[alice.id,room,seq]);
const readRoom=async room=>Number((await sql('select through_seq from chat_room_reads where account_id=$1 and room_slug=$2',[alice.id,room]))[0]?.through_seq??0);
const newest=roots.at(-1);

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),p=await browser.newPage(),errors=[];
p.on('pageerror',e=>{errors.push(e.message);console.error('Browser error stack',e.stack);});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ready=async s=>{await p.waitForSelector(s,{visible:true,timeout:60000});await p.waitForFunction(s=>Object.keys(document.querySelector(s)).some(k=>k.startsWith('__reactProps$')),{},s);};
const roomInput='textarea[aria-label="Message LB"]',latestButton='[aria-label="Skip to Most Recent Message"]',log='[data-room="main"] [role="log"]';
const history=(request,...keys)=>{const url=new URL(request.url());return url.pathname==='/api/chat/history'&&request.method()==='GET'&&keys.every(key=>url.searchParams.has(key));};
const plainHistory=request=>history(request)&&!['around','range','anchor','latest','before','after'].some(key=>new URL(request.url()).searchParams.has(key));
// Holds the real answers to the requests that match until finish(); everything else goes through.
const hold=async(predicate,{first=true}={})=>{const waiting=[];let seen=0,open=false;await p.setRequestInterception(true);
 const listener=async request=>{if(!predicate(request)||open||(first&&seen))return request.continue().catch(()=>{});seen++;
  const response=await fetch(request.url(),{method:request.method(),headers:request.headers(),body:request.postData()});const body=await response.text();
  if(!open)await new Promise(r=>waiting.push(r));
  await request.respond({status:response.status,contentType:'application/json',body}).catch(()=>{});};
 p.on('request',listener);
 return {ready:async()=>{for(let i=0;!waiting.length&&i<1000;i++)await pause(20);assert(waiting.length,'the request was held');},
  finish:async()=>{open=true;waiting.forEach(r=>r());await pause(250);p.off('request',listener);await p.setRequestInterception(false);}};};
const state=()=>p.evaluate((latestButton,log)=>{const b=document.querySelector(latestButton),l=document.querySelector(log),pill=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Jump to latest')||/new messages?/.test(b.textContent));
 return {latestDisabled:b.disabled,busy:l.getAttribute('aria-busy'),pill:pill?{disabled:pill.disabled}:null,atBottom:l.scrollHeight-l.scrollTop-l.clientHeight<5,top:l.scrollTop};},latestButton,log);
const settled=async(ms=6000)=>{try{await p.waitForFunction((latestButton,log)=>!document.querySelector(latestButton).disabled&&document.querySelector(log).getAttribute('aria-busy')==='false',{timeout:ms},latestButton,log);}catch{}return state();};
const signIn=async()=>{await p.setViewport({width:1440,height:1000});await p.goto(base+'/login?next=%2Fchat');await ready('#li-email');await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>{const f=document.querySelector('#li-email')?.form;return f&&Object.keys(f).some(k=>k.startsWith('__reactProps$')&&typeof f[k]?.onSubmit==='function');});await p.type('#li-email',alice.email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await ready(roomInput);};
// The room at its newest message, then scrolled up a little (more than a screen from the top, so no
// earlier page loads): Latest is no longer grayed.
let earlierPages=0;p.on('request',r=>{if(history(r,'before'))earlierPages++;});
const openAway=async()=>{earlierPages=0;await marker('main',newest.unread_seq);await p.goto('about:blank');await p.goto(base+'/chat?room=main');await ready(roomInput);await p.waitForSelector('#chat-message-'+newest.id);await pause(800);
 await away();await pause(600);
 const at=await state();assert(at.top>900,'scrolled up, but not to within a screen of the top');assert.equal(at.busy,'false');assert.equal(earlierPages,0,'no earlier page has loaded yet');};
const away=async()=>{await p.$eval(log,l=>{l.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));l.scrollTop=l.scrollHeight-l.clientHeight-500;});await p.waitForSelector(latestButton+':not([aria-disabled]):not([disabled])',{visible:true});await pause(600);};
const atNewest=()=>p.waitForFunction((latestButton,log,id)=>{const l=document.querySelector(log),b=document.querySelector(latestButton);return document.getElementById('chat-message-'+id)&&l.scrollHeight-l.scrollTop-l.clientHeight<5&&b.getAttribute('aria-disabled')==='true'&&!b.disabled&&l.getAttribute('aria-busy')==='false';},{timeout:20000},latestButton,log,newest.id);
// After Latest was taken over: both controls work, the list is not busy, and Latest still goes to the newest message.
const usable=async(label,page,{pill=true}={})=>{
 const after=await settled();
 check(!after.latestDisabled,`${label}: the Latest button is enabled again`);
 check(after.busy==='false',`${label}: the list is not marked busy (aria-busy=${after.busy})`);
 // Away from the newest message the "Jump to latest" pill shows; it must not be left disabled.
 if(pill)check(after.pill&&!after.pill.disabled,`${label}: "Jump to latest" is shown and enabled (${JSON.stringify(after.pill)})`);
 else check(!after.pill?.disabled,`${label}: "Jump to latest" is not left disabled`);
 check(await p.$(`#chat-message-${page.id}`),`${label}: the earlier page loaded`);
 if(after.latestDisabled||after.pill?.disabled||(pill&&!after.pill))return;
 // "Jump to latest" works...
 if(pill){await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Jump to latest')||/new messages?/.test(b.textContent)).click());await atNewest();}
 // ...and so does the Latest button, pressed from further up again.
 await away();await p.click(latestButton);await atNewest();
 assert.equal(await readRoom('main'),Number(newest.unread_seq),label+': the room is read through its newest message, no further');
};
try{
 await signIn();
 // A1. Latest is loading; the reader scrolls to the top, which loads an earlier page.
 // On the live end of the room, pressing Latest moves the list to the
 // newest loaded message at once and refreshes behind it; that move ends Latest's watch for a
 // scroll, so the reader's next scroll no longer cancels it.
 await openAway();
 let gate=await hold(r=>history(r,'latest'));
 let paged=p.waitForResponse(r=>history(r.request(),'before'),{timeout:20000});
 await p.click(latestButton);await gate.ready();
 let during=await state();assert(during.latestDisabled,'Latest is disabled while it loads');assert.equal(during.busy,'true','the list is busy while Latest loads');
 await p.waitForFunction(log=>{const l=document.querySelector(log);return l.scrollHeight-l.scrollTop-l.clientHeight<5;},{},log);await pause(600);
 during=await state();assert(during.latestDisabled,'Latest is still loading when the reader scrolls up');
 await p.$eval(log,l=>{l.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));l.scrollTop=0;l.dispatchEvent(new Event('scroll'));});
 await paged;await gate.finish();
 await usable('scrolled to the top while Latest loaded',roots[100]);
 console.log((failed.length?'SOFT ':'PASS ')+'A1 an earlier page loaded by scrolling up while Latest was loading leaves Latest and Jump to latest usable.');
 // A2. Latest is loading; the reader presses Earlier messages.
 await openAway();
 gate=await hold(r=>history(r,'latest'));
 paged=p.waitForResponse(r=>history(r.request(),'before'),{timeout:20000});
 await p.click(latestButton);await gate.ready();
 during=await state();assert(during.latestDisabled,'Latest is disabled while it loads');
 await p.evaluate(log=>[...document.querySelector(log).querySelectorAll('button')].find(b=>b.textContent.trim()==='Earlier messages').click(),log);
 await paged;await gate.finish();
 // The list is still at the newest message here (Latest moved it there), so no pill is due.
 await usable('Earlier messages pressed while Latest loaded',roots[100],{pill:false});
 console.log((failed.length?'SOFT ':'PASS ')+'A2 Earlier messages pressed while Latest was loading leaves Latest and Jump to latest usable.');
 // A3. Latest is loading from an older part of the room when a message of the reader's own is
 // delivered (sent without a key press or a click, as a queued message is): the page loads the
 // latest messages to show it, which takes over from Latest too.
 await marker('main',roots[19].unread_seq);await p.goto('about:blank');await p.goto(base+'/chat?room=main');await ready(roomInput);
 await p.waitForSelector(`#chat-message-${roots[20].id}[data-unread-start="true"]`,{visible:true});await pause(400);
 gate=await hold(r=>history(r,'latest'));
 await p.click(latestButton);await gate.ready();
 during=await state();assert(during.latestDisabled,'Latest is disabled while it loads');
 let shownSent=p.waitForResponse(r=>plainHistory(r.request()),{timeout:20000});
 await p.$eval(roomInput,e=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Latest stuck taken over');e.dispatchEvent(new Event('input',{bubbles:true}));e.form.requestSubmit();});
 await shownSent;await gate.finish();
 {const after=await settled();
  check(!after.latestDisabled,'a sent message shown while Latest loaded: the Latest button is enabled again');
  check(after.busy==='false',`a sent message shown while Latest loaded: the list is not marked busy (aria-busy=${after.busy})`);
  check(!after.pill?.disabled,'a sent message shown while Latest loaded: "Jump to latest" is not left disabled');
  if(!after.latestDisabled){await p.waitForFunction(()=>[...document.querySelectorAll('article[id^="chat-message-"]')].some(a=>a.textContent.includes('Latest stuck taken over')),{timeout:20000});await away();await p.click(latestButton);
   await p.waitForFunction((latestButton,log)=>{const l=document.querySelector(log),b=document.querySelector(latestButton);return l.scrollHeight-l.scrollTop-l.clientHeight<5&&b.getAttribute('aria-disabled')==='true'&&!b.disabled&&l.getAttribute('aria-busy')==='false';},{timeout:20000},latestButton,log);}}
 console.log((failed.length?'SOFT ':'PASS ')+'A3 a sent message shown while Latest was loading leaves Latest usable.');
 // B. A message sent from an older part of the room: the page then loads the latest messages to show
 // it. Another member's message arrives while that loads. The page asks again by itself; before, it
 // gave up and asked for "Show sent message".
 await marker('main',roots[19].unread_seq);await p.goto('about:blank');await p.goto(base+'/chat?room=main');await ready(roomInput);
 await p.waitForSelector(`#chat-message-${roots[20].id}[data-unread-start="true"]`,{visible:true});await pause(400);
 assert(!(await p.$('#chat-message-'+newest.id)),'the room opened on an older part: its newest message is not loaded');
 let refreshes=0;const countRefreshes=r=>{if(plainHistory(r))refreshes++;};p.on('request',countRefreshes);
 gate=await hold(plainHistory);
 await p.type(roomInput,'Latest stuck sent');await p.$eval(roomInput,e=>e.form.requestSubmit());await gate.ready();
 const [sent]=await sql('select id,unread_seq from longboard_chat_messages where member_id=$1 and body=$2',[alice.member.id,'Latest stuck sent']);assert(sent,'the message was sent');
 const [arrival]=await control('sql',{sql:"insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Bob','Latest stuck arrival','main') returning *",args:[bob.member.id],broadcast:'longboard_chat_messages'});
 await pause(800);await gate.finish();
 await p.waitForFunction((sent,old)=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Show sent message')||(document.getElementById('chat-message-'+sent)&&!document.getElementById('chat-message-'+old)),{timeout:20000},sent.id,roots[20].id);
 await pause(500);
 const shown=await p.evaluate((sent,old,arrival)=>({retryButton:[...document.querySelectorAll('button')].some(b=>b.textContent==='Show sent message'),error:document.querySelector('[data-chat-list-error]')?.textContent??'',sent:!!document.getElementById('chat-message-'+sent),old:!!document.getElementById('chat-message-'+old),arrival:!!document.getElementById('chat-message-'+arrival)}),sent.id,roots[20].id,arrival.id);
 p.off('request',countRefreshes);
 check(!shown.retryButton&&!shown.error,`a message arriving while the sent message loads does not ask for "Show sent message" (${JSON.stringify(shown)})`);
 check(shown.sent&&!shown.old&&shown.arrival,`the latest messages show, with the sent message and the arrival (${JSON.stringify(shown)})`);
 check(refreshes===2,`the page asked twice: once, and once more after the arrival (asked ${refreshes} times)`);
 // The read marker rules are unchanged: showing the sent message reads nothing in the gap it skipped.
 assert((await readRoom('main'))<=Number(roots[20].unread_seq),'showing the sent message is not mark-all');
 console.log((failed.length?'SOFT ':'PASS ')+'B a message arriving while the sent message loads is retried by the page, with the read marker untouched.');
 // C. A fresh page whose own identity (its first /api/chat/updates answer) arrives after the reader
 // has typed "@Bo": the list stays as it is and the name is looked up once. Before, the list emptied
 // and the name was looked up again.
 await marker('main',(await sql("select max(unread_seq) as max from longboard_chat_messages where room_slug='main'"))[0].max);
 let lookups=0;const countLookups=r=>{const url=new URL(r.url());if(url.pathname==='/api/chat/mentions'&&url.searchParams.get('q')==='Bo')lookups++;};p.on('request',countLookups);
 await p.goto('about:blank');gate=await hold(r=>new URL(r.url()).pathname==='/api/chat/updates',{first:false});
 await p.goto(base+'/chat?room=main');await ready(roomInput);await gate.ready();
 await p.type(roomInput,'@Bo');
 const names=()=>p.$$eval('[role="listbox"] [role="option"]',rows=>rows.map(row=>row.textContent.trim()));
 await p.waitForFunction(()=>document.querySelectorAll('[role="listbox"] [role="option"]').length>0,{timeout:20000});
 const before=await names();assert(before.some(name=>name.includes('Bob')),'the @ list names Bob: '+before);assert.equal(lookups,1);
 // From here on, note every moment the list is empty or gone.
 await p.evaluate(()=>{window.__listGone=0;new MutationObserver(()=>{if(!document.querySelector('[role="listbox"] [role="option"]'))window.__listGone++;}).observe(document.body,{subtree:true,childList:true});});
 await gate.finish();
 // The identity has arrived once the page's updates have answered; then leave time for a second lookup (200 ms after it).
 await p.waitForResponse(r=>new URL(r.url()).pathname==='/api/chat/updates'&&r.ok(),{timeout:20000}).catch(()=>{});await pause(1500);
 const gone=await p.evaluate(()=>window.__listGone);p.off('request',countLookups);
 check(gone===0,`the @ list stayed on screen when the page's identity arrived (emptied ${gone} times)`);
 check(lookups===1,`the name was looked up once (${lookups} lookups)`);
 assert.deepEqual(await names(),before,'the @ list still names the same people');
 console.log((failed.length?'SOFT ':'PASS ')+'C the @ list does not blink when a fresh page learns its identity.');
 assert.deepEqual(errors,[]);
}catch(error){console.error('Runtime errors',errors);console.error('State',await state().catch(()=>null));console.error('Page',p.url(),await p.evaluate(()=>document.body.innerText.slice(0,3000)).catch(()=>''));await p.screenshot({path:'/tmp/chat-latest-stuck-failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
if(soft&&failed.length){console.log(`SOFT ${failed.length} failed:\n`+failed.join('\n'));process.exit(1);}
