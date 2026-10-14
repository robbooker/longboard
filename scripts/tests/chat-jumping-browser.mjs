// D-198: a fully read room opens at the newest message, an unread tail that fits on screen counts
// as read (so the next visit isn't "back to yesterday"), new messages stay in view after landing,
// and sending in a DM keeps your message in view. Run against the chat-mobile fixture.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base=process.env.CHAT_TEST_URL||'http://localhost:3204';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
async function login(email,width=1440,height=900){const c=await b.createBrowserContext(),p=await c.newPage();await p.setViewport({width,height});await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForFunction(()=>location.pathname.startsWith('/chat'));await sleep(1500);return p;}
const post=async(p,room,body)=>{for(let i=0;i<12;i++){const s=await p.evaluate((room,body)=>fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',room,body,clientId:crypto.randomUUID()})}).then(r=>r.status),room,body);if(s!==429)return s;await sleep(2500);}return 429;};
const opening=(p,room)=>p.evaluate(room=>fetch('/api/chat/opening?room='+room,{cache:'no-store'}).then(r=>r.json()),room);
const ready=p=>p.waitForFunction(()=>{const t=document.querySelector('textarea[aria-label^="Message "]');return t&&Object.keys(t).some(k=>k.startsWith('__reactProps'));},{timeout:60000});
const gap=p=>p.evaluate(()=>{const a=[...document.querySelectorAll('article[id^="chat-message-"]')].at(-1);const L=a.parentElement;return Math.round(L.scrollHeight-L.scrollTop-L.clientHeight)});
const inView=(p,text)=>p.evaluate(text=>{const a=[...document.querySelectorAll('article')].reverse().find(e=>e.textContent.includes(text));if(!a)return 'missing';const r=a.getBoundingClientRect(),L=a.parentElement.getBoundingClientRect();return r.bottom<=L.bottom+2&&r.top>=L.top-2?'visible':`off by ${Math.round(r.bottom-L.bottom)}px`},text);
try{
 const alice=await login('alice@example.test'),bob=await login('bob@example.test');
 // Bob reads LB to the end, then goes elsewhere.
 await bob.goto(base+'/chat?room=main');await ready(bob);await sleep(4000);
 for(const how of ['switch','reload']){
  await bob.goto(base+'/chat?room=social');await ready(bob);await sleep(1500);
  const tag=`${how}-${Date.now()}`;
  assert.equal(await post(alice,'main',`Unread one ${tag}`),200);assert.equal(await post(alice,'main',`Unread two ${tag}`),200);await sleep(800);
  if(how==='switch')await bob.evaluate(()=>[...document.querySelectorAll('nav[aria-label="Chat rooms"] a')].find(a=>/room=main/.test(a.getAttribute('href')||'')).click());
  else await bob.goto(base+'/chat?room=main');
  await bob.waitForSelector('[data-unread-start]',{timeout:20000});await ready(bob);await sleep(3500);
  assert.ok(await gap(bob)<=2,`${how}: lands at the newest message when the unread tail fits`);
  let after;for(let i=0;i<20;i++){after=await opening(bob,'main');if(after.messageId===null)break;await sleep(1000);}
  assert.equal(after.messageId,null,`${how}: the whole unread tail counts as read (next visit opens at the newest message), got ${JSON.stringify(after)}`);
  assert.equal(await post(alice,'main',`Live ${tag}`),200);
  await bob.waitForFunction(t=>document.body.textContent.includes(t),{timeout:60000},`Live ${tag}`);await sleep(700);
  assert.equal(await inView(bob,`Live ${tag}`),'visible',`${how}: a new message after landing stays in view`);
 }
 // A fully read room opens at the newest message every time.
 for(let i=0;i<3;i++){await bob.goto(base+'/chat?room=social');await ready(bob);await sleep(800);await bob.goto(base+'/chat?room=main');await ready(bob);await sleep(2500);assert.equal(await bob.$('[data-unread-start]'),null,'no unread marker in a read room');assert.ok(await gap(bob)<=2,`read room opens at the newest message (try ${i+1})`);}
 // DM: Bob writes, Alice opens the DM (lands on the unread message), replies, and sees her reply.
 const convo=(await alice.evaluate(()=>fetch('/api/chat/inbox').then(r=>r.json()))).conversations.find(c=>c.otherName==='Bob');
 if(convo.status==='pending'&&convo.incoming)await alice.evaluate(id=>fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'accept',target:id})}),convo.id);
 for(let i=0;i<6;i++)await bob.evaluate((id,i)=>fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',target:id,body:'Bob DM line '+i+'\n'.repeat(3)+'more',clientId:crypto.randomUUID()})}),convo.id,i);
 await alice.goto(base+'/chat?room=main');await ready(alice);await sleep(1500);
 await alice.evaluate(()=>[...document.querySelectorAll('nav[aria-label="Chat rooms"] button')].find(b=>/Bob/.test(b.textContent)&&!/Start/.test(b.textContent)).click());
 await alice.waitForSelector('section[aria-label="Private conversation"] #dm-body',{visible:true,timeout:20000});await sleep(2500);
 const reply=`Alice reply ${Date.now()}`;await alice.type('#dm-body',reply);await alice.keyboard.press('Enter');
 await alice.waitForFunction(t=>[...document.querySelectorAll('section[aria-label="Private conversation"] article')].some(a=>a.textContent.includes(t)),{timeout:15000},reply);await sleep(1500);
 assert.equal(await inView(alice,reply),'visible','DM: my sent message is in view');
 console.log('PASS: read rooms open at the newest message; a fitting unread tail counts as read; new messages and DM replies stay in view');
}finally{await b.close();}
