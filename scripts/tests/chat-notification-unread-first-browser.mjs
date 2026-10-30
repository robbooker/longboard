// D-327: unread notifications sit at the top of the bell, read ones below, each group in time order.
// A row read while the bell is open (opened or marked read) keeps its place until the person leaves
// the list (closes it, or navigates away and back). Actual bell and CSS, synthetic data, no network.
// Reads are kept in sessionStorage so a real page navigation comes back with them. SHOTS=dir saves screenshots.
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),panel='section[aria-label="Chat notifications"]',shots=process.env.SHOTS;
const room=(id,preview,minute,read=false)=>({id,preview,createdAt:`2026-10-22T14:${String(minute).padStart(2,'0')}:00Z`,read,seq:12,messageId:id,room:'main',author:'Alice'});
const dm=(id,name,preview,minute,unread=1)=>({id,preview,createdAt:`2026-10-22T14:${String(minute).padStart(2,'0')}:00Z`,unread,throughSeq:7,pending:false,name});
const reaction=(id,preview,minute,read=false)=>({id,preview,createdAt:`2026-10-22T14:${String(minute).padStart(2,'0')}:00Z`,read,seq:20,kind:'room',room:'main',messageId:id,author:'Carol',emoji:'heart'});
const data={mentionCount:3,dmCount:2,reactionCount:1,mentionThrough:20,dmThrough:30,reactionThrough:40,replyNotifications:true,roomCounts:{main:3},roomThrough:{main:20},roomMessageCounts:{main:5},roomMessageThrough:{main:6},pinnedDmUnread:{},
 mentions:[room('m-read-new','Read: newest room alert',9,true),room('m-unread','SPHL borrow is back at TZ',8),room('m-read-mid','Read: earlier room alert',5,true),room('m-unread-old','Anyone in OLOX?',1)],
 dms:[dm('d-unread','JimD','Did you see the gap?',7,2),dm('d-read','Theresa','Read: thanks!',6,0)],
 reactions:[reaction('r-unread','.25 on Cobra means $45 on TZ',4),reaction('r-read','Read: reaction',2,true),reaction('r-unread-old','Older reaction, unread',0)]};
// Today's (time) order, then the unread-first order this ticket adds.
const chronological=['Read: newest room alert','SPHL borrow is back at TZ','Did you see the gap?','Read: thanks!','Read: earlier room alert','.25 on Cobra means $45 on TZ','Read: reaction','Anyone in OLOX?','Older reaction, unread'];
const unreadFirst=['SPHL borrow is back at TZ','Did you see the gap?','.25 on Cobra means $45 on TZ','Anyone in OLOX?','Older reaction, unread','Read: newest room alert','Read: thanks!','Read: earlier room alert','Read: reaction'];
const source=`import React from 'react';import{createRoot}from'react-dom/client';import Bell from './components/chat/ChatActivityBell';
const initial=${JSON.stringify(data)};const reads=JSON.parse(sessionStorage.getItem('reads')||'[]');
const apply=(data,body)=>body.kind==='mention'?{...data,mentionCount:data.mentionCount-1,mentions:data.mentions.map(n=>n.id===body.id?{...n,read:true}:n)}:body.kind==='reaction'?{...data,reactionCount:data.reactionCount-1,reactions:data.reactions.map(n=>n.id===body.id?{...n,read:true}:n)}:body.kind==='dm'?{...data,dmCount:data.dmCount-1,dms:data.dms.map(n=>n.id===body.id?{...n,unread:0}:n)}:body.kind==='all'?{...data,mentionCount:0,dmCount:0,reactionCount:0,mentions:data.mentions.map(n=>({...n,read:true})),dms:data.dms.map(n=>({...n,unread:0})),reactions:data.reactions.map(n=>({...n,read:true}))}:data;
let data=reads.reduce(apply,initial);const root=createRoot(document.getElementById('root'));window.reads=reads;window.dmOpens=[];window.addEventListener('chat-open-dm',e=>window.dmOpens.push(e.detail));window.replaceData=next=>{data=next;render();};
const read=async body=>{reads.push(body);sessionStorage.setItem('reads',JSON.stringify(reads));data=apply(data,body);render();};
function render(){root.render(<Bell data={data} error="" read={read}/>);}render();`;
const output=await build({stdin:{contents:source,loader:'tsx',resolveDir:root},bundle:true,write:false,outdir:resolve(root,'.notification-unread-first-fixture'),jsx:'automatic',alias:{'@':root},loader:{'.module.css':'local-css'},define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
const js=output.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=output.outputFiles.find(f=>f.path.endsWith('.css')).contents;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/bundle.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?js:req.url==='/bundle.css'?css:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>:root{--chat-line:#bcc8c0;--chat-panel:#fff;--chat-text:#172d24;--chat-muted:#586960;--chat-palm:#238048;--chat-palm-soft:#23804820}body{margin:14px;font:14px system-ui}#root{display:flex;justify-content:flex-end}</style><div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:process.env.CHAT_BROWSER_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']}),page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const rows=()=>page.$$eval(panel+' article',nodes=>nodes.map(n=>({preview:n.querySelector('button > span').textContent,unread:n.dataset.unread})));
const previews=async()=>(await rows()).map(r=>r.preview);
async function open(){await page.click('button[aria-label^="Chat notifications,"]');await page.waitForSelector(panel+' article');}
async function close(){await page.click('button[aria-label="Close chat notifications"]');await page.waitForSelector(panel,{hidden:true});}
async function rowButton(preview,mark=false){for(const row of await page.$$(panel+' article'))if(await row.evaluate((e,text)=>e.querySelector('button > span').textContent===text,preview)){const button=await row.$(mark?'button:last-child':'button');await button.click();return;}throw Error('Missing '+preview);}
const waitRead=preview=>page.waitForFunction((panel,text)=>[...document.querySelectorAll(panel+' article')].find(n=>n.querySelector('button > span').textContent===text)?.dataset.unread==='false',{},panel,preview);
async function filter(label){for(const b of await page.$$(panel+' [role="group"] button'))if(await b.evaluate((e,l)=>e.getAttribute('aria-label').startsWith(l+','),label)){await b.click();return;}throw Error('Missing filter '+label);}
const shot=async name=>{if(shots)await page.screenshot({path:`${shots}/${name}.png`,fullPage:true});};
try{
 for(const [width,name]of [[1440,'desktop'],[390,'phone']]){
  await page.setViewport({width,height:1100,isMobile:width<500,hasTouch:width<500});await page.goto(base);await page.evaluate(()=>sessionStorage.clear());await page.goto(base);await open();
  // 1-3: every unread row above every read row; each group in today's order.
  assert.deepEqual(await previews(),unreadFirst);const states=(await rows()).map(r=>r.unread);assert.equal(states.lastIndexOf('true'),4);assert.equal(states.indexOf('false'),5);
  const fit=await page.$eval(panel,e=>{const r=e.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right};});assert(fit.left>=0&&fit.right<=fit.width,JSON.stringify(fit));await shot(`after-${name}`);
  // Filters keep the same rule.
  await filter('Room alerts');assert.deepEqual(await previews(),['SPHL borrow is back at TZ','Anyone in OLOX?','Read: newest room alert','Read: earlier room alert']);await filter('Reactions');assert.deepEqual(await previews(),['.25 on Cobra means $45 on TZ','Older reaction, unread','Read: reaction']);await filter('All');
  // 4: mark as read without opening; the row turns read but stays put while the bell is open.
  await rowButton('Anyone in OLOX?',true);await waitRead('Anyone in OLOX?');assert.deepEqual(await previews(),unreadFirst);await shot(`just-read-stays-${name}`);
  // Close and reopen: it moves to its time place among the read rows.
  await close();await open();assert.deepEqual(await previews(),['SPHL borrow is back at TZ','Did you see the gap?','.25 on Cobra means $45 on TZ','Older reaction, unread','Read: newest room alert','Read: thanks!','Read: earlier room alert','Read: reaction','Anyone in OLOX?']);
  // 4: opening an unread DM marks it read and leaves the list; back in the bell it sits among the read rows.
  await rowButton('Did you see the gap?');await page.waitForSelector(panel,{hidden:true});assert.equal(await page.evaluate(()=>window.dmOpens.at(-1)),'d-unread');await open();
  assert.deepEqual(await previews(),['SPHL borrow is back at TZ','.25 on Cobra means $45 on TZ','Older reaction, unread','Read: newest room alert','Did you see the gap?','Read: thanks!','Read: earlier room alert','Read: reaction','Anyone in OLOX?']);
  // 4: opening an unread room alert navigates away (a real page load); coming back shows it in its read place.
  await Promise.all([page.waitForNavigation(),rowButton('SPHL borrow is back at TZ')]);assert.equal(new URL(page.url()).search,'?room=main');await page.goto(base);await open();
  assert.deepEqual(await previews(),['.25 on Cobra means $45 on TZ','Older reaction, unread','Read: newest room alert','SPHL borrow is back at TZ','Did you see the gap?','Read: thanks!','Read: earlier room alert','Read: reaction','Anyone in OLOX?']);
  // Mark all as read: nothing moves while open; reopened with no unread, the list is exactly today's order.
  const held=await previews();for(const b of await page.$$(panel+' button'))if(await b.evaluate(e=>e.textContent==='Mark all as read'))await b.click();await page.waitForFunction(panel=>![...document.querySelectorAll(panel+' article')].some(n=>n.dataset.unread==='true'),{},panel);assert.deepEqual(await previews(),held);
  await close();await open();assert.deepEqual(await previews(),chronological);
  // A notification arriving unread while the bell is open joins the unread rows at the top.
  await page.evaluate(data=>window.replaceData({...data,mentions:[{...data.mentions[0],id:'m-arrived',preview:'Just arrived',createdAt:'2026-10-22T14:30:00Z',read:false},...data.mentions.map(n=>({...n,read:true}))],dms:data.dms.map(n=>({...n,unread:0})),reactions:data.reactions.map(n=>({...n,read:true}))}),data);await page.waitForFunction(panel=>document.querySelector(panel+' article button > span').textContent==='Just arrived',{},panel);assert.deepEqual(await previews(),['Just arrived',...chronological]);
  console.log(`PASS ${width}px actual bell: unread first, both groups in time order, filters, mark-as-read and opened rows hold their place while open, re-sorted after close/reopen, DM open and page navigation, mark-all, no-unread list unchanged, live arrival.`);
 }
 assert.deepEqual(errors,[]);assert(requests.every(url=>url.startsWith(base+'/')));console.log('PASS zero browser errors and no remote requests.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
