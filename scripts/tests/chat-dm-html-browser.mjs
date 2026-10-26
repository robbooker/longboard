// D-308: HTML files in DMs. Synthetic local fixture only (shared chat fixture on its own ports).
// A DM accepts an .html file, scans it and shows a file chip; the chip downloads it (never opens
// it), every serving URL answers with download-only headers, and rooms refuse HTML.
// Optional: DMHTML_SHOTS=<dir> saves phone (390) and computer (1280) screenshots.
import {mkdtemp,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import puppeteer from 'puppeteer';import assert from 'node:assert/strict';
const base=process.env.CHAT_TEST_URL||'http://localhost:3308',shots=process.env.DMHTML_SHOTS||'';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const dm='section[aria-label="Private conversation"]',errors=[];
const work=await mkdtemp(join(tmpdir(),'dm-html-'));
const html='<!doctype html>\n<title>Chart notes</title>\n<script>document.title="RAN"</script>\n<p>Synthetic chart notes · test fixture</p>\n';
const files={page:join(work,'chart-notes.html'),old:join(work,'legacy.htm'),bad:join(work,'binary.html'),pdf:join(work,'notes.pdf')};
await writeFile(files.page,html);await writeFile(files.old,'<p>no html tag needed</p>');await writeFile(files.bad,Buffer.from([0x3c,0x70,0x3e,0,1,2,0x4d,0x5a]));await writeFile(files.pdf,'%PDF-1.7\nSynthetic');
async function login(email,width){const c=await browser.createBrowserContext(),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width,height:900});await p.goto(`${base}/login?next=%2Fchat`);await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label^="Message "]');await p.waitForFunction(()=>{const e=document.querySelector('button[aria-label="Add to message"]');return e&&Object.keys(e).some(k=>k.startsWith('__reactProps$'));});return p;}
async function api(p,body){return p.evaluate(async body=>{const r=await fetch('/api/chat/inbox',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json()};},body);}
async function textButton(p,scope,text){for(const h of await p.$$(`${scope} button`))if((await h.evaluate(e=>e.textContent)).trim()===text){await h.click();return;}throw Error(`Missing ${text}`);}
async function select(p,name){await p.waitForSelector('nav button[data-active]');if(await p.$eval('nav[aria-label="Chat rooms"]',e=>getComputedStyle(e).display==='none'))await p.click('button[aria-label="Open room navigation"]');await p.evaluate(name=>[...document.querySelectorAll('nav button[data-active]')].find(e=>e.textContent.includes(name)).click(),name);await p.waitForSelector('#dm-body',{visible:true});}
async function messages(p,id){return p.evaluate(async id=>(await(await fetch(`/api/chat/inbox?conversation=${id}`)).json()).messages,id);}
async function head(p,url){return p.evaluate(async url=>{const r=await fetch(url,{redirect:'manual'});const h=Object.fromEntries(['content-type','content-disposition','x-content-type-options','content-security-policy','cache-control','location'].map(k=>[k,r.headers.get(k)]));return {status:r.status,headers:h,body:r.status===200?await r.text():''};},url);}
const shot=async(p,name)=>{if(shots)await p.screenshot({path:join(shots,`${name}.png`)});};
const roomInput=p=>p.evaluateHandle(()=>[...document.querySelectorAll('input[type=file][aria-label="Attach files"]')].find(e=>!e.closest('section[aria-label="Private conversation"]')));
try{
 const alice=await login('alice@example.test',1280),bob=await login('bob@example.test',390),mallory=await login('mallory@example.test',1000);
 // Rooms: the picker never offers HTML, a forced pick is refused with the room wording, and the API refuses it too.
 for(const [p,size] of [[alice,'computer'],[bob,'phone']]){
  const input=await roomInput(p);assert.equal(await input.evaluate(e=>e.accept),'.pdf,.jpg,.jpeg,.png,.gif,.wav');
  await input.uploadFile(files.page);
  await p.waitForFunction(()=>[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent==='Choose a PDF, JPEG, PNG, GIF or WAV voice file.'));
  assert.equal(await p.$('ul[aria-label="Attachment drafts"]'),null);await shot(p,`room-refuses-html-${size}`);
 }
 const roomApi=await alice.evaluate(async size=>{const r=await fetch('/api/chat/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'main',filename:'x.html',mime_type:'text/html',byte_size:size})});return {status:r.status,data:await r.json()};},html.length);
 assert.equal(roomApi.status,400);assert.equal(roomApi.data.error,'Choose a PDF, JPEG, PNG, GIF or WAV voice file.');
 // DM: open the conversation on both sides.
 const conversation=(await api(alice)).data.conversations.find(c=>c.otherName==='Bob');if(conversation.status==='pending')assert.equal((await api(alice,{action:'accept',target:conversation.id})).status,200);
 for(const [p,name] of [[alice,'Bob'],[bob,'Alice']]){await p.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));await select(p,name);}
 for(const p of [alice,bob])assert.equal(await p.$eval(`${dm} input[type=file]`,e=>e.accept),'.pdf,.jpg,.jpeg,.png,.gif,.wav,.html,.htm');
 // Bytes that are not text are refused after upload, before anything is shared.
 await (await alice.$(`${dm} input[type=file]`)).uploadFile(files.bad);
 await alice.waitForFunction(scope=>document.querySelector(scope)?.textContent.includes('The file contents do not match its type.'),{timeout:20000},dm);
 await alice.click(`${dm} button[aria-label="Remove binary.html"]`);
 // Attach a real HTML file: a file chip with name and size, no image preview.
 for(const [p,file,size] of [[alice,files.page,'computer'],[bob,files.page,'phone']]){
  await (await p.$(`${dm} input[type=file]`)).uploadFile(file);
  await p.waitForFunction(scope=>document.querySelector(scope)?.textContent.includes('Ready'),{timeout:20000},dm);
  assert.equal(await p.$(`${dm} ul[aria-label="Attachment drafts"] img`),null);
  assert.match(await p.$eval(`${dm} ul[aria-label="Attachment drafts"]`,e=>e.textContent),/chart-notes\.html.*KB/);
  await shot(p,`dm-composer-html-${size}`);
  if(p===bob){await p.click(`${dm} button[aria-label="Remove chart-notes.html"]`);continue;}
  await textButton(p,dm,'Send message');await p.waitForFunction(()=>!document.querySelector('section[aria-label="Private conversation"] ul[aria-label="Attachment drafts"]'));
 }
 const sent=(await messages(alice,conversation.id)).at(-1);assert.equal(sent.attachment_ids.length,1);const file=sent.attachment_ids[0];
 for(const p of [alice,bob]){
  await p.evaluate(()=>window.dispatchEvent(new Event('chat-inbox-refresh')));
  const chip=`[data-message-id="${sent.id}"] a[download][href="/api/chat/attachments/${file}"]`;
  await p.waitForSelector(chip,{visible:true});assert.match(await p.$eval(chip,e=>e.textContent),/^chart-notes\.html · 1 KB ↓$/);
  // Nothing renders the file: no image, frame, object or embed for it.
  assert.equal(await p.$(`[data-message-id="${sent.id}"] :is(img,iframe,object,embed)`),null);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await shot(alice,'dm-sent-html-chip-computer');await shot(bob,'dm-sent-html-chip-phone');
 // Every serving URL: forced download only.
 for(const query of ['','?preview=1']){
  const r=await head(bob,`/api/chat/attachments/${file}${query}`);
  assert.equal(r.status,200);assert.equal(r.headers['content-type'],'application/octet-stream');
  assert.match(r.headers['content-disposition'],/^attachment; filename="chart-notes\.html"/);
  assert.equal(r.headers['x-content-type-options'],'nosniff');assert.match(r.headers['content-security-policy'],/^sandbox;/);
  assert.equal(r.headers['cache-control'],'private, no-store');assert.equal(r.headers.location,null);assert.equal(r.body,html);
 }
 for(const query of ['?thumbnail=1','?play=1'])assert.equal((await head(bob,`/api/chat/attachments/${file}${query}`)).status,404);
 assert.equal((await head(mallory,`/api/chat/attachments/${file}`)).status,404);
 const listed=JSON.parse((await head(bob,`/api/chat/attachments?conversationId=${conversation.id}&ids=${file}`)).body).files;
 assert.deepEqual(listed.map(f=>[f.mime_type,f.thumbnail_available]),[['text/html',false]]);
 // Clicking the chip saves the file; the page stays put and no tab renders it.
 const downloads=await mkdtemp(join(tmpdir(),'dm-html-dl-'));
 const cdp=await browser.target().createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,browserContextId:bob.browserContext().id});
 const before=bob.url(),pages=(await bob.browserContext().pages()).length;
 await bob.click(`[data-message-id="${sent.id}"] a[download]`);
 let saved=[];for(let i=0;i<100&&!saved.some(f=>f==='chart-notes.html');i++){await new Promise(r=>setTimeout(r,100));saved=await readdir(downloads);}
 assert.ok(saved.includes('chart-notes.html'),`downloaded: ${saved}`);assert.equal(await readFile(join(downloads,'chart-notes.html'),'utf8'),html);
 assert.equal(bob.url(),before);assert.equal((await bob.browserContext().pages()).length,pages);
 assert.notEqual(await bob.title(),'RAN');
 // .htm works too.
 await (await alice.$(`${dm} input[type=file]`)).uploadFile(files.old);
 await alice.waitForFunction(scope=>document.querySelector(scope)?.textContent.includes('Ready'),{timeout:20000},dm);
 await alice.click(`${dm} button[aria-label="Remove legacy.htm"]`);
 assert.deepEqual(errors,[]);
 console.log('PASS DM HTML: picker offers HTML in DMs only, room refusal (UI+API), bad bytes refused, scanned send, file chip on phone+computer, download-only headers on every URL, real download without rendering, outsider 404.');
}finally{await browser.close();}
