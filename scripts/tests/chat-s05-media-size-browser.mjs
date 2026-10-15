// MEDIA-SIZE: opening a room, a thread and a DM with images and GIFs causes no layout shift.
// File details and thumbnails are delayed (so the reserved boxes are on screen for a while);
// a PerformanceObserver records every layout shift whose moved node is inside the message list.
// MEDIA_SHOTS=<dir> MEDIA_LABEL=before|after also saves the loading state per view/theme/device.
// MEDIA_ASSERT=0 only reports (used for the origin/main "before" run).
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
const base='http://localhost:3284';
const shots=process.env.MEDIA_SHOTS||'',label=process.env.MEDIA_LABEL||'after',strict=process.env.MEDIA_ASSERT!=='0';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const sharp=(await import('sharp')).default;
const png=(w,h,color)=>sharp({create:{width:w,height:h,channels:3,background:color}}).png().toBuffer();
const wide=await png(1800,600,'#336699'),tall=await png(600,1800,'#993366'),small=await png(120,80,'#999933');
const gif=await sharp({create:{width:480,height:270,channels:3,background:'#669933'}}).gif().toBuffer();
const post=(page,url,body)=>page.evaluate(async({url,body})=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{url,body});
const get=(page,path)=>page.evaluate(async path=>(await fetch(path)).json(),path);
async function upload(p,scope,bytes,name,mime){return p.evaluate(async({scope,base64,name,mime})=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));let r=await fetch('/api/chat/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...scope,filename:name,mime_type:mime,byte_size:bytes.length})});const reserved=await r.json();if(!r.ok)throw Error(JSON.stringify(reserved));r=await fetch(reserved.url,{method:'PUT',headers:{'Content-Type':mime,'x-upsert':'false'},body:bytes});if(!r.ok)throw Error('upload failed');r=await fetch('/api/chat/attachments/'+reserved.id,{method:'POST'});if(!r.ok)throw Error(await r.text());return reserved.id;},{scope,base64:bytes.toString('base64'),name,mime});}
async function login(p,email){await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label^="Message "]');await p.waitForNetworkIdle({idleTime:500});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[];
try{
 const setup=await browser.newPage();await setup.setViewport({width:1440,height:900});await login(setup,'alice@example.test');
 const send=async(body,files,replyTo)=>{const clientId=randomUUID();let r;for(let i=0;i<20;i++){r=await post(setup,'/api/chat',{action:'send',room:'main',body,attachmentIds:files,clientId,...(replyTo?{replyTo}:{})});if(r.status!==429)break;await sleep(3000);}assert.equal(r.status,200,JSON.stringify(r));await sleep(1600);return r.data.message.id;};
 const room={room:'main'};
 const first=await send('Media size: a wide and a tall image',[await upload(setup,room,wide,'wide-chart.png','image/png'),await upload(setup,room,tall,'tall-screenshot.png','image/png')]);
 await send('Media size: an uploaded GIF and a small image with a very long file name',[await upload(setup,room,gif,'reaction.gif','image/gif'),await upload(setup,room,small,'a-really-long-file-name-for-a-small-image-that-wraps-badly-in-narrow-cards.png','image/png')]);
 await send('Media size: a GIPHY GIF https://giphy.com/gifs/MediaSizeTest123',[]);
 await send('Media size: text after the images',[]);
 await send('Media size: reply with an image',[await upload(setup,room,wide,'reply-wide.png','image/png')],first);
 const list=await get(setup,'/api/chat/inbox'),dm=list.conversations.find(c=>c.otherName==='Bob');
 if(dm.status==='pending')assert.equal((await post(setup,'/api/chat/inbox',{action:'accept',target:dm.id})).status,200);
 const dmScope={conversationId:dm.id};
 assert.equal((await post(setup,'/api/chat/inbox',{action:'send',target:dm.id,body:'Media size DM images',attachmentIds:[await upload(setup,dmScope,wide,'dm-wide.png','image/png'),await upload(setup,dmScope,tall,'dm-tall.png','image/png')],clientId:randomUUID()})).status,200);
 assert.equal((await post(setup,'/api/chat/inbox',{action:'send',target:dm.id,body:'Media size DM after https://giphy.com/gifs/MediaSizeDm456',clientId:randomUUID()})).status,200);
 const history=await get(setup,'/api/chat/history?room=main');
 const sized=history.messages.filter(m=>m.attachment_media);console.log('history messages with attachment_media:',sized.length,JSON.stringify(sized.map(m=>m.attachment_media)));
 await setup.close();
 if(shots)await mkdir(shots,{recursive:true});
 for(const device of ['desktop','phone'])for(const theme of ['dark','light'])for(const view of (process.env.MEDIA_VIEWS||'room,dm,thread').split(',')){
  if(view==='thread'&&device==='phone')continue;
  const p=await browser.newPage();
  await (device==='phone'?p.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2}):p.setViewport({width:1440,height:900}));
  await p.evaluateOnNewDocument(theme=>{try{localStorage.setItem('longboard-public-chat-theme-v1',theme);}catch{}
   window.__shifts=[];
   new PerformanceObserver(list=>{for(const e of list.getEntries()){if(e.hadRecentInput)continue;const container=document.querySelector('[role="log"]')?.parentElement?.parentElement;const nodes=(e.sources||[]).map(s=>s.node).filter(Boolean);
    const inside=nodes.filter(n=>n.closest?.('[role="log"],section[aria-label="Private conversation"],[aria-label="Message attachments"],[aria-label="Shared files"],aside,[role="dialog"]')||(n.parentElement&&n.parentElement.closest('[role="log"],section[aria-label="Private conversation"],aside,[role="dialog"]')));
    window.__shifts.push({value:e.value,t:Math.round(e.startTime),inList:inside.length>0,nodes:nodes.map(n=>(n.nodeName||'')+'.'+String(n.className||'').slice(0,40)+':'+(n.textContent||'').slice(0,30))});}}).observe({type:'layout-shift',buffered:true});},theme);
  await p.setRequestInterception(true);
  p.on('request',r=>{const u=r.url();
   // GIPHY answers (metadata after 1.5 s, the GIF itself after 3.5 s) so the loaded GIF is measured too.
   const giphy=u.match(/^https:\/\/api\.giphy\.com\/v1\/gifs\/([A-Za-z0-9]+)/);
   if(giphy){const id=giphy[1],m=k=>({url:`https://media.giphy.com/media/${id}/${k}.gif`});setTimeout(()=>r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({data:{id,title:'Test GIF',images:{original:m('giphy'),original_still:m('giphy_s'),fixed_width_small_still:m('100w_s')}}})}).catch(()=>{}),1500);return;}
   if(u.startsWith('https://media.giphy.com/')){setTimeout(()=>r.respond({status:200,contentType:'image/gif',headers:{'Access-Control-Allow-Origin':'*'},body:gif}).catch(()=>{}),3500);return;}
   if(u.includes('giphy.com')){r.abort().catch(()=>{});return;}
   if(/\/api\/chat\/attachments\?/.test(u)){setTimeout(()=>r.continue().catch(()=>{}),1500);return;}
   if(/\/api\/chat\/attachments\/[0-9a-f-]+\?thumbnail=1/.test(u)){setTimeout(()=>r.continue().catch(()=>{}),3500);return;}
   r.continue().catch(()=>{});});
  await p.goto(base+(view==='dm'?`/chat?room=main&dm=${dm.id}`:'/chat?room=main'),{waitUntil:'domcontentloaded'});
  if(view!=='dm')await p.waitForSelector('[role="log"] [aria-label="Message attachments"]',{timeout:30000});
  if(view==='dm'){for(let i=0;i<15;i++){if(await p.waitForFunction(()=>document.querySelector('header[data-dm="true"] h1')?.textContent==='Bob',{timeout:3000}).then(()=>true,()=>false))break;await p.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),dm.id);if(await p.waitForFunction(()=>document.querySelector('header[data-dm="true"] h1')?.textContent==='Bob',{timeout:2000}).then(()=>true,()=>false))break;}
   await p.waitForSelector('[aria-label="Shared files"]',{timeout:30000,visible:true}).catch(async e=>{await p.screenshot({path:'/tmp/claude-1000/-home-robbooker/ee0900cf-18a6-4651-bf00-cf2582f4d6d4/scratchpad/ms-dm-fail.png'});throw e;});}
  if(view==='thread'){await p.waitForFunction(()=>[...document.querySelectorAll('[role="log"] button')].some(b=>/1 reply/.test(b.textContent)));const opener=await p.evaluateHandle(()=>[...document.querySelectorAll('[role="log"] button')].find(b=>/1 reply/.test(b.textContent)));await opener.evaluate(b=>b.scrollIntoView({block:'center'}));await sleep(300);await opener.evaluate(b=>b.click());await p.waitForSelector('[aria-label="Comment replies"] [aria-label="Message attachments"]',{timeout:30000}).catch(async e=>{await p.screenshot({path:'/tmp/claude-1000/-home-robbooker/ee0900cf-18a6-4651-bf00-cf2582f4d6d4/scratchpad/ms-thread-fail.png'});throw e;});}
  const cards=()=>p.evaluate(()=>[...document.querySelectorAll('[aria-label="Message attachments"] > div,[aria-label="Shared files"] > div,button[aria-label$=" GIF"]')].map(e=>{const r=e.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height);}));
  // The room has finished opening (positioned at its landing spot) before boxes are compared.
  await p.waitForFunction(()=>!document.querySelector('[data-positioning]'),{timeout:30000});await sleep(250);
  await p.evaluate(()=>{window.__mark=performance.now();});const before=await cards();
  await sleep(700);
  if(shots&&view!=='thread')await p.screenshot({path:`${shots}/${view}-${theme}-${device}-${label}.png`});
  // Everything settles: every thumbnail decoded (or marked unavailable), GIF cards answered.
  const onScreen=`e=>{const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.width>0;}`;
  await p.waitForFunction(onScreen=>{const vis=eval(onScreen);const shown=[...document.querySelectorAll('button[aria-label^="Enlarge"]')].filter(vis);return shown.length>0&&shown.every(b=>{const i=b.querySelector('img');return !i||(i.complete&&i.naturalWidth>0);})&&![...document.querySelectorAll('[role="status"]')].filter(vis).some(e=>/Loading (attachment|image)/.test(e.textContent));},{timeout:30000},onScreen);
  await sleep(3500);
  if(shots&&view!=='thread'){await mkdir(`${shots}/settled`,{recursive:true});await p.screenshot({path:`${shots}/settled/${view}-${theme}-${device}-${label}.png`});}
  const settled=await cards();const resized=before.filter((v,i)=>settled[i]!==v).length+Math.abs(settled.length-before.length);if(resized)console.log('resized boxes',JSON.stringify(before),'->',JSON.stringify(settled));
  const shifts=await p.evaluate(()=>window.__shifts);
  const markT=await p.evaluate(()=>window.__mark);
  const after=shifts.filter(s=>s.inList&&s.t>=markT);
  const cls=after.reduce((a,s)=>a+s.value,0);
  results.push({view,theme,device,cls:+cls.toFixed(4),shifts:after.length,cards:before.length,resized});
  console.log(`${view}-${theme}-${device}: message-list CLS=${cls.toFixed(4)} (${after.length} shifts; ${resized}/${before.length} media boxes resized; all-page ${shifts.reduce((a,s)=>a+s.value,0).toFixed(4)}; mark ${Math.round(markT)}ms)`,after.length?JSON.stringify(after.slice(0,6)):'',process.env.MEDIA_DEBUG?JSON.stringify(shifts):'');
  await p.close();
 }
 console.log('RESULTS',JSON.stringify(results));
 if(strict)for(const r of results){assert.equal(r.cls,0,`${r.view}-${r.theme}-${r.device} CLS ${r.cls}`);assert.equal(r.resized,0,`${r.view}-${r.theme}-${r.device} media boxes resized`);}
 console.log('PASS media size: no layout shift in the message list while images and GIFs load');
}finally{await browser.close();}
