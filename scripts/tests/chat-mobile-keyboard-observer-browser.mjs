import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import http from 'node:http';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`import {watchChatKeyboardDismiss} from './lib/chatKeyboardDismiss';import {beginMobileSend} from './lib/chatMobileSend';
window.install=()=>window.cleanup=watchChatKeyboardDismiss(document.querySelector('main'));window.install();
window.pending=()=>{window.send=beginMobileSend(document.querySelector('#composer'),document.querySelector('#feed'));};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false});
const html=`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>main{height:500px}#feed{height:250px;overflow:auto}article{height:80px}textarea{height:50px}</style><main><div id="feed">${'<article>Message body</article>'.repeat(20)}</div><form><textarea id="composer" data-chat-composer>Preserved draft</textarea><button type="button">Toolbar</button><span id="form-space">Composer space</span></form><aside><input id="search"><textarea id="edit">Edit</textarea><button type="button" id="action">Action</button><a href="#target">Link</a><div contenteditable="true">Editor</div></aside><p id="blank">Blank chat area</p></main><section id="other">Other pane</section><dialog><input></dialog><script src="/bundle.js"></script>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].contents:html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const p=await browser.newPage();await p.setViewport({width:390,height:800,isMobile:true,hasTouch:true});await p.goto(`http://127.0.0.1:${server.address().port}`);
 const focus=()=>p.focus('#composer'),focused=()=>p.evaluate(()=>document.activeElement.id==='composer');
 // Synthetic TouchEvents isolate observer guards/defaultPrevented; production suite uses native CDP touches.
 const touch=(target,points,options={})=>p.evaluate(async(target,points,options)=>{
  const node=document.querySelector(target),list=(point,n=1)=>Array.from({length:n},(_,i)=>new Touch({identifier:i,target:node,clientX:point[0]+i,clientY:point[1]+i}));
  const fire=(type,point,n=1)=>{const active=type==='touchend'||type==='touchcancel'?[]:list(point,n);const event=new TouchEvent(type,{bubbles:true,cancelable:true,touches:active,changedTouches:list(point,n)});node.dispatchEvent(event);if(event.defaultPrevented)throw Error('Touch default prevented');};
  fire('touchstart',points[0],options.multi?2:1);if(options.wait)await new Promise(r=>setTimeout(r,options.wait));
  for(const point of points.slice(1))fire('touchmove',point,options.multi?2:1);
  fire(options.cancel?'touchcancel':'touchend',points.at(-1),options.multi?2:1);
 },target,points,options);
 await focus();await touch('#blank',[[10,10]]);assert.equal(await focused(),false);
 await focus();await touch('#feed',[[10,10],[10,70]]);assert.equal(await focused(),false);
 for(const points of [[[10,80],[10,10]],[[10,10],[100,10]],[[10,10],[10,30]]]){await focus();await touch('#feed',points);assert.equal(await focused(),true);}
 for(const target of ['#composer','button','#form-space','#search','#edit','#action','a','[contenteditable]','#other']){await focus();await touch(target,[[10,10],[10,70]]);assert.equal(await focused(),true,target);}
 for(const options of [{multi:true},{wait:550},{cancel:true}]){await focus();await touch('#blank',[[10,10]],options);assert.equal(await focused(),true,JSON.stringify(options));}
 await focus();await p.evaluate(()=>{document.querySelector('dialog').show();document.querySelector('#composer').focus();});await touch('#blank',[[10,10]]);assert.equal(await focused(),true,'open dialog suppresses the watcher');await p.evaluate(()=>document.querySelector('dialog').close());
 await p.focus('#edit');await touch('#blank',[[10,10]]);assert.equal(await p.evaluate(()=>document.activeElement.id),'edit');
 await focus();await p.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('article'));getSelection().removeAllRanges();getSelection().addRange(range);});await touch('#blank',[[10,10]]);assert.equal(await focused(),true);await p.evaluate(()=>getSelection().removeAllRanges());
 await focus();await p.mouse.click(15,15); // Mouse alone does not invoke custom dismissal (native blur may).
 await focus();await p.evaluate(()=>window.cleanup());await touch('#blank',[[10,10]]);assert.equal(await focused(),true);await p.evaluate(()=>window.install());
 assert.equal(await p.$eval('#composer',e=>e.value),'Preserved draft');
 console.log('PASS observer tap/swipe direction, jitter/long press/multitouch/cancel, form/interactive/input exclusion, other pane, selection and cleanup; no prevented touch defaults.');
}finally{await browser.close();server.close();}
