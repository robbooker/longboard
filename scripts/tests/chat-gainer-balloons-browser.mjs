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
//    switches to °C and it is remembered; "Use my local weather" asks only on that tap and sends the
//    place rounded to one decimal, in the body, never in the address; declined and unavailable both
//    fall back to New York with a line saying so; rain, snow, overcast and a clear night all draw;
//  - a card in Dual, Quad and Six draws, shows an in-card detail and an Open link, never offers or
//    triggers a location prompt, stops drawing while hidden, ignores keys typed in another pane, and
//    still has WebGL after its pane is switched away and back 10 times and after 10 moves between
//    Dual, Quad and Six;
//  - without WebGL: a plain list (ticker, change, volume), no blank card;
//  - a phone upright (390x844), on its side (844x390) and an unfolded folding phone (768x884): no
//    sideways scroll, every control on screen, a tap selects;
//  - no gainers: a line saying so; no page errors anywhere.
// CHAT_SHOT_DIR saves app-desktop.png, app-selected.png, app-legend.png, app-phone.png,
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
const shot=async(page,name)=>{if(shots){await sleep(700);await page.screenshot({path:`${shots}/${name}`});}};

// --- Today's gainers (all with 150K+ shares so the Gainers Table lists them) and their company facts.
const STOCKS={CHNA:['China',600_000],HKGO:['Hong Kong',2_000_000],CHHK:['China Hong Kong',900_000],SGPR:['Singapore',1_500_000],MLYS:['Malaysia',2_400_000],ISRL:['Israel',null],
 USAA:['U.S.',5_000_000],USBB:['U.S.',40_000_000],USCC:['U.S.',880_000],UNKF:['U.S.',null],NOPC:['U.S.',3_000_000],FADE:['Hong Kong',700_000],DOWN:['U.S.',1_000_000]};
let n=1;
for(const sym of Object.keys(STOCKS))await sql(`select public.ingest_chat_gainers_alert('-100',$1,$2::timestamptz,$3)`,[n++,new Date(Date.now()-n*60_000).toISOString(),`🚨 ${sym} (+45.0%)\nPrice: $2.50\nVolume: 400,000\nMarket Cap: 12.5M`]);
for(const [ticker,[country,floatShares]] of Object.entries(STOCKS)){
 const r=await fetch(`${base}/api/chat/gainers/facts`,{method:'POST',headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify({ticker,notFound:false,country,cashUsd:null,cashMonthsLeft:null,cashFlowPositive:false,instOwnPct:null,...(floatShares?{floatShares}:{})})});
 assert.equal(r.status,200,await r.text());
}
// Signed out: refused.
assert.equal((await fetch(`${base}/api/chat/balloons`)).status,401,'signed out: no balloons');
assert.equal((await fetch(`${base}/api/chat/balloons/weather`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401,'signed out: no weather');

const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const errors=[];
const WEATHER={newYork:{condition:'partly',cloud:0.4,tempC:20,night:false,place:'New York',local:false},chicago:{condition:'cloudy',cloud:0.9,tempC:10,night:false,place:'Chicago',local:true}};
/**
 * A signed-in page. `geo`: what the browser's location does when asked (granted, denied, unavailable)
 * and whether it would answer without a prompt (`permission`). Every ask is counted in the page.
 * The weather route is answered here; each request's address and body are kept in `page.weatherAsks`.
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
 page.weatherAsks=[];page.weatherAnswer=null;
 await page.setRequestInterception(true);
 page.on('request',request=>{
  const url=new URL(request.url());
  if(url.pathname==='/api/chat/balloons/weather'){
   const body=JSON.parse(request.postData()||'{}');page.weatherAsks.push({search:url.search,body,method:request.method()});
   const weather=page.weatherAnswer??('lat' in body?WEATHER.chicago:WEATHER.newYork);
   return request.respond({status:200,contentType:'application/json',body:JSON.stringify({weather,covered:true})});
  }
  if(feed&&url.pathname==='/api/chat/balloons')return request.respond({status:200,contentType:'application/json',body:JSON.stringify(feed())});
  request.continue();
 });
 await signIn(page,base,'bob@example.test',{next:path,...(composer===false?{composer:'[data-balloons-scrubber]'}:{})});
 return page;
}
const SEL={app:'[data-balloons="app"]',card:'[data-balloons="card"]'};
const drawn=(page,root)=>page.waitForFunction(s=>{const el=document.querySelector(s);return el?.dataset.webgl==='on'&&(el.__balloons?.scene()?.frames??0)>8;},{timeout:90000},root);
const scene=(page,root)=>page.$eval(root,el=>({...el.__balloons.scene(),mode:el.__balloons.mode(),time:el.__balloons.time()}));
const clock=(page,root)=>page.$eval(`${root} [data-balloons-clock]`,e=>e.textContent);
const mode=(page,root)=>page.$eval(root,e=>e.dataset.mode);
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
/** Taps where a balloon is. Another balloon may be in front of it, so the answer is whichever one the tap selected. */
const tap=async(page,root,ticker,touch=false)=>{
 const at=await page.$eval(root,(el,ticker)=>{const p=el.__balloons.where(ticker),r=el.getBoundingClientRect();return p&&{x:r.left+p.x,y:r.top+p.y};},ticker);
 assert(at,`${ticker} is on screen`);
 if(touch)await page.touchscreen.tap(at.x,at.y);else await page.mouse.click(at.x,at.y);
 await page.waitForSelector(`${root} [data-balloons-detail]`,{timeout:10000});
 const selected=await page.$eval(`${root} [data-balloons-detail]`,e=>e.dataset.balloonsDetail);
 assert(selected in STOCKS,`a tap selects a balloon (${selected})`);
 return selected;
};
const detail=(page,root)=>page.$eval(`${root} [data-balloons-detail]`,e=>({ticker:e.dataset.balloonsDetail,cells:Object.fromEntries([...e.querySelectorAll('dl > div')].map(d=>[d.querySelector('dt').textContent,d.querySelector('dd').textContent]))}));
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
  // "Use my local weather": asked on the tap, rounded before it is sent, in the body.
  await page.click(`${SEL.app} [data-balloons-weather-local-button]`);
  await page.waitForFunction(s=>document.querySelector(s)?.textContent.includes('Chicago'),{},`${SEL.app} [data-balloons-weather]`);
  assert.equal(await page.evaluate(()=>window.__geoAsks),1,'asked once, on the tap');
  assert.deepEqual(page.weatherAsks.at(-1),{search:'',body:{lat:41.9,lon:-87.6},method:'POST'},'the place is rounded to one decimal and sent in the body');
  assert.equal(await page.$eval(`${SEL.app} [data-balloons-weather]`,e=>e.textContent),'50°FChicago');
  assert.equal(await page.evaluate(()=>localStorage.getItem('rb-balloons-weather-v1')),'{"local":true,"unit":"F"}','only the choice is stored, never the place');
  await page.click(`${SEL.app} [data-balloons-weather-off]`);
  await page.waitForFunction(s=>document.querySelector(s)?.textContent.includes('New York'),{},`${SEL.app} [data-balloons-weather]`);
  assert.deepEqual(page.weatherAsks.at(-1).body,{},'turned off: New York again');

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
  assert.deepEqual(Object.keys(d.cells),['Price','Change','Volume','Float','Volume ÷ float','Prev close']);
  assert.match(d.cells.Price,/^\$\d+\.\d\d$/);assert.match(d.cells.Change,/^\+\d+\.\d%$/);assert.match(d.cells.Volume,/^\d+(\.\d+)?[KM]$/);
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
  assert.equal(d.cells.Float,'600.0K');assert.match(d.cells['Volume ÷ float'],/^\d+(\.\d+)?×$/);assert.equal(d.cells['Prev close'],'$1.00');
  await sleep(1200);
  const after=(await scene(page,SEL.app)).target;
  assert(Math.hypot(after[0]-before[0],after[2]-before[2])>3,`the camera moved to it (${before} -> ${after})`);
  const where=await page.$eval(SEL.app,el=>{const p=el.__balloons.where('CHNA');return [p.x/el.clientWidth,p.y/el.clientHeight];});
  assert(Math.abs(where[0]-0.5)<0.12&&Math.abs(where[1]-0.5)<0.2,`CHNA is in the middle of the view (${where})`);
  await shot(page,'app-selected.png');
  assert.equal((await find('NOPC')).cells['Prev close'],'—','no previous close: a dash');
  await page.keyboard.press('Escape');
  await page.click(`${SEL.app} [data-balloons-reset]`);
  // The legend.
  await page.click(`${SEL.app} [data-balloons-legend-button]`);
  const legend=await page.$eval(`${SEL.app} [data-balloons-legend]`,e=>e.textContent);
  for(const word of ['Size','Stretch','Height','Movement','Matte','float not known','China / Hong Kong','follows New York','not advice'])assert(legend.includes(word),`the legend says "${word}"`);
  await shot(page,'app-legend.png');
  await page.keyboard.press('Escape');await page.waitForSelector(`${SEL.app} [data-balloons-legend]`,{hidden:true});
  // Never where data came from, and no trading words.
  const words=await page.$eval(SEL.app,e=>e.innerText+' '+[...e.querySelectorAll('[title],[aria-label]')].map(x=>`${x.title} ${x.getAttribute('aria-label')??''}`).join(' '));
  assert.doesNotMatch(words,/source|polygon|dilution|weather\.gov|from the gainers|\bbuy|\bsell|pump/i);

  // Weather the sky draws: each answer comes back from the faked route on the next read.
  const sky=async(answer,name,progress)=>{
   page.weatherAnswer=answer;
   await page.click(`${SEL.app} [data-balloons-weather-local-button]`);
   await page.waitForFunction((s,c)=>document.querySelector(s)?.dataset.balloonsWeather===c,{},`${SEL.app} [data-balloons-weather]`,answer.condition);
   if(progress!==undefined)await scrub(page,SEL.app,progress);
   await sleep(2600);await picture(page,SEL.app,name);
   assert.equal(await page.$eval(`${SEL.app} [data-weather-icon]`,e=>e.dataset.weatherIcon),answer.condition+(answer.night?'-night':''));
   await shot(page,`${name}.png`);
   await page.click(`${SEL.app} [data-balloons-weather-off]`);
  };
  await sky({condition:'rain',cloud:1,tempC:12,night:false,place:'Seattle',local:true},'weather-rain');
  await sky({condition:'snow',cloud:1,tempC:-3,night:false,place:'Denver',local:true},'weather-snow');
  await sky({condition:'cloudy',cloud:1,tempC:9,night:false,place:'Cleveland',local:true},'weather-overcast');
  await sky({condition:'clear',cloud:0,tempC:4,night:true,place:'Anchorage',local:true},'weather-clear-night',4);
  // A reading with no temperature: a dash, never a made-up number.
  page.weatherAnswer={condition:'fog',cloud:0.8,tempC:null,night:false,place:null,local:true};
  await page.click(`${SEL.app} [data-balloons-weather-local-button]`);
  await page.waitForFunction(s=>document.querySelector(s)?.dataset.balloonsWeather==='fog',{},`${SEL.app} [data-balloons-weather]`);
  assert.equal(await page.$eval(`${SEL.app} [data-balloons-weather]`,e=>e.textContent),'—Your weather');
  // The weather route failing changes nothing on screen.
  assert.equal((await scene(page,SEL.app)).contextLost,false);
  await page.close();
 }
 // ---------- Location declined, and not available: New York, with a line saying so.
 for(const [geo,line] of [['denied',/Location is turned off for this site/],['unavailable',/isn’t available right now/],['missing',/isn’t available right now/]]){
  const page=await open({viewport:{width:1280,height:800},geo,path:'/chat?page=balloons',composer:false});
  await drawn(page,SEL.app);
  await page.waitForSelector(`${SEL.app} [data-balloons-weather]`);
  await page.click(`${SEL.app} [data-balloons-weather-local-button]`);
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
   assert.equal(await page.$(`${SEL.card} [data-balloons-legend-button]`),null,`${name}: small chrome only`);
   const s=await scene(page,SEL.card);
   const room=await page.$eval(SEL.card,e=>Math.round(Math.min(60,Math.max(5,e.clientWidth*e.clientHeight/22000))));
   assert(s.labelsShown>=3&&s.labelsShown<=room,`${name}: ticker labels for the biggest stories only, as many as the card has room for (${s.labelsShown} of at most ${room})`);
   assert(s.pixelRatio<=1.5,`${name}: the pixel ratio is capped (${s.pixelRatio})`);
   await tap(page,SEL.card,'UNKF');
   assert.equal(Object.keys((await detail(page,SEL.card)).cells).length,6,`${name}: details in the card`);
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
  const controls=[`${SEL.app} [data-balloons-clock]`,`${SEL.app} [data-balloons-play]`,`${SEL.app} [data-balloons-live]`,`${SEL.app} [data-balloons-scrubber]`,`${SEL.app} [data-balloons-legend-button]`,`${SEL.app} [data-balloons-search-button]`,`${SEL.app} [data-balloons-weather]`];
  await drawn(page,SEL.app);await picture(page,SEL.app,'phone');
  assert(await noSideScroll(page),'phone: no sideways scroll');
  assert.deepEqual(await within(page,controls),[],'phone: every control is on screen');
  await tap(page,SEL.app,'UNKF',true);
  assert.deepEqual(await within(page,[`${SEL.app} [data-balloons-detail]`]),[]);
  await shot(page,'app-phone.png');
  await page.$eval(`${SEL.app} [data-balloons-detail] button`,b=>b.click());
  await page.$eval(`${SEL.app} [data-balloons-legend-button]`,b=>b.click());
  assert.deepEqual(await within(page,[`${SEL.app} [data-balloons-legend]`]),[],'phone: the legend fits');
  await page.$eval(`${SEL.app} [data-balloons-legend] button`,b=>b.click());
  // On its side.
  await page.setViewport({width:844,height:390,isMobile:true,hasTouch:true,deviceScaleFactor:2});await sleep(900);
  await drawn(page,SEL.app);await picture(page,SEL.app,'phone on its side');
  assert(await noSideScroll(page));assert.deepEqual(await within(page,controls),[],'phone on its side: every control is on screen');
  // An unfolded folding phone.
  await page.setViewport({width:768,height:884,isMobile:true,hasTouch:true,deviceScaleFactor:2});await sleep(900);
  await drawn(page,SEL.app);await picture(page,SEL.app,'unfolded');
  assert(await noSideScroll(page));assert.deepEqual(await within(page,controls),[],'unfolded: every control is on screen');
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
 console.log('Gainer Balloons browser checks passed: app from Apps, picture drawn, Live and replay, keys, details, search, legend, weather (default, local, declined, unavailable, conditions), cards in Dual/Quad/Six, 10 pane and 10 view switches with WebGL intact, hidden card idle, list without WebGL, phone upright/sideways/unfolded, empty day.');
}finally{await browser.close();}
