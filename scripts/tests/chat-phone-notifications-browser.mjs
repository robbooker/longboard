// Actual registered chat service worker in Chromium, using synthetic push/click events.
// Native OS display and provider delivery are stubbed: no subscription, permission prompt or network push.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {build} from 'esbuild';
const source=await readFile('public/chat-sw.js','utf8');
const formatter=await build({stdin:{contents:"export {chatPushNotification} from './lib/chatPushPreview';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'notificationFormatter'});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/chat-sw.js'?'text/javascript':'text/html');res.end(req.url==='/chat-sw.js'?source:'<!doctype html><title>Synthetic chat</title><textarea aria-label="Unsent draft"></textarea>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:process.env.CHAT_BROWSER_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
const errors=[],external=[];let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>{if(!r.url().startsWith(base)){external.push(r.url());void r.abort();}else void r.continue();});
 await page.goto(base+'/chat?room=social');await page.type('textarea','Preserve this unsent draft');
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.register('/chat-sw.js',{scope:'/chat'});await navigator.serviceWorker.ready;if(r.active?.state!=='activated')await new Promise(resolve=>{(r.installing||r.waiting||r.active).addEventListener('statechange',event=>{if(event.target.state==='activated')resolve();});});});
 const target=await browser.waitForTarget(t=>t.type()==='service_worker'&&t.url()===base+'/chat-sw.js');const worker=await target.worker();assert.ok(worker);
 await worker.evaluate(formatter.outputFiles[0].text);
 await worker.evaluate(()=>{
  self.shown=[];self.opened=[];self.focused=[];self.closed=0;self.activationRequests=0;
  self.registration.showNotification=async(title,options)=>{self.shown.push({title,...options});};
  self.clients.openWindow=async url=>{self.opened.push(url);};
  self.skipWaiting=async()=>{self.activationRequests++;};
  self.inject=async(type,properties)=>{let work;const event=new Event(type);for(const [key,value]of Object.entries(properties))Object.defineProperty(event,key,{value});Object.defineProperty(event,'waitUntil',{value:p=>{work=p;}});self.dispatchEvent(event);await work;};
 });
 const push=async(input,raw=false)=>worker.evaluate(async(input,raw)=>{const payload=raw?input:{...notificationFormatter.chatPushNotification(input),url:'/chat?room=social&thread=00000000-0000-4000-8000-000000000001',tag:'chat-synthetic'};await self.inject('push',{data:{json:()=>payload}});return self.shown.at(-1);},input,raw);
 for(const preview of ['off','invalid',undefined]){const result=await push({preview,kind:'room',room:'shortscout',category:'reply',sender:'Private sender',body:'Private text',hasAttachments:true});eq(result.title,'Rob Booker Chat');eq(result.body,'You have a new chat notification.');eq(JSON.stringify(result).includes('Private'),false);}
 for(const [input,title,body]of [
  [{preview:'message',kind:'dm',sender:'Luke',body:'DM preview'},'DM - Luke','DM preview'],
  [{preview:'message',kind:'room',room:'social',category:'reply',sender:'Luke',body:'Social preview'},'Social reply - Luke','Social preview'],
  [{preview:'sender',kind:'room',room:'main',category:'mention',sender:'Luke',body:'Secret',hasAttachments:true},'LB mention - Luke','You have a new chat notification.'],
  [{preview:'message',kind:'room',room:'shortscout',category:'mention',sender:'Luke',body:'🦄'.repeat(41)},'SS mention - Luke','🦄'.repeat(39)+'…'],
  [{preview:'message',kind:'dm',sender:'Luke',body:'',hasAttachments:true},'DM - Luke','Sent an attachment.'],
 ]){const result=await push(input);eq(result.title,title);eq(result.body,body);eq(result.icon,'/chat-rb-icon-v1-192.png');eq(result.badge,'/chat-badge.png');eq(result.tag,'chat-synthetic');eq(result.data.url,base+'/chat?room=social&thread=00000000-0000-4000-8000-000000000001');}
 let result=await push({title:'<b>DM</b>\n- **Luke**\u202e',body:'<b>Hello</b>\n[read](https://private.invalid/token)\u202e'},true);eq(result.title,'DM - Luke');eq(result.body,'Hello read');
 result=await push({title:'🦄'.repeat(70),body:'🦄'.repeat(41)},true);eq(Array.from(result.title).length,64);eq(result.body,'🦄'.repeat(39)+'…');
 result=await push({body:'Legacy sender: '+ 'x'.repeat(200)},true);eq(result.title,'Rob Booker Chat');eq(Array.from(result.body).length,40);
 result=await push({title:{private:'wrong type'},body:null,url:'https://evil.invalid/chat'},true);eq(result.title,'Rob Booker Chat');eq(result.body,'You have new chat activity.');eq(result.data.url,base+'/chat');
 result=await worker.evaluate(async()=>{await self.inject('push',{data:{json:()=>{throw Error('malformed');}}});return self.shown.at(-1);});eq(result.title,'Rob Booker Chat');eq(result.body,'You have new chat activity.');
 // Exact matching client is focused; a different chat is opened without navigating any draft.
 await worker.evaluate(()=>{self.clients.matchAll=async()=>[{url:self.location.origin+'/chat?room=social',focus:async()=>{self.focused.push('social');}},{url:self.location.origin+'/chat?dm=existing',focus:async()=>{self.focused.push('existing');}}];});
 const click=async url=>worker.evaluate(async url=>{await self.inject('notificationclick',{notification:{data:{url},close:()=>{self.closed++;}}});return {opened:self.opened,focused:self.focused,closed:self.closed};},url);
 let clicked=await click('/chat?dm=existing');eq(clicked.focused,['existing']);eq(clicked.opened,[]);
 clicked=await click('/chat?dm=new');eq(clicked.opened,[base+'/chat?dm=new']);eq(await page.$eval('textarea',e=>e.value),'Preserve this unsent draft');eq(page.url(),base+'/chat?room=social');
 for(const unsafe of ['https://evil.invalid/chat','/settings','javascript:alert(1)','//evil.invalid/chat']){clicked=await click(unsafe);eq(clicked.opened.at(-1),base+'/chat');}
 eq(clicked.closed,6);eq(await worker.evaluate(()=>self.activationRequests),0);
 eq(errors,[]);eq(external,[]);console.log(`PASS ${checks} actual registered-worker assertions in ${await browser.version()}: prepared formatter -> native title/body invocation, privacy/Unicode/hostile/legacy/malformed inputs, icons/tag/click allowlist, focus-vs-new-window routing and untouched draft, no forced activation or external requests. Synthetic events/native-boundary stubs only; no physical iOS/Android display or real delivery claim.`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
