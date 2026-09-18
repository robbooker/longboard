'use client';
import {useEffect,useRef,useState,type ClipboardEvent} from 'react';
import {attachmentMetadata} from '@/lib/chatAttachmentValidation';
import {clipboardImages} from '@/lib/chatClipboard';
export type AttachmentDraft={key:string;id?:string;name:string;preview?:string;size:number;progress:number;state:'uploading'|'scanning'|'ready'|'error';error?:string};
async function jsonFetch(url:string,init:RequestInit){
 const response=await fetch(url,init),data=await response.json();
 if(!response.ok)throw Error(data.error||'File upload failed.');
 return data;
}
function transfer(url:string,file:File,signal:AbortSignal,progress:(n:number)=>void){
 return new Promise<void>((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  xhr.open('PUT',url);xhr.setRequestHeader('Content-Type',file.type);xhr.setRequestHeader('x-upsert','false');xhr.timeout=120_000;
  const abort=()=>xhr.abort();signal.addEventListener('abort',abort,{once:true});
  const done=(error?:Error)=>{signal.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
  xhr.upload.onprogress=e=>{if(e.lengthComputable)progress(Math.round(e.loaded/e.total*100));};
  xhr.onload=()=>done(xhr.status>=200&&xhr.status<300?undefined:Error('Upload failed. Remove the file and try again.'));
  xhr.onerror=()=>done(Error('Upload failed. Check your connection.'));
  xhr.ontimeout=()=>done(Error('Upload timed out. Remove the file and try again.'));
  xhr.onabort=()=>done(Error('Upload cancelled.'));
  if(signal.aborted){done(Error('Upload cancelled.'));return;}
  xhr.send(file);
 });
}
export function useAttachments(scope:string|{conversationId:string|null}){
 const room=typeof scope==='string'?scope:null;
 const conversationId=typeof scope==='string'?null:scope.conversationId;
 const [files,setFiles]=useState<AttachmentDraft[]>([]),[error,setError]=useState('');
 const current=useRef<AttachmentDraft[]>([]),controllers=useRef(new Map<string,AbortController>()),active=useRef(true);
 const input=useRef<HTMLInputElement>(null);
 const update=(list:AttachmentDraft[])=>{current.current=list;if(active.current)setFiles(list);};
 const change=(key:string,patch:Partial<AttachmentDraft>)=>update(current.current.map(f=>f.key===key?{...f,...patch}:f));
 function remove(key:string,discard=true){
  const file=current.current.find(f=>f.key===key);controllers.current.get(key)?.abort();controllers.current.delete(key);
  if(file?.preview)URL.revokeObjectURL(file.preview);
  if(discard&&file?.id)void fetch(`/api/chat/attachments/${file.id}`,{method:'DELETE'}).catch(()=>{});
  update(current.current.filter(f=>f.key!==key));
 }
 useEffect(()=>{
  active.current=true;setFiles(current.current);
  return()=>{active.current=false;for(const file of [...current.current])remove(file.key,file.state!=='ready');};
 // Cancel unfinished uploads when leaving. Ready files use orphan cleanup so
 // an in-flight message send cannot race a DELETE on its attachments.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[room,conversationId]);
 async function upload(file:File){
  let metadata;
  try{metadata=attachmentMetadata(file.name,file.type,file.size);}catch(e){setError((e as Error).message);return;}
  if(current.current.length>=3){setError('Attach up to three files per message.');return;}
  setError('');const key=crypto.randomUUID(),controller=new AbortController();controllers.current.set(key,controller);
  update([...current.current,{key,name:metadata.filename,size:file.size,preview:file.type.startsWith('image/')?URL.createObjectURL(file):undefined,progress:0,state:'uploading'}]);
  let id:string|undefined;
  try{
   const reserved=await jsonFetch('/api/chat/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...metadata,...(room?{room}:{conversationId})}),signal:controller.signal});id=reserved.id;
   if(controller.signal.aborted||!current.current.some(f=>f.key===key)){void fetch(`/api/chat/attachments/${id}`,{method:'DELETE'});return;}
   change(key,{id});
   await transfer(reserved.url,file,controller.signal,progress=>change(key,{progress}));
   change(key,{state:'scanning',progress:100});
   await jsonFetch(`/api/chat/attachments/${id}`,{method:'POST',signal:controller.signal});
   change(key,{state:'ready'});
  }catch(e){if(!controller.signal.aborted)change(key,{state:'error',error:e instanceof Error?e.message:'File upload failed.'});}
  finally{controllers.current.delete(key);}
 }
 function addFiles(list:FileList|File[]|null){if(list)for(const file of Array.from(list))void upload(file);}
 function paste(event:ClipboardEvent){
  const {images,error:clipboardError}=clipboardImages(event.clipboardData);
  if(images.length){event.preventDefault();addFiles(images);}
  if(clipboardError)setError(clipboardError);
 }
 return {files,error,input,addFiles,paste,remove,clear:()=>{for(const f of [...current.current])remove(f.key,false);setError('');},
  ids:files.filter(f=>f.state==='ready'&&f.id).map(f=>f.id!),blocked:files.some(f=>f.state!=='ready')};
}
