// #457 Booker Stock Club: chat admins post there; members stay read-only. Against the fixture on
// this test's own ports (localhost:3457, database 127.0.0.1:54457). Synthetic names and data only.
//  - an admin sees the composer on a computer and a phone, light and dark, posts text with a link,
//    and the post is theirs (no bot); the stock-pick card has no Reply, the admin's post does;
//  - replies: under the admin's post yes, under the card refused ("Replies are off under the
//    stock-pick cards.");
//  - the admin's own personal API token can't post in the club (it can elsewhere);
//  - a member sees the admin's post but no composer ("Read-only"), and is refused by the server.
// CHAT_SHOT_DIR saves after-admin-desktop-dark.png, after-admin-desktop-light.png,
// after-admin-phone-light.png, after-admin-phone-dark.png, after-member-desktop.png and
// after-member-phone.png.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3457',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54457';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR;
const sql=async(text,args=[])=>{const r=await fetch(fixture+'/test/sql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql:text,args})}),body=await r.text();assert.equal(r.status,200,body);const j=JSON.parse(body);return j.rows??j;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const COMPOSER='textarea[aria-label="Message Booker Stock Club"]';
const POST='Welcome to Booker Stock Club! Our next webinar is Thursday at 7 PM Central: https://example.test/webinar';

// The club's pick for today (the card), posted the way the morning run posts it.
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const start=Date.parse(`${day}T13:30:00Z`);
const points=Array.from({length:40},(_,i)=>[start+i*120_000,Number((2.1+Math.sin(i/5)*0.12+i*0.012).toFixed(3))]);
const pick={ticker:'CNAA',name:'China Alpha Holdings',day,at:new Date().toISOString(),source:'auto',from:'report',price:2.5,changePct:60,volume:800_000,marketCap:20_000_000,
 country:'China',instOwnPct:12.5,borrow:null,levels:[{kind:'missed',price:2.84,label:'Missed pivot Nov 3'},{kind:'cmp',price:3.1,label:'CMP'},{kind:'sma200',price:3.6,label:'200 SMA'}],chart:{start,points}};
const posted=(await sql(`select post_chat_club_pick($1,$2,'auto',$3,$4::jsonb) r`,[day,'CNAA','#1 stock of the day: CNAA (China Alpha Holdings)',JSON.stringify(pick)]))[0].r;
assert.equal(posted.posted,true,JSON.stringify(posted));
const cardId=posted.messageId;
// Alice is the admin, Bob a member. Neutral chat names for the pictures.
await sql("update profiles set role='admin' where email='alice@example.test'");
await sql("update profiles set role='user' where email='bob@example.test'");
await sql(`update longboard_chat_members m set display_name=n.name from (values('alice@example.test','Club Host'),('bob@example.test','Sample Member')) n(email,name),profiles p where p.email=n.email and m.user_id=p.id`);
const [alice]=await sql(`select p.id,m.id member from profiles p join longboard_chat_members m on m.user_id=p.id where p.email='alice@example.test'`);

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const visible=(page,selector)=>page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>e.checkVisibility()),selector);
const open=async(email,viewport,theme)=>{
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport(viewport);
 await context.setCookie({name:'longboard-chat-theme',value:theme,domain:'localhost',path:'/'});
 await signIn(page,base,email);
 await page.evaluate(theme=>localStorage.setItem('longboard-public-chat-theme-v1',theme),theme);
 await page.goto(`${base}/chat?room=club`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-club-card="CNAA"]')].some(e=>e.checkVisibility()),{timeout:90000});
 await page.waitForFunction(theme=>[...document.querySelectorAll('[data-theme]')].some(e=>e.dataset.theme===theme&&e.checkVisibility()),{timeout:30000},theme);
 return {context,page,errors};
};
const rowWith=(page,text)=>page.evaluate(text=>{const a=[...document.querySelectorAll('article')].find(e=>e.checkVisibility()&&e.innerText.includes(text)&&!e.dataset.pending);
 if(!a)return null;return {reply:[...a.querySelectorAll('button')].some(b=>/repl/i.test(b.textContent)&&b.checkVisibility()),card:!!a.querySelector('[data-club-card]')};},text);
const sideways=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
const shot=async(page,name)=>{if(!shots)return;await sleep(600);await page.screenshot({path:`${shots}/${name}.png`});};
try{
 // 1. The admin on a computer, dark: the composer, a post with a link.
 {
  const {context,page,errors}=await open('alice@example.test',desktop,'dark');
  assert(await visible(page,COMPOSER),'an admin has the composer in the club');
  assert.equal(await page.$('[data-club-admin]')!==null,true,'the pick controls stay');
  await page.type(COMPOSER,POST);
  await page.click('button[type="submit"][data-state]');
  await page.waitForFunction(text=>[...document.querySelectorAll('article')].some(a=>a.checkVisibility()&&a.innerText.includes(text)&&!a.dataset.pending),{timeout:30000},'Our next webinar is Thursday');
  const [row]=await sql(`select id,member_id,bot_slug,author_label,body from longboard_chat_messages where room_slug='club' and bot_slug is null`);
  assert.deepEqual([row.member_id,row.bot_slug,row.author_label,row.body],[alice.member,null,'Club Host',POST]);
  assert.match(await page.evaluate(()=>[...document.querySelectorAll('article a[href]')].map(a=>a.href).join(' ')),/example\.test\/webinar/,'the link is a link');
  assert.deepEqual(await rowWith(page,'Our next webinar'),{reply:true,card:false},"the admin's post takes replies");
  assert.deepEqual(await rowWith(page,'China Alpha'),{reply:false,card:true},'the card does not');
  // Replies: under the admin's post yes, under the card no.
  const replies=await page.evaluate(async(post,card)=>{const go=async replyTo=>{const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({room:'club',action:'send',body:'See you there.',replyTo,clientId:crypto.randomUUID()})});return [r.status,(await r.json()).error??'ok'];};
   // The send rate limit: 1.5 seconds between posts.
   await new Promise(r=>setTimeout(r,1700));const a=await go(post);await new Promise(r=>setTimeout(r,1700));return [a,await go(card)];},row.id,cardId);
  assert.deepEqual(replies,[[200,'ok'],[403,'Replies are off under the stock-pick cards.']]);
  // The admin's own API token never posts here.
  await sql('insert into chat_api_access(account_id) values($1) on conflict do nothing',[alice.id]);
  const token=await page.evaluate(async()=>(await (await fetch('/api/chat/api-tokens',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:'club test'})})).json()).token);
  assert.match(token,/^lbc_/);
  const byToken=async room=>{await sleep(1700);const r=await fetch(`${base}/api/chat`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({room,action:'send',body:'from a token',clientId:randomUUID()})});return [r.status,(await r.json()).error??'ok'];};
  assert.deepEqual(await byToken('club'),[403,'Booker Stock Club is a read-only channel.'],"an admin's token can't post in the club");
  assert.deepEqual(await byToken('social'),[200,'ok'],'the same token posts elsewhere');
  await sql(`delete from longboard_chat_messages where body='from a token'`);
  await page.evaluate(()=>document.activeElement?.blur());
  await shot(page,'after-admin-desktop-dark');
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // 2. The admin, light, on a computer and a phone; dark on a phone.
 for(const [viewport,theme,name] of [[desktop,'light','after-admin-desktop-light'],[phone,'light','after-admin-phone-light'],[phone,'dark','after-admin-phone-dark']]){
  const {context,page,errors}=await open('alice@example.test',viewport,theme);
  assert(await visible(page,COMPOSER),`${name}: the composer`);
  await page.waitForFunction(()=>[...document.querySelectorAll('article')].some(a=>a.checkVisibility()&&a.innerText.includes('Our next webinar')),{timeout:30000});
  assert(await sideways(page)<=0,`${name}: no sideways scroll`);
  await shot(page,name);
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 // 3. A member: sees the post, no composer, refused by the server.
 for(const [viewport,name] of [[phone,'after-member-phone'],[desktop,'after-member-desktop']]){
  const {context,page,errors}=await open('bob@example.test',viewport,'light');
  await page.waitForFunction(()=>[...document.querySelectorAll('article')].some(a=>a.checkVisibility()&&a.innerText.includes('Our next webinar')),{timeout:30000});
  assert.equal(await visible(page,'textarea[aria-label^="Message "]'),false,`${name}: no composer for a member`);
  assert(await page.evaluate(()=>[...document.querySelectorAll('strong')].some(e=>e.checkVisibility()&&e.textContent==='Read-only')),`${name}: says read-only`);
  assert.equal(await page.$('[data-club-admin]'),null);
  // The reply count arrives with the thread counts, a moment after the messages.
  await page.waitForFunction(()=>[...document.querySelectorAll('article')].some(a=>a.checkVisibility()&&a.innerText.includes('Our next webinar')&&[...a.querySelectorAll('button')].some(b=>/1 reply/i.test(b.textContent))),{timeout:30000});
  assert.deepEqual(await rowWith(page,'Our next webinar'),{reply:true,card:false},'a member can open the replies');
  assert(await sideways(page)<=0,`${name}: no sideways scroll`);
  if(viewport===desktop){
   const tries=await page.evaluate(async post=>{const send=body=>fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({room:'club',action:'send',...body,clientId:crypto.randomUUID()})}).then(async r=>[r.status,(await r.json()).error]);
    return [await send({body:'member post'}),await send({body:'member reply',replyTo:post})];},(await sql(`select id from longboard_chat_messages where room_slug='club' and bot_slug is null and reply_to_id is null`))[0].id);
   assert.deepEqual(tries,[[403,'Booker Stock Club is a read-only channel.'],[403,'Booker Stock Club is a read-only channel.']]);
  }
  await shot(page,name);
  assert.deepEqual(errors,[],errors.join('\n'));
  await context.close();
 }
 assert.equal((await sql(`select count(*)::int n from longboard_chat_messages where room_slug='club' and bot_slug is null`))[0].n,2,'only the admin post and its reply');
 console.log('chat-club-admin-posts browser test passed');
}finally{await browser.close();}
