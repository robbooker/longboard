// Actual notification bell and CSS with synthetic activity and read transport.
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),port=Number(process.env.CHAT_TEST_PORT||3353);
const data={mentionCount:2,dmCount:3,reactionCount:4,mentionThrough:20,dmThrough:30,reactionThrough:40,replyNotifications:true,roomCounts:{main:2},roomThrough:{main:20},roomMessageCounts:{},roomMessageThrough:{},
 mentions:[{id:'reply',seq:20,messageId:'reply-message',room:'main',author:'Alice',category:'reply',preview:'A complete message with useful details. '.repeat(15),parentPreview:'Earlier conversation context with details. '.repeat(5),createdAt:'2026-10-01'},
 {id:'mention',seq:19,messageId:'mention-message',room:'shortscout',author:'<script>window.injected=true</script>',category:'mention',preview:'界'.repeat(240),createdAt:'2026-10-01'}],
 dms:[{id:'conversation',name:'Carol',unread:3,throughSeq:30,pending:false,messageId:'private-message',preview:'A private preview that is visible in the bell.',createdAt:'2026-10-01'}],
 reactions:[{id:'palm',seq:40,kind:'room',room:'main',messageId:'target-palm',author:'Bob',emoji:'like',preview:'My message reacted to with a palm.',createdAt:'2026-10-01'},
 {id:'lemon',seq:39,kind:'room',room:'shortscout',messageId:'target-lemon',author:'Dave',emoji:'like',preview:'My ShortScout message.',createdAt:'2026-10-01'},
 {id:'thumb',seq:38,kind:'dm',conversationId:'conversation',messageId:'target-thumb',author:'Carol',emoji:'like',preview:'The private reacted-to message.',createdAt:'2026-10-01'},
 {id:'rob',seq:37,kind:'room',room:'social',messageId:'target-rob',author:'Erin',emoji:'rob',preview:'My social message.',createdAt:'2026-10-01'}]};
const source=`import React from 'react';import{createRoot}from'react-dom/client';import Bell from './components/chat/ChatActivityBell';const data=${JSON.stringify(data)};window.reads=[];window.dmOpens=[];window.addEventListener('chat-open-dm',e=>window.dmOpens.push(e.detail));createRoot(document.getElementById('root')).render(<Bell data={data} error="" read={async body=>{window.reads.push(body);if(window.failRead)throw Error('Please try again');}}/>);`;
const output=await build({stdin:{contents:source,loader:'tsx',resolveDir:root},bundle:true,write:false,outdir:resolve(root,'.notification-fixture'),jsx:'automatic',alias:{'@':root},loader:{'.module.css':'local-css'},define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
const js=output.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=output.outputFiles.find(f=>f.path.endsWith('.css')).contents,rob=await readFile('public/chat/reactions/rob.png');
const server=createServer((req,res)=>{if(req.url.startsWith('/_next/image')){res.setHeader('Content-Type','image/png');res.end(rob);return;}res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/bundle.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?js:req.url==='/bundle.css'?css:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>:root{--chat-line:#bcc8c0;--chat-panel:#fff;--chat-text:#172d24;--chat-muted:#586960;--chat-accent:#6cd29f}body{margin:14px;font:14px system-ui;background:#edf3ef}#root{display:flex;justify-content:flex-end}</style><div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const panel='section[aria-label="Chat notifications"]';
async function open(){await page.click('button[aria-label^="Chat notifications,"]');await page.waitForSelector(panel);}
async function clickText(text,scope=panel){const buttons=await page.$$(scope+' button');for(const button of buttons)if(await button.evaluate((e,t)=>e.textContent===t,text)){await button.click();return;}throw Error('Missing button '+text);}
try{
 for(const width of [320,390,1100]){
  await page.setViewport({width,height:844,isMobile:width<500,hasTouch:width<500});await page.goto(`http://127.0.0.1:${port}`);await open();
  assert.equal(await page.evaluate(()=>window.reads.length),0,'opening does not mark anything read');
  assert(await page.$eval(panel,e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth;}),'panel fits viewport');
  const rows=await page.$$eval(panel+' article',nodes=>nodes.map(n=>({title:n.querySelector('strong').textContent,parts:[...n.querySelector('button').children].map(c=>({text:c.textContent,style:getComputedStyle(c).fontStyle,clamp:getComputedStyle(c).webkitLineClamp,height:c.getBoundingClientRect().height,line:parseFloat(getComputedStyle(c).lineHeight)}))})));
  const reply=rows.find(n=>n.title.startsWith('LB – Alice – replied')),mention=rows.find(n=>n.title.startsWith('SS – <script>')),dm=rows.find(n=>n.title.startsWith('DM – Carol – sent a message')),palm=rows.find(n=>n.title.startsWith('LB – Bob – reacted')),lemon=rows.find(n=>n.title.startsWith('SS – Dave – reacted')),thumb=rows.find(n=>n.title.startsWith('DM – Carol – reacted')),rob=rows.find(n=>n.title.startsWith('SOC – Erin – reacted'));assert(reply&&mention&&dm&&palm&&lemon&&thumb&&rob);
  assert.equal(reply.parts[1].clamp,'5');assert(reply.parts[1].height<=5*reply.parts[1].line+1);assert.equal(reply.parts.at(-1).style,'italic');assert(reply.parts.at(-1).text.startsWith('Reply to:'));
  assert(palm.title.includes('🌴'));assert(lemon.title.includes('🍋'));assert(thumb.title.includes('👍'));assert(rob.title.includes('Rob'));
  assert(thumb.parts[1].text.includes('private reacted-to'));assert.equal(thumb.parts.at(-1).style,'italic');assert.equal(await page.evaluate(()=>window.injected),undefined);
  await page.waitForFunction(()=>[...document.querySelectorAll('section img')].every(i=>i.complete&&i.naturalWidth));
  await page.screenshot({path:`/tmp/notification-formatting-${width}.png`});
  await page.$eval(panel,e=>e.scrollTop=e.scrollHeight);await page.screenshot({path:`/tmp/notification-formatting-reactions-${width}.png`});
  await page.keyboard.press('Escape');await page.waitForSelector(panel,{hidden:true});assert(await page.$eval('button[aria-label^="Chat notifications,"]',e=>e===document.activeElement));
  await open();await clickText('Mark all as read');assert.deepEqual(await page.evaluate(()=>window.reads.at(-1)),{kind:'all',mentionThrough:20,dmThrough:30,reactionThrough:40});
  await page.$$eval(panel+' article',nodes=>nodes.find(n=>n.querySelector('strong').textContent.startsWith('LB – Bob – reacted')).querySelectorAll('button')[1].click());await page.waitForFunction(()=>window.reads.at(-1)?.kind==='reaction');assert.deepEqual(await page.evaluate(()=>window.reads.at(-1)),{kind:'reaction',id:'palm',reactionThrough:40});
  await page.evaluate(()=>window.failRead=true);await clickText('Mark all as read');await page.waitForSelector(panel+' [role="alert"]');assert(await page.$(panel));await page.evaluate(()=>window.failRead=false);
  await page.$$eval(panel+' article',nodes=>nodes.find(n=>n.querySelector('strong').textContent.startsWith('DM – Carol – reacted')).querySelector('button').click());await page.waitForFunction(()=>window.dmOpens.length===1);assert.deepEqual(await page.evaluate(()=>window.reads.at(-1)),{kind:'reaction',id:'thumb',reactionThrough:38});assert.equal(await page.evaluate(()=>window.dmOpens[0]),'conversation');
  console.log(`PASS ${width}px: location/name/action, five-line preview, context last/italic, actual reaction icons, DM previews, safe text, read boundaries, close/focus/error and scoped navigation.`);
 }
 assert.deepEqual(errors,[]);assert(requests.every(url=>url.startsWith(`http://127.0.0.1:${port}/`)),'no external preview or per-row requests');
}finally{await browser.close();await new Promise(r=>server.close(r));}
