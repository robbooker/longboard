import {newerChatMember} from './chatMemberName';
import type {ChatMember} from './chatDirectMessages';
import type {ChatBootstrap} from './chatBootstrapTypes';
import type {ChatRoom} from './publicChat';
export type RoomSnapshot={bootstrap:ChatBootstrap;draft:string;scroll:number;pinned:boolean;replyDrafts?:Record<string,{body:string;scroll:number}>};
/** Per mounted account only; never persisted or shared between sessions. */
export class ChatRoomCache {
 private rows=new Map<ChatRoom,{snapshot:RoomSnapshot;at:number}>();
 constructor(readonly accountId:string,private now=()=>Date.now()){}
 set(room:ChatRoom,snapshot:RoomSnapshot){
  if(snapshot.bootstrap.accountId!==this.accountId||snapshot.bootstrap.room!==room)return;
  this.rows.delete(room);this.rows.set(room,{snapshot:{...snapshot,replyDrafts:Object.fromEntries(Object.entries(snapshot.replyDrafts??{}).slice(-20)),bootstrap:{...snapshot.bootstrap,messages:snapshot.bootstrap.messages.filter(m=>!m.pending).slice(-80),reactions:snapshot.bootstrap.reactions.slice(-500)}},at:this.now()});
  while(this.rows.size>5)this.rows.delete(this.rows.keys().next().value!);
 }
 get(room:ChatRoom){const entry=this.rows.get(room);if(!entry)return null;if(this.now()-entry.at>=300000){this.rows.delete(room);return null;}this.rows.delete(room);this.rows.set(room,entry);return entry.snapshot;}
 renameMember(member:ChatMember){for(const entry of this.rows.values()){const bootstrap=entry.snapshot.bootstrap;if(bootstrap.member?.id!==member.id)continue;const next=newerChatMember(bootstrap.member,member);entry.snapshot={...entry.snapshot,bootstrap:{...bootstrap,member:next,messages:bootstrap.messages.map(m=>m.member_id===member.id&&!m.bot_slug?{...m,author_label:next.display_name}:m)}};}}
 clear(){this.rows.clear();}
}
