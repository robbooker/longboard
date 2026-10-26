import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import http from 'node:http';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`import {beginMobileSend,watchChatViewport} from './lib/chatMobileSend';
const page=document.querySelector('main'),pane=document.querySelector('#messages'),input=document.querySelector('textarea');watchChatViewport(page);
window.start=(mode='room')=>{pane.hidden=false;input.value='sending';input.focus();pane.scrollTop=0;window.current=true;window.pending=beginMobileSend(input,pane,()=>window.current);input.value='';const message=document.createElement('article');message.id='latest';message.textContent='My newly sent '+mode+' message';pane.querySelector('#latest')?.remove();pane.append(message);};
window.beginFromButton=()=>beginMobileSend(input,pane);
window.confirm=()=>window.pending.confirmed();window.fail=()=>{window.pending.cancel();input.value='failed draft';};
`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false});
const html=`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}main{height:var(--chat-visual-height,100dvh);display:flex;flex-direction:column}header{height:60px;flex-shrink:0}#messages{flex:1;overflow:auto;min-height:0}article{height:70px;padding:10px}form{height:120px;flex-shrink:0}textarea{height:70px;width:100%;font-size:16px}</style><main><header>Chat</header><div id="messages">${'<article>Earlier message</article>'.repeat(40)}</div><form><textarea></textarea><button type="submit">Send</button><button id="other" type="button">Other action</button></form></main><script src="/bundle.js"></script>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].contents:html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage();const url=`http://127.0.0.1:${server.address().port}`;const load=async width=>{await page.setViewport({width,height:800});await page.goto(url);await page.waitForFunction(()=>!!window.start);};
 for(const mode of ['room','dm','thread']){
  await load(390);await page.setViewport({width:390,height:460});await page.evaluate(mode=>window.start(mode),mode);
  await page.waitForFunction(()=>{const pane=document.querySelector('#messages');return pane.scrollHeight-pane.scrollTop-pane.clientHeight<2;});
  assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA','optimistic send keeps keyboard until success');
  await page.evaluate(()=>window.confirm());await page.waitForFunction(()=>document.activeElement.tagName==='TEXTAREA');
  await page.setViewport({width:390,height:800});await page.waitForFunction(()=>{const pane=document.querySelector('#messages'),latest=document.querySelector('#latest');return Math.abs(document.querySelector('main').getBoundingClientRect().bottom-window.innerHeight)<2&&latest.getBoundingClientRect().bottom<=pane.getBoundingClientRect().bottom+1;});
 }
 await load(390);await page.evaluate(()=>window.start());await page.type('textarea','next draft');await page.evaluate(()=>window.confirm());assert.equal(await page.$eval('textarea',e=>e.value),'next draft');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
 await load(390);await page.evaluate(()=>{window.start();window.fail();});assert.equal(await page.$eval('textarea',e=>e.value),'failed draft');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
 await load(390);await page.evaluate(()=>{window.start();document.querySelector('#messages').dispatchEvent(new Event('touchmove'));document.querySelector('#messages').scrollTop=0;window.confirm();});await page.waitForFunction(()=>document.querySelector('#messages').scrollTop===0);assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
 await load(390);await page.evaluate(()=>{window.start();document.querySelector('#messages').hidden=true;window.confirm();});assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
 await load(390);await page.evaluate(()=>{window.start();window.current=false;document.querySelector('#messages').scrollTop=0;window.confirm();});assert.equal(await page.$eval('#messages',e=>e.scrollTop),0);assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
 await load(1440);await page.evaluate(()=>{window.start();window.confirm();});assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA','desktop retains focus');assert.equal(await page.$eval('#messages',e=>e.scrollTop),0,'desktop scrolling untouched');
 // Desktop and mobile submit buttons return focus after React unlocks the composer.
 for (const width of [390,1440]) {
  await load(width);
  await page.evaluate(()=>{
   const input=document.querySelector('textarea');input.value='sent draft';document.querySelector('button[type="submit"]').focus();
   window.pending=window.beginFromButton();input.value='';input.readOnly=true;window.confirm();
   queueMicrotask(()=>{input.readOnly=false;});
  });
  await page.waitForFunction(()=>document.activeElement===document.querySelector('textarea')&&document.activeElement.selectionStart===0);
  // Later focus must survive a delayed success, including non-input controls.
  await page.evaluate(()=>{window.start();document.querySelector('#other').focus();window.confirm();});
  await new Promise(r=>setTimeout(r,40));assert.equal(await page.evaluate(()=>document.activeElement.id),'other');
  // Pointer intent with no focusable target also cancels a pending refocus.
  await page.evaluate(()=>{window.start();document.querySelector('header').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));document.querySelector('textarea').blur();window.confirm();});
  await new Promise(r=>setTimeout(r,40));assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
  // A user-selected caret in a newer draft must not be moved by the old send.
  await page.evaluate(()=>window.start());await page.type('textarea','next draft');
  await page.evaluate(()=>{document.querySelector('textarea').setSelectionRange(2,2);window.confirm();});
  await new Promise(r=>setTimeout(r,40));assert.equal(await page.$eval('textarea',e=>e.selectionStart),2);
  // Actual success places the caret at the end, after the controlled value commit.
  await page.evaluate(()=>{window.start();const input=document.querySelector('textarea');input.value='retained';input.setSelectionRange(1,1);window.confirm();});
  await page.waitForFunction(()=>document.querySelector('textarea').selectionStart===8);
  // A background resend cannot take focus from an unrelated action.
  await page.evaluate(()=>{document.querySelector('#other').focus();window.pending=window.beginFromButton();window.confirm();});
  await new Promise(r=>setTimeout(r,40));assert.equal(await page.evaluate(()=>document.activeElement.id),'other');
 }
 // iPad: the keyboard height applies only while typing; leaving the field restores the full
 // height even when the browser never reports the keyboard closing.
 await load(820);await page.evaluate(()=>document.querySelector('textarea').blur());await page.setViewport({width:820,height:600});
 assert.equal(await page.$eval('main',m=>m.style.getPropertyValue('--chat-visual-height')),'','no field focused: no keyboard height');
 await page.focus('textarea');await page.waitForFunction(()=>document.querySelector('main').style.getPropertyValue('--chat-visual-height')==='600px');
 await page.evaluate(()=>document.querySelector('#other').focus());
 await page.waitForFunction(()=>document.querySelector('main').style.getPropertyValue('--chat-visual-height')==='');
 await page.setViewport({width:820,height:800});
 // D-313: iPhone Safari keeps the page full height when the keyboard opens and slides the visible
 // part down to the field instead. Fake that visual viewport: the shortened page must start where
 // the visible part starts, so the composer sits just above the keyboard with the messages above it.
 const iphone=async()=>{
  const fake=await page.evaluateHandle(()=>{const v=new EventTarget();Object.assign(v,{width:innerWidth,height:innerHeight,offsetTop:0,offsetLeft:0,pageTop:0,pageLeft:0,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>v});return v;});
  await fake.dispose();
 };
 const keyboard=(height,top)=>page.evaluate((height,top)=>{const v=window.visualViewport;Object.assign(v,{height,offsetTop:top,pageTop:top+scrollY});v.dispatchEvent(new Event('resize'));v.dispatchEvent(new Event('scroll'));},height,top);
 const boxes=()=>page.evaluate(()=>{const r=e=>{const b=document.querySelector(e).getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom)};};return {main:r('main'),input:r('textarea'),messages:r('#messages')};});
 await page.setViewport({width:390,height:844});await page.goto(url);await page.waitForFunction(()=>!!window.start);
 // The watcher reads the visual viewport on every event, so swapping it in after load is enough.
 await iphone();await page.focus('textarea');await keyboard(480,364);
 await page.waitForFunction(()=>Math.round(document.querySelector('main').getBoundingClientRect().top)===364);
 let shown=await boxes();
 assert.equal(shown.main.bottom,844,'page ends at the keyboard');
 assert(shown.input.top>=364&&shown.input.bottom<=844,'composer inside the visible part above the keyboard: '+JSON.stringify(shown));
 assert(shown.messages.bottom-shown.messages.top>=250,'conversation stays visible above the composer: '+JSON.stringify(shown));
 // Safari settles the slide in steps; the page follows each one.
 await keyboard(480,300);await page.waitForFunction(()=>Math.round(document.querySelector('main').getBoundingClientRect().top)===300);
 // Closing the keyboard restores the full screen.
 await page.evaluate(()=>document.querySelector('textarea').blur());await keyboard(844,0);
 await page.waitForFunction(()=>document.querySelector('main').style.transform===''&&document.querySelector('main').style.getPropertyValue('--chat-visual-height')==='');
 shown=await boxes();assert.equal(shown.main.top,0);assert.equal(shown.main.bottom,844);
 // Android-style browsers shrink the page themselves: no slide, so nothing moves.
 await page.focus('textarea');await keyboard(480,0);await page.waitForFunction(()=>document.querySelector('main').style.getPropertyValue('--chat-visual-height')==='480px');
 assert.equal(await page.$eval('main',m=>m.style.transform),'','no move without a slide');
 // Computers are untouched even if the browser reports a slide.
 await page.setViewport({width:1440,height:900});await page.goto(url);await page.waitForFunction(()=>!!window.start);await iphone();await page.focus('textarea');await keyboard(500,300);
 await new Promise(r=>setTimeout(r,100));assert.equal(await page.$eval('main',m=>m.style.transform+m.style.getPropertyValue('--chat-visual-height')),'','desktop untouched');
 console.log(JSON.stringify({mobileAcknowledgementAndViewport:['room','dm','thread'],optimisticVisible:true,newDraftPreserved:true,failurePreserved:true,userScrollPreserved:true,hiddenConversationUntouched:true,changedScopeUntouched:true,desktopScrollUnchanged:true,buttonFocusAndCaret:true,lateNavigationPreserved:true,backgroundRetryPreserved:true,iphoneKeyboardSlide:true}));
}finally{await browser.close();server.close();}
