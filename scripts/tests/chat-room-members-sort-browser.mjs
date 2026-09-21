// Actual RoomMemberList with synthetic server ordering; no production requests.
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const source=`import React from'react';import{createRoot}from'react-dom/client';import RoomMemberList from'./components/chat/RoomMemberList';
const id=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');function App(){const[online,setOnline]=React.useState(new Set(Array.from({length:65},(_,i)=>id(i+71))));const[ready,setReady]=React.useState(true);window.same=()=>setOnline(new Set([...online].reverse()));window.change=()=>setOnline(new Set([id(1),...Array.from({length:65},(_,i)=>id(i+71))]));window.restore=()=>setOnline(new Set(Array.from({length:65},(_,i)=>id(i+71))));window.unavailable=()=>setReady(false);return <RoomMemberList room="social" roomLabel="Social" memberId={id(71)} onlineIds={online} presenceReady={ready} onSelect={target=>window.selected=target}/>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle=await build({stdin:{contents:source,loader:'tsx',resolveDir:root},bundle:true,write:false,outdir:resolve(root,'.sort-fixture'),jsx:'automatic',alias:{'@':root},loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"development"'}});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).contents;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/bundle.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?js:req.url==='/bundle.css'?css:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>:root{--chat-panel:#fff;--chat-text:#123;--chat-line:#ccd;--chat-muted:#567;--chat-bg:#f9fafa;--chat-palm:#176848;--chat-font-ui:Arial}</style><div id="root"></div><script src="/bundle.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.evaluateOnNewDocument(()=>{
 const id=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');const all=Array.from({length:135},(_,i)=>({id:id(i+1),display_name:'Member '+String(i+1).padStart(3,'0')}));window.requests=[];window.holdNext=false;window.aborted=false;
 window.fetch=async(url,options={})=>{
  if(options.method!=='POST')return{ok:true,json:async()=>({total:135})};const body=JSON.parse(options.body);window.requests.push(body);const online=new Set(body.onlineIds);const rows=all.filter(m=>m.display_name.toLowerCase().includes((body.q||'').toLowerCase())).sort((a,b)=>Number(online.has(b.id))-Number(online.has(a.id))||a.display_name.localeCompare(b.display_name)||a.id.localeCompare(b.id));const offset=body.cursor?Number(body.cursor.split(':')[1]):0;const result={members:rows.slice(offset,offset+50),nextCursor:rows.length>offset+50?'page:'+String(offset+50):null};
  if(window.holdNext){window.holdNext=false;options.signal.addEventListener('abort',()=>window.aborted=true,{once:true});await new Promise(r=>window.release=r);}
  return{ok:true,json:async()=>result};
 };
});
try{
 await p.setViewport({width:390,height:844});await p.goto(`http://127.0.0.1:${server.address().port}`);await p.waitForSelector('button[aria-haspopup="dialog"]');await p.click('button[aria-haspopup="dialog"]');
 const names=()=>p.$$eval('ul[aria-label="Room members"] strong',els=>els.map(e=>e.textContent.replace(' (you)','')));
 async function loaded(first){await p.waitForFunction(expected=>document.querySelector('ul[aria-label="Room members"]').getAttribute('aria-busy')==='false'&&document.querySelector('ul strong')?.textContent.startsWith(expected),{},first);}
 async function nav(label){const buttons=await p.$$('nav button');await buttons[label==='Next'?1:0].click();}
 const range=(a,b)=>Array.from({length:b-a+1},(_,i)=>'Member '+String(a+i).padStart(3,'0'));
 await loaded('Member 071');assert.deepEqual(await names(),range(71,120));assert.equal(await p.$eval('ul button',e=>e.disabled),true,'self cannot start DM');
 await nav('Next');await loaded('Member 121');assert.deepEqual(await names(),[...range(121,135),...range(1,35)]);
 await nav('Next');await loaded('Member 036');assert.deepEqual(await names(),range(36,70));assert.equal(await p.$eval('nav button:last-child',e=>e.disabled),true);
 await nav('Previous');await loaded('Member 121');
 const before=await p.evaluate(()=>window.requests.length);await p.evaluate(()=>window.same());await new Promise(r=>setTimeout(r,350));assert.equal(await p.$eval('nav span',e=>e.textContent),'Page 2');assert.equal(await p.evaluate(()=>window.requests.length),before,'equivalent Set must not fetch/reset');
 await p.type('input[type="search"]','Member 13');await loaded('Member 130');assert.deepEqual(await names(),range(130,135));assert.equal(await p.$eval('nav span',e=>e.textContent),'Page 1');assert.equal(await p.evaluate(()=>window.requests.at(-1).cursor),null);
 await p.click('input[type="search"]',{clickCount:3});await p.keyboard.press('Backspace');await loaded('Member 071');
 await p.evaluate(()=>window.holdNext=true);await nav('Next');await p.waitForFunction(()=>typeof window.release==='function');await p.evaluate(()=>window.change());await loaded('Member 001');assert.equal(await p.$eval('nav span',e=>e.textContent),'Page 1');assert.equal(await p.evaluate(()=>window.aborted),true,'old page fetch aborted');await p.evaluate(()=>window.release());await new Promise(r=>setTimeout(r,100));assert.deepEqual(await names(),['Member 001',...range(71,119)],'late page response cannot replace current scope');
 await p.evaluate(()=>window.restore());await loaded('Member 071');assert.equal(await p.$eval('nav span',e=>e.textContent),'Page 1','A to B to A must not resurrect old page 2');assert.deepEqual(await names(),range(71,120));await nav('Next');await loaded('Member 121');await p.evaluate(()=>window.unavailable());await loaded('Member 001');assert.deepEqual(await names(),range(1,50));assert.equal(await p.$eval('nav span',e=>e.textContent),'Page 1');assert.deepEqual(await p.evaluate(()=>window.requests.at(-1).onlineIds),[]);assert.ok(await p.$$eval('ul li',els=>els.every(e=>e.textContent.includes('Status unavailable'))));
 await p.screenshot({path:'/tmp/chat-room-members-sort.png'});await p.click('ul button');await p.waitForFunction(()=>!document.querySelector('dialog'));assert.equal(await p.evaluate(()=>window.selected.name),'Member 001');assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-haspopup')),'dialog');
 await p.click('button[aria-haspopup="dialog"]');await loaded('Member 001');await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('dialog'));assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-haspopup')),'dialog');assert.deepEqual(errors,[]);
 console.log('PASS: 135 members/65 online globally ordered over 3 pages; previous/next, search reset, equivalent Set stability, presence change abort+stale suppression, unavailable alpha fallback, self disabled, DM selection and close/Escape focus. No page errors.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
