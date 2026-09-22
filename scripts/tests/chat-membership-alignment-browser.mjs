import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base='http://localhost:3335';

const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const post=(page,body)=>page.evaluate(async body=>{const r=await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},body);
const get=(page,path)=>page.evaluate(async path=>(await fetch(path)).json(),path);
async function login(p,email){await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label^="Message "]');await p.waitForNetworkIdle({idleTime:500});}
async function select(p,id,name){await p.bringToFront();await p.waitForFunction(name=>[...document.querySelectorAll('aside[aria-label="Private conversations"] button')].some(e=>e.textContent.includes(name)),{},name);await p.evaluate(name=>[...document.querySelectorAll('aside[aria-label="Private conversations"] button')].find(e=>e.textContent.includes(name)).click(),name);await p.waitForFunction(name=>document.querySelector('header[data-dm="true"] h1')?.textContent===name,{},name);await p.waitForSelector('#dm-body',{visible:true});await p.waitForFunction(()=>document.activeElement?.id==='dm-body');}
try {
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.setRequestInterception(true);p.on('request',r=>r.url().includes('/api/chat/opening?')?r.respond({status:200,contentType:'application/json',body:JSON.stringify({messageId:null,readThrough:0})}):r.continue());await p.setViewport({width:1440,height:1000});await login(p,'alice@example.test');const list=await get(p,'/api/chat/inbox'),conversation=list.conversations.find(c=>c.otherName==='Bob');if(conversation.status==='pending')await post(p,{action:'accept',target:conversation.id});
 for(const body of ['Short','A longer outgoing message '.repeat(15)])await post(p,{action:'send',target:conversation.id,body,clientId:randomUUID()});
 for(const width of [320,390,768,1440]){
  await p.setViewport({width,height:1000});await p.reload({waitUntil:'domcontentloaded'});await select(p,conversation.id,'Bob');await p.waitForSelector('[data-message-id] [data-membership]');
  const rows=await p.$$eval('[data-message-id]',els=>els.map(e=>{const header=e.firstElementChild,identity=header.firstElementChild,name=identity.firstElementChild,badges=identity.querySelectorAll('[data-membership]');return {own:e.dataset.own,width:e.getBoundingClientRect().width,header:header.getBoundingClientRect().width,identityText:identity.textContent,name:name.textContent,labels:[...badges].map(b=>b.textContent),nameLeft:name.getBoundingClientRect().left,identityLeft:identity.getBoundingClientRect().left,badgeLeft:badges[0]?.getBoundingClientRect().left,nameRight:name.getBoundingClientRect().right,overflow:e.scrollWidth>e.clientWidth,textAlign:getComputedStyle(identity).textAlign};}));
  assert.ok(rows.length>=3);for(const row of rows){assert.deepEqual(row.labels,row.own==='true'?['LB']:['LB','SS']);assert.ok(Math.abs(row.nameLeft-row.identityLeft)<1);assert.ok(row.badgeLeft-row.nameRight<=10,JSON.stringify(row));assert.ok(row.badgeLeft>=row.nameRight);assert.equal(row.overflow,false);assert.equal(row.textAlign,'left');}
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:`/tmp/badge-alignment-${width}.png`});await p.$eval('[data-message-id][data-own="false"]',e=>e.scrollIntoView({block:'center'}));await p.screenshot({path:`/tmp/badge-alignment-dual-${width}.png`});
 }
 assert.deepEqual(errors,[]);console.log('PASS actual DirectInbox UI: LB/dual badges directly after names, left alignment independent of message width, actions remain separate, no overflow at320/390/768/1440.');
}finally{await browser.close();}
