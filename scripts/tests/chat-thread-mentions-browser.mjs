// Synthetic fixture only: ports 3269/54469, no production credentials or messages.
import puppeteer from 'puppeteer';import assert from 'node:assert/strict';
const base='http://localhost:3269',rest='http://127.0.0.1:54469';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
async function login(email,width){const context=await browser.createBrowserContext(),p=await context.newPage();await p.setViewport({width,height:900});await p.goto(base+'/login?next=%2Fchat');await p.waitForSelector('#li-email');await p.reload({waitUntil:'networkidle0'});await p.type('#li-email',email);await p.type('#li-password','demo-only');await p.click('button[type=submit]');await p.waitForSelector('textarea[aria-label="Message LB"]');return p;}
async function fixture(table,body){const r=await fetch(rest+'/rest/v1/'+table,{method:body?'POST':'GET',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,await r.clone().text());return r.json();}
async function button(p,scope,text){for(const b of await p.$$(`${scope} button`))if((await b.evaluate(e=>e.textContent)).trim()===text){await b.click();return;}throw Error('Missing '+text);}
try{
const p=await login('alice@example.test',1440);
const member=(await fixture('longboard_chat_members?select=id&user_id=eq.00000000-0000-4000-8000-000000000001'))[0].id;
const root=crypto.randomUUID(),reply=crypto.randomUUID();
await fixture('longboard_chat_messages',{id:root,guest_id:member,member_id:member,author_label:'Alice',body:'Mentions parent',room_slug:'social'});
await fixture('longboard_chat_messages',{id:reply,guest_id:member,member_id:member,author_label:'Alice',body:'Nested mentions seed',room_slug:'social',reply_to_id:root});
const rename=await fetch(rest+'/rest/v1/longboard_chat_members?user_id=eq.00000000-0000-4000-8000-000000000003',{method:'PATCH',headers:{authorization:'Bearer test-service-role','Content-Type':'application/json'},body:JSON.stringify({display_name:'Mary Jane'})});assert(rename.ok);
const list='aside[aria-label="Comment replies"] [role="listbox"]';
async function replace(text){await p.click('#thread-reply');await p.keyboard.down('Control');await p.keyboard.press('A');await p.keyboard.up('Control');await p.type('#thread-reply',text);}
for(const width of [1440,390]){
 await p.setViewport({width,height:900});await p.goto(`${base}/chat?room=social#chat-message-${reply}`,{waitUntil:'networkidle0'});await p.reload({waitUntil:'networkidle0'});await p.waitForSelector('#thread-reply');
 await replace('@Bo');await p.waitForSelector(list+' [role="option"]');assert.match(await p.$eval(list,e=>e.textContent),/@Bob/);assert.doesNotMatch(await p.$eval(list,e=>e.textContent),/Buddy/);
 const controls=await p.$eval('#thread-reply',e=>e.getAttribute('aria-controls'));assert.equal(await p.$eval(list,e=>e.id),controls);
 await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');assert.equal(await p.$eval('#thread-reply',e=>e.value),'@Bob ');assert(await p.$('aside[aria-label="Comment replies"]'),'Enter selected rather than sent');
 await replace('@Ma');await p.waitForSelector(list+' [role="option"]');await p.click(list+' [role="option"]');assert.equal(await p.$eval('#thread-reply',e=>e.value),'@Mary Jane ');assert.equal(await p.$eval('#thread-reply',e=>document.activeElement===e),true);
 await replace('@Bo');await p.waitForSelector(list);await p.keyboard.press('Escape');await p.waitForSelector(list,{hidden:true});assert(await p.$('#thread-reply'),'Escape retains thread');assert.equal(await p.$eval('#thread-reply',e=>e.value),'@Bo');
 await replace('@NobodyMatches');await p.waitForSelector(list,{hidden:true});
 await replace('@Bo');await p.waitForSelector(list);await p.$eval('#thread-reply',e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true})));assert.equal(await p.$eval('#thread-reply',e=>e.value),'@Bo');
 await p.keyboard.press('Enter');await p.type('#thread-reply',`hello ${width}`);await p.keyboard.down('Shift');await p.keyboard.press('Enter');await p.keyboard.up('Shift');await p.type('#thread-reply','second line');assert.match(await p.$eval('#thread-reply',e=>e.value),/\nsecond line/);
 await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('#thread-reply')?.value==='');await p.waitForFunction(text=>document.querySelector('aside[aria-label="Comment replies"]')?.textContent.includes(text),{},`hello ${width}`);
 const rows=await fixture('longboard_chat_messages?reply_to_id=eq.'+root);assert(rows.some(r=>r.body===`@Bob hello ${width}\nsecond line`));
 await replace('@Ma');await p.waitForSelector(list);await p.screenshot({path:`/tmp/thread-mentions-${width}.png`});
 await p.keyboard.press('Escape');await button(p,'aside[aria-label="Comment replies"]','↳ Reply / view conversation');await p.waitForFunction(()=>document.querySelector('#thread-reply')?.value==='');await p.click('button[aria-label="Back to previous comment"]');await p.waitForFunction(()=>document.querySelector('#thread-reply')?.value==='@Ma');
 console.log('PASS',width,'filter, keyboard/pointer selection, multiword, Escape, IME, Shift+Enter, send persistence, nested draft restore');
}
await p.goto(base+'/chat?room=main',{waitUntil:'networkidle0'});await p.type('textarea[aria-label="Message LB"]','@Bu');await p.waitForSelector('[role="listbox"]');assert.match(await p.$eval('[role="listbox"]',e=>e.textContent),/@Buddy/);await p.keyboard.press('Enter');assert.equal(await p.$eval('textarea[aria-label="Message LB"]',e=>e.value),'@Buddy ');
const anonymous=await browser.newPage();await anonymous.goto(base+'/login');assert.equal(await anonymous.evaluate(async()=> (await fetch('/api/chat/mentions?q=Bo')).status),401);
console.log('PASS main composer Buddy regression and actual unauthenticated mention API denial');
}finally{await browser.close();}
