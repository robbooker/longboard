// A reaction save on a stalled connection gives up with a message and unlocks the buttons
// (a member on Safari clicked and nothing happened). Synthetic data; no server.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root=resolve('.'),out=await mkdtemp(join(tmpdir(),'chat-reaction-timeout-'));
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import MessageReactions,{MessageReactionProvider}from'./components/chat/MessageReactions';
createRoot(document.getElementById('root')).render(<MessageReactionProvider><article><p>Hello</p><MessageReactions target={{kind:'room',room:'social',messageId:'00000000-0000-4000-8000-000000000001'}}/></article></MessageReactionProvider>);`,resolveDir:root,loader:'tsx'},bundle:true,outfile:join(out,'bundle.js'),jsx:'automatic',alias:{'@':root},plugins:[{name:'next-image',setup(b){b.onResolve({filter:/^next\/image$/},()=>({path:'next-image',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export default function Image(p){return null}',loader:'js'}));}}],loader:{'.module.css':'local-css','.png':'empty'},define:{'process.env.NODE_ENV':'"development"'},logLevel:'error'});
const server=createServer(async(req,res)=>{const name=req.url==='/bundle.js'?'bundle.js':req.url==='/bundle.css'?'bundle.css':null;res.setHeader('Content-Type',name?.endsWith('js')?'text/javascript':name?'text/css':'text/html');res.end(name?await readFile(join(out,name)):'<!doctype html><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const errors=[];
try{
 for(const mode of ['stall','drop']){
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.evaluateOnNewDocument(mode=>{window.fetch=(url,init={})=>{const body=JSON.parse(init.body||'{}');
   if(body.action==='read')return Promise.resolve(new Response(JSON.stringify({messages:{}}),{headers:{'Content-Type':'application/json'}}));
   if(mode==='drop')return Promise.reject(new TypeError('Load failed'));
   // Stalled: never answers until aborted.
   return new Promise((_,reject)=>init.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));};},mode);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForSelector('button[aria-label="Add reaction"]:not([disabled])');
  await page.click('button[aria-label="Add reaction"]');
  await page.waitForSelector('dialog[open] button[aria-label="heart reaction"]');
  await page.click('dialog[open] button[aria-label="heart reaction"]');
  if(mode==='stall')await page.waitForFunction(()=>document.querySelector('dialog[open] button[aria-label="heart reaction"]')?.disabled);
  const expected=mode==='stall'?'connection timed out':'no connection';
  await page.waitForFunction(t=>document.querySelector('[role="alert"]')?.textContent.includes(t),{timeout:20000},expected);
  assert.equal(await page.$eval('dialog[open] button[aria-label="heart reaction"]',b=>b.disabled),false,'buttons unlock after a failed save');
  await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS chat reaction save: a stalled save times out with a message and a dropped connection says so; buttons unlock');
}finally{await browser.close();server.close();}
