// #383 News Feed: the actual PublicChat, SixChat and the real /api/chat/news/feed route (bundled
// for Node, sign-in and database stubbed) against the fake Polygon in chat-news-feed-fixture.mjs.
// No live calls: every Polygon address is answered in this process.
//
// Checks: the News Feed row sits right under Gainers Table and opens the feed; today's gainers'
// headlines come first (marked, with their ticker chips highlighted), then the market, newest first,
// with relative times; links open in a new tab with rel="noopener noreferrer"; the filter chips
// (All / Gainers only / one ticker) narrow the list; /chat?page=news-feed opens it directly; a
// refresh at the top puts new headlines in at once, while scrolled down the list stays still and a
// "N new" pill shows them on tap; a phone (390px) has no sideways scroll; a member without Gainers
// sees no row and the route refuses them; a Six view card shows the feed and is offered in the picker.
//
// Usage: node scripts/tests/chat-news-feed-browser.mjs [--shots <dir>]
//   --shots writes t383-desktop.png, t383-phone.png and t383-six.png into <dir>.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer';
import {addArticle,installPolygonNewsStub,polygonReads} from './chat-news-feed-fixture.mjs';
const args=process.argv.slice(2),shots=args.includes('--shots')?args[args.indexOf('--shots')+1]:null;
const root=new URL('../../',import.meta.url).pathname,dir=join(root,'node_modules','.cache',`news-feed-test-${process.pid}`);
await mkdir(dir,{recursive:true});
installPolygonNewsStub();
process.env.POLYGON_API_KEY='synthetic-polygon-key-never-a-real-one';

// The real route, with sign-in and the gainers list stubbed. Written under node_modules so `next` resolves.
globalThis.__newsTest={gainers:['ABCD','WXYZ'],access:{longboard:true,shortscout:true,admin:false}};
await build({stdin:{contents:`export {GET} from './app/api/chat/news/feed/route';export {resetNewsCache} from './lib/chatNewsPolygon';`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:join(dir,'route.mjs'),alias:{'@':root},external:['next','next/*'],plugins:[{name:'route-stubs',setup(b){
 b.onResolve({filter:/^next\/server$/},()=>({path:'next/server.js',external:true}));
 b.onResolve({filter:/^@\/lib\/(chatAuth|chatAdmin)$/},a=>({path:a.path,namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({loader:'ts',contents:a.path.endsWith('chatAuth')
  ?`export async function requireChatUser(){return {ok:true,user:{id:'test-account'},access:globalThis.__newsTest.access};}`
  :`export function createChatAdminClient(){return {rpc:async()=>({data:globalThis.__newsTest.gainers.map(ticker=>({ticker})),error:null})};}`}));
}}]});
const route=await import(join(dir,'route.mjs'));

const member={id:'11111111-1111-4111-8111-111111111111',display_name:'Alice',accepts_requests:true};
const roomState={isOpen:true,notice:null,pausedAt:null,updatedAt:new Date().toISOString()};
let rooms=['main','social','shortscout','gainers'];
const messages=Object.fromEntries(['main','social','shortscout','gainers'].map(room=>[room,[{id:randomUUID(),room_slug:room,member_id:null,guest_id:null,author_label:'Bob',body:`Welcome to ${room}`,created_at:new Date(Date.now()-60000).toISOString(),unread_seq:1}]]));
const bootstrap={accountId:'test-account',room:'main',member,roomState,messages:[],reactions:[],counts:{},featureChannel:false};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import PublicChat from './components/chat/PublicChat';import SixChat from './components/chat/SixChat';
const rooms=JSON.parse(new URLSearchParams(location.search).get('rooms')||'null')||${JSON.stringify(rooms)};
const props={accountId:'test-account',bootstrap:${JSON.stringify(bootstrap)},allowedRooms:rooms,serverSession:false,room:'main',fontVariableClass:'',appVersion:'test'};
createRoot(document.getElementById('root')).render(location.pathname==='/chat/six'?<SixChat {...props} popout/>:<PublicChat {...props} popout={false}/>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:join(dir,'bundle.js'),alias:{'@':root},loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'test-platform',setup(b){
 b.onResolve({filter:/^(next\/(link|image|dynamic|navigation)|@\/lib\/supabase\/client)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'tsx',resolveDir:root,contents:a.path==='next/dynamic'?`import React from 'react';export default function dynamic(load){const C=React.lazy(load);return props=><React.Suspense fallback={<p>Loading…</p>}><C {...props}/></React.Suspense>;}`:a.path==='next/navigation'?`export const useRouter=()=>({push:url=>location.href=url,refresh:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;`:a.path.includes('supabase')?`export function createClient(){const channel={on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},track:async()=>{},presenceState:()=>({})};return {channel:()=>channel,removeChannel:()=>{},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}`:`import React from 'react';export default function Component({children,unoptimized,fill,priority,scroll,prefetch,...props}){return React.createElement(${a.path==='next/link'?"'a'":"'img'"},props,children);}`}));
}}]});
const activity={mentions:[],dms:[],mentionCount:0,dmCount:0,mentionThrough:0,dmThrough:0,roomCounts:{},roomThrough:{},roomMessageCounts:{},roomMessageThrough:{}};
let saved=[{type:'news',source:''},{type:'gainers-table',source:''},{type:'room',source:'main'},null,null,null];
function read(path){const u=new URL(path,'http://localhost');const room=u.searchParams.get('room')||'main';
 if(u.pathname==='/api/chat/quad-options')return {accountId:'test-account',rooms,conversations:[],gainersTable:rooms.includes('gainers')};
 if(u.pathname==='/api/chat/history')return {messages:messages[room]||[],reactions:[],hasMore:false};
 if(u.pathname==='/api/chat/thread-counts')return {counts:{}};
 if(u.pathname==='/api/chat/opening')return {messageId:null,readThrough:0};
 if(u.pathname==='/api/chat/inbox')return {conversations:[],summaries:[]};
 if(u.pathname==='/api/chat/activity')return activity;
 if(u.pathname==='/api/chat')return roomState;
 if(u.pathname==='/api/chat/app-version')return {version:'test'};
 if(u.pathname==='/api/chat/pins')return {pins:[]};
 if(u.pathname==='/api/chat/pages')return {pages:[],canManage:false,suggestions:[],waiting:[]};
 if(u.pathname==='/api/chat/members')return {members:[]};
 if(u.pathname==='/api/chat/gainers/table')return {day:'2026-11-08',rows:[]};
 return {};
}
const server=createServer(async(req,res)=>{
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.url.startsWith('/chat')&&!req.url.startsWith('/chat-sw')){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script>');}
 if(['/bundle.js','/bundle.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');return res.end(await readFile(join(dir,req.url.slice(1))));}
 if(req.url==='/chat-sw.js'){res.setHeader('Content-Type','text/javascript');return res.end('');}
 if(req.url.startsWith('/api/chat/news/feed')){const r=await route.GET(new Request('http://127.0.0.1'+req.url));res.writeHead(r.status,{'Content-Type':'application/json'});return res.end(await r.text());}
 if(req.url.startsWith('/api/chat/card-layout')){if(req.method==='GET')return send({layout:saved,saved:true});let raw='';for await(const c of req)raw+=c;saved=JSON.parse(raw).layout;return send({layout:saved,saved:true});}
 if(req.method!=='POST')return send(read(req.url));
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
 if(req.url==='/api/chat/updates')return send({results:body.paths.map(path=>({path,status:200,data:read(path)}))});
 if(req.url==='/api/chat/message-reactions')return send({messages:{}});
 return send({});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ids=p=>p.$$eval('[data-news-feed] [data-news-item]',a=>a.map(e=>e.dataset.newsItem));
const noSideScroll=p=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
// The next read: forget the server's minute-long cache and ask the page to read again now.
const refresh=async p=>{route.resetNewsCache();await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));};
let browser;
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('pageerror:',e.message);});p.on('console',m=>{if(m.type()==='error')console.log('console:',m.text());});
 await p.setViewport({width:1280,height:860});
 // The row sits directly under Gainers Table and opens the feed.
 await p.goto(base+'/chat');await p.waitForSelector('a[data-chat-news-feed]');
 assert.equal(await p.$eval('a[data-chat-gainers-table]',a=>a.nextElementSibling?.matches('a[data-chat-news-feed]')),true,'News Feed is right under Gainers Table');
 await p.click('a[data-chat-news-feed]');await p.waitForSelector('[data-news-feed] [data-news-item]');
 assert.equal(await p.$eval('a[data-chat-news-feed]',a=>a.getAttribute('aria-current')),'page');
 const items=await p.$$eval('[data-news-feed] [data-news-item]',a=>a.map(e=>({gainer:e.hasAttribute('data-gainer'),title:e.querySelector('a').textContent,time:e.querySelector('time').textContent})));
 assert.deepEqual(items.slice(0,3).map(i=>i.title),['ABCD jumps after FDA clears its lead drug','ABCD and WXYZ sign a supply deal','WXYZ prices a $5 million offering'],'gainers first, newest first');
 assert.ok(items.slice(0,3).every(i=>i.gainer)&&items.slice(3).every(i=>!i.gainer));
 assert.equal(items.length,33,'every story once (the shared and market copies are deduped)');
 assert.deepEqual(items.slice(0,4).map(i=>i.time),['6m','42m','3h','2m']);
 assert.deepEqual(await p.$$eval('[data-news-feed] h3',h=>h.map(e=>e.textContent)),['Today’s gainers','Market']);
 const links=await p.$$eval('[data-news-feed] [data-news-item] a',a=>a.map(e=>[e.target,e.rel,e.href.startsWith('https://news.invalid/')]));
 assert.ok(links.every(([t,r,h])=>t==='_blank'&&r==='noopener noreferrer'&&h),'links open in a new tab');
 assert.deepEqual(await p.$$eval('[data-news-item]:nth-of-type(1) [data-gainer-ticker]',e=>e.map(x=>x.textContent)),['ABCD']);
 assert.deepEqual(await p.$eval('[data-news-feed] [data-news-item]:nth-of-type(2)',e=>[...e.querySelectorAll('li')].map(x=>[x.textContent,x.hasAttribute('data-gainer-ticker')])),[['ABCD',true],['WXYZ',true]]);
 // Filters.
 assert.deepEqual(await p.$$eval('[data-news-filter]',b=>b.map(e=>e.textContent)),['All','Gainers only','ABCD','WXYZ']);
 await p.click('[data-news-filter="gainers"]');assert.equal((await ids(p)).length,3);
 await p.click('[data-news-filter="t:WXYZ"]');assert.equal((await ids(p)).length,2);
 await p.click('[data-news-filter="all"]');assert.equal((await ids(p)).length,33);
 assert.ok(await noSideScroll(p));
 if(shots){await pause(300);await p.screenshot({path:join(shots,'t383-desktop.png')});}
 // At the top: a new headline goes straight in, no pill.
 const first=addArticle({minutes:0,title:'Breaking: market opens higher'});
 await refresh(p);await p.waitForFunction(id=>document.querySelector('[data-news-feed] [data-news-item]:nth-of-type(1)')&&[...document.querySelectorAll('[data-news-item]')].some(e=>e.dataset.newsItem===id),{},first);
 assert.equal(await p.$('[data-news-new-pill]'),null);
 assert.equal((await ids(p))[3],first,'the newest market story leads the market part');
 // Scrolled down: the list stays still and the pill counts the new ones.
 await p.$eval('[data-news-feed]',e=>e.scrollTop=600);await pause(100);
 const before=await ids(p),top=await p.$eval('[data-news-feed]',e=>e.scrollTop);assert.ok(top>=500);
 const g=addArticle({tickers:['WXYZ'],minutes:0,title:'WXYZ halted pending news'}),m=addArticle({minutes:0,title:'Oil slips in early trade'});
 await refresh(p);await p.waitForSelector('[data-news-new-pill]');
 assert.equal(await p.$eval('[data-news-new-pill]',b=>b.textContent.trim()),'↑ 2 new');
 assert.deepEqual(await ids(p),before,'nothing moves under the reader');
 assert.equal(await p.$eval('[data-news-feed]',e=>e.scrollTop),top);
 assert.ok(await p.$eval('[data-news-new-pill]',b=>{const r=b.getBoundingClientRect(),f=b.closest('[data-news-feed]').getBoundingClientRect();return r.top>=f.top&&r.bottom<=f.bottom;}),'the pill stays in view');
 await p.click('[data-news-new-pill]');await p.waitForSelector('[data-news-new-pill]',{hidden:true});
 const after=await ids(p);assert.equal(after[0],g);assert.ok(after.includes(m));assert.equal(await p.$eval('[data-news-feed]',e=>e.scrollTop),0);
 assert.ok(await p.$eval(`[data-news-item="${g}"]`,e=>e.hasAttribute('data-fresh')),'new stories are tinted');
 // Each gainer read once per refresh, plus the market (the route reads one ticker per request).
 assert.ok(polygonReads.includes('ABCD')&&polygonReads.includes('WXYZ')&&polygonReads.includes('*market'));
 // Deep link.
 await p.goto(base+'/chat?page=news-feed');await p.waitForSelector('[data-news-feed] [data-news-item]');
 // A phone: no sideways scroll, long titles wrap.
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await p.goto(base+'/chat?page=news-feed');await p.waitForSelector('[data-news-feed] [data-news-item]');await pause(300);
 assert.ok(await noSideScroll(p),'phone: no sideways scroll');
 assert.ok(await p.$eval('[data-news-feed]',e=>e.scrollWidth<=e.clientWidth+1));
 if(shots)await p.screenshot({path:join(shots,'t383-phone.png')});
 // Six view: the saved news card shows the feed; the picker offers it.
 await p.setViewport({width:1920,height:1080,isMobile:false,hasTouch:false});
 await p.goto(base+'/chat/six');await p.waitForSelector('section[data-card="1"] [data-card-news] [data-news-item]');
 assert.equal(await p.$eval('section[data-card="1"]',e=>e.dataset.cardType),'news');
 assert.equal(await p.$eval('section[data-card="1"] h2',e=>e.textContent.replace(/^Card \d+: /,'')),'News Feed');
 assert.ok((await p.$$('section[data-card="1"] [data-news-item]')).length>30);
 assert.ok(await p.$eval('section[data-card="1"] [data-news-feed]',e=>e.scrollHeight>e.clientHeight&&getComputedStyle(e).overflowY==='auto'),'the card scrolls inside itself');
 await p.click('section[data-card="4"] button[aria-label="Choose card 4"]');await p.waitForSelector('section[data-card="4"] [data-card-picker]');
 await p.click('section[data-card="4"] [data-card-picker] input[value="news"]');
 assert.match(await p.$eval('section[data-card="4"] [data-card-picker]',e=>e.textContent),/Already on another card/,'one News Feed per view');
 await p.keyboard.press('Escape');
 // Move it: clear card 1, pick the News Feed for card 4; the layout is saved with it.
 await p.click('section[data-card="1"] button[aria-label="Remove card 1"]');
 await p.click('section[data-card="4"] button[aria-label="Choose card 4"]');await p.click('section[data-card="4"] [data-card-picker] input[value="news"]');
 await p.click('section[data-card="4"] [data-card-picker] button[type=submit]');await p.waitForSelector('section[data-card="4"] [data-card-news] [data-news-item]');
 assert.deepEqual(saved[3],{type:'news',source:''});
 await p.click('section[data-card="4"] button[aria-label="Remove card 4"]');
 await p.click('section[data-card="1"] button[aria-label="Choose card 1"]');await p.click('section[data-card="1"] [data-card-picker] input[value="news"]');
 await p.click('section[data-card="1"] [data-card-picker] button[type=submit]');await p.waitForSelector('section[data-card="1"] [data-card-news] [data-news-item]');
 await pause(400);if(shots)await p.screenshot({path:join(shots,'t383-six.png')});
 // Without Gainers: no row, no card, and the route refuses.
 globalThis.__newsTest.access={longboard:false,shortscout:false,admin:false,botRooms:['social']};
 assert.equal((await route.GET(new Request(base+'/api/chat/news/feed'))).status,403);
 rooms=['main','social'];
 await p.setViewport({width:1280,height:860});await p.goto(base+'/chat?rooms='+encodeURIComponent(JSON.stringify(rooms)));await p.waitForSelector('nav');await pause(400);
 assert.equal(await p.$('a[data-chat-news-feed]'),null,'no News Feed row without Gainers');
 assert.deepEqual(errors,[]);
 console.log('News Feed browser checks passed: row under Gainers Table, gainers first, new-tab links, filters, refresh at top and the N new pill, deep link, phone, Six card, no access without Gainers.');
}catch(e){console.error(e);process.exitCode=1;}finally{server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
