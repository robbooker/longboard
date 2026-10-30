// #328 Polls, against the shared fixture on this test's own ports (localhost:3428, database
// 127.0.0.1:54628). Synthetic data only. Alice on a computer, Bob on a phone, in Social:
//  - Alice makes an anonymous one-answer poll from the room composer's + menu;
//  - Bob sees it but no results until he taps an answer; then counts, percentages and the total;
//  - Alice (the creator) still sees no results until she votes; her vote reaches Bob's open page
//    without a reload, and Bob's change and take-back reach hers;
//  - no reader, the creator included, gets a voter's identity from the API for an anonymous poll;
//  - Bob makes a visible-votes several-answers poll in a thread on his phone, and Alice makes one
//    in a thread on her computer; votes show names per answer; several answers count;
//  - only Alice can close her poll; closed, it shows final results to everyone and takes no votes.
// Live delivery runs over a faked Ably (as chat-event-stream-browser.mjs): chat-polls-preload.mjs
// sends the server's Ably REST publishes to the hub here on 127.0.0.1:54631, which hands them to the
// pages' faked Ably sockets. The test checks that votes went out as "polls" signals.
// POLL_SHOTS=<dir> saves screenshots.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
import {createServer} from 'node:http';
import msgpack from '@ably/msgpack-js';
const base=process.env.CHAT_TEST_URL||'http://localhost:3428',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54628';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.POLL_SHOTS;
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const {people:[alice,bob,mallory]}=await control('identity');
// The send limit (one message per 1.5 s, 30 per 10 minutes) isn't under test here.
const unthrottle=()=>sql("update longboard_chat_messages set created_at=created_at-interval '1 day' where created_at>now()-interval '1 day' and body not like '📊%'");
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(check,timeout,what){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(50);}throw Error(`Timed out: ${what}`);}
// --- Fake Ably realtime (as chat-typing-browser.mjs; maxIdleInterval 0, since this hub sends no
// heartbeats and Ably would otherwise drop the connection every 25 s) plus the server's REST publishes. ---
const conns=new Map();let serial=0,dropNext=0;const published=[];
const decode=token=>JSON.parse(Buffer.from(token.replace(/^fake\./,''),'base64url').toString());
function deliver(conn,frame){void conn.page.evaluate((id,f)=>window.__ablyFakeDeliver(id,f),conn.id,JSON.stringify(frame)).catch(()=>{});}
function connected(conn){deliver(conn,{action:4,connectionId:`c${conn.key}:${++serial}`,connectionDetails:{clientId:conn.clientId,connectionKey:`k${conn.key}:${serial}`,maxMessageSize:65536,maxFrameSize:524288,maxInboundRate:250,connectionStateTtl:120000,maxIdleInterval:0,serverId:'fake'}});}
function grant(conn,token){const t=decode(token);conn.clientId=t.clientId;conn.capability=JSON.parse(t.capability);}
function frame(page,who,id,kind,data){
 const key=`${who}:${id}`;
 if(kind==='open'){const conn={page,who,id,key,channels:new Set()};grant(conn,new URL(data).searchParams.get('access_token'));conns.set(key,conn);connected(conn);return;}
 const conn=conns.get(key);if(!conn)return;
 if(kind==='close'){conns.delete(key);return;}
 const m=JSON.parse(data),can=op=>conn.capability[m.channel]?.includes(op);
 if(m.action===0)return deliver(conn,{action:0});
 if(m.action===17){grant(conn,m.auth.accessToken);return connected(conn);}
 if(m.action===10){if(!can('subscribe'))return deliver(conn,{action:9,channel:m.channel,error:{code:40160,statusCode:401,message:'Channel denied'}});conn.channels.add(m.channel);return deliver(conn,{action:11,channel:m.channel,flags:(can('publish')?131072:0)|262144});}
 if(m.action===12){conn.channels.delete(m.channel);return deliver(conn,{action:13,channel:m.channel});}
 if(m.action===7)return deliver(conn,{action:8});
 if(m.action===15)return deliver(conn,{action:1,msgSerial:m.msgSerial,count:m.messages.length});
}
async function fakeAbly(page,who){
 await page.exposeFunction('__ablyFake',(id,kind,data)=>frame(page,who,id,kind,data));
 await page.evaluateOnNewDocument(()=>{
  const Real=window.WebSocket,open=new Map();let n=0;
  window.__ablyFakeDeliver=(id,f)=>open.get(id)?.onmessage?.({data:f});
  // The transport drops (as a lost network does): Ably reconnects on a new socket.
  window.__ablyFakeDrop=()=>{for(const s of [...open.values()]){s.readyState=3;open.delete(s.id);window.__ablyFake(s.id,'close','');s.onclose?.({code:1006,wasClean:false});}};
  class Fake{
   static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
   constructor(url,protocols){
    if(!String(url).includes('ably'))return new Real(url,protocols);
    this.url=String(url);this.readyState=0;this.id=++n;this.binaryType='blob';open.set(this.id,this);
    setTimeout(()=>{this.readyState=1;this.onopen?.({});window.__ablyFake(this.id,'open',this.url);},0);
   }
   send(data){window.__ablyFake(this.id,'frame',String(data));}
   close(){if(this.readyState===3)return;this.readyState=3;open.delete(this.id);window.__ablyFake(this.id,'close','');setTimeout(()=>this.onclose?.({code:1000,wasClean:true}),0);}
  }
  window.WebSocket=Fake;
 });
 await page.setRequestInterception(true);
 page.on('request',request=>{
  if(!request.url().includes('/requestToken'))return void request.continue();
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(request.method()==='OPTIONS')return void request.respond({status:204,headers:cors});
  const body=JSON.parse(request.postData()),token='fake.'+Buffer.from(JSON.stringify({clientId:body.clientId,capability:body.capability})).toString('base64url');
  void request.respond({status:200,contentType:'application/json',headers:cors,body:JSON.stringify({token,keyName:body.keyName,issued:Date.now(),expires:Date.now()+3600e3,capability:body.capability,clientId:body.clientId})});
 });
}
// The server's REST publishes (redirected here by the preload).
const hub=createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
 const match=req.url.match(/^\/channels\/([^/]+)\/messages/);
 if(req.method!=='POST'||!match){res.writeHead(404);return res.end();}
 const channel=decodeURIComponent(match[1]),raw=Buffer.concat(chunks);
 const body=String(req.headers['content-type']).includes('msgpack')?msgpack.decode(raw):JSON.parse(raw.toString());
 const messages=(Array.isArray(body)?body:[body]).map(x=>({...x,data:typeof x.data==='string'||Buffer.isBuffer(x.data)?String(x.data):JSON.stringify(x.data),encoding:typeof x.data==='string'||Buffer.isBuffer(x.data)?x.encoding:'json',id:`s${++serial}:0`,timestamp:Date.now()}));
 const at=Date.now();
 for(const x of messages)published.push({channel,at,name:x.name,data:JSON.parse(x.data)});
 res.writeHead(201,{'content-type':'application/json'});res.end('{}');
 if(dropNext>0){dropNext--;return;}
 for(const conn of conns.values())if(conn.channels.has(channel))deliver(conn,{action:15,channel,id:`p${serial}`,connectionId:'server',timestamp:at,messages});
});}).listen(54631,'127.0.0.1');


const shot=async(p,name)=>{if(shots){await pause(400);await p.screenshot({path:`${shots}/${name}.png`});}};
const card=id=>`[data-poll-message="${id}"]`;
const scrollTo=(p,id)=>p.evaluate(sel=>([...document.querySelectorAll(sel)].find(e=>e.checkVisibility())??document.querySelector(sel))?.scrollIntoView({block:'center'}),card(id));
const shown=(p,id,timeout=60000)=>p.waitForFunction(sel=>[...document.querySelectorAll(sel)].some(e=>e.checkVisibility()),{timeout},card(id));
const api=(p,body)=>p.evaluate(async body=>{const r=await fetch('/api/chat/polls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,text:await r.text()};},body);
// The card on screen (a phone keeps the room's copy hidden while a thread is open).
const view=(p,id)=>p.evaluate(sel=>{const e=[...document.querySelectorAll(sel)].find(x=>x.checkVisibility())??document.querySelector(sel);return {
 results:!!e.dataset.pollResults,closed:!!e.dataset.pollClosed,
 total:e.querySelector('[data-poll-total]')?.textContent??'',
 choices:[...e.querySelectorAll('[data-poll-option]')].map(b=>b.textContent),
 rows:[...e.querySelectorAll('[data-poll-result]')].map(li=>({text:li.querySelector('div')?.textContent??'',people:li.querySelector('[data-poll-people]')?.textContent??'',mine:!!li.dataset.mine})),
 buttons:[...e.querySelectorAll('button')].filter(b=>b.checkVisibility()).map(b=>b.textContent),
};},card(id));
async function until(p,id,check,label,ms=15000){
 const end=Date.now()+ms;let last;
 while(Date.now()<end){try{last=await view(p,id);if(check(last))return last;}catch{}await pause(250);}
 assert.fail(`${label}: ${JSON.stringify(last)}`);
}
// Taps on a phone, clicks on a computer. The dev server's own corner badge can sit over the + button;
// then the button is pressed directly (the badge is not part of the app).
const press=async(p,selector)=>{
 const h=await p.waitForSelector(selector,{visible:true});await h.scrollIntoView();
 const covered=await h.evaluate(e=>{const r=e.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!top&&!e.contains(top)&&!top.contains(e);});
 if(covered)return h.evaluate(e=>e.click());
 if(await p.evaluate(()=>matchMedia('(pointer:coarse)').matches))await h.tap();else await h.click();
};
const buttonIn=(id,text)=>`::-p-xpath(//*[@data-poll-message="${id}"]//button[normalize-space()="${text}"])`;
async function login(person,size){
 const context=await browser.createBrowserContext(),p=await context.newPage();
 p.on('pageerror',e=>errors.push(`${person.email}: ${e.message}`));
 const who=person.email.split('@')[0];
 await fakeAbly(p,who);
 await p.setViewport(size);await signIn(p,base,person.email,{next:'/chat?room=social',composer:'textarea[aria-label="Message Social"]'});
 await waitFor(()=>[...conns.values()].some(c=>c.page===p&&c.channels.has('private:chat:room:social')),30000,`${who} Ably attach`);
 return p;
}
/** Opens "New poll" from a composer's + menu and fills it in. */
async function makePoll(p,{scope='form:has(textarea[aria-label="Message Social"])',question,options,visible=false,multi=false,shot:name}){
 await unthrottle();
 await press(p,`${scope} button[aria-label="Add to message"]`);
 await press(p,`::-p-xpath(//button[normalize-space()="📊 Poll"])`);
 const dialog='dialog[data-poll-composer][open]';
 await p.waitForSelector(dialog,{visible:true});
 await p.type(`${dialog} textarea`,question);
 for(let i=0;i<options.length;i++){
  if(i>=2)await press(p,`::-p-xpath(//dialog[@open]//button[normalize-space()="+ Add an answer"])`);
  await p.type(`${dialog} input[aria-label="Answer ${i+1}"]`,options[i]);
 }
 if(visible)await press(p,`::-p-xpath(//dialog[@open]//label[contains(.,"Anonymous voting")]//input)`);
 if(multi)await press(p,`::-p-xpath(//dialog[@open]//label[contains(.,"Allow several answers")]//input)`);
 if(name)await shot(p,name);
 const sent=p.waitForResponse(r=>r.url().endsWith('/api/chat/polls')&&r.request().method()==='POST'&&r.request().postData().includes('"create"'));
 await press(p,`::-p-xpath(//dialog[@open]//button[normalize-space()="Send poll"])`);
 const response=await sent;assert.equal(response.status(),200,await response.text());
 const {message}=await response.json();
 await p.waitForSelector(dialog,{hidden:true});
 await shown(p,message.id,30000);
 return message.id;
}

try{
 const a=await login(alice,desktop),b=await login(bob,phone);
 // A bad poll is refused in the form itself.
 await press(a,'form:has(textarea[aria-label="Message Social"]) button[aria-label="Add to message"]');
 await press(a,`::-p-xpath(//button[normalize-space()="📊 Poll"])`);
 await a.type('dialog[data-poll-composer][open] textarea','Only one answer?');
 await a.type('dialog[data-poll-composer][open] input[aria-label="Answer 1"]','Yes');
 await press(a,`::-p-xpath(//dialog[@open]//button[normalize-space()="Send poll"])`);
 await a.waitForSelector('::-p-xpath(//dialog[@open]//*[@role="alert"][contains(.,"at least two answers")])');
 await press(a,`::-p-xpath(//dialog[@open]//button[normalize-space()="Cancel"])`);
 await a.waitForSelector('dialog[data-poll-composer][open]',{hidden:true});

 // 1. Alice: anonymous, one answer, from the room composer on a computer.
 const room=await makePoll(a,{question:'Where does SPY close today?',options:['Higher','Lower','Flat'],shot:'desktop-1-composer-new-poll'});
 let av=await view(a,room);
 assert.equal(av.results,false,'the creator sees no results before voting');assert.equal(av.total,'Vote to see the results');
 assert.deepEqual(av.choices,['Higher','Lower','Flat']);
 // 2. Bob, on his phone, sees it live (or on the next reconcile) without results, then votes.
 await shown(b,room,15000);
 let bv=await view(b,room);
 assert.equal(bv.results,false);assert.equal(bv.rows.length,0);
 await scrollTo(b,(room));await shot(b,'phone-2-poll-before-voting');
 await shot(a,'desktop-2-poll-before-voting');
 await press(b,`${card(room)} [data-poll-option]:nth-child(1)`);
 bv=await until(b,room,v=>v.results&&v.total==='1 person voted','Bob sees results after voting');
 assert.match(bv.rows[0].text,/100%.*Higher.*your vote.*1 vote/);assert.equal(bv.rows[0].mine,true);
 // Alice still sees nothing until she votes.
 await pause(1500);av=await view(a,room);assert.equal(av.results,false,'non-voter still sees no results');
 const before=JSON.parse((await api(a,{action:'read',room:'social',messageIds:[room]})).text).polls[0];
 assert.equal(JSON.stringify(before).match(/"votes"|"percent"|"total"/),null,'no counts in the API for a non-voter');
 // 3. Alice votes; Bob's open page follows without a reload.
 await press(a,`${card(room)} [data-poll-option]:nth-child(2)`);
 av=await until(a,room,v=>v.results&&v.total==='2 people voted','Alice sees results');
 assert.match(av.rows[0].text,/50%.*Higher/);assert.match(av.rows[1].text,/50%.*Lower.*your vote/);
 await shot(a,'desktop-3-poll-after-voting-results');
 bv=await until(b,room,v=>v.total==='2 people voted','Bob sees Alice\'s vote live');
 await scrollTo(b,(room));await shot(b,'phone-3-poll-after-voting-results');
 // 4. Bob changes his vote, then takes it back; Alice's page follows.
 await press(b,buttonIn(room,'Change vote'));
 await press(b,`${card(room)} [data-poll-option]:nth-child(3)`);
 await press(b,buttonIn(room,'Save vote'));
 await until(b,room,v=>v.rows[2]?.mine&&/50%.*Flat/.test(v.rows[2].text),'Bob changed to Flat');
 await until(a,room,v=>/0%.*Higher.*0 votes/.test(v.rows[0].text)&&/50%.*Flat/.test(v.rows[2].text),'Alice sees the change live');
 await press(b,buttonIn(room,'Take back vote'));
 bv=await until(b,room,v=>!v.results&&v.choices.length===3,'Bob took his vote back');
 await until(a,room,v=>v.total==='1 person voted','Alice sees the take-back live');
 // Server rules: one answer only; nobody but Alice closes; outsiders can't see the room.
 const options=JSON.parse((await api(a,{action:'read',room:'social',messageIds:[room]})).text).polls[0].options.map(o=>o.id);
 assert.equal((await api(b,{action:'vote',room:'social',messageId:room,optionIds:options.slice(0,2)})).status,400);
 assert.equal((await api(b,{action:'close',room:'social',messageId:room})).status,403);
 assert.equal((await api(b,{action:'vote',room:'social',messageId:room,optionIds:[options[0]]})).status,200);
 // Anonymous: nobody's identity in any answer, the creator's included.
 for(const p of [a,b]){const t=(await api(p,{action:'read',room:'social',messageIds:[room]})).text;for(const who of [alice,bob])assert(!t.includes(who.member.id)&&!t.includes(who.id),'anonymous poll leaks no voter');assert(!/Alice|Bob/.test(t));}

 // 5. Bob, on his phone, a visible-votes several-answers poll in a thread.
 await b.goto(`${base}/chat?room=social&thread=${room}`);
 const threadForm='form:has(textarea[aria-label^="Reply to"])';
 await b.waitForSelector(`${threadForm} textarea`,{visible:true,timeout:60000});
 const thread=await makePoll(b,{scope:threadForm,question:'Which did you trade?',options:['SPY','QQQ','IWM'],visible:true,multi:true,shot:'phone-4-composer-thread-poll'});
 await press(b,`${card(thread)} [data-poll-option]:nth-child(1)`);
 await press(b,`${card(thread)} [data-poll-option]:nth-child(2)`);
 await press(b,buttonIn(thread,'Vote'));
 bv=await until(b,thread,v=>v.results&&v.total==='1 person voted','Bob voted twice');
 assert.match(bv.rows[0].text,/100%.*SPY/);assert.match(bv.rows[1].text,/100%.*QQQ/);
 assert.equal(bv.rows[0].people,'Bob');
 // Alice, on her computer, in the same thread: votes and sees names per answer; makes her own poll there.
 await a.goto(`${base}/chat?room=social&thread=${room}`);
 await shown(a,thread,60000);
 assert.equal((await view(a,thread)).results,false);
 await press(a,`${card(thread)} [data-poll-option]:nth-child(2)`);
 await press(a,buttonIn(thread,'Vote'));
 av=await until(a,thread,v=>v.total==='2 people voted'&&v.rows[1].people==='Bob, Alice','visible votes name voters');
 assert.match(av.rows[1].text,/100%.*QQQ.*2 votes/);assert.match(av.rows[0].text,/50%.*SPY/);
 await scrollTo(a,(thread));await shot(a,'desktop-4-visible-votes-names');
 await until(b,thread,v=>v.rows[1].people==='Bob, Alice','Bob sees Alice\'s name live');
 await scrollTo(b,(thread));await shot(b,'phone-5-visible-votes-names');
 const own=await makePoll(a,{scope:'form:has(textarea[aria-label^="Reply to"])',question:'Size up tomorrow?',options:['Yes','No']});
 assert.equal((await sql('select reply_to_id from longboard_chat_messages where id=$1',[own]))[0].reply_to_id,room,'thread poll is a reply');
 assert.equal((await sql('select reply_to_id from longboard_chat_messages where id=$1',[thread]))[0].reply_to_id,room);

 // 6. Alice closes her room poll; everyone sees final results and no one can vote.
 await a.goto(`${base}/chat?room=social`);await shown(a,room,60000);
 // The phone reopens the thread it was in; back to the room.
 await b.goto(`${base}/chat?room=social`);await b.waitForFunction(()=>[...document.querySelectorAll('textarea[aria-label^="Reply to"],textarea[aria-label="Message Social"]')].some(e=>e.checkVisibility()),{timeout:60000});await pause(1000);
 if(await b.evaluate(()=>[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='← Chat'&&e.checkVisibility())))await press(b,'::-p-xpath(//button[normalize-space()="← Chat"])');
 await shown(b,room);
 assert.equal((await view(b,room)).buttons.includes('Close poll…'),false,'only the creator sees Close');
 await press(a,buttonIn(room,'Close poll…'));
 await press(a,buttonIn(room,'Close poll'));
 av=await until(a,room,v=>v.closed&&v.results&&v.choices.length===0,'closed for Alice');
 assert.equal(av.buttons.length,0,'no vote or close buttons on a closed poll');
 await scrollTo(a,(room));await shot(a,'desktop-5-closed-poll');
 bv=await until(b,room,v=>v.closed&&v.choices.length===0,'Bob sees it closed live');
 await scrollTo(b,(room));await shot(b,'phone-6-closed-poll');
 // Mallory never voted: a closed poll shows her the final results.
 const m=await login(mallory,desktop);await shown(m,room,60000);
 const mv=await until(m,room,v=>v.closed&&v.results,'closed results for a non-voter');
 assert.match(mv.total,/2 people voted/);
 assert.equal((await api(m,{action:'vote',room:'social',messageId:room,optionIds:[options[0]]})).status,409);
 assert.equal((await api(b,{action:'vote',room:'social',messageId:room,optionIds:[]})).status,409);
 // A poll's question can't be edited.
 const edit=await a.evaluate(async id=>(await fetch('/api/chat/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'edit',room:'social',messageId:id,body:'📊 Poll: changed',expectedBody:'📊 Poll: Where does SPY close today?'})})).status,room);
 assert.equal(edit,403);
 const signals=published.filter(x=>x.channel==='private:chat:room:social'&&x.name==='changed'&&x.data.topics?.[0]==='polls');
 assert(signals.length>=6,'votes and closes went out as polls signals: '+signals.length);
 assert(signals.every(x=>Object.keys(x.data).sort().join()==='kind,messageId,topics'),'a polls signal carries only the message id');
 assert.deepEqual(errors,[]);
 console.log('PASS polls: create (room+thread, computer+phone), hidden results before voting, live counts both ways, change/take back, single-answer server rule, anonymous API, visible names, several answers, creator-only close, closed results for all, no votes after close, no editing.');
}finally{await browser.close();hub.close();}
