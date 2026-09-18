'use client';
import {useEffect,useRef,useState} from 'react';
import type {useAttachments} from './hooks/useAttachments';
import {pcmWave,VOICE_MAX_BYTES,VOICE_MAX_SECONDS} from '@/lib/chatVoice';
import styles from './VoiceRecorder.module.css';
export default function VoiceRecorder({uploads,disabled=false}:{uploads:ReturnType<typeof useAttachments>;disabled?:boolean}){
 const [state,setState]=useState<'idle'|'recording'|'converting'|'preview'>('idle'),[seconds,setSeconds]=useState(0),[error,setError]=useState(''),[preview,setPreview]=useState('');
 const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),timer=useRef<ReturnType<typeof setInterval>|null>(null),file=useRef<File|null>(null),url=useRef(''),alive=useRef(true),generation=useRef(0);
 const {setVoiceBusy}=uploads;
 function stopTracks(){stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;if(timer.current)clearInterval(timer.current);timer.current=null;}
 function discard(){generation.current++;if(recorder.current?.state==='recording')recorder.current.stop();stopTracks();if(url.current)URL.revokeObjectURL(url.current);url.current='';file.current=null;setPreview('');setState('idle');setVoiceBusy(false);}
 // This counter intentionally invalidates pending asynchronous capture on unmount.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());if(timer.current)clearInterval(timer.current);if(url.current)URL.revokeObjectURL(url.current);setVoiceBusy(false);};},[setVoiceBusy]);
 async function start(){
  setError('');if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){setError('Recording is unavailable in this browser. Use text or attach a mono 16 kHz PCM WAV file.');return;}
  const version=++generation.current;setVoiceBusy(true);setState('converting');
  try{
   const media=await navigator.mediaDevices.getUserMedia({audio:true});if(!alive.current||generation.current!==version){media.getTracks().forEach(t=>t.stop());return;}
   stream.current=media;const type=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
   const capture=new MediaRecorder(media,{...(type?{mimeType:type}:{}),audioBitsPerSecond:64000});recorder.current=capture;const chunks:Blob[]=[];let size=0;const started=Date.now();
   capture.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);size+=event.data.size;if((size>VOICE_MAX_BYTES||Date.now()-started>=VOICE_MAX_SECONDS*1000)&&capture.state==='recording')capture.stop();}};
   capture.onerror=()=>{if(!alive.current||generation.current!==version)return;discard();setError('Recording failed. Your text and other files are still here.');};
   capture.onstop=async()=>{if(!alive.current||generation.current!==version)return;stopTracks();setState('converting');let context:AudioContext|null=null;
    try{if(size>VOICE_MAX_BYTES)throw Error('Recording is too large. Try a shorter clip.');context=new AudioContext();const decoded=await context.decodeAudioData(await new Blob(chunks,{type:capture.mimeType}).arrayBuffer()).catch(()=>{throw Error('This browser could not decode the recording. Your text is still here. Try again, or attach a mono 16 kHz PCM WAV file.');});if(!Number.isFinite(decoded.duration)||decoded.duration<=0)throw Error('Recording could not be decoded. Try again or use text.');
     const frames=Math.min(Math.ceil(decoded.duration*16000),VOICE_MAX_SECONDS*16000),offline=new OfflineAudioContext(1,frames,16000),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();const normalized=await offline.startRendering();const bytes=pcmWave(normalized.getChannelData(0));
     if(!alive.current||generation.current!==version)return;file.current=new File([new Uint8Array(bytes)],'voice-message.wav',{type:'audio/wav'});url.current=URL.createObjectURL(file.current);setPreview(url.current);setState('preview');
    }catch(e){if(alive.current&&generation.current===version){setError(e instanceof Error?e.message:'Recording failed.');setState('idle');setVoiceBusy(false);}}finally{void context?.close();}
   };
   capture.start(250);setSeconds(0);setState('recording');timer.current=setInterval(()=>{setSeconds(Math.min(120,Math.floor((Date.now()-started)/1000)));if(Date.now()-started>=VOICE_MAX_SECONDS*1000&&capture.state==='recording')capture.stop();},200);
  }catch{if(alive.current&&generation.current===version){stopTracks();setState('idle');setVoiceBusy(false);setError('Microphone access was denied or unavailable. Check browser permission, or use text/files.');}}
 }
 return <div className={styles.recorder}>
  {state==='idle'?<button type="button" className={styles.mic} disabled={disabled||uploads.files.length>=3} aria-label="Record voice message" title="Record voice message · up to 2 minutes / 5 MB" onClick={()=>void start()}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg></button>:<div className={styles.panel}>
   {state==='recording'?<><span role="status">Recording · {seconds}s / 120s</span><button type="button" onClick={()=>recorder.current?.stop()}>Stop recording</button></>:state==='converting'?<span role="status">Preparing voice clip…</span>:<><audio controls preload="metadata" src={preview} aria-label="Voice message preview"/><button type="button" onClick={()=>{if(file.current)uploads.addFiles([file.current]);discard();}}>Attach voice message</button></>}
   <button type="button" onClick={discard}>Discard recording</button>
  </div>}
  {error&&<p role="alert" className={styles.hint}>{error}</p>}
 </div>;
}
