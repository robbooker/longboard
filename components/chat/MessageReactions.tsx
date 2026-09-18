'use client';
import {createContext,useCallback,useContext,useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import type {ChatRoom} from '@/lib/publicChat';
import {useChatUpdates} from './ChatUpdates';
import styles from './MessageReactions.module.css';
export type ReactionTarget=({kind:'room';room:ChatRoom}|{kind:'dm';conversationId:string})&{messageId:string};
type Emoji='like'|'heart'|'laugh';
type Summary={emoji:Emoji;count:number;mine:boolean;names:string[]};
const keyOf=(target:ReactionTarget)=>JSON.stringify(target.kind==='room'?[target.kind,target.room,target.messageId]:[target.kind,target.conversationId,target.messageId]);
async function request(body:unknown,signal?:AbortSignal){const r=await fetch('/api/chat/message-reactions',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error==='chat_paused'?'Reactions are paused in this room.':'Reactions unavailable. Refresh or try again.');return data.messages as Record<string,Summary[]>;}
const Context=createContext<{rows:Record<string,Summary[]>;register:(target:ReactionTarget)=>()=>void;set:(target:ReactionTarget,emoji:Emoji,active:boolean)=>Promise<void>}|null>(null);
/** One scheduler per chat shell, with scoped batches of at most 100 visible targets. */
export function MessageReactionProvider({children}:{children:ReactNode}){
 const updates=useChatUpdates();const targets=useRef(new Map<string,{target:ReactionTarget;count:number}>());const version=useRef(0);const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);const alive=useRef(true);
 const reading=useRef<AbortController|null>(null);
 const [rows,setRows]=useState<Record<string,Summary[]>>({});
 const load=useCallback(async()=>{
  reading.current?.abort();if(document.hidden)return;const controller=new AbortController();reading.current=controller;
  const revision=version.current;const groups=new Map<string,ReactionTarget[]>();
  for(const {target}of targets.current.values()){const group=target.kind==='room'?`room:${target.room}`:`dm:${target.conversationId}`;groups.set(group,[...(groups.get(group)??[]),target]);}
  await Promise.all([...groups.values()].map(async group=>{for(let start=0;start<group.length;start+=100){const batch=group.slice(start,start+100);try{const result=await request({...batch[0],action:'read',messageIds:batch.map(t=>t.messageId)},controller.signal);if(alive.current&&!controller.signal.aborted&&revision===version.current)setRows(current=>({...current,...Object.fromEntries(batch.map(t=>[keyOf(t),result[t.messageId]??[]]))}));}catch{if(alive.current&&!controller.signal.aborted&&revision===version.current)setRows(current=>({...current,...Object.fromEntries(batch.map(t=>[keyOf(t),[]]))}));}}}));
 },[]);
 const register=useCallback((target:ReactionTarget)=>{const key=keyOf(target);const item=targets.current.get(key);version.current++;targets.current.set(key,{target,count:(item?.count??0)+1});clearTimeout(timer.current);timer.current=setTimeout(()=>{void load();},50);return()=>{const item=targets.current.get(key);if(item&&item.count>1)item.count--;else {targets.current.delete(key);version.current++;reading.current?.abort();clearTimeout(timer.current);timer.current=setTimeout(()=>{void load();},50);}};},[load]);
 useEffect(()=>{alive.current=true;const stop=updates?.watch(load,['room','inbox'],false,5000);if(!updates)void load();const visibility=()=>{if(document.hidden)reading.current?.abort();else void load();};document.addEventListener('visibilitychange',visibility);return()=>{alive.current=false;reading.current?.abort();clearTimeout(timer.current);document.removeEventListener('visibilitychange',visibility);stop?.();};},[load,updates]);
 const set=useCallback(async(target:ReactionTarget,emoji:Emoji,active:boolean)=>{version.current++;const result=await request({...target,action:'set',emoji,active});version.current++;if(alive.current&&targets.current.has(keyOf(target)))setRows(current=>({...current,[keyOf(target)]:result[target.messageId]??[]}));updates?.invalidate(target.kind==='room'?'room':'inbox');},[updates]);
 const context=useMemo(()=>({rows,register,set}),[rows,register,set]);
 return <Context.Provider value={context}>{children}</Context.Provider>;
}
export default function MessageReactions({target,disabled=false,active=true}:{target:ReactionTarget;disabled?:boolean;active?:boolean}){
 const context=useContext(Context);const key=keyOf(target);const stableTarget=useMemo(()=>{const [kind,scope,messageId]=JSON.parse(key);return (kind==='room'?{kind,room:scope,messageId}:{kind,conversationId:scope,messageId}) as ReactionTarget;},[key]); // identity is the serialized scope, never message text
 const anchor=useRef<HTMLDivElement>(null);
 const register=context?.register;useEffect(()=>{
  if(!active||!register||!anchor.current)return;let remove:(()=>void)|undefined;
  const observer=new IntersectionObserver(entries=>{if(entries[0].isIntersecting){remove??=register(stableTarget);}else{remove?.();remove=undefined;}});
  observer.observe(anchor.current);return()=>{observer.disconnect();remove?.();};
 },[active,register,stableTarget]);
 const trigger=useRef<HTMLButtonElement>(null);const restoreFocus=useRef(false);
 const dialog=useRef<HTMLDialogElement>(null);const id=useId();const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!busy&&restoreFocus.current){restoreFocus.current=false;if(document.activeElement===document.body||anchor.current?.contains(document.activeElement))trigger.current?.focus({preventScroll:true});}},[busy]);
 const rows=context?.rows[key]??[];const icon=(emoji:Emoji)=>emoji==='heart'?'❤️':emoji==='laugh'?'😂':target.kind==='room'?(target.room.startsWith('ss-')||target.room==='shortscout'?'🍋':'🌴'):'👍';
 async function toggle(emoji:Emoji){if(disabled||busy||!context)return;setBusy(true);setError('');try{await context.set(target,emoji,!rows.find(r=>r.emoji===emoji)?.mine);restoreFocus.current=!!dialog.current?.open;dialog.current?.close();}catch(e){setError(e instanceof Error?e.message:'Could not save reaction.');}finally{setBusy(false);}}
 return <div ref={anchor} className={styles.footer} data-reaction-message={target.messageId} onKeyDown={event=>{if(event.key==='Escape'&&dialog.current?.open)event.stopPropagation();}}>
  {rows.filter(r=>r.count>0).map(r=><button type="button" key={r.emoji} className={styles.chip} disabled={disabled||busy} aria-pressed={r.mine} aria-label={`${r.mine?'Remove':'Add'} ${r.emoji} reaction, ${r.count}. ${r.names.join(', ')}${r.count>r.names.length?', and more':''}`} title={r.names.join(', ')} onClick={()=>void toggle(r.emoji)}>{icon(r.emoji)} {r.count}</button>)}
  <button ref={trigger} type="button" className={styles.add} disabled={disabled||busy||!context} onClick={()=>{setError('');dialog.current?.showModal();}}>＋ <span>ADD REACTION</span></button>
  {error&&!dialog.current?.open&&<span role="alert">{error}</span>}
  <dialog ref={dialog} className={styles.picker} aria-labelledby={id} onCancel={e=>{if(busy)e.preventDefault();}}>
   <h2 id={id}>Add reaction</h2><div className={styles.options}>{(['like','heart','laugh'] as const).map(emoji=><button type="button" key={emoji} aria-label={`${emoji} reaction`} aria-pressed={!!rows.find(r=>r.emoji===emoji)?.mine} disabled={disabled||busy} onClick={()=>void toggle(emoji)}>{icon(emoji)}<span>{emoji==='laugh'?'Laughing':emoji==='heart'?'Heart':'Like'}</span></button>)}</div>
   {error&&<p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={()=>dialog.current?.close()}>Close</button>
  </dialog>
 </div>;
}
