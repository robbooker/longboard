import {describe,it,expect} from 'vitest';
import {attachmentMetadata,attachmentSignature,CHAT_FILE_MAX_BYTES} from '../chatAttachmentValidation';
describe('chat attachment boundary checks',()=>{
 it('allows the approved formats at the size boundary',()=>{
  for(const [name,mime] of [['report.pdf','application/pdf'],['photo.JPEG','image/jpeg'],['photo.png','image/png'],['animation.gif','image/gif']])expect(attachmentMetadata(name,mime,CHAT_FILE_MAX_BYTES).byte_size).toBe(CHAT_FILE_MAX_BYTES);
 });
 it('rejects paths, control characters, empty, oversized and mismatched files',()=>{
  for(const args of [['../x.pdf','application/pdf',1],['a\r.pdf','application/pdf',1],['a.svg','image/svg+xml',10],['a.exe','image/png',10],['a.pdf','application/pdf',0],['a.pdf','application/pdf',CHAT_FILE_MAX_BYTES+1],['a.pdf','application/pdf',1.5]])expect(()=>attachmentMetadata(...args as [unknown,unknown,unknown])).toThrow();
 });
 it('rejects executable bytes even if the browser says image',()=>{
  expect(attachmentSignature(new Uint8Array([77,90,0,0]),'image/png')).toBe(false);
  expect(attachmentSignature(new TextEncoder().encode('%PDF-1.7'),'application/pdf')).toBe(true);
  expect(attachmentSignature(new TextEncoder().encode('GIF89a'),'image/gif')).toBe(true);
 });
});
