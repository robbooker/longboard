import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base='http://localhost:3280';
await writeFile('/tmp/s03-dm.gif',Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const post=(page,body)=>page.evaluate(async body=>{const r=await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},body);
const get=(page,path)=>page.evaluate(async path=>(await fetch(path)).json(),path);
async function login(p,email){await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label^="Message "]');await p.waitForNetworkIdle({idleTime:500});}
const click=async(p,text)=>{const found=await p.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);b?.click();return Boolean(b);},text);assert.ok(found,text);};
async function select(p,id,name){await p.bringToFront();await p.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),id);await p.waitForFunction(name=>document.querySelector('header[data-dm="true"] h1')?.textContent===name,{},name);await p.waitForSelector('#dm-body',{visible:true});await p.waitForFunction(()=>document.activeElement?.id==='dm-body');}
try{
 const p=await browser.newPage();await p.setViewport({width:390,height:844});await login(p,'bob@example.test');
 await p.click('button[aria-label="Open room navigation"]');await click(p,'＋ Start New DM');await p.type('dialog input[type=search]','Scout');await p.waitForSelector('ul[aria-label="Members"] button');const scout=(await get(p,'/api/chat/dm-members?q=Scout')).members[0];await click(p,'Scout Tester');await p.waitForFunction(()=>document.body.textContent.includes('Start with a request.'));await p.waitForSelector('#dm-body');
 assert.equal((await post(p,{action:'request',target:scout.id,body:'Other session introduction',clientId:randomUUID()})).status,200);
 let release,result;await p.setRequestInterception(true);p.on('request',async r=>{if(r.method()!=='POST'||!r.url().endsWith('/api/chat/inbox')||JSON.parse(r.postData()||'{}').action!=='request')return r.continue();result=await fetch(r.url(),{method:'POST',headers:r.headers(),body:r.postData()}).then(async r=>({status:r.status,body:await r.text()}));await new Promise(resolve=>release=resolve);await r.respond({status:result.status,contentType:'application/json',body:result.body});});
 await p.type('#dm-body','S03 introductory request');await p.$eval('#dm-body',e=>e.form.requestSubmit());await p.waitForSelector('[data-client-id]');assert.equal(await p.$('#dm-body'),null,'No second introduction while sending');while(!release)await new Promise(r=>setTimeout(r,20));assert.equal(JSON.parse(result.body).message,null);release();await p.waitForFunction(()=>document.querySelectorAll('[data-client-id]').length===0);await p.waitForFunction(()=>document.body.textContent.includes('Other session introduction'));assert.equal(await p.$('#dm-body'),null,'Request waits for acceptance');assert.equal(await p.$$eval('[data-message-id]',els=>els.some(e=>e.textContent.includes('S03 introductory request'))),false);await p.screenshot({path:'/tmp/s03-dm-intro-mobile.png'});console.log('PASS introductory request gates composer and null acknowledgement opens actual existing conversation without invented row.');
}finally{await browser.close();}
