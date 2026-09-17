import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
await writeFile('/tmp/chat-test.gif',gif);await writeFile('/tmp/chat-test.pdf','%PDF-1.4\nIsolated document fixture\n%%EOF');await writeFile('/tmp/chat-reject.pdf','%PDF-1.4\nEICAR-STANDARD-ANTIVIRUS-TEST-FILE');await writeFile('/tmp/chat-bad.txt','unsupported');
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:1000});
 await page.goto('http://localhost:3204/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 const clickText=async(text,scope='')=>{for(const h of await page.$$(`${scope} button`)){if((await h.evaluate(e=>e.textContent)).includes(text)){await h.click();return;}}throw Error(`Missing ${text}`);};
 await page.click('button[aria-label="Add to message"]');const chooser=page.waitForFileChooser();await clickText('Attach file');await (await chooser).accept(['/tmp/chat-test.gif','/tmp/chat-test.pdf']);
 await page.waitForFunction(()=>document.querySelector('ul[aria-label="Attachment drafts"]')?.textContent.includes('Scanning for malware'));
 assert.equal(await page.$eval('button[type="submit"][data-state]',e=>e.disabled),true);
 await page.waitForFunction(()=>[...document.querySelectorAll('ul[aria-label="Attachment drafts"] li')].length===2&&[...document.querySelectorAll('ul[aria-label="Attachment drafts"] li')].every(e=>e.textContent.includes('Ready to send')));
 for(const width of [320,390,768,1440]){await page.setViewport({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.screenshot({path:'/tmp/chat-attachments-draft-desktop.png'});
 // Attachment-only post; bytes travel to storage and then through the real finalizer with the isolated scanner fixture.
 await page.click('button[type="submit"][data-state]');
 await page.waitForSelector('[aria-label="Message attachments"] img');
 await page.waitForFunction(()=>!document.querySelector('ul[aria-label="Attachment drafts"]'));
 const result=await page.evaluate(async()=>{const a=document.querySelector('[aria-label="Message attachments"] a');const r=await fetch(a.href);return {status:r.status,type:r.headers.get('content-type'),size:(await r.arrayBuffer()).byteLength};});assert.equal(result.status,200);assert.equal(result.type,'image/gif');assert.equal(result.size,gif.length);
 // Reload proves IDs/metadata persist and images render from authenticated retrieval.
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('[aria-label="Message attachments"] img');
 await page.evaluate(()=>{const article=document.querySelector('[aria-label="Message attachments"]').closest('article');[...article.querySelectorAll('button')].find(b=>b.textContent.includes('Reply')).click();});
 await page.waitForSelector('aside[aria-label="Comment replies"] #thread-reply');
 const replyInput=await page.$('aside[aria-label="Comment replies"] input[type="file"]');await replyInput.uploadFile('/tmp/chat-test.pdf');
 await page.waitForFunction(()=>document.querySelector('aside ul[aria-label="Attachment drafts"]')?.textContent.includes('Ready to send'));
 await clickText('Send reply','aside[aria-label="Comment replies"]');await page.waitForFunction(()=>[...document.querySelectorAll('aside [aria-label="Message attachments"]')].length===2);
 await page.setViewport({width:390,height:844});await page.screenshot({path:'/tmp/chat-attachments-thread-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.click('button[aria-label="Close replies"]');
 let input=await page.$('input[type="file"][aria-label="Attach files"]');await input.uploadFile('/tmp/chat-reject.pdf');await page.waitForFunction(()=>document.querySelector('ul[aria-label="Attachment drafts"]')?.textContent.includes('did not pass'));
 assert.equal(await page.$eval('button[type="submit"][data-state]',e=>e.disabled),true);await page.click('button[aria-label="Remove chat-reject.pdf"]');
 input=await page.$('input[type="file"][aria-label="Attach files"]');await input.uploadFile('/tmp/chat-bad.txt');await page.waitForFunction(()=>document.body.textContent.includes('Choose a PDF, JPEG, PNG or GIF file.'));
 // Clipboard image is only a draft, never an immediate message.
 await page.evaluate(base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'pasted.gif',{type:'image/gif'}));document.querySelector('textarea[aria-label="Message LB"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},gif.toString('base64'));
 await page.waitForFunction(()=>document.querySelector('ul[aria-label="Attachment drafts"]')?.textContent.includes('Ready to send'));
 await page.screenshot({path:'/tmp/chat-attachments-paste-mobile.png'});await page.click('button[aria-label="Remove pasted.gif"]');
 assert.deepEqual(errors,[]);console.log('PASS attachment menu, direct upload/scanning state, 320/390/768/1440 layouts, attachment-only send/reload/download, threaded attachment reply, scan rejection, type rejection, clipboard draft/removal and no runtime errors.');
}catch(e){console.error(e);throw e;}finally{await browser.close();}
