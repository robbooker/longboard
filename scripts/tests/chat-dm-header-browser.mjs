import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base='http://localhost:3272',nav='nav[aria-label="Chat rooms"]',pane='section[aria-label="Private conversation"]';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const clickText=async(p,text)=>{for(const b of await p.$$('button'))if(await b.evaluate((e,t)=>e.textContent.trim()===t,text)){await b.click();return;}throw Error(text);};
async function select(p){if(await p.$eval(nav,e=>getComputedStyle(e).display==='none'))await p.click('button[aria-label="Open room navigation"]');await p.waitForSelector(`${nav} button[data-active]`,{visible:true});for(const b of await p.$$(`${nav} button[data-active]`))if(await b.evaluate(e=>e.textContent.includes('Bob'))){await b.click();break;}await p.waitForSelector('header[data-dm="true"]');}
try{for(const [width,popout] of [[1440,false],[390,false],[320,true]]){
 console.log('Testing viewport',width);const context=await browser.createBrowserContext(),p=await context.newPage();await p.setViewport({width,height:900});
 await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email','alice@example.test');await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label="Message LB"]');await p.waitForNetworkIdle({idleTime:500,timeout:15000});if(popout){await p.goto(base+'/chat?room=main&popout=1');await p.waitForSelector('textarea[aria-label="Message LB"]');await p.waitForNetworkIdle({idleTime:500,timeout:15000});}
 await p.type('textarea[aria-label="Message LB"]','Room draft stays');console.log('select',width);await select(p);console.log('selected',width);
 if(await p.$$eval('button',els=>els.some(e=>e.textContent==='Accept request')))await clickText(p,'Accept request');
 await p.waitForSelector('#dm-body');
 assert.equal(await p.$(`${pane} header`),null);assert.equal(await p.$(`${pane} select[aria-label="Conversation DM sound"]`),null);
 assert.equal(await p.$eval('header[data-dm="true"]',e=>e.textContent.includes('Private conversation')),false);
 const geometry=await p.$eval('header[data-dm="true"]',h=>{const r=h.getBoundingClientRect(),items=[h.querySelector('h1'),h.querySelector('button[aria-label^="Back to"]'),h.querySelector('button[aria-label="Search chat"]'),h.querySelector('button[aria-label^="Chat notifications"]'),h.querySelector('button[aria-label="Chat settings"]')].map(e=>e.getBoundingClientRect());return {height:r.height,contained:items.every(x=>x.top>=r.top&&x.bottom<=r.bottom&&x.right<=r.right),overflow:document.documentElement.scrollWidth>innerWidth};});assert.ok(geometry.height<=76&&geometry.contained&&!geometry.overflow,JSON.stringify(geometry));
 await p.screenshot({path:`/tmp/dm-header-${width}.png`});
 console.log('settings',width);await p.click('button[aria-label="Chat settings"]');await clickText(p,'DM settings');await p.waitForSelector('[data-dm-settings][open] select',{visible:true});await p.select('select[aria-label="Conversation DM sound"]','pulse');assert.equal(await p.$eval('select[aria-label="Conversation DM sound"]',e=>e.value),'pulse');
 const global='details:not([data-dm-settings])[class*=soundSettings]';await p.click(global+' summary');await p.click(global+' input[type=checkbox]');await clickText(p,'Test conversation sound');
 await p.screenshot({path:`/tmp/dm-header-settings-${width}.png`});
 if(width<1100)await clickText(p,'Back to chat →');
 await p.click('button[aria-label^="Chat notifications"]');await p.waitForSelector('section[aria-label="Chat notifications"]');await p.keyboard.press('Escape');
 console.log('back',width);await p.click('button[aria-label="Back to LB room"]');await p.waitForSelector('textarea[aria-label="Message LB"]',{visible:true});assert.equal(await p.$eval('textarea[aria-label="Message LB"]',e=>e.value),'Room draft stays');
 console.log('select',width);await select(p);console.log('selected',width);await p.click('button[aria-label="Search chat"]');await p.waitForSelector('header[data-dm="false"]');
 await context.close();
}console.log('PASS compact single header at1440/390/320popout, request acceptance, menu-only sound access/test, bell, search and back navigation with preserved room draft');}finally{await browser.close();}
