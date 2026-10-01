// Actual Next app, SQL authorization, and signed source handler; synthetic accounts only.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
const base='http://localhost:3355',fixture='http://127.0.0.1:54555';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
const sql=(sql,args=[])=>control('sql',{sql,args});
const hash=x=>createHash('sha256').update(x).digest('hex');
const identity=await control('identity'),errors=[];
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const refresh=page=>page.evaluate(()=>window.dispatchEvent(new Event('chat-activity-refresh')));
async function ssLink(page,locked){await page.waitForFunction(want=>[...document.querySelectorAll('a')].some(a=>a.textContent.trim().replace(' 🔒','')==='SS'&&a.textContent.includes('🔒')===want),{},locked);return page.evaluate(()=>[...document.querySelectorAll('a')].find(a=>a.textContent.trim().replace(' 🔒','')==='SS')?.getAttribute('href'));}
async function pageFor(context,width){const p=await context.newPage();await p.setViewport({width,height:950});p.on('pageerror',e=>errors.push(e.message));return p;}
try{
 for(const width of [320,390,1440]){
  await control('source',{level:'mastermind',unavailable:false,expire:true});
  const context=await browser.createBrowserContext(),page=await pageFor(context,width);
  await context.setCookie({name:'lb-chat-session',value:identity.scoutToken,url:base,httpOnly:true});
  await page.goto(base+'/chat?room=social');await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');await ssLink(page,false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const before=(await control('source')).calls;await refresh(page);await new Promise(r=>setTimeout(r,500));assert.equal((await control('source')).calls,before,'fresh DB proof avoids upstream fanout');
  await control('source',{level:'annual',expire:true});await refresh(page);const locked=await ssLink(page,true);if(width<760){await page.click('button[aria-label="Open room navigation"]');await page.waitForFunction(()=>[...document.querySelectorAll('#chat-room-navigation a')].some(a=>a.textContent.trim()==='SS 🔒'&&a.getBoundingClientRect().width>0&&!a.closest('[inert]')));await page.screenshot({path:`/tmp/ss-lock-visible-${width}.png`});await page.click('button[class*=mobileNavBack]');}assert(!locked.includes('link=1'),'SS-only recovery must not demand LB login');
  const denied=await page.evaluate(async()=>{const r=await fetch('/api/chat?room=shortscout');return r.status;});assert.equal(denied,403);
  await control('source',{level:'mastermind',expire:true});await refresh(page);await ssLink(page,false);
  await page.screenshot({path:`/tmp/ss-session-${width}.png`});
  await context.close();
 }
 // A new completed handoff, unlike routine renewal, is the only 30-day issuer.
 const context=await browser.createBrowserContext(),page=await pageFor(context,1440);
 const state=randomBytes(32).toString('base64url'),code=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
 await sql("insert into chat_login_requests(state_hash,code_hash,challenge,subject,membership_level,return_room) values($1,$2,$3,$4,'mastermind','social')",[hash(state),hash(code),createHash('sha256').update(verifier).digest('base64url'),identity.scoutId]);
 await context.setCookie({name:'lb-chat-login',value:state+'.'+verifier,url:base,httpOnly:true});
 await page.goto(base+`/api/chat/login/callback?state=${state}&code=${code}`);await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');
 const issued=(await context.cookies()).find(c=>c.name==='lb-chat-session');assert(issued);assert(issued.expires-Date.now()/1000>29.99*86400);
 assert.equal((await sql('select extract(epoch from expires_at-created_at)::int age from chat_sessions where token_hash=$1',[hash(issued.value)]))[0].age,2592000);
 await page.goto(base+'/chat?room=shortscout');await page.waitForSelector('textarea[aria-label="Message SS"]');await page.type('textarea[aria-label="Message SS"]','SS-only draft');
 await control('source',{unavailable:true,expire:true});await refresh(page);await page.waitForFunction(()=>document.body.textContent.includes('Your draft is saved'));assert.equal(new URL(page.url()).pathname,'/chat');
 assert.equal(await page.evaluate(async()=>{const r=await fetch('/api/chat?room=shortscout');return r.status;}),503);
 assert((await context.cookies()).some(c=>c.name==='lb-chat-session'),'transient failure retains identity');
 await control('source',{unavailable:false,level:'mastermind',expire:true});await refresh(page);await ssLink(page,false);await page.waitForSelector('textarea[aria-label="Message SS"]');assert.equal(await page.$eval('textarea[aria-label="Message SS"]',e=>e.value),'SS-only draft');
 await page.goto(base+'/chat/quad');await page.waitForSelector('select');await page.select('select','room:shortscout');await page.waitForSelector('textarea[aria-label="Message SS"]');await control('source',{unavailable:true,expire:true});await refresh(page);await page.waitForFunction(()=>document.body.textContent.includes('Your draft is saved'));assert.equal(new URL(page.url()).pathname,'/chat/quad');await control('source',{unavailable:false,level:'mastermind',expire:true});await refresh(page);await page.waitForSelector('textarea[aria-label="Message SS"]');
 await sql('update chat_sessions set revoked_at=now() where token_hash=$1',[hash(issued.value)]);await refresh(page);await page.waitForFunction(()=>location.pathname==='/chat/login');await context.close();
 // Ordinary LB remains independent, then its existing bridge renews without an auth switch.
 const lbContext=await browser.createBrowserContext(),lb=await pageFor(lbContext,390);
 await lb.goto(base+'/login?next=%2Fchat');await lb.waitForSelector('#li-email');await lb.reload({waitUntil:'networkidle0'});
 await lb.waitForFunction(()=>{const f=document.querySelector('#li-email')?.form;return f&&Object.keys(f).some(k=>k.startsWith('__reactProps$')&&typeof f[k]?.onSubmit==='function');});
 await lb.type('#li-email','alice@example.test');await lb.type('#li-password','demo-only');await lb.click('button[type=submit]');await lb.waitForSelector('textarea[aria-label="Message LB"]');assert((await ssLink(lb,true)).includes('link=1'));
 const account=identity.people[0].id;
 await sql('insert into chat_shortscout_membership_links(lb_account_id,source_account_id,subject) values($1,$2,$2)',[account,identity.scoutId]);await refresh(lb);await ssLink(lb,false);
 await lb.setViewport({width:1440,height:950});
 await lb.click('#chat-room-navigation a[href="/chat?room=shortscout"]');await lb.waitForSelector('textarea[aria-label="Message SS"]');
 await lb.click('#chat-room-navigation a[href="/chat?room=social"]');await lb.waitForSelector('textarea[aria-label="Message SOCIAL"]');await lb.goBack();await lb.waitForSelector('textarea[aria-label="Message SS"]');assert.equal(new URL(lb.url()).searchParams.get('room'),'shortscout');await lb.type('textarea[aria-label="Message SS"]','Keep my SS draft');
 await control('source',{unavailable:true,expire:true});await refresh(lb);await ssLink(lb,true);await lb.waitForFunction(()=>document.body.textContent.includes('Your draft is saved'));assert.equal(new URL(lb.url()).pathname,'/chat');assert.equal(await lb.evaluate(async()=>{const r=await fetch('/api/chat?room=main');return r.status;}),200);
 await control('source',{unavailable:false,level:'mastermind',expire:true});await refresh(lb);await ssLink(lb,false);await lb.waitForSelector('textarea[aria-label="Message SS"]');assert.equal(await lb.$eval('textarea[aria-label="Message SS"]',e=>e.value),'Keep my SS draft');
 await lb.goto(base+'/chat/quad');await lb.waitForSelector('select');await lb.select('select','room:shortscout');await lb.waitForSelector('textarea[aria-label="Message SS"]');await control('source',{level:'annual',expire:true});await refresh(lb);await lb.waitForFunction(()=>document.body.textContent.includes('could not be verified')||!document.querySelector('textarea[aria-label="Message SS"]'));assert.equal(new URL(lb.url()).pathname,'/chat/quad');assert.equal(await lb.evaluate(async()=>{const r=await fetch('/api/chat?room=main');return r.status;}),200);await control('source',{level:'mastermind',expire:true});await lb.goto(base+'/chat?room=main');await lb.waitForSelector('textarea[aria-label="Message LB"]');
 await sql('select revoke_chat_shortscout_membership_link($1)',[account]);await refresh(lb);await ssLink(lb,true);
 await sql("update profiles set role='admin' where id=$1",[account]);await refresh(lb);await ssLink(lb,false);await lbContext.close();
 assert.deepEqual(errors,[]);
 console.log('PASS real desktop/mobile SS lock renewal; stale identity, annual downgrade boundary, signed handoff persistence, cached request budget, unavailable/recovery, revocation, LB-only/bridged/admin scope and correct login intent.');
}finally{await browser.close();}
