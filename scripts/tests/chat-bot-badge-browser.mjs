// #330 Wren, a bot account limited to Developers, on desktop 1280 and phone 390, against the fixture
// on this test's own ports (localhost:3330, database 127.0.0.1:54330). Synthetic data only.
//  - create-wren.mjs and wren-token.mjs make the account and token (run for real, twice for the first);
//  - with the token: Developers works; other rooms, search scopes and DM routes are refused;
//  - a member sees the name Wren with a "bot" badge, not a button, and a normal post without one;
//  - the member replies and reacts to Wren's post, and can't start a DM with it;
//  - revoking stops the token at once.
// CHAT_SHOT_DIR: also saves wren-post-*.png, normal-post-before-*.png, wren-thread-desktop.png.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3330',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54330';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR;
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const {people:[,bob,mallory]}=await control('identity');
const sql=(text,args=[])=>control('sql',{sql:text,args});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const dir=await mkdtemp(join(tmpdir(),'chat-bot-badge-'));const tokenFile=join(dir,'wren.token');
const script=async(file,...args)=>{const {stdout,stderr}=await promisify(execFile)('node',[`scripts/chat-bots/${file}`,...args],{env:{...process.env,NODE_OPTIONS:'',NEXT_PUBLIC_SUPABASE_URL:fixture,SUPABASE_SERVICE_ROLE_KEY:'test-service-role'}});return stdout+stderr;};

// The fixture has no Auth admin API, so the login row is added here; the script does everything else.
const wren='00000000-0000-4000-8000-0000000000aa';
await sql('insert into auth.users(id) values($1)',[wren]);
await sql(`insert into profiles(id,email,role) values($1,'wren@bot.longboard.invalid','user')`,[wren]);
const created=await script('create-wren.mjs');assert.match(created,/Wren is ready/,created);
assert.match(await script('create-wren.mjs'),/Wren is ready/,'safe to run again');
const minted=await script('wren-token.mjs','mint','--out',tokenFile);
const token=(await readFile(tokenFile,'utf8')).trim();
assert.match(token,/^lbc_[A-Za-z0-9_-]{43}$/);assert.equal((await stat(tokenFile)).mode&0o777,0o600,'token file is mode 600');
assert(!minted.includes(token),'the token is never printed');
await assert.rejects(script('wren-token.mjs','mint','--out',tokenFile),/already has a token/);

const call=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json().catch(()=>null)};};
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const api=(p,path,body)=>p.evaluate(async({path,body})=>{const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json().catch(()=>null)};},{path,body});
const row=(p,text)=>p.evaluate(text=>{const a=[...document.querySelectorAll('article')].find(e=>e.checkVisibility()&&e.innerText.includes(text));if(!a)return null;a.scrollIntoView({block:'center'});const b=a.querySelector('[data-membership="bot"]');return {bot:!!b&&b.checkVisibility(),badge:b?.textContent,author:a.innerText,button:!!a.querySelector('button[title^="Message "]')};},text);
const seen=(p,text)=>p.waitForFunction(text=>[...document.querySelectorAll('article')].some(e=>e.checkVisibility()&&e.innerText.includes(text)),{timeout:60000},text);
const shoot=async(p,text,name)=>{if(!shots)return;await p.evaluate(text=>[...document.querySelectorAll('article')].find(e=>e.checkVisibility()&&e.innerText.includes(text))?.scrollIntoView({block:'center'}),text);await pause(300);await p.screenshot({path:`${shots}/${name}.png`});};

try{
 console.log('Browser',await browser.version());
 // 1. Token: Developers reads and posts.
 const hello='Morning. Build notes from the assistant.';
 const member0=await call('/api/chat/member');assert.equal(member0.data.member.display_name,'Wren');
 const posted=await call('/api/chat',{room:'developers',action:'send',body:hello,clientId:randomUUID()});
 assert.equal(posted.status,200,'Wren posts: '+JSON.stringify(posted.data));
 assert.equal(posted.data.message.author_label,'Wren');const postId=posted.data.message.id;
 const read=await call('/api/chat/history?room=developers');assert.equal(read.status,200);
 assert(read.data.messages.some(m=>m.id===postId&&m.memberships.includes('bot')&&!m.memberships.includes('LB')),'history marks the bot, with no LB badge');
 assert.equal((await call('/api/chat/search?q=assistant&room=developers')).status,200);

 // 2. Token: everything else refused.
 for(const room of ['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new']){
  assert.equal((await call(`/api/chat/history?room=${room}`)).status,403,`history ${room}`);
  assert.equal((await call(`/api/chat/room-members?room=${room}`)).status,403,`members ${room}`);
  assert.equal((await call('/api/chat',{room,action:'send',body:'no',clientId:randomUUID()})).status,403,`send ${room}`);
 }
 for(const scope of ['main','social','shortscout','all','lb-social','ss-social'])assert.equal((await call(`/api/chat/search?q=hello&room=${scope}`)).status,403,`search ${scope}`);
 for(const r of [await call('/api/chat/inbox'),await call('/api/chat/dm-members?q=Bob'),await call('/api/chat/inbox',{action:'request',target:randomUUID(),body:'hi',clientId:randomUUID()})])assert.equal(r.status,403,JSON.stringify(r.data));
 const batch=await call('/api/chat/updates',{paths:['/api/chat?room=developers','/api/chat/inbox']});
 assert.deepEqual(batch.data.access.rooms,['developers']);assert.deepEqual(batch.data.results.map(x=>x.status),[200,403]);
 assert.equal((await call('/api/chat/member',{action:'rename',displayName:'Rob'})).status,403);
 assert.equal((await call('/api/chat/admin')).status,403,'admin tools');
 const activity=await call('/api/chat/activity');assert.equal(activity.status,200);assert(Object.keys(activity.data.roomCounts??{}).every(r=>r==='developers'),'bell: Developers only');

 // 3. A member's view: a normal post has no badge, Wren's has one, on both widths.
 const member=await (await browser.createBrowserContext()).newPage();member.on('pageerror',e=>errors.push(e.message));member.setDefaultTimeout(60000);
 await member.setViewport(desktop);
 await signIn(member,base,mallory.email,{next:'/chat?room=developers',composer:'textarea[aria-label="Message Developers"]'});
 const normal='A normal post from a member.';
 const other=await (await browser.createBrowserContext()).newPage();await other.setViewport(desktop);
 await signIn(other,base,bob.email,{next:'/chat?room=developers',composer:'textarea[aria-label="Message Developers"]'});
 assert.equal((await api(other,'/api/chat',{room:'developers',action:'send',body:normal,clientId:randomUUID()})).status,200);
 for(const [view,size] of [['desktop',desktop],['phone',phone]]){
  await member.setViewport(size);await member.goto(`${base}/chat?room=developers`);
  await seen(member,normal);await seen(member,hello);await pause(600);
  const plain=await row(member,normal),bot=await row(member,hello);
  assert.equal(plain.bot,false,`${view}: no badge on a normal post`);assert.equal(plain.button,true,`${view}: a normal name still opens a DM`);
  assert.equal(bot.bot,true,`${view}: badge on Wren's post`);assert.equal(bot.badge,'bot');assert(bot.author.includes('Wren'),bot.author);
  assert.equal(bot.button,false,`${view}: Wren's name doesn't offer a DM`);
  assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${view}: no page scroll`);
  await shoot(member,normal,`normal-post-before-${view}`);await shoot(member,hello,`wren-post-${view}`);
 }
 await member.setViewport(desktop);

 // 4. Reply and react like anyone else's; the thread shows the badge too.
 const reply=await api(member,'/api/chat',{room:'developers',action:'send',body:'Thanks @Wren',replyTo:postId,clientId:randomUUID()});assert.equal(reply.status,200,JSON.stringify(reply.data));
 const react=await api(member,'/api/chat/message-reactions',{kind:'room',room:'developers',action:'set',messageId:postId,emoji:'heart',active:true});assert.equal(react.status,200,JSON.stringify(react.data));
 const bell=await call('/api/chat/activity?why=test');assert(bell.data.mentions.some(m=>m.room==='developers'),'the mention reaches Wren: '+JSON.stringify(bell.data.mentions));
 await member.goto(`${base}/chat?room=developers&thread=${postId}`);
 await member.goto(`${base}/chat?room=developers`);await seen(member,hello);
 await member.evaluate(text=>[...document.querySelectorAll('article')].find(e=>e.checkVisibility()&&e.innerText.includes(text)).querySelector('button[data-has-replies]').click(),hello);
 await member.waitForSelector('[data-thread-message-id] [data-membership="bot"]',{visible:true});
 if(shots){await pause(300);await member.screenshot({path:`${shots}/wren-thread-desktop.png`});}

 // 5. Mentions: offered in Developers only. DMs: refused, not in search.
 const named=async room=>(await api(member,`/api/chat/mentions?q=Wr&room=${room}`)).data.members.map(m=>m.display_name);
 assert.deepEqual(await named('developers'),['Wren']);assert.deepEqual(await named('social'),[]);
 assert.deepEqual((await api(member,'/api/chat/dm-members?q=Wren')).data.members,[]);
 const wrenMember=posted.data.message.member_id;
 const dm=await api(member,'/api/chat/inbox',{action:'request',target:wrenMember,body:'hi',clientId:randomUUID()});
 assert.equal(dm.status,409,JSON.stringify(dm.data));assert.match(dm.data.error,/not accepting/);
 // Not counted, and listed only in Developers.
 const inDevelopers=await api(member,'/api/chat/room-members?room=developers&q=Wren');assert.deepEqual(inDevelopers.data.members.map(m=>[m.display_name,m.memberships]),[['Wren',['bot']]]);
 assert.deepEqual((await api(member,'/api/chat/room-members?room=social&q=Wren')).data.members,[]);
 const total=(await api(member,'/api/chat/room-members?room=developers&summary=1')).data.total;
 assert.equal(total,(await sql(`select count(*)::int n from longboard_chat_members m where not exists(select 1 from chat_bot_accounts b where b.account_id=m.user_id)`))[0].n,'Wren is not counted');

 // 6. Revoke: refused at once, the file is gone.
 assert.match(await script('wren-token.mjs','revoke','--out',tokenFile),/Revoked 1 token/);
 const stopped=await call('/api/chat/history?room=developers');assert.equal(stopped.status,401);assert.deepEqual(stopped.data,{error:'invalid_token'});
 await assert.rejects(stat(tokenFile));
 assert.deepEqual(errors,[]);
 console.log('PASS Wren: Developers only, DMs refused, bot badge on desktop 1280 + phone 390 and in the thread, normal posts unchanged, replies and reactions work, not counted, revoke stops it.');
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
