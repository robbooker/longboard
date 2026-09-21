import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const output=await mkdtemp(join(tmpdir(),'chat-opening-'));
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
 for(const mode of ['dm','room'])for(const width of [1440,390]){
  const page=await browser.newPage();await page.setViewport({width,height:900});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
  let anchor=id(mode==='dm'?80:40),delay=0,openingFinished=false;const reads=[];
  await page.evaluateOnNewDocument(f=>{window.fixture=f;},{mode,roomMessages});
  await page.setRequestInterception(true);
  page.on('request',async request=>{
   const url=new URL(request.url());if(!url.pathname.startsWith('/api/'))return request.continue();
   const respond=body=>request.respond({status:200,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname==='/api/chat/opening'){openingFinished=false;await pause(delay);openingFinished=true;return respond({messageId:anchor,readThrough:80});}
   if(url.pathname==='/api/chat/inbox'){
    if(request.method()==='POST'){const body=JSON.parse(request.postData());if(body.action==='read')reads.push({...body,openingFinished});return respond({ok:true});}
    if(!url.searchParams.has('conversation'))return respond({conversations:[{id:conversation,status:'accepted',incoming:false,otherId:other,otherName:'Bob',blockedByMe:false,unavailable:false,lastBody:'Hello',updatedAt:'2026-09-21T12:00:00Z',unread:1}]});
    if(url.searchParams.has('around'))return respond({messages:dmMessages.slice(54,105),hasMore:true,hasNewer:true});
    if(url.searchParams.has('after')){const start=Number(url.searchParams.get('after'));return respond({messages:dmMessages.slice(start,start+50),hasNewer:start+50<160});}
    if(url.searchParams.has('ids'))return respond({messages:dmMessages.filter(m=>url.searchParams.get('ids').split(',').includes(m.id))});
    return respond({messages:dmMessages.slice(-50),hasMore:true});
   }
   if(url.pathname==='/api/chat/history')return respond({messages:roomMessages.map(m=>({...m,room_slug:url.searchParams.get('room')})),reactions:[]});
   if(url.pathname==='/api/chat/room')return respond({room:{isOpen:true}});
   if(url.pathname==='/api/chat/activity'){if(request.method()==='POST')reads.push(JSON.parse(request.postData()));return respond({roomCounts:{},roomThrough:{main:0,social:0},roomMessageCounts:{main:1},roomMessageThrough:{main:160},dmCount:0,dmThrough:0,mentionCount:0,mentionThrough:0,dms:[],items:[],mentions:[],replies:[],replyCount:0});}
   if(url.pathname==='/api/chat/bootstrap')return respond({accountId:'account',room:url.searchParams.get('room'),member:{id:member,display_name:'Alice',accepts_requests:true},roomState:{isOpen:true},messages:roomMessages,reactions:[],counts:{}});
   return respond({counts:{},reactions:[],conversations:[],messages:[],members:[],items:[]});
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  if(mode==='room'){
   await page.waitForSelector(`#chat-message-${id(40)}`);await pause(300);
   const distance=await page.$eval(`#chat-message-${id(40)}`,n=>n.getBoundingClientRect().top-n.parentElement.getBoundingClientRect().top);
   assert.ok(Math.abs(distance)<5,`Room unread target ${width}: ${distance}`);
   assert.ok(reads.every(r=>!r.roomThrough||r.roomThrough<=80),'room prematurely marked newer history read');
   // A normal room switch and return ignores the stale cached scroll snapshot.
   anchor=null;
   await page.evaluate(()=>document.querySelector('a[href="/chat?room=social"]').click());await pause(150);
   await page.evaluate(()=>document.querySelector('a[href="/chat?room=main"]').click());await pause(250);
   assert.ok(await page.$eval(`#chat-message-${id(80)}`,n=>{const p=n.parentElement;return p.scrollHeight-p.scrollTop-p.clientHeight<5;}),'cached room reopen latest');assert.ok(reads.every(r=>!r.roomThrough||r.roomThrough<=80),'activity ahead of loaded room history was marked read');
   // A notification deep link takes precedence over automatic opening.
   await page.goto(`http://127.0.0.1:${port}/#chat-message-${id(10)}`);await page.waitForSelector(`#chat-message-${id(10)}`);await pause(200);
   const visible=await page.$eval(`#chat-message-${id(10)}`,n=>{const b=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect();return b.bottom>p.top&&b.top<p.bottom;});assert.ok(visible,'explicit room deep link');
   assert.deepEqual(errors,[]);await page.close();console.log(`PASS room ${width}: newest unread, read boundary, cached reopen, explicit deep link`);continue;
  }
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Bob')));
  const clickText=async text=>page.evaluate(t=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(t));if(!b)throw Error('No button '+t);b.click();},text);
  await clickText('Bob');await page.waitForSelector(`[data-message-id="${id(80)}"]`);await pause(100);
  const top=await page.$eval(`[data-message-id="${id(80)}"]`,n=>n.getBoundingClientRect().top-n.parentElement.getBoundingClientRect().top);
  assert.ok(Math.abs(top)<5,`DM unread target ${width}: ${top}`);
  assert.ok(reads.every(r=>r.openingFinished!==false),'read before snapshot');assert.ok(reads.filter(r=>r.clientId).every(r=>Number(r.clientId.split('-').at(-1))<106),'unseen newer read');
  await clickText('Load newer messages');await page.waitForSelector(`[data-message-id="${id(155)}"]`);await clickText('Load newer messages');await page.waitForSelector(`[data-message-id="${id(160)}"]`);
  const seqs=await page.$$eval('[data-message-id]',nodes=>nodes.map(n=>Number(n.dataset.messageId.split('-').at(-1))));assert.deepEqual(seqs,Array.from({length:106},(_,i)=>55+i));
  // Cached scroll must not win on reopening a read conversation.
  await page.$eval('[data-message-id]',n=>{n.parentElement.scrollTop=0;});await page.$eval('[aria-label="Private conversation"]',n=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await page.waitForFunction(()=>!document.querySelector('[aria-label="Private conversation"]'));anchor=null;await clickText('Bob');await pause(150);
  assert.ok(await page.$eval('[data-message-id]',n=>{const p=n.parentElement;return p.scrollHeight-p.scrollTop-p.clientHeight<5;}),'cached DM reopen latest');
  // Slow opening must not move a user who has already scrolled.
  await page.$eval('[aria-label="Private conversation"]',n=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await page.waitForFunction(()=>!document.querySelector('[aria-label="Private conversation"]'));anchor=id(80);delay=200;await clickText('Bob');await page.$eval('[data-message-id]',n=>{n.parentElement.dispatchEvent(new WheelEvent('wheel',{bubbles:true}));n.parentElement.scrollTop=0;});await pause(300);
  assert.ok(await page.$eval('[data-message-id]',n=>n.parentElement.scrollTop<5),'user input cancels delayed opening');
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS DM ${width}: snapshot before read, latest unread, gap paging, cached reopen, user scroll`);
 }
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(output,{recursive:true,force:true});}
