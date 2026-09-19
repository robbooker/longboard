'use client';
import {useEffect,useRef} from 'react';
import {readChatDraft,saveChatDraft} from '@/lib/chatRefreshDrafts';
/** Only text drafts are persisted, never received messages or file objects. */
export function useChatRefreshGuard(owner:string|undefined,scope:string|null,text:string,setText:(text:string)=>void,busy:boolean,beforeRefresh?:()=>void){
 const latest=useRef({owner,scope,text,setText,busy,beforeRefresh});latest.current={owner,scope,text,setText,busy,beforeRefresh};
 const restored=useRef('');
 useEffect(()=>{
  const token=owner&&scope?`${owner}:${scope}`:'';
  if(!token){restored.current='';return;}
  if(restored.current!==token){restored.current=token;let saved='';try{saved=readChatDraft(window.sessionStorage,owner!,scope!);}catch{/* Disabled storage */}if(saved&&!latest.current.text){latest.current.setText(saved);return;}}
  try{saveChatDraft(window.sessionStorage,owner!,scope!,latest.current.text);}catch{/* Refresh guard reports persistence failure. */}
 },[owner,scope,text]);
 useEffect(()=>{
  const guard=(event:Event)=>{const value=latest.current;if(value.busy){event.preventDefault();return;}try{if(value.scope&&!saveChatDraft(window.sessionStorage,value.owner??'',value.scope,value.text)){event.preventDefault();return;}}catch{if(value.text){event.preventDefault();return;}}value.beforeRefresh?.();};
  window.addEventListener('chat-before-refresh',guard);return()=>window.removeEventListener('chat-before-refresh',guard);
 },[]);
}
