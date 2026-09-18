'use client';
import { chatTimestamp,chatTimestampTitle } from '@/lib/chatTimestamp';
import type { ChatRoom,PublicChatMessage } from '@/lib/publicChat';
import { FormEvent,useEffect,useRef,useState } from 'react';
import { AttachmentPicker,ChatAttachments } from './ChatAttachments';
import MentionTextarea from './MentionTextarea';
import MessageReactions from './MessageReactions';
import MessageActions from './MessageActions';
import { useChatUpdates } from './ChatUpdates';
import { useAttachments } from './hooks/useAttachments';
import styles from './PublicChat.module.css';
export type ReplyDraft={body:string;scroll:number};
export default function ChatReplyPanel({messageId,memberId,room,paused,readOnly=false,depth,draft,onBack,onOpen,onClose,onSent}:{messageId:string;memberId?:string;room:ChatRoom;paused:boolean;readOnly?:boolean;depth:number;draft:ReplyDraft;onBack:()=>void;onOpen:(id:string)=>void;onClose:()=>void;onSent:(message:PublicChatMessage)=>void}){
 const updates=useChatUpdates();
 const [parent,setParent]=useState<PublicChatMessage|null>(null),[replies,setReplies]=useState<PublicChatMessage[]>([]),[body,setBody]=useState(draft.body),[error,setError]=useState(''),[busy,setBusy]=useState(false),[more,setMore]=useState(false);
 const uploads=useAttachments(room);
 const revision=useRef(0);
 const retry=useRef<{key:string;id:string}|null>(null);
 const input=useRef<HTMLTextAreaElement>(null);
 const panel=useRef<HTMLElement>(null);
 const contents=useRef<HTMLDivElement>(null);
 const sending=useRef(false);
 const restoreFocus=useRef(false);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  let cancelled=false;let running=false;
  const load=async()=>{if(running||sending.current)return;running=true;const version=revision.current;try{
   const path=`/api/chat/thread?room=${room}&messageId=${messageId}`;const response=await (updates?updates.read(path):fetch(path,{cache:"no-store"}));const data=await response.json();
   if(cancelled||sending.current||version!==revision.current)return;if(!response.ok){if(response.status===404){setParent(null);setReplies([]);}throw Error(data.error||'Could not load replies.');}
   setParent(data.parent);setReplies(data.replies);setMore(data.hasMore);setError('');
  }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Could not load replies.');}finally{running=false;}};
  const stop=updates?.watch(load,["room"],true);if(!updates)void load();
  return()=>{cancelled=true;stop?.();};
 },[messageId,room,updates]);
 useEffect(()=>{
  if(!parent?.id)return;
  input.current?.focus({preventScroll:true});
  if(contents.current)contents.current.scrollTop=draft.scroll;
 },[parent?.id,draft]);
 useEffect(()=>{
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))onClose();};
  window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);
 },[onClose]);
 useEffect(()=>{
  if(busy||!restoreFocus.current)return;
  restoreFocus.current=false;
  // Restore after React re-enables the input, without stealing focus if the
  // member moved to another part of the app while the request was pending.
  if(document.activeElement===document.body||panel.current?.contains(document.activeElement))input.current?.focus({preventScroll:true});
 },[busy]);
 function edited(message:PublicChatMessage){
  revision.current++;
  setParent(current=>current?.id===message.id?message:current);
  setReplies(current=>current.map(reply=>reply.id===message.id?message:reply));
  onSent(message);
  updates?.invalidate('room');
 }
 function actions(message:PublicChatMessage){
  return message.member_id===memberId&&!!memberId&&!readOnly ? <MessageActions message={message} room={room} own admin={false} paused={paused} editOnly onEdited={edited} onDeleted={()=>{}}/> : null;
 }
 async function send(event:FormEvent){
  event.preventDefault();if((!body.trim()&&!uploads.ids.length)||uploads.blocked||sending.current||busy||paused||readOnly||!parent)return;setBusy(true);sending.current=true;setError('');
  const key=JSON.stringify([body.trim(),uploads.ids,messageId]);if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};
  try{const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',room,body:body.trim(),replyTo:messageId,attachmentIds:uploads.ids,clientId:retry.current.id})});const result=await response.json();if(!response.ok)throw Error(result.message||result.error||'Could not send reply.');
   setReplies(current=>[...current.filter(m=>m.id!==result.message.id),result.message,...(result.buddy?.reply_to_id===messageId?[result.buddy]:[])]);onSent(result.message);if(result.buddy)onSent(result.buddy);updates?.invalidate('room','activity');draft.body='';uploads.clear();retry.current=null;if(mounted.current)setBody('');
  }catch(e){setError(e instanceof Error?e.message:'Could not send reply.');}finally{sending.current=false;if(mounted.current){restoreFocus.current=true;setBusy(false);}}
 }
 return <aside ref={panel} className={styles.replyPanel} aria-label='Comment replies' onKeyDown={event=>{
  if(document.querySelector('dialog[open]'))return;
  if(event.key==='Escape'){event.stopPropagation();onClose();return;}
  if(event.key!=='Tab'||!window.matchMedia('(max-width:1099px)').matches)return;
  const controls=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),a[href],summary' )??[]).filter(control=>control.getClientRects().length>0);
  const first=controls[0],last=controls[controls.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }}>
  <header><button type='button' onClick={onBack} aria-label={depth>1?'Back to previous comment':'Back to chat'}>← {depth>1?'Back':'Chat'}</button><h2>Replies</h2><button type='button' onClick={onClose} aria-label='Close replies'>×</button></header>
  <div ref={contents} className={styles.replyContents} onScroll={event=>{draft.scroll=event.currentTarget.scrollTop;}}>
   {!parent&&!error&&<p role="status">Loading conversation…</p>}
   {parent&&<article className={styles.replyOriginal} aria-label='Original comment'><div className={styles.messageIdentity}><strong>{parent.author_label}</strong><time dateTime={parent.created_at} title={chatTimestampTitle(parent.created_at)}>{chatTimestamp(parent.created_at)}{parent.edited_at?' · edited':''}</time>{actions(parent)}</div><p>{parent.body}</p><ChatAttachments room={room} ids={parent.attachment_ids}/><MessageReactions target={{kind:"room",room,messageId:parent.id}} disabled={paused||!memberId}/></article>}
   {error&&<p role='alert'>{error}</p>}
   <div aria-live='polite' aria-label='Replies to this comment'>{more&&<p>Showing the latest 100 replies.</p>}{parent&&!replies.length&&<p>No replies yet.</p>}{replies.map(reply=><article key={reply.id} className={styles.threadReply}><div className={styles.messageIdentity}><strong>{reply.author_label}</strong><time dateTime={reply.created_at} title={chatTimestampTitle(reply.created_at)}>{chatTimestamp(reply.created_at)}{reply.edited_at?' · edited':''}</time>{actions(reply)}</div><p>{reply.body}</p><ChatAttachments room={room} ids={reply.attachment_ids}/><MessageReactions target={{kind:"room",room,messageId:reply.id}} disabled={paused||!memberId}/><button type='button' className={styles.replyButton} onClick={()=>onOpen(reply.id)}>↳ Reply / view conversation</button></article>)}</div>
   {readOnly&&<p>Only admins can reply in this announcement channel.</p>}
   {parent&&!readOnly&&<form onSubmit={send}><label htmlFor='thread-reply'>Reply to {parent.author_label}</label><AttachmentPicker uploads={uploads} disabled={busy||paused||readOnly}/><MentionTextarea enabled={!!memberId&&!paused&&!readOnly&&!busy} buddyEnabled={room==='main'} listClassName={styles.replyMentionList} aria-describedby='thread-reply-help' onKeyDown={event=>{
    if(event.key!=='Enter'||event.shiftKey||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;
    event.preventDefault();
    if(!event.repeat&&!sending.current)event.currentTarget.form?.requestSubmit();
   }} onPaste={uploads.paste} id='thread-reply' inputRef={input} value={body} onValue={value=>{draft.body=value;setBody(value);}} maxLength={600} rows={3} disabled={busy||paused||readOnly}/><button type="button" disabled={busy||paused||readOnly} onClick={()=>uploads.input.current?.click()}>📎 Attach file</button><button className={styles.primaryButton} disabled={busy||paused||readOnly||uploads.blocked||(!body.trim()&&!uploads.ids.length)}>{busy?'Sending…':'Send reply'}</button><small id='thread-reply-help'>Enter to send · Shift+Enter for a new line.</small>{paused&&<p>Room paused. Replies are read-only.</p>}</form>}
  </div>
 </aside>;
}
