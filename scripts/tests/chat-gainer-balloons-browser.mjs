// #528 Gainer Balloons: the app in the chat and the card in Dual, Quad and Six, against the fixture
// on this test's own ports (localhost:3528, database 127.0.0.1:54528). Synthetic alerts, facts and
// bars only: chat-gainer-balloons-preload.mjs is the Next server's fake Polygon, and the weather
// route is answered here in the browser (no weather service is reached). The clock is pinned to
// 9:00 AM in New York (browser-manifest.mjs), so "today so far" is 4:00 to 9:00 AM.
//  - signed out: both routes refuse;
//  - the app opens from the sidebar's Apps section; the canvas draws a real picture (its pixels are
//    sampled); it starts Live at the market's clock with the day's date;
//  - the scrubber moves the clock and leaves Live; Live comes back with one tap; Space pauses and the
//    arrows step 2 minutes, only while the app has focus;
//  - tapping a balloon shows its details (price, change, volume, float, volume ÷ float; a dash for a
//    float or a previous close that isn't known); Find a ticker jumps to one and moves the camera;
//  - the legend explains size, stretch, height, movement, matte and the sky; nowhere does the app say
//    where data came from, or use buy/sell/pump words;
//  - weather: New York's by default with nothing asked of the browser; °F for a U.S. browser, a tap
//    switches to °C and it is remembered; "Change weather" (#531) opens a small panel: typing a
//    city shows up to six U.S. places (the real places route and list), picking one sends its id in
//    the body, shows its name and is remembered after a reload; a name that isn't a U.S. place says
//    so; "Use my location" in the panel asks only on that tap and sends the position rounded to one
//    decimal, in the body, never in the address; declined and unavailable both fall back to New York
//    with a line saying so; rain, snow, overcast and a clear night all draw;
//  - the clock (#532): New York time ("ET") by default; with a Central-time place chosen the clock
//    reads "8:0x AM CT" and the timeline runs 3:00 AM to 7:00 PM, after a reload too, and in a card;
//    New York brings "ET" back; "Use my location" with no zone in the reading uses the browser's
//    own; a long label ("AKT") fits on every phone shape; a time zone's name is never on screen;
//    matches are listed by population ("port": Portland, OR first);
//  - a card in Dual, Quad and Six draws, shows an in-card detail and an Open link, never shows
//    "Change weather" or triggers a location prompt, uses a remembered typed place, stops drawing while hidden, ignores keys typed in another pane, and
//    still has WebGL after its pane is switched away and back 10 times and after 10 moves between
//    Dual, Quad and Six;
//  - without WebGL: a plain list (ticker, change, volume), no blank card;
//  - a phone upright (390x844), on its side (844x390) and an unfolded folding phone (768x884): no
//    sideways scroll, every control on screen, a tap selects;
//  - no gainers: a line saying so; no page errors anywhere.
//  - full screen: an icon button in the app (never a card) fills the screen and comes back;
// CHAT_SHOT_DIR saves app-city-clock.png, app-change-weather-port.png, app-change-weather.png, app-change-weather-phone.png, app-fullscreen.png, app-desktop.png, app-selected.png, app-legend.png, app-phone.png,
// app-unfolded.png, card-dual.png, card-quad.png, card-six.png, fallback.png, weather-rain.png,
// weather-snow.png, weather-overcast.png and weather-clear-night.png.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import {signIn} from './browser-login.mjs';
const base=process.env.CHAT_TEST_URL||'http://localhost:3528',fixture=process.env.CHAT_FIXTURE_URL||'http://127.0.0.1:54528';
for(const url of [base,fixture])assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const shots=process.env.CHAT_SHOT_DIR,TOKEN='synthetic-gainers-lookup-token-never-a-production-secret';
const control=async(path,body={})=>{const r=await fetch(fixture+'/test/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return text?JSON.parse(text):null;};
const sql=(text,args=[])=>control('sql',{sql:text,args});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Pictures leave out the Next dev server's own corner badge: it isn't part of the app.
const shot=async(page,name)=>{if(shots){await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await sleep(700);await page.screenshot({path:`${shots}/${name}`});}};

// --- Today's gainers (all with 150K+ shares so the Gainers Table lists them) and their company facts.
// #533: the third value is the institutional ownership % (null: looked up, none found). CHNA and USAA
// also have shares outstanding in the fake Polygon (a market cap); ISRL has neither (two dashes).
const STOCKS={CHNA:['China',600_000,12.4],HKGO:['Hong Kong',2_000_000,0],CHHK:['China Hong Kong',900_000,null],SGPR:['Singapore',1_500_000,null],MLYS:['Malaysia',2_400_000,null],ISRL:['Israel',null,null],
 USAA:['U.S.',5_000_000,48],USBB:['U.S.',40_000_000,null],USCC:['U.S.',880_000,null],UNKF:['U.S.',null,3.25],NOPC:['U.S.',3_000_000,null],FADE:['Hong Kong',700_000,null],DOWN:['U.S.',1_000_000,null]};
let n=1;
for(const sym of Object.keys(STOCKS))await sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[n++,new Date(Date.now()-n*60_000).toISOString(),`🚨 ${sym} (+45.0%)\nPrice: $2.50\nVolume: 400,000\nMarket Cap: 12.5M`]);
for(const [ticker,[country,floatShares,instOwnPct]] of Object.entries(STOCKS)){
 const r=await fetch(`${base}/api/chat/gainers/facts`,{method:'POST',headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify({ticker,notFound:false,country,cashUsd:null,cashMonthsLeft:null,cashFlowPositive:false,instOwnPct,...(floatShares?{floatShares}:{})})});
 assert.equal(r.status,200,await r.text());
}
// Signed out: refused.
assert.equal((await fetch(`${base}/api/chat/balloons`)).status,401,'signed out: no balloons');
assert.equal((await fetch(`${base}/api/chat/balloons/weather`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401,'signed out: no weather');

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const errors=[];
const WEATHER={newYork:{condition:'partly',cloud:0.4,tempC:20,night:false,place:'New York',local:false,zone:'America/New_York'},chicago:{condition:'cloudy',cloud:0.9,tempC:10,night:false,place:'Chicago',local:true,zone:'America/Chicago'},austin:{condition:'clear',cloud:0.1,tempC:30,night:false,place:'Austin',local:true,zone:'America/Chicago'}};
/**
 * A signed-in page. `geo`: what the browser's location does when asked (granted, denied, unavailable)
 * and whether it would answer without a prompt (`permission`). Every ask is counted in the page.
 * The weather route is answered here; each request's address and body are kept in `page.weatherAsks`.
 * The places route is the real one; each search's address and body are kept in `page.placeAsks`.
 */
async function open({viewport,geo='granted',permission='prompt',webgl=true,theme='dark',feed=null,path='/chat',composer}={}){
 const context=await browser.createBrowserContext(),page=await context.newPage();
 page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`));
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|favicon/.test(m.text()))errors.push(`console: ${m.text()}`);});
 await page.setViewport(viewport);
 await context.setCookie({name:'longboard-chat-theme',value:theme,domain:'localhost',path:'/'});
 await page.evaluateOnNewDocument((geo,permission,webgl)=>{
  window.__geoAsks=0;
  const fake={getCurrentPosition(ok,fail){window.__geoAsks++;setTimeout(()=>geo==='granted'?ok({coords:{latitude:41.8781,longitude:-87.6298,accuracy:20}}):fail({code:geo==='denied'?1:2,PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3}),20);},watchPosition(){return 0;},clearWatch(){}};
  Object.defineProperty(Navigator.prototype,'geolocation',{get:()=>geo==='missing'?undefined:fake,configurable:true});
  const query=navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query=d=>d?.name==='geolocation'?Promise.resolve({state:window.__geoPermission??permission}):query(d);
  if(!webgl){const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...rest){return /webgl/.test(kind)?null:get.call(this,kind,...rest);};}
 },geo,permission,webgl);
 page.weatherAsks=[];page.weatherAnswer=null;page.placeAsks=[];
 await page.setRequestInterception(true);
 page.on('request',request=>{
  const url=new URL(request.url());
  if(url.pathname==='/api/chat/balloons/weather'){
   const body=JSON.parse(request.postData()||'{}');page.weatherAsks.push({search:url.search,body,method:request.method()});
   const weather=page.weatherAnswer??('lat' in body?WEATHER.chicago:'place' in body?WEATHER.austin:WEATHER.newYork);
   return request.respond({status:200,contentType:'application/json',body:JSON.stringify({weather,covered:true})});
  }
  if(url.pathname==='/api/chat/balloons/places')page.placeAsks.push({search:url.search,body:JSON.parse(request.postData()||'{}'),method:request.method()});
  if(feed&&url.pathname==='/api/chat/balloons')return request.respond({status:200,contentType:'application/json',body:JSON.stringify(feed())});
  request.continue();
 });
 await signIn(page,base,'bob@example.test',{next:path,...(composer===false?{composer:'[data-balloons-scrubber]'}:{})});
 return page;
}
const SEL={app:'[data-balloons="app"]',card:'[data-balloons="card"]'};
const drawn=(page,root)=>page.waitForFunction(s=>{const el=document.querySelector(s);return el?.dataset.webgl==='on'&&(el.__balloons?.scene()?.frames??0)>8;},{timeout:90000},root);
const PANEL=`${SEL.app} [data-balloons-weather-panel]`,FIELD=`${SEL.app} [data-balloons-place-search]`,PLACE=`${SEL.app} [data-balloons-place]`;
/** Opens the "Change weather" panel (the link is tapped by script, which works on a phone page too). */
const changeWeather=async page=>{await page.$eval(`${SEL.app} [data-balloons-weather-change]`,b=>b.click());await page.waitForSelector(PANEL);};
/** Types a city in the open panel (replacing what was there) and waits for the answer to exactly that text. */
const typePlace=async(page,text)=>{
 const before=page.placeAsks.length;
 await page.$eval(FIELD,e=>{e.focus();e.select();});await page.keyboard.type(text);
 await page.waitForFunction((s,text)=>document.querySelector(s)?.value===text,{},FIELD,text);
 await page.waitForFunction(s=>!!document.querySelector(s),{},`${PLACE}, ${SEL.app} [data-balloons-place-none]`);
 await sleep(500); // the pause before a search, and its answer
 assert(page.placeAsks.length>before,`"${text}" was searched for`);
 assert.equal(page.placeAsks.at(-1).body.q,text);
 return page.$$eval(PLACE,b=>b.map(e=>e.textContent));
};
/** "Use my location", in the panel. */
const myLocation=async page=>{await changeWeather(page);await page.$eval(`${SEL.app} [data-balloons-weather-local-button]`,b=>b.click());};
/** Back to New York's weather, the way a member does it: Change weather, type New York, pick New York, NY. */
const newYork=async page=>{
 page.weatherAnswer=null;
 await changeWeather(page);
 assert.equal((await typePlace(page,'New York'))[0],'New York, NY');
 await page.$eval(`${SEL.app} [data-balloons-place="ny:new york"]`,b=>b.click());
 await page.waitForFunction(s=>document.querySelector(s)?.textContent.includes('New York'),{},`${SEL.app} [data-balloons-weather]`);
 assert.equal(await page.evaluate(()=>{const v=JSON.parse(localStorage.getItem('rb-balloons-weather-v1'));return v.local===false&&!('place' in v);}),true,'New York is the default: nothing is remembered');
 await clockIn(page,SEL.app,'ET');
 if((await axis(page)).length)assert.deepEqual(await axis(page),['4:00 AM','9:30 AM','12:00 PM','4:00 PM','8:00 PM'],'New York: the timeline is in New York time again');
};
const scene=(page,root)=>page.$eval(root,el=>({...el.__balloons.scene(),mode:el.__balloons.mode(),time:el.__balloons.time()}));
const clock=(page,root)=>page.$eval(`${root} [data-balloons-clock]`,e=>e.textContent);
const mode=(page,root)=>page.$eval(root,e=>e.dataset.mode);
/** Waits for the clock to read in a zone ("CT"), and answers what it reads. */
const clockIn=async(page,root,letters)=>{await page.waitForFunction((s,l)=>document.querySelector(s)?.textContent.endsWith(' '+l),{},`${root} [data-balloons-clock]`,letters);return clock(page,root);};
/** The timeline's labels, left to right. */
const axis=page=>page.$$eval(`${SEL.app} [data-balloons-axis] span`,list=>list.map(e=>e.textContent));
/** Everything a member could read or hear in the app: text, tooltips and labels. */
const allWords=(page,root)=>page.$eval(root,e=>e.innerText+' '+[...e.querySelectorAll('[title],[aria-label]')].map(x=>`${x.title} ${x.getAttribute('aria-label')??''}`).join(' '));
/** The canvas as the viewer sees it, shrunk to 200 pixels wide: how many different colours it has. A blank canvas has one. */
async function colours(page,root){
 const canvas=await page.$(`${root} canvas[data-balloons-canvas]`);assert(canvas,`${root} has a canvas`);
 const {data,info}=await sharp(await canvas.screenshot()).resize({width:200}).raw().toBuffer({resolveWithObject:true});
 const seen=new Set();
 for(let i=0;i<data.length;i+=info.channels)seen.add(`${data[i]>>3},${data[i+1]>>3},${data[i+2]>>3}`);
 return seen.size;
}
const picture=async(page,root,what)=>{const count=await colours(page,root);assert(count>=40,`${what}: the canvas shows a picture (${count} colours)`);return count;};
const within=(page,selectors)=>page.evaluate(list=>list.flatMap(s=>{const e=[...document.querySelectorAll(s)].find(x=>x.checkVisibility());if(!e)return [`${s} missing`];const r=e.getBoundingClientRect();return r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1?[]:[`${s} off screen ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`];}),selectors);
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
/**
 * Taps where a balloon is. Another balloon may be in front of it, so the answer is whichever one the
 * tap selected. Balloons sway, and on a slow machine one can drift from under the spot between
 * looking and tapping: a tap that lands on sky selects nothing, so it is simply aimed again.
 */
const tap=async(page,root,ticker,touch=false)=>{
 for(let attempt=1;;attempt++){
  const at=await page.$eval(root,(el,ticker)=>{const p=el.__balloons.where(ticker),r=el.getBoundingClientRect();return p&&{x:r.left+p.x,y:r.top+p.y};},ticker);
  assert(at,`${ticker} is on screen`);
  if(touch)await page.touchscreen.tap(at.x,at.y);else await page.mouse.click(at.x,at.y);
  try{await page.waitForSelector(`${root} [data-balloons-detail]`,{timeout:4000});break;}catch(e){if(attempt===6)throw e;}
 }
 const selected=await page.$eval(`${root} [data-balloons-detail]`,e=>e.dataset.balloonsDetail);
 assert(selected in STOCKS,`a tap selects a balloon (${selected})`);
 return selected;
};
const detail=(page,root)=>page.$eval(`${root} [data-balloons-detail]`,e=>({ticker:e.dataset.balloonsDetail,price:e.querySelector('header [data-balloons-price]').textContent,change:e.querySelector('header [data-balloons-change]').textContent,direction:e.querySelector('header [data-balloons-change]').dataset.direction??null,country:e.querySelector('[data-balloons-country]').textContent,cells:Object.fromEntries([...e.querySelectorAll('dl > div')].map(d=>[d.querySelector('dt').textContent,d.querySelector('dd').textContent]))}));
const pane=i=>`section[aria-label^="Pane ${i}:"]`;
/** Chooses what a Dual or Quad pane shows, once its picker is ready. */
const choose=async(page,i,key)=>{await page.waitForFunction((s,key)=>!!document.querySelector(`${s} select option[value="${key}"]`)||key==='',{timeout:60000},pane(i),key);await page.select(`${pane(i)} select`,key);};
const scrub=(page,root,value)=>page.$eval(`${root} [data-balloons-scrubber]`,(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));},value);

try{
 // ---------- The app on a computer.
 {
  const page=await open({viewport:{width:1440,height:900}});
  await page.waitForFunction(()=>{const a=[...document.querySelectorAll('a[data-chat-app="balloons"]')].find(e=>e.checkVisibility());return a&&Object.keys(a).some(k=>k.startsWith('__reactProps$'));},{timeout:60000});
  assert.equal(await page.$eval('a[data-chat-app="balloons"]',a=>a.textContent.trim()),'Gainer Balloons','listed in the Apps section');
  assert.equal(await page.$eval('a[data-chat-app="balloons"]',a=>a.getAttribute('href')),'/chat?page=balloons','a stable address');
  await (await page.evaluateHandle(()=>[...document.querySelectorAll('a[data-chat-app="balloons"]')].find(e=>e.checkVisibility()))).click();
  await drawn(page,SEL.app);await picture(page,SEL.app,'app');
  assert.equal(await page.$$eval('canvas[data-balloons-canvas]',c=>c.length),1,'one canvas');
  assert.equal(await mode(page,SEL.app),'live','it starts Live');
  assert.match(await clock(page,SEL.app),/^9:\d\d AM ET$/,'the market clock');
  assert.deepEqual(await axis(page),['4:00 AM','9:30 AM','12:00 PM','4:00 PM','8:00 PM'],'the timeline in New York time');
  assert.match(await page.$eval(`${SEL.app} [data-balloons-scrubber]`,e=>e.getAttribute('aria-label')),/: 4:00 AM to 8:00 PM New York time$/);
  const today=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric'}).format(new Date());
  assert.equal(await page.$eval(`${SEL.app} [data-balloons-date]`,e=>e.textContent),today,'the day is dated');
  // Weather: New York's, with nothing asked of the browser, and nothing about the place in the address.
  await page.waitForSelector(`${SEL.app} [data-balloons-weather]`);
  assert.deepEqual(page.weatherAsks,[{search:'',body:{},method:'POST'}],'one weather read, for New York');
  assert.equal(await page.evaluate(()=>window.__geoAsks),0,'no location asked for on load');
  assert.equal(await page.$eval(`${SEL.app} [data-balloons-weather]`,e=>e.textContent),'68°FNew York','°F for a U.S. browser');
  assert.equal(await page.$eval(`${SEL.app} [data-weather-icon]`,e=>e.dataset.weatherIcon),'partly');
  await shot(page,'app-desktop.png');
  await page.click(`${SEL.app} [data-balloons-weather]`);
  assert.equal(await page.$eval(`${SEL.app} [data-balloons-temp]`,e=>e.textContent),'20°C','a tap switches the unit');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rb-balloons-weather-v1')).unit),'C','and it is remembered');
  await page.click(`${SEL.app} [data-balloons-weather]`);
  // "Change weather": one link beside the readout; it opens a small panel with the field in focus.
  const link=`${SEL.app} [data-balloons-weather-change]`;
  assert.equal(await page.$eval(link,e=>`${e.textContent} ${e.getAttribute('aria-expanded')}`),'Change weather false');
  assert.doesNotMatch(await page.$eval(SEL.app,e=>e.innerText),/Use my local weather/);
  assert.equal(await page.$(PANEL),null,'the panel is closed until asked for');
  await page.click(link);await page.waitForSelector(PANEL);
  await page.waitForFunction(s=>document.activeElement===document.querySelector(s),{},FIELD);
  assert.equal(await page.$eval(FIELD,e=>`${e.placeholder}|${e.getAttribute('aria-label')}|${e.maxLength}`),'City or place|City or place|60');
  assert.equal(await page.$eval(`${PANEL} [data-balloons-weather-local-button]`,e=>e.textContent),'Use my location');
  await page.keyboard.press('Escape');await page.waitForSelector(PANEL,{hidden:true});
  assert.equal(await page.$(`${SEL.app} [data-balloons-detail]`),null);
  await changeWeather(page);
  // Typing shows up to six matches as "City, ST", from the real list.
  let places=await typePlace(page,'austin');
  assert.equal(places[0],'Austin, TX');assert(places.length>1&&places.length<=6,`up to six matches (${places})`);
  for(const label of places)assert.match(label,/^Austin[\w .'-]*, [A-Z]{2}$/,label);
  assert.equal(await page.evaluate(s=>{const p=getComputedStyle(document.querySelector(s)).backgroundColor.match(/[\d.]+/g);return p.length<4||Number(p[3])===1;},PANEL),true,'a solid panel');
  assert.doesNotMatch(await page.$eval(PANEL,e=>e.innerText+' '+[...e.querySelectorAll('*')].map(x=>`${x.title} ${x.getAttribute('aria-label')??''} ${x.getAttribute('placeholder')??''}`).join(' ')),/source|census|gazetteer|weather\.gov|national weather/i);
  await shot(page,'app-change-weather.png');
  // Matches are listed by population (#532): the big Portland first, no tiny Alaska place near the top.
  places=await typePlace(page,'port');
  assert.equal(places[0],'Portland, OR');assert(places.includes('Portsmouth, VA'),`"port" lists Portsmouth, VA (${places})`);
  assert(!places.some(label=>label.endsWith(', AK')),`no small Alaska place among the first six (${places})`);
  await shot(page,'app-change-weather-port.png');
  assert.deepEqual((await typePlace(page,'san')).slice(0,3),['San Antonio, TX','San Diego, CA','San Jose, CA']);
  // Not a U.S. place: one plain line.
  assert.deepEqual(await typePlace(page,'zzyzxq'),[]);
  assert.equal(await page.$eval(`${SEL.app} [data-balloons-place-none]`,e=>e.textContent),'No U.S. place by that name.');
  // "austin tx" puts Austin, TX first; picking it closes the panel and sends its id in the body.
  places=await typePlace(page,'austin tx');
  assert.equal(places[0],'Austin, TX');
  assert(page.placeAsks.length>=3&&page.placeAsks.every(a=>a.search===''&&a.method==='POST'),'what was typed is never in the address');
  await page.click(`${SEL.app} [data-balloons-place="tx:austin"]`);
  await page.waitForSelector(PANEL,{hidden:true});
  await page.waitForFunction(s=>document.querySelector(s)?.textContent.includes('Austin'),{},`${SEL.app} [data-balloons-weather]`);
  assert.deepEqual(page.weatherAsks.at(-1),{search:'',body:{place:'tx:austin'},method:'POST'},'the chosen place is sent in the body');
  assert.equal(await page.$eval(`${SEL.app} [data-balloons-weather]`,e=>e.textContent),'86°FAustin','the readout shows the place\'s name');
  assert.equal(await page.evaluate(()=>localStorage.getItem('rb-balloons-weather-v1')),'{"local":false,"unit":"F","place":{"id":"tx:austin","name":"Austin","zone":"America/Chicago"}}','the typed place is remembered, with its time zone for the clock');
  assert.equal(await page.$eval(link,e=>e.textContent),'Change weather','the link stays beside the readout');
  // The clock follows the place (#532): Austin is an hour behind New York, so 9:00 AM reads 8:00 AM CT
  // and the day runs 3:00 AM to 7:00 PM. The day itself hasn't moved: still Live, same session.
  assert.match(await clockIn(page,SEL.app,'CT'),/^8:\d\d AM CT$/,'the clock in Austin\'s time');
  assert.deepEqual(await axis(page),['3:00 AM','8:30 AM','11:00 AM','3:00 PM','7:00 PM'],'the timeline in Austin\'s time');
  assert.match(await page.$eval(`${SEL.app} [data-balloons-scrubber]`,e=>e.getAttribute('aria-label')),/: 3:00 AM to 7:00 PM CT$/);
  assert.equal(await mode(page,SEL.app),'live','still Live');
  {const words=await allWords(page,SEL.app);
   assert.match(words,/Pre-market, 3:00 AM to 8:30 AM CT/);assert.match(words,/After hours, 3:00 PM to 7:00 PM CT/);
   assert.doesNotMatch(words,/America\/|Chicago|\bCST\b|\bCDT\b|time ?zone| ET\b/i,'no zone name, and nothing left in ET');}
  await shot(page,'app-city-clock.png');
  // Remembered after a reload, with nothing asked of the browser.
  await page.reload();await drawn(page,SEL.app);
  await page.waitForFunction(s=>document.querySelector(s)?.textContent==='86°FAustin',{},`${SEL.app} [data-balloons-weather]`);
  assert.deepEqual(page.weatherAsks.at(-1).body,{place:'tx:austin'},'the remembered place after a reload');
  assert.match(await clockIn(page,SEL.app,'CT'),/^8:\d\d AM CT$/,'the clock holds after a reload');
  assert.deepEqual(await axis(page),['3:00 AM','8:30 AM','11:00 AM','3:00 PM','7:00 PM'],'and so does the timeline');
  assert.equal(await page.evaluate(()=>window.__geoAsks),0,'typing a place never asks for the location');
  // Enter picks the first match.
  await changeWeather(page);
  assert.equal((await typePlace(page,'Portland, Maine'))[0],'Portland, ME');
  await page.keyboard.press('Enter');await page.waitForSelector(PANEL,{hidden:true});
  for(let i=0;i<60&&page.weatherAsks.at(-1).body.place!=='me:portland';i++)await sleep(50);
  assert.deepEqual(page.weatherAsks.at(-1).body,{place:'me:portland'},'Enter picks the first match');
  // "Use my location": asked on the tap, rounded before it is sent, in the body.
  await changeWeather(page);
  assert.equal(await page.evaluate(()=>window.__geoAsks),0,'opening the panel asks nothing');
  await page.click(`${SEL.app} [data-balloons-weather-local-button]`);
  await page.waitForSelector(PANEL,{hidden:true});
  await page.waitForFunction(s=>document.querySelector(s)?.textContent.includes('Chicago'),{},`${SEL.app} [data-balloons-weather]`);
  assert.equal(await page.evaluate(()=>window.__geoAsks),1,'asked once, on the tap');
  assert.deepEqual(page.weatherAsks.at(-1),{search:'',body:{lat:41.9,lon:-87.6},method:'POST'},'the place is rounded to one decimal and sent in the body');
  assert.equal(await page.$eval(`${SEL.app} [data-balloons-weather]`,e=>e.textContent),'50°FChicago');
  assert.match(await clockIn(page,SEL.app,'CT'),/^8:\d\d AM CT$/,'the viewer\'s own area: its time');
  assert.equal(await page.evaluate(()=>localStorage.getItem('rb-balloons-weather-v1')),'{"local":true,"unit":"F"}','only the choice is stored, never the position (and the typed place is forgotten)');
  assert.equal(await page.$eval(link,e=>e.textContent),'Change weather','the link is always there');
  assert.doesNotMatch(await page.$eval(SEL.app,e=>e.innerText),/Use New York weather/);
  await newYork(page);
  assert.deepEqual(page.weatherAsks.at(-1).body,{},'New York again');
  // Full screen: one icon button; the app itself fills the screen, keeps drawing, and comes back.
  const fs=`${SEL.app} [data-balloons-fullscreen]`;
  assert.equal(await page.$eval(fs,e=>`${e.dataset.balloonsFullscreen} ${e.getAttribute('aria-label')}`),'off Full screen');
  await page.click(fs);
  await page.waitForFunction(s=>document.querySelector(s)?.dataset.balloonsFullscreen==='on',{},fs);
  assert.equal(await page.evaluate(s=>document.fullscreenElement===document.querySelector(s),SEL.app),true,'the app is the full-screen element');
  assert.equal(await page.$eval(fs,e=>e.getAttribute('aria-label')),'Leave full screen');
  await sleep(600);await picture(page,SEL.app,'full screen');
  await shot(page,'app-fullscreen.png');
  await page.click(fs);
  await page.waitForFunction(s=>document.querySelector(s)?.dataset.balloonsFullscreen==='off',{},fs);
  assert.equal(await page.evaluate(()=>document.fullscreenElement),null,'back out of full screen');

  // The scrubber replays the day so far; Live comes back with one tap.
  await scrub(page,SEL.app,300);
  await page.waitForFunction(s=>document.querySelector(s)?.dataset.mode==='replay',{},SEL.app);
  await page.waitForFunction(s=>document.querySelector(s)?.textContent==='8:48 AM ET',{},`${SEL.app} [data-balloons-clock]`);
  await scrub(page,SEL.app,900);
  await page.waitForFunction(s=>document.querySelector(s)?.dataset.mode==='live',{},SEL.app);
  assert.match(await clock(page,SEL.app),/^9:\d\d AM ET$/,'dragging past now is Live, never the future');
  await scrub(page,SEL.app,100);
  await page.waitForFunction(s=>document.querySelector(s)?.textContent==='5:36 AM ET',{},`${SEL.app} [data-balloons-clock]`);
  await page.click(`${SEL.app} [data-balloons-live]`);
  await page.waitForFunction(s=>document.querySelector(s)?.dataset.mode==='live',{},SEL.app);
  // Keys, once the app has focus: Space pauses, the arrows step 2 minutes, Play resumes.
  await page.mouse.click(1380,260);
  assert.equal(await page.$(`${SEL.app} [data-balloons-detail]`),null,'a tap on the sky selects nothing');
  await page.keyboard.press('Space');
  await page.waitForFunction(s=>document.querySelector(s)?.dataset.mode==='replay',{},SEL.app);
  const held=await clock(page,SEL.app);
  await page.keyboard.press('ArrowLeft');
  const minutes=t=>{const [,h,m]=t.match(/^(\d+):(\d+)/);return Number(h)*60+Number(m);};
  await page.waitForFunction((s,before)=>document.querySelector(s)?.textContent!==before,{},`${SEL.app} [data-balloons-clock]`,held);
  assert.equal(minutes(await clock(page,SEL.app)),minutes(held)-2,'left arrow: back 2 minutes');
  await page.click(`${SEL.app} [data-balloons-live]`);
  await page.waitForFunction(s=>document.querySelector(s)?.dataset.mode==='live',{},SEL.app);

  // A tap on a balloon shows its details.
  await page.click(`${SEL.app} [data-balloons-reset]`);await sleep(900);
  await tap(page,SEL.app,'UNKF');
  await page.keyboard.press('Escape');await page.waitForSelector(`${SEL.app} [data-balloons-detail]`,{hidden:true});
  const find=async ticker=>{await page.click(`${SEL.app} [data-balloons-search-button]`);await page.type(`${SEL.app} [data-balloons-search]`,ticker.toLowerCase());await page.keyboard.press('Enter');await page.waitForSelector(`${SEL.app} [data-balloons-detail="${ticker}"]`);return detail(page,SEL.app);};
  let d=await find('ISRL');
  // #533: the price and the change are in the card's header beside the ticker; the rows are the rest, without "Prev close".
  assert.deepEqual(Object.keys(d.cells),['Volume','Float','Volume ÷ float','Market cap','Institutional']);
  assert.match(d.price,/^\$\d+\.\d\d$/);assert.match(d.change,/^\+\d+\.\d%$/);assert.equal(d.direction,'up');assert.equal(d.country,'Israel');assert.match(d.cells.Volume,/^\d+(\.\d+)?[KM]$/);
  assert.equal(d.cells['Market cap'],'—','a market cap that isn\'t known is a dash');assert.equal(d.cells.Institutional,'—','institutional ownership that isn\'t known is a dash');
  assert.doesNotMatch(await page.$eval(`${SEL.app} [data-balloons-detail]`,e=>e.textContent),/Prev close/);
  assert.equal(d.cells.Float,'—','a float that isn\'t known is a dash');assert.equal(d.cells['Volume ÷ float'],'—');
  assert.match(await page.$eval(`${SEL.app} [data-balloons-detail]`,e=>e.textContent),/Float not known/);
  await page.keyboard.press('Escape');await page.waitForSelector(`${SEL.app} [data-balloons-detail]`,{hidden:true});
  // Find a ticker jumps to it.
  const before=(await scene(page,SEL.app)).target;
  await page.click(`${SEL.app} [data-balloons-search-button]`);
  await page.type(`${SEL.app} [data-balloons-search]`,'chn');
  assert.deepEqual(await page.$$eval(`${SEL.app} [data-balloons-match]`,b=>b.map(e=>e.dataset.balloonsMatch)),['CHNA']);
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${SEL.app} [data-balloons-detail="CHNA"]`);
  d=await detail(page,SEL.app);
  assert.equal(d.cells.Float,'600.0K');assert.match(d.cells['Volume ÷ float'],/^\d+(\.\d+)?×$/);
  // #533: 12.4% held by institutions; the market cap is the price on the card times 10M shares.
  assert.equal(d.cells.Institutional,'12.4%');assert.equal(d.country,'China');
  const capFits=(d,what)=>{const m=d.cells['Market cap'].match(/^\$(\d+\.\d)M$/);assert(m&&Math.abs(Number(m[1])-Number(d.price.slice(1))*10)<=0.11,`${what}: market cap ${d.cells['Market cap']} = ${d.price} x 10M shares`);};
  capFits(d,'live');const liveCap=d.cells['Market cap'];
  assert.deepEqual(await within(page,[`${SEL.app} [data-balloons-detail] header`,`${SEL.app} [data-balloons-detail] dl`]),[],'the card\'s header and rows stay inside it');
  await sleep(1200);
  const after=(await scene(page,SEL.app)).target;
  assert(Math.hypot(after[0]-before[0],after[2]-before[2])>3,`the camera moved to it (${before} -> ${after})`);
  const where=await page.$eval(SEL.app,el=>{const p=el.__balloons.where('CHNA');return [p.x/el.clientWidth,p.y/el.clientHeight];});
  assert(Math.abs(where[0]-0.5)<0.12&&Math.abs(where[1]-0.5)<0.2,`CHNA is in the middle of the view (${where})`);
  await shot(page,'app-selected.png');
  // Scrubbed back, the market cap follows the price shown at that time.
  await scrub(page,SEL.app,250);
  await page.waitForFunction(s=>document.querySelector(s)?.dataset.mode==='replay',{},SEL.app);await sleep(900);
  d=await detail(page,SEL.app);
  capFits(d,'replay');assert.notEqual(d.cells['Market cap'],liveCap,'earlier in the day the market cap was a different one');
  await page.click(`${SEL.app} [data-balloons-live]`);
  await page.waitForFunction(s=>document.querySelector(s)?.dataset.mode==='live',{},SEL.app);
  d=await find('USAA');
  assert.equal(d.cells.Institutional,'48%');assert.match(d.cells['Market cap'],/^\$1\.[0-9]B$/,`USAA: about $5 x 250M weighted shares (${d.cells['Market cap']})`);
  d=await find('HKGO');
  assert.equal(d.cells.Institutional,'0%','0% is a real answer, not a dash');assert.match(d.cells['Market cap'],/^\$\d\.\dM$/,`HKGO: its share-class count (${d.cells['Market cap']})`);
  d=await find('NOPC');
  assert.equal(d.cells['Market cap'],'—');assert.match(await page.$eval(`${SEL.app} [data-balloons-detail]`,e=>e.textContent),/No previous close: change is from the day’s first trade\./);
  await page.keyboard.press('Escape');
  await page.click(`${SEL.app} [data-balloons-reset]`);
  // The legend.
  await page.click(`${SEL.app} [data-balloons-legend-button]`);
  const legend=await page.$eval(`${SEL.app} [data-balloons-legend]`,e=>e.textContent);
  for(const word of ['Size','Stretch','Height','Movement','Matte','float not known','China / Hong Kong','follows New York','show that place’s time','not advice'])assert(legend.includes(word),`the legend says "${word}"`);
  await shot(page,'app-legend.png');
  await page.keyboard.press('Escape');await page.waitForSelector(`${SEL.app} [data-balloons-legend]`,{hidden:true});
  // Never where data came from, and no trading words.
  const words=await allWords(page,SEL.app);
  assert.doesNotMatch(words,/source|census|polygon|dilution|weather\.gov|from the gainers|\bbuy|\bsell|pump|America\//i);

  // Weather the sky draws: each answer comes back from the faked route on the next read.
  const sky=async(answer,name,progress)=>{
   page.weatherAnswer=answer;
   await myLocation(page);
   await page.waitForFunction((s,c)=>document.querySelector(s)?.dataset.balloonsWeather===c,{},`${SEL.app} [data-balloons-weather]`,answer.condition);
   if(progress!==undefined)await scrub(page,SEL.app,progress);
   await sleep(2600);await picture(page,SEL.app,name);
   assert.equal(await page.$eval(`${SEL.app} [data-weather-icon]`,e=>e.dataset.weatherIcon),answer.condition+(answer.night?'-night':''));
   await shot(page,`${name}.png`);
   await newYork(page);
  };
  await sky({condition:'rain',cloud:1,tempC:12,night:false,place:'Seattle',local:true},'weather-rain');
  await sky({condition:'snow',cloud:1,tempC:-3,night:false,place:'Denver',local:true},'weather-snow');
  await sky({condition:'cloudy',cloud:1,tempC:9,night:false,place:'Cleveland',local:true},'weather-overcast');
  await sky({condition:'clear',cloud:0,tempC:4,night:true,place:'Anchorage',local:true},'weather-clear-night',4);
  // A reading with no temperature: a dash, never a made-up number. It has no time zone either:
  // for the viewer's own area the clock then uses this browser's own (here: Denver's).
  await page.emulateTimezone('America/Denver');
  page.weatherAnswer={condition:'fog',cloud:0.8,tempC:null,night:false,place:null,local:true};
  await myLocation(page);
  await page.waitForFunction(s=>document.querySelector(s)?.dataset.balloonsWeather==='fog',{},`${SEL.app} [data-balloons-weather]`);
  assert.equal(await page.$eval(`${SEL.app} [data-balloons-weather]`,e=>e.textContent),'—Your weather');
  assert.match(await clockIn(page,SEL.app,'MT'),/^\d{1,2}:\d\d [AP]M MT$/,'no zone in the reading: the browser\'s own');
  // A zone the clock doesn't know (or a reading for New York): New York time.
  page.weatherAnswer={condition:'fog',cloud:0.8,tempC:null,night:false,place:'Somewhere',local:true,zone:'Europe/London'};
  await page.emulateTimezone('Europe/London');
  await myLocation(page);
  await page.waitForFunction(s=>document.querySelector(s)?.textContent.includes('Somewhere'),{},`${SEL.app} [data-balloons-weather]`);
  assert.match(await clockIn(page,SEL.app,'ET'),/^\d{1,2}:\d\d [AP]M ET$/,'an unknown zone stays on New York time');
  // The weather route failing changes nothing on screen.
  assert.equal((await scene(page,SEL.app)).contextLost,false);
  await page.close();
 }
 // ---------- Location declined, and not available: New York, with a line saying so.
 for(const [geo,line] of [['denied',/Location is turned off for this site/],['unavailable',/isn’t available right now/],['missing',/isn’t available right now/]]){
  const page=await open({viewport:{width:1280,height:800},geo,path:'/chat?page=balloons',composer:false});
  await drawn(page,SEL.app);
  await page.waitForSelector(`${SEL.app} [data-balloons-weather]`);
  assert.equal(await page.$(`${SEL.app} [data-balloons-weather-local-button]`),null,`${geo}: "Use my location" is only in the panel`);
  await myLocation(page);
  await page.waitForSelector(`${SEL.app} [data-balloons-weather-note]`);
  assert.match(await page.$eval(`${SEL.app} [data-balloons-weather-note]`,e=>e.textContent),line,geo);
  assert.equal(await page.$eval(`${SEL.app} [data-balloons-weather]`,e=>e.textContent),'68°FNew York',`${geo}: New York's weather stays`);
  assert(page.weatherAsks.every(a=>!('lat' in a.body)&&a.search===''),`${geo}: no place was sent`);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rb-balloons-weather-v1')||'{}').local??false),false,`${geo}: not remembered as local`);
  await page.close();
 }

 // ---------- Cards: Dual, Quad and Six.
 {
  // The viewer chose local weather earlier, but this browser would have to ask again: a card must not.
  const page=await open({viewport:{width:1600,height:900},permission:'prompt',path:'/chat/dual',composer:'textarea[aria-label^="Message "]'});
  await page.evaluate(()=>localStorage.setItem('rb-balloons-weather-v1','{"local":true,"unit":"F"}'));
  const put=(i,key)=>choose(page,i,key);
  const card=async(name,file)=>{
   await drawn(page,SEL.card);await picture(page,SEL.card,name);
   assert.equal(await page.$$eval('canvas[data-balloons-canvas]',c=>c.length),1,`${name}: one canvas`);
   assert.equal(await mode(page,SEL.card),'live');assert.match(await clock(page,SEL.card),/^9:\d\d AM ET$/);
   assert.equal(await page.$eval(`${SEL.card} [data-balloons-open]`,a=>`${a.getAttribute('href')} ${a.target}`),'/chat?page=balloons _blank',`${name}: a way to the full app`);
   assert.equal(await page.$(`${SEL.card} [data-balloons-weather-local-button]`),null,`${name}: a card never offers the location prompt`);
   assert.equal(await page.$(`${SEL.card} [data-balloons-weather-change]`),null,`${name}: a card never shows "Change weather"`);
   assert.doesNotMatch(await page.$eval(SEL.card,e=>e.innerText),/Change weather|Use my location/,name);
   assert.equal(await page.$(`${SEL.card} [data-balloons-fullscreen]`),null,`${name}: no full-screen button in a card`);
   assert.equal(await page.$(`${SEL.card} [data-balloons-legend-button]`),null,`${name}: small chrome only`);
   const s=await scene(page,SEL.card);
   const room=await page.$eval(SEL.card,e=>Math.round(Math.min(60,Math.max(5,e.clientWidth*e.clientHeight/22000))));
   assert(s.labelsShown>=3&&s.labelsShown<=room,`${name}: ticker labels for the biggest stories only, as many as the card has room for (${s.labelsShown} of at most ${room})`);
   assert(s.pixelRatio<=1.5,`${name}: the pixel ratio is capped (${s.pixelRatio})`);
   await tap(page,SEL.card,'UNKF');
   const inCard=await detail(page,SEL.card);
   assert.deepEqual(Object.keys(inCard.cells),['Volume','Float','Volume ÷ float','Market cap','Institutional'],`${name}: details in the card`);
   assert.match(inCard.price,/^\$\d+\.\d\d$/,name);assert.equal(inCard.cells.Institutional,'3.3%',name);assert.equal(inCard.cells['Market cap'],'—',name);
   assert.deepEqual(await within(page,[`${SEL.card} [data-balloons-detail] header`,`${SEL.card} [data-balloons-detail] [data-balloons-quote]`,`${SEL.card} [data-balloons-detail] dl`]),[],`${name}: the price and the rows stay inside the card`);
   assert.deepEqual(await page.$eval(`${SEL.card} [data-balloons-detail]`,e=>[...e.querySelectorAll('dd,[data-balloons-quote] span')].filter(x=>x.scrollWidth>x.clientWidth+1).map(x=>x.textContent)),[],`${name}: no value is cut off`);
   assert.deepEqual(await within(page,[`${SEL.card} [data-balloons-detail]`,`${SEL.card} [data-balloons-open]`,`${SEL.card} [data-balloons-clock]`]),[],name);
   await shot(page,file);
   await page.click(`${SEL.card} [data-balloons-detail] button`);
  };
  await put(2,'app:balloons');
  await card('Dual','card-dual.png');
  assert(await page.$(`${SEL.card} [data-balloons-scrubber]`),'Dual: a slim scrubber');
  assert.equal(await page.evaluate(()=>window.__geoAsks),0,'a card never asks for the location');
  assert(page.weatherAsks.length>=1&&page.weatherAsks.every(a=>!('lat' in a.body)),'the card shows New York\'s weather');
  // Typing in the chat beside it reaches the chat, not the balloons.
  await page.click(`${pane(1)} textarea[aria-label^="Message "]`);await page.keyboard.type('a b c ');await page.keyboard.press('ArrowLeft');
  assert.equal(await page.$eval(`${pane(1)} textarea[aria-label^="Message "]`,t=>t.value),'a b c ','the composer got every key');
  assert.equal(await mode(page,SEL.card),'live','and the card stayed Live');
  await page.$eval(`${pane(1)} textarea[aria-label^="Message "]`,t=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'');t.dispatchEvent(new Event('input',{bubbles:true}));});
  // Hidden (the other pane expanded): it stops drawing; shown again: it carries on.
  await page.click(`${pane(1)} button[aria-label="Expand pane 1"]`);
  await sleep(600);const stopped=(await scene(page,SEL.card)).frames;await sleep(1500);
  assert.equal((await scene(page,SEL.card)).frames,stopped,'a hidden card draws nothing');
  await page.click(`${pane(1)} button[aria-label="Restore two panes"]`);
  await page.waitForFunction((s,n)=>document.querySelector(s).__balloons.scene().frames>n+5,{},SEL.card,stopped);

  // Quad, then the pane switched away and back 10 times: WebGL is still there.
  await page.setViewport({width:1600,height:900});
  await page.goto(`${base}/chat/quad`);await put(3,'app:balloons');
  await card('Quad','card-quad.png');
  // Each time the card closes, its graphics context must be handed back (browsers allow about 16 at once):
  // the old canvas is told its context is gone, and is taken out of the page.
  await page.evaluate(()=>{window.__released=0;});
  for(let i=0;i<10;i++){
   await page.$eval(`${SEL.card} canvas[data-balloons-canvas]`,c=>c.addEventListener('webglcontextlost',()=>{window.__released++;}));
   await put(3,'');await page.waitForSelector(SEL.card,{hidden:true});await put(3,'app:balloons');await drawn(page,SEL.card);
  }
  await page.waitForFunction(()=>window.__released===10,{timeout:10000}).catch(async()=>assert.fail(`every closed card gave its context back (${await page.evaluate(()=>window.__released)} of 10)`));
  await picture(page,SEL.card,'Quad after 10 switches');
  assert.equal((await scene(page,SEL.card)).contextLost,false);
  assert.equal(await page.$$eval('canvas[data-balloons-canvas]',c=>c.length),1,'the old canvases are gone');

  // Six.
  await page.setViewport({width:1920,height:1080});
  await page.goto(`${base}/chat/six`);
  // Six starts from the Quad cards, so Balloons is already on a card; remove it and choose it again with the picker.
  await page.waitForSelector(SEL.card,{timeout:60000});
  const slot=await page.$eval(SEL.card,e=>e.closest('section[data-card]').dataset.card);
  const six=`section[data-card="${slot}"]`; // (the Six view's own cards)
  await page.waitForFunction(s=>{const b=document.querySelector(s);return b&&Object.keys(b).some(k=>k.startsWith('__reactProps$'));},{timeout:60000},`${six} button[aria-label="Remove card ${slot}"]`);
  await page.click(`${six} button[aria-label="Remove card ${slot}"]`);await page.waitForSelector(SEL.card,{hidden:true});
  await page.click(`${six} button[aria-label="Choose card ${slot}"]`);await page.waitForSelector(`${six} [data-card-picker]`);
  await page.click(`${six} [data-card-picker] input[value="app"]`);await page.select(`${six} [data-card-picker] select`,'balloons');
  await page.click(`${six} [data-card-picker] button[type=submit]`);await page.waitForSelector(`${six} [data-card-picker]`,{hidden:true});
  await card('Six','card-six.png');
  // A small card (Six on a small laptop): fewer labels, still a picture, and no scrubber when there's no room.
  await page.setViewport({width:1024,height:640});await sleep(800);
  // Two columns now, and the balloons card is below the fold: off screen it draws nothing.
  {const off=await page.$eval(SEL.card,e=>e.getBoundingClientRect().top>innerHeight);
   if(off){await sleep(500);const idle=(await scene(page,SEL.card)).frames;await sleep(1200);assert.equal((await scene(page,SEL.card)).frames,idle,'a card scrolled off screen draws nothing');}}
  await page.$eval(SEL.card,e=>e.scrollIntoView({block:'center'}));
  await page.waitForFunction((s,n)=>document.querySelector(s).__balloons.scene().frames>n+8,{},SEL.card,(await scene(page,SEL.card)).frames);
  await picture(page,SEL.card,'a small Six card');
  const small=await page.$eval(SEL.card,e=>({size:e.dataset.size,w:e.clientWidth,h:e.clientHeight,scrubber:!!e.querySelector('[data-balloons-scrubber]')}));
  assert.equal(small.scrubber,small.size!=='small',`the scrubber follows the room (${JSON.stringify(small)})`);
  assert((await scene(page,SEL.card)).labelsShown<=Math.round(Math.max(5,small.w*small.h/22000)),'a smaller card shows fewer tickers');

  // Ten moves between the three views: every one draws, none loses WebGL.
  await page.setViewport({width:1600,height:900});
  for(let i=0;i<10;i++){
   await page.goto(`${base}/chat/${['dual','quad','six'][i%3]}`);
   await drawn(page,SEL.card);
   assert.equal((await scene(page,SEL.card)).contextLost,false,`view switch ${i+1}`);
  }
  await picture(page,SEL.card,'after 10 view switches');
  assert.equal(await page.evaluate(()=>window.__geoAsks),0,'still no location asked for');
  await page.close();
 }
 // A card whose browser already has permission uses local weather without a prompt.
 {
  const page=await open({viewport:{width:1600,height:900},permission:'granted',path:'/chat/dual'});
  await page.evaluate(()=>localStorage.setItem('rb-balloons-weather-v1','{"local":true,"unit":"F"}'));
  await choose(page,2,'app:balloons');
  await drawn(page,SEL.card);
  await page.waitForFunction(s=>document.querySelector(s)?.textContent==='50°F',{},`${SEL.card} [data-balloons-weather]`);
  assert.deepEqual(page.weatherAsks.at(-1).body,{lat:41.9,lon:-87.6},'the remembered choice, rounded');
  assert.match(await clockIn(page,SEL.card,'CT'),/^8:\d\d AM CT$/,'the card\'s clock is in the viewer\'s own time');
  await page.close();
 }

 // A card uses the place typed earlier in the full app, with no prompt and no link.
 {
  const page=await open({viewport:{width:1600,height:900},permission:'prompt',path:'/chat/dual'});
  await page.evaluate(()=>localStorage.setItem('rb-balloons-weather-v1','{"local":false,"unit":"F","place":{"id":"tx:austin","name":"Austin"}}'));
  await choose(page,2,'app:balloons');
  await drawn(page,SEL.card);
  await page.waitForFunction(s=>document.querySelector(s)?.textContent==='86°F',{},`${SEL.card} [data-balloons-weather]`);
  assert(page.weatherAsks.length>=1&&page.weatherAsks.every(a=>a.search===''&&JSON.stringify(a.body)==='{"place":"tx:austin"}'),'the card asks for the remembered place, in the body');
  assert.equal(await page.evaluate(()=>window.__geoAsks),0,'and never for the location');
  assert.equal(await page.$(`${SEL.card} [data-balloons-weather-change]`),null,'no "Change weather" in a card');
  assert.equal(page.placeAsks.length,0,'a card never searches');
  // The card's clock follows the remembered place too (#532), and fits in the card.
  assert.match(await clockIn(page,SEL.card,'CT'),/^8:\d\d AM CT$/,'the card shows the place\'s time');
  assert.equal(await mode(page,SEL.card),'live');
  assert.deepEqual(await within(page,[`${SEL.card} [data-balloons-clock]`,`${SEL.card} [data-balloons-weather]`,`${SEL.card} [data-balloons-open]`]),[],'the card\'s top row fits');
  assert.doesNotMatch(await allWords(page,SEL.card),/America\/|Chicago/);
  await shot(page,'card-city-clock.png');
  // Remembered with its zone: the next time, the clock is right before any weather is read.
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rb-balloons-weather-v1')).place.zone),'America/Chicago');
  await page.close();
 }

 // ---------- No WebGL: a plain list.
 {
  const page=await open({viewport:{width:1280,height:800},webgl:false,path:'/chat?page=balloons',composer:false});
  await page.waitForSelector(`${SEL.app}[data-webgl="off"] [data-balloons-row]`,{timeout:60000});
  const rows=await page.$$eval(`${SEL.app} [data-balloons-row]`,trs=>trs.map(tr=>[...tr.children].map(c=>c.textContent)));
  assert.equal(rows.length,Object.keys(STOCKS).length,'every stock is listed');
  assert.equal(rows[0][0],'ISRL','biggest volume first');
  for(const row of rows.filter(r=>r[0]!=='DOWN')){assert.match(row[1],/^[+-]?\d+\.\d%$/,row.join(' '));assert.match(row[2],/^\d+(\.\d+)?[KM]?$/,row.join(' '));}
  assert.deepEqual(rows.find(r=>r[0]==='DOWN'),['DOWN','—','—'],'a stock whose bars couldn\'t be read shows dashes');
  assert.equal(await page.$(`${SEL.app} canvas[data-balloons-canvas]`),null,'no canvas');
  assert.match(await clock(page,SEL.app),/^9:\d\d AM ET$/);
  await shot(page,'fallback.png');
  await page.goto(`${base}/chat/dual`);
  await choose(page,2,'app:balloons');
  await page.waitForSelector(`${SEL.card}[data-webgl="off"] [data-balloons-row]`,{timeout:60000});
  assert.equal(await page.$(`${SEL.card} canvas[data-balloons-canvas]`),null,'a card without WebGL is a list, not a blank card');
  await page.close();
 }

 // ---------- Phones.
 {
  const page=await open({viewport:{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2},path:'/chat?page=balloons',composer:false});
  const controls=[`${SEL.app} [data-balloons-clock]`,`${SEL.app} [data-balloons-play]`,`${SEL.app} [data-balloons-live]`,`${SEL.app} [data-balloons-scrubber]`,`${SEL.app} [data-balloons-legend-button]`,`${SEL.app} [data-balloons-search-button]`,`${SEL.app} [data-balloons-weather]`,`${SEL.app} [data-balloons-weather-change]`];
  /** "Change weather" at this width: the panel, its field, its matches and "Use my location" all fit. */
  const panelFits=async(what,file)=>{
   await changeWeather(page);
   const found=await typePlace(page,'port');
   assert(found.length>1&&found.length<=6,`${what}: matches (${found})`);
   const off=await within(page,[PANEL,FIELD,`${PANEL} li:last-child [data-balloons-place]`,`${PANEL} [data-balloons-weather-local-button]`]);
   assert.deepEqual(off,[],`${what}: the Change weather panel fits (${off})`);
   assert.equal(await page.$eval(PANEL,(e)=>{const r=e.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+12);return e.contains(top);}),true,`${what}: nothing covers the panel`);
   assert(await noSideScroll(page),`${what}: no sideways scroll with the panel open`);
   if(file)await shot(page,file);
   await page.keyboard.press('Escape');await page.waitForSelector(PANEL,{hidden:true});
  };
  await drawn(page,SEL.app);await picture(page,SEL.app,'phone');
  assert(await noSideScroll(page),'phone: no sideways scroll');
  assert.deepEqual(await within(page,controls),[],'phone: every control is on screen (ET)');
  // The longest clock (#532), "5:0x AM AKT", for every shape below: Anchorage is four hours behind New York.
  page.weatherAnswer={condition:'snow',cloud:1,tempC:-8,night:false,place:'Anchorage',local:true,zone:'America/Anchorage'};
  await changeWeather(page);
  assert.equal((await typePlace(page,'anchorage'))[0],'Anchorage, AK');
  await page.$eval(`${SEL.app} [data-balloons-place="ak:anchorage"]`,b=>b.click());
  assert.match(await clockIn(page,SEL.app,'AKT'),/^5:\d\d AM AKT$/,'phone: Anchorage\'s time');
  assert.deepEqual(await axis(page).then(list=>[list[0],list.at(-1)]),['12:00 AM','4:00 PM']);
  const clockFits=async what=>{
   const row=await page.$eval(`${SEL.app} [data-balloons-clock]`,e=>{const r=e.getBoundingClientRect(),box=e.closest('header > div').getBoundingClientRect();return {text:e.textContent,inside:r.left>=box.left-1&&r.right<=box.right+1,lines:Math.round(r.height/parseFloat(getComputedStyle(e).lineHeight))};});
   assert.match(row.text,/ AKT$/,what);assert(row.inside&&row.lines===1,`${what}: the clock stays inside its box, on one line (${JSON.stringify(row)})`);
  };
  await clockFits('phone');
  assert.deepEqual(await within(page,controls),[],'phone: every control is on screen');
  await tap(page,SEL.app,'UNKF',true);
  assert.deepEqual(await within(page,[`${SEL.app} [data-balloons-detail]`]),[]);
  await shot(page,'app-phone.png');
  await page.$eval(`${SEL.app} [data-balloons-detail] button`,b=>b.click());
  await page.$eval(`${SEL.app} [data-balloons-legend-button]`,b=>b.click());
  assert.deepEqual(await within(page,[`${SEL.app} [data-balloons-legend]`]),[],'phone: the legend fits');
  await page.$eval(`${SEL.app} [data-balloons-legend] button`,b=>b.click());
  await panelFits('phone','app-change-weather-phone.png');
  // On its side.
  await page.setViewport({width:844,height:390,isMobile:true,hasTouch:true,deviceScaleFactor:2});await sleep(900);
  await drawn(page,SEL.app);await picture(page,SEL.app,'phone on its side');
  assert(await noSideScroll(page));assert.deepEqual(await within(page,controls),[],'phone on its side: every control is on screen');
  await clockFits('phone on its side');
  await panelFits('phone on its side');
  // An unfolded folding phone.
  await page.setViewport({width:768,height:884,isMobile:true,hasTouch:true,deviceScaleFactor:2});await sleep(900);
  await drawn(page,SEL.app);await picture(page,SEL.app,'unfolded');
  assert(await noSideScroll(page));assert.deepEqual(await within(page,controls),[],'unfolded: every control is on screen');
  await clockFits('unfolded');
  await panelFits('unfolded');
  await shot(page,'app-unfolded.png');
  await page.close();
 }

 // ---------- No gainers yet.
 {
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date());
  const page=await open({viewport:{width:1280,height:800},path:'/chat?page=balloons',composer:false,feed:()=>({day,today:day,now:Date.now(),barMinutes:2,since:null,stocks:[]})});
  await page.waitForSelector(`${SEL.app} [data-balloons-empty]`,{timeout:60000});
  assert.match(await page.$eval(`${SEL.app} [data-balloons-empty]`,e=>e.textContent),/No gainers yet today/);
  await page.close();
 }
 assert.deepEqual(errors,[],'no page errors');
 console.log('Gainer Balloons browser checks passed: app from Apps, picture drawn, Live and replay, keys, details, search, legend, weather (default, Change weather by typing a place, remembered, local, declined, unavailable, conditions), the clock in the chosen place\'s time (CT, MT, AKT, back to ET, after a reload, in a card), matches by population, cards in Dual/Quad/Six, 10 pane and 10 view switches with WebGL intact, hidden card idle, list without WebGL, phone upright/sideways/unfolded, empty day.');
}finally{await browser.close();}
