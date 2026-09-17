import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
await writeFile('/tmp/chat-scout-test.pdf','%PDF-1.4\nShortScout attachment fixture\n%%EOF');
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.setViewport({width:390,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:54404/test/scout');await page.waitForSelector('textarea[aria-label="Message SS"]');
 const input=await page.$('input[type="file"][aria-label="Attach files"]');await input.uploadFile('/tmp/chat-scout-test.pdf');
 await page.waitForFunction(()=>document.querySelector('ul[aria-label="Attachment drafts"]')?.textContent.includes('Ready to send'));
 await page.click('button[type="submit"][data-state]');await page.waitForFunction(()=>document.querySelector('[aria-label="Message attachments"]')?.textContent.includes('chat-scout-test.pdf'));
 await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>document.querySelector('[aria-label="Message attachments"]')?.textContent.includes('chat-scout-test.pdf'));
 const status=await page.evaluate(async()=>{const a=document.querySelector('[aria-label="Message attachments"] a');const r=await fetch(a.href);return {code:r.status,type:r.headers.get('content-type')};});assert.deepEqual(status,{code:200,type:'application/pdf'});
 const denied=await page.evaluate(async()=>{const r=await fetch('/api/chat/attachments?room=main&ids=10000000-0000-4000-8000-000000000001');return r.status;});assert.equal(denied,404);
 assert.deepEqual(errors,[]);console.log('PASS ShortScout-only session upload, attachment-only post, server history reload, download, and Longboard room denial.');
}finally{await browser.close();}
