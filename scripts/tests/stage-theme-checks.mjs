// #510: stage mode follows the member's theme. Shared by the stage browser tests: the list of every
// look the chat offers (read from lib/chatTheme.ts, not copied), a way to change the look the way
// another tab of the same browser does (so nothing is reloaded: the change must show at once), and
// what the page then draws: colours as the browser computed them, and their contrast.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../lib/chatTheme.ts',import.meta.url),'utf8');
const THEMES=[...source.match(/CHAT_THEME_VALUES: ChatTheme\[\] = \[([^\]]+)\]/)[1].matchAll(/"([a-z-]+)"/g)].map(m=>m[1]);
const PALETTES=[...source.matchAll(/\{ id: "([a-z-]+)", label: "[^"]+", base: "(dark|light)" \}/g)].map(m=>({theme:m[2],palette:m[1]}));
/** Every look: the five themes, then each colour combination on its base theme. */
export const LOOKS=[...THEMES.map(theme=>({id:theme,theme,palette:null})),...PALETTES.map(p=>({id:p.palette,...p}))];
assert.equal(THEMES.length,5,`the themes in lib/chatTheme.ts: ${THEMES}`);assert.equal(LOOKS.length,17,`every look: ${LOOKS.map(l=>l.id)}`);
export const LIGHT_LOOKS=new Set(['light','paper-terminal',...PALETTES.filter(p=>p.theme==='light').map(p=>p.palette)]);
const THEME_KEY='longboard-public-chat-theme-v1',PALETTE_KEY='longboard-chat-palette-v1';

/** Changes the look as a second tab would: storage, then the browser's storage event. No reload. */
export async function setLook(page,look,timeout=5000){
 await page.evaluate((look,themeKey,paletteKey)=>{
  const old=localStorage.getItem(themeKey);localStorage.setItem(themeKey,look.theme);
  if(look.palette)localStorage.setItem(paletteKey,look.palette);else localStorage.removeItem(paletteKey);
  window.dispatchEvent(new StorageEvent('storage',{key:themeKey,oldValue:old,newValue:look.theme,storageArea:localStorage}));
 },look,THEME_KEY,PALETTE_KEY);
 // Every themed surface on the page (the room, or each pane and card of a Quad or Six view) follows.
 await page.waitForFunction(look=>{const all=[...document.querySelectorAll('body [data-theme]')].filter(e=>!e.closest('[data-look]'));return all.length>0&&all.every(e=>e.dataset.theme===look.theme&&(e.dataset.palette??null)===look.palette);},{timeout},look);
 // Buttons ease from one colour to the next (120ms): measure once that is over, two frames on.
 await page.evaluate(async()=>{await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
  await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));
  await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));});
}

// The functions below run inside the page. `tools` is evaluated there first.
const tools=()=>{
 const parse=text=>{
  let m=/^rgba?\(([^)]+)\)$/.exec(text);
  if(m){const p=m[1].split(/[,\s/]+/).filter(Boolean).map(Number);return [p[0],p[1],p[2],p[3]??1];}
  m=/^color\(srgb ([^)]+)\)$/.exec(text);
  if(m){const p=m[1].split(/[\s/]+/).filter(Boolean).map(Number);return [p[0]*255,p[1]*255,p[2]*255,p[3]??1];}
  throw new Error(`a colour this test cannot read: ${text}`);};
 const over=(top,under)=>[0,1,2].map(i=>top[i]*top[3]+under[i]*(1-top[3])).concat(1);
 const lum=c=>{const [r,g,b]=c.slice(0,3).map(v=>{const s=v/255;return s<=0.03928?s/12.92:((s+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;};
 const contrast=(a,b)=>{const [hi,lo]=[lum(a),lum(b)].sort((x,y)=>y-x);return (hi+0.05)/(lo+0.05);};
 // What is behind an element: its own and its ancestors' background colours, composited. Where
 // nothing opaque is found (a see-through panel over the video) the worst case is used: white.
 const ground=(el,worst=[255,255,255,1])=>{const layers=[];
  for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor);if(c[3]>0)layers.push(c);if(c[3]===1)break;}
  let under=layers.length&&layers.at(-1)[3]===1?layers.pop():worst;
  for(const layer of layers.reverse())under=over(layer,under);
  return under;};
 const opacity=el=>{let o=1;for(let e=el;e;e=e.parentElement)o*=Number(getComputedStyle(e).opacity);return o;};
 /** The theme token as the browser resolves it on the page element. */
 const token=(name,scope='main[data-chat-view]')=>{const probe=document.createElement('i');probe.style.cssText=`position:absolute;width:0;height:0;background-color:var(${name})`;document.querySelector(scope).append(probe);const c=parse(getComputedStyle(probe).backgroundColor);probe.remove();return c;};
 const rgb=c=>`rgb(${c.slice(0,3).map(v=>Math.round(v)).join(', ')})`;
 const bg=sel=>{const e=document.querySelector(sel);return e?rgb(ground(e)):null;};
 const fg=sel=>{const e=document.querySelector(sel);return e?rgb(parse(getComputedStyle(e).color)):null;};
 /** Every piece of text on screen inside `root`, with its contrast against what is behind it. */
 const sweep=(root,worst)=>{const out=[];
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   const text=node.textContent.trim(),el=node.parentElement;if(!text||!el)continue;
   if(!el.checkVisibility({visibilityProperty:true,opacityProperty:true}))continue;
   const box=el.getBoundingClientRect();if(box.width<=2||box.height<=2)continue;
   const style=getComputedStyle(el),under=ground(el,worst),o=opacity(el),ink=parse(style.color);
   const drawn=over([ink[0],ink[1],ink[2],ink[3]*o],under),size=parseFloat(style.fontSize),bold=Number(style.fontWeight)>=700;
   out.push({text:text.slice(0,40),where:(el.className||el.tagName).toString().replace(/StageMode_|StagePhone_|StageHands_|PublicChat_/g,'').slice(0,40),ratio:Math.round(contrast(drawn,under)*100)/100,need:size>=24||(bold&&size>=18.66)?3:4.5,off:!!el.closest(':disabled')});}
  return out;};
 return {parse,over,lum,contrast,ground,opacity,token,rgb,bg,fg,sweep};
};
const inPage=(page,fn,...args)=>page.evaluate(`(${fn})((${tools})(),...${JSON.stringify(args)})`);

/** The chat's theme tokens as the page resolves them now. */
export const chatTokens=(page,scope='main[data-chat-view]')=>inPage(page,(t,scope)=>Object.fromEntries(['--chat-bg','--chat-panel','--chat-panel-raised','--chat-line','--chat-text','--chat-muted','--chat-palm','--chat-palm-fill','--chat-on-fill'].map(n=>[n,t.rgb(t.token(n,scope))])),scope);
/** The look the page shows now. */
export const lookNow=page=>page.$eval('body [data-theme]:not([data-look] *)',e=>({theme:e.dataset.theme,palette:e.dataset.palette??null}));
/** Background (composited) and text colour of the first element matching each selector; null when there is none. */
export const colours=(page,selectors)=>inPage(page,(t,selectors)=>Object.fromEntries(Object.entries(selectors).map(([k,s])=>[k,{bg:t.bg(s),fg:t.fg(s)}])),selectors);
/** Text under `selector` that is harder to read than WCAG AA asks (4.5:1; 3:1 for large text). */
export const hardToRead=(page,selector,{skip=null}={})=>inPage(page,(t,selector,skip)=>[...document.querySelectorAll(selector)].flatMap(root=>t.sweep(root)).filter(x=>!(skip&&new RegExp(skip).test(x.where))&&x.ratio<x.need),selector,skip);
export const readable=(page,selector)=>inPage(page,(t,selector)=>[...document.querySelectorAll(selector)].flatMap(root=>t.sweep(root)).length,selector);
/** Contrast of one element's text (or, with `part`, of its ::placeholder) against what is behind it. */
export const contrastOf=(page,selector,part=null)=>inPage(page,(t,selector,part)=>{const e=[...document.querySelectorAll(selector)].find(x=>x.checkVisibility());if(!e)return null;
 const under=t.ground(e),ink=t.parse(getComputedStyle(e,part??undefined).color),o=t.opacity(e)*(part?Number(getComputedStyle(e,part).opacity):1);
 return Math.round(t.contrast(t.over([ink[0],ink[1],ink[2],ink[3]*o],under),under)*100)/100;},selector,part);
/** Each button's own colour (what its icon is drawn in) against what is behind it, as drawn (a switched-off one is faded). */
export const iconContrast=(page,selector)=>inPage(page,(t,selector)=>[...document.querySelectorAll(selector)].filter(e=>e.checkVisibility()).map(e=>{const under=t.ground(e),ink=t.parse(getComputedStyle(e).color);
 return {name:e.getAttribute('aria-label')||e.textContent.trim(),pressed:e.getAttribute('aria-pressed'),ratio:Math.round(t.contrast(t.over([ink[0],ink[1],ink[2],ink[3]*t.opacity(e)],under),under)*100)/100};}),selector);
/** Luminance (0 black to 1 white) of what is drawn behind an element. */
export const luminanceOf=(page,selector)=>inPage(page,(t,selector)=>{const e=document.querySelector(selector);return e?t.lum(t.ground(e,[0,0,0,1])):null;},selector);
/** The focus ring of an element focused from the keyboard: its width, and its contrast against what is behind it. */
export async function focusRing(page,selector){
 await page.keyboard.press('Shift');
 return inPage(page,(t,selector)=>{const e=[...document.querySelectorAll(selector)].find(x=>x.checkVisibility()&&!x.disabled);if(!e)return null;
  const before=document.activeElement;e.focus({preventScroll:true,focusVisible:true});const s=getComputedStyle(e),under=t.ground(e.parentElement);
  const out={visible:e.matches(':focus-visible'),style:s.outlineStyle,width:parseFloat(s.outlineWidth),ratio:Math.round(t.contrast(t.parse(s.outlineColor),under)*100)/100};
  e.blur();if(before instanceof HTMLElement&&before!==document.body)before.focus({preventScroll:true});return out;},selector);
}
// Not the stage's and not a theme colour: the room's own "Watch live" button in its "live now"
// message is white on a fixed red (#e5484d, 3.9:1) in every room and every theme, as before #510.
const ROOM_OWN={skip:'stageWatch'};
const red=text=>{const [r,g,b]=text.match(/[\d.]+/g).map(Number);return r>200&&r-Math.max(g,b)>100;};

/**
 * The computer stage in every look. For each: the stage's surfaces are the look's own theme
 * colours, all of the stage's own text is readable, the room chat column is too, the player and
 * what frames it stay dark, LIVE stays red with its word, and the focus ring shows.
 * `each(look)` runs after a look is checked (for screenshots). Returns what was seen, by look.
 */
export async function checkStageLooks(page,{looks=LOOKS,each=null,live=true,ring=true}={}){
 const seen={},before=await lookNow(page);
 for(const look of looks){
  await setLook(page,look);
  const tokens=await chatTokens(page);
  const c=await colours(page,{column:'[data-stage-column="stage"]',bar:'[data-stage-root] > header',heading:'[data-stage-root] > header h1',trades:'[data-stage-column="trades"]',chat:'[data-stage-root] ~ section',
   stock:'[data-stage-stock]',player:'[data-stage-video]',playerBar:'[data-stage-video] > div:first-child',area:'[data-stage-video-area]',controls:'[data-stage-video] > div:last-child',message:'[data-stage-root] ~ section article[id^="chat-message-"] [class*="_body__"]'});
  const where=`${look.id}: `;
  assert.equal(c.column.bg,tokens['--chat-bg'],where+'the stage column is the theme\'s background');
  assert.equal(c.bar.bg,tokens['--chat-panel-raised'],where+'the top bar is the theme\'s raised panel');
  assert.equal(c.heading.fg,tokens['--chat-text'],where+'the room name is the theme\'s text colour');
  if(c.trades.bg)assert.equal(c.trades.bg,tokens['--chat-panel'],where+'the middle column is the theme\'s panel');
  assert.equal(c.chat.bg,tokens['--chat-panel'],where+'the room chat column is the theme\'s panel');
  if(c.stock.bg)assert.equal(c.stock.bg,tokens['--chat-panel-raised'],where+'the stock panel is the theme\'s raised panel');
  if(c.message.fg)assert.equal(c.message.fg,tokens['--chat-text'],where+'a chat message is the theme\'s text colour');
  // The video's surround: the same dark colours whatever the look.
  assert.deepEqual([c.player.bg,c.playerBar.bg,c.controls.bg],['rgb(0, 0, 0)','rgb(27, 36, 48)','rgb(27, 36, 48)'],where+'the player, its title bar and its control bar stay dark');
  for(const part of ['[data-stage-video]','[data-stage-video-area]','[data-stage-video-placeholder], [data-stage-video-message], [data-stage-video-feed]']){const l=await luminanceOf(page,part);assert(l!==null&&l<0.05,where+`${part} stays dark (luminance ${l})`);}
  assert.equal(await page.$eval('[data-stage-video]',e=>getComputedStyle(e).borderTopColor),'rgb(255, 107, 94)',where+'the player keeps its red frame');
  // Its buttons (Mute is a pressed button while the sound is off): light icons on the dark bar.
  {const icons=await iconContrast(page,'[data-stage-video] button');assert(icons.length>=4,where+'the player has its buttons');
   for(const icon of icons)assert(icon.ratio>=3,where+`the player's ${icon.name} icon is ${icon.ratio}:1`);}
  // LIVE: red, and it says so.
  for(const sel of live?['[data-stage-root] > header [data-stage-live]','[data-stage-video] > div:first-child > span:first-child']:[]){
   const badge=await page.$eval(sel,e=>({text:e.textContent.trim(),bg:getComputedStyle(e).backgroundColor}));
   assert.match(badge.text,/LIVE/,where+`${sel} says LIVE`);assert(red(badge.bg),where+`${sel} is red: ${badge.bg}`);
   const ratio=await contrastOf(page,sel);assert(ratio>=4.5,where+`LIVE on its red is ${ratio}:1`);}
  // Everything the stage itself writes, and the room chat's messages.
  assert(await readable(page,'[data-stage-root]')>=12,where+'the stage has text to measure');
  const hard=await hardToRead(page,'[data-stage-root]');
  assert.deepEqual(hard,[],where+`stage text under 4.5:1 (3:1 large): ${JSON.stringify(hard)}`);
  const chatHard=await hardToRead(page,'[data-stage-root] ~ section article[id^="chat-message-"] :is([class*="_body__"], [class*="_messageIdentity__"])',ROOM_OWN);
  assert.deepEqual(chatHard,[],where+`room chat text under 4.5:1: ${JSON.stringify(chatHard)}`);
  for(const [what,sel,part] of [['the question box\'s placeholder','[data-stage-column="trades"] input','::placeholder'],['the composer\'s text','[data-stage-root] ~ section textarea',null]]){
   const ratio=await contrastOf(page,sel,part);if(ratio!==null)assert(ratio>=4.5,where+`${what} is ${ratio}:1`);}
  // The focus ring: on the themed top bar and on the dark player.
  for(const sel of ring?['[data-stage-exit]','[data-stage-video] button:not(:disabled)']:[]){const ring=await focusRing(page,sel);if(!ring)continue;
   assert(ring.visible&&ring.style==='solid'&&ring.width>=2&&ring.ratio>=3,where+`the focus ring on ${sel}: ${JSON.stringify(ring)}`);}
  seen[look.id]={page:c.column.bg,text:c.heading.fg,tokens};
  if(each)await each(look);
 }
 different(seen,looks);
 await setLook(page,before);
 return seen;
}
const SCRIM='rgba(7, 9, 13, 0.84)';
/**
 * The phone viewing room with its chat open, in every look. Upright: the chat panel and the strip
 * above it are the look's own colours and readable; the video's background stays black and LIVE
 * red. On its side (`sideways`): the panel is the same dark see-through scrim in every look, and
 * the chat on it is light and readable even over a white picture.
 */
export async function checkPhoneLooks(page,{looks=LOOKS,each=null,sideways=false}={}){
 const seen={},before=await lookNow(page),CHAT='[data-stage-root] ~ section',BAR='[data-stage-phone-chat-bar]';
 for(const look of looks){
  await setLook(page,look);
  const tokens=await chatTokens(page),where=`${look.id}${sideways?' (on its side)':''}: `;
  const c=await colours(page,{chat:CHAT,bar:BAR,name:`${BAR} strong`,close:'[data-stage-phone-chat-close]',message:`${CHAT} article[id^="chat-message-"] [class*="_body__"]`});
  const raw=await page.evaluate((chat,bar)=>({chat:getComputedStyle(document.querySelector(chat)).backgroundColor,bar:getComputedStyle(document.querySelector(bar)).backgroundColor,
   screen:getComputedStyle(document.querySelector('[data-stage-phone-screen]')).backgroundColor,page:getComputedStyle(document.querySelector('main[data-stage]')).backgroundColor}),CHAT,BAR);
  // The video's surround: black behind the picture, whatever the look.
  assert.deepEqual([raw.screen,raw.page],['rgb(0, 0, 0)','rgb(0, 0, 0)'],where+'the screen behind the video stays black');
  // The buttons over the picture (the sound button is a pressed button while the sound is on):
  // a white icon and no block of the theme's colour, in every look.
  {const over=await page.$$eval('[data-stage-phone-top] button, [data-stage-phone-bottom] button',bs=>bs.filter(b=>b.checkVisibility()).map(b=>{const s=getComputedStyle(b);return [b.getAttribute('aria-label'),s.color,s.backgroundColor,s.boxShadow];}));
   if(sideways)assert(over.length>=3,where+`the video's own buttons are showing: ${JSON.stringify(over)}`);
   for(const [name,color,background,shadow] of over)assert.deepEqual([color,background,shadow],['rgb(255, 255, 255)','rgba(0, 0, 0, 0)','none'],where+`${name} over the video is a plain white icon`);}
  if(sideways){
   assert.deepEqual([raw.chat,raw.bar],[SCRIM,SCRIM],where+'over the video the chat and its strip are the same dark scrim in every look');
   assert.equal(c.close.fg,'rgb(255, 255, 255)',where+'the strip\'s buttons are white over the video');
  }else{
   assert.equal(raw.chat,tokens['--chat-panel'],where+'the chat panel is the theme\'s panel');
   assert.equal(raw.bar,tokens['--chat-panel-raised'],where+'the strip above it is the theme\'s raised panel');
   assert.deepEqual([c.name.fg,c.close.fg],[tokens['--chat-text'],tokens['--chat-text']],where+'the room name and the buttons on the strip are the theme\'s text colour');
   assert.equal(c.message.fg,tokens['--chat-text'],where+'a chat message is the theme\'s text colour');
   const badge=await page.$eval(`${BAR} [data-stage-live]`,e=>({text:e.textContent.trim(),bg:getComputedStyle(e).backgroundColor}));
   assert.match(badge.text,/LIVE/,where+'LIVE says so');assert(red(badge.bg),where+`LIVE is red: ${badge.bg}`);
   const ring=await focusRing(page,'[data-stage-phone-chat-close]');
   assert(ring.visible&&ring.style==='solid'&&ring.width>=2&&ring.ratio>=3,where+`the focus ring on the strip: ${JSON.stringify(ring)}`);
  }
  // Text: the strip (measured over white where it is see-through), the messages and the composer.
  const hard=[...await hardToRead(page,BAR),...await hardToRead(page,`${CHAT} article[id^="chat-message-"] :is([class*="_body__"], [class*="_messageIdentity__"])`,ROOM_OWN)];
  assert.deepEqual(hard,[],where+`text under 4.5:1: ${JSON.stringify(hard)}`);
  assert(await readable(page,`${CHAT} article[id^="chat-message-"]`)>=2,where+'there are messages to measure');
  const composer=await contrastOf(page,`${CHAT} textarea`);assert(composer>=4.5,where+`the composer's text is ${composer}:1`);
  const icon=await contrastOf(page,'[data-stage-phone-chat-close]');assert(icon>=3,where+`the close button's icon is ${icon}:1`);
  seen[look.id]={page:raw.chat,text:c.message.fg,tokens};
  if(each)await each(look);
 }
 if(!sideways){
  for(const look of looks){const light=LIGHT_LOOKS.has(look.id);assert.equal(lumOf(seen[look.id].page)>0.5,light,`${look.id}: a ${light?'light':'dark'} chat panel (${seen[look.id].page})`);assert.equal(lumOf(seen[look.id].text)<0.2,light,`${look.id}: ${light?'dark':'light'} chat text`);}
  assert(new Set(looks.map(look=>seen[look.id].page+seen[look.id].tokens['--chat-panel-raised'])).size>=Math.min(looks.length,12),'the looks draw different panels');
 }
 await setLook(page,before);
 return seen;
}
/**
 * #527 Raise hand in the phone viewing room, in every look. `prepare()` runs after each change of
 * look (the test brings faded controls back with it).
 *  - `where: "video"` (the chat and the list closed): the hand button, raised, is the same amber
 *    chip, and the count beside it the same dark pill as Chat, whatever the look;
 *  - `where: "sheet"`, upright with the chat open: the list is a sheet in the look's own panel
 *    colour, its names the look's text, the raised hand on the strip the look's own filled button;
 *  - `where: "sheet"`, on its side: the list is the dark see-through scrim in every look, with
 *    fixed light text that is readable even over a white picture, and the hand button the amber chip.
 */
export async function checkPhoneHandLooks(page,{looks=LOOKS,each=null,prepare=null,where='sheet',sideways=false}={}){
 const seen={},before=await lookNow(page),SHEET='[data-stage-hands-sheet]',AMBER=['rgb(245, 184, 61)','rgb(10, 13, 18)'],PILL=['rgba(11, 14, 19, 0.86)','rgb(255, 255, 255)'];
 for(const look of looks){
  await setLook(page,look);if(prepare)await prepare(look);
  const tokens=await chatTokens(page),at=`${look.id}${sideways?' (on its side)':''}, hands: `;
  const raw=await page.evaluate(sheet=>{const style=selector=>{const e=[...document.querySelectorAll(selector)].find(x=>x.checkVisibility({visibilityProperty:true}));if(!e)return null;const c=getComputedStyle(e);return {bg:c.backgroundColor,fg:c.color,pressed:e.getAttribute('aria-pressed')};};
   return {sheet:style(sheet),name:style(`${sheet} [data-stage-hand-name]`),ago:style(`${sheet} [data-stage-hand-ago]`),close:style(`${sheet} [data-stage-hands-close]`),hand:style('[data-stage-hand]'),count:style('[data-stage-hands-toggle]'),screen:style('[data-stage-phone-screen]')};},SHEET);
  assert.equal(raw.screen.bg,'rgb(0, 0, 0)',at+'the screen behind the video stays black');
  assert.equal(raw.hand?.pressed,'true',at+'the hand is up for this check');
  for(const icon of await iconContrast(page,'[data-stage-hand]'))assert(icon.ratio>=4.5,at+`the hand button is ${icon.ratio}:1`);
  if(where==='video'){
   assert.equal(raw.sheet,null,at+'the list is closed for this check');
   assert.deepEqual([raw.hand.bg,raw.hand.fg],AMBER,at+'a raised hand over the video is the same amber chip in every look');
   assert.deepEqual([raw.count.bg,raw.count.fg],PILL,at+'the count over the video is the same dark pill in every look');
   const hard=await hardToRead(page,'[data-stage-phone-corner]');assert.deepEqual(hard,[],at+`text over the video under 4.5:1, even over a white picture: ${JSON.stringify(hard)}`);
   assert(await readable(page,'[data-stage-phone-corner]')>=3,at+'the hand button, the count and Chat are there to measure');
  }else{
   assert(raw.sheet&&raw.name&&raw.ago,at+'the list is open, with someone on it');
   if(sideways){
    assert.equal(raw.sheet.bg,SCRIM,at+'over the video the list is the same dark scrim as the chat');
    assert.deepEqual([raw.name.fg,raw.close.fg],['rgb(242, 244, 247)','rgb(242, 244, 247)'],at+'its names and buttons are the same light text in every look');
    assert.deepEqual([raw.hand.bg,raw.hand.fg],AMBER,at+'the hand button beside it is the amber chip');
   }else{
    assert.equal(raw.sheet.bg,tokens['--chat-panel'],at+'the list is the theme\'s panel');
    assert.equal(raw.name.fg,tokens['--chat-text'],at+'a name is the theme\'s text colour');
    assert.equal(raw.ago.fg,tokens['--chat-muted'],at+'how long ago is the theme\'s quieter text colour');
    assert.deepEqual([raw.hand.bg,raw.hand.fg],[tokens['--chat-palm-fill'],tokens['--chat-on-fill']],at+'a raised hand on the strip is the theme\'s filled button');
    assert.equal(raw.count.fg,tokens['--chat-text'],at+'the count on the strip is the theme\'s text colour');
   }
   // Everything the list writes (measured over white where it is see-through), and its buttons' ring.
   const hard=await hardToRead(page,SHEET);assert.deepEqual(hard,[],at+`list text under 4.5:1: ${JSON.stringify(hard)}`);
   assert(await readable(page,SHEET)>=6,at+'the list has text to measure');
   const ring=await focusRing(page,`${SHEET} [data-stage-hands-close]`);
   assert(ring.visible&&ring.style==='solid'&&ring.width>=2&&ring.ratio>=3,at+`the focus ring in the list: ${JSON.stringify(ring)}`);
   seen[look.id]={page:raw.sheet.bg,text:raw.name.fg};
  }
  if(each)await each(look);
 }
 if(where==='sheet'&&!sideways)for(const look of looks){const light=LIGHT_LOOKS.has(look.id);assert.equal(lumOf(seen[look.id].page)>0.5,light,`${look.id}: a ${light?'light':'dark'} hands list (${seen[look.id].page})`);assert.equal(lumOf(seen[look.id].text)<0.2,light,`${look.id}: ${light?'dark':'light'} names`);}
 await setLook(page,before);
 return seen;
}
/**
 * A card that is only a room's live video (Dual, Quad, Six), in every look. Not live: the card is
 * the look's own panel and its note is readable. Live: the player covers it, dark in every look.
 */
export async function checkVideoCardLooks(page,card,{looks=LOOKS,live,each=null}){
 const seen={},before=await lookNow(page);
 for(const look of looks){
  await setLook(page,look);
  const tokens=await chatTokens(page,card),where=`${look.id}: `;
  if(live){
   const c=await colours(page,{player:`${card} [data-stage-video-fill]`,controls:`${card} [data-stage-video-fill] > div:last-child`});
   assert.deepEqual([c.player.bg,c.controls.bg],['rgb(0, 0, 0)','rgb(27, 36, 48)'],where+'the playing card stays dark: black bars and the dark control bar');
   const hard=await hardToRead(page,`${card} [data-stage-video-fill]`);assert.deepEqual(hard,[],where+`player text under 4.5:1: ${JSON.stringify(hard)}`);
  }else{
   const c=await colours(page,{card,note:`${card} [data-card-live-video-off] strong`});
   assert.equal(c.card.bg,tokens['--chat-panel'],where+'the waiting card is the theme\'s panel');
   assert.equal(c.note.fg,tokens['--chat-text'],where+'its note is the theme\'s text colour');
   const hard=await hardToRead(page,card);assert.deepEqual(hard,[],where+`card text under 4.5:1: ${JSON.stringify(hard)}`);
   assert(await readable(page,card)>=2,where+'the note is there to measure');
   seen[look.id]={page:c.card.bg,text:c.note.fg};
  }
  if(each)await each(look);
 }
 if(!live)for(const look of looks){const light=LIGHT_LOOKS.has(look.id);assert.equal(lumOf(seen[look.id].page)>0.5,light,`${look.id}: a ${light?'light':'dark'} card (${seen[look.id].page})`);}
 await setLook(page,before);
}
const lumOf=text=>{const [r,g,b]=text.match(/[\d.]+/g).map(v=>{const s=Number(v)/255;return s<=0.03928?s/12.92:((s+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;};
/** The looks really differ: a light look draws a light page with dark text, a dark one the reverse, and no two pages match. */
export function different(seen,looks=LOOKS){
 const l=lumOf;
 for(const look of looks){const s=seen[look.id],light=LIGHT_LOOKS.has(look.id);
  assert.equal(l(s.page)>0.5,light,`${look.id}: a ${light?'light':'dark'} page (${s.page})`);assert.equal(l(s.text)<0.2,light,`${look.id}: ${light?'dark':'light'} text (${s.text})`);}
 assert.equal(new Set(looks.map(look=>seen[look.id].page)).size,looks.length,`every look draws its own page colour: ${JSON.stringify(Object.fromEntries(looks.map(look=>[look.id,seen[look.id].page])))}`);
}
