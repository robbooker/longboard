'use client';
import { emptyChatActivity,type ChatActivity } from '@/lib/chatActivity';
import { useCallback,useEffect,useRef,useState } from 'react';
import { useChatUpdates } from '../ChatUpdates';
export function useChatActivity(memberId?:string){
 const updates=useChatUpdates();
 const [data,setData]=useState<ChatActivity>(emptyChatActivity),[error,setError]=useState('');
 const generation=useRef(0);
 const load=useCallback(async()=>{
  if(!memberId)return;
  const version=++generation.current;
  try{
   const response=await (updates?updates.read('/api/chat/activity'):fetch('/api/chat/activity',{cache:'no-store'}));const result=await response.json();
   if(version!==generation.current)return;
   if(!response.ok)throw new Error(result.error||'Notifications unavailable.');
   setData(result);setError('');
  }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:'Notifications unavailable.');}
 },[memberId,updates]);
 const read=useCallback(async(body:Record<string,unknown>)=>{
  const response=await fetch('/api/chat/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok){const result=await response.json();throw new Error(result.error||'Could not mark read.');}
  if(updates)updates.invalidate('activity','inbox');else await load();
 },[load,updates]);
 useEffect(()=>{
  setData(emptyChatActivity);setError('');
  if(!memberId)return;
  const stop=updates?.watch(load,['activity'],true);
  if(!updates)void load();
  const invalidate=()=>{generation.current++;};
  return()=>{invalidate();stop?.();};
 },[memberId,load,updates]);
 return {data,error,read};
}
