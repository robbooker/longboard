import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base=process.env.TEST_CHAT_BASE||'http://localhost:3348';
const id='30000000-0000-4000-8000-000000000001';
const original={id,title:'Jammie development approval',priority:2,priority_revision:1,revision:7,proposal:'Reviewed development scope.',approved_proposal:null,status:'discussion',outcome:null};
const release={version:3,head_sha:'a'.repeat(40),pr_number:999,state:'ready',approved_at:null,outcome:null};
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
let current={...original},role='participant',capability=true,posts=[];
const button=async(p,label)=>{for(const b of await p.$$('button'))if(await b.evaluate((e,t)=>e.textContent.trim()===t,label))return b;return null;};
try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email','bob@example.test');await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForFunction(()=>location.pathname==='/chat');
 await p.setRequestInterception(true);p.on('request',async r=>{
  const u=new URL(r.url());if(u.pathname!=='/api/chat/features')return r.continue();
  if(r.method()==='POST'){posts.push(JSON.parse(r.postData()));current={...current,status:'approved',approved_proposal:current.proposal,approved_at:'2026-09-28T12:00:00Z'};return r.respond({status:200,contentType:'application/json',body:'{}'});}
  return r.respond({status:200,contentType:'application/json',body:JSON.stringify(u.searchParams.has('statusOnly')?{statuses:[{id,status:current.status}]}:{view:'active',requests:[current],selected:current,messages:[],role,canApproveDevelopment:capability,hasMore:false})});
 });
 const load=async(patch={},r='participant',can=true)=>{current={...original,...patch};role=r;capability=can;posts=[];await p.goto(base+'/chat/features?request='+id);await p.waitForSelector('[role="group"][aria-label="Ticket actions"]');await p.waitForFunction(()=>document.querySelector('h2')?.textContent==='Jammie development approval');};
 await load();assert.ok(await button(p,'Approve for development'));assert.equal(await button(p,'Decline'),null);assert.equal(await button(p,'Approve merge & publish'),null);
 await (await button(p,'Approve for development')).click();await p.waitForFunction(()=>document.body.textContent.includes('Development approved'));
 assert.deepEqual(posts,[{action:'approve',id,content:'',revision:7}]);assert.equal(await button(p,'Approve for development'),null);assert.ok(await p.$('time[datetime="2026-09-28T12:00:00Z"]'));
 await load({proposal:' '});assert.equal(await (await button(p,'Approve for development')).evaluate(e=>e.disabled),true);
 await load();await (await button(p,'Edit proposal')).click();assert.equal(await button(p,'Approve for development'),null);
 for(const state of ['ready','failed']){await load({status:'ready',release:{...release,state}});assert.equal(await button(p,'Approve merge & publish'),null);assert.equal(await button(p,'Approve retry: merge & publish'),null);}
 await load({},'participant',false);assert.equal(await button(p,'Approve for development'),null);assert.equal(await button(p,'Decline'),null);
 await load({},'owner',false);assert.ok(await button(p,'Approve for development'));assert.ok(await button(p,'Decline'));
 await load({status:'ready',release},'owner',false);assert.ok(await button(p,'Approve merge & publish'));
 for(const theme of ['dark','light']){await load();if(await p.$eval('main',e=>e.dataset.featureTheme)!==theme)await p.click('button[aria-label="Light mode"]');for(const width of [390,1440]){await p.setViewport({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:`/tmp/jammie-approval-${theme}-${width}.png`});}}
 assert.deepEqual(errors,[]);console.log('PASS development capability UI, actual revision payload, timestamp, blank/editing states, owner-only decline/publish, unrelated participant denied, desktop/mobile dark/light. API responses intercepted; SQL and route authorization tested separately.');
}finally{await browser.close();}
