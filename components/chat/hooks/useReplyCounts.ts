'use client';
import {useEffect,useState} from 'react';
export function useReplyCounts(room:string,ids:string){
 const [counts,setCounts]=useState<Record<string,number>>({});
 useEffect(()=>{
  setCounts({});if(!ids)return;
  const controller=new AbortController();let running=false;
  const load=async()=>{if(running)return;running=true;try{
   const response=await fetch(`/api/chat/thread-counts?room=${room}&ids=${ids}`,{cache:'no-store',signal:controller.signal});
   if(response.ok){const data=await response.json();if(!controller.signal.aborted)setCounts(data.counts);}
  }catch{/* Leave reply navigation available when counts cannot refresh. */}finally{running=false;}};
  void load();const timer=setInterval(()=>{if(!document.hidden)void load();},3000);
  return()=>{controller.abort();clearInterval(timer);};
 },[room,ids]);
 return counts;
}
