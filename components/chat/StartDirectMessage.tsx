'use client';
import {useEffect,useId,useRef,useState} from 'react';
import styles from './StartDirectMessage.module.css';
type Member={id:string;display_name:string};
export default function StartDirectMessage({onSelect}:{onSelect:(target:{id:string;name:string})=>void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[members,setMembers]=useState<Member[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),results=useRef<HTMLUListElement>(null),chosen=useRef(false);
 const searchable=query.normalize('NFKC').trim().length>=2;
 const titleId=useId(),inputId=useId(),resultsId=useId();
 useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
 useEffect(()=>{
  if(!open)return;
  if(!searchable){setMembers([]);setLoading(false);setError('');return;}
  const controller=new AbortController();setLoading(true);setMembers([]);setError('');
  const timer=setTimeout(()=>{
   void fetch(`/api/chat/dm-members?q=${encodeURIComponent(query)}`,{cache:'no-store',signal:controller.signal})
    .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'Member search is unavailable.');return data.members as Member[];})
    .then(rows=>{if(!controller.signal.aborted)setMembers(rows);})
    .catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Member search is unavailable.');})
    .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  },query?200:0);
  return()=>{clearTimeout(timer);controller.abort();};
 },[open,query,retry,searchable]);
 function select(member:Member){chosen.current=true;dialog.current?.close();onSelect({id:member.id,name:member.display_name});}
 return <div className={styles.wrapper}>
  <button ref={trigger} type="button" className={styles.launch} aria-haspopup="dialog" onClick={()=>{chosen.current=false;setQuery('');setMembers([]);setError('');setOpen(true);}}>＋ Start New DM</button>
  <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();dialog.current?.close();}}} onCancel={event=>event.stopPropagation()} onClose={()=>{setOpen(false);if(!chosen.current)trigger.current?.focus({preventScroll:true});}} onClick={event=>{if(event.target===event.currentTarget)dialog.current?.close();}}>
   <div className={styles.content}>
    <header><h2 id={titleId}>Start New DM</h2><button type="button" aria-label="Close member search" onClick={()=>dialog.current?.close()}>×</button></header>
    <p>Choose a member to open your conversation or write a message request.</p>
    <label htmlFor={inputId}>Search chat names</label>
    <input id={inputId} type="search" autoFocus maxLength={28} value={query} aria-controls={resultsId} placeholder="Find a member…" onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();results.current?.querySelector('button')?.focus();}}}/>
    <p className={styles.status} role={error?'alert':'status'}>{error|| (!searchable?'Type at least 2 characters to find a member.':loading?'Finding members…':members.length?`${members.length} member${members.length===1?'':'s'}${members.length===20?' · Search to narrow the list':''}`:'No members found. Try another chat name.')}</p>
    {error&&<button className={styles.retry} type="button" onClick={()=>setRetry(value=>value+1)}>Retry search</button>}
    <ul id={resultsId} ref={results} className={styles.results} aria-label="Members" aria-busy={loading} onKeyDown={event=>{
     if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
     const buttons=Array.from(results.current?.querySelectorAll('button')??[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(index<0)return;
     event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?Math.min(index+1,buttons.length-1):Math.max(index-1,0);buttons[next]?.focus();
    }}>{members.map(member=><li key={member.id}><button type="button" onClick={()=>select(member)}>{member.display_name}</button></li>)}</ul>
    <p className={styles.note}>Only registered chat names are listed. Selecting someone does not send a message.</p>
   </div>
  </dialog>
 </div>;
}
