// #470/#474 Six view card widths: the actual React components with synthetic, in-memory API responses
// (the same harness as chat-six-browser.mjs). Never connects to production services.
//
// Checks, as Alice on a computer: dragging the edge between the Gainers Table and the room beside it
// widens the table and narrows that room, and the cards in the other row (the one below the table)
// don't move; nothing is saved until the drag ends; past the neighbour's minimum the next card in the
// row gives room too, and no card goes under 320px or off the screen; the edges work from the
// keyboard and announce their values; a card in the second row can be resized on its own and both
// keep their widths; double-clicking an edge puts that card back to its normal width (the rest of
// the row re-balances, the other row stays); the widths are saved to her account and come back after
// a reload with this browser's copy wiped and on "another computer" (a fresh browser profile); a #470
// save (three column widths) still loads, for both rows; Reset widths puts every card back to even and
// is saved; Bob, signed in on the same browser, still sees the even layout and his account is
// untouched; a narrower window (two across) and a phone (one card with tabs) look exactly as before,
// with no edges and no Reset widths; when the server can't be read, this browser's copy is used.
//
// Usage: node scripts/tests/chat-six-widths-browser.mjs [--shots <dir>] [--before]
//   --shots writes t474-*.png into <dir>; --before only takes the "before" shots (for the old code).
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer';
const args=process.argv.slice(2),shots=args.includes('--shots')?args[args.indexOf('--shots')+1]:null,before=args.includes('--before');
const root=new URL('../../',import.meta.url).pathname,dir=await mkdtemp(join(tmpdir(),'six-widths-test-'));
const member={id:'11111111-1111-4111-8111-111111111111',display_name:'Alice',accepts_requests:true};
const conversations=['Bob','Carol'].map((name,i)=>({id:`22222222-2222-4222-8222-22222222222${i}`,otherId:`33333333-3333-4333-8333-33333333333${i}`,otherName:name,status:'accepted',incoming:false,blockedByMe:false,unavailable:false,unread:0,lastBody:'Hi',updatedAt:new Date().toISOString()}));
const roomState={isOpen:true,notice:null,pausedAt:null,updatedAt:new Date().toISOString()};
const rooms=['main','social','shortscout','gainers'];
const ago=m=>new Date(Date.now()-m*60000).toISOString();
const chatter=['Watching ABCD into the open, volume is already big.','Anyone have a level on WXYZ? Looks heavy up here.','Took a starter, stop under the morning low.','That pivot held twice now, nice and clean.','Out for a small win, too choppy for me today.','Halt on QRST, waiting for the reopen.'];
const messages=Object.fromEntries(rooms.map(room=>[room,chatter.map((body,n)=>({id:randomUUID(),room_slug:room,member_id:conversations[n%2].otherId,guest_id:null,author_label:conversations[n%2].otherName,body:n?body:`Welcome to ${room}. ${body}`,created_at:ago(30-n*4),unread_seq:n+1}))]));
const dms=Object.fromEntries(conversations.map(c=>[c.id,[{id:randomUUID(),seq:1,sender_id:c.otherId,body:`Hello from ${c.otherName}`,created_at:new Date().toISOString()}]]));
const table={day:'2026-11-20',rows:[
 {sym:'ABCD',lastAlertAt:ago(3),alerts:2,country:'United States',countryChecked:true,cashUsd:12500000,cashMonthsLeft:8,cashFlowPositive:false,cashChecked:true,instOwnPct:4.2,instOwnChecked:true,notFound:false,quote:{price:3.42,changePct:48.7,volume:18250000}},
 {sym:'WXYZ',lastAlertAt:ago(11),alerts:1,country:'China',countryChecked:true,cashUsd:null,cashMonthsLeft:null,cashFlowPositive:true,cashChecked:true,instOwnPct:0.8,instOwnChecked:true,notFound:false,quote:{price:1.07,changePct:22.1,volume:6400000}},
 {sym:'QRST',lastAlertAt:ago(26),alerts:3,country:null,countryChecked:false,cashUsd:null,cashMonthsLeft:null,cashFlowPositive:false,cashChecked:false,instOwnPct:null,instOwnChecked:false,notFound:false,quote:{price:7.9,changePct:-3.4,volume:2100000}},
 {sym:'LMNO',lastAlertAt:ago(40),alerts:1,country:'Israel',countryChecked:true,cashUsd:3100000,cashMonthsLeft:3,cashFlowPositive:false,cashChecked:true,instOwnPct:1.9,instOwnChecked:true,notFound:false,quote:{price:0.62,changePct:31.5,volume:9800000}},
]};
const activity={mentions:[],dms:[],mentionCount:0,dmCount:0,mentionThrough:0,dmThrough:0,roomCounts:{},roomThrough:{},roomMessageCounts:{},roomMessageThrough:{}};
// The bundle signs in whoever the six_account cookie names, so two members can share one browser.
const shell=`import React from 'react';import {createRoot} from 'react-dom/client';import SixChat from './components/chat/SixChat';
const accountId=(document.cookie.match(/six_account=([^;]+)/)||[])[1]||'alice';
const bootstrap=${JSON.stringify({room:'main',member,roomState,messages:[],reactions:[],counts:{},featureChannel:false})};
createRoot(document.getElementById('root')).render(<SixChat key={accountId} accountId={accountId} bootstrap={{...bootstrap,accountId}} allowedRooms={${JSON.stringify(rooms)}} serverSession={false} room="main" popout fontVariableClass="" appVersion="test"/>);`;
await build({stdin:{contents:shell,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:join(dir,'bundle.js'),define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'test-platform',setup(b){
 b.onResolve({filter:/^(next\/(link|image|dynamic|navigation)|@\/lib\/supabase\/client)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'tsx',resolveDir:root,contents:a.path==='next/dynamic'?`import React from 'react';export default function dynamic(load){const C=React.lazy(load);return props=><React.Suspense fallback={<p>Loading…</p>}><C {...props}/></React.Suspense>;}`:a.path==='next/navigation'?`export const useRouter=()=>({push:url=>location.href=url,refresh:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;`:a.path.includes('supabase')?`export function createClient(){const channel={on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},track:async()=>{},presenceState:()=>({})};return {channel:()=>channel,removeChannel:()=>{},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}`:`import React from 'react';export default function Component({children,unoptimized,fill,priority,scroll,...props}){return React.createElement(${a.path==='next/link'?"'a'":"'img'"},props,children);}`}));
}}]});
function read(path,account){const u=new URL(path,'http://localhost');const room=u.searchParams.get('room')||'main';
 if(u.pathname==='/api/chat/quad-options')return {accountId:account,rooms,conversations,gainersTable:true};
 if(u.pathname==='/api/chat/history')return {messages:messages[room]||[],reactions:[],hasMore:false};
 if(u.pathname==='/api/chat/thread-counts')return {counts:{}};
 if(u.pathname==='/api/chat/opening')return {messageId:null,readThrough:0};
 if(u.pathname==='/api/chat/inbox'){const id=u.searchParams.get('conversation');return id?{messages:dms[id]||[],hasMore:false}:{conversations};}
 if(u.pathname==='/api/chat/activity')return activity;
 if(u.pathname==='/api/chat')return roomState;
 if(u.pathname==='/api/chat/app-version')return {version:'test'};
 if(u.pathname==='/api/chat/pins')return {pins:[]};
 if(u.pathname==='/api/chat/gainers/table')return table;
 return {};
}
// What each account has saved on the server: {slots, widths}. Alice starts with the Gainers Table first.
const LAYOUT=[{type:'gainers-table',source:''},{type:'room',source:'main'},{type:'room',source:'social'},{type:'room',source:'gainers'},{type:'dm',source:conversations[0].id},{type:'room',source:'shortscout'}];
const accounts={alice:{slots:LAYOUT,widths:null},bob:{slots:LAYOUT,widths:null}};
let layoutStatus=200;const writes=[];
const server=createServer(async(req,res)=>{
 const account=(req.headers.cookie?.match(/six_account=([^;]+)/)||[])[1]||'alice';
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.url.startsWith('/chat/six')){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script>');}
 if(['/bundle.js','/bundle.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');return res.end(await readFile(join(dir,req.url.slice(1))));}
 if(req.url==='/chat-sw.js'){res.setHeader('Content-Type','text/javascript');return res.end('');}
 if(req.url.startsWith('/api/chat/card-layout')){
  if(layoutStatus!==200)return send({error:'layout_unavailable'},layoutStatus);
  const row=accounts[account];
  if(req.method==='GET')return send({layout:row.slots,saved:true,widths:row.widths});
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');writes.push({account,body});
  row.slots=body.layout;if('widths' in body)row.widths=body.widths;
  return send({layout:row.slots,saved:true,...('widths' in body?{widths:row.widths}:{})});
 }
 if(req.method!=='POST')return send(read(req.url,account));
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
 if(req.url==='/api/chat/updates')return send({results:body.paths.map(path=>({path,status:200,data:read(path,account)}))});
 if(req.url==='/api/chat/message-reactions')return send({messages:{}});
 return send({});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const card=i=>`section[data-card="${i}"]`,handle=(row,i)=>`[data-six-row="${row}"] [data-six-handle="${i}"]`,pause=ms=>new Promise(r=>setTimeout(r,ms));
const widthsOf=p=>p.$$eval('section[data-card]',s=>s.map(e=>Math.round(e.getBoundingClientRect().width)));
const noSideScroll=p=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const near=(a,b,slack=2)=>Math.abs(a-b)<=slack;
const desktop={width:1600,height:900},phone={width:390,height:844,isMobile:true,hasTouch:true};
async function open(context,account,viewport=desktop){
 const p=await context.newPage();p.errors=[];p.on('pageerror',e=>{p.errors.push(e.message);console.log('pageerror:',e.message);});p.on('console',m=>{if(m.type()==='error')console.log('console:',m.text());});
 await p.setViewport(viewport);await p.setCookie({name:'six_account',value:account,url:base});
 await p.goto(base+'/chat/six');await p.waitForSelector(`${card(1)} [data-gainers-table]`);
 await p.waitForFunction(()=>document.body.textContent.includes('Welcome to social'));await pause(300);
 return p;
}
const reload=async p=>{await p.reload();await p.waitForSelector(`${card(1)} [data-gainers-table]`);if(shots)await p.waitForFunction(()=>document.body.textContent.includes('Welcome to social'));await pause(300);};
const shot=async(p,name,clip)=>{if(shots)await p.screenshot({path:join(shots,name),...(clip?{clip}:{})});};
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 if(before){
  const p=await open(browser.defaultBrowserContext(),'alice');await shot(p,'t474-before-desktop.png');
  const m=await open(browser.defaultBrowserContext(),'alice',phone);await shot(m,'t474-before-phone.png');
  console.log('Before screenshots saved');
 }else{
 const p=await open(browser.defaultBrowserContext(),'alice');
 const centre=sel=>p.$eval(sel,e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
 const drag=async(sel,dx,steps=12)=>{const at=await centre(sel);await p.mouse.move(at.x,at.y);await p.mouse.down();await p.mouse.move(at.x+dx,at.y,{steps});await p.mouse.up();await pause(250);};
 const lefts=()=>p.$$eval('section[data-card]',s=>s.map(e=>Math.round(e.getBoundingClientRect().left)));
 // Even to start: two rows of three equal cards, two edges in each row, Reset widths there but nothing to reset.
 const even=await widthsOf(p);
 assert.equal(new Set(even.map(w=>Math.round(w/3))).size,1,`even cards: ${even}`);
 assert.deepEqual(await p.$$eval('[data-six-handle]',h=>h.map(e=>[e.closest('[data-six-row]').dataset.sixRow,e.getAttribute('role'),e.getAttribute('aria-orientation'),e.checkVisibility()])),
  [['1','separator','vertical',true],['1','separator','vertical',true],['2','separator','vertical',true],['2','separator','vertical',true]]);
 assert.ok(await p.$eval('button[data-six-reset]',b=>b.checkVisibility()&&b.disabled),'Reset widths shows, with nothing to reset');
 // Row 1's first edge sits in the gap between card 1 and card 2, and only as tall as that row.
 const edge=await p.$eval(handle(1,1),e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,top:r.top,bottom:r.bottom};});
 const gap=await p.evaluate(()=>[document.querySelector('section[data-card="1"]').getBoundingClientRect().right,document.querySelector('section[data-card="2"]').getBoundingClientRect().left,document.querySelector('section[data-card="4"]').getBoundingClientRect().top]);
 assert.ok(edge.x>=gap[0]-1&&edge.x<=gap[1]+1,'the edge is in the gap between the cards');
 assert.ok(edge.bottom<=gap[2],'the edge stops at the bottom of its row');
 // Dragging it right: the Gainers Table (card 1) wider, #LB narrower, #Social as before, and the
 // whole second row (the Gainers room below the table included) doesn't move at all.
 const writesBefore=writes.length,leftsBefore=await lefts();
 await p.mouse.move(edge.x,edge.y);await p.mouse.down();
 for(let step=1;step<=10;step++){await p.mouse.move(edge.x+step*15,edge.y+step);await pause(16);}
 const mid=await widthsOf(p);
 assert.ok(near(mid[0],even[0]+150,3)&&near(mid[1],even[1]-150,3)&&near(mid[2],even[2]),`mid-drag widths ${mid}`);
 assert.deepEqual(mid.slice(3),even.slice(3),'the cards below don\'t change while dragging');
 assert.equal(await p.$eval(handle(1,1),e=>e.hasAttribute('data-dragging')),true);
 await pause(300);assert.equal(writes.length,writesBefore,'nothing is saved while dragging');
 await shot(p,'t474-dragging.png');
 await p.mouse.up();await pause(300);
 assert.equal(writes.length,writesBefore+1,'one save when the drag ends');
 const dragged=await widthsOf(p);
 assert.ok(near(dragged[0],even[0]+150,3)&&near(dragged[1],even[1]-150,3)&&near(dragged[2],even[2]),`dragged widths ${dragged}`);
 assert.deepEqual(dragged.slice(3),even.slice(3),'the card below the Gainers Table (and its row) is unchanged');
 assert.deepEqual((await lefts()).slice(3),leftsBefore.slice(3),'the second row hasn\'t moved');
 let saved=writes.at(-1).body.widths;const firstDrag=saved;
 assert.equal(writes.at(-1).body.view,'six');assert.deepEqual(writes.at(-1).body.layout,LAYOUT,'the cards are sent as they are');
 assert.equal(saved.length,6,'six widths: two rows of three');
 assert.ok(near(saved.slice(0,3).reduce((a,b)=>a+b,0),1,0.001)&&near(saved.slice(3).reduce((a,b)=>a+b,0),1,0.001),'each row adds up to one');
 assert.ok(saved[0]>saved[2]&&saved[2]>saved[1]);assert.ok(saved.slice(3).every(v=>near(v,1/3,0.001)),'row 2 saved even');
 assert.ok(await p.$eval('button[data-six-reset]',b=>!b.disabled),'Reset widths is ready once a card has changed');
 if(shots){await p.mouse.move(10,880);await pause(200);await shot(p,'t474-after-drag.png');}
 // Further right: #LB stops at its minimum (320px), then #Social gives room too; nothing goes under 320 or off the screen.
 await drag(handle(1,1),900);
 const squeezed=await widthsOf(p);
 assert.deepEqual(squeezed.slice(1,3),[320,320],`the other two cards stop at 320px: ${squeezed}`);
 assert.deepEqual(squeezed.slice(3),even.slice(3),'the second row still hasn\'t changed');
 assert.ok(await p.$eval(`${card(2)} [class*="messages"]`,e=>e.scrollWidth<=e.clientWidth+1),'the narrow room has no sideways scroll');
 assert.ok(await p.$eval(`${card(3)}`,e=>e.getBoundingClientRect().right<=innerWidth),'the last card is still on the screen');
 assert.ok(await noSideScroll(p));
 // And left: the Gainers Table stops at its minimum too.
 await drag(handle(1,1),-1400);
 assert.equal((await widthsOf(p))[0],320,'the Gainers Table stops at 320px');
 // From the keyboard: arrows move 24px, Shift+arrow 96px; back to where the first drag left it.
 await p.focus(handle(1,1));
 const before1=(await widthsOf(p))[0];await p.keyboard.press('ArrowRight');await pause(50);
 assert.equal((await widthsOf(p))[0],before1+24,'ArrowRight widens the left card by 24px');
 const presses=Math.round((dragged[0]-before1-24)/24);for(let n=0;n<presses;n++)await p.keyboard.press('ArrowRight');
 await p.keyboard.down('Shift');await p.keyboard.press('ArrowLeft');await p.keyboard.up('Shift');for(let n=0;n<4;n++)await p.keyboard.press('ArrowRight');
 await pause(50);const keyed=await widthsOf(p);
 assert.ok(near(keyed[0],dragged[0],24),`keyboard back near the dragged width: ${keyed} vs ${dragged}`);
 assert.deepEqual(keyed.slice(3),even.slice(3));
 const value=await p.$eval(handle(1,1),e=>[+e.getAttribute('aria-valuenow'),+e.getAttribute('aria-valuemin'),+e.getAttribute('aria-valuemax'),e.getAttribute('aria-valuetext'),e.getAttribute('aria-label')]);
 assert.ok(value[0]>33&&value[1]>0&&value[2]<100&&value[1]<value[0]&&value[0]<value[2],`announced values ${value}`);
 assert.match(value[3],/^Card 1 \d+%, card 2 \d+%$/);assert.equal(value[4],'Resize cards 1 and 2');
 assert.equal(await p.$eval(handle(2,2),e=>e.getAttribute('aria-label')),'Resize cards 5 and 6');
 const keySaves=writes.length;await pause(900);assert.equal(writes.length,keySaves+1,'key presses are saved once, after a short pause');
 // Back to how the first drag left it (the squeezing above moved #Social too).
 accounts.alice.widths=firstDrag;await reload(p);assert.deepEqual(await widthsOf(p),dragged);
 // A second card, on its own: widen the SS room (card 6, bottom right) by dragging its edge left.
 // Row 1 keeps its widths; card 3 above it doesn't move.
 const row1=(await widthsOf(p)).slice(0,3);
 await drag(handle(2,2),-120);
 const two=await widthsOf(p);
 assert.deepEqual(two.slice(0,3),row1,'the top row keeps its widths');
 assert.ok(near(two[5],even[5]+120,3)&&near(two[4],even[4]-120,3)&&near(two[3],even[3]),`card 6 wider, card 5 narrower: ${two}`);
 saved=writes.at(-1).body.widths;assert.ok(saved[5]>saved[3]&&saved[3]>saved[4]&&saved[0]>saved[2],`both rows saved: ${saved}`);
 if(shots){await p.mouse.move(10,880);await pause(200);await shot(p,'t474-two-cards.png');}
 const kept=two,twoCards=saved;
 // A reload with this browser's copy wiped: the account's widths come back from the server.
 await p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('rb-chat-six-widths'))localStorage.removeItem(k);});
 await reload(p);assert.deepEqual(await widthsOf(p),kept,'a reload keeps both cards\' widths');
 // Another computer: a fresh browser profile, signed in as Alice.
 const other=await browser.createBrowserContext(),q=await open(other,'alice');
 assert.deepEqual(await widthsOf(q),kept,'another computer gets the same widths');
 // Double-click row 1's first edge: the Gainers Table goes back to its normal width and #LB gets its
 // room back; #Social and the whole bottom row (card 6 still wide) stay as they are. Saved at once.
 const dblSaves=writes.length;
 const at=await centre(handle(1,1));await p.mouse.click(at.x,at.y,{clickCount:1});await p.mouse.click(at.x,at.y,{clickCount:2});await pause(300);
 const back=await widthsOf(p);
 assert.ok(near(back[0],even[0],2)&&near(back[1],even[1],2)&&near(back[2],even[2],2),`the Gainers Table is back to normal: ${back}`);
 assert.deepEqual(back.slice(3),kept.slice(3),'the bottom row keeps card 6 wide');
 assert.equal(writes.length,dblSaves+1,'a double-click is saved once');
 saved=writes.at(-1).body.widths;assert.ok(saved.slice(0,3).every(v=>near(v,1/3,0.001))&&saved[5]>saved[3],`saved: ${saved}`);
 if(shots){await p.mouse.move(10,880);await pause(200);await shot(p,'t474-after-double-click.png');}
 // Double-click card 6's edge (row 2's second edge): card 6 back to normal too, so every card is even.
 const at2=await centre(handle(2,2));await p.mouse.click(at2.x,at2.y,{clickCount:1});await p.mouse.click(at2.x,at2.y,{clickCount:2});await pause(300);
 const allBack=await widthsOf(p);assert.ok(allBack.every((w,i)=>near(w,even[i],2)),`all even again: ${allBack}`);
 assert.equal(writes.at(-1).body.widths,null,'even everywhere is saved as no widths');
 assert.ok(await p.$eval('button[data-six-reset]',b=>b.disabled));
 // Enter on a focused edge does the same as a double-click.
 await drag(handle(2,1),100);assert.ok(near((await widthsOf(p))[3],even[3]+100,3));
 await p.focus(handle(2,1));await p.keyboard.press('Enter');await pause(900);
 assert.ok((await widthsOf(p)).every((w,i)=>near(w,even[i],2)),'Enter puts the card back');
 // Put the two cards back (as saved before) to check Bob and Reset widths.
 accounts.alice.widths=twoCards;
 await reload(p);assert.deepEqual(await widthsOf(p),kept,'both cards\' widths again');
 // Bob, on Alice's browser and on his own: still even, and his account was never written.
 const b=await open(browser.defaultBrowserContext(),'bob');const bobs=await widthsOf(b);
 assert.ok(bobs.every((w,i)=>near(w,even[i])),`Bob still sees even cards: ${bobs}`);
 assert.equal(accounts.bob.widths,null);assert.ok(writes.every(w=>w.account==='alice'));await b.close();
 // (Alice's tab noticed the sign-in change and reloaded, as Six always does; sign her back in.)
 await p.setCookie({name:'six_account',value:'alice',url:base});await pause(500);await reload(p);assert.deepEqual(await widthsOf(p),kept,'Alice still has hers');
 // Reset widths: every card back to even, saved as "no widths" for the account, still even after a reload.
 await p.click('button[data-six-reset]');await pause(300);
 const reset=await widthsOf(p);assert.ok(reset.every((w,i)=>near(w,even[i])),`reset to even: ${reset}`);
 assert.equal(writes.at(-1).body.widths,null);assert.equal(accounts.alice.widths,null);
 assert.ok(await p.$eval('button[data-six-reset]',b=>b.disabled));
 await reload(p);assert.ok((await widthsOf(p)).every((w,i)=>near(w,even[i])),'reset holds after a reload');
 if(shots){const fresh=await browser.createBrowserContext(),f=await open(fresh,'alice');await shot(f,'t474-after-reset.png');await fresh.close();}
 // The other computer learns about the reset when it next opens Six.
 await reload(q);assert.ok(near((await widthsOf(q))[0],even[0]));await other.close();
 // A save from before this change (#470: three column widths) still loads, for both rows.
 accounts.alice.widths=[0.5,0.25,0.25];await reload(p);
 const half=await widthsOf(p);assert.ok(half[0]>half[1]*1.9&&near(half[1],half[2]),`saved half/quarter/quarter: ${half}`);
 assert.deepEqual(half.slice(3),half.slice(0,3),'an old save applies to both rows');
 // Card changes keep the widths, and layout saves don't send widths.
 await p.click(`${card(6)} button[aria-label="Remove card 6"]`);await pause(200);
 assert.equal('widths' in writes.at(-1).body,false,'changing a card sends only the cards');
 assert.deepEqual(accounts.alice.widths,[0.5,0.25,0.25]);assert.deepEqual(await widthsOf(p),half);
 accounts.alice.slots=LAYOUT;await reload(p);
 // Resizing a card after an old save: only that card's row changes; the other row keeps the old widths.
 await drag(handle(2,1),-100);const after=await widthsOf(p);
 assert.deepEqual(after.slice(0,3),half.slice(0,3));assert.ok(near(after[3],half[3]-100,3));
 assert.equal(writes.at(-1).body.widths.length,6);
 accounts.alice.widths=[0.5,0.25,0.25,0.5,0.25,0.25];await reload(p);
 // The server can't be read: this browser's copy of the widths is used.
 layoutStatus=503;await reload(p);assert.deepEqual(await widthsOf(p),half,'browser copy when the server is down');layoutStatus=200;
 // Narrower than a monitor (two across) and a phone (one card): exactly as before, no edges, no Reset widths.
 await p.setViewport({width:1000,height:900});await pause(200);
 const narrow=await p.$$eval('section[data-card]',s=>s.map(e=>Math.round(e.getBoundingClientRect().width)));
 assert.equal(new Set(narrow).size,1,`two equal columns at 1000px: ${narrow}`);
 assert.equal(new Set(await lefts()).size,2);
 assert.deepEqual(await p.$$eval('section[data-card]',s=>s.map(e=>Math.round(e.getBoundingClientRect().top))).then(t=>new Set(t).size),3,'three rows of two');
 assert.deepEqual(await p.$$eval('[data-six-handle]',h=>h.map(e=>e.checkVisibility())),[false,false,false,false]);
 assert.equal(await p.$eval('button[data-six-reset]',b=>b.checkVisibility()),false);
 const m=await open(browser.defaultBrowserContext(),'alice',phone);
 assert.equal(await m.$$eval('section[data-card]:not([hidden])',e=>e.length),1);assert.ok(await noSideScroll(m));
 assert.ok(near(await m.$eval('section[data-card]:not([hidden])',e=>e.getBoundingClientRect().width),phone.width-12,1),'one full-width card on a phone');
 assert.deepEqual(await m.$$eval('[data-six-handle]',h=>h.map(e=>e.checkVisibility())),[false,false,false,false]);
 assert.equal(await m.$eval('button[data-six-reset]',b=>b.checkVisibility()),false);
 await m.click('nav[aria-label="Choose visible card"] button:nth-child(5)');assert.equal(await m.$eval('section[data-card]:not([hidden])',e=>e.dataset.card),'5');
 await m.click('nav[aria-label="Choose visible card"] button:nth-child(1)');await pause(200);
 await shot(m,'t474-phone.png');
 assert.deepEqual([...p.errors,...q.errors,...m.errors],[]);
 console.log('Six view card width checks passed: one card at a time (the card below unchanged), neighbours give room down to 320px, keyboard, a second card in the other row, double-click and Enter put a card back, saved per account (reload, another computer), old three-column saves load for both rows, Reset widths, another member unaffected, narrow and phone unchanged, browser fallback.');
 }
}catch(e){console.error(e);process.exitCode=1;}finally{server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
