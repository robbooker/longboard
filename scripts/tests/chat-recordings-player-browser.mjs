// #513: recordings rooms show a click-to-play card for YouTube and Loom links. Real chat components
// against the synthetic recordings fixture; every request to a video host is caught and stopped, so
// the test never touches the network. RECORDINGS_PLAYER_SHOTS=<dir> also saves screenshots there.
import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
const base='http://localhost:3513',fixture='http://127.0.0.1:54713';
const shots=process.env.RECORDINGS_PLAYER_SHOTS;
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[],stamp=Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const YT='5ndWE4BCt_Y',LOOM='510c0c2e6f3b4ea7b1eb2a81ad460866';
const ytLink=`https://youtu.be/${YT}?t=1m30s`,loomLink=`https://www.loom.com/share/${LOOM}`;
const ytSrc=`https://www.youtube-nocookie.com/embed/${YT}?autoplay=1&rel=0&start=90`,loomSrc=`https://www.loom.com/embed/${LOOM}?autoplay=1`;
const ytBody=`11/25/26 | LONGBOARD WEBINAR ${stamp}: ${ytLink}`,loomBody=`11/25/26 | MASTERMIND WEBINAR ${stamp}: ${loomLink}`,plainBody=`Watch this one ${stamp}: ${ytLink} and ${loomLink}`;
const VIDEO_HOST=/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|google\.com|loom\.com|loomcdn\.com)$/;
const settle=p=>p.waitForFunction(()=>{const t=[...document.querySelectorAll('textarea,nav button')].find(e=>e.checkVisibility());return t&&Object.keys(t).some(k=>k.startsWith('__reactProps'));},{timeout:60000});
async function login(name){
 const p=await(await browser.createBrowserContext()).newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(60000);
 // Anything bound for a video host is written down and stopped before it leaves the machine.
 p.videoRequests=[];await p.setRequestInterception(true);
 p.on('request',r=>{let host='';try{host=new URL(r.url()).hostname;}catch{}if(VIDEO_HOST.test(host)){p.videoRequests.push(r.url());r.abort();}else r.continue();});
 await p.setViewport({width:1440,height:1000});await signIn(p,base,name+'@example.test',{composer:'textarea[aria-label="Message LB"]'});return p;
}
async function send(p,room,body){const r=await p.evaluate(async({room,body})=>{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',room,body})});return {status:r.status,text:await r.text()};},{room,body});assert.equal(r.status,200,`${room}: ${r.text}`);await sleep(1700);}
const row=(p,body)=>p.waitForFunction(body=>{const e=[...document.querySelectorAll('article[id^="chat-message-"]')].find(e=>e.checkVisibility()&&e.textContent.includes(body));return e?.id;},{},body).then(h=>h.jsonValue());
const state=(p,id)=>p.evaluate(id=>{const a=document.getElementById(id);return {
 cards:[...a.querySelectorAll('[data-recording-video]')].map(c=>{const b=c.getBoundingClientRect(),f=c.querySelector('iframe');return {kind:c.dataset.recordingVideo,x:b.x,y:b.y,width:b.width,height:b.height,button:c.querySelector('button')?.getAttribute('aria-label')??null,text:c.textContent,
  frame:f?{src:f.getAttribute('src'),allow:f.getAttribute('allow'),fullscreen:f.hasAttribute('allowfullscreen'),loading:f.getAttribute('loading'),referrer:f.getAttribute('referrerpolicy'),sandbox:f.getAttribute('sandbox'),title:f.getAttribute('title'),w:f.getBoundingClientRect().width,h:f.getBoundingClientRect().height}:null};}),
 links:[...a.querySelectorAll('a[target="_blank"]')].map(l=>l.getAttribute('href')),
 thirdParty:[...document.querySelectorAll('iframe,script[src],img[src],link[href]')].map(e=>e.src||e.href).filter(u=>/youtu|ytimg|loom/i.test(u))};},id);
try{
 const admin=await login('alice'),member=await login('bob');
 await send(admin,'lb-recordings',ytBody);await send(admin,'lb-recordings',loomBody);
 // The same links in an ordinary room must stay plain links.
 await send(admin,'main',plainBody);

 await member.goto(`${base}/chat?room=lb-recordings`);await settle(member);
 const yt=await row(member,ytBody),loom=await row(member,loomBody);
 await member.waitForSelector(`#${yt} [data-recording-video="youtube"]`);await member.waitForSelector(`#${loom} [data-recording-video="loom"]`);
 await sleep(1500);
 let a=await state(member,yt),b=await state(member,loom);
 assert.equal(a.cards.length,1);assert.equal(b.cards.length,1);
 assert.equal(a.cards[0].frame,null,'no YouTube player before play');assert.equal(b.cards[0].frame,null,'no Loom player before play');
 assert.equal(await member.$('iframe'),null,'no iframe anywhere on load');
 assert.deepEqual(a.thirdParty,[],'nothing on the page points at a video host');
 assert.deepEqual(member.videoRequests,[],'opening the room asks nothing of YouTube or Loom');
 assert.equal(a.cards[0].button,`Play YouTube video: 11/25/26 | LONGBOARD WEBINAR ${stamp}`);assert.equal(b.cards[0].button,`Play Loom video: 11/25/26 | MASTERMIND WEBINAR ${stamp}`);
 assert.deepEqual(a.links,[ytLink],'the YouTube link is still in the message');assert.deepEqual(b.links,[loomLink],'the Loom link is still in the message');
 for(const c of [a.cards[0],b.cards[0]]){assert(c.width<=720.5&&c.width>300,`card width ${c.width}`);assert(Math.abs(c.width/c.height-16/9)<.02,'16:9');}
 if(shots)await member.screenshot({path:`${shots}/after-desktop.png`});

 // Play YouTube: the player takes the still card's place, in the same box.
 await member.click(`#${yt} [data-recording-video] button`);await member.waitForSelector(`#${yt} [data-recording-video] iframe`);
 const played=await state(member,yt);
 assert.deepEqual(played.cards[0].frame,{src:ytSrc,allow:'autoplay; fullscreen; picture-in-picture; encrypted-media',fullscreen:true,loading:'lazy',referrer:'strict-origin-when-cross-origin',sandbox:'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',title:`YouTube video: 11/25/26 | LONGBOARD WEBINAR ${stamp}`,w:played.cards[0].frame.w,h:played.cards[0].frame.h});
 for(const k of ['x','y','width','height'])assert.equal(played.cards[0][k],a.cards[0][k],`card ${k} unchanged on play`);
 assert(Math.abs(played.cards[0].frame.w-(a.cards[0].width-2))<1&&Math.abs(played.cards[0].frame.h-(a.cards[0].height-2))<1,'the player fills the card');
 assert.equal(played.cards[0].button,null);assert.deepEqual(played.links,[ytLink]);
 for(const end=Date.now()+10000;!member.videoRequests.length;await sleep(50))assert(Date.now()<end,'the player was asked for after play');
 assert.deepEqual(member.videoRequests,[ytSrc],'only the player address is requested');

 // Play Loom: its player loads and the YouTube card goes back to its still card.
 await member.click(`#${loom} [data-recording-video] button`);await member.waitForSelector(`#${loom} [data-recording-video] iframe`);
 await member.waitForSelector(`#${yt} [data-recording-video] button`);
 b=await state(member,loom);assert.equal(b.cards[0].frame.src,loomSrc);assert.equal(b.cards[0].frame.title,`Loom video: 11/25/26 | MASTERMIND WEBINAR ${stamp}`);
 assert.equal((await member.$$('iframe')).length,1,'one video at a time');
 for(const end=Date.now()+10000;member.videoRequests.length<2;await sleep(50))assert(Date.now()<end,'the Loom player was asked for');
 assert.deepEqual(member.videoRequests,[ytSrc,loomSrc]);

 // Phone width: fresh load, still cards only, nothing wider than the screen.
 member.videoRequests.length=0;await member.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await member.goto(`${base}/chat?room=lb-recordings`);await settle(member);await row(member,ytBody);await member.waitForSelector(`#${loom} [data-recording-video]`);await sleep(800);
 assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no sideways scroll at 390');
 a=await state(member,yt);assert.equal(a.cards[0].frame,null);assert(a.cards[0].x>=0&&a.cards[0].x+a.cards[0].width<=390,'card inside a 390 screen');assert(a.cards[0].width>250,`phone card width ${a.cards[0].width}`);assert(Math.abs(a.cards[0].width/a.cards[0].height-16/9)<.02);
 assert.deepEqual(member.videoRequests,[]);
 if(shots)await member.screenshot({path:`${shots}/after-phone.png`});
 await member.tap(`#${yt} [data-recording-video] button`);await member.waitForSelector(`#${yt} [data-recording-video] iframe`);
 const phone=await state(member,yt);assert.equal(phone.cards[0].frame.src,ytSrc);for(const k of ['x','y','width','height'])assert.equal(phone.cards[0][k],a.cards[0][k],`phone card ${k} unchanged on play`);
 assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no sideways scroll while playing');
 for(const width of [320,768,1440]){await member.setViewport({width,height:900});await sleep(150);assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`no overflow at ${width}`);}

 // Any other room: the same links are links and nothing more.
 member.videoRequests.length=0;await member.setViewport({width:1440,height:1000});await member.goto(`${base}/chat?room=main`);await settle(member);
 const plain=await row(member,plainBody);await sleep(1000);const other=await state(member,plain);
 assert.deepEqual(other.cards,[],'no card outside the recordings rooms');assert.deepEqual(other.links,[ytLink,loomLink]);
 assert.equal(await member.$('[data-recording-video]'),null);assert.equal(await member.$('iframe'),null);assert.deepEqual(member.videoRequests,[]);
 assert.deepEqual(errors,[]);
 console.log('PASS recordings rooms: YouTube and Loom still cards with no player and no video-host request on load, play swaps in the exact player address in the same box, one video at a time, link kept, 390-wide phone layout, no card in LB.');
}finally{await browser.close();}
