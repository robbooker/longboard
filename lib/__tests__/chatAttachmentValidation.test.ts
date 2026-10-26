import {describe,it,expect} from 'vitest';
import {attachmentAccept,attachmentMetadata,attachmentSignature,CHAT_FILE_MAX_BYTES,looksLikeTextFile} from '../chatAttachmentValidation';
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
describe('HTML files (D-308): DMs only, text bytes only',()=>{
 it('allows .html and .htm in DMs up to 10 MB',()=>{
  expect(attachmentMetadata('page.html','text/html',CHAT_FILE_MAX_BYTES,'dm').mime_type).toBe('text/html');
  expect(attachmentMetadata('OLD.HTM','text/html',10,'dm').filename).toBe('OLD.HTM');
  expect(()=>attachmentMetadata('page.html','text/html',CHAT_FILE_MAX_BYTES+1,'dm')).toThrow('10 MB');
 });
 it('refuses HTML in rooms with the room wording, which does not mention HTML',()=>{
  for(const scope of [undefined,'room'] as const)expect(()=>attachmentMetadata('page.html','text/html',10,scope)).toThrow('Choose a PDF, JPEG, PNG, GIF or WAV voice file.');
  expect(()=>attachmentMetadata('page.exe','application/x-msdownload',10,'dm')).toThrow('Choose a PDF, JPEG, PNG, GIF, HTML or WAV voice file.');
 });
 it('refuses mismatched names and types in DMs',()=>{
  for(const [name,mime] of [['page.htm.exe','text/html'],['page.html','application/xhtml+xml'],['page.svg','image/svg+xml'],['page.html','text/plain'],['report.pdf','text/html']])expect(()=>attachmentMetadata(name,mime,10,'dm')).toThrow();
 });
 it('offers HTML in the DM file picker only',()=>{
  expect(attachmentAccept('dm')).toBe('.pdf,.jpg,.jpeg,.png,.gif,.wav,.html,.htm');
  expect(attachmentAccept('room')).toBe('.pdf,.jpg,.jpeg,.png,.gif,.wav');
 });
 it('accepts UTF-8 text with or without a BOM and without an <html> tag',()=>{
  const text=(s:string)=>new TextEncoder().encode(s);
  expect(attachmentSignature(text('<!doctype html>\r\n<p>Héllo 📈</p>\t\f'),'text/html')).toBe(true);
  expect(attachmentSignature(text('just some notes'),'text/html')).toBe(true);
  expect(attachmentSignature(new Uint8Array([0xef,0xbb,0xbf,...text('<p>bom</p>')]),'text/html')).toBe(true);
  expect(looksLikeTextFile(text('<b>x</b>'))).toBe(true);
 });
 it('refuses bad bytes: NUL, binary, invalid UTF-8, UTF-16 and empty files',()=>{
  const text=(s:string)=>new TextEncoder().encode(s);
  expect(attachmentSignature(text('<p>a\u0000b</p>'),'text/html')).toBe(false);
  expect(attachmentSignature(new Uint8Array([77,90,144,0,3]),'text/html')).toBe(false);
  expect(attachmentSignature(new TextEncoder().encode('%PDF-1.7\n').map((b,i)=>i===8?0x01:b),'text/html')).toBe(false);
  expect(attachmentSignature(new Uint8Array([0x3c,0x70,0xff,0xfe,0x3e]),'text/html')).toBe(false);
  expect(attachmentSignature(new Uint8Array([0xff,0xfe,0x3c,0x00,0x70,0x00]),'text/html')).toBe(false);
  expect(attachmentSignature(new Uint8Array([137,80,78,71,13,10,26,10]),'text/html')).toBe(false);
  expect(attachmentSignature(new Uint8Array([]),'text/html')).toBe(false);
 });
});
