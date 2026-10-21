// CHAT-API: the developers page in a real browser with a stubbed token API. Synthetic data only;
// no production route or credentials.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root=resolve('.'),out=await mkdtemp(join(tmpdir(),'chat-api-ui-'));
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import ChatDevelopers from './components/chat/ChatDevelopers';createRoot(document.getElementById('root')).render(<ChatDevelopers/>);`,resolveDir:root,loader:'tsx'},bundle:true,outfile:join(out,'bundle.js'),jsx:'automatic',alias:{'@':root},loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"development"'}});
const server=createServer(async(req,res)=>{const name=req.url==='/bundle.js'?'bundle.js':req.url==='/bundle.css'?'bundle.css':null;res.setHeader('Content-Type',name?.endsWith('js')?'text/javascript':name?'text/css':'text/html');res.end(name?await readFile(join(out,name)):'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const errors=[];
const token='lbc_'+'T'.repeat(39)+'wxyz';
async function pageFor(o={}){
 const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.setViewport({width:o.mobile?390:1280,height:o.mobile?844:900});
 await p.emulateMediaFeatures([{name:'prefers-color-scheme',value:o.dark?'dark':'light'}]);
 await p.evaluateOnNewDocument(o=>{
  const s=window.api={requests:[],tokens:o.tokens??[{id:'00000000-0000-4000-8000-000000000001',label:'Trading desk bot',hint:'a1b2',createdAt:'2026-10-20T14:05:00Z',lastUsedAt:'2026-10-21T13:40:00Z'}]};
  window.confirm=()=>true;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{s.copied=t;}}});
  window.fetch=async(url,init={})=>{const method=init.method||'GET',body=init.body?JSON.parse(init.body):null;s.requests.push({url:String(url),method,body});
   const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
   if(o.fail)return reply({error:'tokens_unavailable'},503);
   if(method==='GET')return reply({access:!o.noAccess,tokens:s.tokens});
   if(method==='POST'){if(o.limit)return reply({error:'You have 5 active tokens. Revoke one before making another.'},409);
    return reply({token:o.token,details:{id:'00000000-0000-4000-8000-000000000002',label:body.label.trim(),hint:o.token.slice(-4),createdAt:'2026-10-21T14:00:00Z',lastUsedAt:null}});}
   if(method==='DELETE')return reply({revoked:true});
  };
 },{...o,token});
 await p.goto(base,{waitUntil:'networkidle0'});return p;
}
const text=p=>p.evaluate(()=>document.body.innerText);
const clickText=(p,t)=>p.evaluate(t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t).click(),t);
try{
 // Invited: lists tokens with hint and dates, never the token itself.
 const desk=await pageFor();
 let body=await text(desk);
 assert.match(body,/Chat for developers/);assert.match(body,/Trading desk bot/);assert.match(body,/lbc_…a1b2/);assert.match(body,/api\/chat\/history\?room=social/);
 await desk.screenshot({path:'/tmp/chat-api-developers-desktop.png',fullPage:true});
 // Create: trims nothing client-side but sends the name; the new token shows once with Copy.
 assert.equal(await desk.$eval('button[type=submit]',b=>b.disabled),true,'no name, no create');
 await desk.type('input','  My CLI ');await clickText(desk,'Create token');
 await desk.waitForFunction(t=>document.body.innerText.includes(t),{},token);
 assert.deepEqual((await desk.evaluate(()=>api.requests)).find(r=>r.method==='POST').body,{label:'  My CLI '});
 assert.match(await text(desk),/won.t be shown again/);assert.equal(await desk.$eval('input',i=>i.value),'');
 await clickText(desk,'Copy token');assert.equal(await desk.evaluate(()=>api.copied),token);
 await desk.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Copied'));
 await desk.screenshot({path:'/tmp/chat-api-developers-new-token.png',fullPage:true});
 await clickText(desk,'Done');assert.ok(!(await text(desk)).includes(token),'token hidden after Done');
 assert.match(await text(desk),/My CLI/);
 // Revoke sends the id and removes the row.
 await desk.evaluate(()=>[...document.querySelectorAll('li')].find(l=>l.textContent.includes('Trading desk bot')).querySelector('button').click());
 await desk.waitForFunction(()=>!document.body.innerText.includes('Trading desk bot'));
 assert.deepEqual((await desk.evaluate(()=>api.requests)).find(r=>r.method==='DELETE').body,{id:'00000000-0000-4000-8000-000000000001'});
 // Five tokens: create is disabled; a server limit message is shown as written.
 const five=await pageFor({tokens:Array.from({length:5},(_,i)=>({id:`00000000-0000-4000-8000-00000000001${i}`,label:`Bot ${i+1}`,hint:'abcd',createdAt:'2026-10-20T14:05:00Z',lastUsedAt:null}))});
 await five.type('input','Six');assert.equal(await five.$eval('button[type=submit]',b=>b.disabled),true);
 const limit=await pageFor({limit:true,tokens:[]});assert.match(await text(limit),/No tokens yet/);
 await limit.type('input','Six');await clickText(limit,'Create token');await limit.waitForFunction(()=>document.body.innerText.includes('5 active tokens. Revoke'));
 // Not invited, and the API down.
 const none=await pageFor({noAccess:true,mobile:true});assert.match(await text(none),/invite-only/);assert.equal(await none.$('input'),null);
 const down=await pageFor({fail:true});assert.match(await text(down),/Couldn.t load your tokens/);
 // Phone, light and dark: no sideways scroll.
 for(const dark of [false,true]){const phone=await pageFor({mobile:true,dark});
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal scroll');
  await phone.screenshot({path:`/tmp/chat-api-developers-mobile-${dark?'dark':'light'}.png`,fullPage:true});}
 assert.deepEqual(errors,[]);
 console.log('PASS chat API developers page: lists tokens by hint, shows a new token once with copy, revokes, 5-token cap, invite-only and failure states, phone layout in light and dark');
}finally{await browser.close();server.close();}
