'use client';
import {useEffect,useState} from 'react';
import type {ChatAttachment} from '@/lib/chatAttachmentValidation';
import ChatAudioAttachment from './ChatAudioAttachment';
import ChatImagePreview from './ChatImagePreview';
import styles from './DirectInbox.module.css';

export default function DirectAttachments({ids,conversationId}:{ids?:string[];conversationId:string}){
 const [files,setFiles]=useState<ChatAttachment[]>([]),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const key=(ids??[]).join(',');
 useEffect(()=>{
  setFiles([]);setError('');if(!key)return;
  const controller=new AbortController();
  fetch(`/api/chat/attachments?conversationId=${conversationId}&ids=${key}`,{cache:'no-store',signal:controller.signal})
   .then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.error||'Files unavailable.');return result.files as ChatAttachment[];})
   .then(result=>{if(!controller.signal.aborted){setFiles(result);if(result.length!==key.split(',').length)setError('Some files could not load.');}})
   .catch(error=>{if(!controller.signal.aborted)setError(error.message);});
  return()=>controller.abort();
 },[key,conversationId,retry]);
 if(!key)return null;
 return <div className={styles.attachments} aria-label="Shared files">
  {files.map(file=><div key={file.id}>
   {file.mime_type==='audio/wav'&&<ChatAudioAttachment file={file}/>}
   {file.mime_type.startsWith('image/')&&<ChatImagePreview src={`/api/chat/attachments/${file.id}?preview=1`} alt={file.filename} downloadHref={`/api/chat/attachments/${file.id}`}/>}
   <a href={`/api/chat/attachments/${file.id}`} download>{file.filename} · {(file.byte_size/1024).toFixed(0)} KB ↓</a>
  </div>)}
  {error?<p role="alert">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry files</button></p>:files.length===0?<p>Loading files…</p>:null}
 </div>;
}
