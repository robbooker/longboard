'use client';
import MembershipBadges from './MembershipBadges';
import {beginMobileSend} from '@/lib/chatMobileSend';
import {useChatRefreshGuard} from './hooks/useChatRefreshGuard';
import VoiceRecorder from './VoiceRecorder';
import BuddyStatus from './BuddyStatus';
import { chatTimestamp,chatTimestampTitle } from '@/lib/chatTimestamp';
import type { ChatRoom,PublicChatMessage } from '@/lib/publicChat';
import { FormEvent,useCallback,useEffect,useRef,useState } from 'react';
import { AttachmentPicker,ChatAttachments } from './ChatAttachments';
import MentionTextarea from './MentionTextarea';
import MessageReactions from './MessageReactions';
import MessageActions from './MessageActions';
import { useChatUpdates } from './ChatUpdates';
import { useAttachments } from './hooks/useAttachments';
import styles from './PublicChat.module.css';
type PendingReply={id:string;body:string;files:string[];names:string[];createdAt:string;state:'sending'|'failed';error?:string};
export type ReplyDraft={body:string;scroll:number;pending?:PendingReply[]};
export default function ChatReplyPanel({messageId,memberId,room,paused,readOnly=false,depth,draft,onBack,onOpen,onClose,onSent}:{messageId:string;memberId?:string;room:ChatRoom;paused:boolean;readOnly?:boolean;depth:number;draft:ReplyDraft;onBack:()=>void;onOpen:(id:string)=>void;onClose:()=>void;onSent:(message:PublicChatMessage)=>void}){
 const updates=useChatUpdates();
 const [parent,setParent]=useState<PublicChatMessage|null>(null),[replies,setReplies]=useState<PublicChatMessage[]>([]),[body,setBody]=useState(draft.body),[error,setError]=useState(''),[more,setMore]=useState(false);
 const uploads=useAttachments(room);
 const revision=useRef(0);
 const acknowledged=useRef(new Map<string,{message:PublicChatMessage;expires:number}>());
 const inFlight=useRef(new Set<string>());
 const [pending,setPending]=useState<PendingReply[]>(draft.pending??[]);
 const pendingRef=useRef(pending);
 useChatRefreshGuard(memberId,`thread:${room}:${messageId}`,body,value=>{draft.body=value;setBody(value);},uploads.blocked||uploads.files.length>0||pending.length>0);
 const savePending=useCallback((change:(current:PendingReply[])=>PendingReply[])=>{
  const next=change(draft.pending??pendingRef.current);pendingRef.current=next;draft.pending=next;if(mounted.current)setPending(next);
 },[draft]);
 const input=useRef<HTMLTextAreaElement>(null);
 const panel=useRef<HTMLElement>(null);
 const contents=useRef<HTMLDivElement>(null);
 const sending=useRef(false);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  let cancelled=false;let running=false;
  const load=async()=>{if(running||sending.current)return;running=true;const version=revision.current;try{
   const path=`/api/chat/thread?room=${room}&messageId=${messageId}`;const response=await (updates?updates.read(path):fetch(path,{cache:"no-store"}));const data=await response.json();
   if(cancelled||sending.current||version!==revision.current)return;if(!response.ok){if([401,403,404].includes(response.status)){setParent(null);setReplies([]);acknowledged.current.clear();}throw Error(data.error||'Could not load replies.');}
   setParent(data.parent);
   const fetched=data.replies as PublicChatMessage[];
   for(const [id,entry] of acknowledged.current)if(entry.expires<=Date.now()||fetched.some(message=>message.id===id))acknowledged.current.delete(id);
   setReplies([...fetched,...Array.from(acknowledged.current.values(),entry=>entry.message)].sort((a,b)=>a.created_at.localeCompare(b.created_at)));setMore(data.hasMore);setError('');
   const confirmed=new Set((data.replies as PublicChatMessage[]).filter(m=>m.member_id===memberId).map(m=>m.client_id));
   savePending(current=>current.filter(item=>!confirmed.has(item.id)));
  }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Could not load replies.');}finally{running=false;}};
  const stop=updates?.watch(load,["room"],true);if(!updates)void load();
  return()=>{cancelled=true;stop?.();};
 },[messageId,room,updates,memberId,savePending]);
 useEffect(()=>{
  if(!parent?.id)return;
  input.current?.focus({preventScroll:true});
  if(contents.current)contents.current.scrollTop=draft.scroll;
 },[parent?.id,draft]);
 useEffect(()=>{
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))onClose();};
  window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);
 },[onClose]);
 function edited(message:PublicChatMessage){
  revision.current++;
  if(acknowledged.current.has(message.id))acknowledged.current.set(message.id,{message,expires:Date.now()+15000});
  setParent(current=>current?.id===message.id?message:current);
  setReplies(current=>current.map(reply=>reply.id===message.id?message:reply));
  onSent(message);
  updates?.invalidate('room');
 }
 function actions(message:PublicChatMessage){
  return message.member_id===memberId&&!!memberId&&!readOnly ? <MessageActions message={message} room={room} own admin={false} paused={paused} editOnly onEdited={edited} onDeleted={()=>{}}/> : null;
 }
 async function transmit(item:PendingReply){
  if(inFlight.current.has(item.id))return;inFlight.current.add(item.id);
  const mobileSend=beginMobileSend(input.current,contents.current);
  savePending(current=>current.map(row=>row.id===item.id?{...row,state:'sending',error:undefined}:row));
  try{
   const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',room,body:item.body,replyTo:messageId,attachmentIds:item.files,clientId:item.id})});
   const result=await response.json();if(!response.ok)throw Error(result.message||result.error||'Could not send reply.');
   if(!result.message?.id)throw Error('Could not confirm reply. Retry safely.');
   if(mounted.current){
    revision.current++;
    setReplies(current=>{
     const existing=current.find(m=>m.id===result.message.id);
     const canonical=existing&&(existing.edited_at??'')>(result.message.edited_at??'')?existing:result.message;
     acknowledged.current.set(canonical.id,{message:canonical,expires:Date.now()+15000});
     return [...current.filter(m=>m.id!==canonical.id),canonical].sort((a,b)=>a.created_at.localeCompare(b.created_at));
    });
    onSent(result.message);updates?.invalidate('room','activity');
    mobileSend.confirmed();
   }
   if(!mounted.current)mobileSend.cancel();
   savePending(current=>current.filter(row=>row.id!==item.id));
  }catch(e){mobileSend.cancel();savePending(current=>current.map(row=>row.id===item.id?{...row,state:'failed',error:e instanceof Error?e.message:'Could not send reply.'}:row));}finally{inFlight.current.delete(item.id);}
 }
 function send(event:FormEvent){
  event.preventDefault();if((!body.trim()&&!uploads.ids.length)||uploads.blocked||sending.current||paused||readOnly||!parent)return;
  if(pendingRef.current.length>=20){setError('Please retry your unsent replies before sending more.');return;}
  sending.current=true;
  const item:PendingReply={id:crypto.randomUUID(),body:body.trim(),files:[...uploads.ids],names:uploads.files.map(file=>file.name),createdAt:new Date().toISOString(),state:'sending'};
  savePending(current=>[...current,item]);draft.body='';setBody('');uploads.clear();setError('');
  // Release immediately after React accepts the captured draft. Network work
  // never disables the composer or restores an older draft over new typing.
  queueMicrotask(()=>{sending.current=false;});
  input.current?.focus({preventScroll:true});
  void transmit(item);
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
   {parent&&<article className={styles.replyOriginal} aria-label='Original comment'><div className={styles.messageIdentity}><strong>{parent.author_label}</strong><MembershipBadges memberships={parent.bot_slug ? [] : parent.memberships}/><time dateTime={parent.created_at} title={chatTimestampTitle(parent.created_at)}>{chatTimestamp(parent.created_at)}{parent.edited_at?' · edited':''}</time>{actions(parent)}</div><p>{parent.body}</p><ChatAttachments room={room} ids={parent.attachment_ids}/><BuddyStatus status={parent.buddy_status}/><MessageReactions target={{kind:"room",room,messageId:parent.id}} disabled={paused||!memberId}/></article>}
   {error&&<p role='alert'>{error}</p>}
   <div aria-live='polite' aria-label='Replies to this comment'>{more&&<p>Showing the latest 100 replies.</p>}{parent&&!replies.length&&!pending.length&&<p>No replies yet.</p>}{replies.map(reply=><article key={reply.id} className={styles.threadReply}><div className={styles.messageIdentity}><strong>{reply.author_label}</strong><MembershipBadges memberships={reply.bot_slug ? [] : reply.memberships}/><time dateTime={reply.created_at} title={chatTimestampTitle(reply.created_at)}>{chatTimestamp(reply.created_at)}{reply.edited_at?' · edited':''}</time>{actions(reply)}</div><p>{reply.body}</p><ChatAttachments room={room} ids={reply.attachment_ids}/><BuddyStatus status={reply.buddy_status}/><MessageReactions target={{kind:"room",room,messageId:reply.id}} disabled={paused||!memberId}/><button type='button' className={styles.replyButton} onClick={()=>onOpen(reply.id)}>↳ Reply / view conversation</button></article>)}{pending.map(item=><article key={item.id} className={styles.threadReply} data-send-state={item.state}><div className={styles.messageIdentity}><strong>You</strong><small role='status'>{item.state==='sending'?'Sending…':'Not sent'}</small></div><p>{item.body}</p>{item.names.length>0&&<p>{item.names.join(', ')}</p>}{item.state==='failed'&&<><p role='alert'>{item.error}</p><button type='button' disabled={paused||readOnly||!parent} onClick={()=>void transmit(item)}>Retry reply</button></>}</article>)}</div>
   {readOnly&&<p>Only admins can reply in this announcement channel.</p>}
   {parent&&!readOnly&&<form onSubmit={send}><label htmlFor='thread-reply'>Reply to {parent.author_label}</label><AttachmentPicker uploads={uploads} disabled={paused||readOnly}/><MentionTextarea enabled={!!memberId&&!paused&&!readOnly} buddyEnabled={room==='main'} listClassName={styles.replyMentionList} aria-describedby='thread-reply-help' onKeyDown={event=>{
    if(event.key!=='Enter'||event.shiftKey||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;
    event.preventDefault();
    if(!event.repeat&&!sending.current)event.currentTarget.form?.requestSubmit();
   }} onPaste={uploads.paste} id='thread-reply' inputRef={input} value={body} onValue={value=>{draft.body=value;setBody(value);}} maxLength={600} rows={3} disabled={paused||readOnly}/><VoiceRecorder key={parent.id} uploads={uploads} disabled={paused||readOnly}/><button type="button" disabled={paused||readOnly} onClick={()=>uploads.input.current?.click()}>📎 Attach file</button><button className={styles.primaryButton} disabled={paused||readOnly||uploads.blocked||(!body.trim()&&!uploads.ids.length)}>Send reply</button><small id='thread-reply-help'>Enter to send · Shift+Enter for a new line.</small>{paused&&<p>Room paused. Replies are read-only.</p>}</form>}
  </div>
 </aside>;
}
