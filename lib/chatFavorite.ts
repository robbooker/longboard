import { CHAT_ROOMS, type ChatRoom } from './publicChat';
export type FavoriteTarget = {kind:'room';room:ChatRoom}|{kind:'dm';conversationId:string};
export type ChatFavorite = FavoriteTarget & {label:string};
export function sameFavorite(a:FavoriteTarget|null,b:FavoriteTarget|null){return !!a&&!!b&&a.kind===b.kind&&(a.kind==='room'&&b.kind==='room'?a.room===b.room:a.kind==='dm'&&b.kind==='dm'&&a.conversationId===b.conversationId);}
export function favoriteLabel(target:FavoriteTarget){return target.kind==='room'?CHAT_ROOMS.find(room=>room.slug===target.room)?.label??'Room':'Conversation';}
export function favoriteHref(target:FavoriteTarget,popout:boolean){return `/chat?room=${target.kind==='room'?target.room:'social'}${target.kind==='dm'?`&dm=${encodeURIComponent(target.conversationId)}`:''}${popout?'&popout=1':''}`;}
