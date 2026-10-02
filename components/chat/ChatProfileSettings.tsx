'use client';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import type {ChatMember} from '@/lib/chatDirectMessages';
import {chatName,CHAT_NAME_HELP} from '@/lib/chatDisplayName';
import {newerChatMember,validChatMember} from '@/lib/chatMemberName';
import {useChatIdentity} from './ChatUpdates';
import styles from './ChatProfileSettings.module.css';
export default function ChatProfileSettings({accountId,member}:{accountId:string;member:ChatMember}){
 const identity=useChatIdentity();
 const current=identity?.accountId===accountId&&identity.member?.id===member.id?newerChatMember(member,identity.member):member;
 const [open,setOpen]=useState(false),[editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null),request=useRef<AbortController|null>(null),generation=useRef(0);
 const expected=useRef({accountId,memberId:member.id});expected.current={accountId,memberId:member.id};
 const heading=useId(),input=useId(),hint=useId();
 useEffect(()=>{const show=()=>{trigger.current=document.activeElement as HTMLElement;setDraft(current.display_name);setEditing(false);setError('');setMessage('');setOpen(true);};window.addEventListener('chat-open-profile-settings',show);return()=>window.removeEventListener('chat-open-profile-settings',show);},[current.display_name]);
 useEffect(()=>{const version=generation;version.current++;request.current?.abort();setOpen(false);setBusy(false);setEditing(false);setError('');setMessage('');return()=>{version.current++;request.current?.abort();};},[accountId,member.id]);
 useEffect(()=>{if(!open)return;const node=dialog.current;node?.showModal();return()=>node?.close();},[open]);
 function close(){generation.current++;request.current?.abort();setBusy(false);setOpen(false);trigger.current?.focus({preventScroll:true});}
 async function save(event:FormEvent){event.preventDefault();if(busy)return;const name=chatName(draft);if(!name){setError(CHAT_NAME_HELP);return;}
  const token=++generation.current,owner={accountId,memberId:member.id};request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setError('');setMessage('');
  try{const response=await fetch('/api/chat/member',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rename',displayName:name}),signal:controller.signal});const data=await response.json();
   if(token!==generation.current||controller.signal.aborted||owner.accountId!==expected.current.accountId||owner.memberId!==expected.current.memberId)return;
   if(!response.ok)throw Error(data.error||'Your name could not be updated. Please try again.');
   if(data.accountId!==owner.accountId||!validChatMember(data.member)||data.member.id!==owner.memberId)throw Error('Your account changed. Please reopen profile settings.');
   identity?.publish({accountId:data.accountId,member:data.member});setDraft(data.member.display_name);setEditing(false);setMessage('Your chat name has been updated.');
  }catch(failure){if(token===generation.current&&!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Your name could not be updated.');}
  finally{if(token===generation.current)setBusy(false);}
 }
 if(!open)return null;
 return <dialog ref={dialog} className={styles.dialog} aria-labelledby={heading} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}}}>
  <div className={styles.content}><header><h2 id={heading}>Profile settings</h2><button type="button" onClick={close} aria-label="Close profile settings">×</button></header>
  <p className={styles.label}>Chat display name</p><strong className={styles.name}>{current.display_name}</strong>
  <p id={hint}>Please use your real name so fellow traders know who you are.</p>
  {editing?<form onSubmit={save}><label htmlFor={input}>Your chat name</label><input id={input} value={draft} onChange={e=>{setDraft(e.target.value);setError('');}} maxLength={28} autoComplete="name" autoFocus aria-describedby={hint} aria-invalid={!!error} disabled={busy}/><div className={styles.actions}><button type="submit" disabled={busy}>{busy?'Saving…':'Save name'}</button><button type="button" disabled={busy} onClick={()=>{setEditing(false);setError('');}}>Cancel</button></div></form>:<button className={styles.change} type="button" onClick={()=>{setDraft(current.display_name);setError('');setMessage('');setEditing(true);}}>Change Name</button>}
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status">{message}</p>}
  <p className={styles.note}>This changes your chat name only.</p></div>
 </dialog>;
}
