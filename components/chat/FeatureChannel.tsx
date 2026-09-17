'use client';
import { chatTimestamp, chatTimestampTitle } from "@/lib/chatTimestamp";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import FeatureNotifications from './FeatureNotifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './FeatureChannel.module.css';
type Release={pr_number:number;head_sha:string;version:number;state:'ready'|'approved'|'publishing'|'failed'|'published';approved_at:string|null;outcome:string|null};
type Request={priority:number;priority_revision:number;release?:Release|null;id:string;title:string;proposal:string;revision:number;approved_proposal:string|null;status:string;claimed_at?:string|null;outcome:string|null};
const priorities=[{value:0,label:'Emergency'},{value:1,label:'1 · High'},{value:2,label:'2 · Medium'},{value:3,label:'3 · Low'}];
const priorityLabel=(value:number)=>priorities.find(p=>p.value===value)?.label??'2 · Medium';
const statusLabels:Record<string,string>={discussion:'Discussion · pending',approved:'Approved · awaiting pickup',in_progress:'Codex is working on this',ready:'Ready for review',done:'Published and verified',blocked:'Blocked · needs attention',declined:'Declined',archived:'Archived',publish_approved:'Approved for publishing · awaiting pickup',publishing:'Publishing · verification in progress',publish_failed:'Publishing failed · needs attention'};
const displayStatus=(request:Request)=>request.status==='ready'&&request.release?({approved:'publish_approved',publishing:'publishing',failed:'publish_failed',published:'done',ready:'ready'}[request.release.state]):request.status;
type Message={id:string;author_label:string;kind:string;body:string;created_at:string};
export default function FeatureChannel({ initialRequestId = '', initialView = 'active' }: { initialRequestId?: string; initialView?:'active'|'archive' }){
 const router=useRouter();
 const [theme,setTheme]=useState<'dark'|'light'>('dark');
 useEffect(()=>{
  try { const saved=localStorage.getItem('longboard-feature-theme'); if(saved==='light'||saved==='dark') setTheme(saved); } catch { /* Storage may be disabled; the toggle still works. */ }
 },[]);
 function toggleTheme(){
  const next=theme==='dark'?'light':'dark';
  setTheme(next);
  try { localStorage.setItem('longboard-feature-theme',next); } catch { /* Keep the current session usable without persistence. */ }
 }

 const [view,setView]=useState<'active'|'archive'>(initialView);
 const [requests,setRequests]=useState<Request[]>([]),[messages,setMessages]=useState<Message[]>([]);
 const [selected,setSelected]=useState(initialRequestId),[role,setRole]=useState(''),[title,setTitle]=useState(''),[draft,setDraft]=useState('');
 const [proposal,setProposal]=useState(''),[editRevision,setEditRevision]=useState(0),[editing,setEditing]=useState(false);
 const [newPriority,setNewPriority]=useState(2);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{setView(initialView);setSelected(initialRequestId);setMessages([]);setDraft('');setEditing(false);},[initialRequestId,initialView]);
 useEffect(()=>{if(!notice.startsWith('Priority saved'))return;const timer=setTimeout(()=>setNotice(''),2000);return()=>clearTimeout(timer);},[notice]);
 const currentId=useRef(selected); currentId.current=selected;
 const currentView=useRef(view); currentView.current=view;
 const loadGeneration=useRef(0);
 const current=requests.find(r=>r.id===selected);
 const load=useCallback(async()=>{
  const id=selected;
  const generation=++loadGeneration.current;
  const response=await fetch(`/api/chat/features?view=${view}${id?`&id=${id}`:''}`,{cache:'no-store'});
  const data=await response.json();
  if(!response.ok) throw new Error('The private channel is unavailable. Please sign in again or retry.');
  if(currentId.current!==id||currentView.current!==view||generation!==loadGeneration.current) return;
  setView(data.view);setRequests(data.requests);setMessages(data.messages);setRole(data.role);
 },[selected,view]);
 useEffect(()=>{void load().catch(e=>setError(e.message));const timer=setInterval(()=>void load().catch(e=>setError(e.message)),8000);return()=>clearInterval(timer);},[load]);
 useEffect(()=>{
  let stopped=false;
  let generation=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let controller:AbortController|undefined;
  const refresh=async()=>{
   if(stopped || document.visibilityState!=='visible') return;
   const version=generation;
   controller=new AbortController();
   try{
    const response=await fetch(`/api/chat/features?statusOnly=1&view=${view}`,{cache:'no-store',signal:controller.signal});
    if(!response.ok) return;
    const data=await response.json();
    if(stopped || version!==generation) return;
    const statuses=new Map<string,string>(data.statuses.map((r:{id:string;status:string})=>[r.id,r.status]));
    setRequests(previous=>previous.map(r=>statuses.has(r.id)&&statuses.get(r.id)!==r.status?{...r,status:statuses.get(r.id)!}:r));
   }catch { /* The full channel refresh reports availability errors. */ }
   finally {if(!stopped && version===generation && document.visibilityState==='visible') timer=setTimeout(()=>void refresh(),2000);}
  };
  const visibility=()=>{generation++;clearTimeout(timer);controller?.abort();if(document.visibilityState==='visible') void refresh();};
  void refresh();
  document.addEventListener('visibilitychange',visibility);
  return()=>{stopped=true;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',visibility);};
 },[view]);
 async function act(action:string,content='',revision=current?.revision,release?:Release,priority?:number){
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/chat/features',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:selected||undefined,content,revision,...(action==='create'?{priority:newPriority}:{}),...(action==='priority'?{priority,priorityRevision:current?.priority_revision}:{}),...(release?{confirmed:true,releaseVersion:release.version,headSha:release.head_sha}:{})})});
   const data=await response.json();if(!response.ok) throw new Error(data.error||'Unable to save.');
   if(action==='create'){setSelected(data.id);router.replace(`/chat/features?request=${data.id}`,{scroll:false});setTitle('');setEditing(false);}
   if(action==='archive'){
    setRequests(previous=>previous.filter(request=>request.id!==selected));setSelected('');setMessages([]);setDraft('');setEditing(false);
    router.replace('/chat/features',{scroll:false});setNotice('Ticket archived. Codex will not pick it up.');
   }
   if(action==='priority')setNotice('Priority saved. The queue has been reordered.');
   if(action==='message')setDraft('');
   if(action==='proposal')setEditing(false);
   await load();
   if(data.assistantError)setError('Your message was saved, but Codex could not reply. Send another message to retry.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to save.');}finally{setBusy(false);}
 }
 return <main className={styles.shell} data-feature-theme={theme}>
  <header className={styles.header}><Link href='/chat'>← Chat</Link><div><h1>Feature requests</h1><p>Private · Rob, Jammie & Codex</p></div><span className={styles.badge}>INVITE ONLY</span><button type="button" className={styles.themeToggle} aria-label="Light mode" aria-pressed={theme==='light'} onClick={toggleTheme}>{theme==='light'?'☀ Light mode':'☾ Dark mode'}</button><FeatureNotifications requestId={selected || undefined}/></header>
  {error&&<p role='alert' className={styles.error}>{error}</p>}
  {notice&&<p role='status' className={notice.startsWith('Priority saved')?styles.priorityNotice:styles.notice}>{notice}</p>}
  <div className={styles.layout}><aside className={styles.sidebar}>
   <form onSubmit={e=>{e.preventDefault();void act('create',title);}}><label htmlFor='feature-title'>New feature request</label><input id='feature-title' maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} placeholder='What could be better?' required/>{role==='owner'&&<label>New ticket priority<select aria-label='New ticket priority' value={newPriority} onChange={e=>setNewPriority(Number(e.target.value))}>{priorities.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></label>}<button disabled={busy||!title.trim()}>Start discussion</button></form>
   <div className={styles.viewTabs} role='group' aria-label='Ticket views'>{(['active','archive'] as const).map(value=><button key={value} type='button' disabled={busy} aria-pressed={view===value} onClick={()=>{setSelected('');setRequests([]);setMessages([]);setDraft('');setEditing(false);setView(value);router.replace(`/chat/features?view=${value}`,{scroll:false});}}>{value==='active'?'Active':'Archive'}</button>)}</div>
   {view==='archive'&&<p className={styles.archiveHint}>Published and verified tickets move here automatically. Their history is preserved.</p>}
   <nav aria-label='Feature requests'>{requests.map(r=><button key={r.id} data-status={displayStatus(r)} data-glow={displayStatus(r)} disabled={busy} aria-current={selected===r.id?'page':undefined} onClick={()=>{setSelected(r.id);router.replace(`/chat/features?view=${view}&request=${r.id}`,{scroll:false});setMessages([]);setDraft('');setEditing(false);}}><strong>{r.title}</strong><span className={styles.priorityBadge} data-emergency={r.priority===0}>{priorityLabel(r.priority)}</span><small>{statusLabels[displayStatus(r)]||r.status.replaceAll('_',' ')}</small></button>)}</nav>
  </aside><section className={styles.thread}>
   {!current?<div className={styles.empty}><h2>{view==='archive'?'Archived tickets':'A place to shape what comes next.'}</h2>{view==='archive'?<p>Select a ticket to read its proposal and discussion history.</p>:<><p>Start a request and discuss it together. Codex replies to each discussion message—no tag needed.</p><p>Rob approves the final proposal before development begins.</p></>}</div>:<>
    <div className={styles.threadHeading}><h2>{current.title}</h2><span className={styles.badge} data-status={displayStatus(current)}>{statusLabels[displayStatus(current)]||current.status.replaceAll('_',' ')}</span></div>
    <div className={styles.priorityControl}>
     {role==='owner'&&!['done','archived','declined'].includes(current.status)?<label>Ticket priority<select aria-label='Ticket priority' disabled={busy} value={current.priority} onChange={e=>void act('priority','',current.revision,undefined,Number(e.target.value))}>{priorities.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></label>:<span className={styles.priorityBadge} data-emergency={current.priority===0}>{priorityLabel(current.priority)}</span>}
     <small>Emergency first, then 1, 2, 3. Newly assigned priorities lead their tier. Current work finishes publishing before the next pickup.</small>
    </div>
    <div className={styles.messages} aria-live='polite'>{messages.length===0?<p>Describe the idea below. Codex replies automatically; no @Codex tag is needed.</p>:messages.map(m=><article key={m.id} className={m.kind==='assistant'?styles.assistant:styles.message}><div><strong>{m.author_label}</strong><time dateTime={m.created_at} title={chatTimestampTitle(m.created_at)}>{chatTimestamp(m.created_at)}</time></div><p>{m.body}</p></article>)}</div>
    {current.status!=='archived'&&<form className={styles.composer} onSubmit={e=>{e.preventDefault();void act('message',draft);}}><label htmlFor='feature-message'>Discuss this request</label><textarea id='feature-message' value={draft} maxLength={12000} onChange={e=>setDraft(e.target.value)} placeholder='Share your thoughts—Codex will reply…' required/><button disabled={busy||!draft.trim()}>{busy?'Saving / waiting for reply…':'Send message'}</button></form>}
    <section className={styles.proposal}><h3>{current.approved_proposal?'Approved scope':'Proposal for development'}</h3>
    {editing?<><label htmlFor='feature-proposal'>Scope and acceptance criteria</label><textarea id='feature-proposal' value={proposal} maxLength={12000} onChange={e=>setProposal(e.target.value)}/><button disabled={busy} onClick={()=>void act('proposal',proposal,editRevision)}>Save proposal</button><button disabled={busy} onClick={()=>setEditing(false)}>Cancel</button></>:<><p>{current.approved_proposal||current.proposal||'After discussing the idea, write the exact change and how we will know it works.'}</p>{current.status==='discussion'&&<button disabled={busy} onClick={()=>{setProposal(current.proposal);setEditRevision(current.revision);setEditing(true);}}>Edit proposal</button>}</>}
    {role==='owner'&&current.status==='discussion'&&!editing&&<div className={styles.actions}><button disabled={busy||!current.proposal.trim()} onClick={()=>void act('approve')}>Approve for development</button><button disabled={busy} onClick={()=>void act('decline')}>Decline</button></div>}
    {role==='owner'&&['discussion','approved'].includes(current.status)&&!current.claimed_at&&!current.release&&<div className={styles.archiveAction}>
     <button type='button' disabled={busy} onClick={()=>void act('archive')}>Archive ticket</button>
     <small>Remove this ticket from the queue before pickup. Its discussion history is kept.</small>
    </div>}
    {current.status==='ready'&&<section aria-label='Publishing' className={styles.release}>
     <h3>Publish to the live site</h3>
     {current.release?<>
      <p>Version {current.release.version} · <a href={`https://github.com/robbooker/longboard/pull/${current.release.pr_number}`} target='_blank' rel='noreferrer'>Code review #{current.release.pr_number}</a></p>
      {current.release.state==='ready'&&<p>Development is complete. Rob can approve this version for the worker to merge and publish.</p>}
      {current.release.state==='approved'&&<p role='status'>Approved for publishing. Waiting for the next worker pickup; the site has not changed yet.</p>}
      {current.release.state==='publishing'&&<p role='status'>The worker is publishing this version and checking the live site.</p>}
      {current.release.state==='failed'&&<p role='status'>Publishing could not finish. {current.release.outcome} Review the issue before approving another attempt.</p>}
      {role==='owner'&&['ready','failed'].includes(current.release.state)&&<button disabled={busy} onClick={()=>{
       const release=current.release!;
       if(window.confirm(`Publish “${current.title}” to the live Longboard site?\n\nThis approves merging and publishing version ${release.version} (PR #${release.pr_number}, commit ${release.head_sha.slice(0,7)}). The worker will pick it up, deploy it and verify it. Any code changes require a new approval.\n\nConfirm merge and publish?`)) void act('approve_release','',current.revision,release);
      }}>{current.release.state==='failed'?'Approve retry: merge & publish':'Approve merge & publish'}</button>}
     </>:<p>The worker must attach an exact release version before publishing can be approved here.</p>}
    </section>}
    <small>Approval saves this exact proposal. Publishing is a separate decision.</small>
    {current.outcome&&<p>{current.outcome}</p>}
    </section>
   </>}
  </section></div>
 </main>;
}
