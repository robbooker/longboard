// Ticket #443 "What's New notes show pictures of the new feature", on desktop 1280 and phone 390,
// against the synthetic What's New fixture (localhost:3443, database 127.0.0.1:54443):
//  - a PR without pictures still posts a text-only note through the real script and route;
//  - a PR with 2 pictures in docs/whats-new/<pr>/ (captions.json) goes live: the real script uploads
//    them to /api/chat/whats-new/pictures and the note carries both, shown like any chat image with
//    its caption, and each one enlarges on tap on desktop and on a phone;
//  - an already-announced PR gets its pictures once, after its note (post-pictures.mjs); a second
//    run is refused; a wrong token is refused.
// SCREENS=<dir> saves before-desktop.png (text-only note), after-desktop.png, after-phone.png and
// the enlarged views to <dir>.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import puppeteer from 'puppeteer';
import {signIn} from './browser-login.mjs';
import {attachPictures,postChanges,uploadPicture,readPictures} from '../whats-new/post-whats-new.mjs';
import {postPictures} from '../whats-new/post-pictures.mjs';
process.env.CHAT_FIXTURE_PORT||='54443';process.env.CHAT_APP_PORT||='3443';
const base=process.env.CHAT_TEST_URL||'http://localhost:3443',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54443';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const screens=process.env.SCREENS||'';
if(screens)await mkdir(screens,{recursive:true});
const token='synthetic-whats-new-token-never-a-production-secret';
const url=`${base}/api/chat/whats-new`;
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
const sql=(sql,args=[])=>control('sql',{sql,args});
const {people:[alice,,mallory]}=await control('identity');
await sql("update profiles set role='admin' where id=$1",[alice.id]);
const stamp=Date.now(),sha=stamp.toString(16).padStart(40,'0').slice(-40);
const prText=800000+stamp%90000,prPictures=prText+1,prLate=prText+2;
// The PR's committed pictures: two of #434's after shots, with captions.json, in a temporary docs/whats-new.
const docs=await mkdtemp(join(tmpdir(),'whats-new-443-'));
const source=new URL('../../docs/whats-new/581/',import.meta.url).pathname;
for(const pr of [prPictures,prLate])await mkdir(join(docs,String(pr)));
await copyFile(join(source,'2-pink-theme.png'),join(docs,String(prPictures),'1-pink-theme.png'));
await copyFile(join(source,'3-pink-theme-on-a-phone.png'),join(docs,String(prPictures),'2-pink-on-a-phone.png'));
await writeFile(join(docs,String(prPictures),'captions.json'),JSON.stringify({'1-pink-theme.png':'The new Pink theme'}));
await copyFile(join(source,'1-shortscout-follows-your-theme.png'),join(docs,String(prLate),'1-shortscout-follows-your-theme.png'));

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[];
const desktop={width:1280,height:900,isMobile:false,hasTouch:false},phone={width:390,height:844,isMobile:true,hasTouch:true};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const settled=p=>p.waitForFunction(()=>[...document.querySelectorAll('article[id^="chat-message-"]')].some(e=>e.checkVisibility()),{timeout:60000});
const openRoom=async p=>{await p.goto(`${base}/chat?room=whats-new`);await p.waitForSelector('[data-room-description]',{visible:true});await settled(p);await pause(500);};
const shot=async(p,name)=>{if(screens)await p.screenshot({path:`${screens}/${name}.png`});};
// Bring a message into view in the visible list (the room can open at its start).
const show=async(p,id)=>{await p.waitForSelector(`#chat-message-${id}`,{timeout:60000});await p.evaluate(id=>document.getElementById('chat-message-'+id).scrollIntoView({block:'center'}),id);await pause(600);};
// The pictures of a message: loaded thumbnails, captions, and Enlarge buttons.
const pictures=(p,id)=>p.waitForFunction(id=>{const a=document.getElementById('chat-message-'+id);if(!a)return false;
 const imgs=[...a.querySelectorAll('[aria-label="Message attachments"] img')];return imgs.length&&imgs.every(i=>i.complete&&i.naturalWidth>0)&&imgs.length;},{timeout:60000},id).then(h=>h.jsonValue());
const captions=(p,id)=>p.evaluate(id=>[...document.getElementById('chat-message-'+id).querySelectorAll('[aria-label="Message attachments"] a')].map(a=>a.textContent.replace(/ · .*$/,'')),id);
async function enlarge(p,id,index,name){
 const buttons=await p.$$(`#chat-message-${id} button[aria-label^="Enlarge "]`);
 assert(buttons.length>index,`Enlarge button ${index}`);
 await buttons[index].click();
 await p.waitForFunction(()=>{const d=document.querySelector('dialog[open]');const i=d?.querySelector('img');return d&&d.checkVisibility()&&i&&i.complete&&i.naturalWidth>0;},{timeout:30000});
 const box=await p.evaluate(()=>{const i=document.querySelector('dialog[open] img').getBoundingClientRect();return {w:i.width,h:i.height,right:i.right,bottom:i.bottom,vw:innerWidth,vh:innerHeight};});
 assert(box.w>0&&box.right<=box.vw+1&&box.bottom<=box.vh+1,`${name}: the enlarged picture fits the screen ${JSON.stringify(box)}`);
 const thumb=await p.evaluate((id,index)=>document.getElementById('chat-message-'+id).querySelectorAll('[aria-label="Message attachments"] img')[index].getBoundingClientRect().width,id,index);
 assert(box.w>thumb,`${name}: bigger than in the message (${box.w} > ${thumb})`);
 await shot(p,name);
 await p.click('dialog[open] button[aria-label="Close image preview"]');
 await p.waitForSelector('dialog[open]',{hidden:true});
}

try{
 console.log('Browser',await browser.version());
 const member=await (await browser.createBrowserContext()).newPage();member.on('pageerror',e=>errors.push(e.message));member.setDefaultTimeout(60000);
 await member.setViewport(desktop);
 await signIn(member,base,mallory.email,{next:'/chat?room=social',composer:'textarea[aria-label="Message Social"]'});

 // 1. Before: a PR without pictures posts a text-only note, exactly as today.
 const textChanges=[{pr:prText,note:`You can now pin a room to the top (${stamp}).`,mergedAt:new Date().toISOString()}];
 assert.deepEqual(await attachPictures({changes:textChanges,dir:docs,url,token}),[],'no folder, no problems');
 assert.equal(textChanges[0].pictures,undefined);
 const textNote=await postChanges({url,token,sha,changes:textChanges});
 assert.equal(textNote.posted,true);assert.equal(textNote.pictures,undefined);
 assert.deepEqual((await sql('select attachment_ids from longboard_chat_messages where id=$1',[textNote.messageId]))[0].attachment_ids,[],'text only');
 await openRoom(member);await show(member,textNote.messageId);
 assert.equal(await member.$(`#chat-message-${textNote.messageId} [aria-label="Message attachments"]`),null,'no pictures on a text-only note');
 await shot(member,'before-desktop');

 // 2. A PR with 2 pictures goes live: the real script uploads them, the note carries both.
 const note=`The new Pink theme is here, and ShortScout follows your colour (${stamp}).`;
 const changes=[{pr:prPictures,note,mergedAt:new Date().toISOString()}];
 const found=await readPictures(docs,prPictures);
 assert.deepEqual(found.pictures.map(p=>p.caption),['The new Pink theme','Pink on a phone']);
 assert.deepEqual(await attachPictures({changes,dir:docs,url,token}),[]);
 assert.equal(changes[0].pictures.length,2);
 const posted=await postChanges({url,token,sha,changes});
 assert.equal(posted.posted,true,JSON.stringify(posted));assert.equal(posted.pictures,2);assert.deepEqual(posted.followUpIds,[]);
 const [row]=await sql('select author_label,body,attachment_ids from longboard_chat_messages where id=$1',[posted.messageId]);
 assert.deepEqual([row.author_label,row.body,row.attachment_ids],['Booker Chat Updates',note,changes[0].pictures]);
 assert.equal((await postChanges({url,token,sha,changes})).posted,false,'a rerun posts nothing');
 assert.equal((await sql("select count(*)::int n from chat_attachments where whats_new_pr=$1",[prPictures]))[0].n,2,'no extra uploads');
 // Uploading for a PR that is already out is refused (the deploy run skips it).
 await assert.rejects(uploadPicture({url,token,pr:prPictures,picture:found.pictures[0]}),/pictures_already_posted/);
 await assert.rejects(uploadPicture({url,token:'wrong-token-wrong-token-wrong-token',pr:prLate,picture:found.pictures[0]}),/401/,'a bad token is refused');

 // 3. Desktop: both pictures in the note with their captions; each enlarges.
 await member.reload();await settled(member);await show(member,posted.messageId);
 assert.equal(await pictures(member,posted.messageId),2,'desktop: 2 pictures in the note');
 assert.deepEqual(await captions(member,posted.messageId),['The new Pink theme.png','Pink on a phone.png']);
 assert.match(await member.evaluate(id=>document.getElementById('chat-message-'+id).textContent,posted.messageId),/Booker Chat Updates/);
 await shot(member,'after-desktop');
 await enlarge(member,posted.messageId,0,'after-desktop-enlarged');
 await enlarge(member,posted.messageId,1,'after-desktop-enlarged-2');

 // 4. Phone: same note, no sideways scroll, tap to enlarge.
 await member.setViewport(phone);await openRoom(member);await show(member,posted.messageId);
 assert.equal(await pictures(member,posted.messageId),2,'phone: 2 pictures in the note');
 assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'phone: no horizontal page scroll');
 await shot(member,'after-phone');
 await enlarge(member,posted.messageId,1,'after-phone-enlarged');

 // 5. A PR announced without pictures (#434's case) gets them once, right after its note.
 await postChanges({url,token,sha,changes:[{pr:prLate,note:`ShortScout follows your theme (${stamp}).`,mergedAt:new Date().toISOString()}]});
 const late=await postPictures({pr:prLate,dir:docs,url,token});
 assert.equal(late.posted,true);assert.equal(late.messageIds.length,1);
 assert.deepEqual(late.bodies,[`Pictures: ShortScout follows your theme (${stamp}).`]);
 await assert.rejects(postPictures({pr:prLate,dir:docs,url,token}),/pictures_already_posted/,'only once');
 await member.setViewport(desktop);await openRoom(member);await show(member,late.messageIds[0]);
 assert.equal(await pictures(member,late.messageIds[0]),1,'follow-up shows its picture');
 assert.deepEqual(await captions(member,late.messageIds[0]),['Shortscout follows your theme.png']);
 await shot(member,'after-desktop-follow-up');

 assert.deepEqual(errors,[]);
 console.log("PASS What's New pictures desktop 1280 + phone 390: text-only note unchanged; note with 2 pictures via script + upload route, captions shown, each enlarges and fits the screen on desktop and phone, rerun posts nothing; pictures for an announced PR once, after its note; bad token refused.");
}finally{await browser.close();await rm(docs,{recursive:true,force:true});}
