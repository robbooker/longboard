'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import type {ChatAttachment} from '@/lib/chatAttachmentValidation';
import {AttachmentMetadataCache,attachmentScopeKey,type AttachmentScope} from '@/lib/chatAttachmentMetadataCache';
type Store={cache:AttachmentMetadataCache;listeners:Map<string,Set<()=>void>>};
const Context=createContext<Store|null>(null);
/** Parent keys the shell by authenticated account; this boundary also resets if owner changes. */
export default function AttachmentMetadataProvider({owner,children}:{owner:string;children:ReactNode}){
 return <OwnedMetadata key={owner} enabled={!!owner}>{children}</OwnedMetadata>;
}
function OwnedMetadata({enabled,children}:{enabled:boolean;children:ReactNode}){
 const [store,setStore]=useState<Store|null>(null);
 useEffect(()=>{if(!enabled)return;const listeners=new Map<string,Set<()=>void>>();const cache=new AttachmentMetadataCache(fetch,scope=>listeners.get(scope)?.forEach(listener=>listener()));const value={cache,listeners};setStore(value);return()=>cache.dispose();},[enabled]);
 return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useAttachmentMetadata(scope:AttachmentScope,ids?:string[]){
 const [element,setElement]=useState<HTMLDivElement|null>(null);const [visible,setVisible]=useState(false);
 const store=useContext(Context),key=(ids??[]).join(','),scopeKey=attachmentScopeKey(scope);
 const [state,setState]=useState<{key:string;files:ChatAttachment[];error:string}>({key:'',files:[],error:''}),[attempt,setAttempt]=useState(0);
 useEffect(()=>{if(!element)return;const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting),{rootMargin:"120px"});observer.observe(element);return()=>observer.disconnect();},[element,key,scopeKey]);
 const currentScope=useRef(scope);currentScope.current=scope;
 useEffect(()=>{
  if(!visible)return;
  let live=true;const stateKey=scopeKey+'|'+key;setState(current=>current.key===stateKey?current:{key:stateKey,files:[],error:''});if(!key)return;
  if(!store||!visible)return;
  void store.cache.read(currentScope.current,key.split(',')).then(files=>{if(live)setState({key:stateKey,files,error:files.length===key.split(',').length?'':'Some attachments are unavailable.'});}).catch(error=>{if(live)setState({key:stateKey,files:[],error:error.message});});
  return()=>{live=false;};
 },[store,key,scopeKey,attempt,visible]);
 useEffect(()=>{
  if(!store)return;const stateKey=scopeKey+'|'+key;
  const invalidate=()=>{setState({key:stateKey,files:[],error:'Attachments unavailable. Retry to check access.'});};
  const listeners=store.listeners.get(scopeKey)??new Set();listeners.add(invalidate);store.listeners.set(scopeKey,listeners);
  return()=>{listeners.delete(invalidate);if(!listeners.size)store.listeners.delete(scopeKey);};
 },[store,scopeKey,key]);
 const shown=state.key===scopeKey+'|'+key?state:{files:[],error:''};
 return {...shown,anchor:setElement,retry:()=>{store?.cache.invalidate(currentScope.current);setAttempt(n=>n+1);}};
}
