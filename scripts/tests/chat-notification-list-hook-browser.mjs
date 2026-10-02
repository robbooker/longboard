// Actual activity hook + coordinator; synthetic, deliberately held HTTP responses.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {build} from 'esbuild';
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
 import {useChatActivity} from './components/chat/hooks/useChatActivity';import {ChatUpdateCoordinator} from './lib/chatUpdateCoordinator';
 import {emptyChatActivity} from './lib/chatActivity';
 const test=window.test={identity:{accountId:'account-a'},batches:[],mutations:[]};
 test.updates=new ChatUpdateCoordinator({active:()=>true,now:()=>Date.now(),fetch:(_url,init)=>new Promise(resolve=>test.batches.push({paths:JSON.parse(init.body).paths,resolve}))});
 window.fetch=(_url,init)=>new Promise(resolve=>test.mutations.push({body:JSON.parse(init.body),resolve}));test.updates.start();test.updates.setHealthy(true);
 const root=createRoot(document.getElementById('root'));function App({member}){const value=useChatActivity(member);test.value=value;return <output id='activity'>{JSON.stringify(value.data)}</output>;}
 test.render=(account,member)=>{test.identity={accountId:account};flushSync(()=>root.render(member?<App member={member}/>:null));};
 test.finish=(index,count)=>{const batch=test.batches[index];batch.resolve(Response.json({results:batch.paths.map(path=>({path,status:200,data:{...emptyChatActivity,mentionCount:count,mentionThrough:count}}))}));};
 `},bundle:true,write:false,platform:'browser',format:'iife',plugins:[{name:'context',setup(builder){builder.onResolve({filter:/^\.\.\/ChatUpdates$/},()=>({path:'context',namespace:'test'}));builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const useChatUpdates=()=>window.test.updates;export const useChatIdentity=()=>window.test.identity;'}));}}]});
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const render=(account,member)=>page.evaluate(({account,member})=>window.test.render(account,member),{account,member});
 const batches=n=>page.waitForFunction(n=>window.test.batches.length>=n,{timeout:3000},n),finish=(index,count)=>page.evaluate(({index,count})=>window.test.finish(index,count),{index,count});
 const count=()=>page.$eval('#activity',e=>JSON.parse(e.textContent).mentionCount),settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const waitCount=n=>page.waitForFunction(n=>JSON.parse(document.querySelector('#activity').textContent).mentionCount===n,{},n);
 await render('account-a','member-a');await batches(1);await render('account-b','member-b');assert.equal(await count(),0);await batches(2);
 const paths=await page.evaluate(()=>window.test.batches.map(b=>b.paths[0]));assert.notEqual(paths[0],paths[1]);assert(!paths.some(path=>path.includes('account-')||path.includes('member-')));
 await finish(0,99);await settle();assert.equal(await count(),0);await finish(1,2);await waitCount(2);
 await render('account-a','member-a');await batches(3);await render('account-b','member-b');assert.equal(await count(),0);await batches(4);await finish(2,88);await settle();assert.equal(await count(),0);await finish(3,3);await waitCount(3);
 // A successful acknowledgement invalidates an older held activity snapshot.
 await page.evaluate(()=>window.test.updates.invalidate('activity'));await batches(5);
 await page.evaluate(()=>{window.test.readDone=false;window.test.value.read({kind:'mention',id:'synthetic',mentionThrough:3}).then(()=>window.test.readDone=true);});await page.waitForFunction(()=>window.test.mutations.length===1);
 await page.evaluate(()=>window.test.mutations[0].resolve(Response.json({ok:true})));await page.waitForFunction(()=>window.test.readDone);await finish(4,77);await settle();assert.equal(await count(),3,'Old unread snapshot cannot overwrite acknowledgement');await batches(6);await finish(5,0);await waitCount(0);
 // The old owner's completed POST cannot trigger navigation/success in the next owner.
 await page.evaluate(()=>{window.test.oldSuccess=false;window.test.oldFailure=false;window.test.value.read({kind:'all',mentionThrough:3,dmThrough:0}).then(()=>window.test.oldSuccess=true,()=>window.test.oldFailure=true);});await page.waitForFunction(()=>window.test.mutations.length===2);
 await render('account-c','member-c');await batches(7);await page.evaluate(()=>window.test.mutations[1].resolve(Response.json({ok:true})));await page.waitForFunction(()=>window.test.oldFailure);assert.equal(await page.evaluate(()=>window.test.oldSuccess),false);await finish(6,4);await waitCount(4);
 await render('account-d','member-c');assert.equal(await count(),0);await batches(8);await finish(7,5);await waitCount(5);
 await page.evaluate(()=>window.test.updates.invalidate('activity'));await batches(9);await render(null,null);await finish(8,100);await settle();assert.equal(await page.$('#activity'),null);assert.equal(await page.evaluate(()=>window.test.updates.watches.size),0);await page.evaluate(()=>window.test.updates.stop());assert.deepEqual(errors,[]);
 console.log('PASS actual activity hook/coordinator: account/member ownership, A→B→A opaque reads, successful-read stale GET rejection, old-owner POST completion rejection and unmount cleanup.');
}finally{await browser.close();}
