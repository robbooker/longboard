import {describe,it,expect} from 'vitest';
import {pcmWave,voiceDuration} from '@/lib/chatVoice';
import {attachmentSignature} from '@/lib/chatAttachmentValidation';
describe('canonical voice byte validation',()=>{
 it.each([1,16000,1920000])('derives duration from %i actual PCM samples',n=>{const wave=pcmWave(new Float32Array(n));expect(voiceDuration(wave)).toBe(n/16000);expect(attachmentSignature(wave,'audio/wav')).toBe(true);});
 it('clips samples to signed PCM range',()=>{const wave=pcmWave(new Float32Array([-2,0,2]));const data=new DataView(wave.buffer);expect([44,46,48].map(i=>data.getInt16(i,true))).toEqual([-32768,0,32767]);});
 it.each(['empty','long','truncated','odd','wrong-rate','forged-size','second-chunk','wrong-format'])('rejects %s audio before scanning',mode=>{
  let bytes=pcmWave(new Float32Array(mode==='long'?1920001:16000));
  if(mode==='empty')bytes=pcmWave(new Float32Array());
  if(mode==='truncated')bytes=bytes.slice(0,-2);
  if(mode==='odd'){bytes=bytes.slice(0,-1);new DataView(bytes.buffer).setUint32(4,bytes.length-8,true);new DataView(bytes.buffer).setUint32(40,bytes.length-44,true);}
  if(mode==='wrong-rate')new DataView(bytes.buffer).setUint32(24,8000,true);
  if(mode==='forged-size')new DataView(bytes.buffer).setUint32(40,2,true);
  if(mode==='second-chunk'){const extra=new Uint8Array(bytes.length+10);extra.set(bytes);extra.set([100,97,116,97,2,0,0,0,0,0],bytes.length);new DataView(extra.buffer).setUint32(4,extra.length-8,true);bytes=extra;}
  if(mode==='wrong-format')new DataView(bytes.buffer).setUint16(20,3,true);
  expect(()=>voiceDuration(bytes)).toThrow();expect(attachmentSignature(bytes,'audio/wav')).toBe(false);
 });
});
