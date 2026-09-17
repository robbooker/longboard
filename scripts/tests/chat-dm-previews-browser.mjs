import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:1000});
 await page.setRequestInterception(true);
 page.on('request',request=>{const url=new URL(request.url());if(['s3.tradingview.com','media.giphy.com'].includes(url.hostname)){if(url.pathname.includes('BadChart'))void request.abort();else void request.respond({status:200,contentType:'image/gif',body:gif});}else void request.continue();});
 await page.goto('http://localhost:3204/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector('textarea[aria-label="Message LB"]');
 const dm='section[aria-label="Private inbox"]';
 const clickText=async(text)=>{for(const h of await page.$$(`${dm} button`)){if((await h.evaluate(e=>e.textContent))===text){await h.click();return;}}throw Error(`Missing ${text}`);};
 await page.waitForSelector('nav[aria-label="Chat rooms"] button[data-active]');await page.evaluate(()=>[...document.querySelectorAll('nav[aria-label="Chat rooms"] button[data-active]')].find(e=>e.textContent.includes('Bob')).click());await page.waitForFunction(()=>document.querySelector('section[aria-label="Private inbox"]')?.textContent.includes('Bob'));if(await page.$eval(dm,e=>e.textContent.includes('Accept request')))await clickText('Accept request');await page.waitForSelector('#dm-body',{visible:true});
 const body=`Run ${Date.now()} Chart https://www.tradingview.com/x/Ab12Cd34/ GIF https://giphy.com/gifs/abc123DEF ordinary https://example.com/read`;
 await page.type('#dm-body',body);await clickText('Send message');
 await page.waitForSelector(`${dm} a[aria-label="Open TradingView chart Ab12Cd34 in a new tab"] img`);
 await page.waitForSelector(`${dm} img[alt="Shared GIF"]`);
 assert.equal(await page.$eval(`${dm} a[href="https://example.com/read"]`,e=>e.textContent),'https://example.com/read');
 assert.equal(await page.$eval(`${dm} a[href="https://example.com/read"]`,e=>e.rel),'noopener noreferrer');
 await page.waitForFunction(()=>document.querySelector('#dm-body').value==='');
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('nav[aria-label="Chat rooms"] button[data-active]');await page.evaluate(()=>[...document.querySelectorAll('nav[aria-label="Chat rooms"] button[data-active]')].find(e=>e.textContent.includes('Bob')).click());await page.waitForSelector(`${dm} img[alt="Shared GIF"]`);
 for(const width of [1440,768,390,320]) {await page.setViewport({width,height:1000});await page.waitForSelector('#dm-body',{visible:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.$eval('#dm-body',e=>{const container=e.closest('section,dialog');return container.scrollWidth>container.clientWidth;}),false);}
 await page.screenshot({path:'/tmp/dm-previews-mobile.png'});
 await page.setViewport({width:1440,height:1000});await page.type('#dm-body','Unavailable chart https://www.tradingview.com/x/BadChart/');await clickText('Send message');
 await page.waitForFunction(()=>[...document.querySelectorAll('a[aria-label="Open TradingView chart BadChart in a new tab"]')].some(e=>e.textContent.includes('PREVIEW UNAVAILABLE')));
 // A second authenticated browser posts as Bob. Alice receives its preview on
 // the existing history poll without clicking or re-opening the conversation.
 const context=await browser.createBrowserContext();const bob=await context.newPage();await bob.goto('http://localhost:3204/login?next=%2Fchat');await bob.waitForSelector('#li-email');await bob.reload({waitUntil:'networkidle0'});await bob.type('#li-email','bob@example.test');await bob.type('#li-password','demo-only');await bob.click('button[type="submit"]');await bob.waitForSelector('textarea[aria-label="Message LB"]');
 const sent=await bob.evaluate(async()=>{const data=await(await fetch('/api/chat/inbox')).json();const c=data.conversations.find(c=>c.status==='accepted');const r=await fetch('/api/chat/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',target:c.id,body:'Incoming https://www.tradingview.com/x/Receive1/',clientId:crypto.randomUUID()})});return {status:r.status,data:await r.json()};});assert.equal(sent.status,200,JSON.stringify(sent));
 await page.waitForSelector(`${dm} a[aria-label="Open TradingView chart Receive1 in a new tab"]`,{timeout:20000});
 await page.screenshot({path:'/tmp/dm-previews-desktop.png'});assert.deepEqual(errors,[]);
 console.log('PASS DM send/history/receive previews, ordinary links, unavailable preview fallback, safe external link attributes, 320/390/768/1440 layouts and no runtime errors.');
}finally{await browser.close();}
