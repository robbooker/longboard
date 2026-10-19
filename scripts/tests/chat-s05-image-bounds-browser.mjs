import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
const base='http://localhost:3284';
await writeFile('/tmp/s03-dm.gif',Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const post=(page,body)=>page.evaluate(async body=>{const r=await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},body);
// On a fresh fixture the DM has no images yet; send a wide image and a GIF first (the same upload path as chat-s05-attachments).
const sharp=(await import('sharp')).default;const wide=await sharp({create:{width:1800,height:600,channels:3,background:'#336699'}}).png().toBuffer();const gif=await sharp({create:{width:320,height:220,channels:3,background:'#669933'}}).gif().toBuffer();
async function upload(p,scope,bytes,name,mime){return p.evaluate(async({scope,base64,name,mime})=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));let r=await fetch('/api/chat/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...scope,filename:name,mime,byte_size:bytes.length,mime_type:mime,size:bytes.length})});const reserved=await r.json();if(!r.ok)throw Error(JSON.stringify(reserved));r=await fetch(reserved.url,{method:'PUT',headers:{'Content-Type':mime,'x-upsert':'false'},body:bytes});if(!r.ok)throw Error('upload failed');r=await fetch('/api/chat/attachments/'+reserved.id,{method:'POST'});if(!r.ok)throw Error(await r.text());return reserved.id;},{scope,base64:bytes.toString('base64'),name,mime});}
const get=(page,path)=>page.evaluate(async path=>(await fetch(path)).json(),path);
async function login(p,email){await signIn(p,base,email,{composer:'textarea[aria-label^="Message "]'});}
const click=async(p,text)=>{const found=await p.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);b?.click();return Boolean(b);},text);assert.ok(found,text);};
async function select(p,id,name){await p.bringToFront();await p.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),id);await p.waitForFunction(name=>document.querySelector('header[data-dm="true"] h1')?.textContent===name,{},name);await p.waitForSelector('#dm-body',{visible:true});}// Composer focus on open is not what this test checks (on this phone viewport it is not focused).

try{
 const p=await browser.newPage();await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await login(p,'alice@example.test');const list=await get(p,'/api/chat/inbox'),dm=list.conversations.find(c=>c.otherName==='Bob');if(dm.status==='pending')assert.equal((await post(p,{action:'accept',target:dm.id})).status,200);
 {const ids=[await upload(p,{conversationId:dm.id},wide,'s05-wide.png','image/png'),await upload(p,{conversationId:dm.id},gif,'s05-bounds.gif','image/gif')];assert.equal((await post(p,{action:'send',target:dm.id,body:'S05 image bounds',attachmentIds:ids,clientId:randomUUID()})).status,200);}
 await select(p,dm.id,'Bob');await p.waitForSelector('section[aria-label="Private conversation"] button[aria-label^="Enlarge"]');const buttons=await p.$$('section[aria-label="Private conversation"] button[aria-label^="Enlarge"]');assert.ok(buttons.length>0);for(const b of buttons){await b.evaluate(e=>e.scrollIntoView({block:'center'}));await p.waitForFunction(e=>{const image=e.querySelector('img');return image?.complete&&image.naturalWidth>0;},{},b);const rect=await b.evaluate(e=>{const r=e.getBoundingClientRect(),article=e.closest('article'),a=article.getBoundingClientRect(),s=getComputedStyle(article);return {right:r.right,left:r.left,width:r.width,limit:a.right-parseFloat(s.paddingRight)-parseFloat(s.borderRightWidth)};});assert.ok(rect.right<=rect.limit+1,JSON.stringify(rect));assert.ok(rect.left>=0&&rect.right<=390,JSON.stringify(rect));}await p.screenshot({path:'/tmp/s05-dm-images-mobile.png'});console.log('PASS mobile thumbnail bounds inside bubble content padding, not clipped by ancestors.',buttons.length);
}finally{await browser.close();}
