import type {ChatRoom} from './publicChat';
export type VisibleNotificationScope={kind:'room';room:ChatRoom}|{kind:'dm';conversationId:string};
export type NotificationBoundary={mentionThrough:number;reactionThrough:number};

/** Message read positions never stand in for the independent notification cursors. */
export function visibleNotificationRequest(scope:VisibleNotificationScope,ids:string[],boundary:NotificationBoundary){
 return {kind:'visible',scope,messageIds:ids.slice(0,100),mentionThrough:scope.kind==='room'?boundary.mentionThrough:0,reactionThrough:boundary.reactionThrough};
}

/** Intersect both the scroll container and the browser viewport, not just loaded rows. */
export function visibleChatMessageIds(container:HTMLElement,canonicalIds:ReadonlySet<string>,selector:string,attribute:string):string[]{
 if(document.hidden||!document.hasFocus()||!container.isConnected||!container.clientHeight||!container.clientWidth||!container.getClientRects().length||document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]'))return [];
 if(getComputedStyle(container).visibility==='hidden')return [];
 const bounds=container.getBoundingClientRect();
 const top=Math.max(0,bounds.top),bottom=Math.min(window.innerHeight,bounds.bottom),left=Math.max(0,bounds.left),right=Math.min(window.innerWidth,bounds.right);
 if(bottom<=top||right<=left)return [];
 const ids:string[]=[];
 for(const row of container.querySelectorAll<HTMLElement>(selector)){
  const id=(row.getAttribute(attribute)??'').replace(/^chat-message-/,'');
  if(!canonicalIds.has(id)||!row.getClientRects().length||getComputedStyle(row).visibility==='hidden')continue;
  const box=row.getBoundingClientRect();
  if(box.top<bottom&&box.bottom>top&&box.left<right&&box.right>left){
   const x=(Math.max(left,box.left)+Math.min(right,box.right))/2,y=(Math.max(top,box.top)+Math.min(bottom,box.bottom))/2;
   const front=document.elementFromPoint(x,y);
   if(front&&row.contains(front))ids.push(id);
  }
 }
 return [...new Set(ids)];
}
