'use client';
import {useEffect,useRef,type RefObject} from 'react';
import {visibleChatMessageIds,visibleNotificationRequest,type VisibleNotificationScope} from '@/lib/chatVisibleNotifications';
import {useSharedChatActivity} from '../ChatActivityContext';

/** Reuse the existing activity snapshot/watch; observing a pane adds no polling. */
export function useVisibleChatNotifications({container,enabled,scope,canonicalIds,selector,attribute}:{container:RefObject<HTMLElement|null>;enabled:boolean;scope:VisibleNotificationScope;canonicalIds:string[];selector:string;attribute:string}){
 const {data,read}=useSharedChatActivity();
 const mentionThrough=scope.kind==='room'?data.mentionThrough:0;
 const reactionThrough=(data as {reactionThrough?:number}).reactionThrough??0;
 const room=scope.kind==='room'?scope.room:null,conversationId=scope.kind==='dm'?scope.conversationId:null;
 const idsKey=canonicalIds.join(',');
 const acknowledged=useRef<{scope:string;boundary:string;ids:Set<string>}>({scope:'',boundary:'',ids:new Set()});
 useEffect(()=>{
  if(!enabled||(!mentionThrough&&!reactionThrough))return;
  const node=container.current;if(!node)return;
  const scopeKey=room??conversationId??'',boundaryKey=`${mentionThrough}:${reactionThrough}`;
  if(acknowledged.current.scope!==scopeKey||acknowledged.current.boundary!==boundaryKey)acknowledged.current={scope:scopeKey,boundary:boundaryKey,ids:new Set()};
  const seen=acknowledged.current.ids,canonical=new Set(idsKey.split(',').filter(Boolean));
  let timer:ReturnType<typeof setTimeout>|undefined,cancelled=false,running=false;
  const flush=async()=>{
   if(cancelled||running)return;
   const ids=visibleChatMessageIds(node,canonical,selector,attribute).filter(id=>!seen.has(id));
   if(!ids.length)return;
   running=true;
   try{
    for(let start=0;start<ids.length;start+=100){
     if(cancelled)break;
     const visibleNow=new Set(visibleChatMessageIds(node,canonical,selector,attribute));
     const batch=ids.slice(start,start+100).filter(id=>visibleNow.has(id));
     if(!batch.length)continue;
     await read(visibleNotificationRequest(room?{kind:'room',room}:{kind:'dm',conversationId:conversationId!},batch,{mentionThrough,reactionThrough}));
     for(const id of batch)seen.add(id);
    }
   }catch{/* A later viewport/activity event retries; do not claim a failed acknowledgement. */}
   finally{running=false;}
  };
  // A short settled observation avoids acknowledging rows only flashed during scrolling.
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void flush(),250);};
  const stop=()=>{clearTimeout(timer);};
  const observer=new IntersectionObserver(schedule,{root:node});
  for(const row of node.querySelectorAll(selector))observer.observe(row);
  const resize=new ResizeObserver(schedule);resize.observe(node);
  node.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule);window.addEventListener('focus',schedule);window.addEventListener('blur',stop);
  document.addEventListener('visibilitychange',schedule);
  document.addEventListener('focusin',schedule);document.addEventListener('pointerup',schedule);document.addEventListener('keyup',schedule);
  schedule();
  return()=>{cancelled=true;stop();observer.disconnect();resize.disconnect();node.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);window.removeEventListener('focus',schedule);window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',schedule);document.removeEventListener('focusin',schedule);document.removeEventListener('pointerup',schedule);document.removeEventListener('keyup',schedule);};
 },[container,enabled,room,conversationId,idsKey,selector,attribute,mentionThrough,reactionThrough,read,data]);
}
