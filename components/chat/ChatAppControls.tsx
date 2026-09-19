'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import styles from './ChatAppControls.module.css';
export default function ChatAppControls({version}:{version:string}){
 const [available,setAvailable]=useState(false),[notice,setNotice]=useState('');
 const registration=useRef<ServiceWorkerRegistration|null>(null),lastCheck=useRef(0),prompted=useRef('');
 const refreshing=useRef(false);
 const refresh=useCallback(async()=>{
  if(refreshing.current)return;
  if(!window.dispatchEvent(new Event('chat-before-refresh',{cancelable:true}))){setNotice('Finish or remove attachments, recordings, and unsent messages before refreshing. If this persists, browser storage may be unavailable.');return;}
  if(!navigator.onLine){setNotice('Connect to the internet before refreshing.');return;}
  refreshing.current=true;
  try{
   const waiting=registration.current?.waiting;
   if(waiting){
    await new Promise<void>((resolve,reject)=>{
     const changed=()=>{clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',changed);resolve();};
     const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',changed);reject(Error('Update is still preparing. Please try Refresh app again.'));},8000);
     navigator.serviceWorker.addEventListener('controllerchange',changed);
     waiting.postMessage({type:'CHAT_ACTIVATE_UPDATE'});
    });
   }
   if(!window.dispatchEvent(new Event('chat-before-refresh',{cancelable:true}))){refreshing.current=false;setNotice('Finish or remove attachments, recordings, and unsent messages before refreshing.');return;}
   window.location.reload();
  }catch(e){refreshing.current=false;setNotice(e instanceof Error?e.message:'Could not refresh. Please try again.');}
 },[]);
 useEffect(()=>{
  let stopped=false;
  if('serviceWorker' in navigator)void navigator.serviceWorker.register('/chat-sw.js',{scope:'/chat',updateViaCache:'none'}).then(r=>{if(!stopped)registration.current=r;}).catch(()=>{});
  const check=async()=>{
   if(document.hidden||Date.now()-lastCheck.current<30000)return;lastCheck.current=Date.now();
   try{
    void registration.current?.update().catch(()=>{});
    const response=await fetch('/api/chat/version',{cache:'no-store'});if(!response.ok)return;
    const data=await response.json();
    if(!stopped&&typeof data.version==='string'&&data.version!==version&&data.version!=='development'){
     setAvailable(true);if(prompted.current!==data.version){prompted.current=data.version;setNotice('A chat update is ready.');}
    }
   }catch{}
  };
  void check();const timer=setInterval(()=>void check(),120000);
  const resume=()=>void check(),request=()=>void refresh();
  window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);window.addEventListener('chat-refresh-app',request);
  return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);window.removeEventListener('chat-refresh-app',request);};
 },[version,refresh]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),8000);return()=>clearTimeout(timer);},[notice]);
 return notice?createPortal(<div className={styles.notice} role="status"><span>{notice}</span>{available&&notice==='A chat update is ready.'&&<button onClick={()=>void refresh()}>Refresh</button>}<button aria-label="Dismiss update notice" onClick={()=>setNotice('')}>×</button></div>,document.body):null;
}
