'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import type {ReactionTarget} from './MessageReactions';
import styles from './MessageReactions.module.css';
type Person={id:string;name:string};
export default function ReactionDetails({target,emoji,icon,onClose}:{target:ReactionTarget;emoji:string;icon:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),controller=useRef<AbortController|null>(null);const title=useId();
 const [people,setPeople]=useState<Person[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const started=useRef(false);
 const load=useCallback(async(after:string|null)=>{
  controller.current?.abort();const request=new AbortController();controller.current=request;setBusy(true);setError('');
  try{
   const response=await fetch('/api/chat/message-reactions',{method:'POST',signal:request.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...target,action:'details',emoji,after})});
   if(!response.ok)throw Error('Could not load reactions. Please try again.');
   const data=await response.json();if(request.signal.aborted)return;
   setPeople(previous=>after?[...new Map([...previous,...data.people].map((person:Person)=>[person.id,person])).values()]:data.people);setCursor(data.nextCursor);started.current=true;
  }catch(e){if(!request.signal.aborted)setError(e instanceof Error?e.message:'Could not load reactions.');}
  finally{if(!request.signal.aborted)setBusy(false);}
 },[target,emoji]);
 useEffect(()=>{dialog.current?.showModal();void load(null);return()=>controller.current?.abort();},[load]);
 return <dialog ref={dialog} className={`${styles.picker} ${styles.details}`} aria-labelledby={title} onCancel={event=>{event.preventDefault();onClose();}} onClose={onClose} onClick={event=>{if(event.target===event.currentTarget){const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)onClose();}}}>
  <h2 id={title}>{icon} Reactions</h2>
  <div className={styles.people} tabIndex={0} aria-label="People who reacted" aria-busy={busy}>
   <ul>{people.map(person=><li key={person.id}>{person.name}</li>)}</ul>
   {!busy&&!error&&!people.length&&<p>No reactions yet.</p>}
   {busy&&<p role="status">Loading…</p>}
   {error&&<p role="alert">{error}</p>}
   {!busy&&(cursor||error)&&<button type="button" onClick={()=>void load(started.current?cursor:null)}>{error?'Try again':'Load more'}</button>}
  </div>
  <button type="button" onClick={onClose}>Close</button>
 </dialog>;
}
