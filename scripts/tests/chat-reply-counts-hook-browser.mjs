// Actual React hook + update coordinator, with controlled synthetic HTTP results.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {build} from 'esbuild';
const ids=Array.from({length:100},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
 import {useReplyCounts} from './components/chat/hooks/useReplyCounts';
 import {ChatUpdateCoordinator} from './lib/chatUpdateCoordinator';
 window.test={identity:{accountId:'account-a',member:{id:'member-a'}},batches:[]};
 const test=window.test;
 test.updates=new ChatUpdateCoordinator({active:()=>true,now:()=>Date.now(),fetch:(_url,init)=>new Promise(resolve=>test.batches.push({paths:JSON.parse(init.body).paths,resolve}))});
 test.updates.start();test.updates.setHealthy(true);
 const root=createRoot(document.getElementById('root'));
 function App(props){const counts=useReplyCounts(props.room,props.ids,props.initial,props.scope);return <output id="counts">{JSON.stringify(counts)}</output>;}
 test.render=(props,identity)=>{if(identity)test.identity=identity;test.props=props;flushSync(()=>root.render(props?<App {...props}/>:null));};
 test.finish=(index,value,errorChunk=-1)=>{const batch=test.batches[index];batch.resolve(Response.json({results:batch.paths.map((path,i)=>({path,status:i===errorChunk?503:200,data:{counts:Object.fromEntries(new URL(path,'https://chat.test').searchParams.get('ids').split(',').map(id=>[id,value]))}}))}));};
 `},bundle:true,write:false,platform:'browser',format:'iife',plugins:[{name:'controlled-context',setup(builder){builder.onResolve({filter:/^\.\.\/ChatUpdates$/},()=>({path:'context',namespace:'controlled'}));builder.onLoad({filter:/.*/,namespace:'controlled'},()=>({contents:'export const useChatUpdates=()=>window.test.updates;export const useChatIdentity=()=>window.test.identity;'}));}}]});
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.setContent('<div id="root"></div>');await p.addScriptTag({content:bundle.outputFiles[0].text});
 const props={room:'main',ids:ids.join(','),scope:{memberId:'member-a',threadId:'root-a'},initial:{[ids[0]]:9,foreign:100}};
 const render=(props,identity)=>p.evaluate(({props,identity})=>window.test.render(props,identity),{props,identity});
 const snapshot=()=>p.$eval('#counts',e=>JSON.parse(e.textContent));
 const batches=n=>p.waitForFunction(n=>window.test.batches.length>=n,{},n);
 const finish=(n,value,error=-1)=>p.evaluate(({n,value,error})=>window.test.finish(n,value,error),{n,value,error});
 const counts=value=>p.waitForFunction(({id,value})=>JSON.parse(document.querySelector('#counts').textContent)[id]===value,{},{id:ids[0],value});
 const settle=()=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await render(props);assert.deepEqual(await snapshot(),{[ids[0]]:9});await batches(1);
 const second={...props,initial:undefined,scope:{memberId:'member-b',threadId:'root-a'}};
 await render(second,{accountId:'account-b',member:{id:'member-b'}});assert.deepEqual(await snapshot(),{});await batches(2);
 const paths=await p.evaluate(()=>window.test.batches.slice(0,2).map(b=>b.paths));assert.equal(paths[0].length,2);assert.equal(paths[1].length,2);assert.notEqual(paths[0][0],paths[1][0]);assert(!paths.flat().some(path=>path.includes('account-')||path.includes('member-')));
 await finish(0,111);await settle();assert.deepEqual(await snapshot(),{},'Old account result cannot complete the new owner read');
 await finish(1,2);await counts(2);assert.equal(Object.keys(await snapshot()).length,100);
 // One partial failure never mixes new numbers with the previous complete set.
 await p.evaluate(()=>window.test.updates.invalidate('room'));await batches(3);await finish(2,3,1);await settle();assert.deepEqual(Object.values(await snapshot()),Array(100).fill(2));
 await p.evaluate(()=>window.test.updates.invalidate('room'));await batches(4);
 // Invalidating an in-flight read uses the coordinator's one queued follow-up.
 await p.evaluate(()=>window.test.updates.invalidate('room'));await new Promise(resolve=>setTimeout(resolve,150));await finish(3,4);await counts(4);await batches(5);await finish(4,5);await counts(5);
 // Reordering and duplicate IDs do not change the canonical resource or refetch.
 await render({...second,ids:[...ids].reverse().concat(ids[0]).join(',')});await settle();assert.equal(await p.evaluate(()=>window.test.batches.length),5);
 const anchored={...second,ids:ids.slice(0,81).join(',')};await render(anchored);assert.deepEqual(await snapshot(),{});await batches(6);assert.deepEqual(await p.evaluate(()=>window.test.batches[5].paths.map(path=>new URL(path,'https://chat.test').searchParams.get('ids').split(',').length)),[80,1]);await finish(5,6);await counts(6);assert.equal(Object.keys(await snapshot()).length,81);
 // A different thread, member, room, and an A→B→A navigation each get fresh generations.
 const thread={...anchored,scope:{...anchored.scope,threadId:'root-b'}};await render(thread);assert.deepEqual(await snapshot(),{});await batches(7);
 await render(anchored);assert.deepEqual(await snapshot(),{});await batches(8);await finish(6,777);await settle();assert.deepEqual(await snapshot(),{});await finish(7,7);await counts(7);
 const member={...anchored,scope:{...anchored.scope,memberId:'member-c'}};await render(member);assert.deepEqual(await snapshot(),{});await batches(9);await finish(8,8);await counts(8);
 const room={...member,room:'social'};await render(room);assert.deepEqual(await snapshot(),{});await batches(10);
 await render({...room,ids:''});assert.deepEqual(await snapshot(),{});await finish(9,999);await settle();assert.deepEqual(await snapshot(),{});assert.equal(await p.evaluate(()=>window.test.batches.length),10);
 await render(room);await batches(11);await render(null);await finish(10,123);await settle();assert.equal(await p.$('#counts'),null);
 assert.equal(await p.evaluate(()=>window.test.updates.watches.size),0,'All old watchers cleaned up');await p.evaluate(()=>window.test.updates.stop());assert.deepEqual(errors,[]);
 console.log('PASS actual reply-count hook/coordinator:100/81 IDs, atomic failure, invalidation follow-up, stable sorted dedup, opaque ownership generations, stale account/member/room/thread/ID results, A→B→A and unmount cleanup.');
}finally{await browser.close();}
