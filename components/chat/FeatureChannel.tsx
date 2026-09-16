'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './FeatureChannel.module.css';
type Request={id:string;title:string;proposal:string;revision:number;approved_proposal:string|null;status:string;outcome:string|null};
type Message={id:string;author_label:string;kind:string;body:string;created_at:string};
export default function FeatureChannel(){
 const [requests,setRequests]=useState<Request[]>([]),[messages,setMessages]=useState<Message[]>([]);
 const [selected,setSelected]=useState(''),[role,setRole]=useState(''),[title,setTitle]=useState(''),[draft,setDraft]=useState('');
 const [proposal,setProposal]=useState(''),[editRevision,setEditRevision]=useState(0),[editing,setEditing]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const currentId=useRef(selected); currentId.current=selected;
 const current=requests.find(r=>r.id===selected);
 const load=useCallback(async()=>{
  const id=selected;
  const response=await fetch(`/api/chat/features${id?`?id=${id}`:''}`,{cache:'no-store'});
  const data=await response.json();
  if(!response.ok) throw new Error('The private channel is unavailable. Please sign in again or retry.');
  if(currentId.current!==id) return;
  setRequests(data.requests);setMessages(data.messages);setRole(data.role);
 },[selected]);
 useEffect(()=>{void load().catch(e=>setError(e.message));const timer=setInterval(()=>void load().catch(e=>setError(e.message)),8000);return()=>clearInterval(timer);},[load]);
 async function act(action:string,content='',revision=current?.revision){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/chat/features',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:selected||undefined,content,revision})});
   const data=await response.json();if(!response.ok) throw new Error(data.error||'Unable to save.');
   if(action==='create'){setSelected(data.id);setTitle('');setEditing(false);}
   if(action==='message')setDraft('');
   if(action==='proposal')setEditing(false);
   await load();
   if(data.assistantError)setError('Your message was saved, but Codex could not reply. Send another @Codex message to retry.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to save.');}finally{setBusy(false);}
 }
 return <main className={styles.shell}>
  <header className={styles.header}><Link href='/chat'>← Chat</Link><div><h1>Feature requests</h1><p>Private · Rob, Jammie & Codex</p></div><span className={styles.badge}>INVITE ONLY</span></header>
  {error&&<p role='alert' className={styles.error}>{error}</p>}
  <div className={styles.layout}><aside className={styles.sidebar}>
   <form onSubmit={e=>{e.preventDefault();void act('create',title);}}><label htmlFor='feature-title'>New feature request</label><input id='feature-title' maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} placeholder='What could be better?' required/><button disabled={busy||!title.trim()}>Start discussion</button></form>
   <nav aria-label='Feature requests'>{requests.map(r=><button key={r.id} disabled={busy} aria-current={selected===r.id?'page':undefined} onClick={()=>{setSelected(r.id);setMessages([]);setDraft('');setEditing(false);}}><strong>{r.title}</strong><small>{r.status.replaceAll('_',' ')}</small></button>)}</nav>
  </aside><section className={styles.thread}>
   {!current?<div className={styles.empty}><h2>A place to shape what comes next.</h2><p>Start a request, discuss it together, and mention @Codex for help defining the details.</p><p>Rob approves the final proposal before development begins.</p></div>:<>
    <div className={styles.threadHeading}><h2>{current.title}</h2><span className={styles.badge}>{current.status.replaceAll('_',' ')}</span></div>
    <div className={styles.messages} aria-live='polite'>{messages.length===0?<p>Describe the idea below. Mention @Codex when you want a reply.</p>:messages.map(m=><article key={m.id} className={m.kind==='assistant'?styles.assistant:styles.message}><div><strong>{m.author_label}</strong><time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString()}</time></div><p>{m.body}</p></article>)}</div>
    <form className={styles.composer} onSubmit={e=>{e.preventDefault();void act('message',draft);}}><label htmlFor='feature-message'>Discuss this request</label><textarea id='feature-message' value={draft} maxLength={12000} onChange={e=>setDraft(e.target.value)} placeholder='Share your thoughts, or ask @Codex…' required/><button disabled={busy||!draft.trim()}>{busy?'Saving / waiting for reply…':'Send message'}</button></form>
    <section className={styles.proposal}><h3>{current.approved_proposal?'Approved scope':'Proposal for development'}</h3>
    {editing?<><label htmlFor='feature-proposal'>Scope and acceptance criteria</label><textarea id='feature-proposal' value={proposal} maxLength={12000} onChange={e=>setProposal(e.target.value)}/><button disabled={busy} onClick={()=>void act('proposal',proposal,editRevision)}>Save proposal</button><button disabled={busy} onClick={()=>setEditing(false)}>Cancel</button></>:<><p>{current.approved_proposal||current.proposal||'After discussing the idea, write the exact change and how we will know it works.'}</p>{current.status==='discussion'&&<button disabled={busy} onClick={()=>{setProposal(current.proposal);setEditRevision(current.revision);setEditing(true);}}>Edit proposal</button>}</>}
    {role==='owner'&&current.status==='discussion'&&!editing&&<div className={styles.actions}><button disabled={busy||!current.proposal.trim()} onClick={()=>void act('approve')}>Approve for development</button><button disabled={busy} onClick={()=>void act('decline')}>Decline</button></div>}
    <small>Approval saves this exact proposal. Publishing is a separate decision.</small>
    {current.outcome&&<p>{current.outcome}</p>}
    </section>
   </>}
  </section></div>
 </main>;
}
