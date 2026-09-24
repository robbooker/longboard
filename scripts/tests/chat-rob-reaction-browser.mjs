// Real shared UI and Next Image; synthetic HTTP with fixed local image, no live data.
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const source=`import React from 'react';import{createRoot}from'react-dom/client';import Reactions,{MessageReactionProvider}from'./components/chat/MessageReactions';const targets=[{kind:'room',room:'social',messageId:'room'},{kind:'dm',conversationId:'conversation',messageId:'dm'},{kind:'room',room:'social',messageId:'reply'}];createRoot(document.getElementById('root')).render(<MessageReactionProvider>{targets.map(target=><article key={target.messageId}><header>{target.messageId}<span data-dm-reaction-host/></header><p>A message with reactions</p><Reactions target={target} compact={target.kind==='dm'}/></article>)}</MessageReactionProvider>);`;
const bundle=await build({stdin:{contents:source,loader:'tsx',resolveDir:root},bundle:true,write:false,outdir:resolve(root,'.rob-fixture'),jsx:'automatic',alias:{'@':root},loader:{'.module.css':'local-css'},define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},plugins:[{name:'updates-stub',setup(b){b.onResolve({filter:/^\.\/ChatUpdates$/},()=>({path:'updates',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export function useChatUpdates(){return null}',loader:'js'}));}}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).contents,image=await readFile('public/chat/reactions/rob.png');
const rows=new Map();let details=0;
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/_next/image')||req.url==='/chat/reactions/rob.png'){res.setHeader('Content-Type','image/png');return res.end(image);}
 if(req.url==='/api/chat/message-reactions'){
  let body='';for await(const c of req)body+=c;const p=JSON.parse(body);res.setHeader('Content-Type','application/json');
  if(p.action==='details'){assert.equal(p.emoji,'rob');details++;return res.end(JSON.stringify({people:[{id:'viewer',name:'Test trader'}],nextCursor:null}));}
  if(p.action==='set'){assert.equal(p.emoji,'rob');rows.set(p.messageId,p.active);}
  return res.end(JSON.stringify({messages:Object.fromEntries((p.messageIds??[p.messageId]).map(id=>[id,[{emoji:'like',count:2,mine:false,names:['Other trader']},{emoji:'future',count:1,mine:false,names:[]},...(rows.get(id)?[{emoji:'rob',count:1,mine:true,names:['Test trader']}]:[])]]))}));
 }
 res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/bundle.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?js:req.url==='/bundle.css'?css:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>:root{--chat-text:#123;--chat-muted:#456;--chat-panel-raised:#fff;--chat-line:#bbb;--chat-palm:#087a48;--chat-palm-soft:#e2f4e8}body{margin:12px;font:14px system-ui;background:var(--chat-panel-raised);color:var(--chat-text)}article{border:1px solid var(--chat-line);padding:12px;margin-bottom:12px}header{display:flex;justify-content:space-between}body.dark{--chat-text:#eee;--chat-panel-raised:#182220;--chat-line:#53625b;--chat-palm:#64d49b;--chat-palm-soft:#224b36}</style><div id="root"></div><script src="/bundle.js"></script>`);
});await new Promise(r=>server.listen(3326,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const p=await browser.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
try{
 for(const width of [320,390,1100])for(const theme of ['light','dark']){
  rows.clear();await p.setViewport({width,height:900,hasTouch:width<500,isMobile:width<500});await p.goto('http://127.0.0.1:3326');await p.evaluate(theme=>document.body.className=theme,theme);
  for(const id of ['room','dm','reply']){
   const scope=`[data-reaction-message="${id}"]`;await p.waitForSelector(`${scope} button[aria-pressed]`);
   assert.equal(await p.$(`${scope} button[aria-label*="future"]`),null,'unknown reactions do not render as likes');
   await p.$eval(scope,e=>e.closest('article').querySelector('[aria-label="Add reaction"]').click());await p.waitForSelector('dialog[open] button[aria-label="rob reaction"]');
   await p.waitForFunction(()=>{const i=document.querySelector('dialog[open] img');return i?.complete&&i.naturalWidth>0;});
   assert.ok(await p.$eval('dialog[open]',e=>e.getBoundingClientRect().right<=innerWidth),'picker fits');
   await p.click('dialog[open] button[aria-label="rob reaction"]');await p.waitForSelector(`${scope} button[aria-label^="Remove rob"]`);
   const chip=`${scope} button[aria-label^="Remove rob"]`;assert.equal(await p.$eval(chip,e=>e.getAttribute('aria-pressed')),'true');
   await p.focus(chip);await p.keyboard.down('Shift');await p.keyboard.press('F10');await p.keyboard.up('Shift');await p.waitForSelector('dialog[open] li');
   assert.equal(await p.$eval('dialog[open] h2',e=>e.textContent.trim()),'Rob reactions');assert.match(await p.$eval('dialog[open]',e=>e.textContent),/Test trader/);
   await p.keyboard.press('Escape');await p.waitForSelector('dialog[open]',{hidden:true});assert.equal(await p.$eval(chip,e=>e===document.activeElement),true);
   if(id==='dm')await p.screenshot({path:`/tmp/rob-reaction-${width}-${theme}.png`});
   await p.click(chip);await p.waitForSelector(chip,{hidden:true});assert.ok(await p.$(`${scope} button[aria-label^="Add like"]`),'existing like remains');
  }
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
 }
 assert.equal(details,18);assert.deepEqual(errors,[]);console.log('PASS Rob room/compact DM/reply picker, loaded image, count/toggle, details/focus, unknown-key handling, legacy likes; 320/390/1100px light and dark.');
}finally{await browser.close();server.close();}
