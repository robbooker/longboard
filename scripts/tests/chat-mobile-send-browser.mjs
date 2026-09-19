import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import http from 'node:http';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`import {beginMobileSend,watchChatViewport} from './lib/chatMobileSend';
const page=document.querySelector('main'),pane=document.querySelector('#messages'),input=document.querySelector('textarea');watchChatViewport(page);
window.start=(mode='room')=>{pane.hidden=false;input.value='sending';input.focus();pane.scrollTop=0;window.current=true;window.pending=beginMobileSend(input,pane,()=>window.current);input.value='';const message=document.createElement('article');message.id='latest';message.textContent='My newly sent '+mode+' message';pane.querySelector('#latest')?.remove();pane.append(message);};
window.confirm=()=>window.pending.confirmed();window.fail=()=>{window.pending.cancel();input.value='failed draft';};
`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false});
const html=`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}main{height:var(--chat-visual-height,100dvh);display:flex;flex-direction:column}header{height:60px;flex-shrink:0}#messages{flex:1;overflow:auto;min-height:0}article{height:70px;padding:10px}form{height:120px;flex-shrink:0}textarea{height:70px;width:100%;font-size:16px}</style><main><header>Chat</header><div id="messages">${'<article>Earlier message</article>'.repeat(40)}</div><form><textarea></textarea><button type="button">Send</button></form></main><script src="/bundle.js"></script>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].contents:html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage();const url=`http://127.0.0.1:${server.address().port}`;const load=async width=>{await page.setViewport({width,height:800});await page.goto(url);await page.waitForFunction(()=>!!window.start);};
 for(const mode of ['room','dm','thread']){
  await load(390);await page.setViewport({width:390,height:460});await page.evaluate(mode=>window.start(mode),mode);
  await page.waitForFunction(()=>{const pane=document.querySelector('#messages');return pane.scrollHeight-pane.scrollTop-pane.clientHeight<2;});
  assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA','optimistic send keeps keyboard until success');
  await page.evaluate(()=>window.confirm());assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
  await page.setViewport({width:390,height:800});await page.waitForFunction(()=>{const pane=document.querySelector('#messages'),latest=document.querySelector('#latest');return Math.abs(document.querySelector('main').getBoundingClientRect().bottom-window.innerHeight)<2&&latest.getBoundingClientRect().bottom<=pane.getBoundingClientRect().bottom+1;});
 }
 await load(390);await page.evaluate(()=>window.start());await page.type('textarea','next draft');await page.evaluate(()=>window.confirm());assert.equal(await page.$eval('textarea',e=>e.value),'next draft');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
 await load(390);await page.evaluate(()=>{window.start();window.fail();});assert.equal(await page.$eval('textarea',e=>e.value),'failed draft');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
 await load(390);await page.evaluate(()=>{window.start();document.querySelector('#messages').dispatchEvent(new Event('touchmove'));document.querySelector('#messages').scrollTop=0;window.confirm();});await page.waitForFunction(()=>document.querySelector('#messages').scrollTop===0);assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
 await load(390);await page.evaluate(()=>{window.start();document.querySelector('#messages').hidden=true;window.confirm();});assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
 await load(390);await page.evaluate(()=>{window.start();window.current=false;document.querySelector('#messages').scrollTop=0;window.confirm();});assert.equal(await page.$eval('#messages',e=>e.scrollTop),0);assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
 await load(1440);await page.evaluate(()=>{window.start();window.confirm();});assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA','desktop retains focus');assert.equal(await page.$eval('#messages',e=>e.scrollTop),0,'desktop scrolling untouched');
 console.log(JSON.stringify({mobileAcknowledgementAndViewport:['room','dm','thread'],optimisticVisible:true,newDraftPreserved:true,failurePreserved:true,userScrollPreserved:true,hiddenConversationUntouched:true,changedScopeUntouched:true,desktopUnchanged:true}));
}finally{await browser.close();server.close();}
