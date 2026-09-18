export const VOICE_MAX_SECONDS=120;
export const VOICE_MAX_BYTES=5_000_000;
export const VOICE_MIME='audio/wav';
/** Canonical mono16kHz PCM16 WAV: duration comes from sample bytes, not a client claim. */
export function voiceDuration(bytes:Uint8Array):number {
 const fail=()=>{throw Error('Choose a mono 16 kHz PCM WAV voice clip up to 2 minutes.');};
 if(bytes.byteLength<46||bytes.byteLength>VOICE_MAX_BYTES)return fail();
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tag=(at:number)=>String.fromCharCode(...bytes.subarray(at,at+4));
 if(tag(0)!=='RIFF'||tag(8)!=='WAVE'||tag(12)!=='fmt '||tag(36)!=='data'||v.getUint32(4,true)!==bytes.length-8||v.getUint32(16,true)!==16||v.getUint16(20,true)!==1||v.getUint16(22,true)!==1||v.getUint32(24,true)!==16000||v.getUint32(28,true)!==32000||v.getUint16(32,true)!==2||v.getUint16(34,true)!==16)return fail();
 const size=v.getUint32(40,true);if(size!==bytes.length-44||size%2!==0||size/32000>VOICE_MAX_SECONDS)return fail();
 return size/32000;
}
export function pcmWave(samples:Float32Array):Uint8Array {
 const out=new Uint8Array(44+samples.length*2),v=new DataView(out.buffer);
 const tag=(at:number,value:string)=>[...value].forEach((c,i)=>out[at+i]=c.charCodeAt(0));
 tag(0,'RIFF');v.setUint32(4,out.length-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,samples.length*2,true);
 samples.forEach((sample,i)=>v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,sample))*(sample<0?32768:32767)),true));return out;
}
