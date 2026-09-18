'use client';
import { useEffect,useState } from 'react';
import { useChatUpdates } from '../ChatUpdates';
export function useReplyCounts(room:string,ids:string,initial?:Record<string,number>){
 const updates=useChatUpdates();
 const [counts,setCounts]=useState<Record<string,number>>(initial??{});
 useEffect(()=>{
  if(!ids){setCounts({});return;}
  const controller=new AbortController();let running=false;
  const load=async()=>{if(running)return;running=true;try{
   const path=`/api/chat/thread-counts?room=${room}&ids=${ids}`;
   const response=await (updates?updates.read(path):fetch(path,{cache:"no-store",signal:controller.signal}));
   if(response.ok){const data=await response.json();if(!controller.signal.aborted)setCounts(data.counts);}
  }catch{/* Leave reply navigation available when counts cannot refresh. */}finally{running=false;}};
  const stop=updates?.watch(load,["room"],true);if(!updates)void load();
  return()=>{controller.abort();stop?.();};
 },[room,ids,updates]);
 return counts;
}
