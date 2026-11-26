// #524 Webinar notices (localhost:3524, database 127.0.0.1:54724). No real LiveKit, YouTube or Loom
// is reached and no real key exists here:
//  - the server's LiveKit calls go to this test's own stand-in on 127.0.0.1:54633 (the manifest's
//    `livekit` preset points LIVEKIT_URL at it), one made-up ingress per room;
//  - LiveKit's webhooks are sent by the test, signed with the manifest's made-up key and secret;
//  - a player's address (youtube-nocookie.com, loom.com) is answered by the test itself.
// Synthetic members and messages only. Alice is a chat admin, Bob a member.
//  - Gainers does not offer live video: an admin has no "Go live" there, the page asks no status
//    for it, the server refuses to make it a key and LiveKit is never asked about it;
//  - Booker Stock Club: the broadcast arrives and the club gets its "live now" message (as "Live
//    Video"), Bob his bell entry and one queued phone notification; when it stops, the SAME
//    message says it ended and that the recording will follow, and the bell entries are gone;
//  - a member has no "Add recording link"; the admin has, under the ended notice: a link that is
//    not a YouTube or Loom video is refused in place; a YouTube link is saved, and the notice then
//    reads "Watch the recording" with the link and the recordings rooms' player card; pressing play
//    puts the expected player address in the frame (and nothing was asked of YouTube before that);
//    nobody is notified; "Change" and "Remove" work; a phone shows the card too;
//  - LB: after a broadcast there ends, a post with a YouTube link in LB Recordings makes LB's ended
//    notice show "Watch the recording" by itself; a second link does not replace it; a link posted
//    in SS Recordings is not LB's.
// CHAT_SHOT_DIR saves club-live-notice.png, ended-recording-will-follow.png, admin-add-recording.png,
// ended-with-recording.png, member-ended-with-recording.png, phone-ended-with-recording.png.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {AccessToken} from 'livekit-server-sdk';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3524',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54724',STUB='http://127.0.0.1:54633';
for(const url of [base,fixture,STUB])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,scale=Number(process.env.CHAT_TIMING_SCALE||1);
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// For "nothing happens": the check must hold for the whole stretch (it is looked at every 200ms).
const stays=async(check,what,ms=2000)=>{for(let waited=0;waited<ms;waited+=200){assert(await check(),`did not stay so: ${what}`);await sleep(200);}};
const until=async(check,what,ms=30000)=>{for(let waited=0;;waited+=200){const value=await check();if(value)return value;assert(waited<ms*scale,`timed out: ${what}`);await sleep(200);}};

// The stand-in LiveKit: Twirp over JSON, as livekit-server-sdk speaks it. One ingress per room.
const lk={rooms:new Map(),calls:[]};
const ns=ms=>String(BigInt(ms)*1000000n);
const info=(room,i)=>({ingress_id:i.id,name:room,stream_key:i.key,url:'rtmps://fake-livekit.example.test/x',input_type:'RTMP_INPUT',room_name:room,participant_identity:'stage-broadcast',reusable:true,
 state:{status:i.publishing?'ENDPOINT_PUBLISHING':'ENDPOINT_INACTIVE',room_id:'RM_fake',...(i.startedAt?{started_at:ns(i.startedAt)}:{}),...(i.endedAt?{ended_at:ns(i.endedAt)}:{})}});
const stub=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'):{};
 const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const call=req.url.replace('/twirp/livekit.',''),room=body.room_name??body.roomName??body.room;lk.calls.push(`${call} ${room??''}`.trim());
 assert.match(req.headers.authorization??'',/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,'the server signs its LiveKit calls');
 if(call==='Ingress/ListIngress')return send({items:[...lk.rooms].filter(([name])=>!room||name===room).map(([name,i])=>info(name,i))});
 if(call==='Ingress/CreateIngress'){const i={id:`IN_fake_${lk.rooms.size+1}`,key:`FAKE-STREAM-KEY-for-tests-only-${lk.rooms.size+1}`,publishing:false};lk.rooms.set(room,i);return send(info(room,i));}
 if(call==='RoomService/ListRooms')return send({rooms:[]});
 // #522: the room is closed half a minute after a broadcast stops.
 if(call==='RoomService/DeleteRoom')return send({});
 return send({code:'unimplemented',msg:call},501);
});
await new Promise(r=>stub.listen(54633,'127.0.0.1',r));
const WEBHOOK_KEY='APIsyntheticNeverReal',WEBHOOK_SECRET='synthetic-livekit-secret-never-a-production-secret';
let webhookNumber=0;
const webhook=async(event,room)=>{const body=JSON.stringify({event,id:`EV_notice_${++webhookNumber}`,room:{name:`chat-${room}`}}),signer=new AccessToken(WEBHOOK_KEY,WEBHOOK_SECRET);
 signer.sha256=createHash('sha256').update(body).digest('base64');
 const r=await fetch(base+'/api/chat/stage/livekit-webhook',{method:'POST',headers:{'content-type':'application/webhook+json',authorization:await signer.toJwt()},body});assert.equal(r.status,200,`webhook ${event}`);};
const starts=async room=>{const i=lk.rooms.get(`chat-${room}`);assert(i,`${room} has its key`);Object.assign(i,{publishing:true,startedAt:Date.now()-1500,endedAt:0});await webhook('ingress_started',room);};
const stops=async room=>{Object.assign(lk.rooms.get(`chat-${room}`),{publishing:false,endedAt:Date.now()});await webhook('ingress_ended',room);};

const ALICE='00000000-0000-4000-8000-000000000001',BOB='00000000-0000-4000-8000-000000000002';
// Made-up video ids (the right shape, nobody's video): the pictures this test saves are shown to members.
const YT_ID='Xy12AbCd_-9',YT=`https://www.youtube.com/watch?v=${YT_ID}`,YT_PLAYER=`https://www.youtube-nocookie.com/embed/${YT_ID}?autoplay=1&rel=0`;
const LB_ID='Ab34CdEf_-7',LB_YT=`https://www.youtube.com/watch?v=${LB_ID}`;
const LIVE=(name,room)=>`🔴 ${name} is live now. Watch live: https://chat.robbooker.com/chat?room=${room}&stage=1`;
const WILL_FOLLOW=name=>`The live video in ${name} has ended. The recording will follow.`;
const RECORDED=(name,url)=>`The live video in ${name} has ended. Watch the recording: ${url}`;
const notices=room=>sql("select id,body from longboard_chat_messages where room_slug=$1 and bot_slug='longboard' order by created_at,unread_seq",[room]);
const alerted=async id=>(await sql('select account_id from chat_room_mentions where message_id=$1 order by account_id',[id])).map(r=>r.account_id);
const pushes=async()=>(await sql("select count(*)::int n from chat_push_jobs"))[0].n;
const body=async(room,index=0)=>(await notices(room))[index]?.body;

await sql("update profiles set role='admin' where email='alice@example.test'");
await sql("update profiles set role='user' where email='bob@example.test'");
// One phone of Bob's (a made-up endpoint; nothing is sent, the test has no push keys).
await sql("insert into chat_push_subscriptions(account_id,endpoint,p256dh,auth) values($1,'https://fcm.googleapis.com/fcm/send/synthetic-bob','k','a')",[BOB]);
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
// A picture of the page as a member has it (the dev server's own corner badge is not part of the app).
const shot=async(page,name)=>{if(!shots)return;await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.screenshot({path:`${shots}/${name}.png`});};
const composer=name=>`textarea[aria-label="Message ${name}"]`;
const shown=(page,selector)=>page.evaluateHandle(s=>[...document.querySelectorAll(s)].find(e=>e.checkVisibility())??null,selector);
const ready=page=>page.waitForFunction(()=>{const b=[...document.querySelectorAll('button[aria-label="Chat settings"]')].find(e=>e.checkVisibility());return b&&Object.keys(b).some(k=>k.startsWith('__reactProps$'));},{timeout:60000*scale});
const openMenu=async page=>{await ready(page);await (await shown(page,'button[aria-label="Chat settings"]')).click();await page.waitForSelector('#chat-settings-panel',{visible:true});
 return page.$$eval('#chat-settings-panel :is(button,a)',items=>items.filter(e=>e.checkVisibility()).map(e=>e.textContent.trim()));};
// The notice on screen (its row), as text and as parts.
const NOTICE='article[id^="chat-message-"]';
const noticeRow=(page,text)=>page.waitForFunction((sel,t)=>[...document.querySelectorAll(sel)].some(a=>a.checkVisibility()&&a.innerText.replace(/\s+/g,' ').includes(t)),{timeout:60000*scale},NOTICE,text);
const rowText=(page,text)=>page.evaluate((sel,t)=>[...document.querySelectorAll(sel)].find(a=>a.checkVisibility()&&a.innerText.replace(/\s+/g,' ').includes(t))?.innerText??null,NOTICE,text);
const rowLink=(page,text,prefix)=>page.evaluate((sel,t,p)=>[...document.querySelectorAll(sel)].find(a=>a.checkVisibility()&&a.innerText.replace(/\s+/g,' ').includes(t))?.querySelector(`a[href^="${p}"]`)?.getAttribute('href')??null,NOTICE,text,prefix);
const newPage=async(viewport={width:1440,height:900})=>{const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],asked=[],frames=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>{errors.push(`a browser dialog opened: ${d.message()}`);void d.dismiss().catch(()=>{});});
 // No video site is reached: a player's address is answered here, and anything else of theirs is refused.
 await page.setRequestInterception(true);
 page.on('request',request=>{const url=new URL(request.url());
  if(url.pathname.startsWith('/api/chat/stage/'))asked.push(`${request.method()} ${url.pathname}${url.search}`);
  if(['localhost','127.0.0.1'].includes(url.hostname)||['data:','blob:','about:'].includes(url.protocol))return void request.continue();
  if(/(^|\.)youtube-nocookie\.com$|(^|\.)loom\.com$/.test(url.hostname)&&request.resourceType()==='document'){frames.push(request.url());
   return void request.respond({status:200,contentType:'text/html',body:'<!doctype html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#16324f;color:#fff;font:600 28px sans-serif">TEST PLAYER (stand-in)</body>'});}
  // Anything else of YouTube's or Loom's is never fetched; the rest (the site's fonts) is the app's own business.
  if(/youtube|youtu\.be|ytimg|loom\.com/.test(url.hostname)){errors.push(`asked of a video site: ${request.url().slice(0,120)}`);return void request.abort();}
  return void request.continue();});
 await page.setViewport(viewport);return {context,page,errors,asked,frames};};
const open=async(who,room,name)=>{await who.page.goto(`${base}/chat?room=${room}`);await who.page.waitForSelector(name?composer(name):'main[data-chat-view]',{visible:true,timeout:60000*scale});await ready(who.page);};
const api=(page,path,payload)=>page.evaluate(async(p,b)=>{const r=await fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};},path,payload);
try{
 const alice=await newPage(),bob=await newPage(),a=alice.page,b=bob.page;
 await signIn(a,base,'alice@example.test',{composer:composer('LB'),next:'/chat?room=main'});
 await signIn(b,base,'bob@example.test',{composer:composer('LB'),next:'/chat?room=main'});

 // Gainers does not offer live video; LB does.
 assert((await openMenu(a)).includes('Go live (preview)'),'an admin has Go live in LB');await a.keyboard.press('Escape');
 await until(()=>alice.asked.some(x=>x.includes('/status?room=main')),'LB asks its status');
 alice.asked.length=0;
 await a.goto(`${base}/chat?room=gainers`);await a.waitForSelector('main[data-chat-view][data-room="gainers"]',{visible:true,timeout:60000*scale}).catch(()=>a.waitForSelector('main[data-chat-view]',{visible:true,timeout:60000*scale}));
 {const items=await openMenu(a);assert(items.length>3,`the Gainers menu is open: ${items.join(' | ')}`);assert(!items.some(t=>/go live/i.test(t)),`no Go live item in Gainers, even for an admin: ${items.join(' | ')}`);await a.keyboard.press('Escape');}
 await a.goto(`${base}/chat?room=gainers&stage=1`);await ready(a);
 await stays(async()=>(await a.$('[data-stage-root]'))===null,'the stage link is just the room in Gainers');
 assert.deepEqual(alice.asked.filter(x=>x.includes('gainers')),[],'no status is asked for Gainers');
 for(const action of ['open','reset','refresh'])assert.deepEqual(await api(a,'/api/chat/stage/live',{room:'gainers',action}),{status:404,body:{error:'stage_not_offered'}});
 assert.deepEqual(await api(a,'/api/chat/stage/token',{room:'gainers'}),{status:404,body:{error:'stage_not_offered'}});
 assert.deepEqual(lk.calls.filter(c=>c.includes('gainers')),[],'LiveKit was never asked about Gainers');
 for(const room of ['whats-new','lb-recordings','lb-announcements'])assert.equal((await api(a,'/api/chat/stage/live',{room,action:'open'})).status,404,room);
 console.log('PASS Gainers (and the post-only rooms): no Go live, no status asked, no key made');

 // Booker Stock Club: an admin sets the room up (its key), the broadcast arrives.
 await open(alice,'club','Booker Stock Club');
 assert((await openMenu(a)).includes('Go live (preview)'),'an admin has Go live in Booker Stock Club');await a.keyboard.press('Escape');
 assert.equal((await api(a,'/api/chat/stage/live',{room:'club',action:'open'})).status,200);
 assert.deepEqual(await notices('club'),[],'a room having its key posts nothing');
 const pushesBefore=await pushes();
 await starts('club');
 const [club]=await until(async()=>{const rows=await notices('club');return rows.length?rows:null;},'the club\'s live message');
 assert.equal(club.body,LIVE('Booker Stock Club','club'));
 await until(async()=>(await alerted(club.id)).includes(BOB),'Bob\'s bell entry');
 const clubMembers=(await sql("select m.user_id from longboard_chat_members m where public.chat_account_room_recipient_eligible(m.user_id,'club') and not exists(select 1 from chat_bot_accounts b where b.account_id=m.user_id) order by m.user_id")).map(r=>r.user_id);
 assert(clubMembers.includes(ALICE)&&clubMembers.includes(BOB)&&clubMembers.length>=3,`the club's members: ${clubMembers}`);
 await until(async()=>(await alerted(club.id)).length===clubMembers.length,'every bell entry');
 assert.deepEqual(await alerted(club.id),clubMembers,'everyone who can read the club is told once');
 assert.equal(await pushes(),pushesBefore+1,'one phone notification queued (Bob\'s phone)');
 assert.equal((await sql("select public.chat_push_target('room',(select id from chat_room_mentions where message_id=$1 and account_id=$2),$2) t",[club.id,BOB]))[0].t,`/chat?room=club&thread=${club.id}`);
 assert.equal((await sql('select count(*)::int n from chat_stage_broadcasts where notice_id=$1 and ended_at is null and notified_at is not null',[club.id]))[0].n,1,'the broadcast is on record, its bells finished');
 await webhook('room_started','club');await webhook('ingress_started','club');
 await stays(async()=>(await notices('club')).length===1,'one message, however many times the broadcast is reported');
 await b.goto(`${base}/chat?room=club`);await ready(b);
 await noticeRow(b,'Booker Stock Club is live now.');
 assert.equal(await b.$eval('[data-stage-notice-watch]',e=>e.getAttribute('href')),'/chat?room=club&stage=1');
 assert.match(await rowText(b,'is live now.'),/Live Video/);
 await (await shown(b,'button[aria-label^="Chat notifications,"]')).click();
 await b.waitForSelector('section[aria-label="Chat notifications"] [data-stage-notice-alert="club"]',{visible:true,timeout:30000*scale});
 assert.equal(await b.$eval('section[aria-label="Chat notifications"] [data-stage-notice-alert] strong',e=>e.textContent),'Booker Stock Club – Live Video');
 await shot(b,'club-live-notice');
 await b.keyboard.press('Escape');
 console.log('PASS Booker Stock Club goes live: one message, the bell, one queued phone notification');

 // It stops: the same message says it ended and that the recording will follow.
 await stops('club');
 await until(async()=>(await body('club'))===WILL_FOLLOW('Booker Stock Club'),'the club\'s message says it ended',60000);
 assert.equal((await notices('club'))[0].id,club.id,'the same message');
 assert.deepEqual(await alerted(club.id),[],'its bell entries are taken back');
 await b.goto(`${base}/chat?room=club`);await ready(b);
 await noticeRow(b,WILL_FOLLOW('Booker Stock Club'));
 assert.match(await rowText(b,'has ended.'),/Live Video/,'still shown as Live Video');
 assert.equal(await b.$('[data-stage-notice-watch]'),null,'no Watch live once it has ended');
 assert.equal(await b.$('[data-recording-video]'),null,'no player without a recording');
 await shot(b,'ended-recording-will-follow');
 // A member has no control, and the server refuses him.
 assert.equal(await b.$('[data-stage-recording-control]'),null,'a member has no Add recording link');
 assert(!(await b.evaluate(()=>performance.getEntriesByType('resource').some(e=>/StageRecordingControl/i.test(e.name)))),'and downloads no code for it');
 assert.deepEqual(await api(b,'/api/chat/stage/recording',{room:'club',message:club.id,url:YT}),{status:403,body:{error:'admin_only'}});
 assert.equal(await body('club'),WILL_FOLLOW('Booker Stock Club'));
 console.log('PASS it ends: "has ended. The recording will follow."; a member has no control');

 // The admin adds the link.
 await open(alice,'club','Booker Stock Club');
 await noticeRow(a,WILL_FOLLOW('Booker Stock Club'));
 await a.waitForSelector('[data-stage-recording-control] button',{visible:true,timeout:30000*scale});
 assert.deepEqual(await a.$$eval('[data-stage-recording-control] button',bs=>bs.map(x=>x.textContent.trim())),['Add recording link']);
 await a.click('[data-stage-recording-control] button');
 await a.waitForSelector('[data-stage-recording-form] input',{visible:true});
 await a.type('[data-stage-recording-form] input','https://example.test/not-a-video');
 await a.click('[data-stage-recording-form] button[type="submit"]');
 await a.waitForFunction(()=>document.querySelector('[data-stage-recording-form] [role="alert"]')?.textContent==='That is not a YouTube or Loom video link.',{timeout:15000*scale});
 assert.equal(alice.asked.filter(x=>x.includes('/recording')).length,0,'a link that is plainly not a video is not even sent');
 assert.equal(await body('club'),WILL_FOLLOW('Booker Stock Club'));
 await a.click('[data-stage-recording-form] input',{clickCount:3});await a.type('[data-stage-recording-form] input',`https://youtu.be/${YT_ID}?si=tracking`);
 await shot(a,'admin-add-recording');
 await a.click('[data-stage-recording-form] button[type="submit"]');
 await until(async()=>(await body('club'))===RECORDED('Booker Stock Club',YT),'the notice carries the recording');
 await a.waitForSelector('[data-stage-recording-form]',{hidden:true,timeout:15000*scale});
 assert.deepEqual(await alerted(club.id),[],'nobody is notified when a recording is attached');
 assert.equal(await pushes(),pushesBefore+1,'and no phone notification is queued');
 assert.equal((await notices('club')).length,1,'still the one message');
 // This test runs without Ably (the signal that makes every page reload the room): open it again.
 await open(alice,'club','Booker Stock Club');
 await noticeRow(a,'Watch the recording');
 const card=NOTICE+' [data-recording-video="youtube"]';
 await a.waitForSelector(card,{visible:true,timeout:30000*scale});
 assert.equal(await rowLink(a,'Watch the recording','https://www.youtube.com/'),YT,'the plain link stays');
 assert.deepEqual(await a.$eval(card,e=>[e.querySelector('button')?.getAttribute('aria-label'),!!e.querySelector('iframe')]),['Play YouTube video: Watch the recording',false]);
 assert.deepEqual(alice.frames,[],'nothing is asked of YouTube until play is pressed');
 await a.waitForSelector('[data-stage-recording-control] button',{visible:true});
 assert.deepEqual(await a.$$eval('[data-stage-recording-control] button',bs=>bs.map(x=>x.textContent.trim())),['Change','Remove']);
 if(shots){await a.evaluate(sel=>document.querySelector(sel).scrollIntoView({block:'center'}),card);await sleep(300);await shot(a,'ended-with-recording');}
 await a.click(card+' button');
 await a.waitForSelector(card+' iframe',{timeout:15000*scale});
 assert.equal(await a.$eval(card+' iframe',f=>f.getAttribute('src')),YT_PLAYER,'the player\'s address');
 await until(()=>alice.frames.length,'the frame is asked for');
 assert.deepEqual(alice.frames,[YT_PLAYER]);
 console.log('PASS the admin adds a link: refused when not a video; saved; the notice shows Watch the recording and the player card; play loads the expected frame');

 // A member sees the card (and a phone too), still without the control.
 await b.goto(`${base}/chat?room=club`);await ready(b);
 await b.waitForSelector(card,{visible:true,timeout:30000*scale});
 assert.equal(await b.$('[data-stage-recording-control]'),null);
 if(shots){await b.evaluate(sel=>document.querySelector(sel).scrollIntoView({block:'center'}),card);await sleep(300);await shot(b,'member-ended-with-recording');}
 {const phone=await newPage({width:390,height:844,isMobile:true,hasTouch:true});
  await signIn(phone.page,base,'bob@example.test',{composer:composer('LB'),next:'/chat?room=main'});
  await phone.page.goto(`${base}/chat?room=club`);
  await phone.page.waitForSelector(card,{visible:true,timeout:60000*scale});
  const fit=await phone.page.$eval(card,e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height,sideways:document.documentElement.scrollWidth>window.innerWidth};});
  assert(fit.left>=0&&fit.right<=390.5&&!fit.sideways,`the card fits a phone: ${JSON.stringify(fit)}`);
  assert(Math.abs(fit.width-fit.height*16/9)<=2,`and is 16:9: ${JSON.stringify(fit)}`);
  if(shots){await phone.page.evaluate(sel=>document.querySelector(sel).scrollIntoView({block:'center'}),card);await sleep(300);await shot(phone.page,'phone-ended-with-recording');}
  await phone.page.tap(card+' button');await phone.page.waitForSelector(card+' iframe',{timeout:15000*scale});
  assert.equal(await phone.page.$eval(card+' iframe',f=>f.getAttribute('src')),YT_PLAYER);
  assert.deepEqual(phone.errors,[]);await phone.context.close();}
 // Change (a Loom link) and Remove.
 await open(alice,'club','Booker Stock Club');
 await a.waitForSelector('[data-stage-recording-control] button',{visible:true,timeout:30000*scale});
 await a.click('[data-stage-recording-control] button');await a.waitForSelector('[data-stage-recording-form] input',{visible:true});
 const LOOM='https://www.loom.com/share/0123456789abcdef0123456789abcdef';
 await a.type('[data-stage-recording-form] input',`${LOOM}?sid=abc`);await a.click('[data-stage-recording-form] button[type="submit"]');
 await until(async()=>(await body('club'))===RECORDED('Booker Stock Club',LOOM),'the link is changed');
 await open(alice,'club','Booker Stock Club');
 await a.waitForSelector(NOTICE+' [data-recording-video="loom"]',{visible:true,timeout:30000*scale});
 await a.waitForFunction(()=>[...document.querySelectorAll('[data-stage-recording-control] button')].some(x=>x.textContent.trim()==='Remove'),{timeout:30000*scale});
 await a.evaluate(()=>[...document.querySelectorAll('[data-stage-recording-control] button')].find(x=>x.textContent.trim()==='Remove').click());
 await until(async()=>(await body('club'))===WILL_FOLLOW('Booker Stock Club'),'the link is removed');
 assert.deepEqual(await alerted(club.id),[]);assert.equal(await pushes(),pushesBefore+1);
 console.log('PASS a member and a phone see the card; Change and Remove work; nobody is notified');

 // LB: a recording posted in LB Recordings is picked up by LB's ended notice by itself.
 assert.equal((await api(a,'/api/chat/stage/live',{room:'main',action:'open'})).status,200);
 await starts('main');
 const [lb]=await until(async()=>{const rows=await notices('main');return rows.length?rows:null;},'LB\'s live message');
 assert.equal(lb.body,LIVE('LB','main'));
 await stops('main');
 await until(async()=>(await body('main'))===WILL_FOLLOW('LB'),'LB\'s message says it ended',60000);
 // (The send rate limit, 1.5 seconds between posts, is not what this checks: earlier posts are moved back.)
 const post=async(room,name,text)=>{await sql("update longboard_chat_messages set created_at=created_at-interval '1 minute' where guest_id is not null and created_at>now()-interval '1 minute'");await open(alice,room,name);const box=await shown(a,composer(name));await box.click();await a.keyboard.type(text);await a.keyboard.press('Enter');
  await a.waitForFunction(t=>[...document.querySelectorAll('article[id^="chat-message-"]:not([data-pending])')].some(x=>x.checkVisibility()&&x.textContent.includes(t)),{timeout:30000*scale},text.slice(0,20));};
 // A link in SS Recordings is not LB's.
 await post('ss-recordings','SS Recordings',`SS SESSION ${YT}`);
 await stays(async()=>(await body('main'))===WILL_FOLLOW('LB'),'an SS recording does not land on LB\'s notice');
 await post('lb-recordings','LB Recordings',`11/26/26 | LONGBOARD WEBINAR https://youtu.be/${LB_ID}`);
 await until(async()=>(await body('main'))===RECORDED('LB',LB_YT),'LB\'s notice picks up the recording by itself');
 assert.deepEqual(await alerted(lb.id),[],'nobody is notified');
 // A second link does not replace the first.
 await post('lb-recordings','LB Recordings',`PART TWO ${YT}`);
 await stays(async()=>(await body('main'))===RECORDED('LB',LB_YT),'the first link wins');
 assert.equal(await body('club'),WILL_FOLLOW('Booker Stock Club'),'and the club\'s notice is not touched');
 await b.goto(`${base}/chat?room=main`);await ready(b);
 await noticeRow(b,'The live video in LB has ended. Watch the recording');
 await b.waitForSelector(card,{visible:true,timeout:30000*scale});
 await b.click(card+' button');await b.waitForSelector(card+' iframe',{timeout:15000*scale});
 assert.equal(await b.$eval(card+' iframe',f=>f.getAttribute('src')),`https://www.youtube-nocookie.com/embed/${LB_ID}?autoplay=1&rel=0`);
 assert.equal(await b.$('[data-stage-recording-control]'),null);
 // The recordings room itself is as before: its own post has its own card.
 await open(alice,'lb-recordings','LB Recordings');
 await a.waitForSelector('[data-recording-video="youtube"]',{visible:true,timeout:30000*scale});
 assert.deepEqual(alice.errors,[]);assert.deepEqual(bob.errors,[]);
 console.log('PASS LB: a link posted in LB Recordings appears on LB\'s ended notice by itself; the first link wins; SS Recordings is not LB\'s');
}finally{await browser.close();stub.close();}
