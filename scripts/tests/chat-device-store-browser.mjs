// DEVICE-STORE: recent chat kept on the device (IndexedDB) draws a room at once on a phone, before
// the server answers, then the server's copy replaces it (edits, deletions, new messages; no
// duplicates). Rooms with unread messages wait for the server's landing spot. Another member
// signing in on the same browser never sees the first member's copy, and "Sign out of chat" deletes it.
// Actual production UI/API/current SQL; exclusively synthetic local accounts/data.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.CHAT_TEST_URL||'http://localhost:3393',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54593';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const identity=await control('identity'),{people:[alice,bob]}=identity;
await sql("update profiles set role='user' where id=$1",[alice.id]);
const seed=async(room,label)=>sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug,created_at) select $1,$1,'Bob','Device '||$2||' '||n,$3,now()+n*interval '1 millisecond' from generate_series(1,80)n returning *",[bob.member.id,label,room]);
const social=await seed('social','social'),main=await seed('main','main');
const mark=(account,room,seq)=>sql('insert into chat_room_reads(account_id,room_slug,through_seq) values($1,$2,$3) on conflict(account_id,room_slug) do update set through_seq=excluded.through_seq',[account,room,seq]);
const latest=async room=>(await sql('select max(unread_seq) s from longboard_chat_messages where room_slug=$1',[room]))[0].s;
await mark(alice.id,'social',await latest('social'));await mark(alice.id,'main',await latest('main'));
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const scale=Number(process.env.CHAT_TIMING_SCALE)||1;
const errors=[];const pause=ms=>new Promise(r=>setTimeout(r,ms));
const DB='longboard-chat-device-v1';
const stored=p=>p.evaluate(async DB=>{if(!(await indexedDB.databases()).some(d=>d.name===DB))return null;return new Promise((resolve,reject)=>{const q=indexedDB.open(DB);q.onsuccess=()=>{const db=q.result;if(!db.objectStoreNames.contains('rows')){db.close();resolve([]);return;}const g=db.transaction('rows').objectStore('rows').getAll();g.onsuccess=()=>{db.close();resolve(g.result);};g.onerror=()=>reject(g.error);};q.onerror=()=>reject(q.error);});},DB);
const storedRow=async(p,key)=>{for(let i=0;i<60*scale;i++){const row=(await stored(p))?.find(r=>r.key===key);if(row)return row;await pause(250);}throw Error('not kept on the device: '+key);};
const log=label=>`[role="log"][aria-label="${label} messages"]`;
const shown=(p,label,timeout=15000)=>p.waitForSelector(`${log(label)}:not([data-positioning]) [id^="chat-message-"]`,{visible:true,timeout});
const texts=(p,label)=>p.$$eval(`${log(label)} article[id^="chat-message-"]`,rows=>rows.map(r=>({id:r.id,text:r.textContent})));
const gap=(p,label)=>p.$eval(log(label),e=>Math.round(e.scrollHeight-e.clientHeight-e.scrollTop));
async function signIn(p,email){await p.setViewport({width:1440,height:1000});await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email',{visible:true});await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>{const f=document.querySelector('#li-email')?.form;return f&&Object.keys(f).some(k=>k.startsWith('__reactProps$')&&typeof f[k]?.onSubmit==='function');});for(const [field,value] of [['#li-email',email],['#li-password','demo-only']]){await p.click(field,{clickCount:3});await p.keyboard.press('Backspace');await p.type(field,value);}await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label="Message LB"]');}
const phone=p=>p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
async function to(p,slug){await p.waitForSelector('button[aria-label="Back to all chats"]',{visible:true});await p.tap('button[aria-label="Back to all chats"]');await p.waitForSelector(`nav a[href*="room=${slug}"]`,{visible:true});await pause(300);await p.tap(`nav a[href*="room=${slug}"]`);}
// Holds this room's history and opening replies until released: whatever shows meanwhile is the device's.
const holds=new WeakMap();
function hold(p,room){let state=holds.get(p);if(!state){state={room:null,held:[]};holds.set(p,state);p.on('request',r=>{if(r.isInterceptResolutionHandled())return;const u=r.url();if(state.room&&(u.includes(`/api/chat/history?room=${state.room}`)||u.includes(`/api/chat/opening?room=${state.room}`)))state.held.push(r);else r.continue();});}
 if(room)state.room=room;return {get held(){return state.held;},async stop(){state.room=null;for(const r of state.held.splice(0))r.continue();}};}
try{
 const context=await browser.createBrowserContext(),p=await context.newPage();p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));
 await p.setRequestInterception(true);hold(p,null);
 await signIn(p,alice.email);await phone(p);
 await p.goto(base+'/chat?room=main');await shown(p,'LB');
 // 1. Visiting a room keeps its newest page on the device (server rows only, this member's).
 await to(p,'social');await shown(p,'Social');
 const kept=await storedRow(p,'room:social');
 assert.ok(kept.owner.endsWith(':'+alice.member.id)&&kept.owner.startsWith(alice.id+':'),kept.owner);
 assert.equal(kept.data.messages.length,80);assert.equal(kept.data.messages.at(-1).body,'Device social 80');
 assert.ok(kept.data.messages.every(m=>!m.pending&&!m.send_client_id),'only confirmed rows');
 await to(p,'main');await shown(p,'LB');await storedRow(p,'room:main');
 console.log('PASS visited rooms are kept on the device for this member: newest page, confirmed rows only.');
 // 2. While away the room changes: an edit, a deletion and a new message (Alice's own, so nothing is unread).
 const [edited,deleted]=[social.at(-2),social.at(-3)];
 await sql("update longboard_chat_messages set body='Device social 79 edited',edited_at=now(),revision=coalesce(revision,0)+1 where id=$1",[edited.id]);
 await sql('update longboard_chat_messages set deleted_at=now() where id=$1',[deleted.id]);
 const [fresh]=await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Alice','Device social 81','social') returning *",[alice.member.id]);
 await mark(alice.id,'social',fresh.unread_seq);
 // A new page: nothing in memory, only the device has SOCIAL.
 await p.goto(base+'/chat?room=main');await shown(p,'LB');await pause(1500);
 let server=hold(p,'social');
 const tapped=Date.now();await to(p,'social');await shown(p,'Social',3000*scale);const drawn=Date.now()-tapped;
 assert.ok(server.held.length>0,'the server has not answered yet');
 let rows=await texts(p,'Social');
 assert.ok(rows.at(-1).text.includes('Device social 80'),'draws the kept page: '+rows.at(-1).text);
 assert.ok(rows.some(r=>r.id==='chat-message-'+deleted.id),'still the kept copy (deleted row not yet known)');
 assert.ok(!rows.some(r=>r.text.includes('Device social 81')));
 assert.ok((await gap(p,'Social'))<=2,'opens at the newest message, gap '+await gap(p,'Social'));
 await server.stop();
 await p.waitForFunction(s=>[...document.querySelectorAll(s+' article')].some(a=>a.textContent.includes('Device social 81')),{},log('Social'));
 await p.waitForFunction(s=>[...document.querySelectorAll(s+' article')].some(a=>a.textContent.includes('Device social 79 edited')),{},log('Social'));
 rows=await texts(p,'Social');
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length,'no duplicate rows');
 const gone=rows.find(r=>r.id==='chat-message-'+deleted.id);assert.ok(!gone||!gone.text.includes('Device social 78'),'the deletion applies');
 assert.ok((await gap(p,'Social'))<=2,'still at the newest message');
 console.log(`PASS after a reload SOCIAL drew from the device in ${drawn} ms (server held), then the server's edit, deletion and new message replaced it with no duplicates.`);
 // 3. Unread messages: wait for the server's landing spot (the device can't know it).
 await to(p,'main');await shown(p,'LB');
 const unread=await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) select $1,$1,'Bob','Device unread '||n,'social' from generate_series(1,3)n returning *",[bob.member.id]);
 await p.evaluate(()=>window.dispatchEvent(new Event('chat-activity-refresh')));
 await p.waitForSelector('nav a[href*="room=social"][data-unread]');
 server=hold(p,'social');await to(p,'social');await pause(1200);
 assert.ok(await p.$(`${log('Social')}[data-positioning]`),'with unread messages the room waits for the server');
 await server.stop();await shown(p,'Social');
 await p.waitForFunction((s,id)=>{const e=document.querySelector(s),r=document.getElementById(id);if(!e||!r)return false;const a=e.getBoundingClientRect(),b=r.getBoundingClientRect();return b.bottom>a.top&&b.top<a.bottom;},{},log('Social'),'chat-message-'+unread[0].id);
 console.log('PASS a room with unread messages waits for the server and lands on the first unread.');

 // 4. Another member on the same browser (the first one's session simply ended): the copy is wiped.
 await to(p,'main');await shown(p,'LB');await storedRow(p,'room:social');
 const client=await p.createCDPSession();await client.send('Network.clearBrowserCookies');
 await signIn(p,bob.email);await phone(p);await p.goto(base+'/chat?room=main');await shown(p,'LB');await pause(2500);
 const after=await stored(p)??[];
 assert.ok(after.every(r=>r.owner.startsWith(bob.id+':')),'only the signed-in member is kept: '+JSON.stringify(after.map(r=>[r.key,r.owner])));
 assert.ok(!JSON.stringify(after).includes('Device social 81'),"Alice's copy is gone");
 server=hold(p,'social');await to(p,'social');await pause(1200);
 assert.ok(!(await p.$(`${log('Social')}:not([data-positioning]) [id^="chat-message-"]`)),'nothing to draw for Bob before the server answers');
 await server.stop();await shown(p,'Social');
 console.log("PASS another member signing in on this browser never sees the first member's copy (wiped before reading).");
 await context.close();
 // 5. "Sign out of chat" (a chat login session) deletes the device copy.
 const scout=await browser.createBrowserContext(),s=await scout.newPage();s.on('pageerror',e=>errors.push(e.message));await s.setViewport({width:1440,height:1000});
 // Nothing unread, so the room opens on its newest page (an older unread window is never kept).
 const [{account_id:scoutAccount}]=await sql('select account_id from chat_sessions limit 1');await mark(scoutAccount,'social',await latest('social'));
 await scout.setCookie({name:'lb-chat-session',value:identity.scoutToken,url:base,httpOnly:true});
 await s.goto(base+'/chat?room=social');await shown(s,'Social');await storedRow(s,'room:social');
 await s.click('button[aria-label="Chat settings"]');
 await s.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Sign out of chat'&&b.getBoundingClientRect().width>0));
 await s.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sign out of chat').click());
 await s.waitForFunction(()=>location.pathname.includes('login'));await pause(500);
 const left=await stored(s);
 assert.ok(left===null||left.length===0,'sign-out deleted the device copy: '+JSON.stringify(left?.map(r=>r.key)));
 console.log('PASS "Sign out of chat" deletes everything kept on the device.');
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
