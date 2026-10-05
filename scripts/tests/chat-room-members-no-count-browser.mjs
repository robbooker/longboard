// Real component, synthetic directory responses and deterministic interval ticks.
// No credentials, production traffic or wall-clock minute waits.
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const source=`import React from'react';import{createRoot}from'react-dom/client';import RoomMemberList from'./components/chat/RoomMemberList';
const id=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
function App(){const[room,setRoom]=React.useState('social');const[nav,setNav]=React.useState(true);window.changeRoom=()=>setRoom(r=>r==='social'?'main':'social');return <><button id="navigation" onClick={()=>setNav(v=>!v)}>Toggle navigation</button><nav hidden={!nav}><RoomMemberList key={room} room={room} roomLabel={room==='social'?'Social':'Boardroom'} memberId={id(1)} onlineIds={new Set([id(1)])} presenceReady onSelect={target=>window.selected=target}/></nav></>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle=await build({stdin:{contents:source,loader:'tsx',resolveDir:root},bundle:true,write:false,outdir:resolve(root,'.no-count-fixture'),jsx:'automatic',alias:{'@':root},loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"development"'}});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).contents;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/bundle.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?js:req.url==='/bundle.css'?css:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>:root{--chat-panel:#fff;--chat-text:#123;--chat-line:#ccd;--chat-muted:#567;--chat-bg:#f9fafa;--chat-palm:#176848;--chat-font-ui:Arial}</style><div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 for(const width of [1280,390]){
  const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width,height:844});
  await p.evaluateOnNewDocument(()=>{
   const intervals=new Map();let next=1;
   window.setInterval=(fn,ms)=>{const id=next++;intervals.set(id,{fn,ms});return id;};
   window.clearInterval=id=>intervals.delete(id);
   window.tickIntervals=()=>{for(const {fn} of [...intervals.values()])fn();};
   window.intervalPeriods=()=>[...intervals.values()].map(x=>x.ms);
   let hidden=false;Object.defineProperty(document,'hidden',{get:()=>hidden});
   window.visibility=value=>{hidden=value;document.dispatchEvent(new Event('visibilitychange'));};
   window.requests=[];window.failNext=false;
   window.fetch=async(url,options={})=>{
    const method=options.method||'GET';window.requests.push({url:String(url),method,body:options.body?JSON.parse(options.body):null});
    if(window.failNext){window.failNext=false;return{ok:false,json:async()=>({error:'Directory temporarily unavailable.'})};}
    const id=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
    return{ok:true,json:async()=>({total:999,members:[{id:id(1),display_name:'Me'},{id:id(2),display_name:'Other Member'}],nextCursor:null})};
   };
  });
  const requests=()=>p.evaluate(()=>window.requests);
  const settle=()=>new Promise(r=>setTimeout(r,300));
  const loaded=()=>p.waitForFunction(()=>document.querySelector('ul[aria-label="Room members"]')?.getAttribute('aria-busy')==='false');
  await p.goto(`http://127.0.0.1:${server.address().port}`);await p.waitForSelector('button[aria-haspopup="dialog"]');await settle();
  assert.equal(await p.$eval('button[aria-haspopup="dialog"]',e=>e.textContent),'Member List');
  assert.deepEqual(await requests(),[],'mount must not fetch an exact count');
  await p.evaluate(()=>{window.tickIntervals();window.tickIntervals();window.visibility(true);window.tickIntervals();window.visibility(false);});await settle();
  assert.deepEqual(await requests(),[],'closed list stays idle through interval ticks and visibility resume');
  await p.click('#navigation');await p.evaluate(()=>window.tickIntervals());await p.click('#navigation');await settle();
  assert.deepEqual(await requests(),[],'mobile navigation visibility must not request a count');
  await p.evaluate(()=>window.changeRoom());await settle();
  assert.deepEqual(await requests(),[],'room change does not request a count');
  await p.click('button[aria-haspopup="dialog"]');await loaded();
  assert.equal((await requests()).length,1);assert.equal((await requests())[0].body.room,'main');
  assert.equal(await p.$eval('h2',e=>e.textContent),'Boardroom members');
  assert.deepEqual(await p.evaluate(()=>window.intervalPeriods()),[30000],'only the open directory refresh remains');
  assert.equal(await p.$eval('ul button',e=>e.disabled),true);
  await p.evaluate(()=>{window.visibility(true);window.tickIntervals();});await settle();assert.equal((await requests()).length,1,'hidden document pauses open directory polling');
  await p.evaluate(()=>window.visibility(false));await p.waitForFunction(()=>window.requests.length===2);await loaded();
  await p.evaluate(()=>window.tickIntervals());await p.waitForFunction(()=>window.requests.length===3);await loaded();
  await p.evaluate(()=>{window.failNext=true;window.tickIntervals();});await p.waitForSelector('[role="alert"]');
  assert.match(await p.$eval('[role="alert"]',e=>e.textContent),/Directory temporarily unavailable/);
  await p.evaluate(()=>[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Retry').click());await loaded();
  assert.equal(await p.$('[role="alert"]'),null,'retry restores directory');
  await p.click('ul li:nth-child(2) button');await p.waitForFunction(()=>!document.querySelector('dialog'));
  assert.equal(await p.evaluate(()=>window.selected.name),'Other Member');
  assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-haspopup')),'dialog');
  const closed=(await requests()).length;
  await p.evaluate(()=>{window.tickIntervals();window.visibility(true);window.visibility(false);});await settle();assert.equal((await requests()).length,closed,'closing removes directory work');
  await p.click('button[aria-haspopup="dialog"]');await loaded();await p.evaluate(()=>window.changeRoom());await p.waitForFunction(()=>!document.querySelector('dialog'));await settle();
  const changed=(await requests()).length;await p.evaluate(()=>{window.tickIntervals();window.visibility(false);});await settle();assert.equal((await requests()).length,changed,'room remount clears open list work');
  await p.click('button[aria-haspopup="dialog"]');await loaded();assert.equal((await requests()).at(-1).body.room,'social');
  await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('dialog'));
  assert.ok((await requests()).every(r=>r.method==='POST'&&r.url==='/api/chat/room-members'),'no exact-count GETs in any scenario');
  assert.deepEqual(errors,[]);await p.close();
 }
 console.log('PASS: desktop/mobile no count requests on mount, interval, room switch, navigation visibility or resume; directory opening, refresh, hidden pause, error/retry, selection, room remount and Escape remain functional.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
