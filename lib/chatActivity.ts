import type {ChatRoom} from './publicChat';
import type {ChatReaction} from './chatMessageReactions';
export type ChatReactionNotification={id:string;seq:number;messageId:string;author:string;emoji:ChatReaction;preview:string;createdAt:string}&({kind:'room';room:ChatRoom}|{kind:'dm';conversationId:string});
export type ChatActivity={
 replyNotifications?:boolean;
 mentions:Array<{category?:'mention'|'reply';parentPreview?:string|null;threadRootId?:string|null;id:string;seq:number;messageId:string;room:ChatRoom;author:string;preview:string;createdAt:string}>;
 dms:Array<{id:string;name:string;unread:number;throughSeq:number;pending:boolean;messageId?:string;preview?:string;createdAt?:string}>;
 reactions?:ChatReactionNotification[];reactionCount?:number;reactionThrough?:number;
 mentionCount:number;dmCount:number;mentionThrough:number;dmThrough:number;
 roomMessageCounts:Partial<Record<ChatRoom,number>>;roomMessageThrough:Partial<Record<ChatRoom,number>>;
 roomCounts:Partial<Record<ChatRoom,number>>;roomThrough:Partial<Record<ChatRoom,number>>;
};
export const emptyChatActivity:ChatActivity={mentions:[],dms:[],reactions:[],mentionCount:0,dmCount:0,reactionCount:0,mentionThrough:0,dmThrough:0,reactionThrough:0,roomCounts:{},roomThrough:{},roomMessageCounts:{},roomMessageThrough:{}};
export const CHAT_ACTIVITY_MAX_BYTES=32*1024;
const text=(value:string|undefined|null,length:number)=>Array.from(value??'').slice(0,length).join('');
/** Keep full counters/cursors; listed previews are a bounded, newest-first sample. */
export function boundChatActivity(data:ChatActivity):ChatActivity{
 const result:ChatActivity={...data,
  mentions:(data.mentions??[]).slice(0,50).map(row=>({...row,author:text(row.author,100),preview:text(row.preview,240),parentPreview:row.parentPreview==null?row.parentPreview:text(row.parentPreview,96)})),
  dms:(data.dms??[]).slice(0,100).map(row=>({...row,name:text(row.name,100),...(row.preview===undefined?{}:{preview:text(row.preview,240)})})),
  reactions:(data.reactions??[]).slice(0,50).map(row=>({...row,author:text(row.author,100),preview:text(row.preview,240)})),
 };
 const encoder=new TextEncoder();
 while(encoder.encode(JSON.stringify(result)).byteLength>CHAT_ACTIVITY_MAX_BYTES){
  const lists=[result.mentions,result.dms,result.reactions!];
  const oldest=lists.filter(rows=>rows.length).sort((a,b)=>(a.at(-1)?.createdAt??'').localeCompare(b.at(-1)?.createdAt??''))[0];
  if(!oldest)break; // The fixed scalar/maps projection is independently bounded by room count.
  oldest.pop();
 }
 return result;
}
