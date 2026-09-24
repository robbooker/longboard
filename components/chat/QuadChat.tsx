'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {openChatPopout} from '@/lib/chatPopout';
import PublicChat,{type PublicChatProps} from './PublicChat';
import {ChatUpdatesProvider,useChatUpdates} from './ChatUpdates';
import {quadChoices,validateQuadLayout,type QuadChoice} from '@/lib/chatQuad';
import {type DirectConversation} from '@/lib/chatDirectMessages';
import type {ChatRoom} from '@/lib/publicChat';
import {useDmSound} from './hooks/useDmSound';
import ChatAppControls from './ChatAppControls';
import styles from './QuadChat.module.css';
function QuadContents(props:PublicChatProps){
 const updates=useChatUpdates()!;
 const [choices,setChoices]=useState<QuadChoice[]>([]),[layout,setLayout]=useState<string[]>(['','','','']);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [mobile,setMobile]=useState(false),[active,setActive]=useState(0),[expanded,setExpanded]=useState<number|null>(null);
 const restored=useRef(false),root=useRef<HTMLDivElement>(null);
 const storageKey=`rb-chat-quad-v1:${props.accountId}`;
 const {observe}=useDmSound(props.bootstrap!.member!.id);
 useEffect(()=>{const media=matchMedia('(max-width:760px)');const update=()=>setMobile(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 useEffect(()=>{
  let cancelled=false;
  const load=async()=>{try{
   const response=await fetch('/api/chat/quad-options',{cache:'no-store'});
   if(response.status===401||response.status===403){setChoices([]);setLayout(['','','','']);window.location.replace('/chat/login');return;}
   if(!response.ok)throw Error('Could not refresh conversations. Try again shortly.');
   const data=await response.json() as {accountId:string;rooms:ChatRoom[];conversations:DirectConversation[]};
   if(cancelled)return;if(data.accountId!==props.accountId){setChoices([]);window.location.reload();return;}
   const next=quadChoices(data.rooms,data.conversations??[]);setChoices(next);observe(data.conversations??[]);
   if(!restored.current){restored.current=true;let saved:unknown;try{saved=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
    setLayout(validateQuadLayout(saved??next.filter(c=>c.room).slice(0,4).map(c=>c.key),next));
   }else setLayout(current=>validateQuadLayout(current,next));
   setReady(true);setError('');
  }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Conversations unavailable.');}};
  const stop=updates.watch(load,['inbox'],false,15000);return()=>{cancelled=true;stop();};
 },[updates,props.accountId,storageKey,observe]);
 useEffect(()=>{if(!ready)return;try{localStorage.setItem(storageKey,JSON.stringify(layout));}catch{setNotice('Layout cannot be saved in this browser.');}},[layout,ready,storageKey]);
 const guard=useCallback(()=>{if(root.current?.querySelector('dialog[open]')){setNotice('Close the open dialog before changing conversations.');return false;}const event=new Event('chat-before-refresh',{cancelable:true});window.dispatchEvent(event);if(event.defaultPrevented){setNotice('Finish sending or remove pending attachments before changing conversations.');return false;}return true;},[]);
 function change(index:number,key:string){if(!guard())return;setNotice('');setLayout(current=>validateQuadLayout(current.map((v,i)=>i===index?key:v),choices));}
 return <div className={styles.page} ref={root}>
  <ChatAppControls version={props.appVersion??'development'}/>
  <header className={styles.toolbar}><a href="/chat" onClick={e=>{if(!guard())e.preventDefault();}}>← Single chat</a><h1>Quad view</h1><button onClick={()=>{if(guard())window.dispatchEvent(new Event('chat-refresh-app'));}}>Refresh app</button></header>
  {(error||notice)&&<p className={styles.notice} role="status">{error||notice}</p>}
  <nav className={styles.tabs} aria-label="Choose visible conversation">{layout.map((key,i)=><button key={i} aria-pressed={active===i} onClick={()=>setActive(i)}>{choices.find(c=>c.key===key)?.label||`Pane ${i+1}`}</button>)}</nav>
  {!ready?<p role="status">{error||'Loading your conversations…'}</p>:<div className={styles.grid} data-expanded={expanded!==null}>
   {layout.map((key,index)=>{const choice=choices.find(c=>c.key===key);const visible=mobile?index===active:expanded===null||expanded===index;
    return <section key={index} className={styles.pane} hidden={!visible} aria-label={`Pane ${index+1}: ${choice?.label??'Choose a conversation'}`}>
     <header className={styles.paneHeader}><label className={styles.selectLabel}><span className={styles.srOnly}>Conversation in pane {index+1}</span><select value={key} onChange={e=>change(index,e.target.value)}><option value="">Choose a conversation</option>{choices.map(c=><option key={c.key} value={c.key} disabled={layout.includes(c.key)&&c.key!==key}>{c.room?'# ':''}{c.label}</option>)}</select></label>{choice?.room==='gainers'&&<button className={styles.popout} aria-label="Pop out Gainers" title="Pop out Gainers" onClick={()=>setNotice(openChatPopout('gainers')?'':'Your browser blocked the Gainers window. Allow popups and try again.')}>↗</button>}<button className={styles.expand} aria-label={expanded===index?'Restore four panes':`Expand pane ${index+1}`} onClick={()=>setExpanded(expanded===index?null:index)}>{expanded===index?'⊞':'⤢'}</button></header>
     <div className={styles.body}>{choice?<PublicChat key={key} {...props} allowedRooms={choices.flatMap(c=>c.room?[c.room]:[])} room={choice.room??props.room} bootstrap={{...props.bootstrap!,room:choice.room??props.room,messages:[],reactions:[],counts:{}}} pane={{visible,conversationId:choice.conversationId,onPrivateMessage:id=>{const dm=choices.find(c=>c.otherId===id);if(dm){const existing=layout.indexOf(dm.key);if(existing>=0){setActive(existing);if(!mobile)setExpanded(existing);}else change(index,dm.key);}else setNotice("Start a new DM in Single chat; it will then appear in the picker.");}}}/>:<div className={styles.empty}>Choose a room or an existing DM above.<small>Only conversations you can access appear here.</small></div>}</div>
    </section>;
   })}
  </div>}
 </div>;
}
export default function QuadChat(props:PublicChatProps){return <ChatUpdatesProvider room={props.room} rooms={props.allowedRooms} serverSession={!!props.serverSession} pollingRoom><QuadContents {...props}/></ChatUpdatesProvider>;}
