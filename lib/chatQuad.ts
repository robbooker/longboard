import type {ChatRoom} from './publicChat';
import {CHAT_ROOMS} from './publicChat';
import type {DirectConversation} from './chatDirectMessages';
export type QuadChoice={key:string;label:string;room?:ChatRoom;conversationId?:string;otherId?:string};
export function quadChoices(rooms:ChatRoom[],conversations:DirectConversation[]):QuadChoice[]{
 return [...CHAT_ROOMS.filter(r=>rooms.includes(r.slug)).map(r=>({key:`room:${r.slug}`,label:r.label,room:r.slug})),...conversations.filter(c=>!c.system&&!c.unavailable&&!c.blockedByMe&&c.status!=='declined').map(c=>({key:`dm:${c.id}`,label:c.otherName,conversationId:c.id,otherId:c.otherId}))];
}
export function validateQuadLayout(value:unknown,choices:QuadChoice[]):string[]{
 const allowed=new Set(choices.map(c=>c.key)),seen=new Set<string>();
 return Array.from({length:4},(_,i)=>{const key=Array.isArray(value)?value[i]:null;if(typeof key!=='string'||!allowed.has(key)||seen.has(key))return '';seen.add(key);return key;});
}
