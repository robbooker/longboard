'use client';
import {useEffect,useRef,useState} from 'react';
import {isAnnouncementRoom} from '@/lib/publicChat';
import type {ChatActivity} from '@/lib/chatActivity';
import styles from './ChatActivityBell.module.css';
const labels={main:'LB',social:'SOCIAL',shortscout:'SS','lb-announcements':'LB ANNOUNCEMENT','ss-announcements':'SS ANNOUNCEMENT',gainers:'GAINERS'};
export default function ChatActivityBell({data,error,read}:{data:ChatActivity;error:string;read:(body:Record<string,unknown>)=>Promise<void>}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[failure,setFailure]=useState('');
 const root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null);
 const total=data.mentionCount+data.dmCount;
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open]);
 async function act(body:Record<string,unknown>,after?:()=>void){
  setBusy(true);setFailure('');try{await read(body);after?.();}catch(e){setFailure(e instanceof Error?e.message:'Could not mark read.');}finally{setBusy(false);}
 }
 return <div className={styles.root} ref={root}>
  <button ref={button} type='button' className={styles.bell} aria-label={`Chat notifications, ${data.mentionCount} room alerts, ${data.dmCount} unread DMs`} aria-expanded={open} onClick={()=>setOpen(!open)}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' aria-hidden='true'><path d='M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4'/></svg>{total>0&&<span className={styles.badge}>{total>99?'99+':total}</span>}</button>
  {open&&<section className={styles.panel} aria-label='Chat notifications'>
   <header><strong>Chat notifications</strong><button aria-label='Close chat notifications' onClick={()=>{setOpen(false);button.current?.focus();}}>×</button></header>
   <p role='status'>{data.mentionCount} room alerts · {data.dmCount} unread DMs</p>
   {(error||failure)&&<p role='alert'>{failure||error}</p>}
   <button disabled={busy||!total} onClick={()=>void act({kind:'all',mentionThrough:data.mentionThrough,dmThrough:data.dmThrough})}>Mark all as read</button>
   <label className={styles.preferences}><input type='checkbox' checked={data.replyNotifications!==false} disabled={busy} onChange={e=>void act({kind:'preferences',replies:e.target.checked})}/> Reply alerts in this inbox</label><p>Notify me when someone replies to a conversation I started or joined. This setting affects future alerts; existing alerts stay in your inbox.</p>
   <h3>Room alerts <span className={styles.badge}>{data.mentionCount}</span></h3>
   {!data.mentions.length&&<p>No unread room alerts.</p>}
   {data.mentions.map(n=><article key={n.id}>
    <button className={styles.open} disabled={busy} onClick={()=>void act({kind:'mention',id:n.id,mentionThrough:n.seq},()=>{window.location.href=`/chat?room=${n.room}#chat-message-${n.messageId}`;})}><strong>{labels[n.room]} · {n.category==='reply'?`${n.author} replied to your conversation`:isAnnouncementRoom(n.room)?`${n.author} posted an announcement`:`${n.author} mentioned you`}</strong>{n.category==='reply'&&<span>In reply to: {n.parentPreview||'An attachment or deleted message'}</span>}<span>{n.preview||'Shared an attachment'}</span></button>
    <button disabled={busy} onClick={()=>void act({kind:'mention',id:n.id,mentionThrough:n.seq})}>Mark as read</button>
   </article>)}
   <h3>Direct messages <span className={styles.badge}>{data.dmCount}</span></h3>
   {!data.dms.length&&<p>No unread direct messages.</p>}
   {data.dms.map(dm=><article key={dm.id}>
    <button className={styles.open} disabled={busy} onClick={()=>void act({kind:'dm',id:dm.id,dmThrough:dm.throughSeq},()=>{setOpen(false);window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:dm.id}));})}><strong>{dm.name} <span className={styles.badge}>{dm.unread}</span></strong><span>{dm.pending?'New message request':'Open conversation'}</span></button>
    <button disabled={busy} onClick={()=>void act({kind:'dm',id:dm.id,dmThrough:dm.throughSeq})}>Mark as read</button>
   </article>)}
  </section>}
 </div>;
}
