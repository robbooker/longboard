// Isolated shared-hook regression. Real Chromium keyboard clipboard; mocked
// reserve/storage/scanner responses, no production credentials or messages.
import {build} from 'esbuild'; // Installed with the repository's tsx tooling.
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const root=new URL('../../',import.meta.url).pathname;
const dir=await mkdtemp(join(tmpdir(),'chat-clipboard-'));
const port=Number(process.env.CHAT_CLIPBOARD_PORT||3340),base=`http://localhost:${port}`;
const reservations=[],transfers=[],scans=[];let rejectScan=false;
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {useAttachments} from './components/chat/hooks/useAttachments';
function Composer({scope}){const u=useAttachments(scope);return <main><textarea aria-label="Message" onPaste={u.paste}/><p role="alert">{u.error}</p><button disabled={u.blocked}>Send</button><button onClick={u.clear}>Clear</button>{u.files.map(f=><div key={f.key} data-state={f.state}><img src={f.preview} alt={f.name}/><span>{f.state} {f.error}</span></div>)}</main>}
const root=createRoot(document.getElementById('root'));window.mount=scope=>root.render(<Composer key={JSON.stringify(scope)} scope={scope}/>);window.mount('social');`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:join(dir,'bundle.js'),define:{'process.env.NODE_ENV':'"development"'}});
const server=createServer(async(req,res)=>{
 const send=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');return;}
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(dir,'bundle.js')));return;}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
 if(req.url==='/api/chat/attachments'&&req.method==='POST'){reservations.push(JSON.parse(body));return send({id:`attachment-${reservations.length}`,url:`${base}/upload`});}
 if(req.url==='/upload'){transfers.push(body);return send({});}
 if(req.method==='POST'&&req.url.startsWith('/api/chat/attachments/')){scans.push(req.url);await new Promise(r=>setTimeout(r,250));return send(rejectScan?{error:'File did not pass malware scanning.'}:{},rejectScan?422:200);}
 return send({});
});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
let browser;
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=browser.defaultBrowserContext();await context.overridePermissions(base,['clipboard-read','clipboard-write','clipboard-sanitized-write']);
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForSelector('textarea');
 await page.evaluate(()=>{window.pastes=[];document.addEventListener('paste',e=>window.pastes.push({trusted:e.isTrusted,types:[...e.clipboardData.types]}));});
 const clear=async()=>{await page.click('button:nth-of-type(2)');await page.waitForFunction(()=>!document.querySelector('[data-state]'));};
 // The OS/browser paste route must actually emit a trusted event, not just a
 // synthetic ClipboardEvent. Canvas represents a copied screenshot.
 for(const scope of ['social','general',{conversationId:'fixture-dm'}]){
  await page.evaluate(scope=>window.mount(scope),scope);await page.waitForSelector('textarea');
  await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;canvas.getContext('2d').fillRect(0,0,20,20);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);});
  await page.click('textarea');await page.keyboard.down('Control');await page.keyboard.press('V');await page.keyboard.up('Control');
  await page.waitForSelector('[data-state="scanning"]');assert.equal(await page.$eval('button',e=>e.disabled),true);
  await page.waitForSelector('[data-state="ready"]');assert.equal(await page.$eval('img',e=>e.complete&&e.naturalWidth>0),true);
  assert.deepEqual(typeof scope==='string'?{room:reservations.at(-1).room}:{conversationId:reservations.at(-1).conversationId},typeof scope==='string'?{room:scope}:scope);
  await clear();
 }
 assert.equal((await page.evaluate(()=>window.pastes.filter(e=>e.trusted&&e.types.includes('Files')).length)),3);
 // Browser-generated names vary across clipboard producers. Reproduce the
 // previously failing name while retaining real PNG bytes and the upload hook.
 const paste=async(name,type='image/png')=>page.evaluate(async({name,type})=>{const canvas=document.createElement('canvas');const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],name,{type}));document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},{name,type});
 for(const name of ['image','image.tiff','Screenshot/Today.png']){await paste(name);await page.waitForSelector('[data-state="ready"]');assert.equal(reservations.at(-1).filename,'pasted-image.png');await clear();}
 const count=reservations.length;await paste('image','image/tiff');await page.waitForFunction(()=>document.querySelector('[role=alert]').textContent.includes('JPEG, PNG or GIF'));assert.equal(reservations.length,count);
 rejectScan=true;await paste('image');await page.waitForSelector('[data-state="error"]');assert.equal(await page.$eval('button',e=>e.disabled),true);assert.match(await page.$eval('[data-state]',e=>e.textContent),/malware/);await clear();
 await page.evaluate(()=>navigator.clipboard.writeText('ordinary text'));await page.click('textarea');await page.keyboard.down('Control');await page.keyboard.press('V');await page.keyboard.up('Control');await page.waitForFunction(()=>document.querySelector('textarea').value==='ordinary text');
 assert.equal(transfers.length,7);assert.equal(scans.length,7);assert.deepEqual(errors,[]);
 console.log('PASS: trusted Ctrl+V PNG paste for two room scopes and DM; previews/upload/scanning; malformed filenames; unsupported TIFF guidance; scan rejection blocks send; native text paste. API/storage/scanner isolated; WebKit and complete composer UI not exercised.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
