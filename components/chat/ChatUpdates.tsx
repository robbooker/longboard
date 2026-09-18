'use client';
import { ChatUpdateCoordinator } from '@/lib/chatUpdateCoordinator';
import type {ChatRoom} from '@/lib/publicChat';
import { createClient } from '@/lib/supabase/client';
import { createContext,useContext,useEffect,useState,type ReactNode } from 'react';
type RoomEvent = {eventType:string;new:Record<string,unknown>;old:Record<string,unknown>};
const Context=createContext<ChatUpdateCoordinator|null>(null);
export function useChatUpdates(){return useContext(Context);}
export function ChatUpdatesProvider({children,serverSession,pollingRoom,room}:{children:ReactNode;serverSession:boolean;pollingRoom:boolean;room:ChatRoom}) {
 const [updates]=useState(()=>new ChatUpdateCoordinator({fetch:(...args)=>fetch(...args),active:()=>!document.hidden&&navigator.onLine,now:()=>Date.now(),unauthorized:()=>window.location.replace("/chat/login")},pollingRoom));
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
    if(payload.eventType==='DELETE'||payload.new.room_slug===room){
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
 },[updates,serverSession,room]);
 return <Context.Provider value={updates}>{children}</Context.Provider>;
}
