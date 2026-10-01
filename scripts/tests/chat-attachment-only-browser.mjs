// Actual app/upload/scan/send/read routes against the current synthetic SQL chain.
// Start chat-shortscout-authorization-fixture.mjs on 54556 and Next on 3356.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base='http://localhost:3356',fixture='http://127.0.0.1:54556';
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
const sql=(sql,args=[])=>control('sql',{sql,args});
const identity=await control('identity');
await sql("update longboard_chat_messages set created_at=now()-interval '1 day'");
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[],sent=[];
let sequence=0,lastSent=0;
async function newPage(context){const p=await context.newPage();await p.setViewport({width:1440,height:1000});p.on('pageerror',e=>errors.push(e.message));return p;}
async function ready(p,selector){await p.waitForSelector(selector,{visible:true});await p.waitForFunction(selector=>{const e=document.querySelector(selector);return Object.keys(e).some(k=>k.startsWith('__reactProps$')&&typeof e[k]?.onChange==='function');},{},selector);}
async function api(p,path,body){return p.evaluate(async({path,body})=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{path,body});}
async function typeText(p,selector,value){await p.focus(selector);const lines=value.split('\n');for(let i=0;i<lines.length;i++){if(i){await p.keyboard.down('Shift');await p.keyboard.press('Enter');await p.keyboard.up('Shift');}await p.keyboard.type(lines[i]);}}
async function attach(p,selector,mode='select',reject=false){
 console.log('Checking upload',selector,mode,reject?'rejected':'clean');
 const name=`attachment-only-${++sequence}${reject?'-rejected':''}.gif`;
 if(mode==='paste')await p.$eval(selector,(e,{name,base64})=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],name,{type:'image/gif'}));e.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},{name,base64:gif.toString('base64')});
 else {const path='/tmp/'+name;await writeFile(path,reject?Buffer.concat([gif,Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')]):gif);const form=await (await p.$(selector)).evaluateHandle(e=>e.form);await (await form.$('input[type=file]')).uploadFile(path);await form.dispose();}
 await p.waitForFunction((selector,name)=>[...document.querySelector(selector).form.querySelectorAll('li')].some(e=>e.textContent.includes(name)&&e.textContent.includes('Scanning for malware')),{},selector,name);
 assert.equal(await p.$eval(selector,e=>e.form.querySelector('button[type=submit],button:not([type])').disabled),true,'Scanning blocks send');
 await p.waitForFunction((selector,name,reject)=>[...document.querySelector(selector).form.querySelectorAll('li')].some(e=>e.textContent.includes(name)&&e.textContent.includes(reject?'did not pass':'Ready to send')),{},selector,name,reject);
 if(!reject)assert.deepEqual(await p.$eval(selector,e=>({required:e.required,missing:e.validity.valueMissing,valid:e.checkValidity()})),{required:false,missing:false,valid:true},'Ready attachments remove native text requirement');
 return name;
}
async function submit(p,selector,keyboard=false,expectedBody=''){
 // Respect the real room endpoint’s 1.5-second send interval.
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,1600-(Date.now()-lastSent))));
 const response=p.waitForResponse(r=>r.request().method()==='POST'&&['/api/chat','/api/chat/inbox'].includes(new URL(r.url()).pathname)&&JSON.parse(r.request().postData()||'{}').action==='send');
 if(keyboard){await p.focus(selector);await p.keyboard.press('Enter');}else{const button=await (await p.$(selector)).evaluateHandle(e=>e.form.querySelector('button[type=submit],button:not([type])'));await button.click();await button.dispose();}
 const r=await response,data=await r.json(),payload=JSON.parse(r.request().postData());assert.equal(r.status(),200,JSON.stringify(data));assert.equal(data.message.body,expectedBody);assert(data.message.attachment_ids.length);sent.push({payload,message:data.message});lastSent=Date.now();
 await p.waitForFunction(selector=>!document.querySelector(selector)?.form.querySelector('[aria-label="Attachment drafts"]'),{},selector);
 const rows=await sql(`select body,attachment_ids from ${payload.target?'longboard_chat_direct_messages':'longboard_chat_messages'} where id=$1`,[data.message.id]);assert.equal(rows[0].body,expectedBody);assert.deepEqual(rows[0].attachment_ids,data.message.attachment_ids);
 const files=await sql('select status,sha256,room_message_id,dm_message_id from chat_attachments where id=any($1::uuid[])',[data.message.attachment_ids]);assert(files.every(f=>f.status==='attached'&&f.sha256&&(f.room_message_id||f.dm_message_id)===data.message.id));
 const delivered=await p.evaluate(async id=>{const r=await fetch('/api/chat/attachments/'+id);return {status:r.status,type:r.headers.get('content-type'),bytes:Array.from(new Uint8Array(await r.arrayBuffer()))};},data.message.attachment_ids[0]);assert.deepEqual(delivered,{status:200,type:'image/gif',bytes:Array.from(gif)});
 const image=`img[src*="${data.message.attachment_ids[0]}"]`;await p.waitForSelector(image);await p.$eval(image,e=>e.scrollIntoView({block:'nearest'}));await p.waitForFunction(image=>{const e=document.querySelector(image);return e?.complete&&e.naturalWidth>0;},{},image);
 // Exact retry must return the same message and never bind a second time.
 const retry=await api(p,payload.target?'/api/chat/inbox':'/api/chat',payload);assert.equal(retry.status,200);assert.equal(retry.data.message.id,data.message.id);
 return data.message;
}
async function room(p,slug,label){
 const selector=`textarea[aria-label="Message ${label}"]`;await p.goto(base+'/chat?room='+slug);await ready(p,selector);
 const empty=await api(p,'/api/chat',{room:slug,action:'send',body:'',attachmentIds:[]});assert.equal(empty.status,400);
 await attach(p,selector);const first=await submit(p,selector);
 await p.reload();await ready(p,selector);await p.waitForSelector(`#chat-message-${first.id} [aria-label="Message attachments"]`);
 await p.setViewport({width:390,height:844});await attach(p,selector,'paste');await submit(p,selector,true);await p.screenshot({path:`/tmp/chat-attachment-only-${slug}-mobile.png`});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.setViewport({width:1440,height:1000});
 const text='First line\nSecond line **kept**';await typeText(p,selector,text);await attach(p,selector);await submit(p,selector,false,text);
 await p.goto(base+`/chat?room=${slug}&thread=${first.id}`);const reply='aside[aria-label="Comment replies"] textarea';await ready(p,reply);await p.setViewport({width:390,height:844});await attach(p,reply,'paste');await submit(p,reply,true);await p.screenshot({path:`/tmp/chat-attachment-only-${slug}-reply-mobile.png`});await p.setViewport({width:1440,height:1000});
 console.log(`PASS ${label}: selected/button, pasted/Enter, text formatting, reload, reply and exact retry.`);
 return first;
}
try{
 const context=await browser.createBrowserContext(),p=await newPage(context);
 await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email','alice@example.test');await p.type('#li-password','demo-only');await p.click('button[type=submit]');await ready(p,'textarea[aria-label="Message LB"]');
 await room(p,'main','LB');await room(p,'social','SOCIAL');
 await p.goto(base+'/chat?room=main');const input='textarea[aria-label="Message LB"]';await ready(p,input);
 await attach(p,input);const rejected=await attach(p,input,'select',true);assert.equal(await p.$eval(input,e=>e.form.querySelector('button[type=submit]').disabled),true,'A failed second file blocks a ready first file');await p.click(`button[aria-label="Remove ${rejected}"]`);
 // Fail before server execution; the ready attachment and retry key must remain.
 let held=null;await p.setRequestInterception(true);const intercept=r=>{if(!held&&new URL(r.url()).pathname==='/api/chat'&&r.method()==='POST'&&JSON.parse(r.postData()||'{}').action==='send'){held=JSON.parse(r.postData());void r.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic send outage'})});}else void r.continue();};p.on('request',intercept);
 await p.click('button[type=submit][data-state]');await p.waitForFunction(()=>document.querySelector('button[data-state="error"]'));assert.equal(await p.$eval(input,e=>e.value),'');assert(await p.$('[aria-label="Attachment drafts"]'));p.off('request',intercept);await p.setRequestInterception(false);
 await submit(p,input);assert.equal(sent.at(-1).payload.clientId,held.clientId);assert.deepEqual(sent.at(-1).payload.attachmentIds,held.attachmentIds);console.log('PASS pending/failed scan gates, ready-file preservation and same-key send retry.');
 const inbox=await p.evaluate(async()=>(await (await fetch('/api/chat/inbox')).json()));const dm=inbox.conversations.find(c=>c.otherName==='Bob');assert(dm);if(dm.status==='pending')assert.equal((await api(p,'/api/chat/inbox',{action:'accept',target:dm.id})).status,200);
 await p.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),dm.id);await ready(p,'#dm-body');assert.equal((await api(p,'/api/chat/inbox',{action:'send',target:dm.id,body:'',attachmentIds:[],clientId:crypto.randomUUID()})).status,400);
 await attach(p,'#dm-body');await submit(p,'#dm-body');await p.setViewport({width:390,height:844});await attach(p,'#dm-body','paste');await submit(p,'#dm-body',true);await p.screenshot({path:'/tmp/chat-attachment-only-dm-mobile.png'});await p.setViewport({width:1440,height:1000});await typeText(p,'#dm-body','DM line one\nDM line two');await attach(p,'#dm-body');await submit(p,'#dm-body',false,'DM line one\nDM line two');console.log('PASS accepted DM selected/pasted/formatting/empty rejection/exact retry.');
 await p.goto(base+'/chat/quad');await ready(p,'select');const select=await p.$('select');await select.select('room:main');await ready(p,input);await attach(p,input,'paste');await submit(p,input,true);
 await select.select('dm:'+dm.id);const quadDm='textarea[placeholder="Write a private message…"]';await ready(p,quadDm);await attach(p,quadDm);await submit(p,quadDm);console.log('PASS Quad room and DM attachment-only send.');
 await context.close();
 const scout=await browser.createBrowserContext(),ss=await newPage(scout);await scout.setCookie({name:'lb-chat-session',value:identity.scoutToken,url:base,httpOnly:true});await control('source',{level:'mastermind',unavailable:false,expire:true});await room(ss,'shortscout','SS');
 await ss.goto(base+'/chat/quad');await ready(ss,'select');await ss.select('select','room:shortscout');const ssInput='textarea[aria-label="Message SS"]';await ready(ss,ssInput);await attach(ss,ssInput);await submit(ss,ssInput);await ss.screenshot({path:'/tmp/chat-attachment-only-quad.png'});await control('source',{level:'annual',expire:true});assert.equal((await api(ss,'/api/chat',{room:'shortscout',action:'send',body:'',attachmentIds:sent.at(-1).message.attachment_ids,clientId:crypto.randomUUID()})).status,403);console.log('PASS Quad SS and strict source authorization denial.');await scout.close();
 assert.deepEqual(errors,[]);console.log(`PASS ${sent.length} current-schema attachment sends, canonical empty bodies, scanned file binding and idempotency; zero browser errors.`);
}finally{await browser.close();}
