'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {sameFavorite,type ChatFavorite as Favorite,type FavoriteTarget} from '@/lib/chatFavorite';
import styles from './ChatFavorite.module.css';
const changed='chat-favorite-changed';
export default function ChatFavorite({memberId,target,label,shortcut=false,onNavigate}:{memberId:string;target:FavoriteTarget|null;label:string;shortcut?:boolean;onNavigate?:(favorite:Favorite)=>void}){
 const [favorite,setFavorite]=useState<Favorite|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),operation=useRef(false);
 const invalidate=useCallback(()=>{generation.current++;},[]);
 const read=useCallback(async()=>{const response=await fetch('/api/chat/favorite',{cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error||'Favorite could not load.');return body.favorite as Favorite|null;},[]);
 useEffect(()=>{let alive=true;const load=async()=>{if(operation.current)return;const version=++generation.current;try{const next=await read();if(alive&&generation.current===version){setFavorite(next);setReady(true);setError('');}}catch{if(alive&&generation.current===version){setFavorite(null);setReady(false);}}};void load();const refresh=()=>{if(document.visibilityState==='visible')void load();};window.addEventListener(changed,refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{alive=false;invalidate();window.removeEventListener(changed,refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[memberId,read,invalidate]);
 const selected=sameFavorite(favorite,target);
 async function save(next:FavoriteTarget|null){operation.current=true;setBusy(true);setError('');const version=++generation.current;try{const response=await fetch('/api/chat/favorite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:next})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Favorite could not save.');if(version===generation.current){setFavorite(body.favorite);setReady(true);operation.current=false;setBusy(false);window.dispatchEvent(new Event(changed));}}catch(e){if(version===generation.current)setError(e instanceof Error?e.message:'Favorite could not save.');}finally{operation.current=false;if(version===generation.current)setBusy(false);}}
 async function navigate(){operation.current=true;setBusy(true);setError('');const version=++generation.current;try{const current=await read();if(version!==generation.current)return;setFavorite(current);if(!current){setError('Your favorite is no longer available.');return;}onNavigate?.(current);}catch(e){if(version===generation.current)setError(e instanceof Error?e.message:'Favorite could not open.');}finally{operation.current=false;if(version===generation.current)setBusy(false);}}
 return <div className={styles.controls} data-chat-favorite>
  {shortcut&&ready&&favorite&&<button type="button" disabled={busy} onClick={()=>void navigate()} title={`Open favorite: ${favorite.label}`}>★ <span>Go to {favorite.label}</span></button>}
  {target&&<button type="button" disabled={busy} aria-pressed={selected} onClick={()=>void save(selected?null:target)}>{selected?'★':'☆'} <span>{selected?`Remove ${label} favorite`:`Favorite ${label}`}</span></button>}
  {shortcut&&favorite&&!selected&&<button type="button" disabled={busy} onClick={()=>void save(null)}>Remove favorite</button>}
  {error&&<p role="status">{error}</p>}
 </div>;
}
