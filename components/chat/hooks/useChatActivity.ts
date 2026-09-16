'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {createClient} from '@/lib/supabase/client';
import {emptyChatActivity,type ChatActivity} from '@/lib/chatActivity';
export function useChatActivity(memberId?:string){
 const [data,setData]=useState<ChatActivity>(emptyChatActivity),[error,setError]=useState('');
 const generation=useRef(0);
 const load=useCallback(async()=>{
  if(!memberId)return;
  const version=++generation.current;
  try{
   const response=await fetch('/api/chat/activity',{cache:'no-store'});const result=await response.json();
   if(version!==generation.current)return;
   if(!response.ok)throw new Error(result.error||'Notifications unavailable.');
   setData(result);setError('');
  }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:'Notifications unavailable.');}
 },[memberId]);
 const read=useCallback(async(body:Record<string,unknown>)=>{
  const response=await fetch('/api/chat/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok){const result=await response.json();throw new Error(result.error||'Could not mark read.');}
  await load();window.dispatchEvent(new Event('chat-inbox-refresh'));
 },[load]);
 useEffect(()=>{
  setData(emptyChatActivity);setError('');
  if(!memberId)return;
  void load();let debounce:ReturnType<typeof setTimeout>;
  const refresh=()=>{if(!document.hidden){clearTimeout(debounce);debounce=setTimeout(()=>void load(),100);}};
  const client=createClient();const channel=client.channel(`chat-activity-${memberId}`)
   .on('postgres_changes',{event:'*',schema:'public',table:'longboard_chat_messages'},refresh)
   .on('postgres_changes',{event:'*',schema:'public',table:'longboard_chat_direct_messages'},refresh)
   .on('postgres_changes',{event:'UPDATE',schema:'public',table:'longboard_chat_conversations'},refresh).subscribe();
  const interval=setInterval(refresh,2000);
  window.addEventListener('chat-activity-refresh',refresh);document.addEventListener('visibilitychange',refresh);
  // This is a request sequence counter, not a DOM ref; invalidate pending responses.
  const invalidate=()=>{generation.current++;};
  return()=>{invalidate();clearInterval(interval);clearTimeout(debounce);window.removeEventListener('chat-activity-refresh',refresh);document.removeEventListener('visibilitychange',refresh);void client.removeChannel(channel);};
 },[memberId,load]);
 return {data,error,read};
}
