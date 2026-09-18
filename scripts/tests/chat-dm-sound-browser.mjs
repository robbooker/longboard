import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3271';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const pause=()=>new Promise(resolve=>setTimeout(resolve,600));
async function login(email){const context=await browser.createBrowserContext(),p=await context.newPage();await p.setViewport({width:1440,height:900});
 await p.evaluateOnNewDocument(()=>{window.dmTones=[];const original=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(){const node=original.call(this);let first;const set=node.frequency.setValueAtTime.bind(node.frequency);node.frequency.setValueAtTime=(value,time)=>{first??=value;return set(value,time);};const start=node.start.bind(node);node.start=(...args)=>{window.dmTones.push(first);return start(...args);};return node;};});
 await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label="Message LB"]');return p;
}
const api=(p,body)=>p.evaluate(async body=>{const r=await fetch('/api/chat/inbox',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);if(!r.ok)throw new Error(await r.text());return r.json();},body);
const click=async(p,text)=>{const buttons=await p.$$('button');for(const b of buttons)if(await b.evaluate((e,t)=>e.textContent.trim()===t,text)){await b.click();return;}throw Error(text);};
const count=p=>p.evaluate(()=>window.dmTones.length);
const refresh=async p=>{await p.bringToFront();await p.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));await pause();};
try{
 const alice=await login('alice@example.test');await alice.waitForSelector('details[class*=soundSettings] summary');
 const list=await api(alice),conversation=list.conversations.find(c=>c.otherName==='Bob');if(conversation.status==='pending')await api(alice,{action:'accept',target:conversation.id});
 const bob=await login('bob@example.test');await alice.bringToFront();await alice.click('details[class*=soundSettings] summary');
 assert.equal(await count(alice),0,'initial history silent');
 const toggle='details[class*=soundSettings] input[type=checkbox]';await alice.click(toggle);await click(alice,'Test DM sound');await alice.waitForFunction(()=>window.dmTones.length===1);
 await alice.select('select[aria-label="Default DM sound"]','pulse');await click(alice,'Test DM sound');await alice.waitForFunction(()=>window.dmTones.length===2);assert.deepEqual(await alice.evaluate(()=>window.dmTones),[660,440]);
 await api(bob,{action:'send',target:conversation.id,body:'Incoming sound',clientId:crypto.randomUUID()});await refresh(alice);await alice.waitForFunction(()=>window.dmTones.length===3);
 await refresh(alice);assert.equal(await count(alice),3,'duplicate refresh silent');
 await api(alice,{action:'send',target:conversation.id,body:'Self silent',clientId:crypto.randomUUID()});await refresh(alice);assert.equal(await count(alice),3,'self send silent');
 const button=await alice.$(`button[data-active]:has([class*="itemName"])`);await button.click();await alice.waitForSelector('select[aria-label="Conversation DM sound"]');
 await alice.select('select[aria-label="Conversation DM sound"]','mute');await api(bob,{action:'send',target:conversation.id,body:'Muted conversation',clientId:crypto.randomUUID()});await refresh(alice);assert.equal(await count(alice),3);
 await alice.select('select[aria-label="Conversation DM sound"]','chime');await api(bob,{action:'send',target:conversation.id,body:'Conversation override',clientId:crypto.randomUUID()});await refresh(alice);await alice.waitForFunction(()=>window.dmTones.length===4);assert.equal(await alice.evaluate(()=>window.dmTones.at(-1)),660);
 await alice.reload({waitUntil:'domcontentloaded'});await alice.waitForSelector('details[class*=soundSettings] summary');await pause();await alice.click('details[class*=soundSettings] summary');assert.equal(await alice.$eval(toggle,e=>e.checked),true);assert.equal(await alice.$eval('select[aria-label="Default DM sound"]',e=>e.value),'pulse');assert.equal(await count(alice),0,'reload history silent');
 await alice.click('button[data-active]:has([class*="itemName"])');await alice.waitForSelector('select[aria-label="Conversation DM sound"]');assert.equal(await alice.$eval('select[aria-label="Conversation DM sound"]',e=>e.value),'chime');
 await alice.setViewport({width:390,height:844});await alice.screenshot({path:'/tmp/dm-alerts-mobile.png'});assert.equal(await alice.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await alice.setViewport({width:1440,height:900});await alice.screenshot({path:'/tmp/dm-alerts-desktop.png'});
 await alice.click(toggle);await api(bob,{action:'send',target:conversation.id,body:'Global mute',clientId:crypto.randomUUID()});await refresh(alice);assert.equal(await count(alice),0);
 await bob.bringToFront();await bob.click('details[class*=soundSettings] summary');assert.equal(await bob.$eval(toggle,e=>e.checked),false,'preferences do not leak to another member');await bob.evaluate(()=>{window.AudioContext=class {constructor(){throw new Error('blocked');}};});await bob.focus(toggle);await bob.keyboard.press('Space');await bob.waitForFunction(()=>document.querySelector('details[class*=soundSettings]')?.textContent.includes('Audio is unavailable'));
 console.log('PASS member preference isolation, keyboard activation, unavailable audio fallback; real Web Audio activation/two tones, incoming-only dedupe, per-conversation mute/override, persisted global/default/conversation settings, reload silence, global mute and mobile bounds');
}finally{await browser.close();}
