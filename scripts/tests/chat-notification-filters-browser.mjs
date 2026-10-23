// #294: the bell's room alert, unread DM and reaction counts filter the list. Actual bell and CSS,
// synthetic data, no network. SHOTS=dir saves screenshots (light/dark, desktop/phone).
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=process.env.BELL_ROOT||process.cwd(),panel='section[aria-label="Chat notifications"]',shots=process.env.SHOTS;
const room=(id,preview,createdAt,read=false)=>({id,preview,createdAt,read,seq:12,messageId:id,room:'main',author:'Alice'});
const dm=(id,name,preview,createdAt,unread=1)=>({id,preview,createdAt,unread,throughSeq:7,pending:false,name});
const reaction=(id,preview,createdAt,read=false)=>({id,preview,createdAt,read,seq:20,kind:'room',room:'main',messageId:id,author:'Carol',emoji:'heart'});
const data={mentionCount:2,dmCount:3,reactionCount:1,mentionThrough:20,dmThrough:30,reactionThrough:40,replyNotifications:true,roomCounts:{main:2},roomThrough:{main:20},roomMessageCounts:{main:5},roomMessageThrough:{main:6},pinnedDmUnread:{},
 mentions:[room('m1','SPHL borrow is back at TZ','2026-10-22T14:05:00Z'),room('m2','Anyone in OLOX?','2026-10-22T13:01:00Z')],
 dms:[dm('d1','JimD','Did you see the gap?','2026-10-22T14:04:00Z',2),dm('d2','Theresa','Thanks!','2026-10-22T12:03:00Z',1)],
 reactions:[reaction('r1','.25 on Cobra means $45 on TZ','2026-10-22T14:03:00Z')]};
const source=`import React from 'react';import{createRoot}from'react-dom/client';import Bell from './components/chat/ChatActivityBell';let data=${JSON.stringify(data)};const root=createRoot(document.getElementById('root'));window.replaceData=next=>{data=next;render();};const read=async()=>{};function render(){root.render(<Bell data={data} error="" read={read}/>);}render();`;
const output=await build({stdin:{contents:source,loader:'tsx',resolveDir:root},bundle:true,write:false,outdir:resolve(root,'.notification-filters-fixture'),jsx:'automatic',alias:{'@':root},loader:{'.module.css':'local-css'},define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'error'});
const js=output.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=output.outputFiles.find(f=>f.path.endsWith('.css')).contents;
const page$=`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>:root{--chat-line:#e3c9d0;--chat-panel:#fff;--chat-text:#2a1a20;--chat-muted:#7a5e66;--chat-palm:#a52c50;--chat-palm-soft:#a52c501a;--chat-bg:#fbeef2}@media(prefers-color-scheme:dark){:root{--chat-line:#4a3038;--chat-panel:#201216;--chat-text:#f4e6ea;--chat-muted:#b89aa3;--chat-palm:#ff839f;--chat-palm-soft:#ff839f22;--chat-bg:#160c0f}}body{margin:14px;font:14px system-ui;background:var(--chat-bg);min-height:640px}#root{display:flex;justify-content:flex-end}</style><div id="root"></div><script src="/bundle.js"></script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/bundle.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?js:req.url==='/bundle.css'?css:page$);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const previews=p=>p.$$eval(panel+' article',nodes=>nodes.map(n=>n.querySelector('button > span').textContent));
const filter=(p,label)=>p.evaluate((panel,label)=>[...document.querySelectorAll(panel+' [role="group"] button')].find(b=>b.getAttribute('aria-label').startsWith(label+',')).click(),panel,label);
const pressed=p=>p.$$eval(panel+' [role="group"] button[aria-pressed="true"]',b=>b.map(x=>x.getAttribute('aria-label')));
const open=async p=>{await p.click('button[aria-label^="Chat notifications,"]');await p.waitForSelector(panel);};
try{
 for(const [width,dark] of [[1280,false],[390,false],[1280,true],[390,true]]){
  const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.setViewport({width,height:760,isMobile:width<500,hasTouch:width<500});await p.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'}]);
  await p.goto(base);await open(p);
  const tag=`${width<500?'phone':'desktop'}-${dark?'dark':'light'}`;
  if(shots)await p.screenshot({path:`${shots}/${tag}-all.png`});
  if(process.env.BELL_ROOT){await p.close();continue;}// "before" screenshots only
  assert.deepEqual(await pressed(p),['All, 6'],'All is selected when the bell opens');
  assert.equal((await previews(p)).length,5);
  await filter(p,'Reactions');assert.deepEqual(await previews(p),['.25 on Cobra means $45 on TZ']);assert.deepEqual(await pressed(p),['Reactions, 1']);
  if(shots)await p.screenshot({path:`${shots}/${tag}-reactions.png`});
  await filter(p,'Room alerts');assert.deepEqual(await previews(p),['SPHL borrow is back at TZ','Anyone in OLOX?']);
  await filter(p,'Unread DMs');assert.deepEqual(await previews(p),['Did you see the gap?','Thanks!']);
  // Counts stay the same whichever filter is on.
  assert.deepEqual(await p.$$eval(panel+' [role="group"] button',b=>b.map(x=>x.getAttribute('aria-label'))),['All, 6','Room alerts, 2','Unread DMs, 3','Reactions, 1']);
  await filter(p,'All');assert.equal((await previews(p)).length,5);
  // Reopening the bell goes back to All.
  await filter(p,'Reactions');await p.keyboard.press('Escape');await p.waitForSelector(panel,{hidden:true});await open(p);assert.deepEqual(await pressed(p),['All, 6']);
  // An empty type shows a message instead of a blank list, and only that type's message.
  await p.evaluate(d=>window.replaceData({...d,reactions:[],reactionCount:0}),data);await filter(p,'Reactions');
  assert.deepEqual(await previews(p),[]);const text=await p.$eval(panel,e=>e.innerText);assert.match(text,/No recent reaction alerts\./);assert.doesNotMatch(text,/room alerts\.|direct messages\./);
  if(shots)await p.screenshot({path:`${shots}/${tag}-empty.png`});
  // The pressed filter is visibly different, and nothing overflows the phone.
  const look=await p.$$eval(panel+' [role="group"] button',b=>b.map(x=>getComputedStyle(x).backgroundColor));assert.notEqual(look[3],look[0]);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.close();
 }
 assert.deepEqual(errors,[]);
 if(!process.env.BELL_ROOT)console.log('PASS bell filters: All by default and on reopen, each type alone with its button highlighted, counts unchanged by filter, empty type message, desktop and phone in light and dark');
}finally{await browser.close();server.close();}
