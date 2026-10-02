// Actual React pin hook and coordinator; controlled synthetic HTTP timing.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {build} from 'esbuild';
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
 import {useRoomMessagePins} from './components/chat/hooks/useRoomMessagePins';
 import {ChatUpdateCoordinator} from './lib/chatUpdateCoordinator';
 const test=window.test={batches:[],mutations:[]};
 test.updates=new ChatUpdateCoordinator({active:()=>true,now:()=>Date.now(),fetch:(_url,init)=>new Promise(resolve=>test.batches.push({paths:JSON.parse(init.body).paths,resolve}))});
 window.fetch=(_url,init)=>new Promise(resolve=>test.mutations.push({body:JSON.parse(init.body),resolve}));
 test.updates.start();test.updates.setHealthy(true);
 const root=createRoot(document.getElementById('root'));
 function App(props){const value=useRoomMessagePins(props.account,props.room,props.enabled);test.value=value;return <output id='pins'>{JSON.stringify(value)}</output>;}
 test.render=props=>flushSync(()=>root.render(props?<App {...props}/>:null));
 test.data=label=>({canManagePins:true,pins:[{messageId:'10000000-0000-4000-8000-000000000001',replyToId:null,memberId:null,authorLabel:label,preview:label,pinnedAt:'2026-10-02',createdAt:'2026-10-01'}]});
 test.finish=(index,label,status=200)=>{const batch=test.batches[index];batch.resolve(Response.json({results:batch.paths.map(path=>({path,status,data:test.data(label)}))}));};
 `},bundle:true,write:false,platform:'browser',format:'iife',plugins:[{name:'controlled-context',setup(builder){builder.onResolve({filter:/^\.\.\/ChatUpdates$/},()=>({path:'context',namespace:'controlled'}));builder.onLoad({filter:/.*/,namespace:'controlled'},()=>({contents:'export const useChatUpdates=()=>window.test.updates;'}));}}]});
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 // localhost gives the real hook the secure crypto API, without running an app server.
 await page.setRequestInterception(true);page.on('request',request=>request.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('http://localhost:3361/hook-probe');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const render=props=>page.evaluate(props=>window.test.render(props),props),snapshot=()=>page.$eval('#pins',e=>JSON.parse(e.textContent));
 const batches=n=>page.waitForFunction(n=>window.test.batches.length>=n,{},n),finish=(index,label,status=200)=>page.evaluate(({index,label,status})=>window.test.finish(index,label,status),{index,label,status});
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const named=name=>page.waitForFunction(name=>JSON.parse(document.querySelector('#pins').textContent).pins[0]?.preview===name,{},name);
 const a={account:'account-a',room:'main',enabled:true},b={...a,account:'account-b'};
 await render(a);await batches(1);await render(b);await batches(2);assert.deepEqual((await snapshot()).pins,[]);
 assert.notEqual(await page.evaluate(()=>window.test.batches[0].paths[0]),await page.evaluate(()=>window.test.batches[1].paths[0]));
 await finish(0,'private A');await settle();assert.deepEqual((await snapshot()).pins,[]);await finish(1,'B');await named('B');
 await page.evaluate(()=>window.test.updates.invalidate('room'));await batches(3);await render(a);await batches(4);await render(b);await batches(5);
 await finish(3,'obsolete A');await finish(2,'obsolete B');await settle();assert.deepEqual((await snapshot()).pins,[]);await finish(4,'fresh B');await named('fresh B');
 await page.evaluate(()=>{void window.test.value.toggle('10000000-0000-4000-8000-000000000001',true);});await page.waitForFunction(()=>window.test.mutations.length===1);
 await render(a);await batches(6);await page.evaluate(()=>window.test.mutations[0].resolve(Response.json(window.test.data('old save'))));await settle();assert.deepEqual((await snapshot()).pins,[]);assert.equal((await snapshot()).busy,null);await finish(5,'fresh A');await named('fresh A');
 // A stale refresh begun before a successful mutation cannot restore the old list.
 await page.evaluate(()=>window.test.updates.invalidate('room'));await batches(7);await page.evaluate(()=>{void window.test.value.toggle('10000000-0000-4000-8000-000000000001',true);});await page.waitForFunction(()=>window.test.mutations.length===2);await page.evaluate(()=>window.test.mutations[1].resolve(Response.json({pins:[],canManagePins:true})));await settle();await finish(6,'old pre-unpin');await settle();assert.deepEqual((await snapshot()).pins,[]);
 await batches(8);await finish(7,'restored canonical');await named('restored canonical');await page.evaluate(()=>window.test.updates.invalidate('room'));await batches(9);await finish(8,'forbidden',403);await page.waitForFunction(()=>JSON.parse(document.querySelector('#pins').textContent).canManagePins===false);assert.deepEqual((await snapshot()).pins,[]);
 await render({...a,room:'social'});await batches(10);await render({...a,room:'social',enabled:false});await finish(9,'hidden social');await settle();assert.deepEqual((await snapshot()).pins,[]);
 await render(a);await batches(11);await render(null);await finish(10,'unmounted');await settle();assert.equal(await page.$('#pins'),null);assert.equal(await page.evaluate(()=>window.test.updates.watches.size),0);await page.evaluate(()=>window.test.updates.stop());assert.deepEqual(errors,[]);
 console.log('PASS actual pin hook/coordinator: opaque account/room scopes, A→B→A, delayed save/refresh, unpin ordering, permission revoke, hidden pane and unmount cleanup.');
}finally{await browser.close();}
