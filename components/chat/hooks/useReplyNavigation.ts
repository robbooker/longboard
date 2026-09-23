'use client';
import {useCallback,useEffect,useId,useState} from 'react';

// Keep Next's own history fields intact; this entry only owns the reply panel.
export function useReplyNavigation(room:string,navigationOwner?:string,local=false){
 const generatedOwner=useId();
 const owner=navigationOwner??generatedOwner;
 const [target,setTarget]=useState<string|null>(null);
 const [depth,setDepth]=useState(0);
 const [stack,setStack]=useState<string[]>([]);
 const [mobile,setMobile]=useState(false);
 useEffect(()=>{
  const media=window.matchMedia('(max-width:1099px)');
  const resize=()=>setMobile(media.matches);resize();media.addEventListener('change',resize);
  return()=>media.removeEventListener('change',resize);
 },[]);
 useEffect(()=>{
  if(local)return;
  const restore=()=>{
   const entry=window.history.state?.chatReply;
   const ours=entry?.owner===owner&&entry?.room===room;
   setTarget(ours?entry.target:null);setDepth(ours?entry.depth:0);
  };
  restore();window.addEventListener('popstate',restore);
  return()=>window.removeEventListener('popstate',restore);
 },[owner,room,local]);
 const open=useCallback((id:string)=>{
  if(local){setStack(s=>[...s,id]);return;}
  const current=window.history.state?.chatReply;
  if(current?.owner===owner&&current?.room===room&&current?.target===id)return;
  const nextDepth=current?.owner===owner&&current?.room===room?current.depth+1:1;
  window.history.pushState({...window.history.state,chatReply:{owner,room,target:id,depth:nextDepth}},'');
  setTarget(id);setDepth(nextDepth);
 },[owner,room,local]);
 const back=useCallback(()=>{if(local)setStack(s=>s.slice(0,-1));else window.history.back();},[local]);
 const close=useCallback(()=>{
  if(local){setStack([]);return;}
  const entry=window.history.state?.chatReply;
  if(entry?.owner===owner&&entry?.room===room)window.history.go(-entry.depth);
  else {setTarget(null);setDepth(0);}
 },[owner,room,local]);
 return {target:local?(stack.at(-1)??null):target,depth:local?stack.length:depth,mobile:local||mobile,open,back,close};
}
