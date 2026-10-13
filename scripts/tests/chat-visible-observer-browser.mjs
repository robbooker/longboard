// P7: the visible-notification observer is built once per pane; new rows, bell refreshes and
// boundary changes reuse it, and visible rows are still acknowledged exactly once per boundary.
import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const output=await mkdtemp(join(tmpdir(),'chat-visible-observer-'));
// The shared activity snapshot comes from the page: tests change its boundary and data.
const activity=`import {useSyncExternalStore} from 'react';
const store=window.activityStore={value:{data:{mentionThrough:5,reactionThrough:0},read:async r=>{window.reads.push(r);}},listeners:new Set(),set(v){this.value={...this.value,...v};this.listeners.forEach(l=>l());}};
export function useSharedChatActivity(){return useSyncExternalStore(l=>{store.listeners.add(l);return()=>store.listeners.delete(l);},()=>store.value);}`;
await build({entryPoints:['scripts/tests/visible-observer/entry.tsx'],outdir:output,bundle:true,jsx:'automatic',format:'iife',define:{'process.env.NODE_ENV':'"test"','process.env':'{}'},
 alias:{'@':resolve('.')},
 plugins:[{name:'fixture',setup(b){b.onResolve({filter:/ChatActivityContext$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:activity,loader:'tsx',resolveDir:resolve('.')}));}}]});
const server=createServer(async(req,res)=>{const js=req.url==='/entry.js';res.setHeader('Content-Type',js?'text/javascript':'text/html');res.end(js?await readFile(join(output,'entry.js')):'<html><body><div id="root"></div><script src="/entry.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const page=await browser.newPage();await page.setViewport({width:800,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.bringToFront();
 await page.waitForSelector('[data-mid="m20"]');await pause(500);
 const state=()=>page.evaluate(()=>({observers:window.observers,observed:window.observed,acked:window.reads.flatMap(r=>r.messageIds)}));
 let s=await state();
 assert.equal(s.observers,1,'one observer for the pane');
 assert.equal(s.observed,20,'every row observed once');
 assert.deepEqual(s.acked,['m1','m2','m3','m4','m5','m6','m7','m8'],'the rows in view are acknowledged');
 // New messages and bell refreshes: same observer, only the new rows are observed.
 for(let i=0;i<5;i++){await page.evaluate(()=>{window.addRows(2);window.bell();window.activityStore.set({data:{mentionThrough:5,reactionThrough:0,tick:Math.random()}});});await pause(80);}
 await pause(400);s=await state();
 assert.equal(s.observers,1,'still one observer after 5 message and bell changes');
 assert.equal(s.observed,30,'only the 10 new rows were added');
 assert.equal(new Set(s.acked).size,s.acked.length,'nothing acknowledged twice for one boundary');
 // Scrolling brings new rows into view; they are acknowledged.
 await page.$eval('#pane',n=>{n.scrollTop=n.scrollHeight;});await pause(600);s=await state();
 assert.ok(s.acked.includes('m30'),'a row scrolled into view is acknowledged');
 // A new boundary starts a fresh acknowledgement set without rebuilding the observer.
 const before=s.acked.length;
 await page.evaluate(()=>window.activityStore.set({data:{mentionThrough:9,reactionThrough:0}}));await pause(600);s=await state();
 assert.ok(s.acked.length>before&&s.acked.slice(before).includes('m30'),'visible rows are acknowledged again for the new boundary');
 assert.equal(s.observers,1,'a boundary change reuses the observer');
 assert.deepEqual(errors,[]);
 console.log(`PASS visible observer: 1 observer across 5 updates, ${s.observed} rows observed once each, visible rows acknowledged per boundary`);
}finally{await browser.close();server.close();await rm(output,{recursive:true,force:true});}
