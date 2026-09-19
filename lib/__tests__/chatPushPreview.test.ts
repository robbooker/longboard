import {describe,it,expect} from 'vitest';
import {chatPushBody,pushPreviewText,isChatPushPreview} from '../chatPushPreview';
describe('push preview disclosure',()=>{
 it('does not expose sender, body or attachments for unknown and legacy settings',()=>{
  for(const preview of [undefined,null,'off','invalid'])expect(chatPushBody({preview,sender:'Private sender',body:'Private message',hasAttachments:true})).toBe('You have a new chat notification.');
 });
 it('sender mode never includes message content',()=>{
  expect(chatPushBody({preview:'sender',sender:'Alex',body:'secret',kind:'dm'})).toBe('Alex sent you a message.');
  expect(chatPushBody({preview:'sender',sender:'Alex',body:'secret',kind:'room'})).toBe('Alex mentioned or replied to you.');
 });
 it('message preview is bounded for existing workers, without breaking emoji',()=>{
  const body=chatPushBody({preview:'message',sender:'🦄'.repeat(50),body:'🦄'.repeat(150)});
  expect(body.length).toBeLessThanOrEqual(152);expect(body).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
 });
 it('strips markup, controls and line breaks; does not include attachment filenames or URLs',()=>{
  expect(pushPreviewText('<b>Hello</b>\n**there**\u202E [read](https://private.test/token)',110)).toBe('Hello there read');
  expect(chatPushBody({preview:'message',sender:'Alex',body:'',hasAttachments:true})).toBe('Alex: Sent an attachment.');
  expect(chatPushBody({preview:'message',sender:'',body:''})).toBe('Someone: Sent a message.');
 });
 it('accepts only explicit defined disclosure modes',()=>{for(const v of ['off','sender','message'])expect(isChatPushPreview(v)).toBe(true);for(const v of [true,'all','',null])expect(isChatPushPreview(v)).toBe(false);});
});
