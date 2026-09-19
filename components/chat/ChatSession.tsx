'use client';
import {createContext,useContext,type Dispatch,type SetStateAction,type RefObject} from 'react';
import type {ChatMember} from '@/lib/chatDirectMessages';
type Setter<T>=Dispatch<SetStateAction<T>>;
export type ChatSessionBridge={
 navigationOwner:string;
 dmView:string|null;setDmView:Setter<string|null>;roomSelection:number;setRoomSelection:Setter<number>;
 dmTarget:{id:string;name:string}|null;setDmTarget:Setter<{id:string;name:string}|null>;
 dmSidebarHost:HTMLDivElement|null;setDmSidebarHost:Setter<HTMLDivElement|null>;
 dmConversationHost:HTMLDivElement|null;setDmConversationHost:Setter<HTMLDivElement|null>;
 navTrigger:RefObject<HTMLButtonElement|null>;setMember:Setter<ChatMember|null>;
 mobileNavOpen:boolean;setMobileNavOpen:Setter<boolean>;
};
export const ChatSessionContext=createContext<ChatSessionBridge|null>(null);
export function useChatSession(){const bridge=useContext(ChatSessionContext);if(!bridge)throw new Error('Chat session required');return bridge;}
