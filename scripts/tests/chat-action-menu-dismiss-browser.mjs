// Actual React components in a synthetic Chromium fixture; no production data or API.
import {resolve} from 'node:path';
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const root=process.cwd();
const source=`import React from 'react';import{createRoot}from'react-dom/client';import MessageActions from './components/chat/MessageActions';import DirectMessageActions from './components/chat/DirectMessageActions';
function App(){const[shown,setShown]=React.useState(true);window.unmountMenus=()=>setShown(false);return <><input id="outside" placeholder="Another draft"/>{shown&&['room','thread','admin','dm','paused','dm-disabled'].map(kind=><section key={kind} data-case={kind}><span>{kind}</span>{kind.startsWith('dm')?<DirectMessageActions message={{id:kind,body:'Original message',revision:0}} conversationId="synthetic" canEdit={kind==='dm'} onChanged={m=>window.changed=m}/>:<MessageActions message={{id:kind,body:'Original message',author_label:'Alice'}} room="social" own={kind!=='admin'} admin={kind==='admin'} paused={kind==='paused'} editOnly={kind==='thread'} onEdited={m=>window.changed=m} onDeleted={id=>window.changed=id}/>}</section>)}</>};createRoot(document.getElementById('root')).render(<App/>);`;
const b=await build({stdin:{contents:source,loader:'tsx',resolveDir:root},bundle:true,write:false,outdir:resolve(root,'.dismiss-fixture'),jsx:'automatic',alias:{'@':root},loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"development"'}});
const js=b.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=b.outputFiles.find(f=>f.path.endsWith('.css')).contents;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/bundle.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?js:req.url==='/bundle.css'?css:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>section{height:100px;display:flex;justify-content:space-between;padding:12px;border-bottom:1px solid #aaa}#outside{position:fixed;left:200px;top:5px;z-index:2}body{padding-top:40px}</style><div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.evaluateOnNewDocument(()=>{
 const show=HTMLDialogElement.prototype.showModal;window.modalMenuStates=[];HTMLDialogElement.prototype.showModal=function(){window.modalMenuStates.push(this.closest('section').querySelector('details').open);return show.call(this);};
 const listeners=new Set(),add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);document.addEventListener=(type,fn,opts)=>{if(type==='pointerdown')listeners.add(fn);return add(type,fn,opts);};document.removeEventListener=(type,fn,opts)=>{if(type==='pointerdown')listeners.delete(fn);return remove(type,fn,opts);};window.pointerListeners=()=>listeners.size;
 window.fetch=async(url,init)=>{const body=JSON.parse(init.body);return{ok:!window.apiError,json:async()=>window.apiError?{error:'message_changed'}:{message:{id:body.messageId,body:body.body}}};};
});
try{
 await p.setViewport({width:800,height:1000,hasTouch:true});await p.goto(`http://127.0.0.1:${server.address().port}`);await p.waitForSelector('summary');assert.equal(await p.evaluate(()=>window.pointerListeners()),0);
 const menu=k=>`[data-case="${k}"] details`,summary=k=>`${menu(k)} summary`,dialog=k=>`[data-case="${k}"] dialog[open]`;
 async function open(k,keyboard=false){await p.$eval(summary(k),e=>e.scrollIntoView({block:'center'}));if(keyboard){await p.focus(summary(k));await p.keyboard.press('Enter');}else await p.click(summary(k));await p.waitForFunction(s=>document.querySelector(s).open,{},menu(k));await p.waitForFunction(()=>window.pointerListeners()===1);}
 async function closed(k){await p.waitForFunction(s=>!document.querySelector(s).open,{},menu(k));await p.waitForFunction(()=>window.pointerListeners()===0);}
 async function choose(k,label){const buttons=await p.$$(`${menu(k)} button`);for(const button of buttons)if(await button.evaluate((e,text)=>e.textContent===text,label)){await button.click();return;}throw Error('Missing '+label);}
 async function focusSummary(k){await p.waitForFunction(s=>document.activeElement===document.querySelector(s),{},summary(k));}
 for(const k of ['room','thread','admin','dm']){
  await open(k);const box=await p.$eval(`${menu(k)}>div`,e=>{const r=e.getBoundingClientRect();return{x:r.x+2,y:r.y+2};});await p.mouse.click(box.x,box.y);assert.equal(await p.$eval(menu(k),e=>e.open),true,'inside padding stays open');
  await p.click('#outside');await closed(k);assert.equal(await p.evaluate(()=>document.activeElement.id),'outside');
  await open(k);const input=await p.$eval('#outside',e=>{const r=e.getBoundingClientRect();return{x:r.x+10,y:r.y+10};});await p.touchscreen.tap(input.x,input.y);await closed(k);assert.equal(await p.evaluate(()=>document.activeElement.id),'outside');
  await open(k,true);await p.keyboard.press('Escape');await closed(k);await focusSummary(k);
  for(const label of k==='thread'?['Edit']:k==='admin'?['Delete as admin']:['Edit','Delete']){
   await open(k,true);await p.keyboard.press('Tab');if(label==='Delete')await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.textContent),label);await p.keyboard.press('Enter');await p.waitForSelector(dialog(k));await closed(k);await p.keyboard.press('Escape');await p.waitForFunction(s=>!document.querySelector(s),{},dialog(k));await focusSummary(k);
   await open(k);await choose(k,label);await p.waitForSelector(dialog(k));await closed(k);await p.click(`${dialog(k)} footer button:first-child`);await p.waitForFunction(s=>!document.querySelector(s),{},dialog(k));await focusSummary(k);
   await open(k);await choose(k,label);await p.waitForSelector(dialog(k));await p.click(`${dialog(k)} footer button:last-child`);await p.waitForFunction(s=>!document.querySelector(s),{},dialog(k));await focusSummary(k);
  }
 }
 for(const k of ['paused','dm-disabled']){await open(k);assert.equal(await p.$eval(`${menu(k)} button`,e=>e.disabled),true);await choose(k,'Edit');assert.equal(await p.$eval(menu(k),e=>e.open),true);assert.equal(await p.$(dialog(k)),null);await p.click('#outside');await closed(k);}
 for(const k of ['room','dm']){await open(k);await choose(k,'Edit');await p.waitForSelector(dialog(k));await p.evaluate(()=>window.apiError=true);await p.click(`${dialog(k)} footer button:last-child`);await p.waitForSelector(`${dialog(k)} [role="alert"]`);await closed(k);await p.evaluate(()=>window.apiError=false);await p.keyboard.press('Escape');await p.waitForFunction(s=>!document.querySelector(s),{},dialog(k));await focusSummary(k);}
 await open('room');await p.screenshot({path:'/tmp/chat-action-menu-dismiss-open.png'});await choose('room','Edit');await p.waitForSelector(dialog('room'));await p.screenshot({path:'/tmp/chat-action-menu-dismiss-edit.png'});await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('dialog[open]'));
 await open('room');await p.evaluate(()=>window.unmountMenus());await p.waitForFunction(()=>!document.querySelector('details')&&window.pointerListeners()===0);await p.click('#outside');assert.equal(await p.evaluate(()=>document.activeElement.id),'outside');assert.ok(await p.evaluate(()=>window.modalMenuStates.length>0&&window.modalMenuStates.every(v=>v===false)));assert.deepEqual(errors,[]);
 console.log('PASS: room, thread editOnly, admin delete, DM; pre-modal disclosure close; outside mouse/touch focus; inside padding; disabled edit; keyboard Enter/Tab/Escape; modal cancel/success focus; API errors; listener zero at rest and after unmount; one listener when open. No page errors.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
