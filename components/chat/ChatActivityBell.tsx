'use client';
import {useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import {isAnnouncementRoom,isRecordingRoom} from '@/lib/publicChat';
import type {ChatActivity,ChatReactionNotification} from '@/lib/chatActivity';
import {CHAT_REACTION_LABELS} from '@/lib/chatMessageReactions';
import styles from './ChatActivityBell.module.css';
const labels={main:'LB',social:'SOC','shortscout':'SS','lb-announcements':'LB ANN','ss-announcements':'SS ANN',gainers:'GAINERS','lb-recordings':'LB REC','ss-recordings':'SS REC'};
function ReactionIcon({notification:n}:{notification:ChatReactionNotification}){
 return <span className={styles.reactionIcon} aria-hidden="true">{n.emoji==='rob'?<Image src="/chat/reactions/rob.png" alt="" width={22} height={22} sizes="22px"/>:n.emoji==='heart'?'❤️':n.emoji==='laugh'?'😂':n.kind==='dm'?'👍':n.room==='shortscout'||n.room.startsWith('ss-')?'🍋':'🌴'}</span>;
}
export default function ChatActivityBell({data,error,read}:{data:ChatActivity;error:string;read:(body:Record<string,unknown>)=>Promise<void>}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[failure,setFailure]=useState('');
 const root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null);
 const reactionCount=data.reactionCount??0;
 const total=data.mentionCount+data.dmCount+reactionCount;
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
 function revisit(isRead:boolean,body:Record<string,unknown>,open:()=>void){if(isRead)open();else void act(body,open);}
 return <div className={styles.root} ref={root}>
  <button ref={button} type='button' className={styles.bell} aria-label={`Chat notifications, ${data.mentionCount} room alerts, ${data.dmCount} unread DMs, ${reactionCount} reactions`} aria-expanded={open} onClick={()=>setOpen(!open)}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' aria-hidden='true'><path d='M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4'/></svg>{total>0&&<span className={styles.badge}>{total>99?'99+':total}</span>}</button>
  {open&&<section className={styles.panel} aria-label='Chat notifications'>
   <header><strong>Chat notifications</strong><button aria-label='Close chat notifications' onClick={()=>{setOpen(false);button.current?.focus();}}>×</button></header>
   <p role='status'>{data.mentionCount} room alerts · {data.dmCount} unread DMs · {reactionCount} reactions</p>
   {(error||failure)&&<p role='alert'>{failure||error}</p>}
   <button disabled={busy||!total} onClick={()=>void act({kind:'all',mentionThrough:data.mentionThrough,dmThrough:data.dmThrough,reactionThrough:data.reactionThrough??0})}>Mark all as read</button>
   <label className={styles.preferences}><input type='checkbox' checked={data.replyNotifications!==false} disabled={busy} onChange={e=>void act({kind:'preferences',replies:e.target.checked})}/> Reply alerts in this inbox</label><p>Notify me when someone replies to a conversation I started or joined. This setting affects future alerts; existing alerts stay in your inbox.</p>
   <h3>Room alerts <span className={styles.badge}>{data.mentionCount}</span></h3>
   {!data.mentions.length&&<p>{data.mentionCount?'Older room alerts are not shown here.':'No recent room alerts.'}</p>}
   {data.mentions.map(n=><article key={n.id} data-unread={!n.read}>
    <button className={styles.open} disabled={busy} onClick={()=>revisit(n.read===true,{kind:'mention',id:n.id,mentionThrough:n.seq},()=>{window.location.href=`/chat?room=${n.room}#chat-message-${n.messageId}`;})}><strong>{labels[n.room]} – {n.author} – {n.category==='reply'?'replied':isRecordingRoom(n.room)?'posted a recording':isAnnouncementRoom(n.room)?'posted an announcement':'mentioned you'}</strong><span className={styles.preview}>{n.preview||'Shared an attachment'}</span>{n.category==='reply'&&<span className={styles.context}>Reply to: {n.parentPreview||'An attachment or deleted message'}</span>}</button>
    {n.read?<span className={styles.read}>Read</span>:<button disabled={busy} onClick={()=>void act({kind:'mention',id:n.id,mentionThrough:n.seq})}>Mark as read</button>}
   </article>)}
   <h3>Direct messages <span className={styles.badge}>{data.dmCount}</span></h3>
   {!data.dms.length&&<p>{data.dmCount?'Older direct messages are not shown here.':'No recent direct messages.'}</p>}
   {data.dms.map(dm=><article key={dm.id} data-unread={dm.unread>0}>
    <button className={styles.open} disabled={busy} onClick={()=>revisit(dm.unread===0,{kind:'dm',id:dm.id,dmThrough:dm.throughSeq},()=>{setOpen(false);window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:dm.id}));})}><strong>DM – {dm.name} – {dm.pending?'sent a request':'sent a message'} {dm.unread>0&&<span className={styles.badge}>{dm.unread}</span>}</strong><span className={styles.preview}>{dm.preview||'Open conversation'}</span></button>
    {dm.unread===0?<span className={styles.read}>Read</span>:<button disabled={busy} onClick={()=>void act({kind:'dm',id:dm.id,dmThrough:dm.throughSeq})}>Mark as read</button>}
   </article>)}
   <h3>Reactions <span className={styles.badge}>{reactionCount}</span></h3>
   {!(data.reactions??[]).length&&<p>{reactionCount?'Older reaction alerts are not shown here.':'No recent reaction alerts.'}</p>}
   {(data.reactions??[]).map(n=><article key={n.id} data-unread={!n.read}>
    <button className={styles.open} disabled={busy} onClick={()=>revisit(n.read===true,{kind:'reaction',id:n.id,reactionThrough:n.seq},()=>{if(n.kind==='room')window.location.href=`/chat?room=${n.room}#chat-message-${n.messageId}`;else{setOpen(false);window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:n.conversationId}));}})}><strong>{n.kind==='room'?labels[n.room]:'DM'} – {n.author} – reacted <ReactionIcon notification={n}/><span className={styles.reactionLabel}>{CHAT_REACTION_LABELS[n.emoji]}</span></strong><span className={styles.preview}>{n.preview||'Shared an attachment'}</span><span className={styles.context}>Reaction to your message</span></button>
    {n.read?<span className={styles.read}>Read</span>:<button disabled={busy} onClick={()=>void act({kind:'reaction',id:n.id,reactionThrough:n.seq})}>Mark as read</button>}
   </article>)}
  </section>}
 </div>;
}
