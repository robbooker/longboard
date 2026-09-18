'use client';
import {useEffect,useState} from 'react';
import Image from 'next/image';
import ChatAudioAttachment from './ChatAudioAttachment';
import ChatImagePreview from './ChatImagePreview';
import type {ChatAttachment} from '@/lib/chatAttachmentValidation';
import type {useAttachments} from './hooks/useAttachments';
import styles from './ChatAttachments.module.css';
const size=(bytes:number)=>bytes>=1_000_000?`${(bytes/1_000_000).toFixed(1)} MB`:`${Math.max(1,Math.ceil(bytes/1000))} KB`;
export function AttachmentPicker({uploads,disabled=false}:{uploads:ReturnType<typeof useAttachments>;disabled?:boolean}){
 return <div className={styles.drafts}>
  <input ref={uploads.input} type='file' hidden multiple accept='.pdf,.jpg,.jpeg,.png,.gif,.wav' aria-label='Attach files' disabled={disabled} onChange={e=>{uploads.addFiles(e.target.files);e.target.value='';}}/>
  {uploads.files.length>0&&<ul aria-label='Attachment drafts'>{uploads.files.map(file=><li key={file.key}>
   {file.preview&&<Image unoptimized src={file.preview} width={64} height={64} alt=''/>}
   <div><strong>{file.name}</strong><small>{size(file.size)}</small><span role='status'>{file.state==='ready'?'Ready to send':file.state==='scanning'?'Scanning for malware…':file.state==='error'?file.error:`Uploading ${file.progress}%`}</span>{file.state==='uploading'&&<progress aria-label={`Uploading ${file.name}`} max={100} value={file.progress}/>}</div>
   <button type='button' disabled={disabled} aria-label={`Remove ${file.name}`} onClick={()=>uploads.remove(file.key)}>×</button>
  </li>)}</ul>}
  {uploads.error&&<p role='alert'>{uploads.error}</p>}
  {uploads.files.length>0&&<small>Up to 3 files · 10 MB each (voice: 2 min / 5 MB) · Files are scanned before sharing.</small>}
 </div>;
}
export function ChatAttachments({ids,room}:{ids?:string[];room:string}){
 const key=ids?.join(',')||'';
 const [files,setFiles]=useState<ChatAttachment[]>([]),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  setFiles([]);setFailed(false);if(!key)return;
  const controller=new AbortController();
  void fetch(`/api/chat/attachments?room=${encodeURIComponent(room)}&ids=${encodeURIComponent(key)}`,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(!controller.signal.aborted){setFiles(data.files);setFailed(data.files.length!==key.split(',').length);}}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
  return()=>controller.abort();
 },[key,room,retry]);
 if(!key)return null;
 return <div className={styles.files} aria-label='Message attachments'>
  {files.map(file=><div key={file.id} className={styles.file}>
   {file.mime_type==='audio/wav'&&<ChatAudioAttachment file={file}/>}
   {file.mime_type.startsWith('image/')&&<ChatImagePreview src={`/api/chat/attachments/${file.id}?preview=1`} alt={file.filename} downloadHref={`/api/chat/attachments/${file.id}`}/>}
   <a href={`/api/chat/attachments/${file.id}`} target='_blank' rel='noopener noreferrer'>{file.filename} · {size(file.byte_size)} ↓</a>
  </div>)}
  {!files.length&&!failed&&<span>Loading attachments…</span>}
  {failed&&<button type='button' onClick={()=>setRetry(n=>n+1)}>Attachments unavailable · Retry</button>}
 </div>;
}
