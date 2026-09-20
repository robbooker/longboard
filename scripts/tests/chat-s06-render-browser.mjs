// Scoped benchmark of exact production room-row JSX/components, not a full-app load test.
// No production counters: esbuild injects ChatMessageBody instrumentation only in temp bundles.
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(new URL('../..',import.meta.url).pathname),base=process.env.CHAT_BENCH_BASE||'5f30f42';
const output=process.env.CHAT_BENCH_OUTPUT||path.join(root,'docs/chat-s06-render-results.md');
const work=await mkdtemp(path.join(tmpdir(),'chat-s06-render-'));
const getBase=file=>execFileSync('git',['show',`${base}:${file}`],{cwd:root,encoding:'utf8',maxBuffer:10_000_000});
const publicSource=getBase('components/chat/PublicChat.tsx');
const mapStart=publicSource.indexOf('messages.map((message) => {');
assert.ok(mapStart>=0,'baseline row marker');
const rowStart=publicSource.indexOf('<article',mapStart),rowEnd=publicSource.indexOf('</article>',rowStart)+10;
const originalRow=publicSource.slice(rowStart,rowEnd);
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--allow-file-access-from-files']});
const all=[];const errors=[];
try{
 for(const variant of ['before','after']){
  const dir=path.join(work,variant);await mkdir(dir);
  const imports=`import React,{useState,useCallback,useRef} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import ChatMessageBody from '${root}/components/chat/ChatMessageBody';
import MessageActions from '${root}/components/chat/MessageActions';import MessageReactions,{MessageReactionProvider} from '${root}/components/chat/MessageReactions';
import {ChatAttachments} from '${root}/components/chat/ChatAttachments';import BuddyStatus from '${root}/components/chat/BuddyStatus';
import {chatTimestamp,chatTimestampTitle} from '${root}/lib/chatTimestamp';import styles from '${root}/components/chat/PublicChat.module.css';
${variant==='after'?`import RoomMessageRow from '${root}/components/chat/RoomMessageRow';`:''}`;
  const source=imports+`
const total=Number(new URL(location.href).searchParams.get('count'));
const initial=Array.from({length:total},(_,i)=>({id:'message-'+i,member_id:i%5===0?'self':'bob',guest_id:i%5===0?'self':'bob',author_label:i%5===0?'Alice':'Bob',body:'Message '+i+': market observations for @Alice. Look at https://example.test/chart and compare the morning range before the next session.',created_at:'2026-09-19T14:00:00.000Z',attachment_ids:[]}));
const member={id:'self',display_name:'Alice'},mentionNames=['Buddy','Alice','Bob'];
const room='social',guestId='self',themeReady=true,isAdmin=true,roomPaused=false,readOnlyAnnouncement=false,inlineDm=false,mobileReplies=false,mobileNavOpen=false,loginHref='/login';
window.__bodyRenders=0;window.__messages=initial;
const reactions={};
window.fetch=async(url,options)=>{const p=JSON.parse(options?.body||'{}');if(String(url).includes('message-reactions')){if(p.action==='set')reactions[p.messageId]=p.active?[{emoji:p.emoji,count:1,mine:true,names:['Alice']}]:[];return Response.json({messages:Object.fromEntries((p.messageIds||[p.messageId]).map(id=>[id,reactions[id]||[]]))});}if(String(url).includes('/api/chat/message')){const m=window.__messages.find(m=>m.id===p.messageId);return Response.json({message:{...m,body:p.body,edited_at:'2026-09-19T15:00:00Z'}});}throw Error('Unexpected request '+url);};
function App(){
const [messages,setMessages]=useState(initial),[draft,setDraft]=useState(''),[badge,setBadge]=useState(0),[replyCounts,setReplyCounts]=useState({}),[replyTarget,setReplyTarget]=useState(null);const [,setReactions]=useState([]);const replyTrigger=useRef(null);
window.__messages=messages;
const onEdited=useCallback(updated=>setMessages(current=>current.map(m=>m.id===updated.id?updated:m)),[]);
const onDeleted=useCallback(id=>setMessages(current=>current.filter(m=>m.id!==id)),[]);
const openReplies=useCallback(id=>setReplyTarget(id),[]),setDmTarget=useCallback(value=>{window.__private=value;},[]);
const onReply=useCallback((id,trigger)=>{replyTrigger.current=trigger;setReplyTarget(id);},[]);
const onPrivateMessage=useCallback((id,name)=>{window.__private={id,name};},[]);
const mergeRoomMessage=(current,updated)=>current.map(m=>m.id===updated.id?updated:m);
window.__step=(kind,i)=>{const before=window.__bodyRenders,start=performance.now();flushSync(()=>{if(kind==='typing')setDraft('draft '+i);else if(kind==='badge')setBadge(i);else if(kind==='reply')setReplyCounts(c=>({...c,'message-0':i}));else if(kind==='edit')onEdited({...messages[0],body:'Edited body '+i,edited_at:'2026-09-19T15:00:00Z'});});return {ms:performance.now()-start,bodyRenders:window.__bodyRenders-before};};
return <MessageReactionProvider><main><header>Unread <b data-badge>{badge}</b></header><input aria-label='Message composer' value={draft} onChange={e=>setDraft(e.target.value)}/><section>{messages.map(message=>${variant==='before'?`(${originalRow})`:`<RoomMessageRow key={message.id} message={message} room={room} memberId={member.id} guestId={guestId} themeReady={themeReady} isAdmin={isAdmin} roomPaused={roomPaused} readOnlyAnnouncement={readOnlyAnnouncement} replyCount={replyCounts[message.id]??0} replyOpen={replyTarget===message.id} reactionsActive={!inlineDm&&(!mobileReplies||(!replyTarget&&!mobileNavOpen))} mentionNames={mentionNames} onPrivateMessage={onPrivateMessage} onReply={onReply} onEdited={onEdited} onDeleted={onDeleted}/>`})}</section></main></MessageReactionProvider>;
}
flushSync(()=>createRoot(document.getElementById('root')).render(<App/>));window.__ready=true;`;
  const entry=path.join(dir,'entry.tsx');await writeFile(entry,source);
  await build({entryPoints:[entry],outfile:path.join(dir,'bundle.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',minify:true,nodePaths:[path.join(root,'node_modules')],tsconfig:path.join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_GIPHY_API_KEY':'""'},loader:{'.css':'local-css'},plugins:[{name:'scoped-production-source',setup(b){
   b.onResolve({filter:/^(?:\.\/ChatAttachments|.*\/components\/chat\/ChatAttachments)$/},args=>({path:args.path,namespace:'empty-attachments'}));
   b.onLoad({filter:/.*/,namespace:'empty-attachments'},()=>({contents:'export function ChatAttachments(){return null}',loader:'js'}));
   b.onResolve({filter:/^\.\/ChatUpdates$/},()=>({path:'updates',namespace:'no-network-coordinator'}));
   b.onLoad({filter:/.*/,namespace:'no-network-coordinator'},()=>({contents:'export function useChatUpdates(){return null}',loader:'js'}));
   b.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'native-image'}));
   b.onLoad({filter:/.*/,namespace:'native-image'},()=>({contents:"import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/>}",loader:'jsx',resolveDir:root}));
   b.onLoad({filter:/\.(tsx?|css)$/},async args=>{
    if(!args.path.startsWith(root+'/')||args.path.includes('/node_modules/'))return;
    const relative=path.relative(root,args.path);let contents=variant==='before'?getBase(relative):await readFile(args.path,'utf8');
    if(relative==='components/chat/ChatMessageBody.tsx'){const marker='  const snapshot = tradingViewSnapshotFromText(body);';assert.ok(contents.includes(marker),'body instrumentation marker');contents=contents.replace(marker,'  window.__bodyRenders++;\n'+marker);}
    return {contents,loader:args.path.endsWith('.css')?'local-css':args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:path.dirname(args.path)};
   });
  }}]});
  const css=await readFile(path.join(dir,'bundle.css'),'utf8');await writeFile(path.join(dir,'index.html'),`<!doctype html><meta charset=utf-8><style>${css}\nbody{margin:0;font-family:Arial;background:#eef2ef}main{width:900px;margin:auto}header{padding:12px}input{padding:12px}</style><div id=root></div><script src=bundle.js></script>`);
  for(const count of [60,500,2000]){
   const page=await browser.newPage();page.on('pageerror',e=>errors.push(`${variant}/${count}: ${e.message}`));await page.setViewport({width:1440,height:900,deviceScaleFactor:1});const cdp=await page.createCDPSession();await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await page.goto('file://'+path.join(dir,'index.html')+'?count='+count);await page.waitForFunction(()=>window.__ready);await new Promise(r=>setTimeout(r,350));
   const mounted=await page.evaluate(()=>({bodyRenders:window.__bodyRenders,dialogs:document.querySelectorAll('dialog').length,domNodes:document.querySelectorAll('*').length}));assert.equal(mounted.bodyRenders,count);
   const phases={};for(const kind of ['typing','badge']){const samples=[];for(let i=1;i<=15;i++){samples.push(await page.evaluate(({kind,i})=>window.__step(kind,i),{kind,i}));}const times=samples.map(s=>s.ms).sort((a,b)=>a-b);phases[kind]={bodyRenders:samples.reduce((n,s)=>n+s.bodyRenders,0),medianMs:times[7],p95Ms:times[14],samples:15};assert.equal(phases[kind].bodyRenders,variant==='before'?count*15:0);}
   const reply=await page.evaluate(()=>window.__step('reply',2));assert.equal(reply.bodyRenders,variant==='before'?count:0);assert.match(await page.$eval('#chat-message-message-0',e=>e.textContent),/2 replies/);
   const edit=await page.evaluate(()=>window.__step('edit',1));assert.equal(edit.bodyRenders,variant==='before'?count:1);assert.match(await page.$eval('#chat-message-message-0',e=>e.textContent),/Edited body 1/);
   const first='#chat-message-message-0';await page.click(first+' details summary');await page.evaluate(selector=>[...document.querySelectorAll(selector+' button')].find(b=>b.textContent==='Edit').click(),first);await page.waitForSelector('dialog[open] textarea');await page.keyboard.press('Escape');await page.waitForSelector('dialog[open]',{hidden:true});assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Actions for message by Alice');await page.click(first+' details summary');
   await page.click(first+' [aria-label="Add reaction"]');await page.waitForSelector('dialog[open] [aria-label="heart reaction"]').catch(async e=>{console.error('DIALOG FAILURE',variant,count,await page.$$eval('dialog[open]',nodes=>nodes.map(n=>n.textContent)));throw e;});await page.click('dialog[open] [aria-label="heart reaction"]');await page.waitForSelector(first+' [aria-label^="Remove heart reaction, 1"]');await page.waitForSelector('dialog[open]',{hidden:true});
   assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Add reaction');
   console.log('PASS scenario',variant,count,phases.typing.bodyRenders,phases.badge.bodyRenders,mounted.dialogs);
   all.push({variant,count,mounted,...phases,replyBodyRenders:reply.bodyRenders,editedBodyRenders:edit.bodyRenders});await page.close();
  }
 }
 assert.deepEqual(errors,[]);
 const rows=all.map(r=>`| ${r.variant} | ${r.count} | ${r.typing.bodyRenders} | ${r.badge.bodyRenders} | ${r.typing.medianMs.toFixed(1)} / ${r.typing.p95Ms.toFixed(1)} | ${r.badge.medianMs.toFixed(1)} / ${r.badge.p95Ms.toFixed(1)} | ${r.mounted.dialogs} | ${r.mounted.domNodes} |`).join('\n');
 const report=`# S06 scoped room-row browser benchmark\n\nBaseline: \`${base}\`. After: current working-tree production components. Chromium ${await browser.version()}, viewport 1440×900, device scale 1, CPU throttle 4×, React production bundle, 15 sequential parent updates per phase. Admin viewer; same generated plain-text/link/mention messages, no attachments, no scrolling or virtualization.\n\nThe baseline row JSX is extracted verbatim from PublicChat at the baseline commit. Dependencies (message body, actions, reactions, styles) come from that commit for baseline and current files for after. The after run uses actual RoomMessageRow. Parent state is a small harness, not the full chat app. Attachment rendering is replaced with an empty leaf; ChatUpdates returns null; fetch returns synthetic message/reaction responses; Next Image uses a native image. Actual body tokenization, MessageActions and MessageReactions run in both versions. Counters are injected only into temporary browser bundles. No production instrumentation.\n\n| Version | Messages | Body renders: 15 typing | Body renders: 15 badge | Typing median / p95 ms | Badge median / p95 ms | Idle dialogs | DOM nodes |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n\nEvery scenario passed live reply-count text, edited body, edit-dialog Escape/focus return, reaction mutation/chip text and reaction-dialog focus return. One edited message rerenders ${all.find(r=>r.variant==='after').editedBodyRenders} body after; a reply-count update rerenders zero bodies after. Baseline rerenders every body for either parent update. All body counts are asserted; timings are one-run observations, not production latency or full-app response-time claims. Timing covers synchronous React update/commit via flushSync and excludes paint, network and the rest of PublicChat.\n\nRun: \`node scripts/tests/chat-s06-render-browser.mjs\`. Temporary bundles: \`${work}\`.\n`;
 await writeFile(output,report);await writeFile(output.replace(/\.md$/,'.json'),JSON.stringify({base,browser:await browser.version(),cpuThrottle:4,viewport:{width:1440,height:900},results:all},null,2)+'\n');console.log(report);
}finally{await browser.close();}
