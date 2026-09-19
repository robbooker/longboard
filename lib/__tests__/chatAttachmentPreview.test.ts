import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {renderAttachmentPreview,PREVIEW_MAX_BYTES} from '../chatAttachmentPreview';

describe('bounded scanned-image previews',()=>{
 it.each(['png','jpeg','gif'] as const)('makes a static bounded WebP from %s',async format=>{
  const original=await sharp({create:{width:1400,height:700,channels:3,background:'#ad628c'}}).toFormat(format).toBuffer();
  const preview=await renderAttachmentPreview(original,`image/${format}`);
  expect(preview.width).toBe(640);expect(preview.height).toBe(320);
  expect(preview.bytes.length).toBeLessThanOrEqual(PREVIEW_MAX_BYTES);
  const metadata=await sharp(preview.bytes).metadata();expect(metadata.format).toBe('webp');expect(metadata.pages??1).toBe(1);
 });
 it.each(['png','jpeg'] as const)('bounds noisy %s image output',async format=>{
  const bytes=await sharp(randomBytes(1800*1200*3),{raw:{width:1800,height:1200,channels:3}}).toFormat(format).toBuffer();
  const preview=await renderAttachmentPreview(bytes,`image/${format}`);expect(preview.bytes.length).toBeLessThanOrEqual(PREVIEW_MAX_BYTES);expect(preview.width).toBe(640);
 });
 it('does not enlarge small images and strips metadata',async()=>{
  const bytes=await sharp({create:{width:32,height:16,channels:3,background:'red'}}).withMetadata().jpeg().toBuffer();
  const result=await renderAttachmentPreview(bytes,'image/jpeg');expect(result.width).toBe(32);expect(result.height).toBe(16);expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
 });
 it('uses only first frame of animated GIF',async()=>{
  const pixels=Buffer.alloc(30*60*3);for(let i=0;i<30*60;i++)pixels[i*3+(i<900?0:2)]=255;
  const bytes=await sharp(pixels,{raw:{width:30,height:60,channels:3,pageHeight:30}}).gif({delay:[100,100],loop:0}).toBuffer();
  expect((await sharp(bytes,{animated:true}).metadata()).pages).toBe(2);
  const result=await renderAttachmentPreview(bytes,'image/gif');expect(result.height).toBe(30);expect((await sharp(result.bytes).metadata()).pages??1).toBe(1);
 });
 it('rejects malformed, oversized and non-image inputs',async()=>{
  await expect(renderAttachmentPreview(Buffer.from('GIF89a'), 'image/gif')).rejects.toThrow();
  await expect(renderAttachmentPreview(Buffer.alloc(10_000_001), 'image/png')).rejects.toThrow();
  await expect(renderAttachmentPreview(Buffer.from('%PDF-'), 'application/pdf')).rejects.toThrow();
 });
 it('rejects images exceeding decode pixel limit',async()=>{
  const bytes=await sharp({create:{width:5000,height:5000,channels:3,background:'white'}}).png().toBuffer();
  await expect(renderAttachmentPreview(bytes,'image/png')).rejects.toThrow();
 });
});
