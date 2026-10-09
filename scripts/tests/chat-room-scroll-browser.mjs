import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const output=await mkdtemp(join(tmpdir(),'chat-room-scroll-'));
const mocks={
 'next/link':`import React from 'react';export default function Link({children,scroll,...props}){return <a {...props}>{children}</a>}`,
 'next/dynamic':`export default ()=>()=>null`,
 '@/lib/supabase/client':`const channel={on(){return this},subscribe(){return this},presenceState(){return{}},track(){}};const client={channel:()=>channel,removeChannel(){},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};export const createClient=()=>client;`,
};
await build({entryPoints:['scripts/tests/unread-opening/entry.tsx'],outdir:output,bundle:true,jsx:'automatic',format:'iife',define:{'process.env.NODE_ENV':'"test"','process.env':'{}'},loader:{'.woff2':'dataurl'},plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^(next\/link|next\/dynamic|@\/lib\/supabase\/client)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:resolve('scripts/tests')}));}}]});
const member='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',conversation='20000000-0000-4000-8000-000000000001';
const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const dmMessages=Array.from({length:160},(_,i)=>({id:id(i+1),seq:i+1,sender_id:i+1===80?other:member,body:`Message ${i+1} ${'Content '.repeat(8)}`,created_at:'2026-09-21T12:00:00Z',memberships:[]}));
const roomMessages=dmMessages.slice(0,80).map((m,i)=>({...m,unread_seq:i+1,room_slug:'main',guest_id:member,member_id:member,author_label:'Alice',reply_to_id:null,bot_slug:null,body:`Room ${i+1} ${'Content '.repeat(8)}`}));
const server=createServer(async(req,res)=>{const file=req.url==='/entry.js'?'entry.js':req.url==='/entry.css'?'entry.css':null;res.setHeader('Content-Type',file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html');res.end(file?await readFile(join(output,file)):'<html><head><link rel="stylesheet" href="/entry.css"/></head><body><div id="root"></div><script src="/entry.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 for(const width of [1440,390]){
  const page=await browser.newPage();await page.setViewport({width,height:900});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack)});
  const sent=[];
  await page.evaluateOnNewDocument(f=>{window.fixture=f;},{mode:'room',roomMessages});
  await page.setRequestInterception(true);
  page.on('request',async request=>{
   const url=new URL(request.url());if(!url.pathname.startsWith('/api/'))return request.continue();
   const respond=body=>request.respond({status:200,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname==='/api/chat/updates'){const paths=JSON.parse(request.postData()).paths;const results=await page.evaluate(async paths=>Promise.all(paths.map(async path=>{const response=await fetch(path);return {path,status:response.status,data:await response.json()};})),paths);return respond({results});}
   if(url.pathname==='/api/chat/opening')return respond({messageId:null,readThrough:80});
   if(url.pathname==='/api/chat/message-pins'&&request.method()==='GET')return respond({pins:[{messageId:id(10),replyToId:null,memberId:member,authorLabel:'Alice',preview:'Room 10',pinnedAt:'2026-09-21T12:00:00Z',createdAt:'2026-09-21T12:00:00Z'}],canManagePins:false});
   if(url.pathname==='/api/chat/history')return respond({messages:roomMessages,reactions:[],hasMore:false,hasNewer:false});
   if(url.pathname==='/api/chat'&&request.method()==='POST'){const b=JSON.parse(request.postData());if(b.action==='send'){const n=sent.length+1;const m={...roomMessages[79],id:id(900+n),unread_seq:80+n,body:b.body,created_at:new Date().toISOString(),client_id:b.clientId};sent.push(m);return respond({message:m});}return respond({ok:true});}
   if(url.pathname==='/api/chat/activity')return respond({roomCounts:{},roomThrough:{main:0,social:0},roomMessageCounts:{},roomMessageThrough:{main:80},dmCount:0,dmThrough:0,mentionCount:0,mentionThrough:0,dms:[],items:[],mentions:[],replies:[],replyCount:0,reactions:[],reactionCount:0});
   if(url.pathname==='/api/chat/room')return respond({room:{isOpen:true}});
   return respond({counts:{},reactions:[],conversations:[],messages:[],members:[],items:[],pins:[],favorite:null});
  });
  const list='[role="log"]';
  const atBottom=()=>page.$eval(list,n=>n.scrollHeight-n.scrollTop-n.clientHeight<5);
  const inView=sel=>page.$eval(sel,n=>{const b=n.getBoundingClientRect(),p=n.closest('[role="log"]').getBoundingClientRect();return b.bottom>p.top&&b.top<p.bottom;});
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector(`#chat-message-${id(80)}`);await pause(300);
  // 1. A read room opens at the newest message.
  assert.ok(await atBottom(),`${width}: opens at the newest message`);
  // 2. A pin jump brings that message into view and stops following.
  await page.waitForSelector(`[data-pinned-message-id="${id(10)}"]`);
  await page.evaluate(()=>{const li=document.querySelector('[data-pinned-message-id]');const b=li.querySelector('button');b.click();});
  await page.waitForFunction(sel=>{const n=document.querySelector(sel);if(!n)return false;const b=n.getBoundingClientRect(),p=n.closest('[role="log"]').getBoundingClientRect();return b.bottom>p.top&&b.top<p.bottom;},{timeout:5000},`#chat-message-${id(10)}`);
  await pause(300);
  assert.ok(await inView(`#chat-message-${id(10)}`),`${width}: pin target in view`);
  assert.ok(!(await atBottom()),`${width}: pin jump leaves the bottom`);
  // 3. The reader stays put while reading (no drift back to the bottom).
  await pause(600);assert.ok(await inView(`#chat-message-${id(10)}`),`${width}: reader stays on the pin`);
  // 4. Latest returns to the bottom.
  const latest=await page.evaluateHandle(()=>Array.from(document.querySelectorAll('button')).find(b=>/latest|new message|newest|↓/i.test(b.textContent||'')));
  assert.ok(latest.asElement(),`${width}: a Latest control is offered while away from the bottom`);
  await latest.asElement().click();await pause(400);
  assert.ok(await atBottom(),`${width}: Latest returns to the newest message`);
  // 5. Sending at the bottom keeps following, including the new message.
  await page.focus('textarea[aria-label^="Message"]');await page.keyboard.type('Scroll test message');
  await page.evaluate(()=>{const f=document.querySelector('textarea[aria-label^="Message"]').form;f.requestSubmit();});
  await page.waitForSelector(`#chat-message-${id(901)}`);await pause(300);
  assert.ok(await atBottom(),`${width}: still at the bottom after sending`);
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS room scroll ${width}: opens at newest, pin jump, stays while reading, Latest, send keeps following`);
 }
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(output,{recursive:true,force:true});}
