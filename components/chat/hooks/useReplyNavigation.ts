'use client';
import {useCallback,useEffect,useId,useState} from 'react';

// Keep Next's own history fields intact; this entry only owns the reply panel.
export function useReplyNavigation(room:string,navigationOwner?:string){
 const generatedOwner=useId();
 const owner=navigationOwner??generatedOwner;
 const [target,setTarget]=useState<string|null>(null);
 const [depth,setDepth]=useState(0);
 const [mobile,setMobile]=useState(false);
 useEffect(()=>{
  const media=window.matchMedia('(max-width:1099px)');
  const resize=()=>setMobile(media.matches);resize();media.addEventListener('change',resize);
  return()=>media.removeEventListener('change',resize);
 },[]);
 useEffect(()=>{
  const restore=()=>{
   const entry=window.history.state?.chatReply;
   const ours=entry?.owner===owner&&entry?.room===room;
   setTarget(ours?entry.target:null);setDepth(ours?entry.depth:0);
  };
  restore();window.addEventListener('popstate',restore);
  return()=>window.removeEventListener('popstate',restore);
 },[owner,room]);
 const open=useCallback((id:string)=>{
  const current=window.history.state?.chatReply;
  if(current?.owner===owner&&current?.room===room&&current?.target===id)return;
  const nextDepth=current?.owner===owner&&current?.room===room?current.depth+1:1;
  window.history.pushState({...window.history.state,chatReply:{owner,room,target:id,depth:nextDepth}},'');
  setTarget(id);setDepth(nextDepth);
 },[owner,room]);
 const back=useCallback(()=>window.history.back(),[]);
 const close=useCallback(()=>{
  const entry=window.history.state?.chatReply;
  if(entry?.owner===owner&&entry?.room===room)window.history.go(-entry.depth);
  else {setTarget(null);setDepth(0);}
 },[owner,room]);
 return {target,depth,mobile,open,back,close};
}
