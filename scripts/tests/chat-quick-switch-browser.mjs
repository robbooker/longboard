// QUICK-SWITCH: Ctrl/⌘K jumps to a room or DM by typing; ↑ in an empty message box edits your last message.
// Run with the shared chat fixture: fxbatch.sh chat-mobile-fixture.mjs:chat-quick-switch-browser.mjs
import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
const base='http://localhost:3204';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--blink-settings=primaryPointerType=4,primaryHoverType=2,availablePointerTypes=4,availableHoverTypes=2']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const p=await browser.newPage();await p.setViewport({width:1440,height:900});
 await signIn(p,base,'alice@example.test',{composer:'textarea[aria-label="Message LB"]'});
 await p.waitForFunction(()=>Object.keys(document.querySelector('textarea')).some(k=>k.startsWith('__reactProps')));await sleep(1500);
 // Ctrl+K, type, Enter: room.
 await p.keyboard.down('Control');await p.keyboard.press('k');await p.keyboard.up('Control');
 await p.waitForSelector('dialog[aria-label="Jump to a room or conversation"][open] input');
 assert.ok(await p.$$eval('[role="listbox"] [role="option"]',o=>o.length)>=2,'rooms listed');
 await p.keyboard.type('soc');await p.keyboard.press('Enter');
 await p.waitForSelector('textarea[aria-label="Message Social"]',{timeout:20000});
 assert.equal(await p.$('dialog[aria-label="Jump to a room or conversation"][open]'),null,'switcher closes');
 console.log('PASS Ctrl+K to a room');
 // Escape closes without moving.
 await p.keyboard.down('Control');await p.keyboard.press('k');await p.keyboard.up('Control');
 await p.waitForSelector('dialog[aria-label="Jump to a room or conversation"][open] input');await p.keyboard.press('Escape');await sleep(300);
 assert.equal(await p.$('dialog[aria-label="Jump to a room or conversation"][open]'),null);assert.ok(await p.$('textarea[aria-label="Message Social"]'));
 // DM by name (Bob has a request open with Alice in the fixture).
 await p.keyboard.down('Control');await p.keyboard.press('k');await p.keyboard.up('Control');
 await p.waitForSelector('dialog[aria-label="Jump to a room or conversation"][open] input');await p.keyboard.type('bob');await sleep(200);
 // The DM list fills the switcher when it arrives (it can still be loading on a cold dev server).
 await p.waitForFunction(()=>/Bob/.test(document.querySelector('[role="option"][aria-selected="true"]')?.textContent??''),{timeout:30000});
 const hint=await p.$eval('[role="option"][aria-selected="true"]',e=>e.textContent);assert.match(hint,/Bob.*Direct message/);
 await p.keyboard.press('Enter');await p.waitForFunction(()=>[...document.querySelectorAll('header')].some(h=>/Bob/.test(h.textContent))&&!!document.querySelector('[aria-label="Private conversation"]'),{timeout:20000});
 console.log('PASS Ctrl+K to a DM');
 // ↑ edits the last own message in LB.
 await p.goto(base+'/chat?room=main');await p.waitForSelector('textarea[aria-label="Message LB"]');await sleep(1500);
 await p.click('textarea[aria-label="Message LB"]');await p.keyboard.press('ArrowUp');
 await p.waitForFunction(()=>[...document.querySelectorAll('dialog[open]')].some(d=>/Edit message/.test(d.textContent)),{timeout:10000});
 const editing=await p.evaluate(()=>[...document.querySelectorAll('dialog[open] textarea')].map(t=>t.value).join('|'));
 assert.ok(editing.length>0,'edit box has the message');
 console.log('PASS up arrow edits last message:',editing.slice(0,40));
}finally{await browser.close();}
