import type {ChatRoom} from './publicChat';
export type ChatActivity={
 replyNotifications?:boolean;
 mentions:Array<{category?:'mention'|'reply';parentPreview?:string|null;threadRootId?:string|null;id:string;seq:number;messageId:string;room:ChatRoom;author:string;preview:string;createdAt:string}>;
 dms:Array<{id:string;name:string;unread:number;throughSeq:number;pending:boolean}>;
 mentionCount:number;dmCount:number;mentionThrough:number;dmThrough:number;
 roomMessageCounts:Partial<Record<ChatRoom,number>>;roomMessageThrough:Partial<Record<ChatRoom,number>>;
 roomCounts:Partial<Record<ChatRoom,number>>;roomThrough:Partial<Record<ChatRoom,number>>;
};
export const emptyChatActivity:ChatActivity={mentions:[],dms:[],mentionCount:0,dmCount:0,mentionThrough:0,dmThrough:0,roomCounts:{},roomThrough:{},roomMessageCounts:{},roomMessageThrough:{}};
