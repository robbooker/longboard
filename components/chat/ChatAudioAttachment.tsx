'use client';
import {useEffect,useRef,useState} from 'react';
import type {ChatAttachment} from '@/lib/chatAttachmentValidation';
import styles from './VoiceRecorder.module.css';
export default function ChatAudioAttachment({file}:{file:ChatAttachment}){
 const [text,setText]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[playError,setPlayError]=useState(false);
 const controller=useRef<AbortController|null>(null),player=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[file.id]);
 async function transcript(){if(busy)return;setBusy(true);setError('');controller.current=new AbortController();try{
  const response=await fetch(`/api/chat/attachments/${file.id}/transcript`,{method:'POST',signal:controller.current.signal,cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error||'Transcript unavailable.');
  if(data.status==='ready')setText(data.text);else setError('Transcript is being prepared. Try again shortly.');
 }catch(e){if(!controller.current?.signal.aborted)setError(e instanceof Error?e.message:'Transcript unavailable.');}finally{setBusy(false);}}
 return <div className={styles.audio}>
  {file.duration_seconds&&<small>{Math.ceil(file.duration_seconds)}s voice message</small>}
  <audio ref={player} controls preload="none" src={`/api/chat/attachments/${file.id}?play=1`} aria-label="Voice message" onError={()=>setPlayError(true)}/>
  {playError&&<button type="button" onClick={()=>{setPlayError(false);player.current?.load();}}>Retry voice playback</button>}
  <button type="button" disabled={busy} onClick={()=>void transcript()}>{busy?'Transcribing…':text===null?'Transcript':'Refresh transcript'}</button>
  <p>Transcript uses OpenAI only when requested. It may contain mistakes.</p>
  {text!==null&&<div className={styles.transcript} aria-label="Voice message transcript">{text}</div>}{error&&<p role="status">{error}</p>}
 </div>;
}
