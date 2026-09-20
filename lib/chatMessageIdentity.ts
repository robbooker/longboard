import type {PublicChatMessage} from './publicChat';

// Compare every supplied field, including future fields, rather than maintaining a
// list that could accidentally hide a newly introduced server update.
export function sameChatMessage(a:PublicChatMessage,b:PublicChatMessage):boolean {
  const keys=Object.keys(a) as (keyof PublicChatMessage)[];
  if(keys.length!==Object.keys(b).length)return false;
  return keys.every(key=>{
    const left=a[key],right=b[key];
    if(Array.isArray(left)&&Array.isArray(right))return left.length===right.length&&left.every((value,index)=>value===right[index]);
    return left===right;
  });
}

/** Keep authoritative ordering/deletions and pending sends; reuse unchanged rows. */
export function reconcileRoomMessages(current:PublicChatMessage[],snapshot:PublicChatMessage[]):PublicChatMessage[] {
  const existing=new Map(current.map(message=>[message.id,message]));
  const ids=new Set(snapshot.map(message=>message.id));
  const next=snapshot.map(message=>{
    const previous=existing.get(message.id);
    return previous&&sameChatMessage(previous,message)?previous:message;
  });
  for(const message of current)if(message.pending&&!ids.has(message.id))next.push(message);
  return next.length===current.length&&next.every((message,index)=>message===current[index])?current:next;
}
