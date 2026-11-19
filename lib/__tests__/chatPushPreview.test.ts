import {describe,it,expect} from 'vitest';
import {chatPushNotification,pushPreviewText,pushMessageText,fitPushPayload,isChatPushPreview,gainersPushText,PUSH_BODY_MAX_BYTES,PUSH_PAYLOAD_MAX_BYTES} from '../chatPushPreview';
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length;
const payloadFor=(n:{title:string;body:string})=>({...n,url:'/chat?room=shortscout&thread=00000000-0000-4000-8000-000000000001',tag:'chat-00000000-0000-4000-8000-000000000002'});
const privateNotification={title:'Rob Booker Chat',body:'You have a new chat notification.'};
describe('native push preview disclosure',()=>{
 it('does not expose sender, message, room or attachment metadata for off and unknown settings',()=>{
  for(const preview of [undefined,null,'off','invalid',true])expect(chatPushNotification({preview,kind:'room',room:'shortscout',category:'reply',sender:'Private sender',body:'Private message',hasAttachments:true})).toEqual(privateNotification);
 });
 it('puts fixed chat type and sender in the title, with message text only in the body',()=>{
  expect(chatPushNotification({preview:'message',sender:'Luke',body:'See you soon!',kind:'dm'})).toEqual({title:'DM - Luke',body:'See you soon!'});
  for(const [room,label] of [['main','LB'],['social','Social'],['shortscout','SS'],['developers','Developers']])for(const category of ['mention','reply'])expect(chatPushNotification({preview:'message',sender:'Luke',body:'Hello',kind:'room',room,category})).toEqual({title:`${label} ${category} - Luke`,body:'Hello'});
 });
 it('sender mode never discloses message or attachment content',()=>{
  for(const kind of ['dm','room'])for(const hasAttachments of [false,true])expect(chatPushNotification({preview:'sender',sender:'Luke',body:'secret',kind,room:'social',category:'reply',hasAttachments})).toEqual({title:kind==='dm'?'DM - Luke':'Social reply - Luke',body:privateNotification.body});
 });
 it('uses a generic context for old or unrecognized room/category metadata',()=>{
  for(const input of [{},{kind:'room'},{kind:'room',room:'social',category:'private category'},{kind:'room',room:'private room',category:'reply'},{kind:'reaction',room:'social',category:'reply'}])expect(chatPushNotification({preview:'message',sender:'Luke',body:'Hello',...input})).toEqual({title:'Chat - Luke',body:'Hello'});
 });
 it('keeps the title bounded and never cuts a surrogate pair or grapheme in the body',()=>{
  for(const body of ['a'.repeat(999),'a'.repeat(1000),'a'.repeat(1001),'🦄'.repeat(1001),'你好'.repeat(600),'e\u0301'.repeat(700),'👍🏽'.repeat(500),'hi\ud800there\udfff']){
   const result=chatPushNotification({preview:'message',sender:'🦄'.repeat(100),body,kind:'room',room:'social',category:'mention'});
   expect(Array.from(result.body).length).toBeLessThanOrEqual(1000);expect(Array.from(result.title).length).toBeLessThanOrEqual(64);expect(result.body).not.toMatch(/[\ud800-\udfff]/u);expect(result.title).not.toMatch(/[\ud800-\udfff]/u);
   expect(bytes(result.body)-2).toBeLessThanOrEqual(PUSH_BODY_MAX_BYTES);expect(bytes(payloadFor(result))).toBeLessThan(PUSH_PAYLOAD_MAX_BYTES);
   if(body.startsWith('e\u0301'))expect(result.body).toMatch(/^(e\u0301)+…$/);
   if(body.startsWith('👍🏽'))expect(result.body).toMatch(/^(👍🏽)+…$/u);
  }
  expect(chatPushNotification({preview:'message',body:'a'.repeat(1000)}).body).toBe('a'.repeat(1000));
  expect(chatPushNotification({preview:'message',body:'a'.repeat(1001)}).body).toBe('a'.repeat(999)+'…');
  expect(chatPushNotification({preview:'message',sender:'Lukas '.repeat(20)}).title).toBe('Chat - '+'Lukas '.repeat(6)+'Luk…');
 });
 it('leaves a short message unchanged',()=>{
  expect(chatPushNotification({preview:'message',kind:'dm',sender:'Luke',body:'ok'})).toEqual({title:'DM - Luke',body:'ok'});
 });
 it('sends a 3-4 sentence message whole (DM, room reply and mention)',()=>{
  const body='Morning all. RIVN is gapping up on the delivery numbers and holding the premarket high. I am watching 14.20 for a pivot and will only take it on volume. Stops go under the overnight low.';
  expect(chatPushNotification({preview:'message',kind:'dm',sender:'Luke',body})).toEqual({title:'DM - Luke',body});
  expect(chatPushNotification({preview:'message',kind:'room',room:'social',category:'reply',sender:'Luke',body})).toEqual({title:'Social reply - Luke',body});
  expect(chatPushNotification({preview:'message',kind:'room',room:'main',category:'mention',sender:'Luke',body:'@Rob '+body})).toEqual({title:'LB mention - Luke',body:'@Rob '+body});
 });
 it('cuts a several-paragraph message near 1,000 characters at a word, keeping paragraph breaks',()=>{
  const paragraph='The setup is simple and it repeats on most days when the market opens strong and the leaders hold their first pullback.';
  const body=Array.from({length:12},()=>paragraph).join('\n\n\n');
  for(const result of [chatPushNotification({preview:'message',kind:'dm',sender:'Luke',body}),chatPushNotification({preview:'message',kind:'room',room:'shortscout',category:'reply',sender:'Luke',body})]){
   const n=Array.from(result.body).length;
   expect(n).toBeLessThanOrEqual(1000);expect(n).toBeGreaterThan(900);
   expect(result.body.endsWith('…')).toBe(true);expect(result.body).not.toMatch(/\s…$/);
   const cleaned=body.replace(/\n{3}/g,'\n\n'),kept=result.body.slice(0,-1);
   expect(cleaned.startsWith(kept)).toBe(true);expect(cleaned[kept.length]).toMatch(/\s/); // cut falls between words
   expect(result.body).toContain(paragraph+'\n\n'+paragraph);expect(result.body).not.toContain('\n\n\n');
  }
 });
 it('keeps an emoji-heavy message under the byte budget',()=>{
  for(const body of ['🦄'.repeat(1000),'🚀🔥 '.repeat(400),'"\\'.repeat(900),'\u00e9'.repeat(1000)]){
   const result=chatPushNotification({preview:'message',kind:'room',room:'developers',category:'mention',sender:'🦄'.repeat(40),body});
   expect(bytes(result.body)-2).toBeLessThanOrEqual(PUSH_BODY_MAX_BYTES);expect(bytes(payloadFor(result))).toBeLessThan(PUSH_PAYLOAD_MAX_BYTES);expect(result.body.endsWith('…')||Array.from(result.body).length<=1000).toBe(true);
  }
  expect(chatPushNotification({preview:'message',body:'🦄'.repeat(1000)}).body).toBe('🦄'.repeat(599)+'…');
 });
 it('trims the body further if the whole payload would still be too big',()=>{
  const payload={title:'DM - Luke',body:'word '.repeat(480).trim(),url:'/chat?dm='+'a'.repeat(1000),tag:'chat-x'};
  const fitted=fitPushPayload(payload);expect(bytes(fitted)).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);expect(fitted.body.endsWith('…')).toBe(true);expect({...fitted,body:''}).toEqual({...payload,body:''});
  const small={title:'DM - Luke',body:'ok',url:'/chat?dm=1',tag:'chat-1'};expect(fitPushPayload(small)).toBe(small);
 });
 it('keeps line breaks in the body only, with one blank line at most and no hidden controls',()=>{
  expect(pushMessageText('Line one\r\nLine two\n\n\n\n  Line three \u202e\t end')).toBe('Line one\nLine two\n\nLine three end');
  expect(pushMessageText('<b>Hi</b>\n**there** [read](https://private.test/token)\u0007')).toBe('Hi\nthere read');
  expect(chatPushNotification({preview:'message',kind:'dm',sender:'Lu\nke',body:'a\nb'})).toEqual({title:'DM - Lu ke',body:'a\nb'});
 });
 it('strips markup, controls and line breaks; never uses filenames or media URLs for an empty body',()=>{
  expect(pushPreviewText('<b>Hello</b>\n**there**\u202E [read](https://private.test/token)',40)).toBe('Hello there read');
  expect(chatPushNotification({preview:'message',kind:'dm',sender:'<b>Lu</b>\n**ke**\u202e',body:'',hasAttachments:true})).toEqual({title:'DM - Lu ke',body:'Sent an attachment.'});
  expect(chatPushNotification({preview:'message',sender:'',body:''})).toEqual({title:'Chat - Someone',body:'Sent a message.'});
 });
 it('accepts only explicit defined disclosure modes',()=>{for(const v of ['off','sender','message'])expect(isChatPushPreview(v)).toBe(true);for(const v of [true,'all','',null])expect(isChatPushPreview(v)).toBe(false);});
 it('GAINERS-PUSH: shows the ticker and move from the post, whatever the preview setting',()=>{
  const body='🚨 BRZE (+52.60%) 🕒 Pre-Market\n🕒 Extended Price: $45.76 (+52.60%)\n💵 Price: $45.76';
  for(const preview of ['off','sender','message',undefined])expect(chatPushNotification({preview,kind:'gainers',body})).toEqual({title:'Gainers',body:'BRZE +52.60% · Pre-Market'});
  expect(gainersPushText('🚨 GMEX (28.16%) 🕒 After Hours')).toBe('GMEX +28.16% · After Hours');
  expect(gainersPushText('🚨 BRK.B (+5.10%)')).toBe('BRK.B +5.10%');
  expect(gainersPushText('Market <b>update</b>\nsecond line')).toBe('Market update');
  for(const empty of ['',null,undefined,42])expect(gainersPushText(empty)).toBe('New Gainers alert.');
  expect(Array.from(gainersPushText('🚨 ABCD (+1.00%) '+'x'.repeat(200))).length).toBeLessThanOrEqual(40);
 });
});
