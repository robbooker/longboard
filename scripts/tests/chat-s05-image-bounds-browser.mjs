import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
const base='http://localhost:3284';
await writeFile('/tmp/s03-dm.gif',Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const post=(page,body)=>page.evaluate(async body=>{const r=await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},body);
const get=(page,path)=>page.evaluate(async path=>(await fetch(path)).json(),path);
async function login(p,email){await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label^="Message "]');}
const click=async(p,text)=>{const found=await p.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);b?.click();return Boolean(b);},text);assert.ok(found,text);};
async function select(p,id,name){await p.bringToFront();await p.evaluate(id=>window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:id})),id);await p.waitForFunction(name=>document.querySelector('header[data-dm="true"] h1')?.textContent===name,{},name);await p.waitForSelector('#dm-body',{visible:true});await p.waitForFunction(()=>document.activeElement?.id==='dm-body');}

try{
 const p=await browser.newPage();await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await login(p,'alice@example.test');const list=await get(p,'/api/chat/inbox'),dm=list.conversations.find(c=>c.otherName==='Bob');await select(p,dm.id,'Bob');await p.waitForSelector('section[aria-label="Private conversation"] button[aria-label^="Enlarge"]');const buttons=await p.$$('section[aria-label="Private conversation"] button[aria-label^="Enlarge"]');assert.ok(buttons.length>0);for(const b of buttons){await b.evaluate(e=>e.scrollIntoView({block:'center'}));await p.waitForFunction(e=>{const image=e.querySelector('img');return image?.complete&&image.naturalWidth>0;},{},b);const rect=await b.evaluate(e=>{const r=e.getBoundingClientRect(),article=e.closest('article'),a=article.getBoundingClientRect(),s=getComputedStyle(article);return {right:r.right,left:r.left,width:r.width,limit:a.right-parseFloat(s.paddingRight)-parseFloat(s.borderRightWidth)};});assert.ok(rect.right<=rect.limit+1,JSON.stringify(rect));assert.ok(rect.left>=0&&rect.right<=390,JSON.stringify(rect));}await p.screenshot({path:'/tmp/s05-dm-images-mobile.png'});console.log('PASS mobile thumbnail bounds inside bubble content padding, not clipped by ancestors.',buttons.length);
}finally{await browser.close();}
