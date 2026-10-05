'use client';
import {useEffect,useRef,useState} from 'react';
import {copyDirectMessageText} from '@/lib/chatDmCopy';
import styles from './DirectInbox.module.css';

type Feedback={body:string;kind:'copying'|'copied'|'error';text:string};
export default function DirectMessageCopy({body}:{body:string}){
 const [feedback,setFeedback]=useState<Feedback|null>(null);
 const request=useRef({version:0}).current;
 const [above,setAbove]=useState(false);
 const current=feedback?.body===body?feedback:null;
 const empty=!body.trim();
 useEffect(()=>{setFeedback(null);return()=>{request.version++;};},[body,request]);
 useEffect(()=>{
  if(feedback?.kind!=='copied')return;
  const timer=setTimeout(()=>setFeedback(null),2500);
  return()=>clearTimeout(timer);
 },[feedback]);
 async function copy(button:HTMLButtonElement){
  if(empty||current?.kind==='copying')return;
  const bounds=button.getBoundingClientRect(),pane=button.closest('article')?.parentElement?.getBoundingClientRect();
  setAbove(!!pane&&bounds.top-pane.top>pane.bottom-bounds.bottom);
  const version=++request.version;
  setFeedback({body,kind:'copying',text:'Copying…'});
  try{
   await copyDirectMessageText(body,navigator.clipboard);
   if(version===request.version)setFeedback({body,kind:'copied',text:'Copied'});
  }catch(error){if(version===request.version)setFeedback({body,kind:'error',text:error instanceof Error?error.message:'Could not copy. Please try again.'});}
 }
 return <span className={styles.copyMessage} data-feedback={!!current} data-above={above}>
  <button type='button' className={styles.copyControl} aria-label={empty?'Media message — no text to copy':'Copy message text'} title={empty?'Media message — no text to copy':'Copy message text'} disabled={empty} aria-busy={current?.kind==='copying'} onClick={event=>void copy(event.currentTarget)}>
   <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'><rect x='8' y='8' width='12' height='13' rx='2'/><path d='M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3'/></svg>
  </button>
  <span className={styles.copyFeedback} role='status' aria-live='polite' aria-atomic='true'>{current?.text??''}</span>
 </span>;
}
