import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base='http://localhost:3282';
await writeFile('/tmp/s03-dm.gif',Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const post=(page,body)=>page.evaluate(async body=>{const r=await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},body);
const get=(page,path)=>page.evaluate(async path=>(await fetch(path)).json(),path);
// After the cookies are cleared the open chat redirects itself to sign-in, which can abort our own navigation once.
async function login(p,email){for(let n=0;;n++)try{await p.goto(base+'/login?next=%2Fchat');break;}catch(e){if(n>2||!String(e.message).includes('ERR_ABORTED'))throw e;await new Promise(r=>setTimeout(r,500));}await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label^="Message "]');
 // The chat page keeps reads open and never goes network-idle; wait for the hydrated composer instead.
 await p.waitForFunction(()=>{const e=document.querySelector('textarea[aria-label^="Message "]');return e&&Object.keys(e).some(k=>k.startsWith('__reactProps$'));});}
const click=async(p,text)=>{const found=await p.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);b?.click();return Boolean(b);},text);assert.ok(found,text);};
async function select(p,id,name){await p.bringToFront();await p.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),id);await p.waitForFunction(name=>document.querySelector('header[data-dm="true"] h1')?.textContent===name,{},name);await p.waitForSelector('#dm-body',{visible:true});await p.waitForFunction(()=>{const e=document.querySelector('#dm-body');return e&&!e.disabled&&Object.keys(e).some(k=>k.startsWith('__reactProps$'));});await p.focus('#dm-body');}
try{
 const p=await browser.newPage();await p.setViewport({width:1440,height:1000});await login(p,'alice@example.test');const list=await get(p,'/api/chat/inbox'),bob=list.conversations.find(c=>c.otherName==='Bob');
 // Bob's request starts pending; only an accepted conversation has a composer to draft in.
 if(bob.status==='pending')assert.equal((await post(p,{action:'accept',target:bob.id})).status,200);
 // Mallory needs her own conversation with Alice (this test runs on a fresh fixture).
 {const mallory=(await get(p,'/api/chat/dm-members?q=Mallory')).members[0];if(!list.conversations.some(c=>c.otherName==='Mallory'))assert.equal((await post(p,{action:'request',target:mallory.id,body:'S04 identity setup',clientId:randomUUID()})).status,200);}
await select(p,bob.id,'Bob');await p.waitForFunction(()=>!document.querySelector('[aria-label="Loading messages"]'));await p.type('#dm-body','PRIVATE ALICE UNSENT DRAFT');
 await browser.defaultBrowserContext().deleteCookie(...await browser.defaultBrowserContext().cookies());await p.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await login(p,'mallory@example.test');assert.equal(await p.$$eval('[data-message-id]',rows=>rows.some(r=>r.textContent.includes('S04 private history'))),false);assert.equal(await p.evaluate(()=>document.body.textContent.includes('PRIVATE ALICE UNSENT DRAFT')),false);const own=await get(p,'/api/chat/inbox');assert.equal(own.conversations.some(c=>c.id===bob.id),false);const alice=own.conversations.find(c=>c.otherName==='Alice');if(alice.status==='pending')assert.equal((await post(p,{action:'accept',target:alice.id})).status,200);await select(p,alice.id,'Alice');assert.equal(await p.$eval('#dm-body',e=>e.value),'');assert.equal(await p.$$eval('[data-message-id]',rows=>rows.some(r=>r.textContent.includes('S04 private history'))),false);console.log('PASS same-browser account switch isolates private DM history and unsent drafts.');
}finally{await browser.close();}
