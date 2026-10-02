import {describe,it,expect} from 'vitest';
import {chatPushNotification,pushPreviewText,isChatPushPreview} from '../chatPushPreview';
const privateNotification={title:'Rob Booker Chat',body:'You have a new chat notification.'};
describe('native push preview disclosure',()=>{
 it('does not expose sender, message, room or attachment metadata for off and unknown settings',()=>{
  for(const preview of [undefined,null,'off','invalid',true])expect(chatPushNotification({preview,kind:'room',room:'shortscout',category:'reply',sender:'Private sender',body:'Private message',hasAttachments:true})).toEqual(privateNotification);
 });
 it('puts fixed chat type and sender in the title, with message text only in the body',()=>{
  expect(chatPushNotification({preview:'message',sender:'Luke',body:'See you soon!',kind:'dm'})).toEqual({title:'DM - Luke',body:'See you soon!'});
  for(const [room,label] of [['main','LB'],['social','Social'],['shortscout','SS']])for(const category of ['mention','reply'])expect(chatPushNotification({preview:'message',sender:'Luke',body:'Hello',kind:'room',room,category})).toEqual({title:`${label} ${category} - Luke`,body:'Hello'});
 });
 it('sender mode never discloses message or attachment content',()=>{
  for(const kind of ['dm','room'])for(const hasAttachments of [false,true])expect(chatPushNotification({preview:'sender',sender:'Luke',body:'secret',kind,room:'social',category:'reply',hasAttachments})).toEqual({title:kind==='dm'?'DM - Luke':'Social reply - Luke',body:privateNotification.body});
 });
 it('uses a generic context for old or unrecognized room/category metadata',()=>{
  for(const input of [{},{kind:'room'},{kind:'room',room:'social',category:'private category'},{kind:'room',room:'private room',category:'reply'},{kind:'reaction',room:'social',category:'reply'}])expect(chatPushNotification({preview:'message',sender:'Luke',body:'Hello',...input})).toEqual({title:'Chat - Luke',body:'Hello'});
 });
 it('bounds message body to 40 Unicode code points including ellipsis, without cutting surrogate pairs',()=>{
  for(const body of ['a'.repeat(39),'a'.repeat(40),'a'.repeat(41),'🦄'.repeat(40),'🦄'.repeat(41),'你好'.repeat(21),'e\u0301'.repeat(30),'hi\ud800there\udfff']){
   const result=chatPushNotification({preview:'message',sender:'🦄'.repeat(100),body,kind:'room',room:'social',category:'mention'});
   expect(Array.from(result.body).length).toBeLessThanOrEqual(40);expect(Array.from(result.title).length).toBeLessThanOrEqual(64);expect(result.body).not.toMatch(/[\ud800-\udfff]/u);expect(result.title).not.toMatch(/[\ud800-\udfff]/u);
  }
  expect(chatPushNotification({preview:'message',body:'🦄'.repeat(40)}).body).toBe('🦄'.repeat(40));
  expect(chatPushNotification({preview:'message',body:'🦄'.repeat(41)}).body).toBe('🦄'.repeat(39)+'…');
 });
 it('strips markup, controls and line breaks; never uses filenames or media URLs for an empty body',()=>{
  expect(pushPreviewText('<b>Hello</b>\n**there**\u202E [read](https://private.test/token)',40)).toBe('Hello there read');
  expect(chatPushNotification({preview:'message',kind:'dm',sender:'<b>Lu</b>\n**ke**\u202e',body:'',hasAttachments:true})).toEqual({title:'DM - Lu ke',body:'Sent an attachment.'});
  expect(chatPushNotification({preview:'message',sender:'',body:''})).toEqual({title:'Chat - Someone',body:'Sent a message.'});
 });
 it('accepts only explicit defined disclosure modes',()=>{for(const v of ['off','sender','message'])expect(isChatPushPreview(v)).toBe(true);for(const v of [true,'all','',null])expect(isChatPushPreview(v)).toBe(false);});
});
