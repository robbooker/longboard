// Runs inside the actual-component Skip fixture using --quad-advance.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function verifyQuadAdvance({p,pane,messages,dms,conversations,activity,writes}) {
 const skip='button[aria-label="Skip to Most Recent Message"]';
 const scroller=i=>`${pane(i)} [aria-live="polite"][aria-busy]`;
 const bottom=async selector=>{try{await p.waitForFunction(s=>{const e=document.querySelector(s);return e&&e.scrollHeight-e.clientHeight-e.scrollTop<=2;},{},selector);}catch(error){console.error('Follow failure',selector,await p.$eval(selector,e=>({top:e.scrollTop,height:e.scrollHeight,viewport:e.clientHeight,tail:e.textContent.slice(-200)})));throw error;}};
 const atBottom=selector=>p.$eval(selector,e=>e.scrollHeight-e.clientHeight-e.scrollTop<=2);
 const settle=()=>new Promise(r=>setTimeout(r,150));
 let revision=0;
 const append=async()=>{
  revision++;
  const rows=['main','shortscout'].map(room=>{
   const row={...messages[room].at(-1),id:randomUUID(),body:`Advance ${revision} ${room}`,unread_seq:messages[room].at(-1).unread_seq+1};
   messages[room].push(row);activity.roomMessageThrough[room]=row.unread_seq;return row;
  });
  for(const c of conversations){const old=dms[c.id].at(-1);dms[c.id].push({...old,id:randomUUID(),body:`Advance ${revision} ${c.otherName}`,seq:old.seq+1});}
  await p.evaluate(rows=>{for(const row of rows)window.dispatchEvent(new CustomEvent('chat-room-event',{detail:{eventType:'INSERT',new:row}}));window.dispatchEvent(new Event('chat-inbox-refresh'));},rows);
 };
 const loaded=async i=>{const label=['main','shortscout','Bob','Carol'][i];await p.waitForFunction((s,text)=>document.querySelector(s)?.textContent.includes(text),{},pane(i),`Advance ${revision} ${label}`);};
 const scrollTo=async(i,position)=>p.$eval(scroller(i),(e,position)=>{e.dispatchEvent(new WheelEvent('wheel',{deltaY:position==='bottom'?100:-100,bubbles:true}));e.scrollTop=position==='bottom'?e.scrollHeight:position==='near-bottom'?e.scrollHeight-e.clientHeight-20:100;e.dispatchEvent(new Event('scroll',{bubbles:true}));},position);
 for(let i=0;i<4;i++){await p.click(`${pane(i)} ${skip}`);await bottom(scroller(i));}
 await p.focus(`${pane(0)} textarea`);
 await append();for(let i=0;i<4;i++){await loaded(i);await bottom(scroller(i));}
 assert.equal(await p.$eval(`${pane(0)} textarea`,e=>e===document.activeElement),true,'New messages follow in all visible panes without taking keyboard focus');
 // A small deliberate move above bottom suspends even when within the old 64px tolerance.
 await scrollTo(0,'near-bottom');await scrollTo(2,'near-bottom');await settle();
 const positions=await Promise.all([0,2].map(i=>p.$eval(scroller(i),e=>e.scrollTop)));
 for(const i of [0,2])await p.$eval(scroller(i),e=>{e.querySelector('article:last-of-type').style.minHeight='500px';});
 await settle();
 for(const [n,i] of [0,2].entries())assert.equal(await p.$eval(scroller(i),e=>e.scrollTop),positions[n],'Late media growth preserves manual suspension');
 await scrollTo(0,'up');await scrollTo(2,'up');await append();await loaded(0);await loaded(2);await settle();
 assert.equal(await atBottom(scroller(0)),false,'Room manual history remains suspended');assert.equal(await atBottom(scroller(2)),false,'DM manual history remains suspended');
 // Scrolling to bottom resumes following; media expanding after commit also follows.
 for(const i of [0,2])await scrollTo(i,'bottom');await append();await loaded(0);await loaded(2);await bottom(scroller(0));await bottom(scroller(2));
 for(const i of [0,2])await p.$eval(scroller(i),e=>{e.querySelector('article:last-of-type').style.minHeight='600px';});
 await bottom(scroller(0));await bottom(scroller(2));
 // Hidden/zero-size panes must not receive any programmatic scroll or acknowledge new rows.
 await scrollTo(1,'up');await scrollTo(3,'up');await p.click(`${pane(0)} button[aria-label="Expand pane 1"]`);await settle();
 await p.evaluate(selectors=>{window.advanceScrollWrites=[0,0,0];const property=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');selectors.forEach((s,i)=>{const node=document.querySelector(s);Object.defineProperty(node,'scrollTop',{configurable:true,get(){return property.get.call(this);},set(value){window.advanceScrollWrites[i]++;property.set.call(this,value);}});node.dispatchEvent(new Event('scroll',{bubbles:true}));});},[scroller(1),scroller(2),scroller(3)]);
 const hiddenWrites=writes.length;await append();await loaded(0);await settle();
 assert.deepEqual(await p.evaluate(()=>window.advanceScrollWrites),[0,0,0],'Hidden panes never auto-scroll');
 assert.equal(writes.slice(hiddenWrites).some(w=>w.body.action==='read'&&conversations.some(c=>c.id===w.body.target)),false,'Hidden DMs do not acknowledge messages');
 assert.equal(writes.slice(hiddenWrites).some(w=>w.body.room==='shortscout'&&w.body.roomThrough===activity.roomMessageThrough.shortscout),false,'Hidden room does not acknowledge new messages');
 await p.click(`${pane(0)} button[aria-label="Restore four panes"]`);await loaded(2);await bottom(scroller(2));await loaded(3);await settle();
 assert.equal(await atBottom(scroller(1)),false,'Hidden room keeps manual suspension on reveal');assert.equal(await atBottom(scroller(3)),false,'Hidden DM keeps manual suspension on reveal');
 // Explicit Skip resumes following, including the pane that retained a manual anchor.
 for(const i of [1,3]){await p.click(`${pane(i)} ${skip}`);await bottom(scroller(i));}
 await append();for(let i=0;i<4;i++){await loaded(i);await bottom(scroller(i));}
 // Simulate a background document without changing pane visibility or keyboard focus.
 await scrollTo(0,'up');await p.evaluate(()=>{window.advanceDocumentHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.advanceDocumentHidden});document.dispatchEvent(new Event('visibilitychange'));window.advanceScrollWrites=[0,0,0];});
 await append();await settle();assert.deepEqual(await p.evaluate(()=>window.advanceScrollWrites),[0,0,0],'Background document never scrolls panes');
 await p.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await loaded(2);await bottom(scroller(2));await settle();assert.equal(await atBottom(scroller(0)),false,'Background/foreground transition preserves manual reading');
 await p.click(`${pane(0)} ${skip}`);await bottom(scroller(0));
 // Mobile hides all but one pane; switching tabs restores follow without stealing focus.
 await p.setViewport({width:390,height:850});await settle();await append();await loaded(0);await bottom(scroller(0));
 await p.click('nav[aria-label="Choose visible conversation"] button:nth-child(3)');await loaded(2);await bottom(scroller(2));
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.screenshot({path:'/tmp/chat-quad-advance-mobile.png'});
 await p.setViewport({width:1440,height:1000});await settle();
 console.log('Quad advance passed: unfocused room/DM panes, media resize, manual suspension/resume, hidden/background panes, read safety, Skip and mobile reveal.');
}

export async function verifyQuadDeepLink({p,base,messages}) {
 await p.setViewport({width:1440,height:1000});
 const anchor=messages.main.at(-20);
 await p.goto(`${base}/chat/quad?single`);
 await p.waitForSelector('button[aria-label="Skip to Most Recent Message"]:not(:disabled)');
 await p.click('button[aria-label="Skip to Most Recent Message"]');
 const scroller='[aria-live="polite"][aria-busy]';
 await p.waitForSelector(`#chat-message-${anchor.id}`);
 await p.evaluate(id=>{window.location.hash=`chat-message-${id}`;},anchor.id);
 await p.waitForFunction(s=>{const e=document.querySelector(s);return e&&e.scrollTop>0&&e.scrollHeight-e.clientHeight-e.scrollTop>100;},{},scroller);
 const top=await p.$eval(scroller,e=>e.scrollTop);
 const row={...messages.main.at(-1),id:randomUUID(),body:'Incoming after deep link',unread_seq:messages.main.at(-1).unread_seq+1};messages.main.push(row);
 await p.evaluate(row=>window.dispatchEvent(new CustomEvent('chat-room-event',{detail:{eventType:'INSERT',new:row}})),row);
 await p.waitForSelector(`#chat-message-${row.id}`);
 await new Promise(resolve=>setTimeout(resolve,150));
 assert.equal(await p.$eval(scroller,e=>e.scrollHeight-e.clientHeight-e.scrollTop>100),true,'New messages do not replace deep-link position with bottom');
 assert.ok(Math.abs(await p.$eval(scroller,e=>e.scrollTop)-top)<200,'Deep-link context remains in view');
 console.log('Quad advance deep-link regression passed.');
}
