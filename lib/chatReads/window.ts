import type {SupabaseClient} from '@supabase/supabase-js';
import type {ChatRoom,PublicChatMessage} from '@/lib/publicChat';
import {CHAT_UUID} from '@/lib/chatMembers';
export type ChatWindow={messages:PublicChatMessage[];hasMore:boolean;hasNewer:boolean;range:string|null};
export class ChatWindowError extends Error{constructor(message:string,public status=400){super(message);}}
export function roomWindowQuery(params:URLSearchParams){
 const around=params.get('around'),before=params.get('before'),after=params.get('after'),range=params.get('range');
 const cursor=(value:string)=>/^\d{1,16}$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>0;
 if([around,before,after,range].filter(Boolean).length>1||(around&&!CHAT_UUID.test(around))||(before&&!cursor(before))||(after&&!cursor(after))||(range&&(!/^\d{1,16},\d{1,16}$/.test(range)||!range.split(',').every(cursor)||Number(range.split(',')[0])>Number(range.split(',')[1]))))throw new ChatWindowError('invalid_window');
 return {around,before,after,range,enabled:!!(around||before||after||range)};
}
/** Constant-query, bounded contiguous windows; never append an old row to an unrelated latest page. */
export async function readRoomWindow(db:SupabaseClient,room:ChatRoom,parentId:string|null,params:URLSearchParams,fields:string,limit:number):Promise<ChatWindow>{
 const window=roomWindowQuery(params);
 const query=(columns=fields)=>{const q=db.from('longboard_chat_messages').select(columns).eq('room_slug',room).eq('removed',false);return parentId?q.eq('reply_to_id',parentId):q.is('reply_to_id',null);};
 const rows=async(q:ReturnType<typeof query>)=>{const result=await q;if(result.error)throw new ChatWindowError('window_unavailable',503);return (result.data??[]) as unknown as PublicChatMessage[];};
 let messages:PublicChatMessage[]=[];
 if(window.around){
  const result=await query().eq('id',window.around).maybeSingle();if(result.error)throw new ChatWindowError('window_unavailable',503);if(!result.data)throw new ChatWindowError('anchor_not_found',404);
  const anchor=result.data as unknown as PublicChatMessage,seq=anchor.unread_seq!;
  const left=await rows(query().lt('unread_seq',seq).order('unread_seq',{ascending:false}).limit(Math.floor(limit/2)));
  const right=await rows(query().gt('unread_seq',seq).order('unread_seq',{ascending:true}).limit(limit-left.length-1));
  messages=[...left.reverse(),anchor,...right];
 }else{
  let q=query().order('unread_seq',{ascending:!!window.after||!!window.range}).limit(limit);
  if(window.before)q=q.lt('unread_seq',window.before);
  if(window.after)q=q.gt('unread_seq',window.after);
  if(window.range){const [first,last]=window.range.split(',');q=q.gte('unread_seq',first).lte('unread_seq',last);}
  messages=await rows(q);if(!window.after&&!window.range)messages.reverse();
 }
 const retained=window.range?.split(',').map(Number);
 const first=messages[0]?.unread_seq??retained?.[0],last=messages.at(-1)?.unread_seq??retained?.[1];
 const hasMore=first?!!(await rows(query('id,unread_seq').lt('unread_seq',first).limit(1))).length:false;
 const hasNewer=last?!!(await rows(query('id,unread_seq').gt('unread_seq',last).limit(1))).length:false;
 return {messages,hasMore,hasNewer,range:first&&last?`${first},${last}`:null};
}
