'use client';
import { ChatUpdateCoordinator,type ChatAccessUpdate } from '@/lib/chatUpdateCoordinator';
import type {ChatRoom} from '@/lib/publicChat';
import { createClient } from '@/lib/supabase/client';
import { createContext,useContext,useEffect,useState,useRef,useCallback,useMemo,type ReactNode } from 'react';
import {newerChatMember,validChatMember,type ChatMemberNameUpdate} from '@/lib/chatMemberName';
import type {ChatMember} from '@/lib/chatDirectMessages';
type RoomEvent = {eventType:string;new:Record<string,unknown>;old:Record<string,unknown>};
const IdentityContext=createContext<{accountId?:string;member:ChatMember|null;version:number;publish:(update:ChatMemberNameUpdate)=>void}|null>(null);
export function useChatIdentity(){return useContext(IdentityContext);}
export function useChatNameLabel(){const identity=useChatIdentity();return (id:string|null|undefined,fallback:string)=>identity?.member&&identity.member.id===id?identity.member.display_name:fallback;}
export function useChatDisplayName(memberId:string|null|undefined,fallback:string){const identity=useChatIdentity();return identity?.member&&identity.member.id===memberId?identity.member.display_name:fallback;}
export function useChatNameRefresh(refresh:()=>void){const identity=useChatIdentity(),callback=useRef(refresh),seen=useRef(identity?.version??0);callback.current=refresh;useEffect(()=>{if(identity&&seen.current!==identity.version){seen.current=identity.version;callback.current();}},[identity]);}
const Context=createContext<ChatUpdateCoordinator|null>(null);
const AccessContext=createContext<ChatAccessUpdate|null>(null);
export function useChatAccess(accountId?:string){const access=useContext(AccessContext);return access?.accountId===accountId?access:null;}
export function useChatUpdates(){return useContext(Context);}
export function ChatUpdatesProvider({children,serverSession,pollingRoom,room,rooms,onUnauthorized,accountId}:{accountId?:string;onUnauthorized?:()=>void;children:ReactNode;serverSession:boolean;pollingRoom:boolean;room:ChatRoom;rooms?:ChatRoom[]}) {
 const roomRef=useRef(rooms??[room]);roomRef.current=rooms??[room];
 const [name,setName]=useState<{accountId?:string;member:ChatMember|null;version:number}>({accountId,member:null,version:0});
 const applyMember=useCallback((incoming:ChatMember)=>setName(current=>{const member=newerChatMember(current.accountId===accountId?current.member:null,incoming);return current.accountId===accountId&&current.member?.display_name===member.display_name&&current.member?.name_revision===member.name_revision?current:{accountId,member,version:current.version+1};}),[accountId]);
 const applyRef=useRef(applyMember);applyRef.current=applyMember;
 const [access,setAccess]=useState<ChatAccessUpdate|null>(null);
 const expectedAccount=useRef(accountId);expectedAccount.current=accountId;
 const unauthorized=useRef(onUnauthorized);unauthorized.current=onUnauthorized;
 const [updates]=useState(()=>new ChatUpdateCoordinator({fetch:(...args)=>fetch(...args),active:()=>!document.hidden&&navigator.onLine,now:()=>Date.now(),access:value=>{if(expectedAccount.current&&value.accountId!==expectedAccount.current){unauthorized.current?.();window.location.replace("/chat/login");return;}setAccess(value);if(value.member)applyRef.current(value.member);},unauthorized:()=>{unauthorized.current?.();window.location.replace("/chat/login");}},pollingRoom));
 const publish=useCallback((value:ChatMemberNameUpdate)=>{if(value.accountId!==expectedAccount.current||!validChatMember(value.member))return;applyRef.current(value.member);updates.refreshIdentity();window.dispatchEvent(new Event('chat-pins-changed'));window.dispatchEvent(new Event('chat-favorite-changed'));},[updates]);
 useEffect(()=>{const peer=(event:Event)=>{const id=(event as CustomEvent<{memberId:string}>).detail?.memberId;if(name.accountId!==accountId||!name.member||name.member.id!==id)return;setName(current=>({...current,version:current.version+1}));updates.invalidate('history','activity');};window.addEventListener('chat-peer-names-changed',peer);return()=>window.removeEventListener('chat-peer-names-changed',peer);},[accountId,name.accountId,name.member,updates]);
 useEffect(()=>{setName({accountId,member:null,version:0});},[accountId]);
 useEffect(()=>{updates.setPollingRoom(pollingRoom);},[updates,pollingRoom]);
 useEffect(()=>{
  let disposed=false;
  updates.start();
  const foreground=()=>updates.foreground();
  const activity=()=>updates.invalidate('activity','inbox');
  const roomRefresh=()=>updates.invalidate('room','history','activity');
  document.addEventListener('visibilitychange',foreground);window.addEventListener('online',foreground);
  window.addEventListener('chat-activity-refresh',activity);window.addEventListener('chat-inbox-refresh',activity);window.addEventListener('chat-room-refresh',roomRefresh);
  // The cookie-only identity cannot authenticate a browser Postgres channel.
  // Never grant anonymous access or assume a subscribed socket proves identity.
  const client=createClient();
  const channel=serverSession?null:client.channel(`chat-updates-${crypto.randomUUID()}`)
   .on('postgres_changes',{event:'*',schema:'public',table:'longboard_chat_messages'},payload=>{
    if(disposed||document.hidden||!navigator.onLine)return;
    if(payload.eventType==='DELETE'||roomRef.current.includes(payload.new.room_slug as ChatRoom)){
     window.dispatchEvent(new CustomEvent<RoomEvent>('chat-room-event',{detail:payload as unknown as RoomEvent}));
     updates.invalidate('room');
    }
    updates.invalidate('activity');
   })
   .on('postgres_changes',{event:'*',schema:'public',table:'longboard_chat_reactions'},payload=>{
    if(disposed||document.hidden||!navigator.onLine)return;
    window.dispatchEvent(new CustomEvent<RoomEvent>('chat-reaction-event',{detail:payload as unknown as RoomEvent}));
    updates.invalidate('room');
   })
   .on('postgres_changes',{event:'*',schema:'public',table:'longboard_chat_direct_messages'},()=>{if(!disposed)updates.invalidate('inbox','activity');})
   .on('postgres_changes',{event:'*',schema:'public',table:'longboard_chat_conversations'},()=>{if(!disposed)updates.invalidate('inbox','activity');})
   .subscribe(status=>{if(!disposed)updates.setHealthy(status==='SUBSCRIBED');});
  return()=>{
   disposed=true;
   document.removeEventListener('visibilitychange',foreground);window.removeEventListener('online',foreground);
   window.removeEventListener('chat-activity-refresh',activity);window.removeEventListener('chat-inbox-refresh',activity);window.removeEventListener('chat-room-refresh',roomRefresh);
   updates.stop();if(channel)void client.removeChannel(channel);
  };
 },[updates,serverSession]);
 const identity=useMemo(()=>({accountId,member:name.accountId===accountId?name.member:null,version:name.version,publish}),[accountId,name,publish]);
 return <Context.Provider value={updates}><AccessContext.Provider value={access}><IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider></AccessContext.Provider></Context.Provider>;
}
