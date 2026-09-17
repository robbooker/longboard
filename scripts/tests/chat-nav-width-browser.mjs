import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const nav='nav[aria-label="Chat rooms"]',dm='section[aria-label="Private conversation"]',room='textarea[aria-label="Message LB"]';
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:900});
 await page.goto('http://localhost:3214/login?next=%2Fchat');await page.waitForSelector('#li-email');await page.reload({waitUntil:'networkidle0'});await page.type('#li-email','alice@example.test');await page.type('#li-password','demo-only');await page.click('button[type="submit"]');await page.waitForSelector(room);await page.waitForSelector(`${nav} button[data-active]`);
 const clickText=async(scope,text)=>page.evaluate(({scope,text})=>[...document.querySelectorAll(scope+' button')].find(b=>b.textContent.trim()===text).click(),{scope,text});
 const open=async()=>{if(await page.$eval(nav,e=>getComputedStyle(e).display==='none'))await page.click('button[aria-label="Open room navigation"]');await page.waitForSelector(nav,{visible:true});};
 const returnRoom=async()=>{await open();await page.click(`${nav} a[href="/chat?room=main"]`);await page.waitForSelector(room,{visible:true});};
 await page.type(room,'Room draft survives nav width changes');
 await page.click(`${nav} button[data-active]`);await page.waitForSelector(dm,{visible:true});if(await page.$eval(dm,e=>e.textContent.includes('Accept this request')))await clickText(dm,'Accept request');await page.waitForSelector('#dm-body',{visible:true});await page.type('#dm-body','DM draft survives nav width changes');await returnRoom();
 async function stress(){await page.$eval(nav,e=>{
  const a=e.querySelector('a[href="/chat?room=lb-announcements"]')||e.querySelector('a[href="/chat?room=main"]');
  a.firstChild.textContent='LONG ANNOUNCEMENT COMMUNITY LABEL';
  let badge=a.querySelector('span');if(!badge){badge=document.createElement('span');badge.className=[...e.querySelectorAll('span')].find(n=>n.className.includes('activityBadge'))?.className||'';a.append(badge);}badge.textContent='9999';
  const item=e.querySelector('button[data-active]'),name=item.querySelector('[class*="itemName"]'),preview=item.querySelector('[class*="preview"]');name.firstChild.textContent='Alexandria VeryLongRecipientNameWithNoBreaks Example';preview.textContent='https://example.test/'+ 'long-preview-does-not-widen-card-'.repeat(35);
  if(!name.querySelector('span')){const b=document.createElement('span');b.className=[...e.querySelectorAll('span')].find(n=>n.className.includes('badge'))?.className||'';b.textContent='888';name.append(b);}
  if(!e.querySelector('[data-width-fixture]'))for(let i=0;i<14;i++){const clone=item.cloneNode(true);clone.removeAttribute('data-active');clone.setAttribute('data-width-fixture','true');clone.querySelector('[class*="itemName"]').firstChild.textContent='Extra fixture recipient '+i;item.before(clone);}
 });}
 const results=[];
 for(const width of [1440,1100,1099,768,390,320]){
  await page.setViewport({width,height:650});await open();await stress();
  const geometry=await page.$eval(nav,e=>{
   const rect=e.getBoundingClientRect(),style=getComputedStyle(e),anchors=[...e.querySelectorAll(':scope>a')];
   const oneLine=node=>{const range=document.createRange();range.selectNodeContents(node.firstChild);return [...range.getClientRects()].length===1;};
   const item=e.querySelector('button[data-active]'),name=item.querySelector('[class*="itemName"]'),preview=item.querySelector('[class*="preview"]');
   return {width:rect.width,wrap:style.flexWrap,direction:style.flexDirection,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,labels:anchors.every(oneLine),sameColumn:anchors.every(a=>Math.abs(a.getBoundingClientRect().left-anchors[0].getBoundingClientRect().left)<1),nameLine:oneLine(name),nameAlign:getComputedStyle(name).textAlign,previewAlign:getComputedStyle(preview).textAlign,previewWidth:preview.getBoundingClientRect().width,itemWidth:item.getBoundingClientRect().width,previewBelow:preview.getBoundingClientRect().top>=name.getBoundingClientRect().bottom,bodyWidth:document.documentElement.scrollWidth,viewport:innerWidth};
  });results.push({viewport:width,...geometry});console.log('geometry',width,JSON.stringify(geometry));
  assert.equal(geometry.wrap,'nowrap');assert.equal(geometry.direction,'column');assert.equal(geometry.labels,true);assert.equal(geometry.sameColumn,true);assert.equal(geometry.nameLine,true);assert.equal(geometry.nameAlign,'left');assert.equal(geometry.previewAlign,'left');assert.equal(geometry.previewBelow,true);assert.ok(geometry.itemWidth<Math.max(900,geometry.clientWidth),'preview does not drive huge intrinsic width');if(width>=1100||width<500)assert.ok(geometry.scrollWidth>geometry.clientWidth,'wide names create navigation scroll');assert.ok(geometry.scrollHeight>geometry.clientHeight,'long list vertically scrolls');assert.ok(geometry.bodyWidth<=geometry.viewport,'page cannot horizontally scroll');
  await page.$eval(nav,e=>{e.scrollLeft=e.scrollWidth;e.scrollTop=e.scrollHeight;});if(geometry.scrollWidth>geometry.clientWidth)assert.ok(await page.$eval(nav,e=>e.scrollLeft>0));
  // Keyboard/programmatic focus must bring a real selectable card back into view.
  await page.focus(`${nav} button[data-active]`);const focused=await page.$eval(`${nav} button[data-active]`,e=>{const r=e.getBoundingClientRect(),n=e.closest('nav').getBoundingClientRect();return document.activeElement===e&&r.bottom>n.top&&r.top<n.bottom;});assert.equal(focused,true);
  await page.click(`${nav} button[data-active]`);await page.waitForSelector('#dm-body',{visible:true});await page.type('#dm-body','Resize-only DM draft');await page.setViewport({width:width===1100?1099:width+1,height:650});await page.setViewport({width,height:650});assert.equal(await page.$eval('#dm-body',e=>e.value),'Resize-only DM draft');assert.equal(await page.$eval(dm,e=>e.scrollWidth<=e.clientWidth),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await returnRoom();assert.equal(await page.$eval(room,e=>e.value),'Room draft survives nav width changes');
  if(width<1100){await open();await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open room navigation');await open();await clickText(nav,'Back to chat →');await page.waitForSelector(room,{visible:true});}
 }
 await page.setViewport({width:1100,height:650});await page.click('#chat-message-20000000-0000-4000-8000-000000000001 button[aria-expanded]');await page.waitForSelector('#thread-reply',{visible:true});await page.type('#thread-reply','Reply draft survives resize');
 const layout=await page.evaluate(()=>{const nav=document.querySelector('nav[aria-label="Chat rooms"]').getBoundingClientRect(),chat=document.querySelector('section[aria-label="Longboard Chat"]').getBoundingClientRect(),reply=document.querySelector('aside[aria-label="Comment replies"]').getBoundingClientRect();return{nav:nav.width,separate:nav.right<=chat.left+1&&chat.right<=reply.left+1};});assert.equal(layout.nav,220);assert.equal(layout.separate,true);await page.screenshot({path:'/tmp/chat-nav-width-desktop.png'});
 const headingBefore=await page.$eval('h1',e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,text:e.textContent}));
 // Temporarily restore the exact pre-change values of only the added nav rules.
 const baselineStyle=await page.evaluate(()=>{
  const nav=document.querySelector('nav[aria-label="Chat rooms"]'),navClass='.'+[...nav.classList][0],list=nav.querySelector('[class*="navigationList"]'),listClass='.'+[...list.classList][0];
  const s=document.createElement('style');s.id='nav-baseline-review';s.textContent=`${navClass}{min-width:auto;min-height:auto;max-width:none;flex-wrap:wrap;overflow-x:auto}${navClass}>*{flex-shrink:1}${navClass}>a,${navClass}>button{min-width:auto;white-space:normal}${navClass}>a [class*="activityBadge"]{flex-shrink:1;white-space:normal}${navClass} [class*="navHeading"]{white-space:normal}${listClass} [class*="itemName"]{text-align:start;white-space:normal;overflow-wrap:anywhere;max-width:none}${listClass} button[data-active]{width:100%;min-width:auto}${listClass} [class*="preview"]{text-align:start;contain:none;max-width:none}`;document.head.append(s);return {id:s.id,css:s.textContent};
 });
 const headingBaseline=await page.$eval('h1',e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,text:e.textContent}));assert.deepEqual(headingBaseline,headingBefore);console.log('Baseline header compression unchanged:',JSON.stringify(headingBaseline));await page.screenshot({path:'/tmp/chat-nav-width-baseline-header.png'});await page.evaluate(id=>document.getElementById(id).remove(),baselineStyle.id);
 for(const width of [1099,768,390,320,1440]){await page.setViewport({width,height:650});await page.waitForSelector('#thread-reply',{visible:true});assert.equal(await page.$eval('#thread-reply',e=>e.value),'Reply draft survives resize');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.setViewport({width:390,height:650});await page.evaluate(()=>history.back());await page.waitForSelector('aside[aria-label="Comment replies"]',{hidden:true});await open();await stress();await page.$eval(nav,e=>{e.scrollLeft=0;e.scrollTop=0;});await new Promise(r=>setTimeout(r,250));await page.screenshot({path:'/tmp/chat-nav-width-mobile.png'});
 await page.setViewport({width:720,height:450,deviceScaleFactor:2});await open();await stress();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await new Promise(r=>setTimeout(r,250));
 const focusLast=()=>page.$eval(nav,e=>{const controls=[...e.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled)')];controls.at(-1).focus();});
 await focusLast();await page.keyboard.press('Tab');const focusUpdated=await page.evaluate(()=>document.activeElement.tagName);
 const restored=await page.addStyleTag({content:baselineStyle.css+' nav[aria-label="Chat rooms"]{flex-wrap:nowrap}'});await focusLast();await page.keyboard.press('Tab');const focusOriginal=await page.evaluate(()=>document.activeElement.tagName);assert.equal(focusOriginal,focusUpdated);console.log('Existing DM portal Tab escape unchanged:',focusUpdated);await restored.evaluate(e=>e.remove());
 await page.focus(nav+' > button');
 await page.keyboard.press('Escape');await page.waitForSelector(room,{visible:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify(results,null,2));console.log('PASS nav single-line labels/names, confined horizontal+vertical scrolling, six widths, real DM selection/drafts, room/reply drafts, mobile back/Escape/focus, no overlap or page overflow.');
}finally{await browser.close();}
